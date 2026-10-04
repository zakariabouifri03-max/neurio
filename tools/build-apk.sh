#!/bin/sh
# Builds StreamerLife2.apk — a fullscreen WebView shell around the single-file game.
# No Gradle. Needs (all fetchable from npm registry, see README):
#   javajre-linux-64 (full JRE 17)
#   aaptjs3                          (aapt2 linux binary)
#   @drxiaozhi/minapk                (android.jar, ecj, d8, apksigner, keystore)
set -e
cd "$(dirname "$0")/.."
GB=${GB:-/tmp/gb}
JAVA="$GB/node_modules/javajre-linux-64/jre/bin/java"
AAPT2="$GB/node_modules/aaptjs3/bin/x64/linux/aapt2"
AJAR="$GB/node_modules/@drxiaozhi/minapk/tools/android.jar"
ECJ="$GB/node_modules/@drxiaozhi/minapk/tools/ecj-3.45.0.jar"
D8="$GB/node_modules/@drxiaozhi/minapk/tools/d8.jar"
SIGNER="$GB/node_modules/@drxiaozhi/minapk/tools/apksigner.jar"
KS="$GB/node_modules/@drxiaozhi/minapk/tools/debug.keystore"
B=build/apk

rm -rf "$B" && mkdir -p "$B/gen" "$B/classes" "$B/dex"
cp streamer/streamer-life-2.html tools/apk/assets/
chmod +x "$AAPT2" "$JAVA"

echo "▸ aapt2 compile"
"$AAPT2" compile --dir tools/apk/res -o "$B/res.zip"
echo "▸ aapt2 link"
"$AAPT2" link -I "$AJAR" --manifest tools/apk/AndroidManifest.xml \
  --min-sdk-version 21 --target-sdk-version 33 \
  --java "$B/gen" --auto-add-overlay -A tools/apk/assets \
  -o "$B/base.apk" "$B/res.zip"
echo "▸ ecj (javac)"
"$JAVA" -jar "$ECJ" -classpath "$AJAR" -d "$B/classes" \
  $(find "$B/gen" -name '*.java') tools/apk/src/com/cedarcreek/sl2/MainActivity.java
echo "▸ d8 (dex)"
"$JAVA" -cp "$D8" com.android.tools.r8.D8 --lib "$AJAR" --min-api 21 --output "$B/dex" \
  $(find "$B/classes" -name '*.class')
echo "▸ inject classes.dex"
python3 - "$B" <<'EOF'
import sys, zipfile, shutil, os
B = sys.argv[1]
src, tmp = f"{B}/base.apk", f"{B}/base2.apk"
zin = zipfile.ZipFile(src)
zout = zipfile.ZipFile(tmp, "w")
for it in zin.infolist():
    zout.writestr(it, zin.read(it.filename))
zout.write(f"{B}/dex/classes.dex", "classes.dex", zipfile.ZIP_DEFLATED)
zout.close(); zin.close()
shutil.move(tmp, src)
print("classes.dex injected")
EOF
echo "▸ apksigner"
"$JAVA" -jar "$SIGNER" sign --ks "$KS" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android \
  --out StreamerLife2.apk "$B/base.apk"
ls -la StreamerLife2.apk
echo "✔ StreamerLife2.apk built"
