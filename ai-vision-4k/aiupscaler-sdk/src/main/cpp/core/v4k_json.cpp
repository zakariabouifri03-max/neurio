#include "v4k_json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>

#include "v4k_log.h"

namespace v4k {

const JsonValue& kNullValue() {
    static const JsonValue nullValue;
    return nullValue;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------
std::string jsonEscape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------
void JsonWriter::writeIndent() {
    if (indentWidth_ <= 0) return;
    out_ += '\n';
    out_.append(static_cast<size_t>(indentWidth_ * depth_), ' ');
}

void JsonWriter::key(const std::string& k) {
    if (!inArray_.empty() && !inArray_.back()) {
        if (!firstItem_.back()) out_ += ',';
        firstItem_.back() = false;
        writeIndent();
    }
    out_ += '"';
    out_ += jsonEscape(k);
    out_ += "\":";
    if (indentWidth_ > 0) out_ += ' ';
    pendingKey_ = true;
}

void JsonWriter::startValue() {
    if (pendingKey_) {
        pendingKey_ = false;
        return;
    }
    if (!inArray_.empty() && inArray_.back()) {
        if (!firstItem_.back()) out_ += ',';
        firstItem_.back() = false;
        writeIndent();
    }
}

void JsonWriter::beginObject() {
    startValue();
    out_ += '{';
    inArray_.push_back(false);
    firstItem_.push_back(true);
    ++depth_;
}

void JsonWriter::endObject() {
    bool wasEmpty = firstItem_.empty() ? true : firstItem_.back();
    --depth_;
    if (!inArray_.empty()) inArray_.pop_back();
    if (!firstItem_.empty()) firstItem_.pop_back();
    if (indentWidth_ > 0 && !wasEmpty) writeIndent();
    out_ += '}';
    pendingKey_ = false;
}

void JsonWriter::beginArray() {
    startValue();
    out_ += '[';
    inArray_.push_back(true);
    firstItem_.push_back(true);
    ++depth_;
}

void JsonWriter::endArray() {
    bool wasEmpty = firstItem_.empty() ? true : firstItem_.back();
    --depth_;
    if (!inArray_.empty()) inArray_.pop_back();
    if (!firstItem_.empty()) firstItem_.pop_back();
    if (indentWidth_ > 0 && !wasEmpty) writeIndent();
    out_ += ']';
    pendingKey_ = false;
}

void JsonWriter::value(const std::string& v) {
    startValue();
    out_ += '"';
    out_ += jsonEscape(v);
    out_ += '"';
}

void JsonWriter::raw(const std::string& json) {
    startValue();
    out_ += json;
}

void JsonWriter::value(const char* v) { value(std::string(v == nullptr ? "" : v)); }

void JsonWriter::value(bool v) {
    startValue();
    out_ += v ? "true" : "false";
}

void JsonWriter::value(int32_t v) { value(static_cast<int64_t>(v)); }
void JsonWriter::value(uint32_t v) { value(static_cast<uint64_t>(v)); }

void JsonWriter::value(int64_t v) {
    startValue();
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(v));
    out_ += buf;
}

void JsonWriter::value(uint64_t v) {
    startValue();
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%llu", static_cast<unsigned long long>(v));
    out_ += buf;
}

void JsonWriter::value(double v) {
    startValue();
    if (!std::isfinite(v)) {
        // JSON has no NaN/Infinity. Never emit invalid JSON: use null and let
        // the reader treat it as "measurement unavailable".
        out_ += "null";
        return;
    }
    if (v == std::floor(v) && std::fabs(v) < 1e15) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(v));
        out_ += buf;
        return;
    }
    char buf[40];
    std::snprintf(buf, sizeof(buf), "%.9g", v);
    out_ += buf;
}

void JsonWriter::value(float v) { value(static_cast<double>(v)); }

void JsonWriter::nullValue() {
    startValue();
    out_ += "null";
}

// ---------------------------------------------------------------------------
// JsonValue
// ---------------------------------------------------------------------------
JsonValue JsonValue::makeObject() {
    JsonValue v;
    v.type_ = Type::Object;
    return v;
}

JsonValue JsonValue::makeArray() {
    JsonValue v;
    v.type_ = Type::Array;
    return v;
}

bool JsonValue::asBool(bool fallback) const {
    if (type_ == Type::Bool) return bool_;
    if (type_ == Type::Number) return number_ != 0.0;
    return fallback;
}

double JsonValue::asDouble(double fallback) const {
    if (type_ == Type::Number) return number_;
    if (type_ == Type::Bool) return bool_ ? 1.0 : 0.0;
    return fallback;
}

int64_t JsonValue::asInt(int64_t fallback) const {
    if (type_ == Type::Number) return static_cast<int64_t>(number_ < 0 ? number_ - 0.5 : number_ + 0.5);
    if (type_ == Type::Bool) return bool_ ? 1 : 0;
    return fallback;
}

float JsonValue::asFloat(float fallback) const { return static_cast<float>(asDouble(fallback)); }

std::string JsonValue::asString(const std::string& fallback) const {
    if (type_ == Type::String) return string_;
    return fallback;
}

bool JsonValue::has(const std::string& key) const {
    for (const auto& kv : members_) {
        if (kv.first == key) return true;
    }
    return false;
}

const JsonValue& JsonValue::at(size_t index) const {
    if (index >= elements_.size()) return kNullValue();
    return elements_[index];
}

void JsonValue::setMember(const std::string& key, JsonValue v) {
    if (type_ != Type::Object) {
        type_ = Type::Object;
        members_.clear();
    }
    for (auto& kv : members_) {
        if (kv.first == key) {
            kv.second = std::move(v);
            return;
        }
    }
    members_.emplace_back(key, std::move(v));
}

void JsonValue::push(JsonValue v) {
    if (type_ != Type::Array) {
        type_ = Type::Array;
        elements_.clear();
    }
    elements_.push_back(std::move(v));
}

void JsonValue::setNumber(double d, bool isInteger) {
    type_ = Type::Number;
    number_ = d;
    numberIsInteger_ = isInteger;
}

void JsonValue::setString(std::string s) {
    type_ = Type::String;
    string_ = std::move(s);
}

void JsonValue::setBool(bool b) {
    type_ = Type::Bool;
    bool_ = b;
}

void JsonValue::writeTo(JsonWriter& w) const {
    switch (type_) {
        case Type::Null: w.nullValue(); break;
        case Type::Bool: w.value(bool_); break;
        case Type::Number:
            if (numberIsInteger_) {
                w.value(static_cast<int64_t>(number_));
            } else {
                w.value(number_);
            }
            break;
        case Type::String: w.value(string_); break;
        case Type::Array:
            w.beginArray();
            for (const auto& e : elements_) e.writeTo(w);
            w.endArray();
            break;
        case Type::Object:
            w.beginObject();
            for (const auto& kv : members_) {
                w.key(kv.first);
                kv.second.writeTo(w);
            }
            w.endObject();
            break;
    }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
namespace {

class Parser {
public:
    Parser(const std::string& text, std::string* error) : s_(text), err_(error) {}

    bool parse(JsonValue& out) {
        skipWs();
        if (!parseValue(out)) return false;
        skipWs();
        if (pos_ != s_.size()) return fail("trailing characters after JSON value");
        return true;
    }

private:
    const std::string& s_;
    std::string* err_;
    size_t pos_ = 0;

    bool fail(const char* message) {
        if (err_ != nullptr) {
            std::ostringstream os;
            os << "JSON error at offset " << pos_ << ": " << message;
            *err_ = os.str();
        }
        return false;
    }

    void skipWs() {
        while (pos_ < s_.size()) {
            char c = s_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos_;
            } else {
                break;
            }
        }
    }

    bool literal(const char* text) {
        size_t n = std::strlen(text);
        if (s_.compare(pos_, n, text) != 0) return false;
        pos_ += n;
        return true;
    }

    bool parseValue(JsonValue& out) {
        if (pos_ >= s_.size()) return fail("unexpected end of input");
        char c = s_[pos_];
        switch (c) {
            case '{': return parseObject(out);
            case '[': return parseArray(out);
            case '"': {
                std::string str;
                if (!parseString(str)) return false;
                out.setString(std::move(str));
                return true;
            }
            case 't':
                if (!literal("true")) return fail("invalid literal");
                out.setBool(true);
                return true;
            case 'f':
                if (!literal("false")) return fail("invalid literal");
                out.setBool(false);
                return true;
            case 'n':
                if (!literal("null")) return fail("invalid literal");
                out = JsonValue();
                return true;
            default: return parseNumber(out);
        }
    }

    bool parseObject(JsonValue& out) {
        ++pos_;  // '{'
        out = JsonValue::makeObject();
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == '}') {
            ++pos_;
            return true;
        }
        while (true) {
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != '"') return fail("expected object key");
            std::string key;
            if (!parseString(key)) return false;
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != ':') return fail("expected ':'");
            ++pos_;
            skipWs();
            JsonValue v;
            if (!parseValue(v)) return false;
            out.setMember(key, std::move(v));
            skipWs();
            if (pos_ < s_.size() && s_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (pos_ < s_.size() && s_[pos_] == '}') {
                ++pos_;
                return true;
            }
            return fail("expected ',' or '}'");
        }
    }

    bool parseArray(JsonValue& out) {
        ++pos_;  // '['
        out = JsonValue::makeArray();
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == ']') {
            ++pos_;
            return true;
        }
        while (true) {
            skipWs();
            JsonValue v;
            if (!parseValue(v)) return false;
            out.push(std::move(v));
            skipWs();
            if (pos_ < s_.size() && s_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (pos_ < s_.size() && s_[pos_] == ']') {
                ++pos_;
                return true;
            }
            return fail("expected ',' or ']'");
        }
    }

    static void appendUtf8(std::string& out, uint32_t cp) {
        if (cp <= 0x7F) {
            out += static_cast<char>(cp);
        } else if (cp <= 0x7FF) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp <= 0xFFFF) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    bool parseHex4(uint32_t& value) {
        if (pos_ + 4 > s_.size()) return fail("truncated \\u escape");
        value = 0;
        for (int i = 0; i < 4; ++i) {
            char c = s_[pos_++];
            value <<= 4;
            if (c >= '0' && c <= '9') {
                value |= static_cast<uint32_t>(c - '0');
            } else if (c >= 'a' && c <= 'f') {
                value |= static_cast<uint32_t>(c - 'a' + 10);
            } else if (c >= 'A' && c <= 'F') {
                value |= static_cast<uint32_t>(c - 'A' + 10);
            } else {
                return fail("bad hex digit in \\u escape");
            }
        }
        return true;
    }

    bool parseString(std::string& out) {
        ++pos_;  // opening quote
        out.clear();
        while (true) {
            if (pos_ >= s_.size()) return fail("unterminated string");
            unsigned char c = static_cast<unsigned char>(s_[pos_++]);
            if (c == '"') return true;
            if (c == '\\') {
                if (pos_ >= s_.size()) return fail("unterminated escape");
                char e = s_[pos_++];
                switch (e) {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'n': out += '\n'; break;
                    case 'r': out += '\r'; break;
                    case 't': out += '\t'; break;
                    case 'u': {
                        uint32_t cp = 0;
                        if (!parseHex4(cp)) return false;
                        if (cp >= 0xD800 && cp <= 0xDBFF) {
                            // High surrogate: expect a low surrogate.
                            if (pos_ + 1 < s_.size() && s_[pos_] == '\\' && s_[pos_ + 1] == 'u') {
                                pos_ += 2;
                                uint32_t lo = 0;
                                if (!parseHex4(lo)) return false;
                                if (lo >= 0xDC00 && lo <= 0xDFFF) {
                                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                                } else {
                                    appendUtf8(out, 0xFFFD);
                                    cp = lo;
                                }
                            } else {
                                cp = 0xFFFD;
                            }
                        }
                        appendUtf8(out, cp);
                        break;
                    }
                    default: return fail("unknown escape sequence");
                }
                continue;
            }
            if (c < 0x20) return fail("raw control character in string");
            out += static_cast<char>(c);
        }
    }

    bool parseNumber(JsonValue& out) {
        size_t start = pos_;
        bool isInteger = true;
        if (pos_ < s_.size() && (s_[pos_] == '-' || s_[pos_] == '+')) ++pos_;
        bool anyDigit = false;
        while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') {
            ++pos_;
            anyDigit = true;
        }
        if (pos_ < s_.size() && s_[pos_] == '.') {
            isInteger = false;
            ++pos_;
            while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') {
                ++pos_;
                anyDigit = true;
            }
        }
        if (pos_ < s_.size() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
            isInteger = false;
            ++pos_;
            if (pos_ < s_.size() && (s_[pos_] == '-' || s_[pos_] == '+')) ++pos_;
            while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
        }
        if (!anyDigit) return fail("expected value");
        const std::string token = s_.substr(start, pos_ - start);
        out.setNumber(std::strtod(token.c_str(), nullptr), isInteger);
        return true;
    }
};

}  // namespace

std::shared_ptr<JsonValue> JsonValue::parse(const std::string& text, std::string* error) {
    auto value = std::make_shared<JsonValue>();
    Parser parser(text, error);
    if (!parser.parse(*value)) return nullptr;
    return value;
}

std::shared_ptr<JsonValue> jsonParseFile(const std::string& path, std::string* error) {
    std::ifstream in(path, std::ios::binary);
    if (!in.good()) {
        if (error != nullptr) *error = "cannot open " + path;
        return nullptr;
    }
    std::ostringstream buf;
    buf << in.rdbuf();
    return JsonValue::parse(buf.str(), error);
}

}  // namespace v4k
