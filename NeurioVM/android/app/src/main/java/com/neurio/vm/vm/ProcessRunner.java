package com.neurio.vm.vm;

import com.neurio.vm.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;

/**
 * Starts external binaries (qemu, proot, su, sh) and pipes their output into a
 * {@link VmSession} log.
 *
 * <p>Two modes matter:
 * <ul>
 *   <li><b>direct</b> — {@code ProcessBuilder} with an argv array. This is what
 *       works when the binary is executable by {@code untrusted_app}.</li>
 *   <li><b>via su</b> — the whole command is rendered into a single
 *       POSIX-quoted string and handed to {@code su -c}. Necessary because
 *       Android 10 removed execute permission on app-writable storage for
 *       unprivileged apps, so anything living in a Termux prefix or on
 *       {@code /data/local/tmp} needs root to run at all.</li>
 * </ul>
 */
public final class ProcessRunner {

    private static final String TAG = "ProcessRunner";

    private ProcessRunner() {}

    /** One line of output from a child process. */
    public interface Sink {
        void onLine(String stream, String line);
    }

    /** POSIX single-quote escaping: {@code 'it's'} → {@code 'it'\''s'}. */
    public static String quote(String s) {
        if (s == null) return "''";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        sb.append('\'');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'') sb.append("'\\''");
            else sb.append(c);
        }
        sb.append('\'');
        return sb.toString();
    }

    /** Renders an argv array into a shell command line. */
    public static String render(List<String> argv) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < argv.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(quote(argv.get(i)));
        }
        return sb.toString();
    }

    /**
     * Starts a command.
     *
     * @param viaSu   wrap in {@code su -c}
     * @param suPath  the {@code su} binary to use, or {@code "su"} for PATH lookup
     * @param workDir directory to run in, may be null
     */
    public static Process start(VmSession session, boolean viaSu, String suPath,
                                java.io.File workDir, List<String> argv) throws IOException {
        List<String> cmd = new ArrayList<>();
        if (viaSu) {
            cmd.add(suPath == null || suPath.isEmpty() ? "su" : suPath);
            cmd.add("-c");
            cmd.add(render(argv));
        } else {
            cmd.addAll(argv);
        }
        session.log("$ " + render(cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (workDir != null) pb.directory(workDir);
        pb.redirectErrorStream(false);
        return pb.start();
    }

    /**
     * Drains stdout and stderr on daemon threads until the process exits, then
     * reports the exit code into the session log.
     *
     * @return a latch that counts down when the process has terminated
     */
    public static CountDownLatch stream(final VmSession session, final Process p, final Sink sink) {
        final CountDownLatch done = new CountDownLatch(1);
        Thread out = reader(session, p, p.getInputStream(), "out", sink);
        Thread err = reader(session, p, p.getErrorStream(), "err", sink);
        out.start();
        err.start();
        Thread waiter = new Thread(() -> {
            try {
                int code = p.waitFor();
                session.log("process exited with code " + code);
                if (code != 0) {
                    session.setState(VmSession.State.FAILED, "exit code " + code);
                } else if (session.state() == VmSession.State.RUNNING
                        || session.state() == VmSession.State.STARTING) {
                    session.setState(VmSession.State.STOPPED);
                }
            } catch (InterruptedException e) {
                session.log("waiter interrupted");
                Thread.currentThread().interrupt();
            } finally {
                done.countDown();
            }
        }, "neurio-vm-wait");
        waiter.setDaemon(true);
        waiter.start();
        return done;
    }

    private static Thread reader(final VmSession session, final Process p,
                                 final InputStream in, final String which, final Sink sink) {
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (sink != null) {
                        try { sink.onLine(which, line); } catch (Throwable ignored) { }
                    }
                    session.log((which.equals("err") ? "! " : "  ") + line);
                }
            } catch (IOException e) {
                // the stream closes when the child dies; that is normal
                Log.d(TAG, which + " stream closed: " + e.getMessage());
            }
        }, "neurio-vm-" + which);
        t.setDaemon(true);
        return t;
    }

    /** Writes a line to the child's stdin — used by the terminal screen. */
    public static boolean write(Process p, String line) {
        try {
            OutputStream os = p.getOutputStream();
            os.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Runs a command to completion and returns its output, or null on timeout.
     * Used by probes.
     *
     * <p>{@code Process.waitFor(long, TimeUnit)} is only available from API 26,
     * and this project supports API 24, so the timeout is implemented with a
     * join on the reader thread plus an {@code exitValue()} poll.
     */
    public static String capture(long timeoutMs, String... argv) {
        Process p = null;
        try {
            ProcessBuilder pb = new ProcessBuilder(Arrays.asList(argv));
            pb.redirectErrorStream(true);
            p = pb.start();
            final Process proc = p;
            final StringBuilder sb = new StringBuilder();
            Thread t = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(
                        new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line).append('\n');
                } catch (IOException ignored) { }
            });
            t.setDaemon(true);
            t.start();
            t.join(timeoutMs);
            if (t.isAlive()) {
                p.destroy();
                return null;
            }
            return sb.toString();
        } catch (Throwable t) {
            if (p != null) p.destroy();
            return null;
        }
    }
}
