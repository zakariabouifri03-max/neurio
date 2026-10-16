// Generates the app signing key (RSA-2048, self-signed, ~30 years) if missing.
// Uses node-forge only — no JDK/keytool needed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPrivateKey } from 'node:crypto';

const require = createRequire(import.meta.url);
const MODS = process.env.APKTOOLS_MODULES || '/tmp/gb/node_modules';
const forge = require(MODS + '/node-forge');

const keyPath = process.argv[2];
const certPath = process.argv[3];

if (existsSync(keyPath) && existsSync(certPath)) {
  console.log('key already present:', keyPath, certPath);
  process.exit(0);
}

console.log('generating RSA-2048 key…');
const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + Date.now().toString(16);
cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
cert.validity.notAfter = new Date('2055-01-01T00:00:00Z');

const attrs = [
  { name: 'commonName', value: 'Bash Baqi Racing' },
  { name: 'organizationName', value: 'Neurio' },
  { name: 'organizationalUnitName', value: 'Android' },
  { shortName: 'C', value: 'MA' },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', codeSigning: true },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

// export as PKCS#8 (what WebCrypto / APK signers expect)
const pkcs8 = createPrivateKey({
  key: forge.pki.privateKeyToPem(keys.privateKey),
  format: 'pem',
  type: 'pkcs1',
}).export({ type: 'pkcs8', format: 'pem' });

writeFileSync(keyPath, pkcs8);
writeFileSync(certPath, forge.pki.certificateToPem(cert));
console.log('wrote', keyPath, 'and', certPath);
