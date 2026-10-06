#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# Neurio GFX Boost — APK builder (pure Python, no Android SDK)
#
# Reuses the WebView wrapper from BashBaqiRacing.apk (its MainActivity just
# loads file:///android_asset/game.html), then:
#   • patches the manifest: package → com.neurio.gfxboost, label → Neurio GFX Boost
#   • replaces assets/game.html with the booster app (gfx-booster.html)
#   • swaps in a fresh lightning-bolt launcher icon (all densities)
#   • re-zips with 4-byte alignment and signs with v1 (JAR) + v2 (APK Sig Scheme)
#
# Usage:  python3 tools/build-booster-apk.py
# Needs:  pip install cryptography pillow
# ─────────────────────────────────────────────────────────────────────────────
import importlib.util
import io
import os
import struct
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

# import the shared signing/zip helpers from build-apk.py (hyphenated name)
_spec = importlib.util.spec_from_file_location("buildapk", os.path.join(ROOT, "tools", "build-apk.py"))
bk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bk)

BASE_APK = os.path.join(ROOT, "BashBaqiRacing.apk")
BOOST_HTML = os.path.join(ROOT, "gfx-booster.html")
OUT_APK = os.path.join(ROOT, "NeurioGFXBoost.apk")

OLD_PKG, NEW_PKG = "com.bashbaqi.racing", "com.neurio.gfxboost"
OLD_LBL, NEW_LBL = "Bash Baqi Racing", "Neurio GFX Boost"


# ── manifest string patching (same-length, in place) ─────────────────────────
def patch_strings(man, replacements):
    man = bytearray(man)
    strings, offsets, base, utf8 = bk.parse_string_pool(man)
    for old, new in replacements.items():
        assert len(old) == len(new), f"length mismatch: {old!r}({len(old)}) vs {new!r}({len(new)})"
        if old not in strings:
            raise ValueError(f"string {old!r} not in pool")
        idx = strings.index(old)
        p = base + offsets[idx]
        if utf8:
            q = p
            n = man[q]; q += 1
            if n & 0x80: q += 1
            n2 = man[q]; q += 1
            if n2 & 0x80:
                n2 = ((n2 & 0x7F) << 8) | man[q]; q += 1
            cur = bytes(man[q:q + len(old)]).decode("utf-8")
            assert cur == old, f"utf8 mismatch @{idx}: {cur!r}"
            man[q:q + len(new)] = new.encode("utf-8")
        else:
            n, = struct.unpack_from("<H", man, p)
            assert n == len(old), f"char count {n} != {len(old)}"
            q = p + 2
            cur = bytes(man[q:q + n * 2]).decode("utf-16-le")
            assert cur == old, f"utf16 mismatch @{idx}: {cur!r}"
            man[q:q + len(new) * 2] = new.encode("utf-16-le")
    return bytes(man)


# ── dex patching (rename the Activity class to the new package) ──────────────
# The wrapper's MainActivity lives in the dex as Lcom/bashbaqi/racing/MainActivity;.
# Since we changed the manifest package to com.neurio.gfxboost, the launcher
# resolves .MainActivity → com.neurio.gfxboost.MainActivity, which must exist in
# the dex or the app crashes on launch. Both descriptors are EXACTLY 34 bytes,
# so we can patch the dex string in place and then refresh the dex header
# signature (SHA-1 of [32:]) + checksum (Adler-32 of [12:]).
OLD_DESC = b"Lcom/bashbaqi/racing/MainActivity;"
NEW_DESC = b"Lcom/neurio/gfxboost/MainActivity;"
assert len(OLD_DESC) == len(NEW_DESC) == 34


def patch_dex(dex):
    import hashlib
    import zlib
    dex = bytearray(dex)
    i = dex.find(OLD_DESC)
    if i < 0:
        raise ValueError("MainActivity descriptor not found in dex")
    dex[i:i + len(NEW_DESC)] = NEW_DESC
    # SHA-1 signature over bytes[32:]
    sha = hashlib.sha1(bytes(dex[32:])).digest()
    dex[12:32] = sha
    # Adler-32 checksum over bytes[12:]
    adl = zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF
    struct.pack_into("<I", dex, 8, adl)
    return bytes(dex)


# ── icon generation ───────────────────────────────────────────────────────────
def make_icon(size):
    from PIL import Image, ImageDraw
    S = 512                      # draw big, downscale for quality
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22)

    # rounded-square background, vertical gradient (deep blue → near-black)
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    top, bot = (14, 30, 58), (6, 11, 22)
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (S, y)], fill=c + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img.paste(grad, (0, 0), mask)

    # neon gradient ring
    d.rounded_rectangle([int(S * 0.07)] * 2 + [S - int(S * 0.07)] * 2,
                        radius=int(r * 0.82), outline=(34, 229, 138, 255), width=int(S * 0.02))

    # lightning bolt (gradient fill approximated with two-tone)
    bolt = [(0.55, 0.12), (0.30, 0.55), (0.46, 0.55), (0.42, 0.88), (0.70, 0.44), (0.53, 0.44), (0.62, 0.12)]
    pts = [(int(x * S), int(y * S)) for x, y in bolt]
    d.polygon(pts, fill=(34, 229, 138, 255))
    # bright inner edge
    d.polygon(pts, outline=(22, 184, 255, 255))

    # "60·4K" hint bar at the bottom
    bw, bh = int(S * 0.44), int(S * 0.10)
    d.rounded_rectangle([(S - bw) // 2, int(S * 0.70), (S + bw) // 2, int(S * 0.70) + bh],
                        radius=bh // 2, fill=(22, 184, 255, 255))

    img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(BOOST_HTML):
        sys.exit("gfx-booster.html missing")
    key, cert = bk.load_or_create_key()

    base = zipfile.ZipFile(BASE_APK)
    html = open(BOOST_HTML, "rb").read()
    print(f"[app] assets/game.html ← gfx-booster.html ({len(html)/1024:.0f} KB)")

    entries = []
    for info in base.infolist():
        if info.filename.startswith("META-INF/"):
            continue
        data = base.read(info.filename)
        method = 0 if info.compress_type == zipfile.ZIP_STORED else 8
        if info.filename == "AndroidManifest.xml":
            data = patch_strings(data, {OLD_PKG: NEW_PKG, OLD_LBL: NEW_LBL})
            print(f"[manifest] package → {NEW_PKG} · label → {NEW_LBL}")
        elif info.filename == "assets/game.html":
            data = html
        elif info.filename == "classes.dex":
            data = patch_dex(data)
            print("[dex] MainActivity → com.neurio.gfxboost.MainActivity (checksums refreshed)")
        elif info.filename.startswith("res/") and info.filename.endswith(".png"):
            # launcher icon — regenerate at the right density
            dpi = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
            px = None
            for k, v in dpi.items():
                if k in info.filename:
                    px = v
            if px:
                data = make_icon(px)
        entries.append((info.filename, data, method))

    entries += bk.v1_sign(entries, key, cert)
    print(f"[v1] signed ({bk.SIGNER_NAME}.SF/.RSA + MANIFEST.MF)")

    apk, cd_offset = bk.build_zip(entries)
    z = zipfile.ZipFile(io.BytesIO(apk))
    assert z.testzip() is None, "corrupt zip"
    for info in z.infolist():
        if info.compress_type == zipfile.ZIP_STORED:
            (sig, _v, _f, _m, _t, _d, _c, _cs, _us, nlen, elen) = struct.unpack_from(
                "<IHHHHHIIIHH", apk, info.header_offset)
            assert sig == 0x04034B50
            assert (info.header_offset + 30 + nlen + elen) % 4 == 0, f"unaligned {info.filename}"
    print(f"[zip] {len(entries)} entries, CD at {cd_offset}, aligned + valid")

    final = bk.v2_sign(apk, cd_offset, key, cert)
    open(OUT_APK, "wb").write(final)
    bk._self_check_v2(final)

    size = os.path.getsize(OUT_APK)
    print(f"\n✅ {os.path.relpath(OUT_APK, ROOT)}  ({size/1024:.0f} KB)")
    print("   package com.neurio.gfxboost · label 'Neurio GFX Boost'")
    print("   signature: v1 (JAR) + v2 (APK Signature Scheme)")


if __name__ == "__main__":
    main()
