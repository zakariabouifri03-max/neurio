#include "v4k_engine.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <memory>
#include <sstream>

#include "../ai/v4k_model_catalog.h"
#include "../core/v4k_json.h"
#include "../core/v4k_log.h"
#include "../vulkan/v4k_vk.h"

#if defined(V4K_ENABLE_VULKAN)
#include "../vulkan/v4k_vk_pipeline.h"
#endif

namespace v4k {
namespace {

int64_t steadyNowMs() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
}

double clamp01(double value) {
    if (value < 0.0) return 0.0;
    if (value > 1.0) return 1.0;
    return value;
}

// A JSON number field, or `fallback` when the key is missing/null.
double numberOr(const JsonValue& object, const char* key, double fallback) {
    const JsonValue& value = object[key];
    if (!value.isNumber()) return fallback;
    return value.asDouble(fallback);
}

bool boolOr(const JsonValue& object, const char* key, bool fallback) {
    const JsonValue& value = object[key];
    if (!value.isBool()) return fallback;
    return value.asBool(fallback);
}

std::string stringOr(const JsonValue& object, const char* key, const std::string& fallback) {
    const JsonValue& value = object[key];
    if (!value.isString()) return fallback;
    return value.asString(fallback);
}

bool readWholeFile(const char* path, std::string& out) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    std::ostringstream buffer;
    buffer << file.rdbuf();
    out = buffer.str();
    return true;
}

// Reads /proc/stat and /proc/meminfo. Both are readable by a normal app, and
// both report real numbers — when a read fails the field stays kUnavailable.
void sampleProcFiles(CpuLoadSampler& cpu, RamSample& ram, double& cpuLoad,
                     double& ramUsedFraction) {
    std::string text;
    if (readWholeFile("/proc/stat", text)) {
        uint64_t total = 0;
        uint64_t idle = 0;
        if (parseProcStat(text, total, idle)) cpuLoad = cpu.update(total, idle);
    }
    if (readWholeFile("/proc/meminfo", text)) {
        RamSample sample;
        if (parseMemInfo(text, sample)) {
            ram = sample;
            ramUsedFraction = sample.usedFraction();
        }
    }
}

}  // namespace

#if defined(V4K_ENABLE_VULKAN)
// The Vulkan session state. Defined here (not in the header) so the engine
// header stays free of Vulkan types and the no-Vulkan build still compiles.
struct Engine::VkState {
    vk::Context context;
    vk::UpscalePipelineVk pipeline;
    vk::Image lowRes{};    // wrappers around the caller's handles
    vk::Image output{};
    vk::Image motion{};
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VkFence fence = VK_NULL_HANDLE;
    double recordMs = kUnavailable;
    uint64_t frameIndex = 0;
};
#endif  // V4K_ENABLE_VULKAN

// ---------------------------------------------------------------------------
// Small value types
// ---------------------------------------------------------------------------
double StageMs::totalMs() const {
    if (!available) return kUnavailable;
    double sum = 0.0;
    const double values[6] = {preprocessMs, neuralMs, denoiseMs, temporalMs, aaMs, sharpenMs};
    bool any = false;
    for (double value : values) {
        if (value != kUnavailable) {
            sum += value;
            any = true;
        }
    }
    return any ? sum : kUnavailable;
}

std::string StageMs::toJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("available", available);
    w.field("countersAvailable", countersAvailable);
    if (preprocessMs == kUnavailable) w.fieldNull("preprocessMs");
    else w.field("preprocessMs", preprocessMs);
    if (neuralMs == kUnavailable) w.fieldNull("neuralMs");
    else w.field("neuralMs", neuralMs);
    if (denoiseMs == kUnavailable) w.fieldNull("denoiseMs");
    else w.field("denoiseMs", denoiseMs);
    if (temporalMs == kUnavailable) w.fieldNull("temporalMs");
    else w.field("temporalMs", temporalMs);
    if (aaMs == kUnavailable) w.fieldNull("aaMs");
    else w.field("aaMs", aaMs);
    if (sharpenMs == kUnavailable) w.fieldNull("sharpenMs");
    else w.field("sharpenMs", sharpenMs);
    const double total = totalMs();
    if (total == kUnavailable) w.fieldNull("totalMs");
    else w.field("totalMs", total);
    w.endObject();
    return w.str();
}

std::string SessionStats::toJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("active", active);
    w.field("inputWidth", inputWidth);
    w.field("inputHeight", inputHeight);
    w.field("outputWidth", outputWidth);
    w.field("outputHeight", outputHeight);
    w.field("neural", neural);
    w.field("temporal", temporal);
    w.field("layerCount", layerCount);
    w.field("workingSetBytes", workingSetBytes);
    w.field("weightBytes", weightBytes);
    w.field("mode", toString(mode));
    w.field("modelId", modelId);
    w.field("lastError", lastError);
    w.endObject();
    return w.str();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
Engine::Engine() {
    profile_ = makePresetProfile(QualityPreset::Balanced, Resolution{1920, 1080});
    decision_.level = ThermalLevel::Nominal;
#if defined(V4K_ENABLE_VULKAN)
    vk_ = new VkState();
#endif
}

Engine::~Engine() {
    shutdown();
#if defined(V4K_ENABLE_VULKAN)
    delete vk_;
    vk_ = nullptr;
#endif
}

bool Engine::initialise(const std::string& androidCapsJson, std::string* error) {
    if (initialised_) {
        if (error != nullptr) *error = "the engine is already initialised";
        return false;
    }

    std::string capsError;
    if (!updateAndroidCaps(androidCapsJson, &capsError)) {
        if (error != nullptr) *error = capsError;
        return false;
    }

    // Vulkan is probed natively: creating a short-lived instance is allowed for
    // any app, and it is the only way to know the real driver limits. A failure
    // is not fatal — the compatibility engine reports it.
    std::string probeError;
    const DeviceCapabilities probed = probeDeviceWithVulkan(&probeError);
    if (probed.vulkan.available) {
        caps_.vulkan = probed.vulkan;
    } else {
        caps_.vulkan = probed.vulkan;
        if (!probeError.empty()) V4K_LOGW("vulkan probe: %s", probeError.c_str());
    }

    tier_ = classifyDeviceTier(caps_);
    // Default profile: the best output this device is recommended to hold at the
    // balanced preset. The preset is then validated against the real caps.
    profile_ = makePresetProfile(QualityPreset::Balanced,
                                 recommendedOutputResolution(caps_, tier_));
    ValidationResult validation = validateProfile(profile_, &caps_);
    if (validation.modified) {
        V4K_LOGI("profile clamped on first run (%zu field(s) adjusted)",
                 validation.messages.size());
    }
    refreshMonitoring();
    evaluateNow();
    initialised_ = true;
    if (error != nullptr) error->clear();
    V4K_LOGI("engine initialised: tier=%s device=%s", toString(tier_),
             caps_.vulkan.deviceName.empty() ? caps_.android.socModel.c_str()
                                             : caps_.vulkan.deviceName.c_str());
    return true;
}

void Engine::shutdown() {
    stopSession();
    modelInstalled_ = false;
    model_ = Model{};
    initialised_ = false;
}

bool Engine::updateAndroidCaps(const std::string& json, std::string* error) {
    if (json.empty()) {
        if (error != nullptr) error->clear();
        return true;
    }
    std::string parseError;
    const std::shared_ptr<JsonValue> root = JsonValue::parse(json, &parseError);
    if (root == nullptr) {
        if (error != nullptr) *error = "device capability JSON is malformed: " + parseError;
        return false;
    }

    const JsonValue& android = (*root)["android"];
    AndroidCaps& a = caps_.android;
    a.sdkInt = static_cast<int>(numberOr(android, "sdkInt", a.sdkInt));
    a.release = stringOr(android, "release", a.release);
    a.socModel = stringOr(android, "socModel", a.socModel);
    a.socManufacturer = stringOr(android, "socManufacturer", a.socManufacturer);
    a.hardware = stringOr(android, "hardware", a.hardware);
    a.board = stringOr(android, "board", a.board);
    a.cpuCoreCount = static_cast<int>(numberOr(android, "cpuCoreCount", a.cpuCoreCount));
    a.cpuArch = static_cast<uint32_t>(numberOr(android, "cpuArch", a.cpuArch));
    a.supportsArm64 = boolOr(android, "supportsArm64", a.supportsArm64);
    a.isEmulator = boolOr(android, "isEmulator", a.isEmulator);
    a.hdrDisplay = boolOr(android, "hdrDisplay", a.hdrDisplay);
    a.displayRefreshRate = static_cast<float>(numberOr(android, "displayRefreshRate",
                                                       a.displayRefreshRate));
    a.displayWidth = static_cast<uint32_t>(numberOr(android, "displayWidth", a.displayWidth));
    a.displayHeight = static_cast<uint32_t>(numberOr(android, "displayHeight", a.displayHeight));
    a.displayDensityDpi = static_cast<uint32_t>(numberOr(android, "displayDensityDpi",
                                                         a.displayDensityDpi));

    const JsonValue& memory = (*root)["memory"];
    caps_.memory.totalRamBytes = static_cast<uint64_t>(numberOr(memory, "totalRamBytes",
                                                               static_cast<double>(caps_.memory.totalRamBytes)));
    caps_.memory.availableRamBytes = static_cast<uint64_t>(
        numberOr(memory, "availableRamBytes", static_cast<double>(caps_.memory.availableRamBytes)));
    caps_.memory.memoryClassMb = static_cast<uint32_t>(numberOr(memory, "memoryClassMb",
                                                                caps_.memory.memoryClassMb));
    caps_.memory.largeMemoryClassMb = static_cast<uint32_t>(
        numberOr(memory, "largeMemoryClassMb", caps_.memory.largeMemoryClassMb));
    caps_.memory.lowRamDevice = boolOr(memory, "lowRamDevice", caps_.memory.lowRamDevice);

    const JsonValue& neural = (*root)["neural"];
    NeuralCaps& n = caps_.neural;
    n.nnapiAvailable = boolOr(neural, "nnapiAvailable", n.nnapiAvailable);
    n.nnapiFeatureLevel = static_cast<int32_t>(numberOr(neural, "nnapiFeatureLevel",
                                                        n.nnapiFeatureLevel));
    n.supportsFloat16 = boolOr(neural, "supportsFloat16", n.supportsFloat16);
    n.supportsQuant8 = boolOr(neural, "supportsQuant8", n.supportsQuant8);
    n.supportsQuant8Signed = boolOr(neural, "supportsQuant8Signed", n.supportsQuant8Signed);
    n.hasAccelerator = boolOr(neural, "hasAccelerator", n.hasAccelerator);
    n.note = stringOr(neural, "note", n.note);
    n.acceleratorNames.clear();
    const JsonValue& accelerators = neural["acceleratorNames"];
    if (accelerators.isArray()) {
        for (size_t i = 0; i < accelerators.size(); ++i) {
            n.acceleratorNames.push_back(accelerators.at(i).asString());
        }
    }

    const JsonValue& thermal = (*root)["thermal"];
    ThermalCaps& t = caps_.thermal;
    t.powerManagerThermalApi = boolOr(thermal, "powerManagerThermalApi", t.powerManagerThermalApi);
    t.hardwarePropertiesApi = boolOr(thermal, "hardwarePropertiesApi", t.hardwarePropertiesApi);
    t.batteryTemperature = boolOr(thermal, "batteryTemperature", t.batteryTemperature);
    t.batteryTemperatureC = static_cast<float>(numberOr(thermal, "batteryTemperatureC",
                                                       t.batteryTemperatureC));
    t.platformThermalStatus = static_cast<int32_t>(numberOr(thermal, "platformThermalStatus",
                                                            t.platformThermalStatus));
    t.cpuHeadroomAvailable = boolOr(thermal, "cpuHeadroomAvailable", t.cpuHeadroomAvailable);
    t.gameManagerAvailable = boolOr(thermal, "gameManagerAvailable", t.gameManagerAvailable);
    t.gameModeSupported = boolOr(thermal, "gameModeSupported", t.gameModeSupported);
    t.note = stringOr(thermal, "note", t.note);

    const JsonValue& gles = (*root)["gles"];
    GlesCaps& g = caps_.gles;
    g.available = boolOr(gles, "available", g.available);
    g.majorVersion = static_cast<int>(numberOr(gles, "majorVersion", g.majorVersion));
    g.minorVersion = static_cast<int>(numberOr(gles, "minorVersion", g.minorVersion));
    g.computeShaders = boolOr(gles, "computeShaders", g.computeShaders);
    g.floatRenderTargets = boolOr(gles, "floatRenderTargets", g.floatRenderTargets);
    g.floatTextures = boolOr(gles, "floatTextures", g.floatTextures);
    g.maxTextureSize = static_cast<int>(numberOr(gles, "maxTextureSize", g.maxTextureSize));
    g.maxComputeWorkGroupInvocations = static_cast<int>(
        numberOr(gles, "maxComputeWorkGroupInvocations", g.maxComputeWorkGroupInvocations));

    // Vulkan may also be supplied by the caller (used by tests and by the
    // "device database" screen); the native probe wins when it succeeded.
    const JsonValue& vulkan = (*root)["vulkan"];
    if (vulkan.isObject() && !caps_.vulkan.available) {
        VulkanCaps& v = caps_.vulkan;
        v.available = boolOr(vulkan, "available", v.available);
        v.deviceName = stringOr(vulkan, "deviceName", v.deviceName);
        v.driverName = stringOr(vulkan, "driverName", v.driverName);
        v.apiVersion = static_cast<uint32_t>(numberOr(vulkan, "apiVersion", v.apiVersion));
        v.driverVersion = static_cast<uint32_t>(numberOr(vulkan, "driverVersion", v.driverVersion));
        v.vendorId = static_cast<uint32_t>(numberOr(vulkan, "vendorId", v.vendorId));
        v.deviceId = static_cast<uint32_t>(numberOr(vulkan, "deviceId", v.deviceId));
        v.vendor = gpuVendorFromVendorId(v.vendorId);
        v.hasComputeQueue = boolOr(vulkan, "hasComputeQueue", v.hasComputeQueue);
        v.hasStorageImageRgba8 = boolOr(vulkan, "hasStorageImageRgba8", v.hasStorageImageRgba8);
        v.hasStorageImageR8 = boolOr(vulkan, "hasStorageImageR8", v.hasStorageImageR8);
        v.maxComputeWorkGroupInvocations = static_cast<uint32_t>(
            numberOr(vulkan, "maxComputeWorkGroupInvocations", v.maxComputeWorkGroupInvocations));
        v.maxComputeWorkGroupSizeX = static_cast<uint32_t>(
            numberOr(vulkan, "maxComputeWorkGroupSizeX", v.maxComputeWorkGroupSizeX));
        v.maxComputeWorkGroupSizeY = static_cast<uint32_t>(
            numberOr(vulkan, "maxComputeWorkGroupSizeY", v.maxComputeWorkGroupSizeY));
        v.maxComputeSharedMemorySize = static_cast<uint32_t>(
            numberOr(vulkan, "maxComputeSharedMemorySize", v.maxComputeSharedMemorySize));
        v.maxImageDimension2D = static_cast<uint32_t>(
            numberOr(vulkan, "maxImageDimension2D", v.maxImageDimension2D));
        v.maxStorageBufferRange = static_cast<uint32_t>(
            numberOr(vulkan, "maxStorageBufferRange", v.maxStorageBufferRange));
        v.maxPushConstantsSize = static_cast<uint32_t>(
            numberOr(vulkan, "maxPushConstantsSize", v.maxPushConstantsSize));
        v.maxMemoryAllocationCount = static_cast<uint32_t>(
            numberOr(vulkan, "maxMemoryAllocationCount", v.maxMemoryAllocationCount));
        v.deviceLocalMemoryBytes = static_cast<uint64_t>(
            numberOr(vulkan, "deviceLocalMemoryBytes", static_cast<double>(v.deviceLocalMemoryBytes)));
        v.totalMemoryBytes = static_cast<uint64_t>(
            numberOr(vulkan, "totalMemoryBytes", static_cast<double>(v.totalMemoryBytes)));
        v.memoryBudgetBytes = static_cast<uint64_t>(
            numberOr(vulkan, "memoryBudgetBytes", static_cast<double>(v.memoryBudgetBytes)));
        v.hasFloat16Storage = boolOr(vulkan, "hasFloat16Storage", v.hasFloat16Storage);
        v.hasInt8Storage = boolOr(vulkan, "hasInt8Storage", v.hasInt8Storage);
        v.hasSubgroupOps = boolOr(vulkan, "hasSubgroupOps", v.hasSubgroupOps);
        v.hasTimelineSemaphore = boolOr(vulkan, "hasTimelineSemaphore", v.hasTimelineSemaphore);
        v.hasExternalMemoryAndroidHardwareBuffer =
            boolOr(vulkan, "hasExternalMemoryAndroidHardwareBuffer",
                   v.hasExternalMemoryAndroidHardwareBuffer);
        v.hasTimestampCompute = boolOr(vulkan, "hasTimestampCompute", v.hasTimestampCompute);
        v.timestampPeriod = static_cast<float>(numberOr(vulkan, "timestampPeriod",
                                                        v.timestampPeriod));
    }

    if (initialised_) {
        tier_ = classifyDeviceTier(caps_);
        ValidationResult validation = validateProfile(profile_, &caps_);
        (void)validation;
        evaluateNow();
    }
    if (error != nullptr) error->clear();
    return true;
}

bool Engine::reprobeDevice(std::string* error) {
    std::string probeError;
    const DeviceCapabilities probed = probeDeviceWithVulkan(&probeError);
    caps_.vulkan = probed.vulkan;
    tier_ = classifyDeviceTier(caps_);
    ValidationResult validation = validateProfile(profile_, &caps_);
    (void)validation;
    evaluateNow();
    if (!probeError.empty()) {
        if (error != nullptr) *error = probeError;
        return false;
    }
    if (error != nullptr) error->clear();
    return true;
}

void Engine::evaluateNow() {
    CompatInput input;
    input.caps = caps_;
    input.integration = integration_;
    input.desired = profile_;
    input.aiModelInstalled = modelInstalled_;
    input.nnapiModelAvailable = caps_.neural.nnapiAvailable && caps_.neural.hasAccelerator;
    input.preferNpu = false;
    input.screenCapturePossible = true;
    compat_ = evaluateCompatibility(input);
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------
CompatResult Engine::compatibility() const { return compat_; }

std::string Engine::compatibilityJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("status", toString(compat_.status));
    w.field("tier", toString(compat_.tier));
    w.field("achievableMode", toString(compat_.achievableMode));
    w.field("achievableBackend", toString(compat_.achievableBackend));
    w.field("recommendedOutputWidth", compat_.recommendedOutput.width);
    w.field("recommendedOutputHeight", compat_.recommendedOutput.height);
    w.field("recommendedOutputLabel", compat_.recommendedOutput.label());
    w.field("recommendedRenderScalePercent", compat_.recommendedRenderScalePercent);
    w.field("maximumAiQuality", toString(compat_.maximumAiQuality));
    w.field("monitoringAvailable", compat_.monitoringAvailable);
    w.field("overlayAvailable", compat_.overlayAvailable);
    w.field("gameModeHintAvailable", compat_.gameModeHintAvailable);
    w.field("headline", compat_.headline);
    w.key("reasons");
    w.beginArray();
    for (const CompatReason& reason : compat_.reasons) {
        w.beginObject();
        w.field("cap", toString(reason.cap));
        w.field("code", reason.code);
        w.field("message", reason.message);
        w.field("detail", reason.detail);
        w.field("blocking", reason.blocking);
        w.endObject();
    }
    w.endArray();
    w.endObject();
    return w.str();
}

std::string Engine::deviceJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("description", describeDevice(caps_));
    w.field("tier", toString(tier_));
    w.field("socModel", caps_.android.socModel);
    w.field("socManufacturer", caps_.android.socManufacturer);
    w.field("hardware", caps_.android.hardware);
    w.field("board", caps_.android.board);
    w.field("sdkInt", caps_.android.sdkInt);
    w.field("release", caps_.android.release);
    w.field("cpuCoreCount", caps_.android.cpuCoreCount);
    w.field("isEmulator", caps_.android.isEmulator);
    w.field("displayRefreshRate", caps_.android.displayRefreshRate);
    w.field("displayWidth", caps_.android.displayWidth);
    w.field("displayHeight", caps_.android.displayHeight);
    w.field("totalRamBytes", caps_.memory.totalRamBytes);
    w.field("lowRamDevice", caps_.memory.lowRamDevice);
    w.key("vulkan");
    w.beginObject();
    w.field("available", caps_.vulkan.available);
    w.field("deviceName", caps_.vulkan.deviceName);
    w.field("driverName", caps_.vulkan.driverName);
    w.field("vendor", toString(caps_.vulkan.vendor));
    w.field("vendorId", caps_.vulkan.vendorId);
    w.field("apiVersion", caps_.vulkan.apiVersion);
    w.field("apiVersionMajor", caps_.vulkan.apiVersionMajor());
    w.field("apiVersionMinor", caps_.vulkan.apiVersionMinor());
    w.field("driverVersion", caps_.vulkan.driverVersion);
    w.field("hasComputeQueue", caps_.vulkan.hasComputeQueue);
    w.field("hasStorageImageRgba8", caps_.vulkan.hasStorageImageRgba8);
    w.field("hasStorageImageR8", caps_.vulkan.hasStorageImageR8);
    w.field("maxComputeWorkGroupInvocations", caps_.vulkan.maxComputeWorkGroupInvocations);
    w.field("maxComputeSharedMemorySize", caps_.vulkan.maxComputeSharedMemorySize);
    w.field("maxImageDimension2D", caps_.vulkan.maxImageDimension2D);
    w.field("maxStorageBufferRange", caps_.vulkan.maxStorageBufferRange);
    w.field("maxPushConstantsSize", caps_.vulkan.maxPushConstantsSize);
    w.field("deviceLocalMemoryBytes", caps_.vulkan.deviceLocalMemoryBytes);
    w.field("memoryBudgetBytes", caps_.vulkan.memoryBudgetBytes);
    w.field("hasFloat16Storage", caps_.vulkan.hasFloat16Storage);
    w.field("hasInt8Storage", caps_.vulkan.hasInt8Storage);
    w.field("hasSubgroupOps", caps_.vulkan.hasSubgroupOps);
    w.field("hasTimestampCompute", caps_.vulkan.hasTimestampCompute);
    w.field("timestampPeriod", caps_.vulkan.timestampPeriod);
    w.field("softwareRenderer", caps_.isSoftwareRenderer());
    w.endObject();
    w.key("gles");
    w.beginObject();
    w.field("available", caps_.gles.available);
    w.field("majorVersion", caps_.gles.majorVersion);
    w.field("minorVersion", caps_.gles.minorVersion);
    w.field("computeShaders", caps_.gles.computeShaders);
    w.endObject();
    w.key("neural");
    w.beginObject();
    w.field("nnapiAvailable", caps_.neural.nnapiAvailable);
    w.field("nnapiFeatureLevel", caps_.neural.nnapiFeatureLevel);
    w.field("hasAccelerator", caps_.neural.hasAccelerator);
    w.field("supportsFloat16", caps_.neural.supportsFloat16);
    w.field("supportsQuant8", caps_.neural.supportsQuant8);
    w.field("note", caps_.neural.note);
    w.key("acceleratorNames");
    w.beginArray();
    for (const std::string& name : caps_.neural.acceleratorNames) w.value(name);
    w.endArray();
    w.endObject();
    w.key("thermal");
    w.beginObject();
    w.field("powerManagerThermalApi", caps_.thermal.powerManagerThermalApi);
    w.field("hardwarePropertiesApi", caps_.thermal.hardwarePropertiesApi);
    w.field("batteryTemperature", caps_.thermal.batteryTemperature);
    w.field("batteryTemperatureC", caps_.thermal.batteryTemperatureC);
    w.field("cpuHeadroomAvailable", caps_.thermal.cpuHeadroomAvailable);
    w.field("gameManagerAvailable", caps_.thermal.gameManagerAvailable);
    w.field("gameModeSupported", caps_.thermal.gameModeSupported);
    w.field("note", caps_.thermal.note);
    w.endObject();
    w.endObject();
    return w.str();
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
bool Engine::setProfileJson(const std::string& json, std::string* error) {
    GraphicsProfile parsed;
    std::string parseError;
    if (!profileFromJson(json, parsed, &parseError)) {
        if (error != nullptr) *error = parseError;
        return false;
    }
    ValidationResult validation = validateProfile(parsed, &caps_);
    if (validation.hasError()) {
        if (error != nullptr) {
            std::string message = "the profile is not usable:";
            for (const ValidationMessage& m : validation.messages) {
                if (m.severity == ValidationMessage::Severity::Error) {
                    message += " " + m.message;
                }
            }
            *error = message;
        }
        return false;
    }
    profile_ = parsed;
    if (profile_.integration != IntegrationKind::None) integration_ = profile_.integration;
    evaluateNow();
    if (error != nullptr) error->clear();
    return true;
}

std::string Engine::profileJson() const { return profileToJson(profile_); }

std::string Engine::presetsJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.key("presets");
    w.beginArray();
    const QualityPreset presets[4] = {QualityPreset::Quality, QualityPreset::Balanced,
                                      QualityPreset::Performance, QualityPreset::Extreme};
    for (QualityPreset preset : presets) {
        GraphicsProfile candidate =
            makePresetProfile(preset, recommendedOutputResolution(caps_, tier_));
        const ValidationResult validation = validateProfile(candidate, &caps_);
        w.beginObject();
        w.field("preset", toString(preset));
        w.field("renderScalePercent", candidate.renderScalePercent);
        w.field("outputWidth", candidate.output.width);
        w.field("outputHeight", candidate.output.height);
        w.field("outputLabel", candidate.output.label());
        w.field("aiQuality", toString(candidate.aiQuality));
        w.field("sharpeningPercent", static_cast<int>(candidate.sharpening * 100.0f + 0.5f));
        w.field("targetFps", candidate.targetFps);
        w.field("experimental", preset == QualityPreset::Extreme);
        w.field("clampedForThisDevice", validation.modified);
        w.key("profile");
        w.raw(profileToJson(candidate));
        w.endObject();
    }
    w.endArray();
    w.field("recommendedQuality", toString(recommendedAiQuality(tier_)));
    w.field("recommendedRenderScalePercent", recommendedRenderScale(tier_));
    w.endObject();
    return w.str();
}

// ---------------------------------------------------------------------------
// Thermal + runtime settings
// ---------------------------------------------------------------------------
void Engine::updateThermal(const ThermalInput& input) {
    const ThermalLevel before = governor_.level();
    decision_ = governor_.update(input);
    if (governor_.level() != before) {
        V4K_LOGW("thermal: %s -> %s (%s)", toString(before), toString(governor_.level()),
                 decision_.reason.c_str());
    }
}

RuntimeSettings Engine::runtimeSettings() const {
    RuntimeSettings settings = resolveRuntimeSettings(profile_, decision_, modelInstalled_);
    return settings;
}

void Engine::addFrameSample(double frameTimeMs, int64_t nowMs, double upscalerMs) {
    lastUpscalerMs_ = upscalerMs;
    frames_.add(frameTimeMs, nowMs == 0 ? steadyNowMs() : nowMs);
}

void Engine::refreshMonitoring() {
    sampleProcFiles(cpuLoad_, ram_, cpuLoadFraction_, ramUsedFraction_);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
bool Engine::installModelBytes(const std::vector<uint8_t>& bytes, std::string* error) {
    Model model;
    std::string loadError;
    if (!loadModel(bytes, model, &loadError)) {
        if (error != nullptr) *error = loadError;
        return false;
    }
    if (!model.valid()) {
        if (error != nullptr) *error = "the model contains no layers";
        return false;
    }
    model_ = model;
    modelInstalled_ = true;
    evaluateNow();

    // A live session must pick the graph up without a restart; if the new graph
    // does not fit the current resolution the session keeps the analytical path
    // and says so.
    if (session_.active) {
        std::string sessionError;
#if defined(V4K_ENABLE_VULKAN)
        if (vk_ != nullptr && vk_->pipeline.valid()) {
            if (!vk_->pipeline.setModel(&model_, &sessionError)) {
                session_.neural = false;
                session_.lastError = sessionError;
                V4K_LOGW("model install: %s", sessionError.c_str());
            } else {
                session_.neural = vk_->pipeline.neuralReady();
            }
            session_.layerCount = vk_->pipeline.layerCount();
            session_.workingSetBytes = vk_->pipeline.workingSetBytes();
            session_.weightBytes = vk_->pipeline.weightBytes();
            session_.mode = vk_->pipeline.mode();
        }
#else
        sessionError = "this build has no Vulkan backend";
        session_.neural = false;
        session_.lastError = sessionError;
#endif
    }
    if (error != nullptr) error->clear();
    V4K_LOGI("model installed: %u layers, %llu bytes of weights", model_.opCount,
             static_cast<unsigned long long>(model_.fileBytes));
    return true;
}

bool Engine::installModelFile(const std::string& path, std::string* error) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        if (error != nullptr) *error = "could not open " + path;
        return false;
    }
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)),
                               std::istreambuf_iterator<char>());
    if (bytes.empty()) {
        if (error != nullptr) *error = path + " is empty";
        return false;
    }
    if (!installModelBytes(bytes, error)) return false;
    modelPath_ = path;
    return true;
}

void Engine::removeModel() {
    modelInstalled_ = false;
    model_ = Model{};
    modelPath_.clear();
#if defined(V4K_ENABLE_VULKAN)
    if (vk_ != nullptr && vk_->pipeline.valid()) {
        std::string ignored;
        vk_->pipeline.setModel(nullptr, &ignored);
        session_.neural = false;
        session_.layerCount = 0;
        session_.workingSetBytes = 0;
        session_.weightBytes = 0;
        session_.mode = vk_->pipeline.mode();
    }
#endif
    evaluateNow();
}

std::string Engine::modelJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("installed", modelInstalled_);
    w.field("path", modelPath_);
    w.field("preferredModelId", preferredModelId());
    w.field("quality", toString(profile_.aiQuality));
    w.field("backend", modelInstalled_ ? "GPU_VULKAN" : "NONE");
    w.key("model");
    w.beginObject();
    w.field("id", model_.id);
    w.field("version", model_.version);
    w.field("inputChannels", model_.inputChannels);
    w.field("scaleFactor", model_.scaleFactor);
    w.field("opCount", model_.opCount);
    w.field("fileBytes", model_.fileBytes);
    w.field("sha256", model_.fileSha256);
    w.field("temporal", model_.temporal());
    w.field("globalResidual", model_.globalResidual());
    w.field("experimental", model_.experimental());
    w.endObject();
    w.endObject();
    return w.str();
}

// ---------------------------------------------------------------------------
// Session (Vulkan)
// ---------------------------------------------------------------------------
#if defined(V4K_ENABLE_VULKAN)

bool Engine::startSessionOnDevice(const DeviceHandles& handles, const SessionDesc& desc,
                                  std::string* error) {
    if (!initialised_) {
        if (error != nullptr) *error = "initialise() the engine first";
        return false;
    }
    if (session_.active) stopSession();
    vk::QueueFamilies queues;
    queues.compute = handles.computeQueueFamily;
    queues.graphics = handles.graphicsQueueFamily;
    std::string adoptError;
    if (!vk_->context.adopt(reinterpret_cast<VkInstance>(handles.instance),
                            reinterpret_cast<VkPhysicalDevice>(handles.physicalDevice),
                            reinterpret_cast<VkDevice>(handles.device), queues,
                            reinterpret_cast<VkQueue>(handles.computeQueue),
                            reinterpret_cast<VkQueue>(handles.graphicsQueue), &adoptError)) {
        session_.lastError = adoptError;
        if (error != nullptr) *error = adoptError;
        return false;
    }

    vk::PipelineDesc pipelineDesc;
    pipelineDesc.inputWidth = desc.inputWidth;
    pipelineDesc.inputHeight = desc.inputHeight;
    pipelineDesc.outputWidth = desc.outputWidth;
    pipelineDesc.outputHeight = desc.outputHeight;
    pipelineDesc.neural = desc.neural && modelInstalled_;
    pipelineDesc.temporal = desc.temporal;
    pipelineDesc.denoise = desc.denoise;
    pipelineDesc.antiAliasing = desc.antiAliasing;
    pipelineDesc.sharpening = clamp01(desc.sharpening);
    pipelineDesc.denoiseStrength = clamp01(desc.noiseReduction);
    // An unstated budget is derived from the device's reported memory rather
    // than left unlimited: see defaultWorkingSetBudget() for the policy.
    pipelineDesc.maxWorkingBytes =
        desc.maxWorkingBytes != 0
            ? desc.maxWorkingBytes
            : defaultWorkingSetBudget(caps_.vulkan.deviceLocalMemoryBytes, caps_.vulkan.memoryBudgetBytes);

    std::string pipelineError;
    if (!vk_->pipeline.init(vk_->context, pipelineDesc, &pipelineError)) {
        session_.lastError = pipelineError;
        vk_->context.destroy();
        if (error != nullptr) *error = pipelineError;
        return false;
    }
    if (pipelineDesc.neural) {
        std::string modelError;
        if (!vk_->pipeline.setModel(&model_, &modelError)) {
            // A model that does not fit this resolution is not fatal: the
            // session continues analytically and the UI shows why.
            V4K_LOGW("session: %s", modelError.c_str());
            session_.lastError = modelError;
        }
    }
    vk_->cmd = vk_->context.allocatePrimaryCommandBuffer();
    vk_->fence = vk_->context.createFence(false);
    if (vk_->cmd == VK_NULL_HANDLE || vk_->fence == VK_NULL_HANDLE) {
        const std::string message = "could not allocate the engine command buffer";
        stopSession();
        if (error != nullptr) *error = message;
        return false;
    }

    desc_ = desc;
    session_.active = true;
    session_.inputWidth = desc.inputWidth;
    session_.inputHeight = desc.inputHeight;
    session_.outputWidth = desc.outputWidth;
    session_.outputHeight = desc.outputHeight;
    session_.neural = vk_->pipeline.neuralReady();
    session_.temporal = desc.temporal;
    session_.layerCount = vk_->pipeline.layerCount();
    session_.workingSetBytes = vk_->pipeline.workingSetBytes();
    session_.weightBytes = vk_->pipeline.weightBytes();
    session_.mode = vk_->pipeline.mode();
    session_.modelId = modelInstalled_ ? model_.id : std::string();
    session_.lastError.clear();
    lastTimings_ = StageMs{};
    evaluateNow();
    if (error != nullptr) error->clear();
    V4K_LOGI("session started: %ux%u -> %ux%u (neural=%d temporal=%d)", desc.inputWidth,
             desc.inputHeight, desc.outputWidth, desc.outputHeight, session_.neural ? 1 : 0,
             desc.temporal ? 1 : 0);
    return true;
}

void Engine::stopSession() {
    if (vk_ != nullptr) {
        if (session_.active || vk_->pipeline.valid()) {
            vk_->pipeline.shutdown();
        }
        if (vk_->cmd != VK_NULL_HANDLE || vk_->fence != VK_NULL_HANDLE) {
            if (vk_->context.valid()) {
                vkDeviceWaitIdle(vk_->context.device());
            }
            vk_->cmd = VK_NULL_HANDLE;
            vk_->fence = VK_NULL_HANDLE;
        }
        vk_->context.destroy();
        vk_->frameIndex = 0;
    }
    session_.active = false;
    session_.mode = ReconstructionMode::None;
    session_.lastError.clear();
    lastTimings_ = StageMs{};
}

FrameResult Engine::processFrame(const FrameHandles& frame) {
    FrameResult result;
    if (!session_.active) {
        result.error = "no active session";
        return result;
    }
    const int64_t recordStart = steadyNowMs();
    if (frame.lowResImage == 0 || frame.lowResView == 0 || frame.outputImage == 0 ||
        frame.outputView == 0) {
        result.error = "processFrame() needs the low-res image/view and the output image/view";
        return result;
    }

    vk_->lowRes.image = reinterpret_cast<VkImage>(frame.lowResImage);
    vk_->lowRes.view = reinterpret_cast<VkImageView>(frame.lowResView);
    vk_->lowRes.width = desc_.inputWidth;
    vk_->lowRes.height = desc_.inputHeight;
    vk_->lowRes.format = VK_FORMAT_R16G16B16A16_SFLOAT;
    vk_->lowRes.usage = VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_STORAGE_BIT;

    vk_->output.image = reinterpret_cast<VkImage>(frame.outputImage);
    vk_->output.view = reinterpret_cast<VkImageView>(frame.outputView);
    vk_->output.width = desc_.outputWidth;
    vk_->output.height = desc_.outputHeight;
    vk_->output.format = VK_FORMAT_R16G16B16A16_SFLOAT;
    vk_->output.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;

    vk::FrameInputVk input;
    input.lowResColor = &vk_->lowRes;
    if (frame.motionImage != 0 && frame.motionView != 0) {
        vk_->motion.image = reinterpret_cast<VkImage>(frame.motionImage);
        vk_->motion.view = reinterpret_cast<VkImageView>(frame.motionView);
        vk_->motion.width = desc_.inputWidth;
        vk_->motion.height = desc_.inputHeight;
        vk_->motion.format = VK_FORMAT_R16G16_SFLOAT;
        vk_->motion.usage = VK_IMAGE_USAGE_SAMPLED_BIT;
        input.motionVectors = &vk_->motion;
    }
    input.frameIndex = vk_->frameIndex++;
    input.deltaSeconds = static_cast<float>(frame.deltaSeconds);
    input.resetHistory = frame.resetHistory;
    input.historyValid = frame.historyValid;

    VkCommandBufferBeginInfo beginInfo{};
    beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    beginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    if (vkBeginCommandBuffer(vk_->cmd, &beginInfo) != VK_SUCCESS) {
        result.error = "vkBeginCommandBuffer failed";
        session_.lastError = result.error;
        return result;
    }

    vk::PassTimings timings;
    if (!vk_->pipeline.record(vk_->cmd, input, &vk_->output, &timings)) {
        result.error = vk_->pipeline.lastError().empty() ? "the pipeline failed to record the frame"
                                                        : vk_->pipeline.lastError();
        session_.lastError = result.error;
        vkEndCommandBuffer(vk_->cmd);
        return result;
    }
    if (vkEndCommandBuffer(vk_->cmd) != VK_SUCCESS) {
        result.error = "vkEndCommandBuffer failed";
        session_.lastError = result.error;
        return result;
    }

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &vk_->cmd;
    const VkResult submitted = vkQueueSubmit(vk_->context.computeQueue(), 1, &submit, vk_->fence);
    if (submitted != VK_SUCCESS) {
        result.error = std::string("vkQueueSubmit failed: ") + vk::resultToString(submitted);
        session_.lastError = result.error;
        return result;
    }
    // Lowest latency: the caller gets the output image back ready to use, and
    // the GPU is never more than one frame behind. The demo/benchmark need the
    // completed frame anyway (it is presented next).
    if (vkWaitForFences(vk_->context.device(), 1, &vk_->fence, VK_TRUE, UINT64_MAX) != VK_SUCCESS) {
        result.error = "vkWaitForFences failed";
        session_.lastError = result.error;
        return result;
    }
    vkResetFences(vk_->context.device(), 1, &vk_->fence);
    vkResetCommandBuffer(vk_->cmd, 0);

    lastTimings_.available = timings.valid;
    lastTimings_.countersAvailable = timings.countersAvailable;
    lastTimings_.preprocessMs = timings.preprocessMs;
    lastTimings_.neuralMs = timings.neuralMs;
    lastTimings_.denoiseMs = timings.denoiseMs;
    lastTimings_.temporalMs = timings.temporalMs;
    lastTimings_.aaMs = timings.aaMs;
    lastTimings_.sharpenMs = timings.sharpenMs;

    if (timings.valid) {
        // Stage timers keep microseconds; GPU timings are real measurements.
        stages_.record(Stage::Preprocess, timings.preprocessMs * 1000.0);
        stages_.record(Stage::Inference, timings.neuralMs * 1000.0);
        stages_.record(Stage::TemporalReconstruction, timings.temporalMs * 1000.0);
        stages_.record(Stage::AntiAliasing, timings.aaMs * 1000.0);
        stages_.record(Stage::Sharpening, timings.sharpenMs * 1000.0);
        if (timings.denoiseMs != kUnavailable) {
            stages_.record(Stage::MotionEstimation, timings.denoiseMs * 1000.0);
        }
        const double busyMs = timings.measuredTotalMs();
        if (busyMs != kUnavailable && frames_.lastFrameTimeMs() != kUnavailable) {
            const double periodMs = frames_.lastFrameTimeMs();
            if (periodMs > 0.0) {
                gpuLoad_.recordFrame(static_cast<uint64_t>(busyMs * 1e6),
                                     static_cast<uint64_t>(periodMs * 1e6));
            }
        }
    }

    session_.mode = vk_->pipeline.mode();
    result.submitted = true;
    result.mode = session_.mode;
    result.upscalerMs = static_cast<double>(steadyNowMs() - recordStart);
    vk_->recordMs = result.upscalerMs;
    return result;
}

std::string Engine::sessionJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("active", session_.active);
    w.field("inputWidth", session_.inputWidth);
    w.field("inputHeight", session_.inputHeight);
    w.field("outputWidth", session_.outputWidth);
    w.field("outputHeight", session_.outputHeight);
    w.field("neural", session_.neural);
    w.field("temporal", session_.temporal);
    w.field("layerCount", session_.layerCount);
    w.field("workingSetBytes", session_.workingSetBytes);
    w.field("weightBytes", session_.weightBytes);
    w.field("mode", toString(session_.mode));
    w.field("modeName", vk::reconstructionModeName(session_.mode));
    w.field("modelId", session_.modelId);
    w.field("lastError", session_.lastError);
    w.key("timings");
    w.raw(lastTimings_.toJson());
    w.field("aiProcessingMs", lastUpscalerMs_);
    w.endObject();
    return w.str();
}

#else  // !V4K_ENABLE_VULKAN

bool Engine::startSessionOnDevice(const DeviceHandles&, const SessionDesc&, std::string* error) {
    const std::string message =
        "this build of the engine has no Vulkan backend (V4K_ENABLE_VULKAN=OFF)";
    session_.lastError = message;
    if (error != nullptr) *error = message;
    return false;
}

void Engine::stopSession() {
    session_.active = false;
    session_.mode = ReconstructionMode::None;
}

FrameResult Engine::processFrame(const FrameHandles&) {
    FrameResult result;
    result.error = "this build of the engine has no Vulkan backend";
    return result;
}

std::string Engine::sessionJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("active", false);
    w.field("mode", "NONE");
    w.field("modeName", "No Vulkan backend in this build");
    w.field("lastError", describeVulkanUnavailable());
    w.endObject();
    return w.str();
}

#endif  // V4K_ENABLE_VULKAN

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------
std::string Engine::statusJson() {
    refreshMonitoring();
    const RuntimeSettings settings = runtimeSettings();
    bool anyStage = false;
    for (int i = 0; i < kStageCount; ++i) {
        if (stages_.hasData(static_cast<Stage>(i))) anyStage = true;
    }

    JsonWriter w(2);
    w.beginObject();
    w.field("engineVersion", "1.0.0");
    // Which kind of native build this is, so a bug report or a screenshot can
    // say it without guessing. Both are compile-time facts, not measurements.
    w.field("debugChecks", kDebugChecks);
    w.field("vulkanBackend", vk::kAvailable);
    w.field("initialised", initialised_);
    w.field("integration", toString(integration_));
    w.field("tier", toString(tier_));

    w.key("profile");
    w.raw(profileToJson(profile_));
    w.key("runtime");
    w.raw(settings.toJson());

    w.key("thermal");
    w.beginObject();
    w.field("level", toString(decision_.level));
    w.field("platformThermalStatus", caps_.thermal.platformThermalStatus);
    w.field("batteryTempAvailable", caps_.thermal.batteryTemperature);
    if (caps_.thermal.batteryTemperature && caps_.thermal.batteryTemperatureC > 0.0f) {
        w.field("batteryTempC", caps_.thermal.batteryTemperatureC);
    } else {
        // BatteryManager is the only normal-app temperature source; when the
        // platform did not report one, the UI shows "unavailable" (never a
        // fabricated value, and never the SoC temperature, which Android does
        // not expose to apps at all).
        w.fieldNull("batteryTempC");
    }
    w.fieldNull("socTempC");
    w.field("powerManagerThermalApi", caps_.thermal.powerManagerThermalApi);
    w.field("note", caps_.thermal.note);
    w.key("decision");
    w.raw(decision_.toJson());
    w.endObject();

    w.key("monitor");
    w.beginObject();
    if (frames_.empty()) {
        w.fieldNull("fps");
        w.fieldNull("averageFps");
        w.fieldNull("onePercentLowFps");
        w.fieldNull("frameTimeMs");
        w.fieldNull("jitterMs");
        w.fieldNull("worstFrameMs");
    } else {
        w.field("fps", frames_.instantFps());
        w.field("averageFps", frames_.averageFps());
        w.field("onePercentLowFps", frames_.onePercentLowFps());
        w.field("frameTimeMs", frames_.meanMs());
        w.field("jitterMs", frames_.jitterMs());
        w.field("worstFrameMs", frames_.maxMs());
    }
    w.field("gpuBusyLabel", "GPU busy (AI Vision passes)");
    if (gpuLoad_.available()) {
        w.field("gpuBusyFraction", gpuLoad_.utilization());
        w.field("gpuBusyMs", gpuLoad_.busyMs());
    } else {
        w.fieldNull("gpuBusyFraction");
        w.fieldNull("gpuBusyMs");
    }
    if (cpuLoadFraction_ == kUnavailable) w.fieldNull("cpuLoadFraction");
    else w.field("cpuLoadFraction", cpuLoadFraction_);
    if (ramUsedFraction_ == kUnavailable) w.fieldNull("ramUsedFraction");
    else w.field("ramUsedFraction", ramUsedFraction_);
    w.field("ramTotalBytes", ram_.totalBytes);
    w.field("ramAvailableBytes", ram_.availableBytes);
    if (lastUpscalerMs_ == kUnavailable) w.fieldNull("aiProcessingMs");
    else w.field("aiProcessingMs", lastUpscalerMs_);
    if (!anyStage) {
        w.fieldNull("aiStageTotalMs");
    } else {
        const double stageTotal = stages_.upscalerLastUs();
        if (stageTotal == kUnavailable) w.fieldNull("aiStageTotalMs");
        else w.field("aiStageTotalMs", stageTotal / 1000.0);
    }
    w.endObject();

    w.key("session");
    w.raw(sessionJson());
    w.key("model");
    w.raw(modelJson());
    w.field("note",
            "Every number here is measured on this device; \"unavailable\" means the "
            "platform did not report it.");
    w.endObject();
    return w.str();
}

std::string Engine::metricsJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("frameCount", static_cast<uint64_t>(frames_.size()));
    w.key("frameTimesMs");
    w.beginArray();
    for (double sample : frames_.samples()) w.value(sample);
    w.endArray();
    w.key("stages");
    w.beginArray();
    for (int i = 0; i < kStageCount; ++i) {
        const Stage stage = static_cast<Stage>(i);
        JsonWriter entry(0);
        entry.beginObject();
        entry.field("stage", toString(stage));
        if (stages_.hasData(stage)) {
            entry.field("lastUs", stages_.lastUs(stage));
            entry.field("emaUs", stages_.emaUs(stage));
            entry.field("maxUs", stages_.maxUs(stage));
        } else {
            entry.fieldNull("lastUs");
            entry.fieldNull("emaUs");
            entry.fieldNull("maxUs");
        }
        entry.endObject();
        w.value(entry.str());
    }
    w.endArray();
    w.key("timings");
    w.raw(lastTimings_.toJson());
    w.key("gpu");
    w.beginObject();
    if (gpuLoad_.available()) {
        w.field("busyFraction", gpuLoad_.utilization());
        w.field("busyMs", gpuLoad_.busyMs());
    } else {
        w.fieldNull("busyFraction");
        w.fieldNull("busyMs");
    }
    w.endObject();
    w.endObject();
    return w.str();
}

}  // namespace v4k
