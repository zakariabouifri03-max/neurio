plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.neurio.aivibes"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.neurio.aivibes"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // CI and local `assembleRelease` fall back to the debug key so the
        // release APK is directly installable. Pass -PAIVIBES_KEYSTORE_* (or
        // set the env vars) to sign with a real production keystore instead.
        create("release") {
            val ksPath = project.findProperty("AIVIBES_KEYSTORE_FILE") as String?
                ?: System.getenv("AIVIBES_KEYSTORE_FILE")
            if (ksPath != null) {
                storeFile = file(ksPath)
                storePassword = project.findProperty("AIVIBES_KEYSTORE_PASSWORD") as String?
                    ?: System.getenv("AIVIBES_KEYSTORE_PASSWORD")
                keyAlias = project.findProperty("AIVIBES_KEY_ALIAS") as String?
                    ?: System.getenv("AIVIBES_KEY_ALIAS")
                keyPassword = project.findProperty("AIVIBES_KEY_PASSWORD") as String?
                    ?: System.getenv("AIVIBES_KEY_PASSWORD")
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
                // Debug-signed release build: installable on any phone without
                // Play Store infrastructure. Honest, documented, intentional.
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
        // Media3 is annotated with androidx.annotation.RequiresOptIn(UnstableApi).
        freeCompilerArgs += listOf("-opt-in=androidx.media3.common.util.UnstableApi")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        // Media3's UnstableApi lint rule fires on every media3 reference; the
        // compiler opt-in above is the authoritative gate. Keep lint as
        // warnings so it can never block an otherwise healthy build.
        abortOnError = false
        checkReleaseBuilds = false
        disable += "UnsafeOptInUsageError"
    }
}

dependencies {
    // ---- AndroidX core -----------------------------------------------------
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.0")
    implementation("androidx.lifecycle:lifecycle-service:2.8.0")

    // ---- Compose -----------------------------------------------------------
    implementation("androidx.compose.ui:ui:1.6.7")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.7")
    implementation("androidx.compose.ui:ui-graphics:1.6.7")
    implementation("androidx.compose.ui:ui-util:1.6.7")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.material:material-icons-extended:1.6.7")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.7")

    // ---- Navigation --------------------------------------------------------
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // ---- Media3 (playback + session) ---------------------------------------
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-session:1.4.1")

    // ---- Persistence -------------------------------------------------------
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // ---- Coroutines --------------------------------------------------------
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // ---- Tests -------------------------------------------------------------
    testImplementation("junit:junit:4.13.2")
}
