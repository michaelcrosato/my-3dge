/**
 * @file The reproducibility bans for sim-side code (PLAN.md §6.5, Appendix B; doctrine: Reproducible): no clocks, no
 * unseeded randomness, no DOM, no Web Audio, no three.js, so identical inputs and seeds give identical play in Node
 * and in Chromium.
 *
 * Sim-side means `engine/{core,sim,physics,anim,world}`, `engine/input/intents.ts`, `engine/audio/dsp`,
 * `engine/dev/bot.ts`, the box's scenes and cast, and the fixture scenes; `*.test.ts` files are exempt. The standard
 * `Math` stays allowed, `Math.sin` and `Math.cos` included: the sim swaps in fdlibm ports while it steps (§6.5).
 * `core/math.ts` alone imports three.js, for its math classes (layers.ts limits it to them).
 *
 * Beyond Appendix B's list, the same holes in other spellings are closed too: `setImmediate`,
 * `requestIdleCallback`, `crypto`, `process`, `location` and Web Storage, `globalThis.Date` and the like, and Node
 * built-ins (sim-side code runs in Chromium as well).
 *
 * @example
 * // engine/sim/spawn.ts: const roll = Math.random();
 * // → sim/no-restricted-properties: use a named seeded stream: rng('<stream>') …
 * @see tools/eslint/simSide.test.ts
 */
import type { Linter } from 'eslint';
import { family } from './family';

/** The plugin the sim-side blocks use: core's restriction rules as `sim/<rule>`. */
export const simPlugin = family(
  'sim',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-syntax',
  'no-restricted-imports',
);

/** Sim-side code: reproducible and renderer-free (PLAN.md §3, "Terms used throughout"). */
export const SIM_SIDE = [
  'engine/core/**',
  'engine/sim/**',
  'engine/physics/**',
  'engine/anim/**',
  'engine/world/**',
  'engine/input/intents.ts',
  'engine/audio/dsp/**',
  'engine/dev/bot.ts',
  'labs/box/scenes/**',
  'labs/box/cast/**',
  'fixtures/scenes/**',
];

const CLOCK =
  'sim-side code never reads the clock: time is the step count (60 Hz sim ticks; core/time). Take a wall-clock timestamp outside the sim and pass it in as an intent (PLAN.md §6.5)';
const TIMER =
  'sim-side code never schedules by wall time: keep a tick count in sim state and act in the system that steps it (PLAN.md §6.5)';
const DOM =
  'sim-side code never touches the DOM: what it needs from outside arrives as recorded intents, and settings come from the schema (PLAN.md §6.5)';
const AUDIO = 'sim-side code never touches Web Audio: emit an event, and audio/runtime plays it (PLAN.md §6.5)';
const RANDOM =
  "use a named seeded stream: rng('<stream>') or rng.entity(id, '<stream>'), derived from the scene seed (PLAN.md §6.5)";
const NODE =
  'sim-side code runs in Node and in Chromium alike: no process or Node built-ins; settings come from the schema (PLAN.md §6.5)';

/** Banned globals, each with its fix. */
const GLOBALS: Record<string, string> = {
  Date: CLOCK,
  setTimeout: TIMER,
  setInterval: TIMER,
  setImmediate: TIMER,
  requestAnimationFrame: TIMER,
  requestIdleCallback: TIMER,
  document: DOM,
  window: DOM,
  navigator: DOM,
  location: DOM,
  localStorage: DOM,
  sessionStorage: DOM,
  AudioContext: AUDIO,
  OfflineAudioContext: AUDIO,
  webkitAudioContext: AUDIO,
  crypto: RANDOM,
  process: NODE,
};

/** The three.js entry points, banned sim-side (core/math.ts aside). */
const THREE =
  "sim-side code never imports three.js: take its math classes from engine/core/math (engine code) or engine/sim-api (game code); drawing is gfx/'s (PLAN.md §6.5)";

/** The sim-side blocks: globals, properties and syntax over all sim-side files, then imports (core/math.ts aside). */
export function simSideBlocks(): Linter.Config[] {
  const names = [...Object.keys(GLOBALS), 'performance'].join('|');
  return [
    {
      name: 'sim: clocks, randomness, DOM, Web Audio',
      files: SIM_SIDE,
      ignores: ['**/*.test.ts'],
      plugins: { sim: simPlugin },
      rules: {
        'sim/no-restricted-globals': [
          'error',
          ...Object.entries(GLOBALS).map(([name, message]) => ({ name, message })),
        ],
        'sim/no-restricted-properties': [
          'error',
          { object: 'Math', property: 'random', message: RANDOM },
          { object: 'performance', property: 'now', message: CLOCK },
        ],
        'sim/no-restricted-syntax': [
          'error',
          {
            selector: `MemberExpression[object.name=/^(globalThis|self|global)$/][property.name=/^(${names})$/]`,
            message:
              "a banned global reached through globalThis, self or global is still banned: sim-side code reads no clock, schedules nothing by wall time, touches no DOM or Web Audio, and draws randomness only from named streams, rng('<stream>') (PLAN.md §6.5)",
          },
        ],
      },
    },
    {
      name: 'sim: three.js and Node built-ins',
      files: SIM_SIDE,
      ignores: ['**/*.test.ts', 'engine/core/math.ts'],
      plugins: { sim: simPlugin },
      rules: {
        'sim/no-restricted-imports': [
          'error',
          {
            patterns: [
              { regex: '^three(?:/|$)', caseSensitive: true, message: THREE },
              { regex: '^node:', caseSensitive: true, message: NODE },
            ],
          },
        ],
      },
    },
  ];
}
