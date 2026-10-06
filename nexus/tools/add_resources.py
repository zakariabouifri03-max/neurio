#!/usr/bin/env python3
"""NEXUS GRAPHICS ENGINE - PE resource injector.

Adds .rsrc section (icon + group icon + manifest + version info) to a PE
built with zig/lld (which has no windres on this toolchain). Idempotent:
skips if the PE already has a resource directory.
"""
import struct
import sys

import pefile

SECTION_ALIGN = 0x1000
FILE_ALIGN = 0x200


def pad(b, n=4):
    return b + b"\x00" * ((-len(b)) % n)


def u16(v): return struct.pack("<H", v)
def u32(v): return struct.pack("<I", v)


def utf16z(s):
    return s.encode("utf-16-le") + b"\x00\x00"


# ---------------------------------------------------------------- icon
def parse_ico(path):
    data = open(path, "rb").read()
    _, typ, count = struct.unpack("<HHH", data[:6])
    assert typ == 1, "not an .ico"
    images, group = [], []
    off = 6
    for i in range(count):
        w, h, colors, res, planes, bpp, size, offset = struct.unpack(
            "<BBBBHHII", data[off:off + 16])
        off += 16
        images.append(data[offset:offset + size])
        group.append((w, h, colors, res, planes, bpp, size))
    return images, group


def build_group_icon(group):
    out = struct.pack("<HHH", 0, 1, len(group))
    for i, (w, h, colors, res, planes, bpp, size) in enumerate(group):
        out += struct.pack("<BBBBHHIH", w % 256, h % 256, colors, res,
                           planes, bpp, size, i + 1)
    return out


# ---------------------------------------------------------------- version
def build_string(k, v):
    # one String node
    key = utf16z(k)
    val = utf16z(v)
    node = u16(0) + u16(0) + u16(1) + key
    node = pad(node[:6] + node[6:], 4)  # pad szKey to 4
    node += val
    total = 6 + len(node) - 6 + 0
    ln = len(node)
    node = node[:0] + u16(ln) + node[2:]
    return pad(node, 4)


def build_strblock(strings):
    # StringTable
    tbl_key = utf16z("040904B0")
    body = b""
    for k, v in strings:
        s = u16(0) + u16(0) + u16(1) + pad(utf16z(k), 4)
        s += utf16z(v)
        s = u16(len(s)) + s[2:]
        body += pad(s, 4)
    tbl = u16(0) + u16(0) + u16(1) + pad(tbl_key, 4) + body
    tbl = u16(len(tbl)) + tbl[2:]
    sfi = u16(0) + u16(0) + u16(1) + pad(utf16z("StringFileInfo"), 4) + tbl
    sfi = u16(len(sfi)) + sfi[2:]
    var = u16(0) + u16(0) + u16(1) + pad(utf16z("VarFileInfo"), 4)
    vv = u16(0) + u16(0) + u16(1) + pad(utf16z("Translation"), 4) + u16(0x04B0) + u16(0x0409)
    vv = u16(len(vv)) + vv[2:]
    var += vv
    var = u16(len(var)) + var[2:]
    return sfi + var


def build_version():
    fixed = struct.pack("<10I",
                        0xFEEF04BD,   # signature
                        0x00010000,   # version 1.0
                        0x00010000,   # file version (1.0)
                        0x00010000,   # product version
                        0x3F,         # flags mask
                        0x0,          # flags
                        0x4,          # OS: VOS_NT_WINDOWS32
                        0x2,          # file type: VFT_APP
                        0x0, 0x0)
    key = utf16z("VS_VERSION_INFO")
    head = u16(0) + u16(52) + u16(0) + key
    head = pad(head, 4) + fixed
    children = build_strblock([
        ("CompanyName", "Nexus Graphics"),
        ("FileDescription", "NEXUS GRAPHICS ENGINE - Real-Time 3D Game Graphics Enhancer"),
        ("FileVersion", "1.0.0.0"),
        ("InternalName", "NexusGraphicsEngine"),
        ("LegalCopyright", "(c) 2026 Nexus Graphics. MIT licensed."),
        ("OriginalFilename", "NexusGraphicsEngine.exe"),
        ("ProductName", "NEXUS GRAPHICS ENGINE"),
        ("ProductVersion", "1.0.0.0"),
    ])
    total = len(head) + len(children)
    return u16(total) + head[2:] + children


MANIFEST = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="Nexus.Graphics.Engine" version="1.0.0.0" processorArchitecture="*"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"""


# ---------------------------------------------------------------- resource tree
def build_resources(resources):
    """resources: list of (type_id, res_id, lang, data). Returns section blob."""
    # tree: type -> id -> lang -> data
    tree = {}
    for (t, i, l, d) in resources:
        tree.setdefault(t, {}).setdefault(i, {})[l] = d

    # compute layout: directories first, then data entries, then data blobs
    num_types = len(tree)

    def dir_size(n):
        return 16 + 8 * n

    # walk to assign offsets
    offset = dir_size(num_types)
    type_dirs = {}
    for t, ids in tree.items():
        type_dirs[t] = offset
        offset += dir_size(len(ids))
        for i, langs in ids.items():
            offset += dir_size(len(langs))  # id dir

    # data entries
    data_entries = {}
    for t, ids in tree.items():
        for i, langs in ids.items():
            for l, d in langs.items():
                data_entries[(t, i, l)] = offset
                offset += 16

    # data blobs
    data_blobs = {}
    for t, ids in tree.items():
        for i, langs in ids.items():
            for l, d in langs.items():
                data_blobs[(t, i, l)] = offset
                offset += len(d)
                offset = (offset + 3) & ~3

    total = offset

    def make_dir(entries, name_off_map, is_leaf_builder, base_off):
        pass  # built inline below

    blob = bytearray(total)

    def write_dir(off, n_entries, entries):
        # entries: list of (name_or_id, is_dir, target_off)
        struct.pack_into("<IIHHHH", blob, off, 0, 0, 0, 0, 0, n_entries)
        p = off + 16
        for (ident, is_dir, target) in entries:
            name_field = ident  # id
            off_field = target | (0x80000000 if is_dir else 0)
            struct.pack_into("<II", blob, p, name_field, off_field)
            p += 8

    # root
    root_entries = []
    for t, off in sorted(type_dirs.items()):
        root_entries.append((t, True, off))
    write_dir(0, num_types, root_entries)

    # type dirs
    for t, ids in tree.items():
        base = type_dirs[t]
        ents = []
        for i in sorted(ids.keys()):
            # id dir placed right after type dir
            id_off = base + dir_size(len(ids)) + (sorted(ids.keys()).index(i)) * 0
            # need real offset: compute sequentially
            ents.append((i, True, 0))
        # compute id dir offsets
        cur = base + dir_size(len(ids))
        id_offsets = {}
        for i in sorted(ids.keys()):
            id_offsets[i] = cur
            cur += dir_size(len(ids[i]))
        ents = [(i, True, id_offsets[i]) for i in sorted(ids.keys())]
        write_dir(base, len(ids), ents)
        # id dirs
        for i in sorted(ids.keys()):
            langs = ids[i]
            ents2 = [(l, False, data_entries[(t, i, l)]) for l in sorted(langs.keys())]
            write_dir(id_offsets[i], len(langs), ents2)

    # data entries + blobs
    for (t, i, l), off in data_entries.items():
        d = tree[t][i][l]
        struct.pack_into("<IIII", blob, off, data_blobs[(t, i, l)], len(d), 0x04B0, 0)
        doff = data_blobs[(t, i, l)]
        blob[doff:doff + len(d)] = d

    return bytes(blob), total


def main():
    exe_path, ico_path = sys.argv[1], sys.argv[2]
    data = bytearray(open(exe_path, "rb").read())

    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    num_sections_off = e_lfanew + 6
    opt_size_off = e_lfanew + 20
    opt_off = e_lfanew + 24
    magic = struct.unpack_from("<H", data, opt_off)[0]
    num_sections = struct.unpack_from("<H", data, num_sections_off)[0]
    opt_size = struct.unpack_from("<H", data, opt_size_off)[0]
    dd_off = opt_off + (112 if magic == 0x20B else 96)
    rsrc_rva, rsrc_size = struct.unpack_from("<II", data, dd_off + 2 * 8)
    if rsrc_rva != 0:
        print("already has resources - nothing to do")
        return

    images, group = parse_ico(ico_path)
    resources = []
    for i, img in enumerate(images):
        resources.append((3, i + 1, 0x409, img))  # RT_ICON
    resources.append((14, 1, 0x409, build_group_icon(group)))   # RT_GROUP_ICON
    resources.append((16, 1, 0x409, build_version()))           # RT_VERSION
    resources.append((24, 1, 0x409, MANIFEST.encode("utf-8")))  # RT_MANIFEST

    blob, size = build_resources(resources)

    # new section RVA after the last section; raw data at the true end of file
    sec_tbl = opt_off + opt_size
    last_rva = 0
    for i in range(num_sections):
        base = sec_tbl + 40 * i
        vsize = struct.unpack_from("<I", data, base + 8)[0]
        vaddr = struct.unpack_from("<I", data, base + 12)[0]
        last_rva = max(last_rva, vaddr + vsize)
    rva = (last_rva + SECTION_ALIGN - 1) & ~(SECTION_ALIGN - 1)
    raw_off = (len(data) + FILE_ALIGN - 1) & ~(FILE_ALIGN - 1)
    raw = blob + b"\x00" * ((-len(blob)) % FILE_ALIGN)

    size_of_image = (rva + size + SECTION_ALIGN - 1) & ~(SECTION_ALIGN - 1)
    struct.pack_into("<H", data, num_sections_off, num_sections + 1)
    struct.pack_into("<I", data, dd_off + 2 * 8 + 0, rva)
    struct.pack_into("<I", data, dd_off + 2 * 8 + 4, size)
    struct.pack_into("<I", data, opt_off + 56, size_of_image)
    name = b".rsrc"
    hdr = name.ljust(8, b"\x00") + struct.pack("<IIIIIIHHI",
        size, rva, len(raw), raw_off, 0, 0, 0, 0, 0x40000040)
    sh_off = sec_tbl + 40 * num_sections
    data[sh_off:sh_off + 40] = hdr
    data += raw
    # checksum
    data[opt_off + 64:opt_off + 68] = b"\x00\x00\x00\x00"
    cs = 0
    for i in range(0, len(data), 2):
        w = data[i] | (data[i+1] << 8 if i + 1 < len(data) else 0)
        cs += w
        cs = (cs & 0xFFFF) + (cs >> 16)
    cs = (cs & 0xFFFF) + (cs >> 16)
    cs = (cs + len(data)) & 0xFFFFFFFF
    struct.pack_into("<I", data, opt_off + 64, cs)

    open(exe_path, "wb").write(bytes(data))

    # verify
    pe2 = pefile.PE(exe_path)
    assert hasattr(pe2, "DIRECTORY_ENTRY_RESOURCE"), "resource dir missing"
    types = sorted({e.id for e in pe2.DIRECTORY_ENTRY_RESOURCE.entries})
    print("resources added. types:", types, " exe size:", len(data))


if __name__ == "__main__":
    main()
