import { Router } from "express";
import { z } from "zod";
import { db, assert, publicUser, type AuthRequest } from "./core";
export const social = Router();
social.get("/friends", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const relations = await db.friendship.findMany({
    where: { OR: [{ fromId: userId }, { toId: userId }] },
  });
  const ids = relations
    .flatMap((r) => [r.fromId, r.toId])
    .filter((id) => id !== userId);
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: publicUser,
  });
  res.json(
    relations.map((r) => ({
      ...r,
      user: users.find(
        (u) => u.id === (r.fromId === userId ? r.toId : r.fromId),
      ),
    })),
  );
});
social.post("/friends", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const { username } = z
    .object({ username: z.string().max(24) })
    .parse(req.body);
  const to = await db.user.findUnique({ where: { username } });
  assert(to && to.id !== userId, 404, "User not available");
  assert(
    (to.preferences as Record<string, unknown>).allowFriendRequests !== false,
    403,
    "User is not accepting requests",
  );
  assert(
    !(await db.block.findFirst({
      where: {
        OR: [
          { userId, targetId: to.id },
          { userId: to.id, targetId: userId },
        ],
      },
    })),
    403,
    "User not available",
  );
  const pair = [userId, to.id].sort().join(":");
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pair}))`;
    assert(
      !(await tx.friendship.findFirst({
        where: {
          OR: [
            { fromId: userId, toId: to.id },
            { fromId: to.id, toId: userId },
          ],
        },
      })),
      409,
      "Request already exists",
    );
    return tx.friendship.create({ data: { fromId: userId, toId: to.id } });
  });
  req.app.get("io").to(`user:${to.id}`).emit("friend:request", result);
  res.status(201).json(result);
});
social.patch("/friends/:id", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const f = await db.friendship.findUnique({
    where: { id: String(req.params.id) },
  });
  assert(f && f.toId === userId && f.state === "pending");
  res.json(
    await db.friendship.update({
      where: { id: f.id },
      data: { state: "accepted" },
    }),
  );
});
social.delete("/friends/:id", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  await db.friendship.deleteMany({
    where: {
      id: String(req.params.id),
      OR: [{ fromId: userId }, { toId: userId }],
    },
  });
  res.json({ ok: true });
});
social.get("/blocks", async (req, res) =>
  res.json(
    await db.block.findMany({
      where: { userId: (req as unknown as AuthRequest).userId },
    }),
  ),
);
social.post("/blocks", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const { targetId } = z
    .object({ targetId: z.string().cuid() })
    .parse(req.body);
  assert(targetId !== userId, 400);
  assert(await db.user.findUnique({ where: { id: targetId } }), 404);
  await db.$transaction([
    db.block.upsert({
      where: { userId_targetId: { userId, targetId } },
      create: { userId, targetId },
      update: {},
    }),
    db.friendship.deleteMany({
      where: {
        OR: [
          { fromId: userId, toId: targetId },
          { fromId: targetId, toId: userId },
        ],
      },
    }),
  ]);
  res.json({ ok: true });
});
social.delete("/blocks/:id", async (req, res) => {
  await db.block.deleteMany({
    where: {
      userId: (req as unknown as AuthRequest).userId,
      targetId: String(req.params.id),
    },
  });
  res.json({ ok: true });
});
social.post("/reports", async (req, res) => {
  const data = z
    .object({
      targetId: z.string().cuid(),
      reason: z.string().trim().min(10).max(2000),
    })
    .parse(req.body);
  await db.report.create({
    data: { ...data, userId: (req as unknown as AuthRequest).userId },
  });
  res.status(201).json({ ok: true });
});
social.post("/dms", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const v = z
    .object({
      userIds: z.array(z.string().cuid()).min(1).max(9),
      name: z.string().trim().min(1).max(80).optional(),
    })
    .parse(req.body);
  const ids = [...new Set([userId, ...v.userIds])];
  assert(ids.length > 1, 400);
  for (const id of ids.filter((id) => id !== userId)) {
    assert(
      await db.friendship.findFirst({
        where: {
          state: "accepted",
          OR: [
            { fromId: userId, toId: id },
            { fromId: id, toId: userId },
          ],
        },
      }),
      403,
      "Add this person as a friend first",
    );
    assert(
      !(await db.block.findFirst({
        where: {
          OR: [
            { userId, targetId: id },
            { userId: id, targetId: userId },
          ],
        },
      })),
    );
  }
  const key = ids.sort().join(":");
  const c = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    if (ids.length === 2) {
      const old = await tx.conversation.findFirst({
        where: {
          kind: "dm",
          members: { every: { userId: { in: ids } } },
          AND: ids.map((id) => ({ members: { some: { userId: id } } })),
        },
      });
      if (old) return old;
    }
    return tx.conversation.create({
      data: {
        name: v.name || "Direct conversation",
        kind: ids.length === 2 ? "dm" : "group",
        members: { create: ids.map((id) => ({ userId: id })) },
      },
    });
  });
  ids.forEach((id) =>
    req.app.get("io").to(`user:${id}`).emit("workspace:changed"),
  );
  res.status(201).json(c);
});
