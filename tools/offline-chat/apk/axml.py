#!/usr/bin/env python3
"""
Android binary XML (AXML) reader **and writer** — enough to patch a manifest
without the Android SDK: rewrite the string pool (keeping every existing index
valid), edit attribute values, insert new elements (e.g. <uses-permission>).

Format reference: AOSP `ResourceTypes.h` (ResStringPool, ResXMLTree_*).
"""
import struct

NS_ANDROID = 'http://schemas.android.com/apk/res/android'
TYPE_STRING, TYPE_INT_DEC, TYPE_INT_HEX, TYPE_INT_BOOL, TYPE_REFERENCE, TYPE_INT_COLOR = 0x03, 0x10, 0x11, 0x12, 0x01, 0x1F
TYPE_FLOAT = 0x04
TYPE_ATTRIBUTE = 0x02
RES_STRING_POOL_TYPE, RES_XML_TYPE, RES_XML_RESOURCE_MAP_TYPE = 0x0001, 0x0003, 0x0180
RES_XML_START_NS, RES_XML_END_NS = 0x0100, 0x0101
RES_XML_START_ELEMENT, RES_XML_END_ELEMENT = 0x0102, 0x0103
RES_XML_CDATA = 0x0104


# ─────────────────────────────── reading ───────────────────────────────
def parse_string_pool(buf, off):
    typ, hsize, size = struct.unpack_from('<HHI', buf, off)
    if typ != RES_STRING_POOL_TYPE:
        raise ValueError(f'not a string pool at {off}: 0x{typ:04x}')
    count, style_count, flags, str_start, style_start = struct.unpack_from('<IIIII', buf, off + 8)
    utf8 = (flags & (1 << 8)) != 0
    offsets = [struct.unpack_from('<I', buf, off + 28 + i * 4)[0] for i in range(count)]
    strings = []
    for o in offsets:
        p = off + str_start + o
        if utf8:
            n1 = buf[p]; p += 1
            if n1 & 0x80:
                n1 = ((n1 & 0x7f) << 8) | buf[p]; p += 1
            n2 = buf[p]; p += 1
            if n2 & 0x80:
                n2 = ((n2 & 0x7f) << 8) | buf[p]; p += 1
            strings.append(buf[p:p + n1].decode('utf-8', 'replace'))
        else:
            n = struct.unpack_from('<H', buf, p)[0]; p += 2
            if n & 0x8000:
                high = struct.unpack_from('<H', buf, p)[0]; p += 2
                n = ((n & 0x7fff) << 16) | high
            strings.append(buf[p:p + n * 2].decode('utf-16-le', 'replace'))
    return {'utf8': utf8, 'count': count, 'strings': strings, 'offsets': offsets,
            'chunk_off': off, 'chunk_size': size, 'hsize': hsize, 'str_start': str_start,
            'style_count': style_count, 'flags': flags}


def read_xml(buf):
    """Parse an AXML document into {pool, resources, events} (events = raw chunks)."""
    pool = parse_string_pool(buf, 8)
    strings = pool['strings']
    off = 8 + pool['chunk_size']
    resources = {}
    events = []
    while off < len(buf):
        typ, hsize, size = struct.unpack_from('<HHI', buf, off)
        if typ == RES_XML_RESOURCE_MAP_TYPE:
            n = (size - hsize) // 4
            resources = {i: struct.unpack_from('<I', buf, off + hsize + i * 4)[0] for i in range(n)}
        elif typ == RES_XML_START_ELEMENT:
            ns_i, name_i = struct.unpack_from('<II', buf, off + 16)
            a_start, a_size, a_count = struct.unpack_from('<HHH', buf, off + 24)
            attrs = []
            for i in range(a_count):
                a = off + hsize + a_start + i * 20
                a_ns, a_name, a_raw = struct.unpack_from('<III', buf, a)
                _, a_res, a_type, a_data = struct.unpack_from('<HBBI', buf, a + 12)
                attrs.append({'ns': a_ns, 'name_i': a_name, 'raw_i': a_raw,
                              'type': a_type, 'data': a_data, 'res': a_res})
            events.append({'type': typ, 'ns_i': ns_i, 'name_i': name_i, 'attrs': attrs,
                           'line': struct.unpack_from('<I', buf, off + 8)[0]})
        elif typ == RES_XML_END_ELEMENT:
            ns_i, name_i = struct.unpack_from('<II', buf, off + 16)
            events.append({'type': typ, 'ns_i': ns_i, 'name_i': name_i})
        elif typ in (RES_XML_START_NS, RES_XML_END_NS, RES_XML_CDATA):
            events.append({'type': typ, 'raw': buf[off:off + size]})
        off += size
    return {'pool': pool, 'resources': resources, 'events': events, 'raw': buf}


def describe(buf):
    xml = read_xml(buf)
    S = xml['pool']['strings']
    lines = []
    for e in xml['events']:
        if e['type'] == RES_XML_START_ELEMENT:
            lines.append('<' + S[e['name_i']])
            for a in e['attrs']:
                if a['raw_i'] != 0xFFFFFFFF and a['type'] == TYPE_STRING:
                    v = repr(S[a['raw_i']])
                elif a['type'] == TYPE_INT_BOOL:
                    v = bool(a['data'])
                elif a['type'] == TYPE_REFERENCE:
                    v = f'@0x{a["data"]:08x}'
                elif a['type'] == TYPE_INT_HEX:
                    v = f'0x{a["data"]:x}'
                else:
                    v = a['data']
                lines.append(f"      {S[a['name_i']]} = {v}")
        elif e['type'] == RES_XML_END_ELEMENT:
            lines.append('</' + S[e['name_i']] + '>')
    return '\n'.join(lines)


# ─────────────────────────────── writing ───────────────────────────────
def _pool_string_utf8(s):
    body = s.encode('utf-8')
    out = bytearray()
    n = len(body)
    if n > 0x7f:
        out += bytes([(n >> 8) | 0x80, n & 0xff])
    else:
        out += bytes([n])
    out += bytes([n])            # utf-16 length (unused by parsers, mirrors what aapt2 does)
    out += body
    out += b'\x00'
    return bytes(out)


def build_string_pool(strings, utf8=False):
    """Serialize a string pool. `strings` keeps its order → indices stay valid."""
    offsets = []
    data = bytearray()
    if utf8:
        for s in strings:
            offsets.append(len(data))
            data += _pool_string_utf8(s)
    else:
        for s in strings:
            offsets.append(len(data))
            enc = s.encode('utf-16-le')
            n = len(s)
            if n > 0x7fff:
                raise ValueError('string too long')
            data += struct.pack('<H', n) + enc + b'\x00\x00'
    while len(data) % 4:
        data += b'\x00'
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    while (strings_start + len(data)) % 4:
        data += b'\x00'
    chunk_size = strings_start + len(data)
    out = bytearray()
    out += struct.pack('<HHI', RES_STRING_POOL_TYPE, header_size, chunk_size)
    out += struct.pack('<IIIII', len(strings), 0, (1 << 8) if utf8 else 0, strings_start, 0)
    for o in offsets:
        out += struct.pack('<I', o)
    out += data
    return bytes(out)


def build_resource_map(pairs):
    """pairs: list of (string_index, resource_id) — must be ordered by index."""
    out = bytearray()
    body = b''.join(struct.pack('<I', rid) for _, rid in pairs)
    out += struct.pack('<HHI', RES_XML_RESOURCE_MAP_TYPE, 8, 8 + len(body))
    out += body
    return bytes(out)


def encode_attr(entry, index_of):
    """Serialize one 20-byte attribute. Accepts both parsed (index based) and
    hand-made (name/raw as strings) attribute dicts."""
    def si_key(key):
        v = entry.get(key)
        if v is None:
            return 0xFFFFFFFF
        if isinstance(v, int):
            return v
        if v not in index_of:
            raise KeyError(f'string {v!r} missing from the pool')
        return index_of[v]

    ns = entry.get('ns', 0xFFFFFFFF)
    if ns is None:
        ns = 0xFFFFFFFF
    # an explicitly given string value wins over whatever we parsed earlier
    if entry.get('raw') is not None:
        raw_i = si_key('raw')
    elif entry.get('raw_i') is not None:
        raw_i = entry['raw_i']
    else:
        raw_i = 0xFFFFFFFF
    if entry.get('data_str') is not None:
        data = index_of[entry['data_str']]
    elif entry.get('raw') is not None and entry.get('type') == TYPE_STRING:
        data = si_key('raw')
    else:
        data = entry.get('data', 0)
    name_i = entry['name_i'] if 'name_i' in entry else si_key('name')
    return (struct.pack('<III', ns, name_i, raw_i)
            + struct.pack('<HBBI', 8, 0, entry['type'], data))


def build_xml(strings, resource_map, events):
    """Serialize a complete AXML document.

    strings       : full string pool (existing indices must stay in place)
    resource_map  : list of (string_index, resource_id) — attribute names
    events        : namespace (raw), start/end element descriptors
    """
    index_of = {s: i for i, s in enumerate(strings)}

    def si(name):
        if name not in index_of:
            raise KeyError(f'string {name!r} missing from the pool')
        return index_of[name]

    body = bytearray()
    for e in events:
        if e['type'] in (RES_XML_START_NS, RES_XML_END_NS, RES_XML_CDATA):
            body += e['raw']
        elif e['type'] == RES_XML_START_ELEMENT:
            a_count = len(e['attrs'])
            chunk = bytearray()
            chunk += struct.pack('<HHI', RES_XML_START_ELEMENT, 16, 0)
            chunk += struct.pack('<II', e.get('line', 0) & 0xFFFFFFFF, 0xFFFFFFFF)      # line, comment
            ns_i = e.get('ns')
            if ns_i is None:
                ns_i = 0xFFFFFFFF
            elif isinstance(ns_i, str):
                ns_i = si(ns_i)
            name_i = e['name_i'] if 'name_i' in e else si(e['name'])
            chunk += struct.pack('<II', ns_i, name_i)
            chunk += struct.pack('<HHH', 20, 20, a_count)       # attributeStart/size/count
            chunk += struct.pack('<HHH', 0, 0, 0)               # id/class/style index
            for a in e['attrs']:
                chunk += encode_attr(a, index_of)
            struct.pack_into('<I', chunk, 4, len(chunk))
            body += chunk
        elif e['type'] == RES_XML_END_ELEMENT:
            ns_i = e.get('ns')
            if ns_i is None:
                ns_i = 0xFFFFFFFF
            elif isinstance(ns_i, str):
                ns_i = si(ns_i)
            name_i = e['name_i'] if 'name_i' in e else si(e['name'])
            chunk = bytearray()
            chunk += struct.pack('<HHI', RES_XML_END_ELEMENT, 16, 0)
            chunk += struct.pack('<II', e.get('line', 0) & 0xFFFFFFFF, 0xFFFFFFFF)
            chunk += struct.pack('<II', ns_i, name_i)
            struct.pack_into('<I', chunk, 4, len(chunk))
            body += chunk
        else:
            raise ValueError(f'unsupported event type 0x{e["type"]:04x}')

    pool = build_string_pool(strings, utf8=False)
    rmap = build_resource_map(resource_map)
    total = 8 + len(pool) + len(rmap) + len(body)
    return struct.pack('<HHI', RES_XML_TYPE, 8, total) + pool + rmap + bytes(body)


# (the old duplicate reader/writer block lived here — removed)
