package com.aivision.camera.core

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Last-resort crash recorder.
 *
 * An Android app that dies silently cannot be fixed. Every uncaught exception is
 * written to a small file (with the device facts that usually matter: GPU, API
 * level, ABI) before the process goes down; the next launch offers the report
 * with copy / share buttons so it can be sent back for a fix.
 */
object Crash {

    private const val FILE_NAME = "last_crash.txt"
    private const val BOOT_FILE = "boot_trace.txt"

    /**
     * Reports are written twice: in the app's private files (always readable by
     * the app) and in the app's external folder, which a file manager can open
     * even when the app itself refuses to start.
     */
    private fun targets(ctx: Context, name: String): List<File> {
        val out = ArrayList<File>(2)
        out += File(ctx.filesDir, name)
        runCatching {
            ctx.getExternalFilesDir(null)?.let { out += File(it, name) }
        }
        return out
    }

    private fun writeAll(ctx: Context, name: String, text: String) {
        for (f in targets(ctx, name)) runCatching { f.writeText(text) }
    }

    private fun appendAll(ctx: Context, name: String, line: String) {
        for (f in targets(ctx, name)) {
            if (f.exists()) runCatching { f.appendText(line) }
        }
    }

    private fun readFirst(ctx: Context, name: String): String? {
        for (f in targets(ctx, name)) {
            if (f.exists()) {
                val text = runCatching { f.readText() }.getOrNull()
                if (!text.isNullOrBlank()) return text
            }
        }
        return null
    }

    private fun deleteAll(ctx: Context, name: String) {
        for (f in targets(ctx, name)) runCatching { f.delete() }
    }

    fun install(app: Application) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { record(app, thread, error) }
            if (previous != null) {
                previous.uncaughtException(thread, error)
            } else {
                Process.killProcess(Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
    }

    private fun header(context: String): String = buildString {
        appendLine("AI Vision Camera - crash report")
        appendLine("where     : $context")
        appendLine("when      : " + SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date()))
        appendLine("device    : ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
        appendLine("soc/board : ${Build.HARDWARE} / ${Build.BOARD}")
        appendLine("android   : ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("abi       : ${Build.SUPPORTED_ABIS.firstOrNull() ?: "?"}")
        appendLine()
    }

    private fun record(app: Application, thread: Thread, error: Throwable) {
        val text = buildString {
            append(header("uncaught exception on thread '${thread.name}'"))
            appendLine("exception : ${error.javaClass.name}: ${error.message}")
            appendLine()
            appendLine(error.stackTraceToString())
            var cause = error.cause
            var depth = 0
            while (cause != null && depth < 5) {
                appendLine()
                appendLine("caused by : ${cause.javaClass.name}: ${cause.message}")
                appendLine(cause.stackTraceToString())
                cause = cause.cause
                depth++
            }
        }
        writeAll(app, FILE_NAME, text)
    }

    /** Report a caught error that was serious enough to be worth keeping. */
    fun note(ctx: Context, where: String, error: Throwable) {
        // keep the first report of a launch: a later, less informative one must
        // not overwrite the crash that actually matters
        if (readFirst(ctx, FILE_NAME) != null) return
        val text = header(where) + "\n" + error.stackTraceToString()
        writeAll(ctx, FILE_NAME, text)
    }

    fun readLast(ctx: Context): String? = readFirst(ctx, FILE_NAME)

    fun clear(ctx: Context) {
        deleteAll(ctx, FILE_NAME)
    }

    // ------------------------------------------------------------- boot tracing
    /**
     * A crash handler cannot catch a death that happens before the JVM gets to
     * run it (a native or verifier level abort). To still be able to fix those,
     * every startup step is appended to a tiny file; if the step after it never
     * arrives, the next launch knows exactly where the previous one died.
     */
    fun beginBoot(ctx: Context, versionName: String) {
        val text = header("startup trace v$versionName") + "boot : started\n"
        writeAll(ctx, BOOT_FILE, text)
    }

    fun step(ctx: Context, label: String) {
        val ts = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
        appendAll(ctx, BOOT_FILE, "$ts  $label\n")
    }

    /** Called once the camera is actually streaming: the boot was fine. */
    fun bootComplete(ctx: Context) {
        deleteAll(ctx, BOOT_FILE)
    }

    /** Non-null when the previous run died before the camera was streaming. */
    fun incompleteBoot(ctx: Context): String? = readFirst(ctx, BOOT_FILE)

    fun clearBoot(ctx: Context) {
        deleteAll(ctx, BOOT_FILE)
    }
}
