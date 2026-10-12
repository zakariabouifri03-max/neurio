import { Router } from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { access, assert, db, type AuthRequest } from "./core";
export const media = Router();
export function mediaClient() {
  if (
    !process.env.LIVEKIT_URL ||
    !process.env.LIVEKIT_API_KEY ||
    !process.env.LIVEKIT_API_SECRET
  )
    return null;
  return new RoomServiceClient(
    process.env.LIVEKIT_INTERNAL_URL ||
      process.env.LIVEKIT_URL.replace(/^ws/, "http"),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
}
media.post("/conversations/:id/media", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const c = await access(userId, String(req.params.id), true);
  assert(c.kind !== "text", 400, "Use a voice channel or direct conversation");
  const service = mediaClient();
  assert(service, 503, "Media server is not configured");
  const name = `conversation-${c.id}`;
  // The SFU, not just this endpoint, enforces the participant limit.
  await service.createRoom({
    name,
    maxParticipants: c.participantLimit,
    emptyTimeout: 60,
    departureTimeout: 20,
  });
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const t = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: userId, name: u.displayName, ttl: "2m" },
  );
  t.addGrant({
    room: name,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  res.json({ token: await t.toJwt(), url: process.env.LIVEKIT_URL });
});
