import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { mkdir, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import {
  db,
  access,
  assert,
  member,
  publicUser,
  token,
  type AuthRequest,
  HttpError,
} from "./core";
export const chat = Router();
export const messageInclude = {
  author: { select: publicUser },
  uploads: { select: { id: true, name: true, mime: true, size: true } },
  reactions: true,
} as const;
const uid = (req: any) => (req as AuthRequest).userId;
const storage = path.resolve(process.env.UPLOAD_DIR || "storage");
const maxSize =
  Math.min(Number(process.env.MAX_UPLOAD_MB || 10), 100) * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(storage, { recursive: true })
        .then(() => cb(null, storage))
        .catch((e) => cb(e, storage));
    },
    filename: (_req, _file, cb) => cb(null, token()),
  }),
  limits: { fileSize: maxSize, files: 1, fields: 0 },
});
chat.get("/conversations/:id/messages", async (req, res) => {
  const id = String(req.params.id);
  await access(uid(req), id);
  const q = z
    .object({
      before: z.string().cuid().optional(),
      q: z.string().max(100).optional(),
      pinned: z.enum(["true"]).optional(),
      replyTo: z.string().cuid().optional(),
    })
    .parse(req.query);
  let before;
  if (q.before) {
    before = await db.message.findFirst({
      where: { id: q.before, conversationId: id },
    });
    assert(before, 400, "Invalid cursor");
  }
  const messages = await db.message.findMany({
    where: {
      conversationId: id,
      ...(q.q
        ? { body: { contains: q.q, mode: "insensitive" }, deletedAt: null }
        : {}),
      ...(q.pinned ? { pinned: true } : {}),
      ...(q.replyTo ? { replyToId: q.replyTo } : {}),
      ...(before
        ? {
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    include: messageInclude,
  });
  res.json({
    messages: messages.reverse(),
    nextCursor: messages.length === 50 ? messages[0].id : null,
  });
});
chat.post("/conversations/:id/messages", async (req, res) => {
  const id = String(req.params.id),
    userId = uid(req);
  const c = await access(userId, id, true);
  const v = z
    .object({
      body: z.string().trim().max(4000).default(""),
      replyToId: z.string().cuid().optional(),
      uploadIds: z.array(z.string().cuid()).max(5).default([]),
    })
    .parse(req.body);
  assert(v.body || v.uploadIds.length, 400, "Write a message or attach a file");
  if (v.replyToId)
    assert(
      await db.message.findFirst({
        where: { id: v.replyToId, conversationId: id, deletedAt: null },
      }),
      400,
      "Reply target not found",
    );
  const m = await db.$transaction(async (tx) => {
    const lock = `${id}:${userId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
    if (c.slowMode) {
      const last = await tx.message.findFirst({
        where: { conversationId: id, authorId: userId },
        orderBy: { createdAt: "desc" },
      });
      assert(
        !last || Date.now() - last.createdAt.getTime() >= c.slowMode * 1000,
        429,
        "Slow mode is enabled. Please wait.",
      );
    }
    const uploads = await tx.upload.findMany({
      where: {
        id: { in: v.uploadIds },
        userId,
        conversationId: id,
        messageId: null,
      },
    });
    assert(
      uploads.length === new Set(v.uploadIds).size,
      400,
      "Invalid attachments",
    );
    return tx.message.create({
      data: {
        body: v.body,
        conversationId: id,
        authorId: userId,
        replyToId: v.replyToId,
        uploads: { connect: uploads.map((u) => ({ id: u.id })) },
      },
      include: messageInclude,
    });
  });
  req.app.get("io").to(`conversation:${id}`).emit("message:new", m);
  res.status(201).json(m);
});
chat.patch("/messages/:id", async (req, res) => {
  const userId = uid(req);
  const m = await db.message.findUnique({
    where: { id: String(req.params.id) },
  });
  assert(m && !m.deletedAt, 404);
  const c = await access(userId, m.conversationId, true);
  const v = z
    .object({
      body: z.string().trim().min(1).max(4000).optional(),
      pinned: z.boolean().optional(),
    })
    .strict()
    .parse(req.body);
  if (v.body !== undefined) assert(m.authorId === userId);
  if (v.pinned !== undefined) {
    assert(c.serverId, 400, "Pins require a server channel");
    await member(userId, c.serverId, "moderate");
  }
  const result = await db.message.update({
    where: { id: m.id },
    data: { ...v, ...(v.body ? { editedAt: new Date() } : {}) },
    include: messageInclude,
  });
  req.app.get("io").to(`conversation:${c.id}`).emit("message:update", result);
  res.json(result);
});
chat.delete("/messages/:id", async (req, res) => {
  const userId = uid(req),
    m = await db.message.findUnique({ where: { id: String(req.params.id) } });
  assert(m, 404);
  const c = await access(userId, m.conversationId, true);
  if (m.authorId !== userId) {
    assert(c.serverId);
    await member(userId, c.serverId, "moderate");
  }
  const result = await db.message.update({
    where: { id: m.id },
    data: {
      body: "",
      deletedAt: new Date(),
      pinned: false,
      uploads: { set: [] },
      reactions: { deleteMany: {} },
    },
    include: messageInclude,
  });
  req.app.get("io").to(`conversation:${c.id}`).emit("message:update", result);
  res.json(result);
});
chat.post("/messages/:id/reactions", async (req, res) => {
  const userId = uid(req),
    m = await db.message.findUnique({ where: { id: String(req.params.id) } });
  assert(m && !m.deletedAt, 404);
  await access(userId, m.conversationId, true);
  const { emoji } = z
    .object({ emoji: z.enum(["👍", "❤️", "😂", "🎉", "👀", "✅"]) })
    .parse(req.body);
  const key = { messageId: m.id, userId, emoji };
  await db.$transaction(async (tx) => {
    const lock = JSON.stringify(key);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
    const old = await tx.reaction.findUnique({
      where: { messageId_userId_emoji: key },
    });
    if (old) await tx.reaction.delete({ where: { id: old.id } });
    else await tx.reaction.create({ data: key });
  });
  const result = await db.message.findUnique({
    where: { id: m.id },
    include: messageInclude,
  });
  req.app
    .get("io")
    .to(`conversation:${m.conversationId}`)
    .emit("message:update", result);
  res.json(result);
});
chat.post("/conversations/:id/read", async (req, res) => {
  const conversationId = String(req.params.id),
    userId = uid(req);
  await access(userId, conversationId);
  const data = z
    .object({ muted: z.boolean().optional() })
    .parse(req.body || {});
  await db.conversationMember.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    create: { conversationId, userId, ...data },
    update: { lastReadAt: new Date(), ...data },
  });
  res.json({ ok: true });
});
chat.get("/unread", async (req, res) => {
  const userId = uid(req);
  // One SQL query rather than one COUNT per channel. Explicit private/server membership checks.
  const rows = await db.$queryRaw<
    Array<{ id: string; count: bigint }>
  >`SELECT c.id, count(m.id) AS count FROM "Conversation" c LEFT JOIN "ConversationMember" cm ON cm."conversationId"=c.id AND cm."userId"=${userId} LEFT JOIN "Member" sm ON sm."serverId"=c."serverId" AND sm."userId"=${userId} LEFT JOIN "Message" m ON m."conversationId"=c.id AND m."createdAt">COALESCE(cm."lastReadAt",c."createdAt") AND m."authorId"<>${userId} AND m."deletedAt" IS NULL WHERE (c."serverId" IS NULL AND cm.id IS NOT NULL) OR (sm.id IS NOT NULL AND (NOT c.private OR cm.id IS NOT NULL OR sm.role IN ('owner','admin'))) GROUP BY c.id`;
  res.json(rows.map((r) => ({ id: r.id, count: Number(r.count) })));
});
chat.post(
  "/conversations/:id/uploads",
  async (req, res, next) => {
    try {
      await access(uid(req), String(req.params.id), true);
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("file"),
  async (req, res) => {
    const f = req.file;
    assert(f, 400, "Choose a file");
    try {
      // Reject active/executable formats; never trust a browser-provided MIME type.
      const ext = path.extname(f.originalname).toLowerCase();
      const types: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
      };
      assert(types[ext], 400, "Unsupported file type");
      const bytes = (await readFile(f.path)).subarray(0, 32);
      const signatures: Record<string, boolean> = {
        ".png": bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        ".jpg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        ".jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        ".pdf": bytes.subarray(0, 5).toString() === "%PDF-",
        ".webp":
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP",
        ".mp4": bytes.subarray(4, 8).toString() === "ftyp",
        ".ogg": bytes.subarray(0, 4).toString() === "OggS",
        ".mp3":
          bytes.subarray(0, 3).toString() === "ID3" ||
          (bytes[0] === 255 && (bytes[1] & 224) === 224),
        ".txt": !bytes.includes(0),
      };
      assert(signatures[ext], 400, "File contents do not match the extension");
      const u = await db.$transaction(async (tx) => {
        const userId = uid(req);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const used = await tx.upload.aggregate({
          where: { userId },
          _sum: { size: true },
        });
        assert(
          (used._sum.size || 0) + f.size <=
            Number(process.env.USER_QUOTA_MB || 100) * 1048576,
          413,
          "Storage quota reached",
        );
        return tx.upload.create({
          data: {
            userId,
            conversationId: String(req.params.id),
            name: path.basename(f.originalname).slice(0, 150),
            mime: types[ext],
            size: f.size,
            key: f.filename,
          },
        });
      });
      res
        .status(201)
        .json({ id: u.id, name: u.name, mime: u.mime, size: u.size });
    } catch (e) {
      await unlink(f.path).catch(() => {});
      throw e;
    }
  },
);
chat.get("/uploads/:id", async (req, res) => {
  const u = await db.upload.findUnique({
    where: { id: String(req.params.id) },
  });
  assert(u, 404);
  await access(uid(req), u.conversationId);
  assert(u.messageId || u.userId === uid(req));
  res.setHeader("Content-Type", u.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.download(path.join(storage, u.key), u.name);
});
