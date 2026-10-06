package org.json;

/*
 * Minimal org.json stand-in, used ONLY by the desktop test harness
 * (android/tools/test.sh) so Extract.java can be exercised on a plain JVM.
 * Android ships the real org.json at runtime; this file is never compiled
 * into the APK — build.sh only compiles android/app/java + the generated R.java.
 */

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class JSONObject {

    private final Map<String, Object> map = new LinkedHashMap<>();

    public JSONObject() { }

    public JSONObject(String json) {
        Object o = Json.parse(json);
        if (!(o instanceof Map)) throw new JSONException("not an object");
        //noinspection unchecked
        map.putAll((Map<String, Object>) o);
    }

    public JSONObject put(String key, Object value) {
        map.put(key, value);
        return this;
    }

    public boolean has(String key) {
        return map.containsKey(key);
    }

    public Object opt(String key) {
        return map.get(key);
    }

    public String optString(String key) {
        Object o = map.get(key);
        return o == null ? "" : String.valueOf(o);
    }

    public String optString(String key, String fallback) {
        Object o = map.get(key);
        return o == null ? fallback : String.valueOf(o);
    }

    public String getString(String key) {
        Object o = map.get(key);
        if (o == null) throw new JSONException("no such key: " + key);
        return String.valueOf(o);
    }

    public long optLong(String key) {
        Object o = map.get(key);
        if (o instanceof Number) return ((Number) o).longValue();
        try {
            return Long.parseLong(optString(key, "0"));
        } catch (Exception e) {
            return 0;
        }
    }

    public int optInt(String key) {
        return (int) optLong(key);
    }

    public JSONObject optJSONObject(String key) {
        Object o = map.get(key);
        return o instanceof Map ? new JSONObject((Map<String, Object>) o) : null;
    }

    public JSONObject getJSONObject(String key) {
        JSONObject o = optJSONObject(key);
        if (o == null) throw new JSONException("no such object: " + key);
        return o;
    }

    public JSONArray optJSONArray(String key) {
        Object o = map.get(key);
        return o instanceof List ? new JSONArray((List<Object>) o) : null;
    }

    public JSONArray getJSONArray(String key) {
        JSONArray a = optJSONArray(key);
        if (a == null) throw new JSONException("no such array: " + key);
        return a;
    }

    public JSONObject( Map<String, Object> raw ) {
        map.putAll(raw);
    }

    @Override
    public String toString() {
        return Json.write(map);
    }
}
