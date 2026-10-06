package com.aivision.camera.ai.core;

/**
 * Multi-frame registration. Handheld bursts are never perfectly still, so before any stacking or
 * super-resolution the frames have to be brought onto a common grid.
 *
 * <p>Two levels of alignment are computed:
 * <ul>
 *   <li>a global similarity transform (translation + rotation + scale) from a coarse-to-fine
 *       pyramid search with per-quadrant displacement fitting, and</li>
 *   <li>a per-tile translation field (default 16x16 tiles) that absorbs the residual parallax and
 *       rolling-shutter wobble which a global model cannot describe.</li>
 * </ul>
 * The sub-pixel part of the estimates is exactly what the super-resolution stage needs to extract
 * real resolution beyond one sampling grid.
 */
public final class Align {

    private Align() {
    }

    /**
     * Motion convention (single source of truth for the whole engine):
     *
     * <pre>
     *   reference(x, y)  ==  frame( F(x, y) )
     *   F(x, y) = scale * R(rot) * (x - c) + c + t          with c = image centre
     * </pre>
     *
     * In words: {@code m.tx/m.ty} are the offsets at which the frame must be <em>sampled</em> to
     * line up with the reference, which is exactly what the SAD search measures
     * ({@code sum|frame(x + tx) - reference(x)|}). Everything - warp, stacking, tile fields and
     * super resolution - is derived from this one formula, so no stage can drift out of sync.
     */
    public static final class Motion {
        public float tx, ty;      // translation, in pixels of the working resolution
        public float rot;         // radians
        public float scale = 1f;
        public float residual;    // mean absolute residual after alignment (lower = better)
        public boolean valid;

        public Motion copy() {
            Motion m = new Motion();
            m.tx = tx;
            m.ty = ty;
            m.rot = rot;
            m.scale = scale;
            m.residual = residual;
            m.valid = valid;
            return m;
        }

        public String toString() {
            return String.format(java.util.Locale.US, "t=(%.2f,%.2f) rot=%.3f s=%.4f res=%.4f",
                    tx, ty, rot, scale, residual);
        }
    }

    /** Result of the tile level alignment: per tile displacement in pixels. */
    public static final class Field {
        public int cols, rows;
        public int tile;                 // tile size in pixels
        public int imgW, imgH;
        public float[] dx, dy;           // per tile displacement
        public float[] confidence;       // 0..1

        public Field(int cols, int rows, int tile, int imgW, int imgH) {
            this.cols = cols;
            this.rows = rows;
            this.tile = tile;
            this.imgW = imgW;
            this.imgH = imgH;
            dx = new float[cols * rows];
            dy = new float[cols * rows];
            confidence = new float[cols * rows];
        }

        public float dxAt(float x, float y) {
            return sample(dx, x, y);
        }

        public float dyAt(float x, float y) {
            return sample(dy, x, y);
        }

        private float sample(float[] f, float x, float y) {
            float fx = x / tile - 0.5f, fy = y / tile - 0.5f;
            int x0 = (int) Math.floor(fx), y0 = (int) Math.floor(fy);
            int x1 = x0 + 1, y1 = y0 + 1;
            float txx = fx - x0, tyy = fy - y0;
            x0 = Img.clampI(x0, 0, cols - 1);
            x1 = Img.clampI(x1, 0, cols - 1);
            y0 = Img.clampI(y0, 0, rows - 1);
            y1 = Img.clampI(y1, 0, rows - 1);
            float v00 = f[y0 * cols + x0], v10 = f[y0 * cols + x1];
            float v01 = f[y1 * cols + x0], v11 = f[y1 * cols + x1];
            return Img.lerp(Img.lerp(v00, v10, txx), Img.lerp(v01, v11, txx), tyy);
        }
    }

    // ------------------------------------------------------------------ global motion

    public static Motion estimate(Img ref, Img frame) {
        return estimate(ref, frame, 24, 1.6f);
    }

    /**
     * @param maxShift  maximum expected displacement in working-resolution pixels
     * @param maxRotDeg maximum expected rotation in degrees
     */
    public static Motion estimate(Img ref, Img frame, int maxShift, float maxRotDeg) {
        // Registration runs on half resolution above 1.1 MP: a 0.01 px estimate at half resolution is
        // 0.02 px at full resolution, which is far below anything that matters, and it makes the
        // stage four times faster on a phone.
        int shrink = Math.max(ref.w, ref.h) > 1100 ? 2 : 1;
        Img r2 = shrink == 1 ? ref : ref.scaled(ref.w / 2, ref.h / 2);
        Img f2 = shrink == 1 ? frame : frame.scaled(frame.w / 2, frame.h / 2);
        Motion result = estimateInternal(r2, f2, maxShift / shrink, maxRotDeg);
        if (shrink > 1) {
            result.tx *= shrink;
            result.ty *= shrink;
        }
        return result;
    }

    private static Motion estimateInternal(Img ref, Img frame, int maxShift, float maxRotDeg) {
        final int w = ref.w, h = ref.h;
        float[] a = toGray(ref);
        float[] b = toGray(frame);
        // pyramid
        float[][] pa = pyramid(a, w, h, 3);
        float[][] pb = pyramid(b, w, h, 3);
        int[] pw = new int[3], ph = new int[3];
       {
            int cw = w, ch = h;
            for (int l = 0; l < 3; l++) {
                pw[l] = cw;
                ph[l] = ch;
                cw = Math.max(2, cw / 2);
                ch = Math.max(2, ch / 2);
            }
        }
        // coarse translation search
        Motion m = new Motion();
        m.valid = false;
        float best = Float.MAX_VALUE;
        int ls = Math.max(2, maxShift / 4);
        for (int dy = -ls; dy <= ls; dy++) {
            for (int dx = -ls; dx <= ls; dx++) {
                float e = sad(pa[2], pb[2], pw[2], ph[2], dx, dy, 3);
                if (e < best) {
                    best = e;
                    m.tx = dx;
                    m.ty = dy;
                }
            }
        }
        // refine translation through the finer levels (scale the pyramid estimate up, then search)
        for (int l = 1; l >= 0; l--) {
            m.tx *= 2f;
            m.ty *= 2f;
            float bt = Float.MAX_VALUE;
            float bx = m.tx, by = m.ty;
            // subsample the SAD: every 3rd pixel is statistically identical and 9x cheaper
            int step = l == 0 ? 3 : 2;
            for (int dy = -3; dy <= 3; dy++) {
                for (int dx = -3; dx <= 3; dx++) {
                    float e = sad(pa[l], pb[l], pw[l], ph[l], m.tx + dx, m.ty + dy, step);
                    if (e < bt) {
                        bt = e;
                        bx = m.tx + dx;
                        by = m.ty + dy;
                    }
                }
            }
            m.tx = bx;
            m.ty = by;
        }
        // sub-pixel refinement on the finest level using a quadratic fit
        float s0 = sad(pa[0], pb[0], pw[0], ph[0], m.tx, m.ty, 3);
        float sx1 = sad(pa[0], pb[0], pw[0], ph[0], m.tx + 1, m.ty, 3);
        float sx0 = sad(pa[0], pb[0], pw[0], ph[0], m.tx - 1, m.ty, 3);
        float sy1 = sad(pa[0], pb[0], pw[0], ph[0], m.tx, m.ty + 1, 3);
        float sy0 = sad(pa[0], pb[0], pw[0], ph[0], m.tx, m.ty - 1, 3);
        m.tx += subpixel(sx0, s0, sx1);
        m.ty += subpixel(sy0, s0, sy1);

        // ---- rotation + scale from four quadrant displacements (least squares for a similarity)
        float[] qx = new float[4], qy = new float[4], qdx = new float[4], qdy = new float[4];
        int qi = 0;
        int hw = w / 2, hh = h / 2;
        int qs = Math.max(3, Math.min(5, maxShift / 3));
        boolean quadrantOk = true;
        for (int cy = 0; cy < 2 && quadrantOk; cy++) {
            for (int cx = 0; cx < 2 && quadrantOk; cx++) {
                int x0 = cx * hw, y0 = cy * hh;
                int x1 = Math.min(w, x0 + hw), y1 = Math.min(h, y0 + hh);
                float cxp = (x0 + x1) * 0.5f, cyp = (y0 + y1) * 0.5f;
                float bx2 = m.tx, by2 = m.ty;
                float be = Float.MAX_VALUE;
                for (int dy = -qs; dy <= qs; dy += 2) {
                    for (int dx = -qs; dx <= qs; dx += 2) {
                        float e = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1,
                                Math.round(m.tx) + dx, Math.round(m.ty) + dy, 4);
                        if (e < be) {
                            be = e;
                            bx2 = Math.round(m.tx) + dx;
                            by2 = Math.round(m.ty) + dy;
                        }
                    }
                }
                if (be >= Float.MAX_VALUE) {
                    quadrantOk = false;
                    break;
                }
                // per quadrant sub-pixel refinement so the similarity fit is not fed 1px noise
                float q0 = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1, bx2, by2, 1);
                float qx1 = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1, bx2 + 1, by2, 1);
                float qx0 = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1, bx2 - 1, by2, 1);
                float qy1 = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1, bx2, by2 + 1, 1);
                float qy0 = sadRegion(pa[0], pb[0], w, h, x0, y0, x1, y1, bx2, by2 - 1, 1);
                qx[qi] = cxp - w * 0.5f;
                qy[qi] = cyp - h * 0.5f;
                qdx[qi] = bx2 + subpixel(qx0, q0, qx1);
                qdy[qi] = by2 + subpixel(qy0, q0, qy1);
                qi++;
            }
        }
        float eTrans = residual(pa[0], pb[0], w, h, m);
        Motion quadCand = null;
        if (quadrantOk && qi == 4) {
            float[] sim = fitSimilarity(qx, qy, qdx, qdy);
            float rot = sim[0], sc = sim[1], tx2 = sim[2], ty2 = sim[3];
            if (!Float.isFinite(rot) || !Float.isFinite(sc) || !Float.isFinite(tx2) || !Float.isFinite(ty2)) {
                rot = 0;
                sc = 1f;
                tx2 = m.tx;
                ty2 = m.ty;
            }
            if (Math.abs(rot) > Math.toRadians(Math.min(2.5f, maxRotDeg))) rot = 0;
            if (sc < 0.985f || sc > 1.015f) sc = 1f;
            tx2 = Img.mix(tx2, m.tx, 0.35f);
            ty2 = Img.mix(ty2, m.ty, 0.35f);
            Motion cand = new Motion();
            cand.tx = tx2;
            cand.ty = ty2;
            cand.rot = rot;
            cand.scale = sc;
            if (residual(pa[0], pb[0], w, h, cand) < eTrans * 0.99f) quadCand = cand;
        }

        // ---- final Lucas-Kanade refinement: sub-pixel accuracy for stacking and super resolution
        Lk lk = new Lk(ref, frame);
        Motion bestMotion = lk.refine(m, 6, true);
        if (quadCand != null) {
            Motion fromQuad = lk.refine(quadCand, 6, true);
            if (fromQuad.residual < bestMotion.residual) bestMotion = fromQuad;
        }
        // if the rotation/scale pulled the fit somewhere implausible, fall back to translation only
        if (Math.abs(bestMotion.rot) > 0.012f || Math.abs(bestMotion.scale - 1f) > 0.004f) {
            Motion transOnly = lk.refine(m, 5, false);
            if (transOnly.residual < bestMotion.residual + 2e-5f) bestMotion = transOnly;
        }
        // a handheld burst never rotates or zooms much: reject runaway fits
        if (Math.abs(bestMotion.rot) > Math.toRadians(Math.min(3f, maxRotDeg))) {
            bestMotion.rot = 0;
            bestMotion.scale = 1f;
        }
        if (bestMotion.scale < 0.97f || bestMotion.scale > 1.03f) {
            bestMotion.rot = 0;
            bestMotion.scale = 1f;
        }
        bestMotion.valid = true;
        return bestMotion;
    }

    private static float subpixel(float a, float b, float c) {
        float denom = (a - 2 * b + c);
        if (Math.abs(denom) < 1e-6f) return 0;
        float d = 0.5f * (a - c) / denom;
        return Img.clamp(d, -1f, 1f);
    }

    /** Solves for rotation, scale, tx, ty that best explain the quadrant displacements. */
    private static float[] fitSimilarity(float[] x, float[] y, float[] dx, float[] dy) {
        // model: dx = tx + a*x - b*y ;  dy = ty + b*x + a*y  with a = (s-1), b = theta
        double sxx = 0, syy = 0, n = x.length;
        for (int i = 0; i < n; i++) {
            sxx += x[i] * x[i];
            syy += y[i] * y[i];
        }
        double sumX = 0, sumY = 0, sumA = 0, sumB = 0;
        for (int i = 0; i < n; i++) {
            sumX += dx[i];
            sumY += dy[i];
            sumA += x[i] * dx[i] + y[i] * dy[i];
            sumB += x[i] * dy[i] - y[i] * dx[i];
        }
        double denomA = sxx + syy + 1e-6;
        double a = sumA / denomA;
        double b = sumB / denomA;
        double tx = sumX / n;
        double ty = sumY / n;
        return new float[]{(float) b, (float) (1 + a), (float) tx, (float) ty};
    }

    private static float residual(float[] a, float[] b, int w, int h, Motion m) {
        float sum = 0;
        int cnt = 0;
        float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
        for (int y = 4; y < h - 4; y += 3) {
            for (int x = 4; x < w - 4; x += 3) {
                float cx = x - w * 0.5f, cy = y - h * 0.5f;
                float px = cx * m.scale, py = cy * m.scale;
                float rx = px * cos - py * sin + w * 0.5f + m.tx;
                float ry = px * sin + py * cos + h * 0.5f + m.ty;
                float v = sampleGray(b, w, h, rx, ry);
                sum += Math.abs(v - a[y * w + x]);
                cnt++;
            }
        }
        return cnt == 0 ? Float.MAX_VALUE : sum / cnt;
    }

    /** Zero mean SAD over a shifted overlap; robust against exposure differences. */
    private static float sad(float[] a, float[] b, int w, int h, float dx, float dy, int step) {
        return sadRegion(a, b, w, h, 0, 0, w, h, dx, dy, step);
    }

    private static float sadRegion(float[] a, float[] b, int w, int h, int x0, int y0, int x1, int y1,
                                   float dx, float dy, int step) {
        int xs = Math.max(x0, (int) Math.ceil(-dx));
        int xe = Math.min(x1, (int) Math.floor(w - 1 - dx));
        int ys = Math.max(y0, (int) Math.ceil(-dy));
        int ye = Math.min(y1, (int) Math.floor(h - 1 - dy));
        if (xe <= xs || ye <= ys) return Float.MAX_VALUE;
        double sum = 0;
        int cnt = 0;
        for (int y = ys; y < ye; y += step) {
            for (int x = xs; x < xe; x += step) {
                float v = sampleGray(b, w, h, x + dx, y + dy);
                sum += Math.abs(v - a[y * w + x]);
                cnt++;
            }
        }
        if (cnt == 0) return Float.MAX_VALUE;
        return (float) (sum / cnt);
    }

    static float sampleGray(float[] p, int w, int h, float x, float y) {
        if (x < 0) x = 0;
        else if (x > w - 1.001f) x = w - 1.001f;
        if (y < 0) y = 0;
        else if (y > h - 1.001f) y = h - 1.001f;
        int x0 = (int) x, y0 = (int) y;
        int x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        float fx = x - x0, fy = y - y0;
        float v00 = p[y0 * w + x0], v10 = p[y0 * w + x1];
        float v01 = p[y1 * w + x0], v11 = p[y1 * w + x1];
        return Img.lerp(Img.lerp(v00, v10, fx), Img.lerp(v01, v11, fx), fy);
    }

    static float[] toGray(Img img) {
        float[] g = new float[img.w * img.h];
        for (int i = 0; i < g.length; i++) {
            int c = img.px[i];
            g[i] = (0.299f * Img.R(c) + 0.587f * Img.G(c) + 0.114f * Img.B(c)) * (1f / 255f);
        }
        return g;
    }

    private static float[][] pyramid(float[] src, int w, int h, int levels) {
        float[][] out = new float[levels][];
        out[0] = src;
        int cw = w, ch = h;
        for (int l = 1; l < levels; l++) {
            int nw = Math.max(2, cw / 2), nh = Math.max(2, ch / 2);
            float[] prev = out[l - 1];
            float[] next = new float[nw * nh];
            for (int y = 0; y < nh; y++) {
                for (int x = 0; x < nw; x++) {
                    int sx = Math.min(cw - 1, x * 2), sy = Math.min(ch - 1, y * 2);
                    int sx1 = Math.min(cw - 1, sx + 1), sy1 = Math.min(ch - 1, sy + 1);
                    float v = (prev[sy * cw + sx] + prev[sy * cw + sx1] + prev[sy1 * cw + sx] + prev[sy1 * cw + sx1]) * 0.25f;
                    next[y * nw + x] = v;
                }
            }
            out[l] = next;
            cw = nw;
            ch = nh;
        }
        return out;
    }

    // ------------------------------------------------------------------ tile field

    /**
     * Per-tile displacement field, stored as a <em>residual offset in source space</em>: the merge
     * samples {@code frame(F(x,y) - field(x,y))}. Splitting it this way means the field only has to
     * describe what the global similarity model could not explain - parallax, rolling shutter
     * wobble, subject motion - which is typically a fraction of a pixel and never double counts the
     * global translation.
     */
    public static Field tileField(Img ref, Img frame, Motion global, int tileSize, int search) {
        final int w = ref.w, h = ref.h;
        int cols = Math.max(1, (w + tileSize - 1) / tileSize);
        int rows = Math.max(1, (h + tileSize - 1) / tileSize);
        Field f = new Field(cols, rows, tileSize, w, h);
        float[] a = toGray(ref);
        float[] b = toGray(frame);
        for (int ty = 0; ty < rows; ty++) {
            for (int tx = 0; tx < cols; tx++) {
                int x0 = tx * tileSize, y0 = ty * tileSize;
                int x1 = Math.min(w, x0 + tileSize), y1 = Math.min(h, y0 + tileSize);
                float cxp = (x0 + x1) * 0.5f, cyp = (y0 + y1) * 0.5f;
                float gsx = forwardX(cxp, cyp, w, h, global);
                float gsy = forwardY(cxp, cyp, w, h, global);
                float bd = Float.MAX_VALUE, box = 0, boy = 0;
                for (int oy = -search; oy <= search; oy++) {
                    for (int ox = -search; ox <= search; ox++) {
                        float e = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, ox, oy, 1);
                        if (e < bd) {
                            bd = e;
                            box = ox;
                            boy = oy;
                        }
                    }
                }
                // sub-pixel refinement on the residual offset
                float s0 = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, box, boy, 1);
                float sx1 = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, box + 1, boy, 1);
                float sx0 = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, box - 1, boy, 1);
                float sy1 = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, box, boy + 1, 1);
                float sy0 = tileSad(a, b, w, h, x0, y0, x1, y1, gsx, gsy, cxp, cyp, box, boy - 1, 1);
                float rdx = box + subpixel(sx0, s0, sx1);
                float rdy = boy + subpixel(sy0, s0, sy1);
                // confidence from the texture energy inside the tile: a flat wall cannot be tracked
                float energy = 0;
                int cnt = 0;
                for (int y = y0 + 2; y < y1 - 2; y += 2) {
                    for (int x = x0 + 2; x < x1 - 2; x += 2) {
                        float gxx = a[y * w + Math.min(w - 1, x + 1)] - a[y * w + Math.max(0, x - 1)];
                        float gyy = a[Math.min(h - 1, y + 1) * w + x] - a[Math.max(0, y - 1) * w + x];
                        energy += Math.abs(gxx) + Math.abs(gyy);
                        cnt++;
                    }
                }
                float conf = cnt == 0 ? 0 : Img.clamp01((energy / cnt) * 22f);
                int idx = ty * cols + tx;
                f.dx[idx] = rdx;
                f.dy[idx] = rdy;
                f.confidence[idx] = conf;
            }
        }
        smoothField(f.dx, cols, rows);
        smoothField(f.dy, cols, rows);
        return f;
    }

    /** SAD between the tile of {@code a} and the shifted (residual-offset) tile of {@code b}. */
    private static float tileSad(float[] a, float[] b, int w, int h, int x0, int y0, int x1, int y1,
                                 float baseX, float baseY, float cxp, float cyp, float ox, float oy, int step) {
        double sum = 0;
        int cnt = 0;
        float offX = baseX + ox - cxp, offY = baseY + oy - cyp;
        for (int y = y0; y < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                float v = sampleGray(b, w, h, x + offX, y + offY);
                sum += Math.abs(v - a[y * w + x]);
                cnt++;
            }
        }
        return cnt == 0 ? Float.MAX_VALUE : (float) (sum / cnt);
    }

    private static void smoothField(float[] f, int cols, int rows) {
        float[] out = new float[f.length];
        for (int y = 0; y < rows; y++) {
            for (int x = 0; x < cols; x++) {
                float sum = 0;
                int cnt = 0;
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = Img.clampI(x + dx, 0, cols - 1), yy = Img.clampI(y + dy, 0, rows - 1);
                        float wgt = (dx == 0 && dy == 0) ? 3f : 1f;
                        sum += f[yy * cols + xx] * wgt;
                        cnt += wgt;
                    }
                }
                out[y * cols + x] = sum / cnt;
            }
        }
        System.arraycopy(out, 0, f, 0, f.length);
    }

    // ------------------------------------------------------------------ warping

    /** Source coordinate of the reference pixel (x,y) under the motion convention above. */
    public static float forwardX(float x, float y, int w, int h, Motion m) {
        float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
        float cx = x - w * 0.5f, cy = y - h * 0.5f;
        float px = cx * m.scale, py = cy * m.scale;
        return px * cos - py * sin + w * 0.5f + m.tx;
    }

    public static float forwardY(float x, float y, int w, int h, Motion m) {
        float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
        float cx = x - w * 0.5f, cy = y - h * 0.5f;
        float px = cx * m.scale, py = cy * m.scale;
        return px * sin + py * cos + h * 0.5f + m.ty;
    }

    /** Resamples {@code src} into the reference grid: out(x,y) = src(F(x,y)). */
    public static Img warp(Img src, Motion m, Img dstTemplate) {
        int w = dstTemplate.w, h = dstTemplate.h;
        Img out = new Img(w, h);
        float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
        for (int y = 0; y < h; y++) {
            float cy = y - h * 0.5f;
            for (int x = 0; x < w; x++) {
                float cx = x - w * 0.5f;
                float px = cx * m.scale, py = cy * m.scale;
                float sx = px * cos - py * sin + w * 0.5f + m.tx;
                float sy = px * sin + py * cos + h * 0.5f + m.ty;
                out.px[y * w + x] = src.sampleCubic(sx, sy);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ Lucas-Kanade refinement

    /**
     * Four parameter Lucas-Kanade refinement (translation, rotation, scale) against a noise reduced
     * gradient image with Huber weighted residuals.
     *
     * <p>The pyramid search above finds the right basin to within about a pixel; this stage is what
     * turns it into an eighth-of-a-pixel estimate, which is the accuracy the stacker and especially
     * the super resolution stage need. A parabola fit on a SAD surface is simply not accurate enough
     * on noisy handheld frames.
     */
    static final class Lk {
        final int w, h;
        final float[] a, b, ix, iy;

        Lk(Img ref, Img frame) {
            w = ref.w;
            h = ref.h;
            a = toGray(ref);
            b = toGray(frame);
            box3(a, w, h);
            box3(b, w, h);
            ix = new float[w * h];
            iy = new float[w * h];
            gradients(b, w, h, ix, iy);
        }

        Motion refine(Motion start, int iters, boolean allowRotScale) {
            return refineLK(this, start, iters, allowRotScale);
        }
    }

    static Motion refineLK(Lk ctx, Motion start, int iters, boolean allowRotScale) {
        final int w = ctx.w, h = ctx.h;
        final float[] a = ctx.a, b = ctx.b, ix = ctx.ix, iy = ctx.iy;
        Motion m = new Motion();
        m.tx = start.tx;
        m.ty = start.ty;
        m.rot = allowRotScale ? start.rot : 0f;
        m.scale = allowRotScale ? start.scale : 1f;
        final int nP = allowRotScale ? 4 : 2;
        final int bands = Math.max(1, Math.min(Parallel.threads() * 2, h / 64));
        final double[][][] partH = new double[bands][nP][nP];
        final double[][] partG = new double[bands][nP];
        final int[] partCnt = new int[bands];
        for (int it = 0; it < iters; it++) {
            for (int bidx = 0; bidx < bands; bidx++) {
                partCnt[bidx] = 0;
                partG[bidx] = new double[nP];
                partH[bidx] = new double[nP][nP];
            }
            final float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
            final float cw = w * 0.5f, ch = h * 0.5f;
            final int step = it < iters / 2 ? 3 : 2;
            final float ttx = m.tx, tty = m.ty, tsc = m.scale;
            final boolean rotScale = allowRotScale && nP == 4;
            try {
                Parallel.rowsIndexed(h - 8, bands, new Parallel.IndexedBand() {
                    @Override
                    public void run(int index, int y0, int y1) {
                        double[][] H = partH[index];
                        double[] g = partG[index];
                        for (int yy = y0; yy < y1; yy += step) {
                            int y = yy + 4;
                            for (int x = 4; x < w - 4; x += step) {
                                float cx = x - cw, cy = y - ch;
                                float rx = cx * cos - cy * sin, ry = cx * sin + cy * cos;
                                float sx = rx * tsc + cw + ttx;
                                float sy = ry * tsc + ch + tty;
                                if (sx < 3 || sy < 3 || sx > w - 4 || sy > h - 4) continue;
                                float bv = sampleGray(b, w, h, sx, sy);
                                float e = a[y * w + x] - bv;
                                float ae = Math.abs(e);
                                float wgt = ae > 0.08f ? 0.08f / ae : 1f;
                                float gx = sampleGray(ix, w, h, sx, sy);
                                float gy = sampleGray(iy, w, h, sx, sy);
                                double j0 = gx, j1 = gy, j2 = 0, j3 = 0;
                                if (rotScale) {
                                    // d(sample)/d(theta) and d(sample)/d(scale)
                                    j2 = gx * ((-sin * cx - cos * cy) * tsc) + gy * ((cos * cx - sin * cy) * tsc);
                                    j3 = gx * rx + gy * ry;
                                }
                                double we = wgt * e;
                                H[0][0] += wgt * j0 * j0;
                                H[0][1] += wgt * j0 * j1;
                                H[1][1] += wgt * j1 * j1;
                                g[0] += j0 * we;
                                g[1] += j1 * we;
                                if (rotScale) {
                                    H[0][2] += wgt * j0 * j2;
                                    H[0][3] += wgt * j0 * j3;
                                    H[1][2] += wgt * j1 * j2;
                                    H[1][3] += wgt * j1 * j3;
                                    H[2][2] += wgt * j2 * j2;
                                    H[2][3] += wgt * j2 * j3;
                                    H[3][3] += wgt * j3 * j3;
                                    g[2] += j2 * we;
                                    g[3] += j3 * we;
                                }
                                partCnt[index]++;
                            }
                        }
                    }
                });
            } catch (Exception ex) {
                break;
            }
            double[][] H = new double[nP][nP];
            double[] g = new double[nP];
            int cnt = 0;
            for (int bidx = 0; bidx < bands; bidx++) {
                for (int p = 0; p < nP; p++) {
                    g[p] += partG[bidx][p];
                    for (int q = 0; q < nP; q++) H[p][q] += partH[bidx][p][q];
                }
                cnt += partCnt[bidx];
            }
            // mirror the symmetric halves
            H[1][0] = H[0][1];
            if (nP == 4) {
                H[2][0] = H[0][2];
                H[2][1] = H[1][2];
                H[3][0] = H[0][3];
                H[3][1] = H[1][3];
                H[3][2] = H[2][3];
            }
            if (cnt < 48) break;
            double[] d = solve(H, g, nP);
            if (d == null) break;
            m.tx += Img.clamp((float) d[0], -0.75f, 0.75f);
            m.ty += Img.clamp((float) d[1], -0.75f, 0.75f);
            if (allowRotScale && nP == 4) {
                m.rot += Img.clamp((float) d[2], -0.008f, 0.008f);
                m.scale += Img.clamp((float) d[3], -0.003f, 0.003f);
            }
            if (Math.abs(d[0]) < 0.004 && Math.abs(d[1]) < 0.004 && it > 1) break;
        }
        m.residual = robustError(a, b, w, h, m);
        m.valid = true;
        return m;
    }

    /** Huber weighted mean absolute residual: lower is better and comparable across frames. */
    static float robustError(float[] a, float[] b, int w, int h, Motion m) {
        float cos = (float) Math.cos(m.rot), sin = (float) Math.sin(m.rot);
        float cw = w * 0.5f, ch = h * 0.5f;
        double sum = 0;
        int cnt = 0;
        for (int y = 3; y < h - 3; y += 3) {
            for (int x = 3; x < w - 3; x += 3) {
                float cx = x - cw, cy = y - ch;
                float rx = cx * cos - cy * sin, ry = cx * sin + cy * cos;
                float sx = rx * m.scale + cw + m.tx;
                float sy = ry * m.scale + ch + m.ty;
                if (sx < 2 || sy < 2 || sx > w - 3 || sy > h - 3) continue;
                float e = Math.abs(a[y * w + x] - sampleGray(b, w, h, sx, sy));
                sum += Math.min(e, 0.10f);
                cnt++;
            }
        }
        return cnt == 0 ? Float.MAX_VALUE : (float) (sum / cnt);
    }

    private static void box3(float[] p, int w, int h) {
        float[] tmp = new float[p.length];
        Filters.boxH(p, tmp, w, h, 1);
        Filters.boxV(tmp, p, w, h, 1);
    }

    private static void gradients(float[] p, int w, int h, float[] ix, float[] iy) {
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int i = y * w + x;
                ix[i] = (p[i + 1] - p[i - 1]) * 0.5f;
                iy[i] = (p[i + w] - p[i - w]) * 0.5f;
            }
        }
    }

    /** Gaussian elimination with partial pivoting on a small dense system. */
    private static double[] solve(double[][] Hin, double[] gin, int n) {
        double[][] m = new double[n][n + 1];
        for (int i = 0; i < n; i++) {
            System.arraycopy(Hin[i], 0, m[i], 0, n);
            m[i][n] = gin[i];
            m[i][i] += 1e-9 * (Math.abs(Hin[i][i]) + 1e-6);   // tiny Tikhonov term
        }
        for (int col = 0; col < n; col++) {
            int piv = col;
            for (int r = col + 1; r < n; r++) {
                if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
            }
            if (Math.abs(m[piv][col]) < 1e-12) return null;
            double[] t = m[col];
            m[col] = m[piv];
            m[piv] = t;
            for (int r = 0; r < n; r++) {
                if (r == col) continue;
                double f = m[r][col] / m[col][col];
                if (f == 0) continue;
                for (int c = col; c <= n; c++) m[r][c] -= f * m[col][c];
            }
        }
        double[] out = new double[n];
        for (int i = 0; i < n; i++) {
            out[i] = m[i][n] / m[i][i];
            if (!Double.isFinite(out[i])) return null;
        }
        return out;
    }
}
