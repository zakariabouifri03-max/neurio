package com.neurio.langame.network;

import com.neurio.langame.common.Configuration;
import com.neurio.langame.common.Logger;
import com.neurio.langame.common.NetworkStats;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.common.Protocol.ControlFrame;
import com.neurio.langame.common.Utils;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import javax.crypto.Mac;

/**
 * The reliable, authenticated control channel (TCP, {@code TCP_NODELAY}).
 *
 * <p>It carries the handshake, pairing, session negotiation, statistics reports
 * and quality commands. It deliberately does <b>not</b> carry video or input:
 * those go over UDP so a retransmission can never stall the interactive path.</p>
 */
public final class ControlChannel implements Closeable {

    private static final String TAG = "Control";

    public interface Listener {
        /** Called on the reader thread for every non-PING/PONG frame. */
        void onFrame(ControlFrame frame);

        /** Called once when the channel dies (EOF, error, explicit close). */
        void onClosed(String reason);
    }

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final Object writeLock = new Object();
    private final AtomicInteger counter = new AtomicInteger();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ConcurrentHashMap<Integer, ArrayBlockingQueue<ControlFrame>> waiters =
            new ConcurrentHashMap<>();
    private final NetworkStats stats = new NetworkStats(true);

    private volatile byte[] sessionKey;
    /** Reader thread only. */
    private volatile Mac readMac;
    /** Guarded by {@link #writeLock}. */
    private volatile Mac writeMac;
    private volatile Listener listener;
    private volatile long lastReceivedMs = System.currentTimeMillis();
    private volatile long lastPingSentMs;
    private Thread readerThread;
    private Thread keepAliveThread;
    private String closeReason = "closed";

    private ControlChannel(Socket socket) throws IOException {
        this.socket = socket;
        socket.setTcpNoDelay(true);
        socket.setKeepAlive(true);
        try {
            socket.setSendBufferSize(256 * 1024);
        } catch (SocketException ignored) {
        }
        this.in = new BufferedInputStream(socket.getInputStream(), 32 * 1024);
        this.out = new BufferedOutputStream(socket.getOutputStream(), 32 * 1024);
    }

    /* --------------------------- construction --------------------------- */

    public static ControlChannel connect(String address, int port, int timeoutMs) throws IOException {
        Socket socket = new Socket();
        socket.connect(new InetSocketAddress(address, port), timeoutMs);
        return new ControlChannel(socket);
    }

    public static ControlChannel accept(Socket accepted) throws IOException {
        return new ControlChannel(accepted);
    }

    public String remoteAddress() {
        return socket.getInetAddress() == null ? "?" : socket.getInetAddress().getHostAddress();
    }

    public int remotePort() {
        return socket.getPort();
    }

    public NetworkStats stats() {
        return stats;
    }

    /* ----------------------------- lifecycle ---------------------------- */

    /**
     * Sets the socket read timeout. Used during the handshake, where frames are
     * read synchronously; it must be reset to 0 before {@link #start} so the
     * reader thread blocks instead of spinning on timeouts.
     */
    public void setReadTimeout(int millis) throws SocketException {
        socket.setSoTimeout(millis);
    }

    /**
     * Synchronous read used by the handshake, before the reader thread exists.
     * Returns {@code null} on clean EOF.
     */
    public ControlFrame readFrameSync() throws IOException {
        return Protocol.readControlFrame(in);
    }

    /** Installs the session key; from now on every frame is HMAC authenticated. */
    public void setSessionKey(byte[] sessionKey) {
        try {
            // Two independent Mac instances: one for the reader thread, one for the
            // writer (javax.crypto.Mac is not thread safe).
            this.readMac = com.neurio.langame.common.Security.newMac(sessionKey);
            this.writeMac = com.neurio.langame.common.Security.newMac(sessionKey);
            this.sessionKey = sessionKey;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    public boolean isAuthenticated() {
        return sessionKey != null;
    }

    /**
     * A fresh Mac over the session key (or {@code null} before pairing). The
     * handshake uses this because it runs on the caller's thread rather than the
     * reader/writer threads.
     */
    public Mac macOrNull() {
        byte[] key = sessionKey;
        if (key == null) {
            return null;
        }
        try {
            return com.neurio.langame.common.Security.newMac(key);
        } catch (GeneralSecurityException e) {
            return null;
        }
    }

    public void start(Listener listener) {
        this.listener = listener;
        readerThread = Utils.startThread("lgs-control-rx", Thread.NORM_PRIORITY + 2, this::readLoop);
        keepAliveThread = Utils.startThread("lgs-control-ping", Thread.NORM_PRIORITY, this::keepAliveLoop);
    }

    private void readLoop() {
        try {
            while (!closed.get()) {
                ControlFrame frame = Protocol.readControlFrame(in);
                if (frame == null) {
                    break;
                }
                lastReceivedMs = System.currentTimeMillis();
                if (frame.isAuthenticated()) {
                    Mac localMac = readMac;
                    if (localMac == null || !Protocol.verifyControlFrame(frame, localMac)) {
                        Logger.w(TAG, "Dropping frame with a bad MAC (type=" + frame.type + ")");
                        continue;
                    }
                }
                switch (frame.type) {
                    case Protocol.MSG_PING:
                        sendRaw(Protocol.MSG_PONG, frame.body);
                        break;
                    case Protocol.MSG_PONG: {
                        long sent = frame.body.length >= 8
                                ? ByteBuffer.wrap(frame.body).getLong() : lastPingSentMs;
                        stats.onRttSample(System.currentTimeMillis() - sent);
                        break;
                    }
                    default: {
                        ArrayBlockingQueue<ControlFrame> waiter = waiters.get(frame.type);
                        if (waiter != null) {
                            waiter.offer(frame);
                        }
                        Listener l = listener;
                        if (l != null) {
                            l.onFrame(frame);
                        }
                    }
                }
            }
        } catch (IOException e) {
            if (!closed.get()) {
                closeReason = "I/O: " + e.getMessage();
            }
        } catch (Throwable t) {
            closeReason = "reader error: " + t;
            Logger.e(TAG, "Control reader crashed", t);
        } finally {
            close();
            Listener l = listener;
            if (l != null) {
                l.onClosed(closeReason);
            }
        }
    }

    private void keepAliveLoop() {
        while (!closed.get()) {
            Utils.sleepQuietly(Configuration.CONTROL_KEEPALIVE_MS);
            if (closed.get()) {
                return;
            }
            try {
                long now = System.currentTimeMillis();
                if (now - lastReceivedMs > Configuration.CONTROL_TIMEOUT_MS) {
                    closeReason = "peer silent for " + (now - lastReceivedMs) + " ms";
                    close();
                    return;
                }
                if (now - lastPingSentMs > Configuration.CONTROL_KEEPALIVE_MS) {
                    lastPingSentMs = now;
                    ByteBuffer body = Protocol.newBuffer(8);
                    body.putLong(now);
                    sendRaw(Protocol.MSG_PING, Protocol.toBytes(body));
                }
            } catch (Exception e) {
                closeReason = "keepalive failed: " + e;
                close();
                return;
            }
        }
    }

    /* ------------------------------ sending ----------------------------- */

    /** Sends an (unauthenticated) handshake frame. */
    public void sendRaw(int type, byte[] body) {
        write(new ControlFrame(type, System.currentTimeMillis(), counter.incrementAndGet(), body), null);
    }

    /** Sends an authenticated frame (requires {@link #setSessionKey}). */
    public void send(int type, byte[] body) {
        Mac localMac = writeMac;
        if (localMac == null) {
            throw new IllegalStateException("Control channel is not paired yet");
        }
        ControlFrame frame = new ControlFrame(type, System.currentTimeMillis(),
                counter.incrementAndGet(), body);
        frame.flags |= Protocol.FLAG_AUTHENTICATED;
        write(frame, localMac);
    }

    private void write(ControlFrame frame, Mac macToUse) {
        if (closed.get()) {
            return;
        }
        try {
            synchronized (writeLock) {
                Protocol.writeControlFrame(out, frame, macToUse);
            }
        } catch (IOException e) {
            closeReason = "write failed: " + e.getMessage();
            close();
        }
    }

    /**
     * Request/response helper used by the handshake: sends a frame and waits for
     * a frame of the expected type.
     */
    public ControlFrame request(int type, byte[] body, int expectedType, long timeoutMs,
                               boolean authenticated) throws IOException {
        ArrayBlockingQueue<ControlFrame> queue = new ArrayBlockingQueue<>(4);
        waiters.put(expectedType, queue);
        try {
            if (authenticated) {
                send(type, body);
            } else {
                sendRaw(type, body);
            }
            ControlFrame response = queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
            if (response == null) {
                throw new IOException("Timed out waiting for message " + expectedType);
            }
            return response;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while waiting for message " + expectedType);
        } finally {
            waiters.remove(expectedType);
        }
    }

    public float rttMs() {
        return stats.rttMs();
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            Utils.closeQuietly(socket);
        }
    }

    public boolean isClosed() {
        return closed.get();
    }

    public String closeReason() {
        return closeReason;
    }
}
