import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { access, assert, db, origins, session } from "./core";
export function realtime(http: HttpServer) {
  const io = new Server(http, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(null, !!req.headers.origin && origins.includes(req.headers.origin)),
  });
  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("voxora="))
        ?.slice(7);
      const raw = socket.handshake.auth.token || cookie;
      const s = await session(typeof raw === "string" ? raw : undefined);
      assert(s, 401, "Sign in required");
      socket.data.userId = s.userId;
      socket.data.raw = raw;
      next();
    } catch {
      next(new Error("Sign in required"));
    }
  });
  const calls = new Map<
    string,
    {
      caller: string;
      conversationId: string;
      expires: number;
      recipients: string[];
    }
  >();
  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    let windowStart = Date.now(),
      events = 0;
    socket.use(async (_packet, next) => {
      try {
        if (Date.now() - windowStart > 10000) {
          windowStart = Date.now();
          events = 0;
        }
        assert(++events <= 500, 429, "Too many events");
        assert(await session(socket.data.raw), 401);
        next();
      } catch {
        socket.disconnect(true);
      }
    });
    const guard =
      (fn: (v: any) => Promise<unknown>) => (v: any, ack?: Function) => {
        fn(v)
          .then((result) => ack?.({ ok: true, data: result }))
          .catch(() =>
            ack?.({ ok: false, error: "Not available or access denied" }),
          );
      };
    socket.on(
      "conversation:join",
      guard(async (v) => {
        const id = z.string().cuid().parse(v);
        await access(userId, id);
        socket.join(`conversation:${id}`);
      }),
    );
    socket.on("conversation:leave", (id: unknown) => {
      if (typeof id === "string") socket.leave(`conversation:${id}`);
    });
    socket.on(
      "typing",
      guard(async (v) => {
        const id = z.string().cuid().parse(v);
        await access(userId, id, true);
        socket
          .to(`conversation:${id}`)
          .emit("typing", { conversationId: id, userId });
      }),
    );
    socket.on(
      "call:ring",
      guard(async (v) => {
        const id = z.string().cuid().parse(v);
        const c = await access(userId, id, true);
        assert(!c.serverId && c.members.length <= 10);
        assert(
          ![...calls.values()].some((c) => c.caller === userId),
          429,
          "Already ringing",
        );
        const recipients = c.members
          .map((m) => m.userId)
          .filter((id) => id !== userId);
        calls.set(id, {
          caller: userId,
          conversationId: id,
          expires: Date.now() + 30000,
          recipients,
        });
        for (const recipient of recipients) {
          const u = await db.user.findUnique({
            where: { id: recipient },
            select: { status: true },
          });
          if (u?.status !== "dnd")
            io.to(`user:${recipient}`).emit("call:incoming", {
              conversationId: id,
              callerId: userId,
            });
        }
        return { conversationId: id };
      }),
    );
    socket.on(
      "call:respond",
      guard(async (v) => {
        const { id, accept } = z
          .object({ id: z.string().cuid(), accept: z.boolean() })
          .parse(v);
        await access(userId, id, true);
        const call = calls.get(id);
        assert(
          call && call.expires > Date.now() && call.recipients.includes(userId),
        );
        io.to(`user:${call.caller}`).emit("call:response", {
          conversationId: id,
          userId,
          accept,
        });
        call.recipients = call.recipients.filter((id) => id !== userId);
        if (accept || !call.recipients.length) calls.delete(id);
      }),
    );
    socket.on(
      "call:end",
      guard(async (v) => {
        const id = z.string().cuid().parse(v);
        await access(userId, id);
        const call = calls.get(id);
        if (call && call.caller === userId) {
          for (const recipient of call.recipients)
            io.to(`user:${recipient}`).emit("call:ended", {
              conversationId: id,
            });
          calls.delete(id);
        }
      }),
    );
  });
  const timer = setInterval(async () => {
    for (const [id, c] of calls)
      if (c.expires < Date.now()) {
        for (const user of [...c.recipients, c.caller])
          io.to(`user:${user}`).emit("call:ended", { conversationId: id });
        calls.delete(id);
      }
    for (const socket of io.sockets.sockets.values()) {
      try {
        if (!(await session(socket.data.raw))) socket.disconnect(true);
      } catch {
        socket.disconnect(true);
      }
    }
  }, 15000);
  timer.unref();
  io.on("close", () => clearInterval(timer));
  return io;
}
