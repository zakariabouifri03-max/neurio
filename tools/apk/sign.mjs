// Signs an unsigned APK with APK Signature Scheme v2 (enough for Android 7+/API 24+,
// and the scheme Android 11+ requires for targetSdk 30+ apps).
// Self-contained: no JDK / apksigner / network needed.
import { readFileSync, writeFileSync } from 'node:fs';

const MODS = process.env.APKTOOLS_MODULES || '/tmp/gb/node_modules';
const LIB = process.env.APKSIGN_LIB || MODS + '/apk_sign_ts/dist/index.js';

const [apkIn, apkOut, keyPath, certPath] = process.argv.slice(2);
if (!apkIn || !apkOut || !keyPath || !certPath) {
  console.error('usage: sign.mjs <in.apk> <out.apk> <key.pem> <cert.pem>');
  process.exit(2);
}

const lib = await import(LIB);
const key = lib.SigningKey.fromPEM(
  readFileSync(keyPath, 'utf8'),
  readFileSync(certPath, 'utf8'),
);

const signer = new lib.ApkSigner({ signingKey: key, digestAlgorithm: 'SHA-256' });

// 1. normalise the zip: drop any META-INF entries / previous signing block,
//    rewrite the central directory so entries are contiguous (required by the v2 digest).
const clean = signer.sanitizeApk(new Uint8Array(readFileSync(apkIn)));

// 2. v2 digest is computed over the file *before* the signing block is inserted,
//    with the EOCD central-directory offset pointing at the future block start.
const eocd = lib.findEndOfCentralDirectory(clean);
const v2 = new lib.V2Signer({ signingKey: key, digestAlgorithm: 'SHA-256' });
const { v2Value } = await v2.sign(clean, eocd.centralDirectoryOffset, eocd.recordOffset);

// 3. build the APK Signing Block, insert it, fix up the EOCD offset.
const block = lib.createSigningBlock([lib.createV2SignaturePair(v2Value)]);
const out = signer.insertSigningBlock(clean, block, eocd.centralDirectoryOffset, eocd.recordOffset);

writeFileSync(apkOut, out);
console.log(
  `signed ${apkIn} -> ${apkOut} (${(out.length / 1024).toFixed(1)} KB, ` +
  `signing block ${(block.length / 1024).toFixed(1)} KB, v2 SHA-256)`,
);
