package de.robv.android.xposed;

import java.io.File;
import java.util.Map;
import java.util.Set;

/**
 * Stub declaration of Xposed's cross-process SharedPreferences reader.
 *
 * <p>LSPosed implements this by asking its privileged daemon to read the target
 * package's {@code shared_prefs} XML, which is why it works even though
 * {@code MODE_WORLD_READABLE} has been rejected since Android 7. On a device
 * without that support the constructor succeeds and {@link #getString} simply
 * returns the default, so callers must always have a second path — in NeurioVM
 * that path is {@code HookProvider}.
 */
public class XSharedPreferences {

    public XSharedPreferences(String packageName) {}

    public XSharedPreferences(String packageName, String prefFileName) {}

    public File getFile() { return null; }

    public void reload() {}

    /** @deprecated in the real API; kept so the stub covers older modules. */
    @Deprecated
    public boolean makeWorldReadable() { return false; }

    public boolean hasFileChangedSinceLoaded() { return false; }

    public boolean checkFile() { return false; }

    public String getString(String key, String defValue) { return defValue; }

    public boolean getBoolean(String key, boolean defValue) { return defValue; }

    public int getInt(String key, int defValue) { return defValue; }

    public long getLong(String key, long defValue) { return defValue; }

    public float getFloat(String key, float defValue) { return defValue; }

    public Set<String> getStringSet(String key, Set<String> defValues) { return defValues; }

    public Map<String, ?> getAll() { return null; }
}
