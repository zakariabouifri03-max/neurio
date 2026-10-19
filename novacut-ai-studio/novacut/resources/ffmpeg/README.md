# Bundled FFmpeg

The Windows build script (`installer/build_windows.bat`) downloads the
gyan.dev **FFmpeg essentials (static, GPL)** build and copies
`ffmpeg.exe` and `ffprobe.exe` into `installer/bin/`. PyInstaller then places
them in the app's `bin/` folder, which is the second location checked by the
runtime discovery order:

1. Path configured in Tools ▸ Settings
2. `bin/` next to the executable / package
3. `ffmpeg` on the system PATH
4. The static binary shipped inside the `imageio-ffmpeg` wheel (fallback)

Convenience GPL builds include `xfade`, `chromakey`, `drawtext`, `lut3d`,
`subtitles`, `afftdn` and every filter NovaCut uses. For an LGPL-only
distribution, replace the binaries with an LGPL-configured FFmpeg and audit
filter availability — the app disables features whose filters are missing
instead of failing.
