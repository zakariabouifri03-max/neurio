import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import nodemailer from "nodemailer";
import {
  db,
  hash,
  token,
  assert,
  auth,
  production,
  publicUser,
  type AuthRequest,
} from "./core";
export const accounts = Router();
const password = z.string().min(12).max(72);
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === "true",
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
    : {}),
});
async function mail(userId: string, email: string, kind: string) {
  const raw = token();
  await db.accountToken.create({
    data: {
      hash: hash(raw),
      userId,
      kind,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const link = `${process.env.APP_ORIGIN || "http://localhost:5173"}/?${kind}=${raw}`;
  await transport.sendMail({
    from: process.env.SMTP_FROM || "Voxora <hello@localhost>",
    to: email,
    subject:
      kind === "verify"
        ? "Verify your Voxora email"
        : "Reset your Voxora password",
    text: `Open ${link}\nThis single-use link expires in one hour. If you did not request this, ignore it.`,
  });
}
accounts.post("/register", async (req, res) => {
  const v = z
    .object({
      email: z.string().email().max(254),
      username: z.string().regex(/^[a-z0-9_]{3,24}$/),
      displayName: z.string().trim().min(1).max(40),
      password,
    })
    .parse(req.body);
  const u = await db.user.create({
    data: {
      email: v.email.toLowerCase(),
      username: v.username,
      displayName: v.displayName,
      passwordHash: await bcrypt.hash(v.password, 12),
    },
  });
  try {
    await mail(u.id, u.email, "verify");
  } catch {
    res.status(202).json({
      message:
        "Account created, but email delivery failed. Use resend verification when mail is available.",
    });
    return;
  }
  res.status(201).json({ message: "Check your email to verify your account." });
});
accounts.post("/login", async (req, res) => {
  const v = z
    .object({ email: z.string().email(), password: z.string().max(72) })
    .parse(req.body);
  const u = await db.user.findUnique({
    where: { email: v.email.toLowerCase() },
  });
  // A fixed valid hash equalizes the expensive path for unknown accounts.
  const valid = await bcrypt.compare(
    v.password,
    u?.passwordHash ||
      "$2b$12$KIXzJa7yfSiyAjkGPc2aeuAUEHDYG0dXLsAhzglNK3zTwRYSVMMGq",
  );
  assert(u && valid, 401, "Invalid email or password");
  assert(u.verified, 403, "Verify your email before signing in");
  const raw = token();
  const expiresAt = new Date(
    Date.now() +
      Math.min(Number(process.env.SESSION_DAYS || 30), 90) * 86400000,
  );
  await db.session.create({
    data: { userId: u.id, tokenHash: hash(raw), expiresAt },
  });
  res.cookie("voxora", raw, {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    expires: expiresAt,
    path: "/",
  });
  // Desktop persists only in the OS-encrypted vault; browsers use the HttpOnly cookie.
  res.json({
    token: req.headers["x-voxora-desktop"] === "1" ? raw : undefined,
    user: { id: u.id, displayName: u.displayName },
  });
});
accounts.post("/resend", async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (u && !u.verified) await mail(u.id, u.email, "verify");
  res.json({
    message: "If an unverified account exists, a new email has been sent.",
  });
});
accounts.post("/forgot", async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (u) await mail(u.id, u.email, "reset");
  res.json({ message: "If that account exists, a reset email has been sent." });
});
accounts.post("/verify", async (req, res) => {
  const v = z.object({ token: z.string().length(64) }).parse(req.body);
  await db.$transaction(async (tx) => {
    const t = await tx.accountToken.findUnique({
      where: { hash: hash(v.token) },
    });
    assert(
      t && t.kind === "verify" && t.expiresAt > new Date(),
      400,
      "Invalid or expired link",
    );
    await tx.accountToken.delete({ where: { id: t.id } });
    await tx.user.update({ where: { id: t.userId }, data: { verified: true } });
  });
  res.json({ message: "Email verified. You can now sign in." });
});
accounts.post("/reset", async (req, res) => {
  const v = z
    .object({ token: z.string().length(64), password })
    .parse(req.body);
  const passwordHash = await bcrypt.hash(v.password, 12);
  await db.$transaction(async (tx) => {
    const t = await tx.accountToken.findUnique({
      where: { hash: hash(v.token) },
    });
    assert(
      t && t.kind === "reset" && t.expiresAt > new Date(),
      400,
      "Invalid or expired link",
    );
    await tx.accountToken.delete({ where: { id: t.id } });
    await tx.user.update({ where: { id: t.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: t.userId } });
    await tx.accountToken.deleteMany({
      where: { userId: t.userId, kind: "reset" },
    });
  });
  res.json({ message: "Password changed. Sign in again." });
});
accounts.post("/logout", auth, async (req, res) => {
  await db.session.deleteMany({
    where: { id: (req as AuthRequest).sessionId },
  });
  res.clearCookie("voxora", { path: "/" }).json({ ok: true });
});
accounts.get("/me", auth, async (req, res) =>
  res.json(
    await db.user.findUnique({
      where: { id: (req as AuthRequest).userId },
      select: { ...publicUser, email: true, preferences: true },
    }),
  ),
);
accounts.patch("/me", auth, async (req, res) => {
  const data = z
    .object({
      displayName: z.string().trim().min(1).max(40).optional(),
      bio: z.string().max(160).optional(),
      status: z.enum(["online", "idle", "dnd", "invisible"]).optional(),
      preferences: z
        .object({
          theme: z.enum(["dark", "light"]).optional(),
          notifications: z.boolean().optional(),
          allowFriendRequests: z.boolean().optional(),
        })
        .optional(),
    })
    .strict()
    .parse(req.body);
  res.json(
    await db.user.update({
      where: { id: (req as AuthRequest).userId },
      data,
      select: publicUser,
    }),
  );
});
accounts.get("/sessions", auth, async (req, res) =>
  res.json(
    await db.session.findMany({
      where: { userId: (req as AuthRequest).userId },
      select: { id: true, createdAt: true, expiresAt: true },
    }),
  ),
);
accounts.delete("/sessions/:id", auth, async (req, res) => {
  await db.session.deleteMany({
    where: { id: String(req.params.id), userId: (req as AuthRequest).userId },
  });
  res.json({ ok: true });
});
