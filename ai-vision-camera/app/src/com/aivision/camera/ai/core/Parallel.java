package com.aivision.camera.ai.core;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Tiny work-stealing-free fork/join helper: splits a pixel-parallel job into horizontal bands and
 * runs them on a shared thread pool. All AI stages are implemented as band jobs so a flagship SoC
 * uses every big core while a low-end device simply runs fewer bands.
 */
public final class Parallel {

    public interface Band {
        void run(int y0, int y1) throws Exception;
    }

    /** Band job that also receives its band index (for per-band partial reduction buffers). */
    public interface IndexedBand {
        void run(int index, int y0, int y1) throws Exception;
    }

    private static int threads = Math.max(1, Runtime.getRuntime().availableProcessors());
    private static java.util.concurrent.ExecutorService pool =
            java.util.concurrent.Executors.newFixedThreadPool(threads, new java.util.concurrent.ThreadFactory() {
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "ai-band");
                    t.setDaemon(true);
                    t.setPriority(Thread.NORM_PRIORITY + 1);
                    return t;
                }
            });

    private Parallel() {
    }

    public static int threads() {
        return threads;
    }

    /** Re-sizes the pool (called once at startup from the device profiler). */
    public static synchronized void configure(int nThreads) {
        nThreads = Math.max(1, Math.min(16, nThreads));
        if (nThreads == threads && pool != null) return;
        if (pool != null) pool.shutdownNow();
        threads = nThreads;
        pool = java.util.concurrent.Executors.newFixedThreadPool(threads, new java.util.concurrent.ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "ai-band");
                t.setDaemon(true);
                t.setPriority(Thread.NORM_PRIORITY + 1);
                return t;
            }
        });
    }

    /**
     * Runs {@code band} over {@code height} rows split in {@code bandCount} chunks, waiting for all
     * of them. Exceptions from any band are rethrown on the caller thread.
     */
    public static void rows(int height, Band band) throws Exception {
        rows(height, Math.min(threads * 2, Math.max(1, height)), band);
    }

    /** Runs an indexed band job, returning the number of bands that ran. */
    public static int rowsIndexed(int height, int bandCount, final IndexedBand band) throws Exception {
        if (height <= 0) return 0;
        final int bands = Math.max(1, Math.min(bandCount, height));
        if (bands == 1 || threads == 1) {
            band.run(0, 0, height);
            return 1;
        }
        final CountDownLatch latch = new CountDownLatch(bands);
        final AtomicReference<Exception> err = new AtomicReference<Exception>();
        final int chunk = (height + bands - 1) / bands;
        int launched = 0;
        for (int i = 0; i < bands; i++) {
            final int index = i;
            final int y0 = i * chunk;
            final int y1 = Math.min(height, y0 + chunk);
            if (y0 >= y1) {
                latch.countDown();
                continue;
            }
            launched++;
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        band.run(index, y0, y1);
                    } catch (Exception e) {
                        err.compareAndSet(null, e);
                    } catch (Throwable t) {
                        err.compareAndSet(null, new RuntimeException(t));
                    } finally {
                        latch.countDown();
                    }
                }
            });
        }
        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        }
        Exception e = err.get();
        if (e != null) throw e;
        return launched;
    }

    public static void rows(int height, int bandCount, final Band band) throws Exception {
        if (height <= 0) return;
        if (bandCount <= 1 || threads == 1) {
            band.run(0, height);
            return;
        }
        bandCount = Math.min(bandCount, height);
        final CountDownLatch latch = new CountDownLatch(bandCount);
        final AtomicReference<Exception> err = new AtomicReference<Exception>();
        int chunk = (height + bandCount - 1) / bandCount;
        List<Runnable> jobs = new ArrayList<Runnable>(bandCount);
        for (int i = 0; i < bandCount; i++) {
            final int y0 = i * chunk;
            final int y1 = Math.min(height, y0 + chunk);
            if (y0 >= y1) {
                latch.countDown();
                continue;
            }
            jobs.add(new Runnable() {
                @Override
                public void run() {
                    try {
                        band.run(y0, y1);
                    } catch (Exception e) {
                        err.compareAndSet(null, e);
                    } catch (Throwable t) {
                        Exception e2 = new RuntimeException(t);
                        err.compareAndSet(null, e2);
                    } finally {
                        latch.countDown();
                    }
                }
            });
        }
        for (Runnable r : jobs) pool.execute(r);
        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        }
        Exception e = err.get();
        if (e != null) throw e;
    }
}
