// NovaForge Engine - JSON (parser + writer)
// Small, dependency free, insertion ordered. Used for project.json, scene
// files, material/asset metadata and the AI action log - all human readable.
#pragma once
#include <string>
#include <utility>
#include <vector>

namespace nf {

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Json() : type_(Type::Null) {}
    Json(bool b) : type_(Type::Bool), bool_(b) {}
    Json(double n) : type_(Type::Number), num_(n) {}
    Json(int n) : type_(Type::Number), num_((double)n) {}
    Json(unsigned n) : type_(Type::Number), num_((double)n) {}
    Json(long n) : type_(Type::Number), num_((double)n) {}
    Json(unsigned long n) : type_(Type::Number), num_((double)n) {}
    Json(long long n) : type_(Type::Number), num_((double)n) {}
    Json(float n) : type_(Type::Number), num_((double)n) {}
    Json(const char* s) : type_(Type::String), str_(s ? s : "") {}
    Json(const std::string& s) : type_(Type::String), str_(s) {}

    static Json array() { Json j; j.type_ = Type::Array; return j; }
    static Json object() { Json j; j.type_ = Type::Object; return j; }

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Bool; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    // --- accessors with defaults (never throw: a malformed project file
    // should degrade gracefully, see engine/core/log.h error reporting) ---
    bool asBool(bool d = false) const { return type_ == Type::Bool ? bool_ : d; }
    double asNumber(double d = 0) const { return type_ == Type::Number ? num_ : d; }
    float asFloat(float d = 0) const { return type_ == Type::Number ? (float)num_ : d; }
    int asInt(int d = 0) const { return type_ == Type::Number ? (int)num_ : d; }
    long long asInt64(long long d = 0) const { return type_ == Type::Number ? (long long)num_ : d; }
    std::string asString(const std::string& d = "") const {
        return type_ == Type::String ? str_ : d;
    }

    const std::vector<Json>& items() const { return arr_; }
    std::vector<Json>& items() { return arr_; }
    const std::vector<std::pair<std::string, Json>>& fields() const { return obj_; }
    std::vector<std::pair<std::string, Json>>& fields() { return obj_; }

    size_t size() const { return type_ == Type::Array ? arr_.size() : obj_.size(); }

    // array
    void push(const Json& v) {
        if (type_ != Type::Array) { type_ = Type::Array; arr_.clear(); }
        arr_.push_back(v);
    }
    const Json& operator[](size_t i) const {
        static const Json null;
        return i < arr_.size() ? arr_[i] : null;
    }
    const Json& operator[](int i) const { return (*this)[(size_t)i]; }
    // Non const array access. Grows the array on demand (that is what scene
    // loaders and the AI assistant expect when building JSON programmatically).
    Json& operator[](size_t i) {
        if (type_ != Type::Array) { type_ = Type::Array; arr_.clear(); }
        while (arr_.size() <= i) arr_.push_back(Json());
        return arr_[i];
    }
    Json& operator[](int i) { return (*this)[(size_t)(i < 0 ? 0 : i)]; }
    const Json& at(size_t i) const { return (*this)[i]; }

    // object
    Json& operator[](const std::string& key);
    const Json& operator[](const std::string& key) const;
    bool has(const std::string& key) const { return find(key) != nullptr; }
    Json& set(const std::string& key, const Json& v) { (*this)[key] = v; return *this; }
    Json& set(const std::string& key, double v) { return set(key, Json(v)); }
    Json& set(const std::string& key, int v) { return set(key, Json(v)); }
    Json& set(const std::string& key, bool v) { return set(key, Json(v)); }
    Json& set(const std::string& key, const char* v) { return set(key, Json(v)); }
    Json& set(const std::string& key, const std::string& v) { return set(key, Json(v)); }
    void erase(const std::string& key);

    // nesting helpers (auto create)
    Json& objectAt(const std::string& key) {
        Json& v = (*this)[key];
        if (!v.isObject()) v = Json::object();
        return v;
    }
    Json& arrayAt(const std::string& key) {
        Json& v = (*this)[key];
        if (!v.isArray()) v = Json::array();
        return v;
    }

    std::string dump(int indent = 2) const;
    static Json parse(const std::string& text, std::string* error = nullptr);
    static bool parseFile(const std::string& path, Json& out, std::string* error = nullptr);
    bool saveFile(const std::string& path, int indent = 2) const;

private:
    void dumpTo(std::string& out, int indent, int depth) const;
    const Json* find(const std::string& key) const;
    Json* find(const std::string& key);

    Type type_ = Type::Null;
    bool bool_ = false;
    double num_ = 0;
    std::string str_;
    std::vector<Json> arr_;
    std::vector<std::pair<std::string, Json>> obj_;
};

}  // namespace nf
