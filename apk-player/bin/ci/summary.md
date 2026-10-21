# Neurio APK Player - CI smoke test

* commit: 04d539582483a804e8eb269b93fe3547b16ef65c
* NeurioApkPlayer.exe: 596 KB, NeurioApkPlayer-32bit.exe: 512 KB
* WebView2 runtime on the runner: 155.0.4283.62
* OS: Microsoft Windows NT 10.0.26100.0

| result | check | details |
|---|---|---|
| PASS | inspect Bash Baqi | exit=0 package=com.neurio.bashbaqi kind=web framework=WebView entry=index.html |
| PASS | inspect from an Arabic path | exit=0 package=com.neurio.bashbaqi |
| PASS | inspect Cordova fixture | exit=0 framework=Cordova kind=web keyboard=False |
| PASS | inspect Unity fixture | exit=0 kind=native framework=Unity |
| PASS | inspect rejects a broken file | exit=3 error='the file is empty or too small to be an APK' |
| PASS | smoke: Bash Baqi runs (x64) | exit=0 19s err='' title='🏁 Bash Baqi Racing' canvases=2 size=880x495 webgl='WebGL 2.0 (OpenGL ES 3.0 Chromium) / ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)' errors=0 |
| PASS | smoke: Bash Baqi runs without JavaScript errors | errors= |
| PASS | smoke: Bash Baqi starts in keyboard mode | maxTouchPoints=0 |
| PASS | smoke: app user-agent token (fast mode) | ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0 BashBaqiAPK/1.0' |
| PASS | smoke: screenshots (game, library, native dialog) |  |
| PASS | smoke: Cordova fires deviceready | exit=0 title='DEVICE READY' err='' errors= |
| PASS | smoke: Cordova app gets touch input | maxTouchPoints=5 ontouchstart=True ua='Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.0.0 Mobile Safari/537.36' |
| PASS | smoke: game saves persist between runs | exit=0 storagePrev='1' |
| PASS | smoke: 32-bit build runs | exit=0 18s canvases=2 err='' |
