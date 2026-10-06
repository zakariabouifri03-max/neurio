package com.aivision.camera.ai.core;

/**
 * Device performance tiers. The app profiles the SoC at startup (cores, big core clock, RAM, GPU)
 * and maps it onto one of these; every budget in the engine is derived from it, so a 2 GB budget
 * phone gets a 2.5 MP working resolution and a 2x super resolution while a flagship gets 12 MP and
 * 4x with more burst frames and a heavier tone mapping radius.
 */
public enum Tier {
    LOW("Efficient", 2400, 3, 2, 1, 1),
    MID("Balanced", 3000, 5, 2, 2, 2),
    HIGH("High performance", 3600, 8, 3, 2, 3),
    FLAGSHIP("Flagship", 4200, 12, 4, 3, 4);

    public final String label;
    public final int workingLongEdge;
    public final int maxBurstFrames;
    public final int maxUltraScale;
    public final int minUltraFrames;   // frames needed before multi frame SR is worth it
    public final int maxIterations;

    Tier(String label, int workingLongEdge, int maxBurstFrames, int maxUltraScale, int minUltraFrames,
         int maxIterations) {
        this.label = label;
        this.workingLongEdge = workingLongEdge;
        this.maxBurstFrames = maxBurstFrames;
        this.maxUltraScale = maxUltraScale;
        this.minUltraFrames = minUltraFrames;
        this.maxIterations = maxIterations;
    }

    /** Working resolution used by the stacking stage. */
    public int clampWorkingEdge(int requested) {
        if (requested <= 0) return workingLongEdge;
        return Math.min(requested, workingLongEdge);
    }

    public int clampFrames(int requested) {
        return Math.max(1, Math.min(requested, maxBurstFrames));
    }

    public int clampScale(int requested) {
        return Math.max(1, Math.min(requested, maxUltraScale));
    }
}
