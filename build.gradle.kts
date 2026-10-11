// Top-level build file for VYRO PLAY.
// Compatible toolchain: AGP 8.5.2 + Gradle 8.9 + Kotlin 2.0.21 + KSP 2.0.21-1.0.27
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.27" apply false
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
