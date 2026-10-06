#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "ai/v4k_model.h"
#include "core/v4k_sha256.h"
#include "v4k_test.h"

using namespace v4k;

V4K_TEST(sha256_nist_vectors) {
    // FIPS 180-4 / NIST example digests.
    CHECK_EQ_STR(sha256Hex("", 0),
                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK_EQ_STR(sha256Hex("abc", 3),
                 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const char* fox = "The quick brown fox jumps over the lazy dog";
    CHECK_EQ_STR(sha256Hex(fox, 43),
                 "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");
    const char* twoBlocks =
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    CHECK_EQ_STR(sha256Hex(twoBlocks, 56),
                 "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
}

V4K_TEST(sha256_chunked_updates_match) {
    // Feeding the data in pieces must equal feeding it at once, including
    // across the 64 byte block boundary.
    std::string data;
    for (int i = 0; i < 1000; ++i) data += static_cast<char>('a' + (i % 26));
    const std::string whole = sha256Hex(data.data(), data.size());

    Sha256 ctx;
    size_t offset = 0;
    const size_t chunks[] = {1, 63, 64, 65, 127, 128, 512};
    int i = 0;
    while (offset < data.size()) {
        const size_t n = std::min(chunks[i++ % 7], data.size() - offset);
        ctx.update(data.data() + offset, n);
        offset += n;
    }
    uint8_t digest[32];
    ctx.finalize(digest);
    static const char* hex = "0123456789abcdef";
    std::string hexed;
    for (uint8_t b : digest) {
        hexed += hex[b >> 4];
        hexed += hex[b & 0x0F];
    }
    CHECK_EQ_STR(hexed, whole);
}

V4K_TEST(sha256_file_matches_buffer) {
    const std::string path = "/tmp/v4k_sha256_test.bin";
    std::vector<uint8_t> payload(200000);
    for (size_t i = 0; i < payload.size(); ++i) payload[i] = static_cast<uint8_t>(i * 7 + 13);
    std::FILE* f = std::fopen(path.c_str(), "wb");
    CHECK(f != nullptr);
    if (f == nullptr) return;
    std::fwrite(payload.data(), 1, payload.size(), f);
    std::fclose(f);

    std::string fromFile;
    CHECK(sha256File(path, fromFile));
    CHECK_EQ_STR(fromFile, sha256Hex(payload.data(), payload.size()));

    std::remove(path.c_str());
    std::string missing;
    CHECK(!sha256File(path, missing));
}

V4K_TEST(half_float_conversions) {
    CHECK_EQ_INT(floatToHalf(1.0f), 0x3C00);
    CHECK_EQ_INT(floatToHalf(-2.0f), 0xC000);
    CHECK_EQ_INT(floatToHalf(0.5f), 0x3800);
    CHECK_EQ_INT(floatToHalf(0.0f), 0x0000);
    CHECK_EQ_INT(floatToHalf(65504.0f), 0x7BFF);   // largest finite half
    CHECK_EQ_INT(floatToHalf(0.333251953125f), 0x3555);

    CHECK_NEAR(halfToFloat(0x3C00), 1.0, 1e-9);
    CHECK_NEAR(halfToFloat(0x7BFF), 65504.0, 1e-3);
    CHECK_NEAR(halfToFloat(0x3555), 0.333251953125, 1e-9);
    CHECK_NEAR(halfToFloat(0x0001), 5.960464477539063e-08, 1e-15);
    // Negative zero stays negative zero.
    const float negZero = halfToFloat(0x8000);
    CHECK(negZero == 0.0f);
    CHECK(std::signbit(negZero));

    // Round trip of arbitrary values stays within half precision.
    const float probe[] = {0.1f, 0.2f, 0.75f, 3.14159f, -0.001f, 1024.0f};
    for (float v : probe) {
        const float back = halfToFloat(floatToHalf(v));
        const float tolerance = std::fabs(v) * 0.001f + 1e-7f;
        CHECK_NEAR(back, v, tolerance);
    }
    // Overflow saturates to infinity rather than wrapping.
    CHECK(std::isinf(halfToFloat(floatToHalf(100000.0f))));
}
