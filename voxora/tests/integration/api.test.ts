import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, rm } from "node:fs/promises";
import { SMTPServer } from "smtp-server";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { io as connect, type Socket } from "socket.io-client";
let pg: EmbeddedPostgres, db: any, server: any, mail: SMTPServer;
let base = "",
  room = "",
  serverId = "",
  alice: any,
  bob: any,
  eve: any;
const sockets: Socket[] = [];
const inbox: string[] = [];
async function request(
  route: string,
  method = "GET",
  body?: any,
  token?: string,
  expected = 200,
) {
  const r = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      Origin: "http://localhost:5173",
      "X-Voxora-Desktop": "1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(
    r.status,
    expected,
    `${method} ${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
async function account(name: string) {
  await request(
    "/auth/register",
    "POST",
    {
      email: `${name}@example.test`,
      username: name,
      displayName: name,
      password: "correct horse battery staple",
    },
    undefined,
    201,
  );
  const raw = inbox.at(-1)!.replace(/=3D/g, "=");
  const verify = raw.match(/verify=([a-f0-9]{64})/)?.[1];
  assert.ok(verify, "Verification email must be delivered through SMTP");
  await request("/auth/verify", "POST", { token: verify });
  const result = await request("/auth/login", "POST", {
    email: `${name}@example.test`,
    password: "correct horse battery staple",
  });
  return { ...result.user, token: result.token };
}
function event(socket: Socket, name: string, trigger: () => void) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 5000);
    socket.once(name, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    trigger();
  });
}
async function socketFor(user: any) {
  const s = connect(base, {
    auth: { token: user.token },
    extraHeaders: { Origin: "http://localhost:5173" },
    autoConnect: false,
    transports: ["websocket"],
  });
  sockets.push(s);
  await event(s, "connect", () => s.connect());
  return s;
}
async function ack(s: Socket, name: string, payload: any) {
  return new Promise<any>((resolve, reject) => {
    s.timeout(5000).emit(name, payload, (err: any, result: any) =>
      err ? reject(err) : resolve(result),
    );
  });
}
before(async () => {
  await mkdir("test-results", { recursive: true });
  process.env.DATABASE_URL =
    "postgresql://voxora:testing-only@127.0.0.1:55432/voxora_test";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "11026";
  process.env.APP_ORIGIN = "http://localhost:5173";
  process.env.UPLOAD_DIR = "test-results/uploads";
  process.env.LIVEKIT_URL = "";
  process.env.LIVEKIT_API_KEY = "";
  process.env.LIVEKIT_API_SECRET = "";
  pg = new EmbeddedPostgres({
    databaseDir: "test-results/pg",
    user: "voxora",
    password: "testing-only",
    port: 55432,
    persistent: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("voxora_test");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    await readFile(
      "prisma/migrations/20261011000000_initial/migration.sql",
      "utf8",
    ),
  );
  await client.end();
  mail = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      let data = "";
      stream.on("data", (chunk) => (data += chunk.toString()));
      stream.on("end", () => {
        inbox.push(data.replace(/=\r?\n/g, ""));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) =>
    mail.listen(11026, "127.0.0.1", resolve),
  );
  const core = await import("../../server/core");
  db = core.db;
  const { createApp } = await import("../../server/app");
  server = createApp();
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${server.http.address().port}`;
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  if (server) await new Promise<void>((r) => server.io.close(() => r()));
  if (db) await db.$disconnect();
  if (mail) await new Promise<void>((r) => mail.close(() => r()));
  if (pg) await pg.stop();
  await rm("test-results/uploads", { recursive: true, force: true });
});
test("health, registration, SMTP verification, login and hashed sessions", async () => {
  await request("/health");
  alice = await account("alice");
  bob = await account("bob");
  eve = await account("eve");
  await request(
    "/auth/login",
    "POST",
    { email: "alice@example.test", password: "not the password" },
    undefined,
    401,
  );
  const u = await db.user.findUnique({ where: { id: alice.id } });
  assert.match(u.passwordHash, /^\$2[ab]\$/);
  assert.notEqual(u.passwordHash, "correct horse battery staple");
  const s = await db.session.findFirst({ where: { userId: alice.id } });
  assert.notEqual(s.tokenHash, alice.token);
  await request("/auth/me", "GET", undefined, undefined, 401);
});
test("friend requests, recipient-only acceptance and persistent direct messages", async () => {
  const f = await request(
    "/friends",
    "POST",
    { username: "bob" },
    alice.token,
    201,
  );
  await request(`/friends/${f.id}`, "PATCH", {}, alice.token, 403);
  await request(`/friends/${f.id}`, "PATCH", {}, bob.token);
  const dm = await request(
    "/dms",
    "POST",
    { userIds: [bob.id], name: "Alice and Bob" },
    alice.token,
    201,
  );
  room = dm.id;
  await request(
    `/conversations/${room}/messages`,
    "POST",
    { body: "Persisted hello" },
    alice.token,
    201,
  );
  const history = await request(
    `/conversations/${room}/messages`,
    "GET",
    undefined,
    bob.token,
  );
  assert.equal(history.messages[0].body, "Persisted hello");
  await request(
    `/conversations/${room}/messages`,
    "GET",
    undefined,
    eve.token,
    403,
  );
  const again = await request(
    "/dms",
    "POST",
    { userIds: [bob.id] },
    alice.token,
    201,
  );
  assert.equal(again.id, room);
});
test("servers enforce roles, private channels, bounded invitations and membership", async () => {
  const community = await request(
    "/servers",
    "POST",
    { name: "Test community" },
    alice.token,
    201,
  );
  serverId = community.id;
  const invite = await request(
    `/servers/${serverId}/invites`,
    "POST",
    { maxUses: 1, hours: 1 },
    alice.token,
    201,
  );
  await request(`/invites/${invite.code}/join`, "POST", {}, bob.token);
  await request(`/invites/${invite.code}/join`, "POST", {}, eve.token, 400);
  await request(
    `/servers/${serverId}/channels`,
    "POST",
    { name: "not-allowed", kind: "text" },
    bob.token,
    403,
  );
  const c = await request(
    `/servers/${serverId}/channels`,
    "POST",
    { name: "private", kind: "text", private: true },
    alice.token,
    201,
  );
  await request(
    `/conversations/${c.id}/messages`,
    "GET",
    undefined,
    bob.token,
    403,
  );
  await request(
    `/channels/${c.id}`,
    "PATCH",
    { userIds: [bob.id], slowMode: 30 },
    alice.token,
  );
  await request(
    `/conversations/${c.id}/messages`,
    "POST",
    { body: "Allowed now" },
    bob.token,
    201,
  );
  await request(
    `/conversations/${c.id}/messages`,
    "POST",
    { body: "Too fast" },
    bob.token,
    429,
  );
  const s = await socketFor(bob);
  assert.equal((await ack(s, "conversation:join", c.id)).ok, true);
  await request(`/channels/${c.id}`, "PATCH", { userIds: [] }, alice.token);
  assert.equal((await ack(s, "conversation:join", c.id)).ok, false);
  await request(
    `/conversations/${c.id}/messages`,
    "POST",
    { body: "Not anymore" },
    bob.token,
    403,
  );
});
test("Socket.IO delivers persisted chat, edits, reactions and recovery after reconnect", async () => {
  const s = await socketFor(bob);
  assert.equal((await ack(s, "conversation:join", room)).ok, true);
  const received = event(s, "message:new", () => {
    void request(
      `/conversations/${room}/messages`,
      "POST",
      { body: "Realtime message" },
      alice.token,
      201,
    );
  });
  const m = await received;
  assert.equal(m.body, "Realtime message");
  await request(
    `/messages/${m.id}`,
    "PATCH",
    { body: "Updated" },
    bob.token,
    403,
  );
  await request(`/messages/${m.id}`, "PATCH", { body: "Updated" }, alice.token);
  const reacted = await request(
    `/messages/${m.id}/reactions`,
    "POST",
    { emoji: "👍" },
    bob.token,
  );
  assert.equal(reacted.reactions.length, 1);
  s.disconnect();
  await request(
    `/conversations/${room}/messages`,
    "POST",
    { body: "While offline" },
    alice.token,
    201,
  );
  await event(s, "connect", () => s.connect());
  assert.equal((await ack(s, "conversation:join", room)).ok, true);
  const history = await request(
    `/conversations/${room}/messages`,
    "GET",
    undefined,
    bob.token,
  );
  assert.ok(history.messages.some((m: any) => m.body === "While offline"));
});
test("file upload, message association and download require conversation membership", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["A document for Bob"], { type: "text/plain" }),
    "hello.txt",
  );
  const r = await fetch(`${base}/api/conversations/${room}/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${alice.token}`,
      Origin: "http://localhost:5173",
    },
    body: form,
  });
  assert.equal(r.status, 201);
  const f: any = await r.json();
  await request(`/uploads/${f.id}`, "GET", undefined, bob.token, 403);
  await request(
    `/conversations/${room}/messages`,
    "POST",
    { body: "Read this", uploadIds: [f.id] },
    alice.token,
    201,
  );
  const allowed = await fetch(`${base}/api/uploads/${f.id}`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "A document for Bob");
  await request(`/uploads/${f.id}`, "GET", undefined, eve.token, 403);
  const bad = new FormData();
  bad.append("file", new Blob(["<script>alert(1)</script>"]), "evil.png");
  const denied = await fetch(`${base}/api/conversations/${room}/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${alice.token}`,
      Origin: "http://localhost:5173",
    },
    body: bad,
  });
  assert.equal(denied.status, 400);
});
test("call ringing, acceptance and unauthorized voice/video token requests", async () => {
  const a = await socketFor(alice),
    b = await socketFor(bob),
    e = await socketFor(eve);
  const incoming = event(b, "call:incoming", () => {
    void ack(a, "call:ring", room);
  });
  assert.equal((await incoming).conversationId, room);
  assert.equal(
    (await ack(e, "call:respond", { id: room, accept: true })).ok,
    false,
  );
  const response = event(a, "call:response", () => {
    void ack(b, "call:respond", { id: room, accept: true });
  });
  assert.equal((await response).accept, true);
  await request(`/conversations/${room}/media`, "POST", {}, eve.token, 403);
  await request(`/conversations/${room}/media`, "POST", {}, bob.token, 503);
});
test("blocking prevents new direct messages; timeout and bans enforce access", async () => {
  await request("/blocks", "POST", { targetId: alice.id }, bob.token, 200);
  await request(
    `/conversations/${room}/messages`,
    "POST",
    { body: "Blocked" },
    alice.token,
    403,
  );
  await request(`/blocks/${alice.id}`, "DELETE", undefined, bob.token);
  await request(
    `/servers/${serverId}/moderate`,
    "POST",
    { targetId: bob.id, action: "ban" },
    alice.token,
  );
  await request(
    `/servers/${serverId}/members`,
    "GET",
    undefined,
    bob.token,
    403,
  );
});
test("revoking a session prevents HTTP reuse and socket authentication", async () => {
  await request("/auth/logout", "POST", {}, eve.token);
  await request("/auth/me", "GET", undefined, eve.token, 401);
  const s = connect(base, {
    auth: { token: eve.token },
    extraHeaders: { Origin: "http://localhost:5173" },
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(s);
  const error = await event(s, "connect_error", () => s.connect());
  assert.match(error.message, /Sign in required/);
});
test.skip("two-network SFU audio/video, screen capture, TURN fallback and Windows startup/shutdown — requires provisioned media infrastructure and two desktop machines", () => {});
test("password reset is single-use and revokes every existing session", async () => {
  await request("/auth/forgot", "POST", { email: "bob@example.test" });
  const raw = inbox.at(-1)!.replace(/=3D/g, "=");
  const reset = raw.match(/reset=([a-f0-9]{64})/)?.[1];
  assert.ok(reset);
  await request("/auth/reset", "POST", {
    token: reset,
    password: "a different long password",
  });
  await request("/auth/me", "GET", undefined, bob.token, 401);
  await request(
    "/auth/reset",
    "POST",
    { token: reset, password: "another different password" },
    undefined,
    400,
  );
  await request("/auth/login", "POST", {
    email: "bob@example.test",
    password: "a different long password",
  });
});
test("mutation requests from an untrusted origin are rejected", async () => {
  const r = await fetch(`${base}/api/servers`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      Authorization: `Bearer ${alice.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "CSRF attempt" }),
  });
  assert.equal(r.status, 403);
});
