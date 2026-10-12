import { Router } from "express";
import { z } from "zod";
import {
  db,
  assert,
  member,
  access,
  audit,
  token,
  publicUser,
  type AuthRequest,
  roleCan,
} from "./core";
export const communities = Router();
const uid = (req: any) => (req as AuthRequest).userId;
communities.get("/workspace", async (req, res) => {
  const userId = uid(req);
  const servers = await db.server.findMany({
    where: { members: { some: { userId } } },
    include: {
      members: { where: { userId } },
      channels: {
        where: {
          OR: [
            { private: false },
            { members: { some: { userId } } },
            {
              server: {
                members: { some: { userId, role: { in: ["owner", "admin"] } } },
              },
            },
          ],
        },
      },
      _count: { select: { members: true } },
    },
  });
  const dms = await db.conversation.findMany({
    where: { serverId: null, members: { some: { userId } } },
    include: { members: { include: { user: { select: publicUser } } } },
  });
  res.json({ servers, dms });
});
communities.post("/servers", async (req, res) => {
  const data = z
    .object({
      name: z.string().trim().min(2).max(60),
      description: z.string().max(300).optional(),
    })
    .parse(req.body);
  const s = await db.server.create({
    data: {
      ...data,
      ownerId: uid(req),
      members: { create: { userId: uid(req), role: "owner" } },
      channels: {
        create: [{ name: "general" }, { name: "Lounge", kind: "voice" }],
      },
    },
  });
  res.status(201).json(s);
});
communities.patch("/servers/:id", async (req, res) => {
  const id = String(req.params.id);
  await member(uid(req), id, "manage");
  const data = z
    .object({
      name: z.string().trim().min(2).max(60),
      description: z.string().max(300),
    })
    .partial()
    .strict()
    .parse(req.body);
  res.json(await db.server.update({ where: { id }, data }));
  await audit(id, uid(req), "server.updated");
});
communities.get("/servers/:id/members", async (req, res) => {
  const id = String(req.params.id);
  await member(uid(req), id);
  res.json(
    await db.member.findMany({
      where: {
        serverId: id,
        user: {
          displayName: {
            contains: String(req.query.q || "").slice(0, 50),
            mode: "insensitive",
          },
        },
      },
      include: { user: { select: publicUser } },
      take: 100,
      orderBy: { id: "asc" },
      ...(req.query.cursor
        ? { cursor: { id: String(req.query.cursor) }, skip: 1 }
        : {}),
    }),
  );
});
communities.post("/servers/:id/channels", async (req, res) => {
  const id = String(req.params.id);
  await member(uid(req), id, "manage");
  const v = z
    .object({
      name: z.string().trim().min(1).max(60),
      kind: z.enum(["text", "voice"]),
      private: z.boolean().default(false),
      category: z.string().max(40).default("General"),
    })
    .parse(req.body);
  res
    .status(201)
    .json(await db.conversation.create({ data: { ...v, serverId: id } }));
  await audit(id, uid(req), "channel.created");
});
communities.patch("/channels/:id", async (req, res) => {
  const c = await access(uid(req), String(req.params.id));
  assert(c.serverId);
  await member(uid(req), c.serverId, "manage");
  const v = z
    .object({
      name: z.string().trim().min(1).max(60).optional(),
      private: z.boolean().optional(),
      slowMode: z.number().int().min(0).max(3600).optional(),
      participantLimit: z.number().int().min(2).max(100).optional(),
      category: z.string().max(40).optional(),
      position: z.number().int().min(0).optional(),
      userIds: z.array(z.string().cuid()).max(100).optional(),
    })
    .strict()
    .parse(req.body);
  const { userIds, ...data } = v;
  if (userIds) {
    const count = await db.member.count({
      where: { serverId: c.serverId, userId: { in: userIds } },
    });
    assert(
      count === new Set(userIds).size,
      400,
      "Members must belong to this server",
    );
  }
  await db.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: c.id }, data });
    if (userIds) {
      await tx.conversationMember.deleteMany({
        where: { conversationId: c.id },
      });
      await tx.conversationMember.createMany({
        data: [...new Set(userIds)].map((userId) => ({
          userId,
          conversationId: c.id,
        })),
        skipDuplicates: true,
      });
    }
  });
  // Remove subscriptions so a newly-private channel cannot leak later events.
  req.app
    .get("io")
    .in(`conversation:${c.id}`)
    .socketsLeave(`conversation:${c.id}`);
  req.app.get("io").emit("workspace:changed");
  await audit(c.serverId, uid(req), "channel.updated", c.id);
  res.json({ ok: true });
});
communities.post("/servers/:id/invites", async (req, res) => {
  const id = String(req.params.id);
  await member(uid(req), id, "manage");
  const v = z
    .object({
      hours: z.number().int().min(1).max(168).default(24),
      maxUses: z.number().int().min(1).max(1000).default(10),
    })
    .parse(req.body);
  res.status(201).json(
    await db.invite.create({
      data: {
        serverId: id,
        code: token().slice(0, 24),
        expiresAt: new Date(Date.now() + v.hours * 3600000),
        maxUses: v.maxUses,
      },
    }),
  );
});
communities.post("/invites/:code/join", async (req, res) => {
  const userId = uid(req),
    code = String(req.params.code);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${code}))`;
    const i = await tx.invite.findUnique({ where: { code } });
    assert(
      i && i.expiresAt > new Date() && i.uses < i.maxUses,
      400,
      "Invite expired or exhausted",
    );
    assert(
      !(await tx.ban.findUnique({
        where: { serverId_userId: { serverId: i.serverId, userId } },
      })),
      403,
      "You are banned from this server",
    );
    if (
      await tx.member.findUnique({
        where: { serverId_userId: { serverId: i.serverId, userId } },
      })
    )
      return { serverId: i.serverId };
    await tx.invite.update({
      where: { id: i.id },
      data: { uses: { increment: 1 } },
    });
    await tx.member.create({ data: { userId, serverId: i.serverId } });
    return { serverId: i.serverId };
  });
  res.json(result);
});
communities.post("/servers/:id/leave", async (req, res) => {
  const id = String(req.params.id),
    userId = uid(req);
  const m = await member(userId, id);
  assert(m.role !== "owner", 400, "Transfer ownership before leaving");
  await db.member.delete({ where: { id: m.id } });
  await evict(req, id, userId);
  res.json({ ok: true });
});
async function evict(req: any, serverId: string, userId: string) {
  const channels = await db.conversation.findMany({
    where: { serverId },
    select: { id: true },
  });
  for (const c of channels) {
    req.app.get("io").in(`user:${userId}`).socketsLeave(`conversation:${c.id}`);
    const media = req.app.get("media");
    if (media) {
      try {
        await media.removeParticipant(`conversation-${c.id}`, userId);
      } catch {}
    }
  }
  req.app.get("io").to(`user:${userId}`).emit("workspace:changed");
}
communities.post("/servers/:id/moderate", async (req, res) => {
  const id = String(req.params.id),
    userId = uid(req);
  const actor = await member(userId, id, "moderate");
  const v = z
    .object({
      targetId: z.string().cuid(),
      action: z.enum(["kick", "ban", "unban", "timeout", "role", "transfer"]),
      role: z.enum(["member", "moderator", "admin"]).optional(),
      minutes: z.number().int().min(0).max(40320).default(60),
    })
    .parse(req.body);
  assert(v.targetId !== userId, 400, "Cannot moderate yourself");
  const target = await db.member.findUnique({
    where: { serverId_userId: { serverId: id, userId: v.targetId } },
  });
  const rank: Record<string, number> = {
    member: 0,
    moderator: 1,
    admin: 2,
    owner: 3,
  };
  if (target)
    assert(
      rank[actor.role] > rank[target.role],
      403,
      "Cannot moderate an equal or higher role",
    );
  if (v.action === "role") {
    assert(
      roleCan(actor.role, "manage") &&
        v.role &&
        rank[actor.role] > rank[v.role],
    );
    assert(target, 404);
    await db.member.update({
      where: { id: target.id },
      data: { role: v.role },
    });
  }
  if (v.action === "transfer") {
    assert(actor.role === "owner" && target);
    await db.$transaction([
      db.server.update({ where: { id }, data: { ownerId: v.targetId } }),
      db.member.update({ where: { id: actor.id }, data: { role: "admin" } }),
      db.member.update({ where: { id: target.id }, data: { role: "owner" } }),
    ]);
  }
  if (v.action === "timeout") {
    assert(target, 404);
    await db.member.update({
      where: { id: target.id },
      data: { timeoutUntil: new Date(Date.now() + v.minutes * 60000) },
    });
  }
  if (v.action === "ban")
    await db.ban.upsert({
      where: { serverId_userId: { serverId: id, userId: v.targetId } },
      create: { serverId: id, userId: v.targetId },
      update: {},
    });
  if (v.action === "unban")
    await db.ban.deleteMany({ where: { serverId: id, userId: v.targetId } });
  if (["ban", "kick"].includes(v.action))
    await db.member.deleteMany({ where: { serverId: id, userId: v.targetId } });
  if (["ban", "kick", "timeout", "role"].includes(v.action))
    await evict(req, id, v.targetId);
  await audit(id, userId, v.action, v.targetId);
  res.json({ ok: true });
});
communities.get("/servers/:id/audit", async (req, res) => {
  const id = String(req.params.id);
  await member(uid(req), id, "moderate");
  res.json(
    await db.audit.findMany({
      where: { serverId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
});
