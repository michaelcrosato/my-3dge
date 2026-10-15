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

## Amendment 2 (2026-10-12, WP-9.5)
- **A page's own presentation each frame.** Core change, app: `createEngine({ onFrame })` is called once per drawn
  frame, after the draw and the damage numbers, with `EngineFrame { world: FrameWorld (tick, hz, get, query,
  events.trace), scene, camera: CameraPose, queries: read-only QueryView in a physics scene else null, dt }`.
  `EngineFrame`, `FrameWorld` and `CameraPose` are appended to `engine/index.ts`. The page reads, never writes, so
  hashes are unchanged (parity and box suites green).
- **The box's sound comes from its sim events.** Box sound events are a pure page-side map of the box's sim events
  (`labs/box/sounds/events.ts`), not sfx payloads in the sim, so scenes and engine events are untouched. A replay's
  timeline is read after every step and hashed (FNV-1a 64 over JSON). One golden for Node and Chromium: box-5-fight,
  81 sounds, `8da39df56b106f5f` (now 77 sounds, `288bca340783f86f`: amendment 3). "Launches" means bolts launched (shot).
- **Plan edit:** WP-9.5's Owns adds `engine/app/engine.ts`, `engine/index.ts` (append), `labs/box/main.ts` (wiring),
  `tests/pages/box-audio.{html,ts}` and `tests/pages/boxAudioTimeline.ts`. Size came out M, not S.

## Amendment 3 (2026-10-14, after G9, WPs 9.4 and 9.5): the box's sounds heard in Node
- **Reverses amendment 2's call that the box's map stays page-side.** A scene may say which sound each traced sim
  event plays: `sounds(record, w)`, a field of the kind `scene` (engine/sim/scene.ts), `{ sfx, vol?, variant? }` or
  null, by default `payloadSound` (the event payload's own `sfx`, what `x audio` read before). `x audio --replay`
  asks the replay's scene for it, so it hears what a game's page plays. labs/box/sounds/events.ts imports
  engine/sim-api.ts only, is sim-side (tools/eslint/simSide.ts) and exports `boxSounds(level)`; each box scene sets
  `sounds: boxSounds(<its level>)` (the room's: `null`, its events play nothing).
- **One stepping loop.** `x audio` plays through engine/app/playback.ts's `createPlayback` and reads the events after
  setup and after each step, as the page's timeline does (tests/pages/boxAudioTimeline.ts); its copy of the loop is
  gone.
- **A finding, fixed.** Heard at last, the fight's worst moment (a sweep's four hits and a death together, 9.3 s
  into box-5-fight) peaked at 1.54 in `x audio`'s unspatialized mix; the runtime has no limiter, so it could clip in
  the page too. A hit's gain is now at most 0.5 (labs/box/sounds/events.ts): the peak is 0.80 (−2 dBFS).
  `FIGHT_TIMELINE` re-recorded with that reason: 77 sounds, `288bca340783f86f`.
- **Measured:** fight-1000 delivers at most 83 events in one step over its 600 steps, under the 256-record trace;
  neither reader missed one.
- Evidence: `tools/cmd/audio.test.ts` (the fight's 77 sounds, step, effect and gain, equal to the page's timeline),
  `labs/box/sounds/events.test.ts`, `tests/e2e/box-audio.spec.ts`.
