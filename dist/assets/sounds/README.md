# Piano Pro sounds

Piano Pro generates its four instruments locally with a high-quality synthesizer
(additive piano, FM electric piano, Hammond-style organ, damped soft piano).

**No sample files are required.** The application works fully offline with an
empty `sounds/` folder.

## Optional sample files (future / advanced)

If you want to replace the built-in synth with your own legally redistributable
samples, place 16-bit PCM WAV files here using this layout:

```
assets/sounds/
  grand/A0.wav … C8.wav
  electric/
  organ/
  soft/
```

Sample loading is not required for a complete, working instrument. Do not
download sample packs automatically at runtime.
