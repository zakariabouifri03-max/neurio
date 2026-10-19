# Third-party dependency and model notices

NovaCut does not ship third-party codec binaries or AI model weights in this source checkout. Windows builds may optionally include a user-supplied FFmpeg binary only when the matching license and source-notice file are provided to `build_windows.ps1`.

| Component | Use | Notice / licensing guidance |
|---|---|---|
| Python | Runtime | PSF License; use an official CPython distribution. |
| PyInstaller bootloader | Packages the portable application | PyInstaller is distributed under GPLv2 or later with a bootloader exception for generated applications. Retain the exact license/exception notices applicable to the version used; this tool's code is not otherwise part of NovaCut's application source. |
| Qt for Python (PySide6), shiboken6, Qt Multimedia | Desktop UI and source-clip playback | Qt for Python and shiboken6 are available under LGPLv3/GPLv3 or commercial terms, depending on the component. Follow the exact license for every module you distribute, include notices, preserve dynamic relinking rights where LGPL applies, and review the official Qt for Python deployment guide. Do not assume that a PyInstaller bundle removes these obligations. |
| FFmpeg | Local media probe, analysis, proxy creation, and timeline rendering | FFmpeg's license depends on the exact build configuration: LGPL or GPL may apply, and optional libraries can change the terms. NovaCut does not bundle FFmpeg by default. Obtain a build from a source you trust, retain its exact license and corresponding-source notices, and provide them if you redistribute it. See `ffmpeg -L` and the build provider's documentation. |
| Whisper.cpp executable | Optional local transcription engine | Not bundled. Install/build it separately and review its upstream MIT license and third-party notices. |
| Whisper model weights | Optional transcription models downloaded by explicit user action | Models are downloaded only after confirmation. Model terms are separate from the engine's code; review the upstream model repository/card and applicable OpenAI Whisper model terms before use or redistribution. NovaCut does not redistribute weights. |
| U²-Net checkpoint | Optional local still-image background removal | Not bundled. Available as an explicit optional download. Verify the upstream project and checkpoint terms before use or redistribution. |
| rembg, Pillow, ONNX Runtime, Demucs, PyTorch | Optional local AI packages | Not part of base install. Install explicitly from their upstream/PyPI sources and retain their individual licenses/notices. Package licenses do not automatically license model weights. |
| Ollama | Optional local LLM host | Not bundled. NovaCut contacts only the local loopback Ollama API; install Ollama and its models separately and review their respective terms. |

The NovaCut source in `novacut/` is licensed under the MIT License in `novacut/LICENSE`. That license does not grant rights to third-party dependencies, media, or model weights.

## Model download behavior

- No model is downloaded at startup or by opening a workspace.
- The user chooses a catalog item and confirms the external model download.
- Before downloading, NovaCut compares the expected model size plus safety margin with free disk space. The UI reports progress and supports cancellation.
- Downloads are stored under the operating-system application-data folder, outside the project and installer. Model files are not included in portable builds.
- The current model downloader checks file size and removes interrupted partial files. It does not provide a cryptographic hash for every upstream checkpoint; verify upstream integrity information where available.
