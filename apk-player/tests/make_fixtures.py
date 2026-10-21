#!/usr/bin/env python3
"""Builds the small synthetic APKs used by the CI smoke tests.

    python3 tests/make_fixtures.py [path/to/cordova.js]

  tests/fixtures/cordova-test.apk       Cordova app (assets/www) - must fire 'deviceready'
                                        inside the player and run in touch mode.
  tests/fixtures/native-unity-test.apk  "Unity" game (native libs) - the player must
                                        recognise it and explain that it needs Android.

Everything is generated from scratch (binary AndroidManifest.xml written below), so the
fixtures contain no third-party app code. cordova.js is Apache-2.0 (cordova-android 13);
pass its path or let the script fetch it with `npm pack cordova-android@13`.
"""
import io
import os
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")
ANDROID_NS = "http://schemas.android.com/apk/res/android"

# android:* attribute resource ids
ATTR_IDS = {
    "label": 0x01010001, "icon": 0x01010002, "name": 0x01010003, "screenOrientation": 0x0101001E,
    "minSdkVersion": 0x0101020C, "versionCode": 0x0101021B, "versionName": 0x0101021C,
    "targetSdkVersion": 0x01010270, "hardwareAccelerated": 0x010102D3,
}
TYPE_STRING, TYPE_INT_DEC, TYPE_INT_BOOLEAN = 0x03, 0x10, 0x12


# --------------------------------------------------------------------- binary XML (AXML)
class Axml:
    """Minimal writer for Android's compiled XML format."""

    def __init__(self):
        self.strings = []   # attribute names with resource ids come first (resource map order)
        self.index = {}
        self.events = []    # ('start', name, attrs) / ('end', name)

    def s(self, text):
        if text not in self.index:
            self.index[text] = len(self.strings)
            self.strings.append(text)
        return self.index[text]

    def start(self, name, attrs=()):
        self.events.append(("start", name, list(attrs)))

    def end(self, name):
        self.events.append(("end", name))

    def build(self):
        # 1) string pool order: android attribute names first (so the resource map lines up)
        names = []
        for ev in self.events:
            if ev[0] == "start":
                for (ns, n, v) in ev[2]:
                    if ns and n in ATTR_IDS and n not in names:
                        names.append(n)
        for n in names:
            self.s(n)
        self.s("android")
        self.s(ANDROID_NS)
        for ev in self.events:
            self.s(ev[1])
            if ev[0] == "start":
                for (ns, n, v) in ev[2]:
                    self.s(n)
                    if isinstance(v, str):
                        self.s(v)

        def pool():
            data = bytearray()
            offsets = []
            for t in self.strings:
                b = t.encode("utf-8")
                offsets.append(len(data))
                for n in (len(t), len(b)):
                    data += bytes([n]) if n < 0x80 else bytes([0x80 | (n >> 8), n & 0xFF])
                data += b + b"\0"
            while len(data) % 4:
                data += b"\0"
            hdr = 28
            strings_start = hdr + 4 * len(self.strings)
            body = b"".join(struct.pack("<I", o) for o in offsets) + bytes(data)
            return struct.pack("<HHIIIIII", 0x0001, hdr, hdr + len(body), len(self.strings), 0,
                               0x100, strings_start, 0) + body

        def resmap():
            ids = b"".join(struct.pack("<I", ATTR_IDS[n]) for n in names)
            return struct.pack("<HHI", 0x0180, 8, 8 + len(ids)) + ids

        chunks = bytearray()
        line = 1
        prefix, uri = self.s("android"), self.s(ANDROID_NS)
        chunks += struct.pack("<HHIIiII", 0x0100, 16, 24, line, -1, prefix, uri)
        for ev in self.events:
            line += 1
            if ev[0] == "start":
                attrs = sorted(ev[2], key=lambda a: ATTR_IDS.get(a[1], 0x7FFFFFFF) if a[0] else -1)
                body = bytearray()
                for (ns, n, v) in attrs:
                    nsi = uri if ns else 0xFFFFFFFF
                    if isinstance(v, bool):
                        raw, typ, data = 0xFFFFFFFF, TYPE_INT_BOOLEAN, 0xFFFFFFFF if v else 0
                    elif isinstance(v, int):
                        raw, typ, data = 0xFFFFFFFF, TYPE_INT_DEC, v & 0xFFFFFFFF
                    else:
                        raw, typ, data = self.s(v), TYPE_STRING, self.s(v)
                    body += struct.pack("<IIIHBBI", nsi, self.s(n), raw, 8, 0, typ, data)
                ext = struct.pack("<IIHHHHHH", 0xFFFFFFFF, self.s(ev[1]), 20, 20, len(attrs), 0, 0, 0)
                size = 16 + len(ext) + len(body)
                chunks += struct.pack("<HHIIi", 0x0102, 16, size, line, -1) + ext + body
            else:
                chunks += struct.pack("<HHIIiII", 0x0103, 16, 24, line, -1, 0xFFFFFFFF, self.s(ev[1]))
        chunks += struct.pack("<HHIIiII", 0x0101, 16, 24, line + 1, -1, prefix, uri)

        body = pool() + resmap() + bytes(chunks)
        return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


def manifest(package, label, version_name, version_code, orientation):
    x = Axml()
    A = True  # "android:" namespace
    x.start("manifest", [(A, "versionCode", version_code), (A, "versionName", version_name), (None, "package", package)])
    x.start("uses-sdk", [(A, "minSdkVersion", 24), (A, "targetSdkVersion", 34)])
    x.end("uses-sdk")
    x.start("application", [(A, "label", label), (A, "hardwareAccelerated", True)])
    x.start("activity", [(A, "name", ".MainActivity"), (A, "screenOrientation", orientation)])
    x.start("intent-filter")
    x.start("action", [(A, "name", "android.intent.action.MAIN")])
    x.end("action")
    x.start("category", [(A, "name", "android.intent.category.LAUNCHER")])
    x.end("category")
    x.end("intent-filter")
    x.end("activity")
    x.end("application")
    x.end("manifest")
    return x.build()


# --------------------------------------------------------------------- tiny PNG icon (no Pillow needed)
def png_icon(size, top, bottom, mark):
    import zlib
    rows = []
    r = size * 0.22
    for y in range(size):
        row = bytearray([0])
        t = y / (size - 1)
        col = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for xx in range(size):
            # rounded square mask
            dx = max(r - xx, 0, xx - (size - 1 - r))
            dy = max(r - y, 0, y - (size - 1 - r))
            inside = dx * dx + dy * dy <= r * r
            px = col + (255,) if inside else (0, 0, 0, 0)
            if inside and mark(xx / size, y / size):
                px = (255, 255, 255, 255)
            row += bytes(px)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", raw) + chunk(b"IEND", b""))


def mark_c(u, v):  # a ring ("C" for Cordova)
    d = ((u - .5) ** 2 + (v - .5) ** 2) ** .5
    return .2 < d < .3 and not (u > .55 and abs(v - .5) < .12)


def mark_cube(u, v):  # a hollow square (3D cube-ish, for "Unity")
    return .28 < u < .72 and .28 < v < .72 and not (.36 < u < .64 and .36 < v < .64)


# --------------------------------------------------------------------- the web app of the Cordova fixture
INDEX_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: gap: https://ssl.gstatic.com 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src *; img-src 'self' data: content:;">
<meta name="viewport" content="initial-scale=1, width=device-width, viewport-fit=cover">
<title>Cordova Test</title>
<style>
  html, body { margin: 0; height: 100%; background: #10233f; color: #fff; font: 18px/1.4 system-ui, sans-serif; }
  #app { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
  h1 { margin: 0; font-size: 30px; }
  #status { padding: 8px 18px; border-radius: 99px; background: #b45309; font-weight: 700; }
  #status.ok { background: #15803d; }
  #pad { width: 340px; height: 160px; border-radius: 16px; background: rgba(255,255,255,.08); touch-action: none; }
  small { opacity: .7; }
</style>
</head>
<body>
<div id="app">
  <h1>Cordova test app</h1>
  <div id="status">Waiting for deviceready...</div>
  <div id="touch">-</div>
  <canvas id="pad" width="340" height="160"></canvas>
  <small>Draw in the box with the mouse (it acts like a finger in touch mode).</small>
</div>
<script src="cordova.js"></script>
<script src="js/index.js"></script>
</body>
</html>
"""

INDEX_JS = r"""// Cordova fixture for Neurio APK Player CI. (No keyboard handlers on purpose: the
// player must pick touch mode for this app.)
document.addEventListener('deviceready', function () {
  document.title = 'DEVICE READY';
  var s = document.getElementById('status');
  s.textContent = 'deviceready fired - cordova ' + cordova.version + ' (' + cordova.platformId + ')';
  s.className = 'ok';
  document.getElementById('touch').textContent =
    'maxTouchPoints = ' + navigator.maxTouchPoints + ' | ontouchstart: ' + ('ontouchstart' in window);
}, false);

(function () {
  var c = document.getElementById('pad'), g = c.getContext('2d'), last = null;
  g.strokeStyle = '#38bdf8'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(30, 120); g.quadraticCurveTo(170, 10, 310, 120); g.stroke();
  function pos(t) { var r = c.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; }
  c.addEventListener('touchstart', function (e) { last = pos(e.touches[0]); e.preventDefault(); });
  c.addEventListener('touchmove', function (e) {
    var p = pos(e.touches[0]);
    if (last) { g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke(); }
    last = p; e.preventDefault();
  });
  c.addEventListener('touchend', function () { last = null; });
})();
"""

PLUGINS_JS = """cordova.define('cordova/plugin_list', function (require, exports, module) {
  module.exports = [];
  module.exports.metadata = {};
});
"""


def cordova_js(arg):
    if arg and os.path.exists(arg):
        return open(arg, "rb").read()
    for p in ("/tmp/cdv/package/templates/project/assets/www/cordova.js",):
        if os.path.exists(p):
            return open(p, "rb").read()
    with tempfile.TemporaryDirectory() as d:
        subprocess.check_call(["npm", "pack", "cordova-android@13", "--silent"], cwd=d, shell=os.name == "nt")
        tgz = [f for f in os.listdir(d) if f.endswith(".tgz")][0]
        with tarfile.open(os.path.join(d, tgz)) as t:
            return t.extractfile("package/templates/project/assets/www/cordova.js").read()


def write_apk(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if name.endswith((".png", ".so", ".arsc")) else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    print("wrote", os.path.relpath(path), os.path.getsize(path), "bytes")


def fake_elf(tag):
    # just enough to look like an arm64 shared object to a file-type sniffer
    return b"\x7fELF\x02\x01\x01" + b"\0" * 9 + struct.pack("<HHI", 3, 183, 1) + tag.encode() + b"\0" * 200


def main():
    os.makedirs(OUT, exist_ok=True)
    cdv = cordova_js(sys.argv[1] if len(sys.argv) > 1 else None)
    write_apk(os.path.join(OUT, "cordova-test.apk"), [
        ("AndroidManifest.xml", manifest("org.neurio.test.cordova", "Cordova Test", "1.2.3", 10203, 1)),  # 1 = portrait
        ("res/mipmap-xxhdpi/ic_launcher.png", png_icon(96, (56, 189, 248), (30, 64, 175), mark_c)),
        ("assets/www/index.html", INDEX_HTML.encode()),
        ("assets/www/cordova.js", cdv),
        ("assets/www/cordova_plugins.js", PLUGINS_JS.encode()),
        ("assets/www/js/index.js", INDEX_JS.encode()),
    ])
    write_apk(os.path.join(OUT, "native-unity-test.apk"), [
        ("AndroidManifest.xml", manifest("org.neurio.test.unity", "Unity Test", "0.9", 9, 0)),  # 0 = landscape
        ("res/mipmap-xxhdpi/ic_launcher.png", png_icon(96, (82, 82, 91), (24, 24, 27), mark_cube)),
        ("classes.dex", b"dex\n035\0" + b"\0" * 104),
        ("lib/arm64-v8a/libunity.so", fake_elf("unity")),
        ("lib/arm64-v8a/libil2cpp.so", fake_elf("il2cpp")),
        ("lib/arm64-v8a/libmain.so", fake_elf("main")),
        ("assets/bin/Data/data.unity3d", b"UnityFS\0" + b"\0" * 64),
    ])


if __name__ == "__main__":
    main()
