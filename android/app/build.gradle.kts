plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.neurio.lanstream"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.neurio.lanstream"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-prototype"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        resourceConfigurations += setOf("en", "ar")
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
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        // The About screen shows BuildConfig.VERSION_NAME. AGP 8 disables the
        // generated BuildConfig class by default, so switch it back on.
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        // The prototype is intentionally explicit about platform limitations;
        // lint runs as warnings on debug builds.
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    // ---- AndroidX core -----------------------------------------------------
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.0")
    implementation("androidx.lifecycle:lifecycle-service:2.8.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.0")

    // ---- Compose -----------------------------------------------------------
    implementation("androidx.compose.ui:ui:1.6.7")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.7")
    implementation("androidx.compose.ui:ui-util:1.6.7")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.material:material-icons-extended:1.6.7")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.7")

    // ---- Coroutines --------------------------------------------------------
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // ---- Tests (unit only, no device tests yet) ----------------------------
    testImplementation("junit:junit:4.13.2")
}
