#include "core/json.h"
#include "core/fs.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace nf {

Json& Json::operator[](const std::string& key) {
    if (type_ != Type::Object) {
        type_ = Type::Object;
        obj_.clear();
    }
    for (auto& kv : obj_)
        if (kv.first == key) return kv.second;
    obj_.emplace_back(key, Json());
    return obj_.back().second;
}

const Json& Json::operator[](const std::string& key) const {
    const Json* v = find(key);
    static const Json null;
    return v ? *v : null;
}

const Json* Json::find(const std::string& key) const {
    if (type_ != Type::Object) return nullptr;
    for (auto& kv : obj_)
        if (kv.first == key) return &kv.second;
    return nullptr;
}
Json* Json::find(const std::string& key) {
    if (type_ != Type::Object) return nullptr;
    for (auto& kv : obj_)
        if (kv.first == key) return &kv.second;
    return nullptr;
}

void Json::erase(const std::string& key) {
    for (size_t i = 0; i < obj_.size(); ++i) {
        if (obj_[i].first == key) {
            obj_.erase(obj_.begin() + (long)i);
            return;
        }
    }
}

// ---------------------------------------------------------------- writer
static void escapeString(const std::string& s, std::string& out) {
    out.push_back('"');
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out.push_back((char)c);
                }
        }
    }
    out.push_back('"');
}

static void writeNumber(double v, std::string& out) {
    if (!std::isfinite(v)) { out += "0"; return; }
    double r = std::floor(v);
    if (r == v && std::fabs(v) < 1e15) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%lld", (long long)v);
        out += buf;
    } else {
        char buf[40];
        snprintf(buf, sizeof(buf), "%.6g", v);
        out += buf;
    }
}

void Json::dumpTo(std::string& out, int indent, int depth) const {
    auto pad = [&](int d) {
        if (indent <= 0) return;
        out.push_back('\n');
        for (int i = 0; i < d * indent; ++i) out.push_back(' ');
    };
    switch (type_) {
        case Type::Null: out += "null"; break;
        case Type::Bool: out += bool_ ? "true" : "false"; break;
        case Type::Number: writeNumber(num_, out); break;
        case Type::String: escapeString(str_, out); break;
        case Type::Array: {
            if (arr_.empty()) { out += "[]"; break; }
            out.push_back('[');
            for (size_t i = 0; i < arr_.size(); ++i) {
                if (i) out.push_back(',');
                pad(depth + 1);
                arr_[i].dumpTo(out, indent, depth + 1);
            }
            pad(depth);
            out.push_back(']');
            break;
        }
        case Type::Object: {
            if (obj_.empty()) { out += "{}"; break; }
            out.push_back('{');
            for (size_t i = 0; i < obj_.size(); ++i) {
                if (i) out.push_back(',');
                pad(depth + 1);
                escapeString(obj_[i].first, out);
                out.push_back(':');
                if (indent > 0) out.push_back(' ');
                obj_[i].second.dumpTo(out, indent, depth + 1);
            }
            pad(depth);
            out.push_back('}');
            break;
        }
    }
}

std::string Json::dump(int indent) const {
    std::string out;
    out.reserve(4096);
    dumpTo(out, indent, 0);
    return out;
}

bool Json::saveFile(const std::string& path, int indent) const {
    return fs::writeText(path, dump(indent));
}

// ---------------------------------------------------------------- parser
namespace {
struct Parser {
    const char* p;
    const char* end;
    std::string* err;
    int depth = 0;

    void fail(const std::string& msg) {
        if (err && err->empty()) {
            size_t off = (size_t)(p - begin_);
            char buf[256];
            snprintf(buf, sizeof(buf), "JSON parse error at byte %zu: %s", off, msg.c_str());
            *err = buf;
        }
    }
    const char* begin_ = nullptr;

    void skipWs() {
        while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
    }
    bool consume(char c) {
        skipWs();
        if (p < end && *p == c) { ++p; return true; }
        return false;
    }

    Json parseValue() {
        if (++depth > 200) { fail("nesting too deep"); return Json(); }
        skipWs();
        if (p >= end) { fail("unexpected end of input"); return Json(); }
        char c = *p;
        Json v;
        if (c == '{') v = parseObject();
        else if (c == '[') v = parseArray();
        else if (c == '"') v = Json(parseString());
        else if (c == 't') { if (match("true")) v = Json(true); else fail("bad literal"); }
        else if (c == 'f') { if (match("false")) v = Json(false); else fail("bad literal"); }
        else if (c == 'n') { if (match("null")) v = Json(); else fail("bad literal"); }
        else if (c == '-' || (c >= '0' && c <= '9')) v = Json(parseNumber());
        else fail(std::string("unexpected character '") + c + "'");
        --depth;
        return v;
    }

    bool match(const char* s) {
        size_t n = strlen(s);
        if ((size_t)(end - p) < n || strncmp(p, s, n) != 0) return false;
        p += n;
        return true;
    }

    double parseNumber() {
        const char* s = p;
        char* endp = nullptr;
        double d = strtod(s, &endp);
        if (endp == s) fail("invalid number");
        p = endp;
        return d;
    }

    std::string parseString() {
        std::string out;
        if (p >= end || *p != '"') { fail("expected string"); return out; }
        ++p;
        while (p < end) {
            char c = *p++;
            if (c == '"') return out;
            if (c == '\\') {
                if (p >= end) break;
                char e = *p++;
                switch (e) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'n': out.push_back('\n'); break;
                    case 't': out.push_back('\t'); break;
                    case 'r': out.push_back('\r'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'u': {
                        unsigned cp = 0;
                        for (int i = 0; i < 4 && p < end; ++i) {
                            char h = *p++;
                            cp <<= 4;
                            if (h >= '0' && h <= '9') cp |= (unsigned)(h - '0');
                            else if (h >= 'a' && h <= 'f') cp |= (unsigned)(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') cp |= (unsigned)(h - 'A' + 10);
                        }
                        // surrogate pair
                        if (cp >= 0xD800 && cp <= 0xDBFF && (end - p) > 6 &&
                            p[0] == '\\' && p[1] == 'u') {
                            p += 2;
                            unsigned lo = 0;
                            for (int i = 0; i < 4 && p < end; ++i) {
                                char h = *p++;
                                lo <<= 4;
                                if (h >= '0' && h <= '9') lo |= (unsigned)(h - '0');
                                else if (h >= 'a' && h <= 'f') lo |= (unsigned)(h - 'a' + 10);
                                else if (h >= 'A' && h <= 'F') lo |= (unsigned)(h - 'A' + 10);
                            }
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        }
                        // utf8 encode
                        if (cp < 0x80) out.push_back((char)cp);
                        else if (cp < 0x800) {
                            out.push_back((char)(0xC0 | (cp >> 6)));
                            out.push_back((char)(0x80 | (cp & 0x3F)));
                        } else if (cp < 0x10000) {
                            out.push_back((char)(0xE0 | (cp >> 12)));
                            out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
                            out.push_back((char)(0x80 | (cp & 0x3F)));
                        } else {
                            out.push_back((char)(0xF0 | (cp >> 18)));
                            out.push_back((char)(0x80 | ((cp >> 12) & 0x3F)));
                            out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
                            out.push_back((char)(0x80 | (cp & 0x3F)));
                        }
                        break;
                    }
                    default: out.push_back(e);
                }
            } else {
                out.push_back(c);
            }
        }
        fail("unterminated string");
        return out;
    }

    Json parseArray() {
        Json a = Json::array();
        ++p;  // [
        skipWs();
        if (p < end && *p == ']') { ++p; return a; }
        while (p < end) {
            a.push(parseValue());
            skipWs();
            if (p < end && *p == ',') { ++p; continue; }
            if (p < end && *p == ']') { ++p; break; }
            fail("expected ',' or ']' in array");
            break;
        }
        return a;
    }

    Json parseObject() {
        Json o = Json::object();
        ++p;  // {
        skipWs();
        if (p < end && *p == '}') { ++p; return o; }
        while (p < end) {
            skipWs();
            std::string key = parseString();
            if (!consume(':')) { fail("expected ':'"); break; }
            o[key] = parseValue();
            skipWs();
            if (p < end && *p == ',') { ++p; continue; }
            if (p < end && *p == '}') { ++p; break; }
            fail("expected ',' or '}' in object");
            break;
        }
        return o;
    }
};
}  // namespace

Json Json::parse(const std::string& text, std::string* error) {
    Parser ps;
    ps.p = text.c_str();
    ps.end = text.c_str() + text.size();
    ps.err = error;
    ps.begin_ = text.c_str();
    if (error) error->clear();
    // strip UTF-8 BOM
    if (text.size() >= 3 && (unsigned char)text[0] == 0xEF) ps.p += 3;
    Json v = ps.parseValue();
    ps.skipWs();
    if (ps.p != ps.end && error && error->empty()) *error = "trailing data after JSON value";
    return v;
}

bool Json::parseFile(const std::string& path, Json& out, std::string* error) {
    std::string text = fs::readText(path);
    if (text.empty()) {
        if (error) *error = "file is empty or missing: " + path;
        return false;
    }
    std::string err;
    out = Json::parse(text, &err);
    if (!err.empty()) {
        if (error) *error = path + ": " + err;
        return false;
    }
    return true;
}

}  // namespace nf
