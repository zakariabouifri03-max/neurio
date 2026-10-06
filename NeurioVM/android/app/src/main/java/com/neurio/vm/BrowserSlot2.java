package com.neurio.vm;

/**
 * Isolated browser slot 1.
 *
 * <p>This class exists only so that the manifest can give it its own
 * {@code android:process} — {@code :vm1} — which is the mechanism that lets
 * four virtual handsets keep four separate Chromium profiles at once.
 * {@code WebView.setDataDirectorySuffix()} is fixed for the life of a process,
 * so a new profile genuinely requires a new process; there is no API to change
 * it in place.
 *
 * <p>Every bit of behaviour lives in {@link BrowserActivity}.
 */
public final class BrowserSlot2 extends BrowserActivity {
}
