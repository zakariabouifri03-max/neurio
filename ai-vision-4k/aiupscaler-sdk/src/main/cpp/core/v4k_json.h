// Minimal JSON reader/writer.
//
// The engine must not depend on a JSON library: the JNI surface passes
// structured data (device capabilities, profiles, benchmark reports) as JSON so
// that the Kotlin side can use org.json without any marshalling structs, and
// the native side needs to serialise the same data.
//
// Supports the subset we emit: objects, arrays, strings, numbers, booleans,
// null. Numbers are stored as double plus an int64 flag so integer fields
// round-trip exactly.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace v4k {

class JsonWriter {
public:
    explicit JsonWriter(int indentWidth = 0) : indentWidth_(indentWidth) {}

    void beginObject();
    void endObject();
    void beginArray();
    void endArray();

    void key(const std::string& k);
    void value(const std::string& v);
    void value(const char* v);
    void value(bool v);
    void value(int32_t v);
    void value(int64_t v);
    void value(uint32_t v);
    void value(uint64_t v);
    void value(float v);
    void value(double v);
    void nullValue();

    // Inserts already-serialised JSON as a value. Used to embed one document
    // (a profile, the session state) inside a bigger one like the status
    // snapshot without re-serialising or double-escaping it.
    void raw(const std::string& json);

    // Convenience: "key": value on one line.
    void field(const std::string& k, const std::string& v) { key(k); value(v); }
    void field(const std::string& k, const char* v) { key(k); value(v); }
    void field(const std::string& k, bool v) { key(k); value(v); }
    void field(const std::string& k, int32_t v) { key(k); value(v); }
    void field(const std::string& k, int64_t v) { key(k); value(v); }
    void field(const std::string& k, uint32_t v) { key(k); value(v); }
    void field(const std::string& k, uint64_t v) { key(k); value(v); }
    void field(const std::string& k, float v) { key(k); value(v); }
    void field(const std::string& k, double v) { key(k); value(v); }
    void fieldNull(const std::string& k) { key(k); nullValue(); }

    const std::string& str() const { return out_; }

private:
    void writeIndent();
    void closePrevious();
    void startValue();

    std::string out_;
    std::vector<bool> inArray_;   // stack: true if current container is an array
    std::vector<bool> firstItem_; // stack: true if next item is the first
    bool pendingKey_ = false;
    int indentWidth_ = 0;
    int depth_ = 0;
};

// ---------------------------------------------------------------------------

class JsonValue;

// Shared immutable null value returned for missing members.
const JsonValue& kNullValue();

class JsonValue {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    JsonValue() = default;
    static JsonValue makeObject();
    static JsonValue makeArray();

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isObject() const { return type_ == Type::Object; }
    bool isArray() const { return type_ == Type::Array; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isBool() const { return type_ == Type::Bool; }

    bool asBool(bool fallback = false) const;
    double asDouble(double fallback = 0.0) const;
    int64_t asInt(int64_t fallback = 0) const;
    float asFloat(float fallback = 0.0f) const;
    std::string asString(const std::string& fallback = std::string()) const;

    // Object access. Returns a shared null value when missing.
    const JsonValue& operator[](const std::string& key) const;
    bool has(const std::string& key) const;
    const std::vector<std::pair<std::string, JsonValue>>& members() const { return members_; }

    // Array access.
    size_t size() const { return elements_.size(); }
    const JsonValue& at(size_t index) const;

    // Mutation (used by the parser only).
    void setMember(const std::string& key, JsonValue v);
    void push(JsonValue v);
    void setNumber(double d, bool isInteger);
    void setString(std::string s);
    void setBool(bool b);

    // Serialise back out.
    void writeTo(JsonWriter& w) const;

    // Parse. Returns nullptr + fills `error` on malformed input.
    static std::shared_ptr<JsonValue> parse(const std::string& text, std::string* error);

private:
    Type type_ = Type::Null;
    bool bool_ = false;
    double number_ = 0.0;
    bool numberIsInteger_ = false;
    std::string string_;
    std::vector<JsonValue> elements_;
    std::vector<std::pair<std::string, JsonValue>> members_;
};

inline const JsonValue& JsonValue::operator[](const std::string& key) const {
    for (const auto& kv : members_) {
        if (kv.first == key) return kv.second;
    }
    return kNullValue();
}

// Read a JSON file, or return nullptr.
std::shared_ptr<JsonValue> jsonParseFile(const std::string& path, std::string* error);

std::string jsonEscape(const std::string& in);

}  // namespace v4k
