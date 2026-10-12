import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hash, token, roleCan } from "../server/core";
test("session secrets are random, fixed length, and stored hashed", () => {
  const a = token(),
    b = token();
  assert.notEqual(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(hash(a), a);
  assert.equal(hash(a), hash(a));
});
test("fixed role permission matrix denies member and moderator administration", () => {
  for (const role of ["owner", "admin"])
    assert.equal(roleCan(role, "manage"), true);
  for (const role of ["member", "moderator", "unknown"])
    assert.equal(roleCan(role, "manage"), false);
  assert.equal(roleCan("moderator", "moderate"), true);
  assert.equal(roleCan("member", "moderate"), false);
});
test("desktop shell declares secure renderer defaults and narrow preload methods", () => {
  const main = readFileSync("electron/main.cjs", "utf8"),
    preload = readFileSync("electron/preload.cjs", "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /devTools:\s*!app.isPackaged/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /safeStorage.encryptString/);
  assert.match(main, /setDisplayMediaRequestHandler/);
  assert.doesNotMatch(preload, /send:\s*ipcRenderer|invoke:\s*ipcRenderer/);
});
