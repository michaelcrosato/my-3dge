/**
 * @file The fixture sounds (PLAN.md WP 9.2): a small neutral set of effects and one demo song for the audio tests
 * (the runtime of WP 9.3, the audio tools and QA of WP 9.4), so they test against sounds whose numbers are known and
 * that never change with the engine's own effects and songs.
 *
 * - `sfx:fixtureTone`: a steady 441 Hz sine at 0.5 for 0.5 s (full level from 4 ms to 30 ms before the end);
 * - `sfx:fixtureNoise`: 0.25 s of low-passed white noise, its peak gain 0.4;
 * - `sfx:fixtureChord`: a layered effect, the tone at ratios 1, 1.25 and 1.5 (441, 551.25 and 661.5 Hz), each at
 *   half gain;
 * - `sfx:fixtureBlip`: a 330 Hz triangle blip with four variants spread ±5% in pitch;
 * - `song:fixtureDemo`: two bars at 120 bpm (4 s): a square melody and a triangle bass always, drums from intensity
 *   0.25, a plucked arpeggio from 0.5.
 *
 * Invariants: nothing is defined on import, so the engine's registry and its QA never see these. `defineFixtureSounds`
 * defines the set once on a registry, usually a test's own from `createRegistry` (twice throws `CORE_DUPLICATE_ID`).
 *
 * @example
 * import { createRegistry } from '../../engine/core/registry';
 * import { renderSfx } from '../../engine';
 * const registry = createRegistry();
 * defineFixtureSounds(registry);
 * renderSfx('sfx:fixtureTone', { registry }).length; // 22050: 0.5 s at 44,100 Hz
 * @see fixtures/sounds/index.test.ts
 */
import { defineSfx, defineSong, type SfxSpec, type SongSpec } from '../../engine';
import type { Registry } from '../../engine/core/registry';

/** The fixture effects by id. */
export const FIXTURE_SFX: Readonly<Record<string, SfxSpec>> = {
  'sfx:fixtureTone': { voices: { wave: 'sine', freq: 441, dur: 0.5, vol: 0.5, hold: true } },
  'sfx:fixtureNoise': { voices: { wave: 'noise', freq: 2000, dur: 0.25, vol: 0.4, filter: 'lowpass' } },
  'sfx:fixtureChord': {
    layers: [
      { sfx: 'sfx:fixtureTone', vol: 0.5 },
      { sfx: 'sfx:fixtureTone', vol: 0.5, pitch: 1.25 },
      { sfx: 'sfx:fixtureTone', vol: 0.5, pitch: 1.5 },
    ],
  },
  'sfx:fixtureBlip': { voices: { wave: 'triangle', freq: 330, dur: 0.2, vol: 0.4 }, variants: 4, vary: 0.05 },
};

/** The demo song: two bars of C major at 120 bpm, its tracks joining as the intensity rises. */
export const FIXTURE_SONG: SongSpec = {
  bpm: 120,
  tracks: [
    {
      wave: 'square',
      vol: 0.12,
      notes: 'C5 - E5 - G5 - E5 - D5 - F5 - A5 - G5 - | E5 - - - D5 - - - C5 - - - - - . .',
    },
    { wave: 'triangle', vol: 0.25, notes: 'C3 - - - G2 - - - C3 - - - G2 - - - | C3 - - - G2 - - - C3 - - - . . . .' },
    { wave: 'drums', vol: 0.12, intensity: 0.25, notes: 'k . h . s . h . k . h . s . h h' },
    { wave: 'pluck', vol: 0.15, intensity: 0.5, notes: 'C4 E4 G4 C5 B3 D4 G4 B4' },
  ],
};

/** Defines the fixture sounds on `registry` and returns their ids. */
export function defineFixtureSounds(registry: Registry): string[] {
  for (const [id, spec] of Object.entries(FIXTURE_SFX)) defineSfx(id, spec, registry);
  defineSong('song:fixtureDemo', FIXTURE_SONG, registry);
  return [...Object.keys(FIXTURE_SFX), 'song:fixtureDemo'];
}
