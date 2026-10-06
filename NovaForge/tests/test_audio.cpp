// Audio tests: WAV decoding and the software mixer must produce the exact
// expected waveform - not just "some noise".
#include "test_framework.h"

#include "audio/audio.h"
#include "core/fs.h"

#include <cmath>

using namespace nf;

namespace {

std::string tempDir() {
    std::string d = fs::join(fs::tempDir(), "novaforge_audio_tests");
    fs::createDirectories(d);
    return d;
}

std::vector<float> sine(float hz, float seconds, int sampleRate, float amplitude = 1.0f) {
    size_t frames = (size_t)(seconds * sampleRate);
    std::vector<float> out(frames);
    for (size_t i = 0; i < frames; ++i)
        out[i] = amplitude * std::sin(2.0f * PI * hz * (float)i / (float)sampleRate);
    return out;
}

}  // namespace

NF_TEST(audio_wav_round_trip) {
    std::string path = fs::join(tempDir(), "tone.wav");
    std::vector<float> source = sine(440.0f, 0.25f, 22050, 0.5f);
    CHECK(writeWavFile(path, source, 22050));
    CHECK(fs::exists(path));

    AudioClip clip;
    std::string error;
    CHECK(loadWavFile(path, clip, &error));
    CHECK_EQ(clip.sampleRate, 22050);
    CHECK_EQ(clip.channels, 1);
    CHECK_EQ(clip.samples.size(), source.size());
    CHECK_MSG(std::fabs(clip.durationSeconds() - 0.25f) < 0.01f, "duration should match");
    // 16 bit quantisation: within one step
    float maxError = 0.0f;
    for (size_t i = 0; i < source.size(); ++i)
        maxError = std::max(maxError, std::fabs(clip.samples[i] - source[i]));
    CHECK_MSG(maxError < 1.0f / 32000.0f, "decoded samples must match the encoded ones");
}

NF_TEST(audio_decodes_8_and_16_bit_stereo) {
    // hand-build an 8 bit stereo wav (silence, then full scale)
    std::vector<uint8_t> wav;
    auto u32 = [&wav](uint32_t v) {
        wav.push_back(v & 0xFF); wav.push_back((v >> 8) & 0xFF);
        wav.push_back((v >> 16) & 0xFF); wav.push_back((v >> 24) & 0xFF);
    };
    auto u16 = [&wav](uint16_t v) { wav.push_back(v & 0xFF); wav.push_back((v >> 8) & 0xFF); };
    const char* riff = "RIFF"; wav.insert(wav.end(), riff, riff + 4);
    u32(36 + 4);
    const char* wave = "WAVEfmt "; wav.insert(wav.end(), wave, wave + 8);
    u32(16); u16(1); u16(2); u32(8000); u32(16000); u16(2); u16(8);
    const char* data = "data"; wav.insert(wav.end(), data, data + 4);
    u32(4);
    wav.push_back(128);   // left silence
    wav.push_back(128);   // right silence
    wav.push_back(255);   // left max
    wav.push_back(0);     // right min

    AudioClip clip;
    std::string error;
    CHECK(decodeWav(wav.data(), wav.size(), clip, &error));
    CHECK_EQ(clip.sampleRate, 8000);
    CHECK_EQ(clip.channels, 2);
    CHECK_EQ(clip.samples.size(), 4u);
    CHECK_NEAR(clip.samples[0], 0.0f, 0.01f);
    CHECK_NEAR(clip.samples[1], 0.0f, 0.01f);
    CHECK_MSG(clip.samples[2] > 0.9f, "255 must decode close to +1");
    CHECK_MSG(clip.samples[3] < -0.9f, "0 must decode close to -1");

    // a non-wav buffer must fail cleanly, not crash
    std::vector<uint8_t> junk(64, 'x');
    CHECK(!decodeWav(junk.data(), junk.size(), clip, &error));
    CHECK(!error.empty());
}

NF_TEST(audio_mixer_produces_the_expected_waveform) {
    AudioSystem audio;
    AudioSettings settings;
    settings.sampleRate = 22050;
    settings.masterVolume = 1.0f;
    audio.init(settings);
    CHECK(!audio.backendName().empty());

    auto clip = audio.registerClip("sine", sine(440.0f, 0.1f, 22050), 22050, 1);
    SoundHandle h = audio.play(clip, Vec3(0, 0, 0), 1.0f, false, false);
    CHECK(h != kInvalidSound);
    CHECK_EQ(audio.activeVoices(), 1u);

    std::vector<float> mixed;
    audio.mixInto(mixed, 64);
    CHECK_EQ(mixed.size(), 128u);
    // left and right must be identical for a non spatial sound
    for (int i = 0; i < 64; ++i) CHECK_NEAR(mixed[i * 2], mixed[i * 2 + 1], 1e-6f);
    // the mixer applies the documented soft clipper: out = tanh(0.9 * in)
    for (int i = 0; i < 64; ++i) {
        float expected = std::tanh(0.9f * clip->samples[i]);
        CHECK_NEAR(mixed[i * 2], expected, 0.01f);
    }
    CHECK_MSG(audio.lastMixedRms() >= 0.0f, "rms must be reported");
}

NF_TEST(audio_voices_stop_and_loop) {
    AudioSystem audio;
    AudioSettings settings;
    settings.sampleRate = 8000;
    audio.init(settings);
    auto clip = audio.registerClip("blip", sine(200.0f, 0.05f, 8000, 0.5f), 8000, 1);

    SoundHandle oneShot = audio.play(clip, Vec3(0, 0, 0), 1.0f, false, false);
    CHECK_EQ(audio.activeVoices(), 1u);
    for (int i = 0; i < 20; ++i) audio.update(0.01f);   // 0.2 s > 0.05 s clip
    CHECK_MSG(!audio.isPlaying(oneShot), "a finished one shot must stop");
    CHECK_EQ(audio.activeVoices(), 0u);
    CHECK_NEAR(audio.lastMixedRms(), 0.0f, 0.001f);

    SoundHandle loop = audio.play(clip, Vec3(0, 0, 0), 1.0f, true, false);
    for (int i = 0; i < 20; ++i) audio.update(0.01f);
    CHECK_MSG(audio.isPlaying(loop), "a looping voice must keep playing");
    audio.stop(loop);
    CHECK_EQ(audio.activeVoices(), 0u);
}

NF_TEST(audio_spatial_attenuation_and_mute) {
    AudioSystem audio;
    AudioSettings settings;
    settings.sampleRate = 8000;
    audio.init(settings);
    // listener looking down -Z, up +Y  ->  right = +X
    audio.setListener(Vec3(0, 0, 0), Vec3(0, 0, -1), Vec3(0, 1, 0));
    auto clip = audio.registerClip("hum", sine(150.0f, 0.5f, 8000, 1.0f), 8000, 1);

    auto rmsOfLastMix = [&audio](int frames) {
        std::vector<float> buffer;
        audio.mixInto(buffer, frames);
        double sum = 0.0;
        for (float s : buffer) sum += (double)s * s;
        return (float)std::sqrt(sum / (double)buffer.size());
    };

    SoundHandle near = audio.play(clip, Vec3(0, 0, 0), 1.0f, true, true, 1.0f, 30.0f);
    float nearRms = rmsOfLastMix(256);
    audio.stop(near);

    SoundHandle far = audio.play(clip, Vec3(0, 0, 20), 1.0f, true, true, 1.0f, 30.0f);
    float farRms = rmsOfLastMix(256);
    CHECK_MSG(nearRms > farRms * 2.0f, "a distant sound must be attenuated");
    CHECK_MSG(farRms > 0.0001f, "a sound inside the max distance must still be audible");
    audio.stop(far);

    // a sound straight ahead and to the right: the right channel must be louder
    SoundHandle rightSide = audio.play(clip, Vec3(10, 0, -10), 1.0f, true, true, 1.0f, 60.0f);
    std::vector<float> panned;
    audio.mixInto(panned, 128);
    float left = 0, right = 0;
    for (int i = 0; i < 128; ++i) {
        left += std::fabs(panned[i * 2]);
        right += std::fabs(panned[i * 2 + 1]);
    }
    CHECK_MSG(right > left * 1.2f, "a sound to the right must be louder in the right channel");
    audio.stop(rightSide);

    // beyond the max distance a non looping sound ends
    SoundHandle tooFar = audio.play(clip, Vec3(0, 0, 1000), 1.0f, false, true, 1.0f, 30.0f);
    audio.mixInto(panned, 64);
    CHECK_MSG(!audio.isPlaying(tooFar), "a sound past maxDistance must end");

    audio.setMasterVolume(0.0f);
    SoundHandle quiet = audio.play(clip, Vec3(0, 0, 0), 1.0f, true, false);
    std::vector<float> silent;
    audio.mixInto(silent, 64);
    for (float s : silent) CHECK_NEAR(s, 0.0f, 1e-4f);
    audio.setMasterVolume(1.0f);
    audio.setMuted(true);
    audio.mixInto(silent, 64);
    for (float s : silent) CHECK_NEAR(s, 0.0f, 1e-4f);
    audio.setMuted(false);
    CHECK(audio.isPlaying(quiet));

    audio.stopAll();
    CHECK_EQ(audio.activeVoices(), 0u);
}

NF_TEST(audio_loads_project_files_and_reports_missing_ones) {
    std::string dir = tempDir();
    std::string path = fs::join(dir, "pickup.wav");
    CHECK(writeWavFile(path, sine(880.0f, 0.1f, 16000, 0.8f), 16000));

    AudioSystem audio;
    audio.init();
    auto clip = audio.load(path);
    CHECK_MSG(clip && clip->valid(), "loading a real wav file must succeed");
    CHECK_EQ(clip->sampleRate, 16000);
    // cached: the second load returns the same instance
    CHECK(audio.load(path) == clip);
    CHECK(audio.load(fs::join(dir, "does_not_exist.wav")) == nullptr);
    CHECK(!audio.lastError().empty());
    SoundHandle h = audio.playFile(fs::join(dir, "does_not_exist.wav"));
    CHECK_EQ(h, kInvalidSound);
}
