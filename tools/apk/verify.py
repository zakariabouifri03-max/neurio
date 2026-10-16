#!/usr/bin/env python3
"""Independent APK Signature Scheme v2 verifier (no external libs).

Checks, from scratch:
  * APK Signing Block structure + magic
  * v2 block: signers -> signed data / signatures / public key encoding
  * content digest (sections: zip entries | central directory | EOCD with CD offset
    pointing at the signing block) against the digest stored in the signed data
  * RSA PKCS#1 v1.5 signature over the signed data, using the embedded public key
  * zip structure (CRC check) and classes.dex magic

usage: verify.py some.apk
"""
import hashlib
import struct
import sys
import zipfile

MAGIC = b'APK Sig Block 42'
V2_BLOCK_ID = 0x7109871A
DIGEST_INFO_PREFIX = {
    'sha256': bytes.fromhex('3031300d060960864801650304020105000420'),
    'sha512': bytes.fromhex('3051300d060960864801650304020305000440'),
}


def eocd_offset(d):
    for i in range(len(d) - 22, max(-1, len(d) - 22 - 65535), -1):
        if d[i:i + 4] == b'PK\x05\x06':
            if i + 22 + struct.unpack_from('<H', d, i + 20)[0] == len(d):
                return i
    raise SystemExit('FAIL: no EOCD record found')


def lp(buf, off=0):
    """read a uint32-length-prefixed blob, return (blob, next_offset)"""
    n = struct.unpack_from('<I', buf, off)[0]
    return buf[off + 4:off + 4 + n], off + 4 + n


def der_read(buf, off):
    """minimal DER TLV reader -> (tag, value_bytes, next_offset)"""
    tag = buf[off]
    off += 1
    ln = buf[off]
    off += 1
    if ln & 0x80:
        cnt = ln & 0x7F
        ln = int.from_bytes(buf[off:off + cnt], 'big')
        off += cnt
    return tag, buf[off:off + ln], off + ln


def rsa_from_spki(spki):
    """extract (modulus, exponent) from an X.509 SubjectPublicKeyInfo DER blob"""
    _, seq, _ = der_read(spki, 0)                     # SEQUENCE
    _, alg, off = der_read(seq, 0)                    # AlgorithmIdentifier
    tag, bitstr, _ = der_read(seq, off)               # BIT STRING
    if tag != 0x03:
        raise SystemExit('FAIL: expected BIT STRING in SPKI')
    inner = bitstr[1:]                                # strip unused-bits byte
    _, rsa_seq, _ = der_read(inner, 0)                # SEQUENCE { n, e }
    _, n_bytes, off = der_read(rsa_seq, 0)            # INTEGER n
    _, e_bytes, _ = der_read(rsa_seq, off)            # INTEGER e
    return int.from_bytes(n_bytes, 'big'), int.from_bytes(e_bytes, 'big')


def chunked_digests(section, hash_name):
    out = []
    for i in range(0, len(section), 1024 * 1024):
        chunk = section[i:i + 1024 * 1024]
        out.append(hashlib.new(hash_name, b'\xa5' + struct.pack('<I', len(chunk)) + chunk).digest())
    return out


def main(path):
    data = open(path, 'rb').read()
    print(f'file: {path} ({len(data)} bytes)')

    eocd_off = eocd_offset(data)
    cd_size, cd_off = struct.unpack_from('<II', data, eocd_off + 12)
    entry_count = struct.unpack_from('<H', data, eocd_off + 10)[0]
    print(f'EOCD @{eocd_off}  central directory @{cd_off} (+{cd_size})  entries={entry_count}')

    if data[cd_off - 16:cd_off] != MAGIC:
        raise SystemExit('FAIL: APK Signing Block magic not found before central directory')
    sb_size = struct.unpack_from('<Q', data, cd_off - 24)[0]
    sb_start = cd_off - 8 - sb_size
    if struct.unpack_from('<Q', data, sb_start)[0] != sb_size:
        raise SystemExit('FAIL: signing block size fields disagree')
    print(f'signing block @{sb_start} size={sb_size}')

    pairs = {}
    p, pair_end = sb_start + 8, cd_off - 24
    while p < pair_end:
        plen = struct.unpack_from('<Q', data, p)[0]
        pid = struct.unpack_from('<I', data, p + 8)[0]
        pairs[pid] = data[p + 12:p + 8 + plen]
        p += 8 + plen
    print('pairs:', ', '.join(f'0x{k:08x}({len(v)}B)' for k, v in pairs.items()))
    if V2_BLOCK_ID not in pairs:
        raise SystemExit('FAIL: no v2 block in the signing block')
    for k in pairs:
        if k not in (V2_BLOCK_ID, 0x42726577, 0xF05368C0, 0x1B93AD61):
            print(f'  note: extra block 0x{k:08x}')

    # ---- parse v2 block ----------------------------------------------------
    signers, _ = lp(pairs[V2_BLOCK_ID], 0)
    signer, _ = lp(signers, 0)
    signed_data, off = lp(signer, 0)
    sigs_field, off = lp(signer, off)
    pubkey, _ = lp(signer, off)

    digests_field, _ = lp(signed_data, 0)
    digest_rec, _ = lp(digests_field, 0)
    algo_id = struct.unpack_from('<I', digest_rec, 0)[0]
    digest_in_sig, _ = lp(digest_rec, 4)
    hash_name = {0x0101: 'sha256', 0x0102: 'sha512', 0x0103: 'sha256', 0x0104: 'sha512'}.get(algo_id)
    if not hash_name:
        raise SystemExit(f'FAIL: unknown signature algorithm id 0x{algo_id:04x}')
    print(f'signature algorithm: 0x{algo_id:04x} ({hash_name.upper()}), digest={digest_in_sig.hex()[:16]}…')

    certs_field, _ = lp(signed_data, struct.unpack_from('<I', signed_data, 0)[0] + 4)
    cert, _ = lp(certs_field, 0)
    print(f'certificate: {len(cert)} bytes DER')

    # ---- content digest ----------------------------------------------------
    sec1 = data[0:sb_start]
    sec2 = data[cd_off:cd_off + cd_size]
    eocd = bytearray(data[eocd_off:])
    struct.pack_into('<I', eocd, 16, sb_start)   # CD offset -> start of signing block
    chunks = (chunked_digests(sec1, hash_name) + chunked_digests(sec2, hash_name)
              + chunked_digests(bytes(eocd), hash_name))
    top = b'\x5a' + struct.pack('<I', len(chunks)) + b''.join(chunks)
    computed = hashlib.new(hash_name, top).digest()
    ok_digest = computed == digest_in_sig
    print(f'content digest: computed={computed.hex()[:16]}… stored={digest_in_sig.hex()[:16]}… '
          f'-> {"OK" if ok_digest else "MISMATCH"}')

    # ---- signature ---------------------------------------------------------
    sig_rec, _ = lp(sigs_field, 0)
    sig_algo = struct.unpack_from('<I', sig_rec, 0)[0]
    sig, _ = lp(sig_rec, 4)
    if sig_algo != algo_id:
        raise SystemExit(f'FAIL: signature algorithm 0x{sig_algo:04x} != digest algorithm 0x{algo_id:04x}')
    n, e = rsa_from_spki(pubkey)
    print(f'public key: RSA {n.bit_length()} bit, e={e}')
    m = pow(int.from_bytes(sig, 'big'), e, n)
    em = m.to_bytes((n.bit_length() + 7) // 8, 'big')
    pad_ok = em.startswith(b'\x00\x01')
    sep = em.find(b'\x00', 2)
    padded_ok = pad_ok and sep > 8 and em[sep + 1:].startswith(DIGEST_INFO_PREFIX[hash_name])
    body = em[sep + 1 + len(DIGEST_INFO_PREFIX[hash_name]):]
    expect = hashlib.new(hash_name, signed_data).digest()
    sig_ok = padded_ok and body == expect
    print(f'RSA signature over signed data -> {"OK" if sig_ok else "INVALID"}')
    if not sig_ok:
        print(f'  padding={padded_ok} body={body.hex()[:24]} expected={expect.hex()[:24]}')

    # ---- zip / dex sanity --------------------------------------------------
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        names = z.namelist()
    print(f'zip entries: {len(names)}  crc errors: {bad or "none"}')
    print(f'  {", ".join(names[:8])}{" …" if len(names) > 8 else ""}')
    dex = zipfile.ZipFile(path).read('classes.dex')
    dex_ok = dex[:4] == b'dex\n' and len(dex) > 100
    print(f'classes.dex: {len(dex)} bytes, magic={dex[:8]!r} -> {"OK" if dex_ok else "BAD"}')

    all_ok = ok_digest and sig_ok and not bad and dex_ok
    print('\nRESULT:', 'PASS — signature and structure are valid' if all_ok else 'FAIL')
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
