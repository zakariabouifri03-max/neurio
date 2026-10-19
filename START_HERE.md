# 🇲🇦 Bda Hna — Start Here (Darija)

## 🔥 Neurio — EXE dyal PC: Hayed Background + Zid Quality

### 1️⃣ Bghiti tjareb daba bla ma t-installi walo?
```bash
python app/web_app.py
# → 7el browser: http://localhost:7860
# Jor taswira → klick "Hayed Background" aw "Zid Quality" → Hfed
```

### 2️⃣ Bghiti EXE l Windows?
```bash
pip install -r app/requirements.txt
python app/build.py
# → ghadi tl9a Neurio.exe f dist/  — sifetha l ay PC, takhdem bla Python!
```

Double-click `Neurio.exe` → khtar taswira → hayed background ✂️ + zid quality ✨ → hfed 💾

### 3️⃣ Bghiti CLI (batch)?
```bash
python app/main.py --cli taswira.jpg -o natija.png --scale 2
```

---

### 📂 Fin kayna l-app?
- Desktop GUI: `app/main.py` (PySide6 — dark modern)
- Web demo: `app/web_app.py` (browser, bla Qt)
- Processor: `app/processor.py` (rembg + Pillow + OpenCV)
- Build EXE: `app/build.py` + `app/Neurio.spec`
- Examples: `app/examples/` (qbel/men ba3d)
- Tests: `python app/test_processor.py`

### ❓ Mosa3ada?
- Qra `app/README.md` — fih kolchi b Darija/Français/English + FAQ
- Click ❔ f l-app (Help popup)
- Ma3andekch Qt? Khedem web demo `app/web_app.py`

---

### 🏁 Bonus: Racing Game
L3ab lo3ba 3D: `python -m http.server 8000` → http://localhost:8000

Made with ❤️
