#include "PianoEngine.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
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

struct StereoBlock
{
    std::vector<float> left;
    std::vector<float> right;

    explicit StereoBlock (int frames) : left (static_cast<std::size_t> (frames)), right (static_cast<std::size_t> (frames)) {}

    void render (piano::PianoEngine& engine)
    {
        float* channels[] { left.data(), right.data() };
        engine.render (channels, 2, static_cast<int> (left.size()));
    }

    double absoluteEnergy() const
    {
        double sum = 0.0;
        for (const auto sample : left)
        {
            require (std::isfinite (sample), "left channel contains a non-finite sample");
            sum += std::abs (sample);
        }
        for (const auto sample : right)
        {
            require (std::isfinite (sample), "right channel contains a non-finite sample");
            sum += std::abs (sample);
        }
        return sum;
    }
};
}

int main (int argc, char** argv)
{
    if (argc != 3)
    {
        std::cerr << "Usage: PianoProEngineTests <general-midi.sf2> <soft-piano.sf2>\n";
        return 2;
    }

    try
    {
        piano::PianoEngine engine;
        std::string error;
        require (engine.loadSoundFonts (argv[1], argv[2], error), "both local SoundFonts should load: " + error);
        require (engine.instrumentAvailable (piano::Instrument::grandPiano), "grand piano is unavailable");
        require (engine.instrumentAvailable (piano::Instrument::electricPiano), "electric piano is unavailable");
        require (engine.instrumentAvailable (piano::Instrument::organ), "organ is unavailable");
        require (engine.instrumentAvailable (piano::Instrument::softPiano), "soft piano is unavailable");

        engine.prepareToPlay (44100.0, 512);
        engine.setMasterVolume (1.0f);
        engine.setInstrument (piano::Instrument::grandPiano);
        engine.noteOn (20, 112);
        engine.noteOn (109, 112);
        StereoBlock outOfRangeBlock (64);
        outOfRangeBlock.render (engine);
        require (engine.activeVoiceCount() == 0 && engine.noteEventCounter() == 0,
                 "engine accepted notes outside the 88-key A0-C8 range");

        engine.noteOn (60, 112);
        StereoBlock noteBlock (1024);
        noteBlock.render (engine);
        require (engine.isNoteActive (60), "note-on was not published to the keyboard state");
        require (engine.mostRecentlyPlayedNote() == 60, "latest note was not published");
        require (engine.noteEventCounter() == 1, "note-on event counter was not incremented");
        require (noteBlock.absoluteEnergy() > 0.01, "PianoEngine rendered silence for a real note");
        require (engine.activeVoiceCount() >= 1, "the piano voice was not allocated");

        engine.noteOff (60);
        StereoBlock releaseBlock (512);
        releaseBlock.render (engine);
        require (! engine.isNoteActive (60), "note-off did not clear the pressed-key state");

        for (int note = 36; note < 76; ++note)
            engine.noteOn (note, 96);
        StereoBlock chordBlock (1024);
        chordBlock.render (engine);
        require (engine.activeVoiceCount() >= 32, "PianoEngine did not allocate at least 32 concurrent voices");
        require (chordBlock.absoluteEnergy() > 0.01, "polyphonic chord output was silent");
        engine.allNotesOff (true);
        StereoBlock clearChordBlock (64);
        clearChordBlock.render (engine);

        engine.setInstrument (piano::Instrument::electricPiano);
        StereoBlock programBlock (64);
        programBlock.render (engine);
        require (engine.activeInstrument() == piano::Instrument::electricPiano,
                 "electric-piano program change was not applied");
        require (engine.activeProgram() == 4 && engine.activeBank() == 0,
                 "electric-piano GM program/bank mapping is incorrect");

        engine.setInstrument (piano::Instrument::organ);
        programBlock.render (engine);
        require (engine.activeInstrument() == piano::Instrument::organ && engine.activeProgram() == 16,
                 "organ GM program change was not applied");
        engine.noteOn (67, 96);
        StereoBlock organBlock (512);
        organBlock.render (engine);
        require (organBlock.absoluteEnergy() > 0.01, "organ preset rendered silence");
        engine.allNotesOff (true);
        programBlock.render (engine);

        engine.setInstrument (piano::Instrument::softPiano);
        programBlock.render (engine);
        require (engine.activeInstrument() == piano::Instrument::softPiano
                 && engine.activeBank() == 1 && engine.activeProgram() == 0,
                 "soft-piano bank/program change was not applied");
        engine.noteOn (64, 90);
        StereoBlock softBlock (512);
        softBlock.render (engine);
        require (softBlock.absoluteEnergy() > 0.01, "soft-piano preset rendered silence");

        engine.setSustain (piano::SustainSource::userInterface, true);
        engine.noteOn (65, 100);
        StereoBlock sustainOnBlock (512);
        sustainOnBlock.render (engine);
        engine.noteOff (65);
        StereoBlock sustainHoldBlock (512);
        sustainHoldBlock.render (engine);
        require (engine.activeVoiceCount() > 0, "sustain did not hold the sampled voice after note-off");
        engine.setSustain (piano::SustainSource::userInterface, false);
        StereoBlock sustainReleaseBlock (512);
        sustainReleaseBlock.render (engine);

        auto sequence = std::make_shared<const std::vector<piano::MidiEvent>> (
            std::vector<piano::MidiEvent> {
                { 0.00, piano::MidiEventType::programChange, 0, 4, 0, 0 },
                { 0.00, piano::MidiEventType::noteOn, 60, 104, 0, 1 },
                { 0.05, piano::MidiEventType::noteOff, 60, 0, 0, 2 }
            });
        require (engine.startPlayback (sequence), "engine rejected a valid MIDI playback sequence");
        StereoBlock playbackStartBlock (512);
        playbackStartBlock.render (engine);
        require (engine.isPlaybackRunning(), "MIDI playback did not start");
        require (engine.activeInstrument() == piano::Instrument::electricPiano,
                 "MIDI program change was not applied during playback");

        for (int i = 0; i < 5 && engine.isPlaybackRunning(); ++i)
        {
            StereoBlock playbackBlock (512);
            playbackBlock.render (engine);
        }
        require (! engine.isPlaybackRunning(), "MIDI playback did not stop at the sequence end");
        require (engine.currentSampleRate() == 44100.0, "sample rate was not published");

        engine.setMetronome (true, 120, 0.5f);
        StereoBlock metronomeBlock (2048);
        metronomeBlock.render (engine);
        require (metronomeBlock.absoluteEnergy() > 0.01, "metronome rendered silence");
        engine.setMetronome (false, 120, 0.5f);
        engine.releaseResources();

        piano::PianoEngine partialEngine;
        require (partialEngine.loadSoundFonts (argv[1], "missing-soft-piano.sf2", error),
                 "a missing optional SoundFont should not disable the working instruments");
        require (partialEngine.instrumentAvailable (piano::Instrument::grandPiano)
                 && ! partialEngine.instrumentAvailable (piano::Instrument::softPiano),
                 "partial SoundFont availability was not reported accurately");
        require (error.find ("unavailable") != std::string::npos,
                 "partial SoundFont failure did not provide a useful status message");

        piano::PianoEngine missingEngine;
        require (! missingEngine.loadSoundFonts ("missing-general-midi.sf2", "missing-soft-piano.sf2", error),
                 "engine accepted two missing SoundFonts");
        require (error.find ("Missing SoundFont") != std::string::npos,
                 "missing SoundFonts did not produce a readable diagnostic");

        std::cout << "PianoEngine sampled playback, four instrument mappings, sustain, MIDI sequence playback, "
                     "metronome output and missing-asset diagnostics passed.\n";
        return 0;
    }
    catch (const std::exception& exception)
    {
        std::cerr << "PianoEngine test failed: " << exception.what() << '\n';
        return 1;
    }
}
