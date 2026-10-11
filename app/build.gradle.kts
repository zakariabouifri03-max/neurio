import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

// Read YOUTUBE_API_KEY securely from local.properties, Gradle property, or environment variable.
// Private credentials are NEVER hardcoded in source control.
val localProperties = Properties().apply {
    val localPropsFile = rootProject.file("local.properties")
    if (localPropsFile.exists()) {
        localPropsFile.inputStream().use { load(it) }
    }
}

val configuredYouTubeApiKey: String = (
    localProperties.getProperty("YOUTUBE_API_KEY")
        ?: (project.findProperty("YOUTUBE_API_KEY") as String?)
        ?: System.getenv("YOUTUBE_API_KEY")
        ?: ""
).trim().replace("\"", "\\\"")

android {
    namespace = "com.vyro.play"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vyro.play"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "YOUTUBE_API_KEY", "\"$configuredYouTubeApiKey\"")
        buildConfigField("String", "YOUTUBE_API_BASE_URL", "\"https://www.googleapis.com/youtube/v3\"")
    }

    signingConfigs {
        create("release") {
            val ksPath = project.findProperty("VYRO_KEYSTORE_FILE") as String?
                ?: System.getenv("VYRO_KEYSTORE_FILE")
            if (!ksPath.isNullOrBlank()) {
                storeFile = file(ksPath)
                storePassword = project.findProperty("VYRO_KEYSTORE_PASSWORD") as String?
                    ?: System.getenv("VYRO_KEYSTORE_PASSWORD")
                keyAlias = project.findProperty("VYRO_KEY_ALIAS") as String?
                    ?: System.getenv("VYRO_KEY_ALIAS")
                keyPassword = project.findProperty("VYRO_KEY_PASSWORD") as String?
                    ?: System.getenv("VYRO_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (
                signingConfigs.getByName("release").storeFile?.exists() == true
            ) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=androidx.media3.common.util.UnstableApi",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi"
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
        disable += "UnsafeOptInUsageError"
    }
}

dependencies {
    // AndroidX Core & Lifecycle
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.2")

    // Jetpack Compose & Material 3
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.compose.ui:ui-graphics:1.6.8")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.8")
    implementation("androidx.compose.foundation:foundation:1.6.8")
    implementation("androidx.compose.animation:animation:1.6.8")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.material:material-icons-extended:1.6.8")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.8")

    // Navigation Compose
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Room Database (Persistent Favorites, Watch History, Search History, API Cache)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Jetpack DataStore Preferences (Theme, Quality, Captions, Low-End Mode, API Key)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Networking (YouTube Data API v3 & Official oEmbed)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Efficient Thumbnail Loading (Coil Compose, tuned for low-end phones)
    implementation("io.coil-kt:coil-compose:2.6.0")

    // Official Local Video Playback (AndroidX Media3 ExoPlayer)
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("androidx.media3:media3-common:1.4.1")

    // Kotlin Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Unit Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.json:json:20240303")
}
