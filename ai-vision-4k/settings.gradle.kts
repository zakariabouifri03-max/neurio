@file:Suppress("UnstableApiUsage")

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "AI Vision 4K"

// The reusable engine. Owns 100% of the native code (C++/Vulkan/JNI) and the
// game-developer facing `AIUpscaler` API.
//
// A game that wants in-pipeline AI upscaling adds exactly this module:
//     implementation(project(":aiupscaler-sdk"))
// or consumes the published .aar.
include(":aiupscaler-sdk")

// The end-user application: dashboard, game compatibility, profiles,
// monitoring, benchmark, model manager.
include(":app")
