# ✨ Neurio — Hayed Background + Zid Quality

**App PC (Windows / Mac / Linux) — .exe jahz — kaykhdem offline**

> Ta3tih taswira → yhayed liha background (transparent) → yzid liha quality (HD 2× / 4×) → ta7fed PNG/JPG/WEBP.

---

## 🚀 Sna3 l-EXE dyalk (1 click)

### Windows

```bash
# 1. Install Python 3.10+ (check python.org)
# 2. Install deps
pip install -r app/requirements.txt

# 3. Build exe
python app/build.py

# Natija: dist/Neurio.exe  (≈ 150MB — fiha kolchi, makay7tajch Python)
```

Double-click `Neurio.exe` — kaykhrem direct, bla installation.

### Linux / Mac

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r app/requirements.txt
python app/build.py
./dist/Neurio
```

### Bila Build — Khedem direct b Python

```bash
pip install -r app/requirements.txt
python app/main.py
# CLI mode:
python app/main.py --cli input.jpg -o output.png --scale 2
```

---

## 🎮 Kifach tkhdem

1. **Khtar Taswira** — glisser-déposer (drag & drop) aw click bouton
2. **Hayed Background** ✂️ — rembg U2Net (aw ISNet pro) → PNG transparent
3. **Zid Quality** ✨ — upscale 2×/4× LANCZOS + denoise + sharpen + color boost
4. **Bjouj ⚡** — dirhom bjouj f nafs wa9t (asra3)
5. **Hfed 💾** — khtar PNG (transparent) / JPG (fond blanc) / WEBP (sghir)

**Options:**

- **Upscale:** 1× asli / 2× HD / 4× Ultra
- **Sharpen:** 0.5× → 2.5× (1.35 mzyan)
- **Denoise:** kayn9i hab rqiq (OpenCV)
- **Zid Lawn:** auto contrast + color

**Models:**

- `u2net` — 3am, mzyan l kolchi
- `u2net_human_seg` — special bnadm
- `isnet-general-use` — ahsan quality (t9il chwiya)

> Awal marra : model 176MB kayt-téléchargi (khass internet). Men ba3d kaykhdem **offline 100%**.

---

## 🖼️ A9bal / Men ba3d

| Input (taswira 3adiya) | Output (BG mhayed + HD) |
|---|---|
| `photo.jpg` 1280×720 | `photo_neurio.png` 2560×1440 transparent, sharp |

---

## 📦 Distribusion — Sift l nass

1. Build `Neurio.exe`
2. Zip it: `Neurio.exe` (aw `Neurio/` folder ida onedir)
3. Sift l user — ykhdem bla Python, bla internet (men ba3d awal marra)

**Icon:** `app/icons/neurio.ico` — auto-généré.

---

## 🧪 CLI (l scripts / batch)

```bash
# BG + enhance 2×
python app/main.py --cli input.jpg -o out.png --scale 2

# Ghir BG
python app/main.py --cli input.jpg -o out.png --no-enhance

# Ghir enhance 4× bla BG removal
python app/main.py --cli input.jpg -o out.png --no-bg --scale 4 --sharpen 1.5

# Batch (Windows PowerShell)
Get-ChildItem *.jpg | ForEach-Object { python app/main.py --cli $_.FullName -o "$($_.BaseName)_out.png" }
```

---

## 🛠️ Tech

- **GUI:** PySide6 (Qt 6) — dark modern theme
- **BG removal:** `rembg` (U2Net / ISNet) + `onnxruntime`
- **Quality:** Pillow LANCZOS upscale + OpenCV denoise + UnsharpMask + auto-color
- **Build:** PyInstaller (onefile / onedir)

---

## ❓ FAQ

**Q: Wach kaykhdem bla internet?**  
A: Ah, men ba3d awal marra (model download). Kolchi local.

**Q: .exe kbir (150MB) 3lach?**  
A: Fih Python + Qt + rembg model + OpenCV. Normal. Onefile = 1 fichier. Onedir = asra3 f l7el.

**Q: Wach kaykhdem m3a JPG/PNG/WEBP?**  
A: Ah, kolchi. Input: JPG/PNG/WEBP/BMP/TIFF. Output: PNG/JPG/WEBP.

**Q: Kay9ta3 bg mzyan l sha3r w ...?**  
A: `isnet-general-use` ahsan f sha3r. Activi alpha_matting f code ida bghiti.

---

Made with ❤️ — Neurio
