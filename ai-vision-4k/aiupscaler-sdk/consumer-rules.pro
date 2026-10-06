# JNI entry points are registered dynamically from JNI_OnLoad with
# RegisterNatives() against FindClass("com/aivision4k/sdk/NativeBridge"), so the
# class and its native method names must survive R8 shrinking and renaming.
-keep class com.aivision4k.sdk.NativeBridge { *; }
-keep class com.aivision4k.sdk.NativeBridge$* { *; }

# The public façade is an object with @JvmStatic-free members; keeping it costs
# nothing and keeps stack traces readable for integrators.
-keep class com.aivision4k.sdk.AIUpscaler { *; }
-keep class com.aivision4k.sdk.AIUpscaler$* { *; }

# Native methods keep their names too (belt and braces).
-keepclasseswithmembernames class * {
    native <methods>;
}
