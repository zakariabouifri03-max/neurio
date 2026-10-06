#include <cmath>

#include "core/v4k_json.h"
#include "v4k_test.h"

using namespace v4k;

V4K_TEST(json_writer_basics) {
    JsonWriter w;
    w.beginObject();
    w.field("name", "AI Vision 4K");
    w.field("version", 1);
    w.field("ratio", 0.67);
    w.field("enabled", true);
    w.key("list");
    w.beginArray();
    w.value(1);
    w.value(2);
    w.value(3);
    w.endArray();
    w.key("empty");
    w.beginObject();
    w.endObject();
    w.endObject();

    CHECK_EQ_STR(w.str(),
                 "{\"name\":\"AI Vision 4K\",\"version\":1,\"ratio\":0.67,\"enabled\":true,"
                 "\"list\":[1,2,3],\"empty\":{}}");
}

V4K_TEST(json_writer_escapes_and_nan) {
    JsonWriter w;
    w.beginObject();
    w.field("quote", "a\"b\\c\nd\te");
    w.field("nan", std::nan(""));
    w.field("inf", std::numeric_limits<double>::infinity());
    w.endObject();
    // NaN/Infinity must never leak into JSON: they become null.
    CHECK_EQ_STR(w.str(), "{\"quote\":\"a\\\"b\\\\c\\nd\\te\",\"nan\":null,\"inf\":null}");
}

V4K_TEST(json_writer_indented) {
    JsonWriter w(2);
    w.beginObject();
    w.field("a", 1);
    w.endObject();
    CHECK_EQ_STR(w.str(), "{\n  \"a\": 1\n}");
}

V4K_TEST(json_parse_roundtrip) {
    const std::string text =
        "{\"ok\":true,\"count\":42,\"fraction\":1.5,\"name\":\"x\",\"nested\":{\"a\":[1,2,3]},"
        "\"nothing\":null}";
    std::string error;
    auto root = JsonValue::parse(text, &error);
    CHECK(root != nullptr);
    if (root == nullptr) {
        V4K_FAIL("parse error: " + error);
        return;
    }
    CHECK(root->isObject());
    CHECK_EQ_INT((*root)["count"].asInt(), 42);
    CHECK_NEAR((*root)["fraction"].asDouble(), 1.5, 1e-9);
    CHECK_EQ_STR((*root)["name"].asString(), "x");
    CHECK((*root)["nested"]["a"].size() == 3);
    CHECK_EQ_INT((*root)["nested"]["a"].at(2).asInt(), 3);
    CHECK((*root)["missing"].isNull());
    CHECK((*root)["nothing"].isNull());
    CHECK((*root)["ok"].asBool());

    JsonWriter w;
    root->writeTo(w);
    std::string error2;
    auto again = JsonValue::parse(w.str(), &error2);
    CHECK(again != nullptr);
    if (again != nullptr) {
        CHECK_EQ_INT((*again)["count"].asInt(), 42);
        CHECK((*again)["nested"]["a"].size() == 3);
    }
}

V4K_TEST(json_parse_string_escapes) {
    std::string error;
    auto root = JsonValue::parse("{\"s\":\"tab\\there \\u00e9 \\ud83d\\ude00 slash\\/\"}", &error);
    CHECK(root != nullptr);
    if (root != nullptr) {
        const std::string s = (*root)["s"].asString();
        CHECK(s.find("tab\there") == 0);
        CHECK(s.find("\xc3\xa9") != std::string::npos);           // é
        CHECK(s.find("\xf0\x9f\x98\x80") != std::string::npos);   // 😀
        CHECK(s.find("slash/") != std::string::npos);
    }
}

V4K_TEST(json_parse_rejects_garbage) {
    std::string error;
    CHECK(JsonValue::parse("{", &error) == nullptr);
    CHECK(!error.empty());
    error.clear();
    CHECK(JsonValue::parse("{\"a\":1}trailing", &error) == nullptr);
    error.clear();
    CHECK(JsonValue::parse("[1,2,", &error) == nullptr);
    error.clear();
    CHECK(JsonValue::parse("{\"a\" 1}", &error) == nullptr);
    error.clear();
    CHECK(JsonValue::parse("", &error) == nullptr);
    error.clear();
    // A bare word is not a value.
    CHECK(JsonValue::parse("nul", &error) == nullptr);
}

V4K_TEST(json_parse_integer_vs_float) {
    std::string error;
    auto root = JsonValue::parse("{\"i\":9007199254740993,\"f\":1.25e2}", &error);
    CHECK(root != nullptr);
    if (root != nullptr) {
        // 2^53+1 is not exactly representable as double, but must round-trip
        // through the integer path without becoming garbage.
        CHECK((*root)["i"].asInt(0) > 0);
        CHECK_NEAR((*root)["f"].asDouble(), 125.0, 1e-9);
    }
}

V4K_TEST(json_writer_raw_embeds_a_serialised_document) {
    JsonWriter inner(0);
    inner.beginObject();
    inner.field("mode", "NEURAL");
    inner.field("layers", 12);
    inner.endObject();

    JsonWriter outer(0);
    outer.beginObject();
    outer.field("name", "status");
    outer.key("session");
    outer.raw(inner.str());
    outer.key("items");
    outer.beginArray();
    outer.raw("{\"a\":1}");
    outer.value(2);
    outer.endArray();
    outer.endObject();

    // The embedded document must round-trip through the parser as an object,
    // not as a quoted string.
    const std::string text = outer.str();
    CHECK_STR_CONTAINS(text, "\"session\":{");
    CHECK_STR_CONTAINS(text, "\"mode\":\"NEURAL\"");
    std::string error;
    const std::shared_ptr<JsonValue> parsed = JsonValue::parse(text, &error);
    CHECK(parsed != nullptr);
    CHECK(parsed->has("session"));
    CHECK_EQ_INT((*parsed)["session"]["layers"].asInt(), 12);
    CHECK_EQ_STR((*parsed)["session"]["mode"].asString(), "NEURAL");
    // size() counts array elements only; object members are counted through
    // members(). The embedded array must have kept its two entries.
    CHECK_EQ_INT(parsed->members().size(), 3);   // name, session, items
    CHECK_EQ_INT((*parsed)["items"].size(), 2);
    CHECK_EQ_INT((*parsed)["items"].at(0)["a"].asInt(), 1);
    CHECK_EQ_INT((*parsed)["items"].at(1).asInt(), 2);
}
