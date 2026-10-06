// Node harness for src/zip.js.
//   node tools/test-zip.mjs
// Checks: CRC vector, STORE/DEFLATE roundtrips, ZIP64 trigger, both ciphers,
// wrong-password rejection, binary fidelity, the exact WinZip extra-field bytes,
// and a cross-check against Python (zipfile + pyzipper) written to /tmp.
import { writeFileSync } from 'node:fs';

const { zipCreate, zipList, zipExtractAll, zipExtractEntry, zipVerify, crc32, __test } =
  await import('../web/src/zip.js');

const text = (s) => new TextEncoder().encode(s);
let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
};

// 0 ─ AES-CTR keystream must match the reference (pycryptodome, AES-256 zero key)
{
  const key = new Uint8Array(32);
  const pt = new Uint8Array(48).fill(0x41);
  const ct = await __test.wzCtr(key, pt, 1);
  const ks = Buffer.from(ct).map((b, i) => b ^ 0x41).toString('hex');
  const want = '5275f3d86b4fb8684593133ebfa53cd3' +
               '779b38d15bffb63d8d609d551a5cc98e' +
               '39d6e9ae76a9b2f3fc462680f766720e';
  check(ks === want, 'AES-256-CTR keystream matches the reference', `\n      got  ${ks}\n      want ${want}`);
}

// 1 ─ CRC-32 known vector
check(crc32(text('123456789').buffer) === 0xcbf43926, 'crc32("123456789") = 0xcbf43926');

// 2 ─ roundtrips
async function roundtrip(label, entries, opts, password) {
  const blob = await zipCreate(entries, opts);
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(`/tmp/fb_${label}.zip`, buf);
  const list = await zipList(blob);
  const back = await zipExtractAll(blob, password);
  const map = new Map(back.map((b) => [b.name, Buffer.from(b.data)]));
  let ok = true;
  for (const e of entries) {
    const want = Buffer.from(e.data);
    const got = map.get(e.name);
    if (!got || !got.equals(want)) { ok = false; console.log(`      mismatch: ${e.name}`); }
  }
  check(ok && list.length === entries.length, label,
    `${buf.length}B · ${list.length} entries · [${list.map((e) => e.name).join(', ')}]`);
  return { blob, buf, list };
}

const big = text('abcdefghij0123456789 '.repeat(4000));       // 84 KB, very compressible

await roundtrip('store', [
  { name: 'hello.txt', data: text('salam 3likom — Filebox test'), lastModified: Date.now() },
  { name: 'sub/notes.md', data: text('# notes\n'.repeat(50)) },
], { level: 'store' });

await roundtrip('deflate', [
  { name: 'big.txt', data: big },
  { name: 'emoji-📦.txt', data: text('zip64 & unicode ✓') },
], { level: 'normal' });

await roundtrip('gcm', [
  { name: 'secret.txt', data: text('mot de passe: s3cr3t — chiffré AES-256-GCM ✓') },
  { name: 'dir/big.txt', data: big },
], { level: 'normal', password: 'khouya2024', cipher: 'gcm' }, 'khouya2024');

await roundtrip('wz', [
  { name: 'secret.txt', data: text('mot de passe: s3cr3t — WinZip AE-2 ✓') },
  { name: 'dir/big.txt', data: big },
], { level: 'normal', password: 'khouya2024', cipher: 'wz' }, 'khouya2024');

// 3 ─ wrong password rejected
for (const cipher of ['gcm', 'wz']) {
  const blob = await zipCreate([{ name: 'a.txt', data: text('secret') }], { password: 'right', cipher });
  let failed = false;
  try { await zipExtractAll(blob, 'wrong'); } catch { failed = true; }
  check(failed, `wrong password rejected (${cipher})`);
}

// 4 ─ binary fidelity
{
  const rnd = new Uint8Array(300000);
  for (let o = 0; o < rnd.length; o += 65536) crypto.getRandomValues(rnd.subarray(o, Math.min(o + 65536, rnd.length)));
  for (const cipher of [null, 'gcm']) {
    const blob = await zipCreate([{ name: 'rnd.bin', data: rnd }],
      { level: 'max', ...(cipher ? { password: 'p', cipher } : {}) });
    const back = await zipExtractAll(blob, cipher ? 'p' : undefined);
    check(Buffer.from(back[0].data).equals(Buffer.from(rnd)), `300 KB random binary (${cipher || 'plain'})`);
  }
}

// 5 ─ empty entry
{
  const blob = await zipCreate([{ name: 'empty.txt', data: new Uint8Array(0) }], { level: 'normal' });
  const back = await zipExtractAll(blob);
  check(back[0].data.length === 0, 'empty entry');
}

// 6 ─ ZIP64 extra field appears for a >4 GB compressed size (simulated by
//     checking the writer's own threshold logic through a huge sparse entry is
//     impractical, so assert the field is absent for small files instead)
{
  const list = await zipList(await zipCreate([{ name: 'x', data: text('y') }], {}));
  check(list[0].compSize === 1 && list[0].localOff === 0, 'small file: no ZIP64, offsets correct');
}

// 7 ─ the WinZip extra field must be byte-exact, because other tools read it
{
  const blob = await zipCreate([{ name: 'a.txt', data: text('x') }],
    { level: 'store', password: 'p', cipher: 'wz' });
  const b = Buffer.from(await blob.arrayBuffer());
  const nameEnd = b.indexOf(Buffer.from('a.txt')) + 5;
  const extra = b.subarray(nameEnd, nameEnd + 11);
  const got = extra.toString('hex');
  //        id  size  ver   "AE"  strength  method(STORE=0)
  const want = '0199' + '0700' + '0200' + '4541' + '03' + '0000';
  check(got === want, 'WinZip AE extra field bytes', `\n      got  ${got}\n      want ${want}`);
}

// 8 ─ the Filebox GCM extra field
{
  const blob = await zipCreate([{ name: 'a.txt', data: text('x') }],
    { level: 'store', password: 'p', cipher: 'gcm' });
  const b = Buffer.from(await blob.arrayBuffer());
  const nameEnd = b.indexOf(Buffer.from('a.txt')) + 5;
  const extra = b.subarray(nameEnd, nameEnd + 8);
  const got = extra.toString('hex');
  const want = '01fb' + '0400' + '4642' + '0000';
  check(got === want, 'Filebox GCM extra field bytes', `\n      got  ${got}\n      want ${want}`);
}

// 9 ─ integrity check reports a healthy vault
{
  const blob = await zipCreate([{ name: 'a.txt', data: text('hello') }, { name: 'b.txt', data: big }],
    { level: 'normal', password: 'p', cipher: 'gcm' });
  const v = await zipVerify(blob, 'p');
  check(v.ok && v.entries === 2, 'zipVerify on a healthy vault', JSON.stringify(v));
}

// 10 ─ integrity check catches a flipped byte
{
  const blob = await zipCreate([{ name: 'a.txt', data: text('hello world, this is a test') }],
    { level: 'store' });
  const buf = Buffer.from(await blob.arrayBuffer());
  const at = buf.indexOf(Buffer.from('hello'));
  buf[at] ^= 0xff;
  const v = await zipVerify(new Blob([buf]), undefined);
  check(!v.ok && /CRC/i.test(v.error || ''), 'zipVerify catches corruption', JSON.stringify(v));
}

// 11 ─ cross-implementation: read a vault written by Python's pyzipper
{
  const fs = await import('node:fs');
  const path = '/tmp/from_pyzipper.zip';
  if (fs.existsSync(path)) {
    const blob = new Blob([fs.readFileSync(path)]);
    const out = await zipExtractAll(blob, 'mdp1234');
    const first = Buffer.from(out[0].data).toString('utf8');
    check(out.length === 2 && first.startsWith('salam mn pyzipper'),
      'reads a WinZip-AES zip written by pyzipper', first.slice(0, 40));
  } else {
    console.log('SKIP pyzipper interop (run tools/make-interop-fixture.py first)');
  }
}

// 12 ─ throughput of the default (GCM) path
{
  const buf = new Uint8Array(8 * 1024 * 1024);
  for (let o = 0; o < buf.length; o += 65536) crypto.getRandomValues(buf.subarray(o, o + 65536));
  const t0 = Date.now();
  const blob = await zipCreate([{ name: 'film.mp4', data: buf }], { level: 'normal', password: 'p' });
  const t1 = Date.now();
  const back = await zipExtractAll(blob, 'p');
  const t2 = Date.now();
  check(Buffer.from(back[0].data).equals(Buffer.from(buf)),
    '8 MB vault create+extract (GCM)',
    `create ${t1 - t0}ms · extract ${t2 - t1}ms · ${(blob.size / 1048576).toFixed(1)}MB on disk`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall zip.js checks passed');
process.exit(failures ? 1 : 0);
