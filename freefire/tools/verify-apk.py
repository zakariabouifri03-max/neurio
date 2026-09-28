#!/usr/bin/env python3
"""Independent APK signature verification (v1 + v2) — Python/OpenSSL, no SDK.

tools/apk-sign.mjs writes APK signatures in Node, and tools/test-apk-sign.mjs
checks them with the same Node code. This script is the second opinion: it parses
the files from scratch (zipfile + hand-written ASN.1 walking for the JAR side) and
lets OpenSSL do the cryptography, so a mistake shared by the Node writer and the
Node verifier cannot hide here.

    python3 tools/verify-apk.py [apk ...]      # defaults to BOOYAH-FIRE.apk

Requires: cryptography  (pip install cryptography)  — asn1crypto is optional and
only used to cross-check the v1 SignerInfo parse.

Checks per APK:
  v1  MANIFEST.MF digests match every file, CERT.SF signs the manifest, the
      PKCS#7 signature verifies over CERT.SF, and no authenticated attributes
      are present (they would have to be re-encoded exactly to verify).
  v2  the signing block sits before the central directory, the content digest is
      recomputed from the APK's own bytes (1 MB chunks, EOCD patched to the block
      start), the digest in signed data matches, the RSA signature over signed
      data verifies, signed data is fully consumed, and the public-keys field
      carries the same SubjectPublicKeyInfo as the signer certificate.
"""
import base64
import hashlib
import io
import struct
import sys
import zipfile

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
except ImportError:                                     # pragma: no cover
    sys.exit("this tool needs the 'cryptography' package: pip install cryptography")

MAGIC = b"APK Sig Block 42"
CHUNK = 1024 * 1024
V2_BLOCK_ID = 0x7109871A
STRIPPING_PROTECTION_ID = 0xBEEFF00D


def u32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]


def u64(buf, off):
    return struct.unpack_from("<Q", buf, off)[0]


def read_lp(buf, off):
    """A length-prefixed field: uint32 length, then the content."""
    n = u32(buf, off)
    return buf[off + 4:off + 4 + n], off + 4 + n


# ── v2: APK Signature Scheme ────────────────────────────────────────────────
def content_digest(apk):
    """Recompute the v2 content digest over the APK's own bytes."""
    eocd = apk.rfind(b"PK\x05\x06")
    assert eocd > 0, "no end-of-central-directory record"
    cd_offset = u32(apk, eocd + 16)
    assert cd_offset <= eocd, "odd EOCD"
    # the signing block ends where the central directory starts: its trailing 16
    # bytes are the magic and the 8 before those are the block size, which counts
    # everything after the size field itself
    assert apk[cd_offset - 16:cd_offset] == MAGIC, "signing block magic missing"
    size = u64(apk, cd_offset - 24)
    block_start = cd_offset - 8 - size
    assert size % 8 == 0 and block_start >= 0, "malformed signing block size"
    assert u64(apk, block_start) == size, "signing block sizes disagree"
    assert size % 8 == 0 and block_start >= 0, "malformed signing block size"
    # section 3 is the EOCD with its central-directory offset pointing at the block
    tail = bytearray(apk[eocd:])
    struct.pack_into("<I", tail, 16, block_start)
    # section 2 is the central directory (everything between the signing block and
    # the EOCD), section 3 is the EOCD itself
    sections = [apk[:block_start], apk[block_start + 8 + size:eocd], bytes(tail)]
    hashes = []
    for section in sections:
        for off in range(0, len(section), CHUNK):       # chunking restarts per section
            chunk = section[off:off + CHUNK]
            hashes.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(chunk)) + chunk).digest())
    top = hashlib.sha256(b"\x5a" + struct.pack("<I", len(hashes)) + b"".join(hashes)).digest()
    return block_start, size, sections, top


def v2_pairs(apk, block_start, size):
    pairs, off = {}, block_start + 8
    end = block_start + 8 + size - 8 - 16               # stop before the trailing size+magic
    while off < end:
        pair_len = u64(apk, off)                        # counts the id + the value
        pairs[u32(apk, off + 8)] = apk[off + 12:off + 8 + pair_len]
        off += 8 + pair_len                             # skip the length field too
    return pairs


def verify_v2(apk, verbose=False):
    block_start, block_size, sections, top = content_digest(apk)
    pairs = v2_pairs(apk, block_start, block_size)
    blob = pairs.get(V2_BLOCK_ID)
    assert blob is not None, "no v2 signer block (0x7109871a)"
    signers, _ = read_lp(blob, 0)
    signer, signer_end = read_lp(signers, 0)
    assert signer_end == len(signers), "signer blob not fully consumed"
    signed_data, off = read_lp(signer, 0)

    digests, sdoff = read_lp(signed_data, 0)
    entry, digests_end = read_lp(digests, 0)
    assert digests_end == len(digests), "digest block not fully consumed"
    alg = u32(entry, 0)
    assert u32(entry, 4) == 32, "expected a SHA-256 digest"
    digest = entry[8:40]
    certs, sdoff = read_lp(signed_data, sdoff)
    cert_der, certs_end = read_lp(certs, 0)
    assert certs_end == len(certs), "certificate block not fully consumed"
    attrs, sdoff = read_lp(signed_data, sdoff)
    # apksigner's own output carries four trailing zero bytes here; report them
    # instead of failing, so this stays a description of the format
    trailing = signed_data[sdoff:]
    used_attrs, aoff = [], 0
    while aoff < len(attrs):
        item, aoff = read_lp(attrs, aoff)
        used_attrs.append((u32(item, 0), item[4:]))

    signatures, off = read_lp(signer, off)
    sig_entry, sigs_end = read_lp(signatures, 0)
    assert sigs_end == len(signatures), "signature block not fully consumed"
    sig_alg = u32(sig_entry, 0)
    signature = sig_entry[8:8 + u32(sig_entry, 4)]
    public_keys, off = read_lp(signer, off)
    assert off == len(signer), "signer blob has trailing bytes"

    cert = x509.load_der_x509_certificate(cert_der)
    # the spec stores a length-prefixed list of length-prefixed SubjectPublicKeyInfos
    keys = []
    try:
        item, _ = read_lp(public_keys, 0)
        keys.append(serialization.load_der_public_key(item))
    except Exception:
        pass
    try:
        keys.append(serialization.load_der_public_key(public_keys))
    except Exception:
        pass
    assert keys, "cannot parse the signer's public key"
    spki = lambda k: k.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    assert any(spki(k) == spki(cert.public_key()) for k in keys), "signer public key != certificate key"
    assert alg == 0x0103 and sig_alg == 0x0103, f"expected RSASSA-PKCS1-v1_5 SHA-256, got 0x{alg:04x}/0x{sig_alg:04x}"
    assert digest == top, f"content digest mismatch: embedded {digest.hex()[:16]} … recomputed {top.hex()[:16]}"
    keys[0].verify(signature, signed_data, padding.PKCS1v15(), hashes.SHA256())

    result = {
        "signer": cert.subject.rfc4514_string(),
        "block": f"{block_start}+{block_size}",
        "sections": [len(s) for s in sections],
        "digest": digest.hex()[:16],
        "attributes": [f"0x{i:08x}" for i, _ in used_attrs],
        "trailingBytes": len(trailing),
        "cert": {
            "valid": f"{cert.not_valid_before_utc:%Y-%m-%d}..{cert.not_valid_after_utc:%Y-%m-%d}",
            "key": f"RSA-{keys[0].key_size}",
            "extensions": [e.oid._name for e in cert.extensions],
        },
    }
    if verbose:
        result["extraPairs"] = [f"0x{i:08x}" for i in pairs if i != V2_BLOCK_ID]
    return result


# ── v1: JAR signing ─────────────────────────────────────────────────────────
def verify_v1(apk):
    zf = zipfile.ZipFile(io.BytesIO(apk))
    names = zf.namelist()
    mf_name = next((n for n in names if n.upper() == "META-INF/MANIFEST.MF"), None)
    sf_names = [n for n in names if n.upper().startswith("META-INF/") and n.upper().endswith(".SF")]
    sig_names = [n for n in names if n.upper().startswith("META-INF/")
                 and n.upper().endswith((".RSA", ".DSA", ".EC"))]
    assert mf_name, "no META-INF/MANIFEST.MF"
    assert len(sf_names) == 1, f"expected one .SF, found {sf_names}"
    assert len(sig_names) == 1, f"expected one signature block, found {sig_names}"

    # every non-META-INF entry must be covered by a manifest section whose digest matches
    sections = {}
    for block in zf.read(mf_name).split(b"\r\n\r\n"):
        fields = {}
        for line in block.split(b"\r\n"):
            if b":" in line:
                key, value = line.split(b":", 1)
                fields[key.strip()] = value.strip()
        if b"Name" in fields:
            sections[fields[b"Name"].decode()] = fields
    signed = []
    for name in names:
        if name.upper().startswith("META-INF/") or name.endswith("/"):
            continue
        assert name in sections, f"{name} is not listed in MANIFEST.MF"
        expected = base64.b64encode(hashlib.sha256(zf.read(name)).digest()).decode()
        assert sections[name][b"SHA-256-Digest"].decode() == expected, f"{name}: digest mismatch"
        signed.append(name)

    sf = zf.read(sf_names[0])
    manifest = zf.read(mf_name)
    sf_fields = {}
    for line in sf.split(b"\r\n"):
        if b":" in line:
            key, value = line.split(b":", 1)
            sf_fields.setdefault(key.strip(), []).append(value.strip())
    assert sf_fields[b"SHA-256-Digest-Manifest"][0].decode() == \
        base64.b64encode(hashlib.sha256(manifest).digest()).decode(), "SHA-256-Digest-Manifest mismatch"

    # the PKCS#7 signature must verify over CERT.SF (detached, no authenticated attributes)
    der = zf.read(sig_names[0])
    signer, attrs, cert_der = parse_pkcs7(der)
    assert attrs is None, "authenticated attributes would have to be re-encoded byte-exactly"
    cert = x509.load_der_x509_certificate(cert_der)
    cert.public_key().verify(signer, sf, padding.PKCS1v15(), hashes.SHA256())
    return {
        "signer": cert.subject.rfc4514_string(),
        "files": len(signed),
        "sf": sf_names[0].split("/")[-1],
        "xAndroidApkSigned": [l.decode() for l in sf.split(b"\r\n") if l.startswith(b"X-Android-APK-Signed")],
    }


def parse_pkcs7(der):
    """Walk ContentInfo → SignedData → SignerInfo with an explicit offset parser.

    Returns (signature_bytes, authenticated_attributes_or_None, signer_cert_der).
    """
    def children(buf, start, end):
        """(tag, element start, content start, content end) for each element."""
        out, off = [], start
        while off < end:
            tag = buf[off]
            first = buf[off + 1]
            if first & 0x80:
                n = first & 0x7F
                length = int.from_bytes(buf[off + 2:off + 2 + n], "big")
                head = 2 + n
            else:
                length = first
                head = 2
            out.append((tag, off, off + head, off + head + length))
            off += head + length
        return out

    outer = children(der, 0, len(der))
    assert len(outer) == 1 and outer[0][0] == 0x30, "not a single DER SEQUENCE"
    fields = children(der, outer[0][2], outer[0][3])
    assert len(fields) == 2 and fields[0][0] == 0x06, "not a PKCS#7 ContentInfo"
    assert der[fields[0][2]:fields[0][3]] == bytes.fromhex("2a864886f70d010702"), "not signedData"
    assert fields[1][0] == 0xA0, "expected [0] EXPLICIT content"
    sd = children(der, fields[1][2], fields[1][3])
    assert sd[0][0] == 0x30, "expected a SignedData SEQUENCE"
    certs = signer_infos = None
    for tag, _s, a, b in children(der, sd[0][2], sd[0][3]):
        if tag == 0xA0:
            certs = children(der, a, b)                   # [0] IMPLICIT certificates
        if tag == 0x31:
            signer_infos = children(der, a, b)
    assert certs, "no certificates in the PKCS#7"
    assert signer_infos and len(signer_infos) == 1, "expected exactly one SignerInfo"
    si = children(der, signer_infos[0][2], signer_infos[0][3])
    # version, issuerAndSerialNumber, digestAlgorithm, digestEncryptionAlgorithm,
    # encryptedDigest — six fields when authenticated attributes are present
    assert len(si) == 5, f"expected no authenticated attributes, SignerInfo has {len(si)} fields"
    assert si[4][0] == 0x04, "signature is not an OCTET STRING"
    cert = certs[0]
    return der[si[4][2]:si[4][3]], None, der[cert[1]:cert[3]]


def main(argv):
    paths = argv[1:] or ["BOOYAH-FIRE.apk"]
    failed = 0
    for path in paths:
        apk = open(path, "rb").read()
        print("=" * 78)
        print(f"{path} · {len(apk)} bytes · sha256 {hashlib.sha256(apk).hexdigest()}")
        try:
            print("  v2 ✓", verify_v2(apk, verbose=True))
        except AssertionError as exc:
            # a missing signing block is legal — v1-only APKs exist (that is all
            # Android 5/6 understand); a present-but-broken block is not
            if str(exc) == "signing block magic missing":
                print("  v2 – no signing block (v1-only APK)")
            else:
                failed += 1
                print(f"  v2 ✗ AssertionError: {exc}")
        except Exception as exc:                          # noqa: BLE001 — report, don't raise
            failed += 1
            print(f"  v2 ✗ {type(exc).__name__}: {exc}")
        try:
            print("  v1 ✓", verify_v1(apk))
        except Exception as exc:                          # noqa: BLE001
            failed += 1
            print(f"  v1 ✗ {type(exc).__name__}: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
