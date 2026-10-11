# VYRO PLAY ProGuard / R8 configuration

# Keep WebView JavascriptInterface bridge for Official YouTube IFrame Player API
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.vyro.play.player.** { *; }

# Keep Room entities & DAOs
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
