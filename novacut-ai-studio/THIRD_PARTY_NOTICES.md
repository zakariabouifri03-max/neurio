# Third-party notices and licenses

NovaCut AI Studio is GPL-3.0-or-later. It builds on the following open-source
components. Optional components are **not bundled** — the application detects
them at runtime and shows an honest "unavailable" state until the user installs
them.

## Bundled / required runtime dependencies

| Component | License | Notes |
|---|---|---|
| [PySide6 / Qt 6](https://www.qt.io/licensing/open-source-lgpl-obligations) | LGPL-3.0 (or commercial Qt) | Dynamic linking; relinkable per LGPL |
| [NumPy](https://numpy.org/doc/stable/license.html) | BSD-3-Clause | |
| [OpenCV (opencv-python-headless)](https://github.com/opencv/opencv) | Apache-2.0 | Scene detection, tracking, image I/O |
| [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | BSD-2-Clause | Fallback FFmpeg binary discovery |
| [FFmpeg](https://ffmpeg.org/legal.html) | LGPL-2.1/GPL-2/GPL-3 depending on build | All video/audio processing |
| [DejaVu Sans font](https://dejavu-fonts.github.io/) | Bitstream Vera license (free) | `novacut/resources/fonts/`, full text in that folder |

### FFmpeg licensing detail

FFmpeg can be built as LGPL or GPL. The convenience static builds (the
`imageio-ffmpeg` wheel on Linux/macOS and the gyan.dev "essentials" Windows
build used by `installer/build_windows.bat`) are **GPL-3.0** builds because
they include GPL filters such as `xfade` and `chromakey`. Distributing NovaCut
with such a binary keeps the whole distribution under GPL-3.0, which is
compatible with this project's license. To ship a closed-source variant you
must replace FFmpeg with an LGPL-configured build and avoid GPL-only filters.

## Optional local-AI components (installed on demand)

| Component | License | Model weights & their terms |
|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | Whisper checkpoints (MIT), downloaded explicitly via the Model Manager |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) | MIT | inference engine used by faster-whisper |
| [openai-whisper](https://github.com/openai/whisper) | MIT | alternative engine, same model family |
| [rembg](https://github.com/danielgatis/rembg) | MIT | U2Net weights (`u2net.onnx`): see rembg model notices; offered with an explicit download and license display in the app |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | MIT | |
| [Demucs](https://github.com/facebookresearch/demucs) | MIT (code) | htdemucs weights carry Meta's research/non-commercial notice; the Model Manager shows this before download |
| [Ollama](https://github.com/ollama/ollama) | MIT (server app) | Runs as a separate local process; model licenses vary by model and are shown by Ollama |
| [Hugging Face Hub client](https://github.com/huggingface/huggingface_hub) | Apache-2.0 | Used only when the user explicitly requests a model |

## Development / build tooling

| Component | License |
|---|---|
| pytest | MIT |
| PyInstaller | GPL-2.0-or-later (with distribution exception for generated apps) |
| Inno Setup | free installer, its own license |

## What NovaCut never does

- No telemetry, analytics, or network calls for core editing features.
- No model download without an explicit click in the Model Manager, which first
  verifies free disk space and displays the size and license of each model.
- No remote AI APIs. The assistant talks only to loopback addresses
  (`127.0.0.1` / `localhost`); non-local hosts are rejected.
