# ADZAK CREATIVE STUDIO 1.0.0 — Windows 64-bit download

Le fichier complet fait 143 Mo, il est donc découpé en **2 parties**.
Téléchargez les deux, assemblez-les, puis extrayez. C'est tout.

## Étape 1 — Télécharger les 2 parties

Cliquez sur chaque fichier puis sur le bouton **Download** (en haut à droite de la page du fichier) :

1. [`ADZAK-Creative-Studio-1.0.0-win64-portable.zip.00`](https://github.com/zakariabouifri03-max/neurio/raw/arena/d7805b36-neurio/downloads/ADZAK-Creative-Studio-1.0.0-win64-portable.zip.00)
2. [`ADZAK-Creative-Studio-1.0.0-win64-portable.zip.01`](https://github.com/zakariabouifri03-max/neurio/raw/arena/d7805b36-neurio/downloads/ADZAK-Creative-Studio-1.0.0-win64-portable.zip.01)

Mettez les deux fichiers dans le **même dossier** (ex: `C:\AdzakDownload`).

## Étape 2 — Réassembler le fichier ZIP

Ouvrez **l'Invite de commandes (cmd)** dans ce dossier et tapez :

```bat
copy /b ADZAK-Creative-Studio-1.0.0-win64-portable.zip.00 + ADZAK-Creative-Studio-1.0.0-win64-portable.zip.01 ADZAK-Creative-Studio-1.0.0-win64-portable.zip
```

(ou PowerShell : `cmd /c 'copy /b *.zip.0* ADZAK-Creative-Studio-1.0.0-win64-portable.zip'`)

## Étape 3 — Extraire et lancer

1. Extrayez `ADZAK-Creative-Studio-1.0.0-win64-portable.zip` où vous voulez (ex: `C:\AdzakCreativeStudio`).
2. Double-cliquez sur **`AdzakCreativeStudio.exe`**.
3. Premier lancement : si SmartScreen affiche une alerte (l'exe n'est pas signé),
   choisissez **Informations complémentaires → Exécuter quand même**.

Aucun droit administrateur n'est nécessaire. Python, Qt et FFmpeg sont inclus
dans le dossier. Langues : English / العربية / Français / Español (menu File → Settings).

---

## English

The full file is 143 MB, so it is split into **2 parts**.
Download both files (use each file page's **Download** button), put them in the
same folder, then run in a Command Prompt:

```bat
copy /b ADZAK-Creative-Studio-1.0.0-win64-portable.zip.00 + ADZAK-Creative-Studio-1.0.0-win64-portable.zip.01 ADZAK-Creative-Studio-1.0.0-win64-portable.zip
```

Extract the resulting ZIP anywhere and double-click `AdzakCreativeStudio.exe`.
No admin rights needed; Python, Qt and FFmpeg are bundled. If SmartScreen warns
you (unsigned exe), choose *More info → Run anyway*.

## العربية

حجم الملف الكامل 143 ميغابايت لذلك قُسم إلى جزأين. نزّل الملفين (.00 و .01)
وضعهما في نفس المجلد ثم نفّذ في موجّه الأوامر:

```bat
copy /b ADZAK-Creative-Studio-1.0.0-win64-portable.zip.00 + ADZAK-Creative-Studio-1.0.0-win64-portable.zip.01 ADZAK-Creative-Studio-1.0.0-win64-portable.zip
```

ثم استخرج الملف الناتج وشغّل `AdzakCreativeStudio.exe`. لا يحتاج صلاحيات
مسؤول؛ بايثون و Qt و FFmpeg مضمّنة داخل المجلد.

---

If the app ever fails to start, check `%LOCALAPPDATA%\AdzakCreativeStudio\logs\startup-error.log`.
Licenses: see `LICENSES.md` inside the ZIP (GPL-3.0+, FFmpeg LGPL, Qt LGPL, Pillow, NumPy).
