#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# Bash Baqi Racing — APK builder (pure Python, no Android SDK needed)
#
# Takes the original WebView-wrapper APK, swaps in the freshly built
# bash-baqi-racing.html (assets/game.html), bumps the version, re-zips with
# proper 4-byte alignment and signs it with **v1 (JAR) + v2 (APK Signature
# Scheme)** — v2 is REQUIRED because the manifest targets SDK 30, and
# Android 11+ refuses to install v1-only APKs that target ≥ 30.
#
# Usage:  python3 tools/build-apk.py
# Needs:  pip install cryptography   (+ apksigtool for verification)
# ─────────────────────────────────────────────────────────────────────────────
import base64
import datetime
import hashlib
import os
import struct
import sys
import zipfile
import zlib

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_APK = os.path.join(ROOT, "BashBaqiRacing.apk")
GAME_HTML = os.path.join(ROOT, "bash-baqi-racing.html")
OUT_APK = os.path.join(ROOT, "BashBaqiRacing-4K60.apk")
KEY_DIR = os.path.join(ROOT, "tools", "signing")
KEY_PEM = os.path.join(KEY_DIR, "bashbaqi-key.pem")
CERT_PEM = os.path.join(KEY_DIR, "bashbaqi-cert.pem")

SIGNER_NAME = "BASHBAQI"
V2_BLOCK_ID = 0x7109871A
V2_MAGIC = b"APK Sig Block 42"
SIG_ALG_RSA_PKCS1_SHA256 = 0x0103
CHUNK = 1024 * 1024


# ── 1. signing key / certificate ─────────────────────────────────────────────
def load_or_create_key():
    os.makedirs(KEY_DIR, exist_ok=True)
    if os.path.exists(KEY_PEM) and os.path.exists(CERT_PEM):
        key = serialization.load_pem_private_key(open(KEY_PEM, "rb").read(), password=None)
        cert = x509.load_pem_x509_certificate(open(CERT_PEM, "rb").read())
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Bash Baqi Racing"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "BashBaqi"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "MA"),
    ])
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=10000))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    open(KEY_PEM, "wb").write(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    open(CERT_PEM, "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    print(f"[key] generated new signing key → {os.path.relpath(KEY_PEM, ROOT)}")
    return key, cert


# ── 2. binary manifest patching (versionCode / versionName) ──────────────────
def parse_string_pool(man):
    str_count, style_count, flags, str_off, _ = struct.unpack_from("<IIIII", man, 16)
    offsets = struct.unpack_from(f"<{str_count}I", man, 36)
    base = 8 + str_off
    utf8 = bool(flags & (1 << 8))
    strings = []
    for off in offsets:
        p = base + off
        if utf8:
            n = man[p]; p += 1
            if n & 0x80: p += 1
            n2 = man[p]; p += 1
            if n2 & 0x80:
                n2 = ((n2 & 0x7F) << 8) | man[p]; p += 1
            strings.append(man[p:p + n2].decode("utf-8"))
        else:
            n, = struct.unpack_from("<H", man, p)
            strings.append(man[p + 2:p + 2 + n * 2].decode("utf-16-le"))
    return strings, offsets, base, utf8


def walk_chunks(man):
    sp_size = struct.unpack_from("<I", man, 12)[0]
    p = 8 + sp_size
    while p < len(man):
        t, h, s = struct.unpack_from("<HHI", man, p)
        yield p, t, h, s
        p += s


def patch_manifest(man):
    """versionCode 1→2 and versionName '1.0'→'1.1' (same-length, byte-safe)."""
    man = bytearray(man)
    strings, offsets, base, utf8 = parse_string_pool(man)
    # versionName: patch the string-pool entry in place (same byte length)
    vn_idx = strings.index("1.0")
    p = base + offsets[vn_idx]
    if utf8:
        n = man[p]; q = p + 1
        if n & 0x80: q += 1
        n2 = man[q]; q += 1
        if n2 & 0x80: q += 1
        assert man[q:q + 3] == b"1.0"
        man[q + 2] = ord("1")
    else:
        n, = struct.unpack_from("<H", man, p)
        assert n == 3
        txt = man[p + 2:p + 8]
        assert txt == "1.0".encode("utf-16-le")
        man[p + 2:p + 8] = "1.1".encode("utf-16-le")
    # versionCode: find the int attribute inside the <manifest> start tag
    patched = False
    for pos, t, h, s in walk_chunks(man):
        if t != 0x0102:
            continue
        ns, name_i, attr_start, attr_size, attr_count = struct.unpack_from("<IIHHH", man, pos + 16)
        if strings[name_i] != "manifest":
            continue
        ap = pos + h + attr_start
        for i in range(attr_count):
            q = ap + i * attr_size
            a_name, = struct.unpack_from("<I", man, q + 4)
            tv_size, tv_res0, tv_dtype, tv_data = struct.unpack_from("<HBBI", man, q + 12)
            if strings[a_name] == "versionCode" and tv_dtype == 0x10:
                assert tv_data == 1, f"unexpected versionCode {tv_data}"
                struct.pack_into("<I", man, q + 16, 2)
                patched = True
    assert patched, "versionCode attribute not found"
    print("[manifest] versionCode 1→2 · versionName 1.0→1.1")
    return bytes(man)


# ── 3. aligned ZIP writer ─────────────────────────────────────────────────────
def build_zip(entries):
    """entries: [(name, data, method)] — STORED entries get 4-byte aligned."""
    body = bytearray()
    central = bytearray()
    dos_time, dos_date = 0x6000, 0x5A26  # fixed timestamp

    for name, data, method in entries:
        nb = name.encode("ascii")
        crc = zlib.crc32(data) & 0xFFFFFFFF
        if method == 0:
            comp = data
        else:
            comp = zlib.compress(data, 9)[2:-4]  # raw deflate
        offset = len(body)
        # padding so STORED data starts on a 4-byte boundary (zipalign rule)
        fixed = 30 + len(nb)
        pad = (4 - (offset + fixed) % 4) % 4 if method == 0 else 0
        body += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, method,
                            dos_time, dos_date, crc, len(comp), len(data),
                            len(nb), pad)
        body += nb + b"\x00" * pad + comp
        central += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 0, method,
                               dos_time, dos_date, crc, len(comp), len(data),
                               len(nb), 0, 0, 0, 0, 0, offset)
        central += nb

    cd_offset = len(body)
    cd = bytes(central)
    body += cd
    body += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries),
                        len(cd), cd_offset, 0)
    return bytes(body), cd_offset


# ── 4. v1 (JAR) signing ───────────────────────────────────────────────────────
def v1_sign(entries, key, cert):
    """Returns the three META-INF entries."""
    def dig(b):
        return base64.b64encode(hashlib.sha256(b).digest()).decode()

    mf = ["Manifest-Version: 1.0", "Created-By: BashBaqi APK Builder (v1.1 turbo)", ""]
    sf = ["Signature-Version: 1.0", "Created-By: BashBaqi APK Builder (v1.1 turbo)"]
    for name, data, _m in entries:
        mf += [f"Name: {name}", f"SHA-256-Digest: {dig(data)}", ""]
    mf_bytes = ("\r\n".join(mf) + "\r\n").encode()
    # SF digests cover the exact per-entry section bytes as written in MANIFEST.MF
    sf += [f"SHA-256-Digest-Manifest: {dig(mf_bytes)}", ""]
    for name, data, _m in entries:
        section = f"Name: {name}\r\nSHA-256-Digest: {dig(data)}\r\n\r\n"
        sf += [f"Name: {name}", f"SHA-256-Digest: {dig(section.encode())}", ""]
    sf_bytes = ("\r\n".join(sf) + "\r\n").encode()

    rsa_der = (pkcs7.PKCS7SignatureBuilder()
               .set_data(sf_bytes)
               .add_signer(cert, key, hashes.SHA256())
               .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary]))
    return [
        ("META-INF/MANIFEST.MF", mf_bytes, 8),
        (f"META-INF/{SIGNER_NAME}.SF", sf_bytes, 8),
        (f"META-INF/{SIGNER_NAME}.RSA", rsa_der, 8),
    ]


# ── 5. v2 (APK Signature Scheme) ──────────────────────────────────────────────
def lp(b):
    return struct.pack("<I", len(b)) + b


def chunk_digests(stream):
    out = []
    for i in range(0, len(stream), CHUNK):
        c = stream[i:i + CHUNK]
        out.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    return out


def v2_top_digest(sections):
    """One digest per signature algorithm:
    SHA256(0x5a + u32(chunk_count) + concat(chunk_digests)).
    Each section (entries / central directory / EOCD) is chunked into 1 MB
    pieces INDEPENDENTLY — chunk boundaries never cross a section border."""
    cds = [d for s in sections for d in chunk_digests(s)]
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(cds)) + b"".join(cds)).digest()


def v2_sign(apk, cd_offset, key, cert):
    """Insert the APK Signing Block between the ZIP entries and the Central
    Directory. Layout (matches apksigner / apksigcopier):
        entries | signing block | central directory | EOCD

    * on-disk EOCD CD-offset field  → start of the (new) Central Directory
      (i.e. just past the signing block)
    * v2 digest over the EOCD section uses the CD-offset field set to the
      signing-block offset instead (that's how Android re-verifies it)
    * ONE digest per signature algorithm:
      SHA256(0x5a + u32(chunk_count) + concat(chunk_digests))."""
    assert apk.index(b"PK\x01\x02", cd_offset) == cd_offset
    eocd_pos = apk.rfind(b"PK\x05\x06")
    assert eocd_pos > cd_offset
    entries_blob, central_dir = apk[:cd_offset], apk[cd_offset:eocd_pos]
    eocd_orig = bytearray(apk[eocd_pos:])
    assert struct.unpack_from("<I", eocd_orig, 16)[0] == cd_offset

    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pubkey_der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    sb_offset = cd_offset  # block is placed exactly where the CD used to start

    # ── digest (over entries + CD + EOCD-with-block-offset) ──
    eocd_for_digest = bytearray(eocd_orig)
    struct.pack_into("<I", eocd_for_digest, 16, sb_offset)
    top = v2_top_digest((entries_blob, central_dir, bytes(eocd_for_digest)))
    digests = struct.pack("<III", 40, SIG_ALG_RSA_PKCS1_SHA256, 32) + top

    # ── block size is fixed once sizes are known (RSA-2048 sig = 256 B) ──
    digests_len = len(digests)                      # 44 for a single algorithm
    signed_data_len = (4 + digests_len) + (4 + (4 + len(cert_der))) + 4
    sig_entry_len = 4 + (4 + (4 + 256))             # lp(alg-u32 + lp(sig))
    signer_len = (4 + signed_data_len) + (4 + sig_entry_len) + (4 + len(pubkey_der))
    block_len = 8 + (8 + 4 + (4 + (4 + signer_len))) + 8 + 16

    # ── signed data + signature ──
    signed_data = lp(digests) + lp(lp(cert_der)) + lp(b"")
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    assert len(sig) == 256
    signature_entry = lp(struct.pack("<I", SIG_ALG_RSA_PKCS1_SHA256) + lp(sig))
    signer = lp(signed_data) + lp(signature_entry) + lp(pubkey_der)
    value = lp(lp(signer))                          # lp(sequence-of-signers)

    pair = struct.pack("<QI", 4 + len(value), V2_BLOCK_ID) + value
    block_sz = len(pair) + 8 + 16
    block = struct.pack("<Q", block_sz) + pair + struct.pack("<Q", block_sz) + V2_MAGIC
    assert len(block) == block_len, (len(block), block_len)

    # ── on-disk EOCD points past the block, at the new CD start ──
    eocd_for_file = bytearray(eocd_orig)
    struct.pack_into("<I", eocd_for_file, 16, cd_offset + block_len)

    return entries_blob + block + central_dir + bytes(eocd_for_file)


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(GAME_HTML):
        sys.exit("bash-baqi-racing.html missing — run `npm run build:html` first")
    key, cert = load_or_create_key()

    base = zipfile.ZipFile(BASE_APK)
    html = open(GAME_HTML, "rb").read()
    print(f"[game] assets/game.html ← bash-baqi-racing.html ({len(html)/1024:.0f} KB)")

    entries = []
    for info in base.infolist():
        if info.filename.startswith("META-INF/"):
            continue
        data = base.read(info.filename)
        method = 0 if info.compress_type == zipfile.ZIP_STORED else 8
        if info.filename == "AndroidManifest.xml":
            data = patch_manifest(data)
        elif info.filename == "assets/game.html":
            data = html
        entries.append((info.filename, data, method))

    entries += v1_sign(entries, key, cert)
    print(f"[v1] signed ({SIGNER_NAME}.SF/.RSA + MANIFEST.MF)")

    apk, cd_offset = build_zip(entries)
    # sanity: the pre-block zip must be a readable, CRC-valid archive
    import io
    z = zipfile.ZipFile(io.BytesIO(apk))
    bad = z.testzip()
    assert bad is None, f"corrupt zip entry {bad}"
    # zipalign rule: STORED entries' data must start on a 4-byte boundary
    for info in z.infolist():
        if info.compress_type == zipfile.ZIP_STORED:
            (sig, _v, _f, _m, _t, _d, _c, _cs, _us, nlen, elen) = struct.unpack_from(
                "<IHHHHHIIIHH", apk, info.header_offset)
            assert sig == 0x04034B50
            data_off = info.header_offset + 30 + nlen + elen
            assert data_off % 4 == 0, f"unaligned STORED entry {info.filename}"
    print(f"[zip] {len(entries)} entries, CD at {cd_offset}, archive valid + aligned")

    final = v2_sign(apk, cd_offset, key, cert)
    open(OUT_APK, "wb").write(final)

    # self-verify the v2 block (digests + RSA signature)
    _self_check_v2(final)

    size = os.path.getsize(OUT_APK)
    print(f"\n✅ {os.path.relpath(OUT_APK, ROOT)}  ({size/1024:.0f} KB)")
    print("   signature: v1 (JAR) + v2 (APK Signature Scheme) — installs on all Android 5.0+")
    print("   ⚠️  new signing key → uninstall any older Bash Baqi Racing build first")


def _self_check_v2(final):
    eocd = final.rfind(b"PK\x05\x06")
    # EOCD's CD-offset field points at the Central Directory; the signing
    # block ends immediately before it (magic at cd_start - 16).
    cd_start = struct.unpack_from("<I", final, eocd + 16)[0]
    assert final[cd_start - 16:cd_start] == V2_MAGIC, "signing block magic missing"
    block_sz, = struct.unpack_from("<Q", final, cd_start - 24)
    blk_start = cd_start - block_sz - 8
    pair_len, = struct.unpack_from("<Q", final, blk_start + 8)
    pair_id, = struct.unpack_from("<I", final, blk_start + 16)
    assert pair_id == V2_BLOCK_ID

    def rd(buf, off):
        n, = struct.unpack_from("<I", buf, off)
        return buf[off + 4:off + 4 + n], off + 4 + n

    # pair layout: (pair_len u64)(id u32)(value) → value starts at blk_start+20
    value = final[blk_start + 20:blk_start + 16 + pair_len]
    signers_seq, _ = rd(value, 0)     # lp(sequence of signers)
    signer, _ = rd(signers_seq, 0)    # one signer
    sd, q = rd(signer, 0)             # signed data
    digests_blob, q2 = rd(sd, 0)
    certs_blob, q3 = rd(sd, q2)
    _attrs, _q4 = rd(sd, q3)
    sigs_blob, q = rd(signer, q)
    _pubkey, _q = rd(signer, q)

    # recompute the digest exactly like Android's verifier: the three sections
    # (entries, central directory, EOCD-with-CD-offset:=block-offset) chunked
    # into 1 MB pieces → per-chunk digests → one top-level digest per algorithm
    eocd_rec = bytearray(final[eocd:])
    struct.pack_into("<I", eocd_rec, 16, blk_start)
    top = v2_top_digest((final[:blk_start], final[cd_start:eocd], bytes(eocd_rec)))
    exp = struct.pack("<III", 40, SIG_ALG_RSA_PKCS1_SHA256, 32) + top
    assert digests_blob == exp, "v2 digest mismatch"

    sig_entry, _ = rd(sigs_blob, 0)
    alg, = struct.unpack_from("<I", sig_entry, 0)
    assert alg == SIG_ALG_RSA_PKCS1_SHA256
    sig_bytes, _ = rd(sig_entry, 4)
    cert_der, _ = rd(certs_blob, 0)
    cert = x509.load_der_x509_certificate(cert_der)
    cert.public_key().verify(sig_bytes, sd, padding.PKCS1v15(), hashes.SHA256())
    print("[v2] self-check OK — top-level digest matches, RSA-PKCS1-SHA256 signature valid")


if __name__ == "__main__":
    main()
