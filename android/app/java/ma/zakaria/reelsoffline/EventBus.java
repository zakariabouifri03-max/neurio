package ma.zakaria.reelsoffline;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Iterator;

/**
 * Tiny in-process event bus (no androidx / support library in this app).
 * Used by the download service to tell the UI that the library changed.
 */
public final class EventBus {

    public static final String LIBRARY = "library";
    public static final String DOWNLOAD = "download";

    public interface Listener {
        void onEvent(String what);
    }

    private static final ArrayList<WeakReference<Listener>> LISTENERS = new ArrayList<>();

    private EventBus() { }

    public static void register(Listener l) {
        unregister(l);
        LISTENERS.add(new WeakReference<>(l));
    }

    public static void unregister(Listener l) {
        Iterator<WeakReference<Listener>> it = LISTENERS.iterator();
        while (it.hasNext()) {
            Listener x = it.next().get();
            if (x == null || x == l) it.remove();
        }
    }

    public static void post(String what) {
        for (int i = 0; i < LISTENERS.size(); i++) {
            Listener l = LISTENERS.get(i).get();
            if (l != null) {
                try {
                    l.onEvent(what);
                } catch (Throwable ignored) { }
            }
        }
    }
}
