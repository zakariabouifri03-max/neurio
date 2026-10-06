plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

/*
 * The engine module. Everything that touches Vulkan, NNAPI, the AI models and
 * the JNI boundary lives here, so a game ships exactly one dependency.
 */
android {
    namespace = "com.aivision4k.sdk"
    compileSdk = 35
    ndkVersion = "27.3.13750724"

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
        ndk {
            // 64-bit only by default. 32-bit builds are possible (see docs/BUILD.md)
            // but compute-heavy upscaling on 32-bit address space is explicitly
            // reported as unsupported by the compatibility engine.
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DANDROID_STL=c++_static",
                    "-DV4K_BUILD_TESTS=OFF",
                    "-DV4K_ENABLE_VULKAN=ON",
                    "-DV4K_ENABLE_NNAPI=ON",
                )
                // Release CMake build type for release builds is handled by AGP.
            }
        }
    }

    buildTypes {
        debug {
            externalNativeBuild {
                cmake { arguments += "-DV4K_DEBUG_CHECKS=ON" }
            }
        }
        release {
            externalNativeBuild {
                cmake { arguments += "-DV4K_DEBUG_CHECKS=OFF" }
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
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
        buildConfig = false
    }
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.annotation:annotation:1.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
}
