plugins {
    id("com.android.application")
}

android {
    namespace = "dev.neurio.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.neurio.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            // Shipped unsigned-from-the-store: signed with the standard debug key so the
            // APK installs straight from a download without any secret of any kind.
            isMinifyEnabled = false
            isShrinkResources = false
            val debugKey = signingConfigs.getByName("debug")
            // Sign with both schemes: v1 (JAR) so every Android version from 7 up accepts
            // the file, v2 (APK Signature Scheme) so modern Android is happy too.
            debugKey.enableV1Signing = true
            debugKey.enableV2Signing = true
            signingConfig = debugKey
        }
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/*.version")
    }

    lint {
        abortOnError = false
    }
}

/**
 * The renderer is bundled inside the APK (assets/www). That makes the WebView origin a
 * `file://` URL — a *secure context* — so getUserMedia (microphone + camera) is allowed
 * even when the user's own server is plain HTTP on the local network.
 */
val copyWebApp = tasks.register<Copy>("copyWebApp") {
    val dist = file("$rootDir/../dist")
    // Fail loudly instead of shipping an empty shell: run `npm run build:renderer` first.
    doFirst {
        if (!dist.exists()) {
            throw GradleException(
                "The renderer build is missing. Run `npm run build:renderer` in the repository root " +
                    "before assembling the APK (dist/ was not found)."
            )
        }
    }
    from(dist)
    into(layout.projectDirectory.dir("src/main/assets/www"))
}

tasks.named("preBuild") {
    dependsOn(copyWebApp)
}
