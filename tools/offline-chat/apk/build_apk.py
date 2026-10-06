#!/usr/bin/env python3
"""
Builds `NurioTawasol.apk` — an offline chat app for Android — from this repo
only: no Android SDK, no Gradle, no JDK, no internet.

How it works (see apk/README.md for the full story):

  1. takes the tiny WebView shell APK (assets/game.html + a 2 KB classes.dex)
  2. swaps in our single-file chat client  → assets/game.html
  3. swaps the launcher icons              → res/mipmap-*/ic_launcher.png
  4. rebuilds AndroidManifest.xml          → new label/package + INTERNET + targetSdk 27
  5. renames the package inside classes.dex (same-length string → offsets stay valid)
     and fixes the DEX checksum + SHA-1 signature
  6. replaces the package name inside resources.arsc
  7. re-signs the APK: JAR (v1) + APK Signature Scheme v2

    python3 tools/offline-chat/apk/build_apk.py
"""
import hashlib
import os
import shutil
import subprocess
import struct
import sys
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)

import axml                                                     # noqa: E402
import sign                                                     # noqa: E402

# ── identity ────────────────────────────────────────────────────────────
OLD_PACKAGE = 'com.bashbaqi.racing'                             # must be 19 chars
NEW_PACKAGE = 'com.neurio.tawassol'                             # 19 chars → same byte length
OLD_CLASS = 'Lcom/bashbaqi/racing/MainActivity;'                # 34 chars
NEW_CLASS = 'Lcom/neurio/tawassol/MainActivity;'                # 34 chars
APP_LABEL = 'نوريو تواصل'
TARGET_SDK = 27                                                 # < 28 → LAN http:// allowed
ASSET_NAME = 'assets/game.html'                                 # the DEX hardcodes this path
MIPMAPS = {
    'res/mipmap-mdpi-v4/ic_launcher.png': 'mipmap-mdpi',
    'res/mipmap-hdpi-v4/ic_launcher.png': 'mipmap-hdpi',
    'res/mipmap-xhdpi-v4/ic_launcher.png': 'mipmap-xhdpi',
    'res/mipmap-xxhdpi-v4/ic_launcher.png': 'mipmap-xxhdpi',
    'res/mipmap-xxxhdpi-v4/ic_launcher.png': 'mipmap-xxxhdpi',
}


def log(msg):
    print('   ' + msg)


# ─────────────────────────────── inputs ───────────────────────────────
def find_shell():
    for candidate in (os.path.join(HERE, 'shell.apk'),
                      os.path.join(ROOT, 'BashBaqiRacing.apk')):
        if os.path.exists(candidate):
            return candidate
    raise SystemExit('❌ shell APK not found — expected tools/offline-chat/apk/shell.apk')


def find_bundle():
    """dist/nurio-tawasol.html — built on the fly when it is missing."""
    path = os.path.join(ROOT, 'tools', 'offline-chat', 'dist', 'nurio-tawasol.html')
    if not os.path.exists(path):
        bundler = os.path.join(ROOT, 'tools', 'offline-chat', 'build-singlefile.mjs')
        if os.path.exists(bundler) and shutil.which('node'):
            subprocess.run(['node', bundler], cwd=os.path.dirname(bundler), check=True)
    if not os.path.exists(path):
        raise SystemExit('❌ missing bundle — run: node tools/offline-chat/build-singlefile.mjs')
    return open(path, 'rb').read()


# ─────────────────────────── 1) classes.dex ───────────────────────────
def patch_dex(dex):
    """Rename the activity class (same length → every offset stays valid)."""
    old, new = OLD_CLASS.encode(), NEW_CLASS.encode()
    assert len(old) == len(new), 'class descriptors must have the same length'
    if dex.count(old) != 1:
        raise SystemExit(f'❌ expected exactly one occurrence of {OLD_CLASS}, found {dex.count(old)}')
    out = bytearray(dex.replace(old, new))
    # DEX header: 0x0C = SHA-1 over [32:], then 0x08 = adler32 over [12:] (which includes the SHA-1)
    out[12:32] = hashlib.sha1(bytes(out[32:])).digest()
    struct.pack_into('<I', out, 8, zlib.adler32(bytes(out[12:])) & 0xFFFFFFFF)
    return bytes(out)


def check_dex(dex):
    size, = struct.unpack_from('<I', dex, 32)
    if size != len(dex):
        return f'file_size mismatch ({size} != {len(dex)})'
    if struct.unpack_from('<I', dex, 8)[0] != (zlib.adler32(dex[12:]) & 0xFFFFFFFF):
        return 'adler32 checksum mismatch'
    if dex[12:32] != hashlib.sha1(dex[32:]).digest():
        return 'sha-1 signature mismatch'
    return None


# ───────────────────────── 2) AndroidManifest.xml ─────────────────────────
def patch_manifest(manifest_bytes):
    xml = axml.read_xml(manifest_bytes)
    strings = list(xml['pool']['strings'])
    index_of = {s: i for i, s in enumerate(strings)}

    def add_string(s):
        if s not in index_of:
            strings.append(s)
            index_of[s] = len(strings) - 1
        return index_of[s]

    ANDROID_NS = add_string(axml.NS_ANDROID)
    add_string('uses-permission')
    add_string('android.permission.INTERNET')
    add_string(APP_LABEL)
    add_string(NEW_PACKAGE)

    events = []
    for e in xml['events']:
        if e['type'] != axml.RES_XML_START_ELEMENT:
            events.append(e)
            continue
        name = xml['pool']['strings'][e['name_i']]

        if name == 'manifest':
            for a in e['attrs']:
                if xml['pool']['strings'][a['name_i']] == 'package':
                    a['raw'] = NEW_PACKAGE
                    a['data_str'] = NEW_PACKAGE
        elif name == 'application':
            for a in e['attrs']:
                if xml['pool']['strings'][a['name_i']] == 'label':
                    a['raw'] = APP_LABEL
                    a['data_str'] = APP_LABEL
        elif name == 'uses-sdk':
            for a in e['attrs']:
                if xml['pool']['strings'][a['name_i']] == 'targetSdkVersion':
                    a['data'] = TARGET_SDK
                    a['raw'] = None
        elif name == 'activity':
            for a in e['attrs']:
                if xml['pool']['strings'][a['name_i']] == 'screenOrientation':
                    a['data'] = 0xFFFFFFFF          # unspecified → the system decides
                    a['raw'] = None
        events.append(e)

        if name == 'manifest':                       # give the app internet access
            perm = {'type': axml.RES_XML_START_ELEMENT,
                    'name': 'uses-permission',
                    'ns': None,
                    'attrs': [{'name': 'name', 'ns': ANDROID_NS, 'type': axml.TYPE_STRING,
                               'raw': 'android.permission.INTERNET',
                               'data_str': 'android.permission.INTERNET'}],
                    'line': 0}
            events.append(perm)
            events.append({'type': axml.RES_XML_END_ELEMENT, 'ns': None, 'name': 'uses-permission'})

    resource_map = sorted(xml['resources'].items())
    return axml.build_xml(strings, resource_map, events), xml


# ────────────────────────── 3) resources.arsc ──────────────────────────
def patch_arsc(arsc):
    """The package chunk carries a 128-char UTF-16 name field — rewrite it in place."""
    out = bytearray(arsc)
    _, hsize, _ = struct.unpack_from('<HHI', arsc, 0)          # ResTable_header (12 bytes)
    off, pkg_off = hsize, None
    while off < len(arsc):
        typ, _, size = struct.unpack_from('<HHI', arsc, off)
        if typ == 0x0200:                                      # RES_TABLE_PACKAGE_TYPE
            pkg_off = off
            break
        off += size
    if pkg_off is None:
        log('⚠️  resources.arsc: package chunk not found — name left untouched')
        return bytes(out)
    old_name = arsc[pkg_off + 12:pkg_off + 12 + 256].decode('utf-16-le').split('\x00')[0]
    encoded = NEW_PACKAGE.encode('utf-16-le') + b'\x00\x00'
    if len(encoded) > 256:
        raise SystemExit('❌ package name too long for resources.arsc')
    out[pkg_off + 12:pkg_off + 12 + 256] = encoded + b'\x00' * (256 - len(encoded))
    log(f'resources  : arsc package {old_name!r} → {NEW_PACKAGE!r} ✅')
    return bytes(out)


# ─────────────────────────────── 4) zip ───────────────────────────────
def write_apk(path, entries):
    """entries: list of (name, data, compress_type). Stored entries are 4-byte aligned."""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data, method in entries:
            zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            zi.compress_type = method
            zi.external_attr = 0o644 << 16
            zi.create_system = 0
            if method == zipfile.ZIP_STORED:
                # pad the extra field so the payload starts on a 4-byte boundary
                header = 30 + len(name.encode()) + 2 * 2 + 4
                pad = (-header) % 4
                if pad:
                    zi.extra = struct.pack('<HH', 0xD935, pad) + b'\x00' * pad
            z.writestr(zi, data)
    return path


def main():
    print('\n📦 building NurioTawasol.apk\n')

    shell = find_shell()
    log(f'shell      : {os.path.relpath(shell, ROOT)}')
    bundle = find_bundle()
    log(f'client     : {len(bundle) / 1024:.1f} KB single-file bundle')

    with zipfile.ZipFile(shell) as z:
        dex = z.read('classes.dex')
        manifest = z.read('AndroidManifest.xml')
        arsc = z.read('resources.arsc')

    # 1) DEX ─────────────────────────────────────────────────────────────
    new_dex = patch_dex(dex)
    problem = check_dex(new_dex)
    if problem:
        raise SystemExit(f'❌ patched DEX is invalid: {problem}')
    log(f'classes.dex: {OLD_PACKAGE} → {NEW_PACKAGE} (checksum + SHA-1 rebuilt ✅)')

    # 2) manifest ────────────────────────────────────────────────────────
    new_manifest, parsed = patch_manifest(manifest)
    texts = axml.describe(new_manifest)
    for needle in (NEW_PACKAGE, APP_LABEL, 'android.permission.INTERNET'):
        if needle not in texts:
            raise SystemExit(f'❌ {needle!r} missing from the rebuilt manifest')
    log(f'manifest   : label «{APP_LABEL}», package {NEW_PACKAGE}, INTERNET ✅, targetSdk {TARGET_SDK} ✅')

    # 3) resources.arsc ──────────────────────────────────────────────────
    new_arsc = patch_arsc(arsc)

    # 4) icons + asset ───────────────────────────────────────────────────
    icons = {}
    for entry_name, folder in MIPMAPS.items():
        path = os.path.join(HERE, 'icons', folder, 'ic_launcher.png')
        if not os.path.exists(path):
            raise SystemExit(f'❌ missing icon {path} — run: node tools/offline-chat/make-icons.mjs')
        icons[entry_name] = open(path, 'rb').read()

    entries = [
        ('AndroidManifest.xml', new_manifest, zipfile.ZIP_DEFLATED),
        ('classes.dex', new_dex, zipfile.ZIP_STORED),
        (ASSET_NAME, bundle, zipfile.ZIP_DEFLATED),
        ('resources.arsc', new_arsc, zipfile.ZIP_STORED),
    ] + [(name, blob, zipfile.ZIP_STORED) for name, blob in sorted(icons.items())]
    # keep the original ordering style: manifest, dex, asset, icons, resources
    entries = ([entries[0], entries[1], entries[2]]
               + [e for e in entries if e[0].startswith('res/')]
               + [entries[3]])

    # 5) sign: v1 (JAR) then v2 (signing block) ───────────────────────────
    unsigned = os.path.join(HERE, '.build-unsigned.apk')
    v1_path = os.path.join(HERE, '.build-v1.apk')
    write_apk(unsigned, entries)
    log(f'zip        : {len(entries)} entries, {os.path.getsize(unsigned) / 1024:.1f} KB')

    key_pem, cert_pem, cert_der = sign.make_key(os.path.join(HERE, '.keys'))
    fingerprint = hashlib.sha256(cert_der).hexdigest()
    log(f'key        : {os.path.join("apk", ".keys")} · SHA-256 {fingerprint[:32]}…')

    sign.sign_v1(unsigned, key_pem, cert_der, v1_path)
    signed_bytes = sign.sign_v2(open(v1_path, 'rb').read(), key_pem, cert_der)

    out = os.path.join(ROOT, 'NurioTawasol.apk')
    with open(out, 'wb') as f:
        f.write(signed_bytes)
    for tmp in (unsigned, v1_path):
        os.unlink(tmp)

    # 6) verify ──────────────────────────────────────────────────────────
    ok1, why1 = sign.verify_v1(out)
    ok2, why2 = sign.verify_v2(open(out, 'rb').read())
    v1_note = '✅' if ok1 else f'❌ {why1}'
    v2_note = '✅' if ok2 else f'❌ {why2}'
    log(f'signature  : v1 {v1_note} · v2 {v2_note}')
    if not (ok1 and ok2):
        raise SystemExit('❌ signing verification failed')

    with zipfile.ZipFile(out) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f'❌ corrupt entry in the APK: {bad}')
        inside = z.namelist()
        dex_inside = z.read('classes.dex')
        if NEW_CLASS.encode() not in dex_inside:
            raise SystemExit('❌ classes.dex does not reference the new activity')
        if z.read('AndroidManifest.xml') != new_manifest:
            raise SystemExit('❌ manifest inside the APK differs')
        asset = z.read(ASSET_NAME)
        if asset != bundle:
            raise SystemExit('❌ bundled client differs from dist/')
    log(f'contents   : {len(inside)} entries · asset {len(asset) / 1024:.1f} KB · dex ok ✅ · zip ok ✅')

    size = os.path.getsize(out)
    print(f'\n🎉 {os.path.relpath(out, ROOT)}  ({size / 1024:.1f} KB)')
    print('   install: copy to the phone → tap → allow «install unknown apps»\n')


if __name__ == '__main__':
    main()
