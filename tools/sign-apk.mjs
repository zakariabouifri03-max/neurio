#!/usr/bin/env node
/** Sign an unsigned APK with the standard JAR v1 and APK Signature Scheme v2/v3 formats.
 *
 * apk_sign_ts provides the cryptographic signing primitives. Alignment is done here before
 * signing so resources.arsc is stored, 4-byte aligned, and has a valid ZIP extra field.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createVerify, constants, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
  SigningKey,
  V2Signer,
  concatBytes,
  createSigningBlock,
  createV2SignaturePair,
  findEndOfCentralDirectory,
  getEntryDataOffset,
  parseZipCentralDirectory,
} from 'apk_sign_ts';
// The package exposes v2 at its top level but not these two sibling signer classes.
import { V1Signer } from '../node_modules/apk_sign_ts/dist/V1Signer.js';
import { V3Signer } from '../node_modules/apk_sign_ts/dist/V3Signer.js';

const ONE_MIB = 1024 * 1024;
const APK_SIGNING_BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
const V2_BLOCK_ID = 0x7109871a;
const V3_BLOCK_ID = 0xf05368c0;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredLocalHeader(name, content, crc, extra) {
  const header = Buffer.alloc(30 + name.length + extra.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(0, 10); // DOS time
  header.writeUInt16LE(0, 12); // DOS date (1980-01-01)
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  Buffer.from(name).copy(header, 30);
  Buffer.from(extra).copy(header, 30 + name.length);
  return header;
}

function zipalignForAndroid(input) {
  const eocd = findEndOfCentralDirectory(input);
  if (!eocd) throw new Error('Unsigned APK has no ZIP end-of-central-directory record.');
  const directory = parseZipCentralDirectory(input);
  const entries = [...directory.entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  const localParts = [];
  const directoryParts = [];
  let localOffset = 0;
  let alignedResourceTable = false;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const nextLocalOffset = index + 1 < entries.length
      ? entries[index + 1].localHeaderOffset
      : directory.offset;
    const cdHeaderSize = 46 + entry.nameLength + entry.extraLength + entry.commentLength;

    if (entry.name === 'resources.arsc') {
      if (alignedResourceTable) throw new Error('APK contains multiple resources.arsc entries.');
      alignedResourceTable = true;
      const dataOffset = getEntryDataOffset(input, entry.localHeaderOffset);
      const compressed = input.subarray(dataOffset, dataOffset + entry.compressedSize);
      const content = entry.compressionMethod === 0
        ? compressed
        : inflateRawSync(compressed);
      const name = Buffer.from(entry.name, 'utf8');
      const padding = (4 - ((localOffset + 30 + name.length + 4) % 4)) % 4;
      const extra = Buffer.alloc(4 + padding);
      extra.writeUInt16LE(0xd935, 0); // Android ZIP alignment extra-field identifier
      extra.writeUInt16LE(padding, 2);
      const checksum = crc32(content);
      const localHeader = makeStoredLocalHeader(name, content, checksum, extra);
      localParts.push(localHeader, content);

      // Keep central-directory metadata/comments, but describe the uncompressed table and its CRC.
      const cdHeader = Buffer.from(input.subarray(entry.cdHeaderOffset, entry.cdHeaderOffset + cdHeaderSize));
      cdHeader.writeUInt16LE(0, 10); // compression method: stored
      cdHeader.writeUInt32LE(checksum, 16);
      cdHeader.writeUInt32LE(content.length, 20);
      cdHeader.writeUInt32LE(content.length, 24);
      cdHeader.writeUInt32LE(localOffset, 42);
      directoryParts.push(cdHeader);
      localOffset += localHeader.length + content.length;
    } else {
      const localEnd = index + 1 < entries.length ? nextLocalOffset : directory.offset;
      const localChunk = input.subarray(entry.localHeaderOffset, localEnd);
      localParts.push(localChunk);
      const cdHeader = Buffer.from(input.subarray(entry.cdHeaderOffset, entry.cdHeaderOffset + cdHeaderSize));
      cdHeader.writeUInt32LE(localOffset, 42);
      directoryParts.push(cdHeader);
      localOffset += localChunk.length;
    }
  }

  if (!alignedResourceTable) throw new Error('APK has no resources.arsc entry.');
  const localData = concatBytes(localParts);
  const centralDirectory = concatBytes(directoryParts);
  const newEocd = Buffer.from(input.subarray(eocd.recordOffset));
  newEocd.writeUInt16LE(directoryParts.length, 8);
  newEocd.writeUInt16LE(directoryParts.length, 10);
  newEocd.writeUInt32LE(centralDirectory.length, 12);
  newEocd.writeUInt32LE(localData.length, 16);
  const aligned = concatBytes([localData, centralDirectory, newEocd]);

  const alignedDirectory = parseZipCentralDirectory(aligned);
  const resource = alignedDirectory.entries.find((entry) => entry.name === 'resources.arsc');
  const resourceDataOffset = getEntryDataOffset(aligned, resource.localHeaderOffset);
  if (resource.compressionMethod !== 0 || resourceDataOffset % 4 !== 0) {
    throw new Error('Failed to store and 4-byte-align resources.arsc.');
  }
  return aligned;
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('Truncated APK signature data.');
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, 4).readUInt32LE(0);
}

function readLP(bytes, offset) {
  const length = readU32(bytes, offset);
  const start = offset + 4;
  const end = start + length;
  if (end > bytes.length) throw new Error('Truncated length-prefixed APK signature field.');
  return { value: bytes.subarray(start, end), next: end };
}

function splitSequence(bytes) {
  const values = [];
  let offset = 0;
  while (offset < bytes.length) {
    const field = readLP(bytes, offset);
    values.push(field.value);
    offset = field.next;
  }
  return values;
}

function findSigningBlock(apk, centralDirectoryOffset) {
  const magicOffset = centralDirectoryOffset - APK_SIGNING_BLOCK_MAGIC.length;
  if (magicOffset < 8 || !apk.subarray(magicOffset, centralDirectoryOffset).equals(APK_SIGNING_BLOCK_MAGIC)) {
    throw new Error('APK signature block magic was not found.');
  }
  const trailingSizeOffset = magicOffset - 8;
  const blockSize = Number(apk.readBigUInt64LE(trailingSizeOffset));
  const blockStart = centralDirectoryOffset - blockSize - 8;
  if (blockStart < 0 || Number(apk.readBigUInt64LE(blockStart)) !== blockSize) {
    throw new Error('APK signature block length fields do not match.');
  }
  const pairsEnd = trailingSizeOffset;
  const pairs = new Map();
  let offset = blockStart + 8;
  while (offset < pairsEnd) {
    const pairSize = Number(apk.readBigUInt64LE(offset));
    if (pairSize < 4 || offset + 8 + pairSize > pairsEnd) {
      throw new Error('Malformed APK signing-block pair.');
    }
    const id = apk.readUInt32LE(offset + 8);
    if (pairs.has(id)) throw new Error(`Duplicate APK signing-block pair 0x${id.toString(16)}.`);
    pairs.set(id, apk.subarray(offset + 12, offset + 8 + pairSize));
    offset += 8 + pairSize;
  }
  if (offset !== pairsEnd) throw new Error('APK signing-block pairs are not properly terminated.');
  return { blockStart, blockSize, pairs };
}

function parseDigestRecords(field) {
  const records = new Map();
  for (const record of splitSequence(field)) {
    const algorithm = readU32(record, 0);
    const digest = readLP(record, 4);
    if (digest.next !== record.length) throw new Error('Malformed APK content-digest record.');
    records.set(algorithm, digest.value);
  }
  return records;
}

function apkContentDigest(apk, blockStart, centralDirectoryOffset, eocdOffset, hashName) {
  const endRecord = Buffer.from(apk.subarray(eocdOffset));
  endRecord.writeUInt32LE(blockStart, 16);
  const sections = [
    apk.subarray(0, blockStart),
    apk.subarray(centralDirectoryOffset, eocdOffset),
    endRecord,
  ];
  const chunkHashes = [];
  for (const section of sections) {
    for (let offset = 0; offset < section.length; offset += ONE_MIB) {
      const chunk = section.subarray(offset, Math.min(offset + ONE_MIB, section.length));
      const chunkLength = Buffer.alloc(4);
      chunkLength.writeUInt32LE(chunk.length, 0);
      chunkHashes.push(createHash(hashName).update(Buffer.from([0xa5])).update(chunkLength).update(chunk).digest());
    }
  }
  const count = Buffer.alloc(4);
  count.writeUInt32LE(chunkHashes.length, 0);
  return createHash(hashName).update(Buffer.from([0x5a])).update(count).update(Buffer.concat(chunkHashes)).digest();
}

function verifyScheme(apk, pairValue, isV3, blockStart, centralDirectoryOffset, eocdOffset) {
  const signersField = readLP(pairValue, 0);
  if (signersField.next !== pairValue.length) throw new Error('Malformed APK signer list.');
  const signers = splitSequence(signersField.value);
  if (signers.length === 0) throw new Error('APK signer list is empty.');

  for (const signer of signers) {
    let offset = 0;
    const signedDataField = readLP(signer, offset);
    offset = signedDataField.next;
    let signerMinSdk = null;
    let signerMaxSdk = null;
    if (isV3) {
      signerMinSdk = readU32(signer, offset);
      signerMaxSdk = readU32(signer, offset + 4);
      offset += 8;
    }
    const signaturesField = readLP(signer, offset);
    offset = signaturesField.next;
    const publicKeyField = readLP(signer, offset);
    if (publicKeyField.next !== signer.length) throw new Error('Malformed APK signer record.');

    let signedOffset = 0;
    const digestsField = readLP(signedDataField.value, signedOffset);
    signedOffset = digestsField.next;
    const certificatesField = readLP(signedDataField.value, signedOffset);
    signedOffset = certificatesField.next;
    let signedMinSdk = null;
    let signedMaxSdk = null;
    if (isV3) {
      signedMinSdk = readU32(signedDataField.value, signedOffset);
      signedMaxSdk = readU32(signedDataField.value, signedOffset + 4);
      signedOffset += 8;
      if (signedMinSdk !== signerMinSdk || signedMaxSdk !== signerMaxSdk) {
        throw new Error('APK v3 SDK ranges differ inside and outside signed data.');
      }
    }
    const attributesField = readLP(signedDataField.value, signedOffset);
    if (attributesField.next !== signedDataField.value.length) throw new Error('Malformed APK signed-data record.');

    const certificates = splitSequence(certificatesField.value);
    if (certificates.length === 0) throw new Error('APK signer has no certificate.');
    const certificate = new X509Certificate(Buffer.from(certificates[0]));
    const certificatePublicKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
    if (!Buffer.from(certificatePublicKey).equals(Buffer.from(publicKeyField.value))) {
      throw new Error('APK signer public key does not match its certificate.');
    }

    const digestRecords = parseDigestRecords(digestsField.value);
    const signatures = splitSequence(signaturesField.value);
    if (signatures.length === 0) throw new Error('APK signer has no signature.');
    let verified = false;
    for (const record of signatures) {
      const algorithm = readU32(record, 0);
      const signatureField = readLP(record, 4);
      if (signatureField.next !== record.length) throw new Error('Malformed APK signature record.');
      const hashName = algorithm === 0x0103 ? 'sha256' : algorithm === 0x0104 ? 'sha512' : null;
      if (!hashName) throw new Error(`Unsupported APK signature algorithm 0x${algorithm.toString(16)}.`);
      const expectedDigest = digestRecords.get(algorithm);
      if (!expectedDigest) throw new Error('APK signature has no matching content digest.');
      const actualDigest = apkContentDigest(apk, blockStart, centralDirectoryOffset, eocdOffset, hashName);
      if (!actualDigest.equals(Buffer.from(expectedDigest))) throw new Error('APK content digest does not match.');
      const verifier = createVerify(hashName);
      verifier.update(signedDataField.value);
      verifier.end();
      if (verifier.verify({ key: certificate.publicKey, padding: constants.RSA_PKCS1_PADDING }, signatureField.value)) {
        verified = true;
        break;
      }
    }
    if (!verified) throw new Error(`APK v${isV3 ? '3' : '2'} signature did not verify.`);
  }
}

function verifyV2V3(apk) {
  const eocd = findEndOfCentralDirectory(apk);
  if (!eocd) throw new Error('Signed APK has no end-of-central-directory record.');
  const centralDirectoryOffset = eocd.centralDirectoryOffset;
  const { blockStart, pairs } = findSigningBlock(apk, centralDirectoryOffset);
  const v2 = pairs.get(V2_BLOCK_ID);
  const v3 = pairs.get(V3_BLOCK_ID);
  if (!v2 || !v3) throw new Error('APK must include both v2 and v3 signing blocks.');
  verifyScheme(apk, v2, false, blockStart, centralDirectoryOffset, eocd.recordOffset);
  verifyScheme(apk, v3, true, blockStart, centralDirectoryOffset, eocd.recordOffset);
  return { v2: true, v3: true };
}

async function main() {
  const [inputPath, keyPath, certificatePath, outputPath] = process.argv.slice(2);
  if (!inputPath || !keyPath || !certificatePath || !outputPath) {
    throw new Error('Usage: node tools/sign-apk.mjs <unsigned.apk> <key.pem> <certificate.pem> <signed.apk>');
  }
  const [input, privateKey, certificate] = await Promise.all([
    readFile(inputPath),
    readFile(keyPath, 'utf8'),
    readFile(certificatePath, 'utf8'),
  ]);
  const signingKey = SigningKey.fromPEM(privateKey, certificate);
  const aligned = zipalignForAndroid(input);
  const v1Apk = await new V1Signer({ signingKey, schemes: [2, 3], keyName: 'CERT' }).sign(aligned);
  const eocd = findEndOfCentralDirectory(v1Apk);
  if (!eocd) throw new Error('V1-signed APK has no end-of-central-directory record.');
  const { v2Value } = await new V2Signer({ signingKey, digestAlgorithm: 'SHA-256' })
    .sign(v1Apk, eocd.centralDirectoryOffset, eocd.recordOffset);
  const { v3Value } = await new V3Signer({ signingKey, digestAlgorithm: 'SHA-256', minSdkVersion: 24 })
    .sign(v1Apk, eocd.centralDirectoryOffset, eocd.recordOffset);
  const signingBlock = createSigningBlock([
    createV2SignaturePair(v2Value),
    { id: V3_BLOCK_ID, value: v3Value },
  ]);
  const localData = v1Apk.subarray(0, eocd.centralDirectoryOffset);
  const centralDirectory = v1Apk.subarray(eocd.centralDirectoryOffset, eocd.recordOffset);
  const endRecord = Buffer.from(v1Apk.subarray(eocd.recordOffset));
  endRecord.writeUInt32LE(eocd.centralDirectoryOffset + signingBlock.length, 16);
  const signedApk = concatBytes([localData, signingBlock, centralDirectory, endRecord]);
  const schemes = verifyV2V3(Buffer.from(signedApk));
  await writeFile(outputPath, signedApk);
  console.log(`APK aligned and signed: v1, v2, v3 (${signedApk.length} bytes); v2/v3 digests and RSA signatures verified.`);
}

main().catch((error) => {
  console.error(`APK signing failed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
