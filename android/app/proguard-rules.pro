# Keep the binary wire protocol / reflection-based injectors working if
# minification is ever enabled for a release build.
-keep class com.neurio.lanstream.net.** { *; }
-keep class com.neurio.lanstream.input.** { *; }
-keepclasseswithmembers class * {
    native <methods>;
}
-dontwarn android.hardware.input.InputManager
