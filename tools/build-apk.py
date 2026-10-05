#!/usr/bin/env python3
"""Repackage the repo's tiny offline WebView shell with the current game and a local debug signature.

The template contains only a WebView activity and launcher resources. No Android SDK/Gradle is
required. The result is a sideload/debug APK, not a Play Store release artifact.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'tools' / 'android-webview-shell.apk'
GAME = ROOT / 'neurio-blocks.html'
OUTPUT = ROOT / 'NeurioBlocks.apk'
ANDROID_NS = 'http://schemas.android.com/apk/res/android'


def u16(data: bytes, offset: int) -> int:
    return struct.unpack_from('<H', data, offset)[0]


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from('<I', data, offset)[0]


def encode_len16(value: int) -> bytes:
    if value > 0x7FFF:
        return struct.pack('<HH', 0x8000 | (value >> 16), value & 0xFFFF)
    return struct.pack('<H', value)


def parse_utf16_pool(data: bytes, pos: int):
    header_size, chunk_size = u16(data, pos + 2), u32(data, pos + 4)
    count, style_count, flags = u32(data, pos + 8), u32(data, pos + 12), u32(data, pos + 16)
    strings_start, styles_start = u32(data, pos + 20), u32(data, pos + 24)
    if flags & 0x100:
        raise ValueError('The Android template uses a UTF-8 string pool; update this patcher before building.')
    offsets = [u32(data, pos + header_size + i * 4) for i in range(count)]
    string_base = pos + strings_start
    strings = []
    for offset in offsets:
        cursor = string_base + offset
        length = u16(data, cursor); cursor += 2
        if length & 0x8000:
            length = ((length & 0x7FFF) << 16) | u16(data, cursor); cursor += 2
        strings.append(data[cursor:cursor + length * 2].decode('utf-16le'))
    styles = b''
    if style_count:
        styles_start_abs = pos + styles_start
        styles = data[styles_start_abs:pos + chunk_size]
    return strings, header_size, flags, style_count, styles, chunk_size


def make_string_pool(strings: list[str], flags: int = 0) -> bytes:
    encoded = bytearray()
    offsets = []
    for value in strings:
        offsets.append(len(encoded))
        raw = value.encode('utf-16le')
        encoded.extend(encode_len16(len(raw) // 2))
        encoded.extend(raw)
        encoded.extend(b'\0\0')
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    size = strings_start + len(encoded)
    header = struct.pack('<HHIIIIII', 0x0001, header_size, size, len(strings), 0, flags & ~0x100, strings_start, 0)
    return header + b''.join(struct.pack('<I', x) for x in offsets) + encoded


def permission_start(line: int, element_name: int, android_uri: int, name_attr: int, value_idx: int) -> bytes:
    # ResXMLTree_node header followed by ResXMLTree_attrExt and one string-valued attribute.
    attr = struct.pack('<IIIHBBI', android_uri, name_attr, value_idx, 8, 0, 0x03, value_idx)
    header = struct.pack('<HHIII', 0x0102, 16, 56, line, 0xFFFFFFFF)
    ext = struct.pack('<IIHHHHHH', 0xFFFFFFFF, element_name, 20, 20, 1, 0, 0, 0)
    return header + ext + attr


def permission_end(line: int, element_name: int) -> bytes:
    return struct.pack('<HHIII', 0x0103, 16, 24, line, 0xFFFFFFFF) + struct.pack('<II', 0xFFFFFFFF, element_name)


def patch_manifest(data: bytes) -> bytes:
    if u16(data, 0) != 0x0003:
        raise ValueError('AndroidManifest.xml is not binary XML.')
    pool_pos = 8
    strings, _, flags, style_count, styles, pool_size = parse_utf16_pool(data, pool_pos)
    pool_end = pool_pos + pool_size
    strings[19] = 'Neurio Blocks'  # application label in the template
    strings[28] = 'com.neurio.blocks'  # give the game a distinct Android package id
    if 'uses-permission' in strings:
        permission_name = strings.index('uses-permission')
    else:
        permission_name = len(strings); strings.append('uses-permission')
    permission_value = 'android.permission.INTERNET'
    if permission_value in strings:
        permission_value_idx = strings.index(permission_value)
    else:
        permission_value_idx = len(strings); strings.append(permission_value)
    name_attr = strings.index('name')
    android_uri = strings.index(ANDROID_NS)
    new_pool = make_string_pool(strings, flags)

    # Preserve the compiled resource map and all existing XML node chunks byte-for-byte.
    pos = pool_end
    if u16(data, pos) == 0x0180:
        resource_size = u32(data, pos + 4)
        resource_map = data[pos:pos + resource_size]
        pos += resource_size
    else:
        resource_map = b''
    nodes = []
    inserted = False
    while pos < len(data):
        size = u32(data, pos + 4)
        chunk = data[pos:pos + size]
        if u16(data, pos) == 0x0102 and u32(data, pos + 20) == strings.index('manifest') and not inserted:
            nodes.append(chunk)
            line = u32(data, pos + 8)
            nodes.append(permission_start(line, permission_name, android_uri, name_attr, permission_value_idx))
            nodes.append(permission_end(line, permission_name))
            inserted = True
        else:
            nodes.append(chunk)
        pos += size
    if not inserted:
        raise ValueError('Could not find the <manifest> root element.')
    body = new_pool + resource_map + b''.join(nodes)
    total = 8 + len(body)
    header = struct.pack('<HHI', 0x0003, 8, total)
    return header + body


def read_uleb(data: bytes, offset: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = data[offset]; offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80: return value, offset
        shift += 7


def encode_uleb(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F; value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value: return bytes(out)


def patch_dex(data: bytes) -> bytes:
    """Rename the tiny template Activity class so the manifest gets a new package id too."""
    if not data.startswith(b'dex\n'):
        raise ValueError('Android shell does not contain a DEX file.')
    mutable = bytearray(data)
    string_count, string_ids = u32(data, 56), u32(data, 60)
    old_name = 'Lcom/bashbaqi/racing/MainActivity;'
    new_name = 'Lcom/neurio/blocks/MainActivity;'
    matches = 0
    for index in range(string_count):
        offset = u32(data, string_ids + index * 4)
        _, cursor = read_uleb(data, offset)
        end = data.index(0, cursor)
        value = data[cursor:end].decode('utf-8')
        if value != old_name: continue
        replacement = encode_uleb(len(new_name)) + new_name.encode('utf-8') + b'\0'
        old_len = end + 1 - offset
        if len(replacement) > old_len:
            raise ValueError('New DEX Activity name does not fit the original string slot.')
        mutable[offset:offset + len(replacement)] = replacement
        # The earlier null terminator ends this string; old trailing bytes are unreferenced.
        matches += 1
    if matches != 1:
        raise ValueError(f'Expected one Activity class in DEX, found {matches}.')
    import zlib
    mutable[12:32] = hashlib.sha1(mutable[32:]).digest()
    struct.pack_into('<I', mutable, 8, zlib.adler32(mutable[12:]) & 0xFFFFFFFF)
    return bytes(mutable)


def patch_resources(data: bytes) -> bytes:
    """Update the fixed-width package-name field in resources.arsc."""
    pos = 12
    while pos < len(data):
        kind, header_size, chunk_size = u16(data, pos), u16(data, pos + 2), u32(data, pos + 4)
        if kind == 0x0200:
            name_offset = pos + 12
            new_name = 'com.neurio.blocks'.encode('utf-16le') + b'\0\0'
            if len(new_name) > 256:
                raise ValueError('Package name is too long for the resource table.')
            out = bytearray(data)
            out[name_offset:name_offset + 256] = new_name + b'\0' * (256 - len(new_name))
            return bytes(out)
        if chunk_size < header_size or chunk_size < 8: raise ValueError('Malformed Android resource table.')
        pos += chunk_size
    raise ValueError('Could not find the Android resource package name.')


def icon_bytes(size: int) -> bytes:
    script = ROOT / 'tools' / 'make-icons.py'
    spec = importlib.util.spec_from_file_location('neurio_icon_generator', script)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module.draw(size)


def manifest_bytes(entries: list[tuple[str, bytes]]) -> tuple[bytes, bytes]:
    sections = []
    for name, data in entries:
        digest = base64.b64encode(hashlib.sha256(data).digest()).decode('ascii')
        sections.append(f'Name: {name}\r\nSHA-256-Digest: {digest}\r\n\r\n'.encode('utf-8'))
    manifest = b'Manifest-Version: 1.0\r\nCreated-By: Neurio Blocks\r\n\r\n' + b''.join(sections)
    sf_main = (
        'Signature-Version: 1.0\r\nCreated-By: Neurio Blocks\r\n'
        f'SHA-256-Digest-Manifest: {base64.b64encode(hashlib.sha256(manifest).digest()).decode()}\r\n\r\n'
    ).encode('utf-8')
    sf_sections = []
    for section in sections:
        digest = base64.b64encode(hashlib.sha256(section).digest()).decode('ascii')
        name_line = section.split(b'\r\n', 1)[0]
        sf_sections.append(name_line + b'\r\nSHA-256-Digest: ' + digest.encode('ascii') + b'\r\n\r\n')
    return manifest, sf_main + b''.join(sf_sections)


def generate_signature(sf_path: Path, out_path: Path, key_path: Path, cert_path: Path, temp: Path):
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-keyout', str(key_path),
        '-out', str(cert_path), '-nodes', '-days', '3650', '-subj', '/CN=Neurio Blocks Debug/',
        '-addext', 'basicConstraints=CA:FALSE', '-addext', 'keyUsage=digitalSignature',
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([
        'openssl', 'smime', '-sign', '-binary', '-noattr', '-md', 'sha256',
        '-in', str(sf_path), '-signer', str(cert_path), '-inkey', str(key_path),
        '-out', str(out_path), '-outform', 'DER',
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    verified = temp / 'verified.sf'
    subprocess.run([
        'openssl', 'smime', '-verify', '-binary', '-inform', 'DER', '-in', str(out_path),
        '-content', str(sf_path), '-noverify', '-out', str(verified),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if verified.read_bytes() != sf_path.read_bytes():
        raise RuntimeError('The v1 APK signature did not verify.')


def main():
    if not TEMPLATE.is_file():
        raise FileNotFoundError(f'Missing Android WebView shell template: {TEMPLATE}')
    if not GAME.is_file():
        raise FileNotFoundError('Run `npm run build` first to create neurio-blocks.html.')
    with zipfile.ZipFile(TEMPLATE, 'r') as template:
        replacements = {
            'AndroidManifest.xml': patch_manifest(template.read('AndroidManifest.xml')),
            'assets/game.html': GAME.read_bytes(),
            'classes.dex': patch_dex(template.read('classes.dex')),
            'resources.arsc': patch_resources(template.read('resources.arsc')),
        }
    density_icons = {
        'res/mipmap-mdpi-v4/ic_launcher.png': 48,
        'res/mipmap-hdpi-v4/ic_launcher.png': 72,
        'res/mipmap-xhdpi-v4/ic_launcher.png': 96,
        'res/mipmap-xxhdpi-v4/ic_launcher.png': 144,
        'res/mipmap-xxxhdpi-v4/ic_launcher.png': 192,
    }
    replacements.update({name: icon_bytes(size) for name, size in density_icons.items()})
    signature_names = {'META-INF/MANIFEST.MF', 'META-INF/BASHBAQI.SF', 'META-INF/BASHBAQI.RSA'}

    with tempfile.TemporaryDirectory(prefix='neurio-apk-') as temp_name:
        temp = Path(temp_name)
        key_path, cert_path = temp / 'debug-key.pem', temp / 'debug-cert.pem'
        unsigned = temp / 'unsigned.apk'
        with zipfile.ZipFile(TEMPLATE, 'r') as source, zipfile.ZipFile(unsigned, 'w') as target:
            for info in source.infolist():
                if info.filename in signature_names or info.filename.startswith('META-INF/'):
                    continue
                content = replacements.pop(info.filename, source.read(info.filename))
                copy = zipfile.ZipInfo(info.filename, info.date_time)
                copy.compress_type = info.compress_type
                copy.comment = info.comment
                copy.extra = info.extra
                copy.internal_attr = info.internal_attr
                copy.external_attr = info.external_attr
                copy.create_system = info.create_system
                target.writestr(copy, content)
            if replacements:
                raise RuntimeError(f'Unmatched APK template entries: {sorted(replacements)}')
        with zipfile.ZipFile(unsigned, 'r') as zf:
            entries = [(info.filename, zf.read(info.filename)) for info in zf.infolist() if not info.is_dir()]
        manifest, sf = manifest_bytes(entries)
        sf_path, signature_path = temp / 'CERT.SF', temp / 'CERT.RSA'
        sf_path.write_bytes(sf)
        generate_signature(sf_path, signature_path, key_path, cert_path, temp)
        with zipfile.ZipFile(unsigned, 'a') as zf:
            for name, data in [('META-INF/MANIFEST.MF', manifest), ('META-INF/CERT.SF', sf), ('META-INF/CERT.RSA', signature_path.read_bytes())]:
                info = zipfile.ZipInfo(name, (2026, 10, 5, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                zf.writestr(info, data)
        OUTPUT.write_bytes(unsigned.read_bytes())

    with zipfile.ZipFile(OUTPUT, 'r') as apk:
        assert 'assets/game.html' in apk.namelist()
        assert len(apk.read('assets/game.html')) > 50000
        assert 'android.permission.INTERNET'.encode('utf-16le') in apk.read('AndroidManifest.xml')
    print(f'Built {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.2f} MiB).')
    print('Signed with a temporary local debug key (sideload only; not a Play Store signing key).')


if __name__ == '__main__':
    main()
