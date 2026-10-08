// Host-side synth smoke test: writes a WAV of a C-major chord + EP + organ.
#include "../Source/Synth.h"
#include "../Source/Synth.cpp"
#include "../Source/RecordingManager.cpp"
#include <cstdio>
#include <vector>
#include <cstdint>

static void writeWav(const char* path, const std::vector<float>& stereo, int sr) {
    const int frames = (int)(stereo.size() / 2);
    std::vector<int16_t> pcm(stereo.size());
    for (size_t i = 0; i < stereo.size(); ++i) {
        float x = stereo[i];
        if (x > 1) x = 1;
        if (x < -1) x = -1;
        pcm[i] = (int16_t)(x * 32767);
    }
    FILE* f = fopen(path, "wb");
    if (!f) { perror(path); return; }
    uint32_t dataBytes = (uint32_t)(pcm.size() * 2);
    uint32_t riff = 36 + dataBytes;
    fwrite("RIFF", 1, 4, f);
    fwrite(&riff, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f);
    uint32_t fmtLen = 16;
    uint16_t fmt = 1, ch = 2, bits = 16, block = 4;
    uint32_t byterate = sr * 4;
    fwrite(&fmtLen, 4, 1, f);
    fwrite(&fmt, 2, 1, f);
    fwrite(&ch, 2, 1, f);
    fwrite(&sr, 4, 1, f);
    fwrite(&byterate, 4, 1, f);
    fwrite(&block, 2, 1, f);
    fwrite(&bits, 2, 1, f);
    fwrite("data", 1, 4, f);
    fwrite(&dataBytes, 4, 1, f);
    fwrite(pcm.data(), 2, pcm.size(), f);
    fclose(f);
}

int main() {
    Synth s;
    s.setSampleRate(44100);
    s.setMasterGain(0.85f);
    const int sr = 44100;
    const int total = sr * 4;
    std::vector<float> buf((size_t)total * 2, 0.f);

    s.setInstrument(0);
    s.noteOn(60, 0.9f);
    s.noteOn(64, 0.8f);
    s.noteOn(67, 0.8f);
    s.render(buf.data(), sr); // 1s hold
    s.noteOff(60); s.noteOff(64); s.noteOff(67);
    s.setSustain(true);
    s.noteOn(72, 0.7f);
    s.render(buf.data() + sr * 2, sr / 2);
    s.noteOff(72);
    s.setSustain(false);
    s.render(buf.data() + (sr + sr / 2) * 2, sr / 2);

    s.allNotesOff(true);
    s.setInstrument(1);
    s.noteOn(64, 0.85f);
    s.render(buf.data() + (2 * sr) * 2, sr / 2);
    s.noteOff(64);

    s.allNotesOff(true);
    s.setInstrument(2);
    s.noteOn(48, 0.8f);
    s.noteOn(55, 0.7f);
    s.noteOn(60, 0.7f);
    s.render(buf.data() + (int)(2.5 * sr) * 2, sr / 2);
    s.noteOff(48); s.noteOff(55); s.noteOff(60);

    s.allNotesOff(false);
    s.setInstrument(3);
    s.noteOn(57, 0.6f);
    s.render(buf.data() + 3 * sr * 2, sr);
    s.noteOff(57);

    writeWav("/tmp/pianopro_preview.wav", buf, sr);
    printf("wrote /tmp/pianopro_preview.wav  voices leftover=%d\n", s.activeVoices());

    RecordingManager rec;
    rec.start();
    rec.recordNoteOn(60, 100);
    rec.recordNoteOn(64, 90);
    rec.recordNoteOff(60);
    rec.recordNoteOff(64);
    rec.stop();
    std::wstring err;
    if (!rec.saveMidi(L"/tmp/pianopro_test.mid", 0, err)) {
        printf("midi save failed\n");
        return 1;
    }
    RecordingManager rec2;
    if (!rec2.loadMidi(L"/tmp/pianopro_test.mid", err)) {
        printf("midi load failed\n");
        return 1;
    }
    printf("midi roundtrip events=%d length=%u\n", rec2.eventCount(), rec2.lengthMs());
    return 0;
}
