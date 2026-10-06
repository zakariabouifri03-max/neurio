// NovaForge Engine - headless ("offscreen") platform backend.
//
// Purpose
//  * automated tests and CI: the whole engine runs without a display
//  * documentation: renders real frames to PNG (docs/media) and can record
//    real gameplay to an AVI video for the sample game
//  * deterministic input injection for gameplay regression tests
#include "platform/platform.h"
#include "core/log.h"
#include "core/fs.h"
#include "core/image.h"

#include <cstdlib>
#include <cstring>
#include <fstream>

namespace nf {

namespace {
class OffscreenWindow : public Window {
public:
    OffscreenWindow(const WindowDesc& d) {
        title_ = d.title;
        width_ = d.width;
        height_ = d.height;
        headless_ = true;
        lastFrame_.assign((size_t)width_ * height_ * 4, 0);
        lastW_ = width_;
        lastH_ = height_;
        // NFF_SCRIPT env var: file with scripted input for tests, format:
        //   frame:key:down|up     frame:mouse:x:y     frame:click:0|1
        const char* script = getenv("NFF_INPUT_SCRIPT");
        if (script) loadScript(script);
        if (const char* fl = getenv("NFF_FRAME_LIMIT")) frameLimit_ = atoi(fl);
        if (const char* cd = getenv("NFF_CAPTURE_DIR")) {
            captureDir_ = cd;
            fs::createDirectories(captureDir_);
        }
        NF_LOG_INFO("Platform", "headless window %dx%d ('%s')", width_, height_, title_.c_str());
    }

    void pollOSEvents() override {
        // feed scripted input for the current frame
        for (auto& cmd : scripted_) {
            if (cmd.frame == frame_ && !cmd.done) {
                cmd.done = true;
                if (cmd.kind == 0) injectKey((Key)cmd.a, cmd.b != 0, cmd.mods);
                else if (cmd.kind == 1) injectMouseMove(cmd.fx, cmd.fy);
                else if (cmd.kind == 2) injectMouseButton((MouseButton)cmd.a, cmd.b != 0);
                else if (cmd.kind == 3) injectChar((unsigned)cmd.a);
            }
        }
        if (frameLimit_ > 0 && frame_ >= frameLimit_) wantsClose_ = true;
        frame_++;
    }

    void present(const uint8_t* rgba, int w, int h) override {
        lastW_ = w;
        lastH_ = h;
        lastFrame_.assign(rgba, rgba + (size_t)w * h * 4);
        // Dump frames to disk when requested (NFF_CAPTURE_DIR): used to make
        // the documentation screenshots and the sample game video.
        if (!captureDir_.empty()) {
            char name[1024];
            snprintf(name, sizeof(name), "%s/frame_%05d.png", captureDir_.c_str(), captureIndex_++);
            nf::writePng(name, rgba, w, h);
        }
    }

    void* nativeHandle() const override { return nullptr; }

    void setFrameLimit(int n) { frameLimit_ = n; }
    int frame() const { return frame_; }
    void setCaptureDir(const std::string& d) { captureDir_ = d; }

private:
    struct ScriptCmd {
        int frame = 0, kind = 0, a = 0, b = 0, mods = 0;
        float fx = 0, fy = 0;
        bool done = false;
    };
    void loadScript(const std::string& path) {
        std::string text = fs::readText(path);
        for (auto& line : splitLines(text)) {
            auto parts = split(line, ':');
            if (parts.size() < 2) continue;
            ScriptCmd c;
            c.frame = atoi(parts[0].c_str());
            if (parts[1] == "key" && parts.size() >= 4) {
                c.kind = 0;
                c.a = (int)keyFromName(parts[2]);
                c.b = parts[3] == "down" ? 1 : 0;
                c.mods = parts.size() > 4 ? atoi(parts[4].c_str()) : 0;
            } else if (parts[1] == "mouse" && parts.size() >= 4) {
                c.kind = 1;
                c.fx = (float)atof(parts[2].c_str());
                c.fy = (float)atof(parts[3].c_str());
            } else if (parts[1] == "click" && parts.size() >= 3) {
                c.kind = 2;
                c.a = parts.size() > 3 ? atoi(parts[3].c_str()) : 0;
                c.b = parts[2] == "down" ? 1 : 0;
            } else if (parts[1] == "char" && parts.size() >= 3) {
                c.kind = 3;
                c.a = atoi(parts[2].c_str());
            }
            scripted_.push_back(c);
        }
        NF_LOG_INFO("Platform", "loaded input script: %zu commands", scripted_.size());
    }
    static std::vector<std::string> splitLines(const std::string& s) {
        std::vector<std::string> out;
        std::string cur;
        for (char c : s) {
            if (c == '\n') { out.push_back(cur); cur.clear(); }
            else if (c != '\r') cur.push_back(c);
        }
        if (!cur.empty()) out.push_back(cur);
        return out;
    }
    static std::vector<std::string> split(const std::string& s, char d) {
        std::vector<std::string> out;
        std::string cur;
        for (char c : s) {
            if (c == d) { out.push_back(cur); cur.clear(); }
            else cur.push_back(c);
        }
        out.push_back(cur);
        return out;
    }
    static Key keyFromName(const std::string& n) {
        for (int i = 0; i < (int)Key::Count; ++i)
            if (n == keyName((Key)i)) return (Key)i;
        if (n.size() == 1) {
            char c = (char)toupper(n[0]);
            if (c >= 'A' && c <= 'Z') return (Key)((int)Key::A + (c - 'A'));
            if (c >= '0' && c <= '9') return (Key)((int)Key::Num0 + (c - '0'));
        }
        return Key::None;
    }

    std::vector<ScriptCmd> scripted_;
    int frame_ = 0;
    int frameLimit_ = 0;
    int captureIndex_ = 0;
    std::string captureDir_;
};
}  // namespace

Window* createOffscreenWindow(const WindowDesc& d) { return new OffscreenWindow(d); }

// ------------------------------------------------------------- OS services
// In headless mode these degrade to no-ops with a log entry, so that the same
// code paths run in tests. On Windows the real Win32 dialogs live in
// platform_win32.cpp and take over, so they are excluded here.
#if !defined(NF_PLATFORM_WINDOWS)
std::string openFileDialog(const std::string& title,
                           const std::vector<std::pair<std::string, std::string>>& filters,
                           const std::string& defaultDir) {
    NF_LOG_WARN("Platform", "openFileDialog('%s') has no UI in headless mode", title.c_str());
    return "";
}

std::string saveFileDialog(const std::string& title, const std::string& defaultName,
                           const std::vector<std::pair<std::string, std::string>>& filters) {
    NF_LOG_WARN("Platform", "saveFileDialog('%s') has no UI in headless mode", title.c_str());
    return "";
}

void showMessageBox(const std::string& title, const std::string& message, bool error) {
    NF_LOG_INFO("Platform", "[message box] %s: %s", title.c_str(), message.c_str());
}
#endif  // !NF_PLATFORM_WINDOWS

}  // namespace nf
