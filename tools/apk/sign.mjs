/* ============================================================
   tools/apk/sign.mjs
   v1 (JAR) APK signing, done with the openssl CLI.

   Only v1 is used, on purpose: this build has no Android SDK, and
   a *broken* APK Signature Scheme v2/v3 block makes Android refuse
   the install outright (it never falls back to v1). A v1-only APK
   with targetSdkVersion ≤ 29 installs on every Android 5.0+.

   tools/verify-apk.mjs re-checks every digest and the signature.
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const b64 = (buf) => buf.toString('base64');
const sha256 = (buf) => createHash('sha256').update(buf).digest();
const CRLF = '\r\n';

/* ---- a self-signed key, generated once and reused so updates install ---- */
export function ensureKeystore(dir, subject) {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'release-key.pem');
  const cert = join(dir, 'release-cert.pem');
  if (existsSync(key) && existsSync(cert)) return { key, cert, created: false };
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '10950', '-nodes',
    '-keyout', key, '-out', cert, '-subj', subject,
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature',
  ], { stdio: 'pipe' });
  return { key, cert, created: true };
}

const derToPem = (der, label) => {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
};

/* ---- MANIFEST.MF + <KEY>.SF + <KEY>.RSA ---- */
export function signV1(entries, { key, cert, keyName = 'BOTOLA25' }) {
  const skip = (n) => n.startsWith('META-INF/');
  const files = entries.filter((e) => !skip(e.name));

  let manifest = `Manifest-Version: 1.0${CRLF}${CRLF}`;
  const sections = [];
  for (const e of files) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const sec = `Name: ${e.name}${CRLF}SHA-256-Digest: ${b64(sha256(data))}${CRLF}${CRLF}`;
    manifest += sec;
    sections.push({ name: e.name, sec });
  }
  const manifestBuf = Buffer.from(manifest, 'binary');

  let sf = `Signature-Version: 1.0${CRLF}` +
    `Created-By: 1.0 (Botola 25 build-apk)${CRLF}` +
    `SHA-256-Digest-Manifest: ${b64(sha256(manifestBuf))}${CRLF}${CRLF}`;
  for (const s of sections) {
    sf += `Name: ${s.name}${CRLF}SHA-256-Digest: ${b64(sha256(Buffer.from(s.sec, 'binary')))}${CRLF}${CRLF}`;
  }
  const sfBuf = Buffer.from(sf, 'binary');

  // PKCS#7 SignedData over the raw .SF bytes, with the certificate embedded
  const tmpSf = join(process.env.TMPDIR || '/tmp', `botola-${process.pid}.sf`);
  writeFileSync(tmpSf, sfBuf);
  const rsa = execFileSync('openssl', [
    'cms', '-sign', '-binary', '-in', tmpSf, '-outform', 'DER',
    '-noattr', '-md', 'sha256', '-signer', cert, '-inkey', key,
    '-keyopt', 'rsa_padding_mode:pkcs1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 });

  return [
    { name: 'META-INF/MANIFEST.MF', data: manifestBuf, store: true },
    { name: `META-INF/${keyName}.SF`, data: sfBuf, store: true },
    { name: `META-INF/${keyName}.RSA`, data: rsa, store: true },
  ];
}

export function certSubject(certPath) {
  const out = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-subject'], { encoding: 'utf8' });
  return out.trim().replace(/^subject=\s*/, '');
}

export function certPem(certPath) { return readFileSync(certPath, 'utf8'); }
export { derToPem };
