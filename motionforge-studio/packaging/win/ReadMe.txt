MotionForge Studio 1.0.0
========================
Professional 2D animation studio for Windows 10 / 11 (64-bit).


START THE APP
-------------
Double-click   MotionForge Studio.exe
(That is this folder's only entry point - no Python installation is needed,
everything the app uses is inside this folder.)


FIRST STEPS
-----------
File > New Project            pick one of the templates (2D Cartoon, Anime,
                              Stick Figure, Explainer, Social Media, ...)
Draw                          brush, pencil, ink, marker, soft brush, eraser,
                              bucket fill, shape, bezier, text
F                         add a (blank) frame
D                         duplicate the current frame
Space                     play / pause      .  ,  step one frame
Ctrl+Z / Ctrl+Y           undo / redo (unlimited)
Character > Auto Rig      creates a bone rig and binds the body-part layers
AI > Animation Assistant  "walk to the right, stop, wave" becomes editable
                          keyframes on the timeline
File > Save As            .mfs project (layers, frames, rigs, audio, scenes,
                          camera, AI data)
Export > Video            MP4 / WebM / GIF / PNG / JPEG sequence, up to 4K


PORTABLE OR INSTALLED
---------------------
* Portable:  keep this folder anywhere (USB stick included) and run the exe.
* Installed: run  MotionForge-Studio-Setup.exe  (from the download page) or use
  Settings > Install on this PC  while the app is running.  That creates the
  Start-menu and desktop shortcuts, registers the uninstaller in
  "Apps & features" and associates .mfs files.
* Portable data: create an empty file named  portable.txt  next to the exe and
  the app keeps its settings, autosaves and caches inside this folder.


NOTES
-----
* Audio import (WAV/MP3/OGG), video export and waveform drawing use the bundled
  FFmpeg - no extra download required.
* The AI features need an API key of your own (AI > AI Settings).  Everything
  else works completely offline.
* Windows may show a SmartScreen notice because the build is not code-signed
  yet: More info > Run anyway.


LICENCES
--------
Third party components (CPython, Qt/PySide6, numpy, imageio-ffmpeg, MSVC
runtime) and their licence texts are listed in  licenses/ .
