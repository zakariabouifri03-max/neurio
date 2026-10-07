// Montaj Pro — APK signing (v1 + v2 + v3) using apk_sign_ts (pure JS, no JDK tools)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const toolsDir = path.join(root, '.tools');
const signerDir = path.join(toolsDir, 'signer');

async function loadSigner() {
  const pkg = path.join(signerDir, 'package/dist/index.js');
  if (fs.existsSync(pkg)) return await import(pathToFileURL(pkg).href);
  throw new Error('apk_sign_ts not found in .tools/signer — run tools/apk/build-apk.sh');
}

async function main() {
  const [unsignedPath, outPath, keyPath, certPath] = process.argv.slice(2);
  const { ApkSigner, SigningKey } = await loadSigner();
  const apk = new Uint8Array(fs.readFileSync(unsignedPath));
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const certificate = fs.readFileSync(certPath, 'utf8');
  const key = SigningKey.fromPEM(privateKey, certificate);
  const signer = new ApkSigner({ signingKey: key, digestAlgorithm: 'SHA-256' });
  const { signedApk, signatureSize } = await signer.sign(apk);
  fs.writeFileSync(outPath, signedApk);
  console.log(`signed: ${path.basename(outPath)} (${(signedApk.length / 1048576).toFixed(2)} MB, signing block ${signatureSize} bytes)`);
}
main().catch((e) => { console.error('SIGN FAILED:', e.message); process.exit(1); });
