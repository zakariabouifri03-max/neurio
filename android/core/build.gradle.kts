/**
 * `:core` is a plain Kotlin/JVM module: pure domain models, formatting, parsing and
 * platform-independent business rules. It has no Android dependency, which keeps it
 * fast to compile, trivial to unit test and reusable.
 */
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
}
