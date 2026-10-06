// Top-level build file for the Neurio LAN Game Stream prototype.
//
// NOTE: this project intentionally pins *explicit* library versions (no version
// catalog and no Compose BOM) so that a fresh clone builds without needing to
// resolve any extra metadata. Versions chosen here are known-compatible:
//   AGP 8.5.2  +  Gradle 8.7  +  Kotlin 2.0.21  +  Compose 1.6.7 / Material3 1.2.1
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
