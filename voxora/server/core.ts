import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import pino from "pino";
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
export const log = pino({
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "password",
    "token",
    "email",
  ],
});
export const production = process.env.NODE_ENV === "production";
export const origins = [
  process.env.APP_ORIGIN || "http://localhost:5173",
  "voxora://app",
  ...(process.env.EXTRA_ORIGINS || "").split(","),
].filter(Boolean);
export const publicUser = {
  id: true,
  username: true,
  displayName: true,
  status: true,
  bio: true,
  avatar: true,
  banner: true,
} as const;
export const token = () => randomBytes(32).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  status = 403,
  message = "Access denied",
): asserts value {
  if (!value) throw new HttpError(status, message);
}
export type AuthRequest = Request & { userId: string; sessionId: string };
export async function session(raw?: string) {
  if (!raw) return null;
  const s = await db.session.findUnique({
    where: { tokenHash: hash(raw) },
    include: { user: true },
  });
  return s && s.expiresAt > new Date() ? s : null;
}
export async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await session(
      req.headers.authorization?.replace(/^Bearer /, "") || req.cookies?.voxora,
    );
    assert(s, 401, "Please sign in");
    Object.assign(req, { userId: s.userId, sessionId: s.id });
    next();
  } catch (e) {
    next(e);
  }
}
export function roleCan(role: string, action: "manage" | "moderate") {
  return action === "manage"
    ? ["owner", "admin"].includes(role)
    : ["owner", "admin", "moderator"].includes(role);
}
export async function member(
  userId: string,
  serverId: string,
  action?: "manage" | "moderate",
) {
  const m = await db.member.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  assert(m);
  if (action) assert(roleCan(m.role, action));
  return m;
}
export async function access(userId: string, id: string, write = false) {
  const c = await db.conversation.findUnique({
    where: { id },
    include: { members: true },
  });
  assert(c, 404, "Conversation not found");
  const cm = c.members.find((m) => m.userId === userId);
  if (c.serverId) {
    const m = await member(userId, c.serverId);
    assert(!c.private || cm || roleCan(m.role, "manage"));
    if (write)
      assert(
        !m.timeoutUntil || m.timeoutUntil <= new Date(),
        403,
        "You are timed out",
      );
  } else {
    assert(cm);
    if (write) {
      const ids = c.members.map((m) => m.userId);
      const b = await db.block.findFirst({
        where: {
          OR: [
            { userId, targetId: { in: ids } },
            { targetId: userId, userId: { in: ids } },
          ],
        },
      });
      assert(!b, 403, "Messaging is blocked");
    }
  }
  return c;
}
export async function audit(
  serverId: string,
  actorId: string,
  action: string,
  targetId?: string,
) {
  await db.audit.create({ data: { serverId, actorId, action, targetId } });
}
