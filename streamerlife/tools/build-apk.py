#!/usr/bin/env python3
"""Build StreamerLife.apk from the single-file game + the WebView shell APK.

  python3 tools/build-apk.py

Takes ../BashBaqiRacing.apk as a WebView container (AndroidManifest/dex/resources),
swaps in our game HTML as assets/game.html, patches the app label, then signs the
result with a freshly generated key using APK Signature Scheme v1 (JAR) + v2.
No Java / Android SDK needed.
"""
import base64, hashlib, io, os, shutil, struct, sys, zipfile, datetime
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.serialization import pkcs12, pkcs7, Encoding, PrivateFormat, NoEncryption

ROOT = Path(__file__).resolve().parents[1]
DOSDATE = ((2026 - 1980) << 9) | (1 << 5) | 1  # 2026-01-01
SHELL = ROOT.parent / 'BashBaqiRacing.apk'
GAME = ROOT / 'streamer-life.html'
OUT = ROOT / 'StreamerLife.apk'
KEYDIR = ROOT / 'tools' / '.keys'
OLD_LABEL = 'Bash Baqi Racing'
NEW_LABEL = 'Streamer Life 3D'   # must be the same length (binary XML patch)


# ── key ────────────────────────────────────────────────────────────────────
def get_key():
    KEYDIR.mkdir(exist_ok=True)
    kp, cp = KEYDIR / 'key.pem', KEYDIR / 'cert.pem'
    if kp.exists() and cp.exists():
        key = serialization.load_pem_private_key(kp.read_bytes(), None)
        cert = x509.load_pem_x509_certificate(cp.read_bytes())
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Streamer Life'),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Neurio Games')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365 * 30))
            .sign(key, hashes.SHA256()))
    kp.write_bytes(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
    cp.write_bytes(cert.public_bytes(Encoding.PEM))
    return key, cert


SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


def launcher_icon(name):
    """Resize our game icon into the APK launcher icon slots (needs pillow)."""
    try:
        from PIL import Image
    except ImportError:
        return None
    dens = name.split('mipmap-')[1].split('-')[0]
    if dens not in SIZES:
        return None
    im = Image.open(ROOT / 'icons' / 'icon-512.png').convert('RGBA').resize((SIZES[dens],) * 2)
    buf = io.BytesIO(); im.save(buf, 'PNG')
    return buf.getvalue()


# ── 1. assemble the unsigned apk ───────────────────────────────────────────
def assemble(tmp: Path):
    src = zipfile.ZipFile(SHELL)
    html = GAME.read_bytes()
    entries = []  # (name, data, compress)
    for info in src.infolist():
        if info.filename.startswith('META-INF/'):
            continue
        data = src.read(info.filename)
        if info.filename == 'assets/game.html':
            data = html
        if info.filename.startswith('res/mipmap-'):
            data = launcher_icon(info.filename) or data
        if info.filename == 'AndroidManifest.xml':
            old = OLD_LABEL.encode('utf-16-le'); new = NEW_LABEL.encode('utf-16-le')
            assert len(old) == len(new)
            data = data.replace(old, new)
        comp = zipfile.ZIP_STORED if info.filename == 'resources.arsc' else zipfile.ZIP_DEFLATED
        entries.append((info.filename, data, comp))
    src.close()
    return entries


def write_zip(path: Path, entries, manifest_files=None):
    """Writes the zip with 4-byte alignment for STORED entries."""
    out = open(path, 'wb')
    central = []
    for name, data, comp in entries:
        nb = name.encode()
        if comp == zipfile.ZIP_STORED:
            # pad the extra field so the data starts 4-byte aligned
            header = 30 + len(nb)
            pad = (-(out.tell() + header)) % 4
            extra = b'\x00' * pad
        else:
            extra = b''
        offset = out.tell()
        if comp == zipfile.ZIP_DEFLATED:
            import zlib
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            blob = co.compress(data) + co.flush()
        else:
            blob = data
        crc = zipfile.crc32(data) & 0xffffffff
        out.write(struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0, comp, 0, DOSDATE, crc,
                              len(blob), len(data), len(nb), len(extra)))
        out.write(nb); out.write(extra); out.write(blob)
        central.append((nb, comp, crc, len(blob), len(data), len(extra), offset, extra))
    cd_offset = out.tell()
    for nb, comp, crc, csize, usize, elen, offset, extra in central:
        out.write(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0, comp, 0, DOSDATE, crc,
                              csize, usize, len(nb), elen, 0, 0, 0, 0, offset))
        out.write(nb); out.write(extra)
    cd_size = out.tell() - cd_offset
    out.write(struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(central), len(central), cd_size, cd_offset, 0))
    out.close()


# ── 2. v1 (JAR) signature ──────────────────────────────────────────────────
def b64(d): return base64.b64encode(d).decode()


def v1_sign(entries, key, cert):
    manifest = 'Manifest-Version: 1.0\r\nCreated-By: neurio-apk-builder\r\n\r\n'
    sections = []
    for name, data, _ in entries:
        sec = f'Name: {name}\r\nSHA-256-Digest: {b64(hashlib.sha256(data).digest())}\r\n\r\n'
        sections.append(sec)
    manifest_bytes = (manifest + ''.join(sections)).encode()

    sf = ('Signature-Version: 1.0\r\nCreated-By: neurio-apk-builder\r\n'
          f'SHA-256-Digest-Manifest: {b64(hashlib.sha256(manifest_bytes).digest())}\r\n\r\n')
    main_len = len(manifest.encode())
    for (name, _, _), sec in zip(entries, sections):
        sf += f'Name: {name}\r\nSHA-256-Digest: {b64(hashlib.sha256(sec.encode()).digest())}\r\n\r\n'
    sf_bytes = sf.encode()

    sig = (pkcs7.PKCS7SignatureBuilder().set_data(sf_bytes).add_signer(cert, key, hashes.SHA256())
           .sign(Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.NoAttributes,
                                pkcs7.PKCS7Options.Binary]))
    return [('META-INF/MANIFEST.MF', manifest_bytes, zipfile.ZIP_DEFLATED),
            ('META-INF/STREAMER.SF', sf_bytes, zipfile.ZIP_DEFLATED),
            ('META-INF/STREAMER.RSA', sig, zipfile.ZIP_STORED)]


# ── 3. v2 signature (APK Signing Block) ────────────────────────────────────
MAGIC = b'APK Sig Block 42'
CHUNK = 1024 * 1024


def chunked_digest(parts):
    chunks = []
    for blob in parts:
        for i in range(0, len(blob), CHUNK):
            chunks.append(blob[i:i + CHUNK])
    out = hashlib.sha256()
    out.update(b'\x5a' + struct.pack('<I', len(chunks)))
    for c in chunks:
        h = hashlib.sha256()
        h.update(b'\xa5' + struct.pack('<I', len(c)) + c)
        out.update(h.digest())
    return out.digest()


def lp(b):  # length-prefixed
    return struct.pack('<I', len(b)) + b


def v2_sign(path: Path, key, cert):
    data = path.read_bytes()
    eocd_off = data.rfind(b'PK\x05\x06')
    eocd = bytearray(data[eocd_off:])
    cd_off = struct.unpack('<I', eocd[16:20])[0]
    cd_size = struct.unpack('<I', eocd[12:16])[0]
    contents = data[:cd_off]
    cd = data[cd_off:cd_off + cd_size]

    # digest is computed over an EOCD copy whose "offset of central directory"
    # points at the signing block (i.e. the original cd offset)
    e_digest = bytearray(eocd)
    e_digest[16:20] = struct.pack('<I', cd_off)
    digest = chunked_digest([contents, cd, bytes(e_digest)])
    signed_data = (lp(lp(struct.pack('<I', 0x0103) + lp(digest)))        # digests
                   + lp(lp(cert.public_bytes(Encoding.DER)))             # certificates
                   + lp(b''))                                            # attributes
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = (lp(signed_data)
              + lp(lp(struct.pack('<I', 0x0103) + lp(sig)))
              + lp(cert.public_key().public_bytes(Encoding.DER,
                   serialization.PublicFormat.SubjectPublicKeyInfo)))
    v2 = lp(lp(signer))
    pair = struct.pack('<Q', 4 + len(v2)) + struct.pack('<I', 0x7109871a) + v2
    body = pair
    total = 8 + len(body) + 8 + 16                 # pad the block to 4096 bytes
    pad = (-total) % 4096
    if pad:
        if pad < 12: pad += 4096
        body += struct.pack('<Q', pad - 8) + struct.pack('<I', 0x42726577) + b'\x00' * (pad - 12)
    size = len(body) + 8 + 16
    block = struct.pack('<Q', size) + body + struct.pack('<Q', size) + MAGIC

    e_out = bytearray(eocd)                         # real zip EOCD: cd moved by block
    e_out[16:20] = struct.pack('<I', cd_off + len(block))
    path.write_bytes(contents + block + cd + bytes(e_out))


def main():
    if not GAME.exists():
        sys.exit('build streamer-life.html first:  node tools/build-singlefile.mjs')
    if not SHELL.exists():
        sys.exit(f'WebView shell APK not found at {SHELL}')
    key, cert = get_key()
    entries = assemble(ROOT)
    entries = entries + v1_sign(entries, key, cert)
    write_zip(OUT, entries)
    v2_sign(OUT, key, cert)
    print(f'✅ {OUT.name} — {OUT.stat().st_size/1024:.0f} KB (v1 + v2 signed)')


if __name__ == '__main__':
    main()
