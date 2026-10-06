package org.json;

/* test-only shim, see JSONObject.java */
public class JSONException extends RuntimeException {
    public JSONException(String message) {
        super(message);
    }
}
