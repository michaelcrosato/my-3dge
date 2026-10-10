# ADR-0013: Audio: pure DSP, Web Audio for playback

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, Phase 9

## Decision
- Sounds are pure DSP from data into seeded, hashed `Float32Array`s.
- Web Audio plays them, spatial sound included.
- `OfflineAudioContext` is used only for smoke tests.

## Why
Doctrines Assets and Verifiable: no sound files, and every sound renders and checks headless in Node by its hash.

## Enforced by
The DSP tests and hashes (WP 9.1); the asset scan.

## Amendment 1 (2026-10-10, WP-9.2)
- **Sound data is two registry kinds.** `sfx`: voices, layers `{sfx, at, vol, pitch}`, variants with `vary`, and
  `bus` (`effects`, `ui` or `ambience`). `song`: bpm, steps per beat, beats per bar, loop, `kit` (token to sfx id), and
  tracks in tracker notation (wave, vol, octave, gate, attack, vib, intensity).
- **Variants replace per-play detune.** Each engine effect has 4 rendered variants, replacing the source's random ±3%
  detune on every play. Variant 0 is the sound as written; variant k uses seed `derive(seed, 'variant', k)` and a
  pitch spread over 1 ± `vary`. A pitch ratio scales every frequency of a voice but never its timing.
- **Drums are sfx entries**; `noise` tracks are refused (use drums). A song renders at least one pass long.
- **Track length** must fill whole bars or divide a bar, and must divide the song length.
- **Public names** are exported from `engine/index.ts`: the layer rule for `engine/sim-api.ts` does not allow
  `audio/data`. `audio/data` is sim-side (`tools/eslint/simSide.ts`) and its own layer (may: core and audio/dsp).
- **Size** came out M, not S.
- Evidence: `engine/audio/data/sounds.test.ts` (33 effects x 4 variants, 6 drums, 5 songs, 44 goldens, linux-x64),
  `sfx.test.ts`, `song.test.ts`. Clipping, DC and duration checks: deferred to WP 9.4.
