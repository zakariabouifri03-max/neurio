# Keep the JNI-facing classes (defensive: dynamic registration uses FindClass).
-keep class com.aivision4k.sdk.AIUpscaler { *; }
-keep class com.aivision4k.sdk.internal.NativeBridge { *; }
-keep class com.aivision4k.sdk.demo.DemoRenderer { *; }
-keepclasseswithmembernames class * { native <methods>; }

# org.json is part of the platform but keep it referenced explicitly.
-keep class org.json.** { *; }

# Coroutines / lifecycle noise
-dontwarn kotlinx.coroutines.**
-dontwarn androidx.**
