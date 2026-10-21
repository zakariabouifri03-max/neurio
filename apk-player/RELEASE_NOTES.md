**Neurio APK Player** plays Android **HTML5 / web** games (Cordova, Capacitor, Construct, Phaser, Three.js, WebView wrappers like *Bash Baqi Racing*) directly on Windows. It is not an emulator, so it stays light: about 1 MB, it opens in a second and runs on weak PCs.

**Download:** `NeurioApkPlayer.exe` (64-bit Windows 10/11). Use `NeurioApkPlayer-32bit.exe` on 32-bit Windows. The `.zip` contains both.

* Open an APK with the button, or drag it onto the window or onto the .exe.
* **F11**: fullscreen. **F2**: touch mode, where the mouse acts as a finger. **F1**: library. **F5**: restart. **Ctrl+M**: mute.
* Game saves are kept. Desktop shortcuts are supported. `.xapk` / `.apks` bundles are supported.
* Native Android games (Unity, Unreal, Godot, Flutter, Java) are detected and explained. They need a real Android system.

**`BashBaqiRacing-1.0.1.apk`** is a fixed build of *Bash Baqi Racing*. Version 1.0 crashed when the first race started (`Cannot read properties of null (reading 'morphAttributes')`). It is signed with the same key, so it also installs over 1.0 on phones.

Uses the Microsoft Edge WebView2 runtime that ships with Windows 10/11. Because the exe is unsigned, SmartScreen may warn the first time: click *More info → Run anyway*.
