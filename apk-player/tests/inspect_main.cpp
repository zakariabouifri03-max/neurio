// Linux/Windows CLI used by the tests: prints the inspection result of each APK as JSON.
#include <cstdio>
#include <string>
#include <vector>

#include "../src/apk.h"

int main(int argc, char** argv) {
    int rc = 0;
    for (int i = 1; i < argc; i++) {
        apk::Archive a;
        if (!a.openFile(argv[i])) {
            printf("{\"file\":\"%s\",\"error\":\"%s\"}\n", argv[i], apk::jsonEscape(a.lastError()).c_str());
            rc = 1;
            continue;
        }
        std::string inner = apk::findInnerApk(a);
        std::string innerBuf;
        apk::Archive b;
        const apk::Archive* use = &a;
        if (!inner.empty()) {
            const apk::Entry* e = a.find(inner);
            if (e && a.read(*e, innerBuf, 1ull << 31) && b.openMemory(innerBuf.data(), innerBuf.size())) use = &b;
        }
        apk::Info info;
        std::string err;
        if (!apk::inspect(*use, info, &err)) {
            printf("{\"file\":\"%s\",\"error\":\"%s\"}\n", argv[i], apk::jsonEscape(err).c_str());
            rc = 1;
            continue;
        }
        printf("%s\n", apk::toJson(info).c_str());
    }
    return rc;
}
