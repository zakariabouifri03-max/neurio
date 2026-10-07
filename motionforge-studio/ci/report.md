MotionForge Studio - CI failure report

run:    37588820684
commit: 9057180612a49fa510cb0197a285c6d0ba6bd42a
ref:    refs/heads/arena/916a2551-neurio

===== D:\a\neurio\neurio\motionforge-studio\ci\build.log =====
wrote D:\a\neurio\neurio\motionforge-studio\packaging\win\motionforge.ico 129799 bytes; 9 sizes
MotionForge Studio 1.0.0 - Windows build
  icon: packaging\win\motionforge.ico
  fetching Python payload ...
  winpython-embed 3.13.1: winpython_embed-3.13.1.tar.gz
    downloaded winpython_embed-3.13.1.tar.gz (26.6 MB in 0.3s)
D:\a\neurio\neurio\motionforge-studio\tools\build_win.py:209: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.
  tar.extract(inner, outdir)
  fetching wheels ...
    downloaded pyside6_essentials-6.11.2-cp310-abi3-win_amd64.whl (76.9 MB in 0.4s)
    downloaded pyside6_addons-6.11.2-cp310-abi3-win_amd64.whl (168.2 MB in 0.6s)
    downloaded shiboken6-6.11.2-cp310-abi3-win_amd64.whl (1.2 MB in 0.2s)
    downloaded numpy-2.5.3-cp313-cp313-win_amd64.whl (12.6 MB in 0.2s)
    downloaded imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl (31.2 MB in 0.3s)
    downloaded msvc_runtime-14.44.35112-cp313-cp313-win_amd64.whl (1.9 MB in 0.2s)
  runtime ...
  libraries ...
    pruned 260 unused Qt file(s)
  application ...
  launcher ...
    MotionForge Studio.exe: 8.5 MB in 9s
  built D:\a\_temp\mfs-cache\tree\MotionForge Studio
  app folder: 280 MB
  portable zip: dist\MotionForge-Studio-1.0.0-win64-portable.zip (106.8 MB)
  pyinstaller ...
    bundle built in 12s (11.6 MB)
  installer: dist\MotionForge-Studio-Setup-1.0.0.exe (118.4 MB)

Done:
   dist\MotionForge-Studio-1.0.0-win64-portable.zip
   dist\MotionForge-Studio-Setup-1.0.0.exe
== D:\a\_temp\mfs-cache\tree\MotionForge Studio
  ok   import closure of 92 binaries (0 missing)
== MotionForge-Studio-1.0.0-win64-portable.zip (106.8 MB)
  ok   archive integrity (1524 entries)
      top level: ['MotionForge Studio']
      sections: .text, .rdata, .data, .pdata, .fptable, .rsrc, .reloc
  ok   MotionForge Studio.exe: 9 icons, 1 icon group(s), 8.5 MB
  ok   ProductName      'MotionForge Studio'
  ok   FileVersion      '1.0.0'
  ok   FileDescription  'MotionForge Studio - professional 2D animation studio'
      sections: .text, .rdata, .data, .pdata, .rsrc, .reloc
  ok   console runtime: 12 icons, 1 icon group(s), 0.1 MB
  ok   ProductName      'Python'
  ok   FileVersion      '3.13.2'
  ok   FileDescription  'Python'
  ok   python313.dll
  ok   lib/PySide6/QtCore.pyd
  ok   app/mfs/app.py
  ok   app/mfs/ui/session.py
  ok   MotionForge.py
  ok   ReadMe.txt
  ok   lib/PySide6/Qt6Core.dll
  ok   lib/numpy/__init__.py
  ok   lib/imageio_ffmpeg/binaries/
  ok   licenses/THIRD-PARTY-NOTICES.txt
  ok   MotionForge Studio.exe
  ok   MotionForge runtime.exe
  ok   MotionForge runtime console.exe
  ok   python313._pth
      entry style: ['MotionForge Studio/Lib/imageio_ffmpeg/binaries/README.md', 'MotionForge Studio/Lib/imageio_ffmpeg/binaries/__init__.py']
  ok   python313._pth -> ['python313.zip', '.', 'Lib', 'lib', 'app', 'import', 'site']
      sections: .text, .rdata, .data, .pdata, .fptable, .rsrc, .reloc
  ok   MotionForge-Studio-Setup-1.0.0.exe: 9 icons, 1 icon group(s), 118.4 MB
  ok   ProductName      'MotionForge Studio'
  ok   FileVersion      '1.0.0'
  ok   FileDescription  'MotionForge Studio 2D animation studio - setup'

ALL CHECKS PASSED


===== D:\a\neurio\neurio\motionforge-studio\ci\smoke.log =====
portable smoke test 2026-10-07T07:42:51.3668578+00:00
zip: D:\a\neurio\neurio\motionforge-studio\dist\MotionForge-Studio-1.0.0-win64-portable.zip

== unpacking the portable package
   target: C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable
   ok   archive expanded

== application folder
   C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio
   contents: app, DLLs, Lib, licenses, LICENSE.txt, MotionForge runtime console.exe, MotionForge runtime.exe, MotionForge Studio.exe, motionforge.ico, MotionForge.py, NEWS.txt, python3.dll, python313._pth, python313.dll, ReadMe.txt, vcruntime140_1.dll, vcruntime140.dll, version.txt
   folder size: 267.3 MB
   ok   MotionForge Studio.exe (entry point)
   ok   MotionForge runtime console.exe
   ok   MotionForge runtime.exe
   ok   MotionForge.py
   ok   python313.dll
   ok   lib/PySide6/QtCore.pyd
   ok   lib/imageio_ffmpeg
   ok   ffmpeg executable
   ok   the interpreters were renamed (no python.exe / pythonw.exe)

== file properties Windows shows for the entry point
   MotionForge Studio.exe:
     ProductName:     MotionForge Studio
     FileVersion:     1.0.0
     FileDescription: MotionForge Studio - professional 2D animation studio
     CompanyName:     MotionForge Labs
   ok   MotionForge Studio.exe is branded
   MotionForge runtime.exe:
     ProductName:     Python
     FileVersion:     3.13.2
     FileDescription: Python
     CompanyName:     Python Software Foundation
   ok   MotionForge runtime.exe has a readable version resource
   MotionForge runtime console.exe:
     ProductName:     Python
     FileVersion:     3.13.2
     FileDescription: Python
     CompanyName:     Python Software Foundation
   ok   MotionForge runtime console.exe has a readable version resource

== bundled interpreter / Qt import
   C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge runtime console.exe -c import sys, PySide6; print(sys.version); print('PySide6', PySide6.__version__)
   exit code: 0
   | 3.13.2 (tags/v3.13.2:4f8bb39, Feb  4 2025, 15:23:48) [MSC v.1942 64 bit (AMD64)]
   | PySide6 6.11.2
   ok   output contains 'PySide6'

== script form (interpreter MotionForge.py)
   C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge runtime console.exe C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py --selftest
   exit code: 1
   | MotionForge Studio could not start.
   |                      ~~~~^^^^^^^^^^^^^^^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 161, in main
   |     _attach_console()
   |     ~~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 84, in _attach_console
   |     _adopt_handles()
   |     ~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 62, in _adopt_handles
   |     import ctypes
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\lib\ctypes\__init__.py", line 8, in <module>
   |     from _ctypes import Union, Structure, Array
   | ModuleNotFoundError: No module named '_ctypes'
   | A full report was written to:
   | C:\Users\runneradmin\AppData\Roaming\MotionForgeStudio\logs\crash.log
   FAIL output contains 'RESULT: OK' 

== entry point --selftest
   C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge Studio.exe --selftest
   exit code: 1
   | MotionForge Studio could not start.
   |                      ~~~~^^^^^^^^^^^^^^^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 161, in main
   |     _attach_console()
   |     ~~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 84, in _attach_console
   |     _adopt_handles()
   |     ~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 62, in _adopt_handles
   |     import ctypes
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\lib\ctypes\__init__.py", line 8, in <module>
   |     from _ctypes import Union, Structure, Array
   | ModuleNotFoundError: No module named '_ctypes'
   | A full report was written to:
   | C:\Users\runneradmin\AppData\Roaming\MotionForgeStudio\logs\crash.log
   FAIL output contains 'RESULT: OK' 

== entry point --version
   C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge Studio.exe --version
   exit code: 1
   | MotionForge Studio could not start.
   |                      ~~~~^^^^^^^^^^^^^^^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 161, in main
   |     _attach_console()
   |     ~~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 84, in _attach_console
   |     _adopt_handles()
   |     ~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 62, in _adopt_handles
   |     import ctypes
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\lib\ctypes\__init__.py", line 8, in <module>
   |     from _ctypes import Union, Structure, Array
   | ModuleNotFoundError: No module named '_ctypes'
   | A full report was written to:
   | C:\Users\runneradmin\AppData\Roaming\MotionForgeStudio\logs\crash.log
   ok   output contains 'MotionForge Studio'

== log files written by the application
   --- C:\Users\runneradmin\AppData\Roaming\MotionForgeStudio\logs\crash.log ---
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 161, in main
   |     _attach_console()
   |     ~~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 84, in _attach_console
   |     _adopt_handles()
   |     ~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 62, in _adopt_handles
   |     import ctypes
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\lib\ctypes\__init__.py", line 8, in <module>
   |     from _ctypes import Union, Structure, Array
   | ModuleNotFoundError: No module named '_ctypes'
   | 
   | 
   | ===== 2026-10-07 07:43:03 =====
   | Traceback (most recent call last):
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 178, in <module>
   |     raise SystemExit(main(list(sys.argv)))
   |                      ~~~~^^^^^^^^^^^^^^^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 161, in main
   |     _attach_console()
   |     ~~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 84, in _attach_console
   |     _adopt_handles()
   |     ~~~~~~~~~~~~~~^^
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\MotionForge.py", line 62, in _adopt_handles
   |     import ctypes
   |   File "C:\Users\RUNNER~1\AppData\Local\Temp\mfs-portable\MotionForge Studio\lib\ctypes\__init__.py", line 8, in <module>
   |     from _ctypes import Union, Structure, Array
   | ModuleNotFoundError: No module named '_ctypes'
   | 

PORTABLE SMOKE TEST FAILED: script form (interpreter MotionForge.py) (exit 1); script form (interpreter MotionForge.py) (output does not contain 'RESULT: OK'); output contains 'RESULT: OK'; entry point --selftest (exit 1); entry point --selftest (output does not contain 'RESULT: OK'); output contains 'RESULT: OK'; entry point --version (exit 1)


