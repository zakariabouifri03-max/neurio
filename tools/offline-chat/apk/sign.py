#!/usr/bin/env python3
"""
APK signing without the Android SDK: JAR (v1) + APK Signature Scheme v2 (v2),
written from the public specs with `openssl` doing the RSA math.

  make_key()   → self-signed RSA key + certificate (cached under .keys/)
  sign_v1()    → META-INF/MANIFEST.MF, .SF, .RSA (PKCS#7)
  sign_v2()    → APK Signing Block with content digests
  verify_v1()  → re-checks entry digests, manifest digest and PKCS#7
  verify_v2()  → re-computes the digests and verifies the signature, like the platform

Why hand-rolled: Google's `apksigner` needs a JDK and this repo must stay
dependency-free (no Gradle, no SDK, no internet).
"""
import base64
import hashlib
import os
import struct
import subprocess
import tempfile
import zipfile

CHUNK = 1024 * 1024                       # v2 hashes content in 1 MB chunks
SIG_ALG = 0x0103                          # RSASSA-PKCS1-v1_5 with SHA-256
APK_SIG_BLOCK_MAGIC = b'APK Sig Block 42'
V2_BLOCK_ID = 0x7109871a
VERITY_PADDING_ID = 0x42726577            # the id apksigner uses for padding
SIG_FILE_ALIAS = 'NURIO'


def _run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True)


def _tmp(blob=None, suffix=''):
    f = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    if blob is not None:
        f.write(blob)
    f.close()
    return f.name


# ─────────────────────────────── keys ───────────────────────────────
def make_key(key_dir, cn='Nurio Tawasol', days=10950, force=False):
    """Self-signed RSA-2048 key + certificate. Returns (key_pem, cert_pem, cert_der)."""
    os.makedirs(key_dir, exist_ok=True)
    key_path = os.path.join(key_dir, 'key.pem')
    crt_path = os.path.join(key_dir, 'cert.pem')
    if force or not (os.path.exists(key_path) and os.path.exists(crt_path)):
        _run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
              '-keyout', key_path, '-out', crt_path, '-days', str(days),
              '-subj', f'/CN={cn}/O=Nurio/O=Offline/C=MA',
              '-addext', 'keyUsage=critical,digitalSignature',
              '-addext', 'extendedKeyUsage=codeSigning'])
    der = _tmp(suffix='.der')
    _run(['openssl', 'x509', '-in', crt_path, '-outform', 'DER', '-out', der])
    cert_der = open(der, 'rb').read()
    os.unlink(der)
    return open(key_path, 'rb').read(), open(crt_path, 'rb').read(), cert_der


def public_key_der(cert_der):
    """SubjectPublicKeyInfo (DER) of a certificate — what the v2 block carries."""
    src, pem, out = _tmp(cert_der, '.der'), _tmp(None, '.pem'), _tmp(None, '.der')
    try:
        _run(['openssl', 'x509', '-inform', 'DER', '-in', src, '-noout', '-pubkey', '-out', pem])
        _run(['openssl', 'pkey', '-pubin', '-in', pem, '-outform', 'DER', '-out', out])
        return open(out, 'rb').read()
    finally:
        for f in (src, pem, out):
            os.unlink(f)


def rsa_sign(data, key_pem):
    data_path, key_path, out = _tmp(data), _tmp(key_pem), _tmp(None, '.sig')
    try:
        _run(['openssl', 'dgst', '-sha256', '-sign', key_path, '-out', out, data_path])
        return open(out, 'rb').read()
    finally:
        for p in (data_path, key_path, out):
            os.unlink(p)


def rsa_verify(data, signature, cert_der):
    """Verify a SHA-256 / PKCS#1 v1.5 signature with the certificate's public key."""
    data_path, sig_path, crt_path, pub_path = _tmp(data), _tmp(signature, '.sig'), _tmp(cert_der, '.der'), _tmp(None, '.pem')
    try:
        _run(['openssl', 'x509', '-inform', 'DER', '-in', crt_path, '-noout', '-pubkey', '-out', pub_path])
        r = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', pub_path,
                            '-signature', sig_path, data_path], capture_output=True)
        return r.returncode == 0
    finally:
        for p in (data_path, sig_path, crt_path, pub_path):
            os.unlink(p)


# ─────────────────────────────── v1 (JAR) ───────────────────────────────
def _entry_digests(apk_path):
    out = []
    with zipfile.ZipFile(apk_path) as z:
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            if info.filename.upper().startswith('META-INF/') or info.is_dir():
                continue
            out.append((info.filename, hashlib.sha256(z.read(info.filename)).digest()))
    return out


def sign_v1(apk_path, key_pem, cert_der, out_path):
    """Write a copy of the APK with the JAR signature files added."""
    digests = _entry_digests(apk_path)
    manifest = ['Manifest-Version: 1.0', 'Created-By: nurio-offline-chat', '']
    for name, digest in digests:
        manifest += ['Name: ' + name, 'SHA-256-Digest: ' + base64.b64encode(digest).decode(), '']
    manifest_mf = '\r\n'.join(manifest).encode('utf-8')

    sf = ['Signature-Version: 1.0', 'Created-By: nurio-offline-chat',
          'SHA-256-Digest-Manifest: ' + base64.b64encode(hashlib.sha256(manifest_mf).digest()).decode(),
          'X-Android-APK-Signed: 2', '']
    sf_bytes = ('\r\n'.join(sf)).encode('utf-8')

    # PKCS#7 (no signed attributes) over the .SF file
    sf_path, key_path, crt_path, rsa_out = _tmp(sf_bytes, '.sf'), _tmp(key_pem, '.key'), _tmp(None, '.pem'), _tmp(None, '.rsa')
    der = _tmp(cert_der, '.der')
    try:
        _run(['openssl', 'x509', '-inform', 'DER', '-in', der, '-out', crt_path])
        _run(['openssl', 'smime', '-sign', '-binary', '-noattr', '-md', 'sha256',
              '-in', sf_path, '-signer', crt_path, '-inkey', key_path, '-outform', 'DER', '-out', rsa_out])
        rsa_bytes = open(rsa_out, 'rb').read()
    finally:
        for p in (sf_path, key_path, crt_path, rsa_out, der):
            os.unlink(p)

    with zipfile.ZipFile(apk_path) as zin:
        items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    skip = ('MANIFEST.MF', 'NURIO.SF', 'NURIO.RSA', 'NURIO.DSA', 'NURIO.EC')
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info, data in items:
            if info.filename.startswith('META-INF/') and info.filename.split('/')[-1] in skip:
                continue                                    # drop the shell's old signature
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            zout.writestr(zi, data)
        zout.writestr('META-INF/MANIFEST.MF', manifest_mf)
        zout.writestr(f'META-INF/{SIG_FILE_ALIAS}.SF', sf_bytes)
        zout.writestr(f'META-INF/{SIG_FILE_ALIAS}.RSA', rsa_bytes)
    return out_path


def verify_v1(apk_path):
    with zipfile.ZipFile(apk_path) as z:
        names = z.namelist()
        pick = lambda ext: next((n for n in names if n.upper().startswith('META-INF/') and n.upper().endswith(ext)), None)
        mf, sf, rsa = pick('.MF'), pick('.SF'), pick(('.RSA', '.DSA', '.EC'))
        if not (mf and sf and rsa):
            return False, 'missing META-INF/{MANIFEST.MF,*.SF,*.RSA}'
        mf_bytes, sf_bytes, rsa_bytes = z.read(mf), z.read(sf), z.read(rsa)
        entries = {n: z.read(n) for n in names if not n.upper().startswith('META-INF/') and not n.endswith('/')}

    digests = {}
    for block in mf_bytes.decode('utf-8').split('\r\n\r\n'):
        if 'Name: ' in block and 'SHA-256-Digest: ' in block:
            digests[block.split('Name: ')[1].split('\r\n')[0]] = block.split('SHA-256-Digest: ')[1].split('\r\n')[0]
    for name, data in entries.items():
        if name not in digests:
            return False, f'entry not covered by MANIFEST.MF: {name}'
        if base64.b64encode(hashlib.sha256(data).digest()).decode() != digests[name]:
            return False, f'digest mismatch: {name}'
    declared = [l for l in sf_bytes.decode('utf-8').split('\r\n') if l.startswith('SHA-256-Digest-Manifest:')]
    if not declared or declared[0].split(': ')[1] != base64.b64encode(hashlib.sha256(mf_bytes).digest()).decode():
        return False, 'SHA-256-Digest-Manifest mismatch'

    sf_path, rsa_path = _tmp(sf_bytes, '.sf'), _tmp(rsa_bytes, '.rsa')
    try:
        r = subprocess.run(['openssl', 'smime', '-verify', '-inform', 'DER', '-in', rsa_path,
                            '-content', sf_path, '-noverify', '-out', os.devnull], capture_output=True)
        if r.returncode != 0:
            return False, 'PKCS#7 signature invalid'
    finally:
        for p in (sf_path, rsa_path):
            os.unlink(p)
    return True, 'ok'


# ─────────────────── v2 (APK Signature Scheme v2) ───────────────────
def _chunked_digest(sections):
    """APK Signature Scheme v2 content digest over sections 1/3/4.

    Each section gets chunked on its own into 1 MB pieces, so a chunk never spans
    two sections; the per-chunk digests are then folded into one top-level digest.
    """
    chunks = []
    for section in sections:
        chunks += [section[i:i + CHUNK] for i in range(0, len(section), CHUNK)] or [b'']
    inner = b''.join(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest() for c in chunks)
    return hashlib.sha256(b'\x5a' + struct.pack('<I', len(chunks)) + inner).digest()


def _lp(data):
    return struct.pack('<I', len(data)) + data


def _seq(elements):
    """apksig's encodeAsSequenceOfLengthPrefixedElements()."""
    return b''.join(_lp(e) for e in elements)


def _pair(block_id, value):
    return struct.pack('<Q', 4 + len(value)) + struct.pack('<I', block_id) + value


def _eocd_parts(apk):
    eocd = apk.rfind(b'PK\x05\x06')
    if eocd < 0:
        raise ValueError('not a zip file (no EOCD)')
    cd_size, cd_off = struct.unpack_from('<II', apk, eocd + 12)
    if 0xFFFFFFFF in (cd_size, cd_off):
        raise ValueError('zip64 APKs are not supported by this signer')
    return eocd, cd_size, cd_off


def _read_lp(buf, off):
    n, = struct.unpack_from('<I', buf, off)
    if n > len(buf) - off - 4:
        raise ValueError('truncated length-prefixed field')
    return buf[off + 4:off + 4 + n], off + 4 + n


def _html_free(path):        # pragma: no cover - never called, keeps linters quiet
    return path


def sign_v2(apk_bytes, key_pem, cert_der, block_size=4096):
    """Insert an APK Signing Block carrying a v2 signature; returns the new bytes.

    Follows apksig's V2SchemeSigner layout exactly:

        value     = lp(seq([ signer ]))
        signer    = seq([ signed_data, signatures, public_key ])
        sign data = seq([ digests, certificates, additional_attributes, <empty> ])
        digests   = seq([ uint32 alg || lp(digest) ])
        signatures= seq([ uint32 alg || lp(signature) ])

    `additional_attributes` are only written when the APK is *also* v3 signed
    (they carry the stripping-protection attribute), so a v2-only APK leaves them
    empty - the trailing empty element is what apksigner puts there too.
    """
    eocd, cd_size, cd_off = _eocd_parts(apk_bytes)
    head, cd, eocd_bytes = apk_bytes[:cd_off], apk_bytes[cd_off:eocd], bytearray(apk_bytes[eocd:])

    # The digest is taken over the APK with the central directory sitting where the
    # signing block is about to go, so the block size never changes the digest.
    eocd_for_digest = bytearray(eocd_bytes)
    struct.pack_into('<I', eocd_for_digest, 16, cd_off)
    digest = _chunked_digest([head, cd, bytes(eocd_for_digest)])

    pubkey_der = public_key_der(cert_der)
    signed_data = _seq([
        _seq([struct.pack('<I', SIG_ALG) + _lp(digest)]),
        _seq([cert_der]),
        b'',
        b'',
    ])
    signature = rsa_sign(signed_data, key_pem)
    signatures = _seq([struct.pack('<I', SIG_ALG) + _lp(signature)])
    signer = _seq([signed_data, signatures, pubkey_der])
    # the block value is a "length-prefixed sequence of length-prefixed signer":
    # prefix -> [ signer prefix -> signer ] , exactly like apksigner writes it
    payload = _pair(V2_BLOCK_ID, _lp(_seq([signer])))

    # apksigner pads the block out to a whole number of 4 KiB pages with a verity
    # padding pair, which keeps the central directory page aligned.
    base = 8 + len(payload) + 8 + 16
    target = max(block_size, -(-base // block_size) * block_size)
    if target - base < 12:
        target += block_size
    payload += _pair(VERITY_PADDING_ID, b'\x00' * (target - base - 12))

    total = 8 + len(payload) + 8 + 16
    size = total - 8                                     # the two size fields exclude themselves
    assert total == target, (total, target)
    block = struct.pack('<Q', size) + payload + struct.pack('<Q', size) + APK_SIG_BLOCK_MAGIC
    struct.pack_into('<I', eocd_bytes, 16, cd_off + len(block))     # CD now lives past the block
    return head + block + cd + bytes(eocd_bytes)


def parse_signing_block(apk):
    """Return (block_start, {id: value}) for the APK Signing Block."""
    eocd, cd_size, cd_off = _eocd_parts(apk)
    if apk[cd_off - 16:cd_off] != APK_SIG_BLOCK_MAGIC:
        raise ValueError('no APK Signing Block')
    tail, = struct.unpack_from('<Q', apk, cd_off - 24)      # trailing size field
    start = cd_off - 8 - tail                              # 8 = the leading size field
    if start < 0:
        raise ValueError('malformed signing block')
    lead, = struct.unpack_from('<Q', apk, start)
    if lead != tail or apk[cd_off - 16:cd_off] != APK_SIG_BLOCK_MAGIC:
        raise ValueError('signing block sizes disagree')
    payload = apk[start + 8:cd_off - 24]
    fields, off = {}, 0
    while off < len(payload):
        ln, = struct.unpack_from('<Q', payload, off)
        bid, = struct.unpack_from('<I', payload, off + 8)
        if 8 + ln > len(payload) - off:
            raise ValueError('malformed signing block pair')
        fields[bid] = payload[off + 12:off + 8 + ln]
        off += 8 + ln
    return start, fields


def verify_v2(apk_bytes):
    """Recompute the content digest and check the RSA signature, like Android does."""
    try:
        start, fields = parse_signing_block(apk_bytes)
    except (ValueError, struct.error) as err:
        return False, str(err)
    if V2_BLOCK_ID not in fields:
        return False, 'no v2 block in the signing block'
    try:
        signer, _ = _read_lp(fields[V2_BLOCK_ID], 0)        # value = seq of signers
        signer, _ = _read_lp(signer, 0)                     # first signer
        signed_data, off = _read_lp(signer, 0)
        sigs, off = _read_lp(signer, off)
        pubkey, _ = _read_lp(signer, off)
        digest_pair, _ = _read_lp(_read_lp(signed_data, 0)[0], 0)
        alg, = struct.unpack_from('<I', digest_pair, 0)
        claimed, _ = _read_lp(digest_pair, 4)
        certs, _ = _read_lp(signed_data, 4 + len(_read_lp(signed_data, 0)[0]))
        cert_der, _ = _read_lp(certs, 0)
        sig_pair, _ = _read_lp(sigs, 0)
        sig_alg, = struct.unpack_from('<I', sig_pair, 0)
        signature, _ = _read_lp(sig_pair, 4)
    except (ValueError, struct.error) as err:
        return False, f'malformed v2 block: {err}'

    if alg != SIG_ALG or sig_alg != SIG_ALG:
        return False, f'unsupported signature algorithm 0x{alg:04x}/0x{sig_alg:04x}'
    eocd, cd_size, cd_off = _eocd_parts(apk_bytes)
    eocd_for_digest = bytearray(apk_bytes[eocd:])
    struct.pack_into('<I', eocd_for_digest, 16, start)
    digest = _chunked_digest([apk_bytes[:start], apk_bytes[cd_off:eocd], bytes(eocd_for_digest)])
    if digest != claimed:
        return False, 'content digest mismatch'
    if public_key_der(cert_der) != pubkey:
        return False, 'public key in the block does not match the certificate'
    if not rsa_verify(signed_data, signature, cert_der):
        return False, 'signature does not verify'
    return True, 'ok'
