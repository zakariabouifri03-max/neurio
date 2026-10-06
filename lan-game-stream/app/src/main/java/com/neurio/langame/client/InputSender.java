package com.neurio.langame.client;

import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.neurio.langame.common.Logger;
import com.neurio.langame.common.Protocol;
import com.neurio.langame.network.InputTransport;

import java.io.Closeable;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Batches controller events and pushes them at the host.
 *
 * <p>Latency rules:</p>
 * <ul>
 *   <li>Presses and releases flush <b>immediately</b> — they are what the player
 *       feels.</li>
 *   <li>Moves are coalesced into ~6 ms batches and rate limited per pointer, so a
 *       240 Hz touchscreen cannot flood a Wi-Fi link with 240 datagrams/s.</li>
 *   <li>Timestamps are converted into the host's uptime clock using the offset
 *       measured during the handshake, which lets the host display a real
 *       end-to-end input latency instead of a guess.</li>
 * </ul>
 */
public final class InputSender implements Closeable {

    private static final String TAG = "InputSender";
    private static final long MOVE_BATCH_MS = 6L;
    private static final int MAX_EVENTS = 32;
    private static final long MOVE_MIN_INTERVAL_MS = 4L;

    private final InputTransport.Sender transport;
    private final long clockOffsetMs;
    private final byte[] batch = InputTransport.newBatchBuffer(MAX_EVENTS);
    private final ByteBuffer writer = ByteBuffer.wrap(batch);
    private final HandlerThread thread = new HandlerThread("lgs-input-tx",
            android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY);
    private final Handler handler;
    private final long[] lastMoveAtMs = new long[16];
    private final AtomicInteger eventsSent = new AtomicInteger();

    private int pendingEvents;
    private long batchHostTimeMs;
    private boolean flushScheduled;
    private volatile boolean closed;

    public InputSender(String hostAddress, int sessionTag, long clockOffsetMs) throws IOException {
        this.transport = new InputTransport.Sender(hostAddress, sessionTag);
        this.clockOffsetMs = clockOffsetMs;
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    /* ----------------------------- events ----------------------------- */

    public void down(int pointerId, float x, float y) {
        addEvent(Protocol.INPUT_DOWN, pointerId, 0, x, y, true);
    }

    public void move(int pointerId, float x, float y) {
        long now = SystemClock.uptimeMillis();
        int slot = Math.abs(pointerId) % lastMoveAtMs.length;
        if (now - lastMoveAtMs[slot] < MOVE_MIN_INTERVAL_MS) {
            return;   // rate limit per pointer
        }
        lastMoveAtMs[slot] = now;
        addEvent(Protocol.INPUT_MOVE, pointerId, 0, x, y, false);
    }

    public void up(int pointerId, float x, float y) {
        addEvent(Protocol.INPUT_UP, pointerId, 0, x, y, true);
    }

    public void keyDown(int code) {
        addEvent(Protocol.INPUT_KEY_DOWN, 0, code, 0f, 0f, true);
    }

    public void keyUp(int code) {
        addEvent(Protocol.INPUT_KEY_UP, 0, code, 0f, 0f, true);
    }

    private synchronized void addEvent(int type, int pointerId, int code, float x, float y,
                                       boolean immediate) {
        if (closed) {
            return;
        }
        if (pendingEvents == 0) {
            batchHostTimeMs = System.currentTimeMillis() + clockOffsetMs;
            writer.position(Protocol.INPUT_HEADER_SIZE);
        }
        if (pendingEvents >= MAX_EVENTS) {
            flushLocked();
            batchHostTimeMs = System.currentTimeMillis() + clockOffsetMs;
            writer.position(Protocol.INPUT_HEADER_SIZE);
        }
        writer.put((byte) type);
        writer.put((byte) pointerId);
        writer.putShort((short) code);
        writer.putFloat(x);
        writer.putFloat(y);
        long eventHostTime = System.currentTimeMillis() + clockOffsetMs;
        writer.putInt((int) (eventHostTime - batchHostTimeMs));
        pendingEvents++;

        if (immediate) {
            flushLocked();
        } else {
            scheduleFlush();
        }
    }

    private void scheduleFlush() {
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        handler.postDelayed(() -> {
            flushScheduled = false;
            synchronized (InputSender.this) {
                flushLocked();
            }
        }, MOVE_BATCH_MS);
    }

    private void flushLocked() {
        if (pendingEvents == 0) {
            return;
        }
        int length = Protocol.INPUT_HEADER_SIZE + pendingEvents * Protocol.INPUT_EVENT_SIZE;
        // The transport stamps the sequence number and the batch timestamp (which is
        // already expressed in the host's clock).
        transport.sendBatch(batch, length, pendingEvents, batchHostTimeMs);
        eventsSent.addAndGet(pendingEvents);
        pendingEvents = 0;
    }

    public int eventsSent() {
        return eventsSent.get();
    }

    public int packetsSent() {
        return transport.packetsSent();
    }

    @Override
    public void close() {
        synchronized (this) {
            flushLocked();
            closed = true;
        }
        transport.close();
        try {
            thread.quitSafely();
        } catch (Exception ignored) {
        }
        Logger.i(TAG, "Input sender closed after " + eventsSent.get() + " events");
    }
}
