# VYRO PLAY - release shrinker configuration
# ---------------------------------------------------------------------------
# Keeps the release build small, which matters on low-end devices.

# --- Kotlin / coroutines ---
-keepclassmembers class **$WhenMappings { <fields>; }
-keepclassmembers class kotlin.Metadata { public <methods>; }
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# --- kotlinx.serialization ---
# DTOs are serialised reflectively through the generated companion objects;
# the generated serializer classes must survive shrinking.
-keepclassmembers class com.vyro.play.data.remote.dto.** {
    *** Companion;
}
-keepclasseswithmembers class com.vyro.play.data.remote.dto.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.vyro.play.data.remote.dto.**$$serializer { *; }
-keepclassmembers class com.vyro.play.data.remote.dto.**$$serializer { *; }

# --- Room ---
# Generated DAO implementations are invoked by the Room runtime through
# reflection over the generated _Impl classes.
-keep class * extends androidx.room.RoomDatabase { *; }
-dontwarn androidx.room.paging.**

# --- OkHttp ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Coil ---
-dontwarn coil.**

# --- Media3 / ExoPlayer ---
-dontwarn androidx.media3.**
-keepclassmembers class androidx.media3.exoplayer.** { *; }

# --- android-youtube-player ---
# The library drives the official IFrame Player API through a JavaScript bridge;
# the bridge class and the WebView glue must not be renamed.
-keep class com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayerBridge { *; }
-keepclassmembers class com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayerBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.pierfrancescosoffritti.androidyoutubeplayer.core.player.views.** { *; }
-keep class com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants { *; }
-dontwarn com.pierfrancescosoffritti.androidyoutubeplayer.**

# Keep the WebView HTML/JS payload that the player loads.
-keep class com.pierfrancescosoffritti.androidyoutubeplayer.R$raw { *; }

# --- General ---
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-renamesourcefileattribute SourceFile
