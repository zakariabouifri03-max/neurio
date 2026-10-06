package org.json;

/* see JSONObject.java — test-only stand-in for the real org.json on Android */

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

public class JSONArray {

    private final List<Object> list = new ArrayList<>();

    public JSONArray() { }

    public JSONArray(Collection<?> c) {
        if (c != null) list.addAll(c);
    }

    public JSONArray(List<Object> raw) {
        list.addAll(raw);
    }

    public JSONArray(String json) {
        Object o = Json.parse(json);
        if (!(o instanceof List)) throw new JSONException("not an array");
        list.addAll((List<Object>) o);
    }

    public JSONArray put(Object value) {
        list.add(value);
        return this;
    }

    public int length() {
        return list.size();
    }

    public Object opt(int i) {
        return i >= 0 && i < list.size() ? list.get(i) : null;
    }

    public String optString(int i) {
        Object o = opt(i);
        return o == null ? "" : String.valueOf(o);
    }

    public String getString(int i) {
        String s = optString(i);
        if (s.isEmpty() && opt(i) == null) throw new JSONException("no index " + i);
        return s;
    }

    public JSONObject getJSONObject(int i) {
        JSONObject o = optJSONObject(i);
        if (o == null) throw new JSONException("no object at " + i);
        return o;
    }

    public JSONArray optJSONArray(int i) {
        Object o = opt(i);
        return o instanceof java.util.List ? new JSONArray((java.util.List<Object>) o) : null;
    }

    public JSONObject optJSONObject(int i) {
        Object o = opt(i);
        return o instanceof java.util.Map ? new JSONObject((java.util.Map<String, Object>) o) : null;
    }

    @Override
    public String toString() {
        return Json.write(list);
    }
}
