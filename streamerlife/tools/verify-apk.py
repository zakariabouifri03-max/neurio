#!/usr/bin/env python3
"""Verifies the v1 + v2 signatures of the built APK (no Java needed)."""
import struct, hashlib, sys, zipfile, base64
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

p = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'StreamerLife.apk')
d = p.read_bytes()
i = d.rfind(b'APK Sig Block 42')
size2 = struct.unpack('<Q', d[i - 8:i])[0]; start = i + 16 - size2 - 8
body = d[start + 8:i - 8]
off = 0; v2 = None
while off < len(body):
    ln = struct.unpack('<Q', body[off:off + 8])[0]
    if struct.unpack('<I', body[off + 8:off + 12])[0] == 0x7109871a: v2 = body[off + 12:off + 8 + ln]
    off += 8 + ln
lp = lambda b, o: (b[o + 4:o + 4 + struct.unpack('<I', b[o:o + 4])[0]], o + 4 + struct.unpack('<I', b[o:o + 4])[0])
signers, _ = lp(v2, 0); signer, _ = lp(signers, 0)
signed_data, o = lp(signer, 0); sigs, o = lp(signer, o); pub, o = lp(signer, o)
digests, o2 = lp(signed_data, 0); dg, _ = lp(digests, 0); digest, _ = lp(dg, 4)
sg, _ = lp(sigs, 0); sig, _ = lp(sg, 4)

eocd = d.rfind(b'PK\x05\x06')
cd_off = struct.unpack('<I', d[eocd + 16:eocd + 20])[0]; cd_size = struct.unpack('<I', d[eocd + 12:eocd + 16])[0]
e = bytearray(d[eocd:]); e[16:20] = struct.pack('<I', start)
CH = 1 << 20; chunks = []
for part in (d[:start], d[cd_off:cd_off + cd_size], bytes(e)):
    chunks += [part[k:k + CH] for k in range(0, len(part), CH)]
h = hashlib.sha256(); h.update(b'\x5a' + struct.pack('<I', len(chunks)))
for c in chunks:
    x = hashlib.sha256(); x.update(b'\xa5' + struct.pack('<I', len(c)) + c); h.update(x.digest())
print('v2 digest  :', 'OK' if h.digest() == digest else 'MISMATCH')
serialization.load_der_public_key(pub).verify(sig, signed_data, padding.PKCS1v15(), hashes.SHA256())
print('v2 signature: OK')

z = zipfile.ZipFile(p)
man = z.read('META-INF/MANIFEST.MF').decode()
bad = 0
for n in z.namelist():
    if n.startswith('META-INF/'): continue
    want = base64.b64encode(hashlib.sha256(z.read(n)).digest()).decode()
    if f'Name: {n}\r\nSHA-256-Digest: {want}' not in man: bad += 1; print('  v1 mismatch:', n)
print('v1 digests :', 'OK' if not bad else f'{bad} BAD')
