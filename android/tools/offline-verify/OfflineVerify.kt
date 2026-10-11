/**
 * Offline test runner for the `:core` module.
 *
 * `gradle :core:test` is the canonical way to run these tests. This runner exists so the
 * pure-Kotlin domain layer can also be verified on a machine that has a Kotlin compiler
 * but no Gradle daemon and no network (it uses plain JVM reflection instead of JUnit).
 *
 * Usage (from the repository root):
 *   kotlinc -cp $KOTLIN_HOME/lib/kotlin-test.jar \
 *           -d /tmp/vyro-core-tests \
 *           core/src/main/kotlin core/src/test/kotlin tools/offline-verify/OfflineVerify.kt
 *   java -cp /tmp/vyro-core-tests:$KOTLIN_HOME/lib/kotlin-test.jar OfflineVerifyKt
 *
 * Exits with status 1 when any assertion fails.
 */
private val TEST_CLASSES =
    listOf(
        "com.vyro.core.Iso8601DurationTest",
        "com.vyro.core.Iso8601DateTimeTest",
        "com.vyro.core.FormattersTest",
        "com.vyro.core.YouTubeLinkTest",
        "com.vyro.core.YouTubeQueryBuilderTest",
        "com.vyro.core.PolicyTest",
        "com.vyro.core.QualityResolverTest",
    )

fun main() {
    var passed = 0
    val failures = mutableListOf<String>()

    for (className in TEST_CLASSES) {
        val clazz =
            try {
                Class.forName(className)
            } catch (e: ClassNotFoundException) {
                failures += "$className :: class not found (${e.message})"
                continue
            }

        val instance = clazz.getDeclaredConstructor().newInstance()
        val tests =
            clazz.methods
                .filter { it.declaringClass == clazz && it.parameterCount == 0 && it.returnType == Void.TYPE }
                .sortedBy { it.name }

        println(clazz.simpleName)
        if (tests.isEmpty()) {
            failures += "${clazz.simpleName} :: no test methods discovered"
        }
        for (method in tests) {
            try {
                method.invoke(instance)
                passed++
                println("  PASS  ${method.name}")
            } catch (throwable: Throwable) {
                val cause = throwable.cause ?: throwable
                failures += "${clazz.simpleName}.${method.name} :: ${cause::class.simpleName}: ${cause.message}"
                println("  FAIL  ${method.name} -> ${cause.message}")
            }
        }
    }

    println()
    println("Tests passed : $passed")
    println("Tests failed : ${failures.size}")
    failures.forEach { println("  - $it") }

    if (failures.isNotEmpty()) {
        kotlin.system.exitProcess(1)
    }
}
