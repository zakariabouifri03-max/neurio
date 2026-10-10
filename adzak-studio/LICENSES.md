# Third-Party Licenses — ADZAK CREATIVE STUDIO

ADZAK Creative Studio itself is distributed under the **GNU GPL v3.0 or later**.
It bundles/links the following third-party components.

| Component | License | Notes |
|---|---|---|
| Python | PSF License | https://www.python.org/psf/license/ |
| PySide6 / Qt 6 | GNU LGPL v3 | Dynamic linking; Qt source available from https://code.qt.io |
| FFmpeg | GNU LGPL v2.1+ (essentials build may include GPL parts) | Only invoked as an external process. Windows builds fetch the official gyan.dev static binary at build time — review its included `LICENSE` before redistribution. |
| Pillow | HPND (MIT-like) | https://pillow.readthedocs.io |
| NumPy | BSD 3-Clause | https://numpy.org |
| imageio-ffmpeg | Apache 2.0 (packaging) + FFmpeg license (binary) | Supplies the fallback static FFmpeg binary |
| PyInstaller | GPL with bootloader exception | Build-time tool only; not distributed inside the app |
| Inno Setup | Modified Delphi zlib license | Build-time installer compiler only |

## FFmpeg redistribution note

The app does **not** embed a hidden copy of FFmpeg. If no FFmpeg binary is
found, media features are visibly disabled. The Windows build script downloads
the official build from https://www.gyan.dev/ffmpeg/builds/ at build time;
that archive carries its own LGPL/GPL notices which are preserved in the
install folder. If you redistribute ADZAK, include those notices and honour
the LGPL (provide a means to relink/replace the FFmpeg binaries).

## Assets

All bundled design templates (`src/adzak/resources/templates/*.json`) are
original works created for ADZAK and may be freely modified by end users.
No third-party copyrighted assets are shipped.
