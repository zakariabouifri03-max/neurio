# Generates src/font.h from DejaVuSans.ttf:
#  - FONT1: 10x14 cells (1x), FONT2: 20x28 cells (2x), ASCII 32..126
#  - 4x supersampled scanline rasterization (even-odd)
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

CHARS = list(range(32, 127))


class Recorder(RecordingPen):
    def __init__(self):
        super().__init__()
        self.contours = []
        self._cur = None
        self._last_pt = (0, 0)

    def moveTo(self, p):
        self._cur = [(p[0], p[1], 1)]
        self._last_pt = (p[0], p[1])

    def lineTo(self, p):
        self._cur.append((p[0], p[1], 1))
        self._last_pt = (p[0], p[1])

    def qCurveTo(self, *pts):
        for p in pts[:-1]:
            self._cur.append((p[0], p[1], 0))
        self._cur.append((pts[-1][0], pts[-1][1], 1))
        self._last_pt = (pts[-1][0], pts[-1][1])

    def curveTo(self, *pts):
        p0 = self._last_pt
        cps = [tuple(p) for p in pts[:-1]]
        p1 = tuple(pts[-1])
        subdivide_cubic(p0, cps, p1, self._cur)
        self._last_pt = p1

    def closePath(self):
        if self._cur:
            self.contours.append(self._cur)
            self._cur = None

    def endPath(self):
        if self._cur:
            self.contours.append(self._cur)
            self._cur = None


def subdivide_cubic(p0, cps, p1, out, depth=0):
    if depth > 8:
        out.append((p1[0], p1[1], 1))
        return
    if len(cps) == 1:
        c = cps[0]
        mx = (p0[0] + 2 * c[0] + p1[0]) / 4
        my = (p0[1] + 2 * c[1] + p1[1]) / 4
        if abs(mx - (p0[0] + p1[0]) / 2) < 0.3 and abs(my - (p0[1] + p1[1]) / 2) < 0.3:
            out.append((c[0], c[1], 0))
            out.append((p1[0], p1[1], 1))
            return
        a = ((p0[0] + c[0]) / 2, (p0[1] + c[1]) / 2)
        b = ((c[0] + p1[0]) / 2, (c[1] + p1[1]) / 2)
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        out.append((a[0], a[1], 0))
        out.append((m[0], m[1], 0))
        out.append((b[0], b[1], 0))
        out.append((p1[0], p1[1], 1))
        return
    # general cubic (2 control points): de Casteljau at 0.5
    c1, c2 = cps
    def lerp(a, b):
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    p01 = lerp(p0, c1)
    p12 = lerp(c1, c2)
    p23 = lerp(c2, p1)
    p012 = lerp(p01, p12)
    p123 = lerp(p12, p23)
    p11 = lerp(p012, p123)
    # left half control points
    lc1 = p01
    lc2 = p012
    rc1 = p123
    rc2 = p23
    subdivide_cubic(p0, [lc1, lc2], p11, out, depth + 1)
    subdivide_cubic(p11, [rc1, rc2], p1, out, depth + 1)


def flatten_quad(x0, y0, cx, cy, x1, y1, depth=0):
    if depth > 6:
        return [(x0, y0, x1, y1)]
    mx = (x0 + 2 * cx + x1) / 4
    my = (y0 + 2 * cy + y1) / 4
    if abs(mx - (x0 + x1) / 2) < 0.15 and abs(my - (y0 + y1) / 2) < 0.15:
        return [(x0, y0, x1, y1)]
    x01, y01 = (x0 + cx) / 2, (y0 + cy) / 2
    x12, y12 = (cx + x1) / 2, (cy + y1) / 2
    xm, ym = (x01 + x12) / 2, (y01 + y12) / 2
    return flatten_quad(x0, y0, x01, y01, xm, ym, depth + 1) + \
           flatten_quad(xm, ym, x12, y12, x1, y1, depth + 1)


def contour_segments(contours):
    """Contour list [(x,y,oncurve),...] -> flat (x0,y0,x1,y1) segments."""
    segs = []
    for pts in contours:
        n = len(pts)
        if n < 2:
            continue
        i = 0
        while i < n and not pts[i][2]:
            i += 1
        i %= n
        px, py = pts[i][0], pts[i][1]
        j = (i + 1) % n
        steps = 0
        while steps < n:
            steps += 1
            if not pts[j][2]:
                segs.append((px, py, pts[j][0], pts[j][1], pts[(j + 1) % n][0], pts[(j + 1) % n][1]))
                px, py = pts[(j + 1) % n][0], pts[(j + 1) % n][1]
            else:
                segs.append((px, py, None, None, pts[j][0], pts[j][1]))
                px, py = pts[j][0], pts[j][1]
            j = (j + 1) % n
            if j == i:
                break
    out = []
    for s in segs:
        if s[2] is None:
            out.append((s[0], s[1], s[4], s[5]))
        else:
            out.extend(flatten_quad(s[0], s[1], s[2], s[3], s[4], s[5]))
    return out


def rasterize(width, height, segs, ss=4):
    """segs in pixel coords, y-DOWN. Returns width x height gray."""
    big_w, big_h = width * ss, height * ss
    events = [[] for _ in range(big_h)]
    for (x0, y0, x1, y1) in segs:
        if y0 == y1:
            continue
        x0s = x0 * ss
        x1s = x1 * ss
        lo = int(min(y0, y1) * ss)
        hi = int(max(y0, y1) * ss)
        lo = max(0, lo)
        hi = min(big_h - 1, hi)
        Y0, Y1 = y0 * ss, y1 * ss
        for row in range(lo, hi + 1):
            ymid = row + 0.5
            t = (ymid - Y0) / (Y1 - Y0)
            if -0.0001 <= t <= 1.0001:
                events[row].append(x0s + (x1s - x0s) * t)
    img = [[0] * big_w for _ in range(big_h)]
    for row in range(big_h):
        ev = sorted(events[row])
        inside = False
        col = 0
        for x in ev:
            xi = int(x)
            if xi >= big_w:
                break
            while col <= xi:
                if inside:
                    img[row][col] = 1
                col += 1
            inside = not inside
        if inside:
            while col < big_w:
                img[row][col] = 1
                col += 1
    out = [[0] * width for _ in range(height)]
    for r in range(height):
        for c in range(width):
            s = 0
            for dr in range(ss):
                for dc in range(ss):
                    s += img[r * ss + dr][c * ss + dc]
            out[r][c] = s * 255 // (ss * ss)
    return out


def gen(font, scale_w, scale_h, cap):
    upem = font['head'].unitsPerEm
    s = cap / (0.72 * upem)
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    px = {}
    adv = []
    base_y = scale_h - 3 if scale_w == 10 else scale_h - 6
    for c in CHARS:
        gname = cmap.get(c)
        img = [[0] * scale_w for _ in range(scale_h)]
        w = 1
        if gname is not None:
            g = glyphset[gname]
            w = g.width
            rec = Recorder()
            g.draw(rec)
            segs = contour_segments(rec.contours)
            if segs:
                minx = min(min(a, cx) for (a, b, cx, d) in segs)
                maxx = max(max(a, cx) for (a, b, cx, d) in segs)
                offx = 0.4 * s - minx * s
                tsegs = [(a * s + offx, base_y - b * s, cx * s + offx, base_y - d * s)
                         for (a, b, cx, d) in segs]
                img = rasterize(scale_w, scale_h, tsegs, ss=4)
        px[c] = img
        adv.append(max(1, min(scale_w, int(round((w or 1) * s)))))
    return px, adv


def emit(fname, adv, cells):
    h = 14 if fname == 'FONT1' else 28
    w = 10 if fname == 'FONT1' else 20
    lines = []
    lines.append(f"static const unsigned char {fname}_ADV[95] = {{{', '.join(str(x) for x in adv)}}};")
    allpx = []
    for c in CHARS:
        for row in cells[c]:
            allpx.extend(row)
    rows = []
    for i in range(0, len(allpx), 24):
        rows.append(','.join(str(x) for x in allpx[i:i + 24]))
    lines.append(f"static const unsigned char {fname}_PX[95*{h}*{w}] = [")
    lines.append(',\n'.join(rows))
    lines.append("];")
    return lines


def main():
    ttf = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    out = sys.argv[2] if len(sys.argv) > 2 else 'font.h'
    font = TTFont(ttf)
    p1, a1 = gen(font, 10, 14, 10)
    p2, a2 = gen(font, 20, 28, 21)

    def art(img, scale_w, scale_h):
        return '\n'.join(''.join('#' if v > 128 else ('+' if v > 40 else '.') for v in img[r])
                         for r in range(scale_h))
    for ch in 'A0x.':
        print(art(p1[ord(ch)], 10, 14))

    with open(out, 'w') as f:
        f.write("// AUTO-GENERATED by tools/gen_font.py (DejaVuSans, SIL OFL). Do not edit.\n")
        f.write("#pragma once\n")
        f.write("#define NEXUS_FONT1_W 10\n#define NEXUS_FONT1_H 14\n")
        f.write("#define NEXUS_FONT2_W 20\n#define NEXUS_FONT2_H 28\n")
        f.write("#define NEXUS_FONT_FIRST 32\n#define NEXUS_FONT_LAST 126\n")
        f.write('\n'.join(emit('FONT1', a1, p1)) + '\n')
        f.write('\n'.join(emit('FONT2', a2, p2)) + '\n')
    print("wrote", out)


if __name__ == '__main__':
    main()
