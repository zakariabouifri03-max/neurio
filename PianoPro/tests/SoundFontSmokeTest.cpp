#define TSF_NO_STDIO
#define TSF_IMPLEMENTATION
#include "tsf.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
void require (bool condition, const std::string& message)
{
    if (! condition)
        throw std::runtime_error (message);
}

std::vector<std::uint8_t> readFile (const char* filename)
{
    std::ifstream input (filename, std::ios::binary | std::ios::ate);
    require (input.good(), std::string ("could not open ") + filename);
    const auto size = input.tellg();
    require (size > 12 && size < std::numeric_limits<int>::max(), "SoundFont file size is invalid");
    std::vector<std::uint8_t> data (static_cast<std::size_t> (size));
    input.seekg (0);
    input.read (reinterpret_cast<char*> (data.data()), static_cast<std::streamsize> (data.size()));
    require (input.good(), "could not read SoundFont completely");
    return data;
}

void exercisePreset (tsf* synth, int bank, int program, const std::string& expectedName)
{
    require (tsf_channel_set_bank_preset (synth, 0, bank, program) != 0,
             "expected SoundFont preset is missing: " + expectedName);
    const auto* name = tsf_bank_get_presetname (synth, bank, program);
    require (name != nullptr, "SoundFont preset has no name");
    std::cout << "  preset " << program << ": " << name << '\n';

    // Trigger a chord plus enough extra pitches to exercise polyphony and safe voice allocation.
    for (int note = 36; note < 76; ++note)
        require (tsf_channel_note_on (synth, 0, note, 0.62f) != 0, "voice allocation failed");
    require (tsf_active_voice_count (synth) >= 32, "fewer than 32 voices were allocated");

    std::vector<float> output (4096U * 2U, 0.0f);
    tsf_render_float (synth, output.data(), 4096, 0);
    double absoluteEnergy = 0.0;
    for (const auto sample : output)
    {
        require (std::isfinite (sample), "renderer produced a non-finite sample");
        absoluteEnergy += std::abs (sample);
    }
    require (absoluteEnergy > 0.01, "renderer produced silence for a real preset");

    tsf_channel_note_off_all (synth, 0);
    std::fill (output.begin(), output.end(), 0.0f);
    tsf_render_float (synth, output.data(), 4096, 0);
    for (const auto sample : output)
        require (std::isfinite (sample), "note release produced a non-finite sample");
}
}

int main (int argc, char** argv)
{
    if (argc != 3)
    {
        std::cerr << "Usage: PianoProSoundFontSmoke <general-midi.sf2> <soft-piano.sf2>\n";
        return 2;
    }

    try
    {
        auto generalData = readFile (argv[1]);
        auto* general = tsf_load_memory (generalData.data(), static_cast<int> (generalData.size()));
        require (general != nullptr, "General MIDI SoundFont could not be decoded");
        tsf_set_output (general, TSF_STEREO_INTERLEAVED, 44100, -3.0f);
        require (tsf_set_max_voices (general, 128) != 0, "could not reserve polyphonic voices");
        std::cout << "General MIDI bank: " << tsf_get_presetcount (general) << " presets\n";
        exercisePreset (general, 0, 0, "Grand Piano");
        exercisePreset (general, 0, 4, "Electric Piano");
        exercisePreset (general, 0, 16, "Organ");
        tsf_close (general);

        auto softData = readFile (argv[2]);
        auto* soft = tsf_load_memory (softData.data(), static_cast<int> (softData.size()));
        require (soft != nullptr, "Soft Piano SoundFont could not be decoded");
        tsf_set_output (soft, TSF_STEREO_INTERLEAVED, 44100, -3.0f);
        require (tsf_set_max_voices (soft, 128) != 0, "could not reserve soft-piano voices");
        std::cout << "Soft-piano bank: " << tsf_get_presetcount (soft) << " preset(s)\n";
        exercisePreset (soft, 0, 0, "Upright piano KW");
        tsf_close (soft);

        std::cout << "SoundFont playback, preset lookup, 32+ polyphony, finite output and releases passed.\n";
        return 0;
    }
    catch (const std::exception& exception)
    {
        std::cerr << "SoundFont test failed: " << exception.what() << '\n';
        return 1;
    }
}
