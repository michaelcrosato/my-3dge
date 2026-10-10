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
 * `requestIdleCallback`, `crypto`, `process`, Node's `Buffer`, `location` and Web Storage, all of `performance`
 * (`timeOrigin` is a wall-clock timestamp), `globalThis.Date`, `self['Date']` and `const { Date } = globalThis`, and
 * Node built-ins with or without `node:` (sim-side code runs in Chromium as well). Dynamic `import()` is banned
 * outright, whatever its source: it resolves at a wall-clock moment, and no import rule (layer, three.js, Node) sees
 * it. No swap reaches an operator or an alias, so `**` and `**=` are banned (write `Math.pow`), and so are `Math`
 * destructured and a swapped function (engine/core/simMath.ts's `SIM_MATH_NAMES`) held in a variable (ADR-0006
 * amendment 1).
 *
 * @example
 * // engine/sim/spawn.ts: const roll = Math.random();
 * // → sim/no-restricted-properties: use a named seeded stream: rng('<stream>') …
 * @see tools/eslint/simSide.test.ts
 */
import { builtinModules } from 'node:module';
import type { ESLint, Linter } from 'eslint';
import { SIM_MATH_NAMES } from '../../engine/core/simMath';
import { family } from './family';

/** The plugin the sim-side blocks use: core's restriction rules as `sim/<rule>`. */
export const simPlugin: ESLint.Plugin = family(
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
  Buffer: NODE,
  performance: CLOCK,
};

/** Where code reaches a global by name: `globalThis.Date`, `self['Date']`, `const { Date } = globalThis`. */
const HOSTS = '/^(globalThis|self|global)$/';
const ALIAS = `call Math.${SIM_MATH_NAMES.join('/')} where you use them: an alias, or a name destructured from Math, holds the native function and escapes the sim's fdlibm swap (PLAN.md §6.5)`;
const DYNAMIC =
  'sim-side code imports statically: a dynamic import() resolves at a wall-clock moment and escapes the layer, three.js and Node import rules; import the module at the top of the file, or load it outside the sim and pass it in (PLAN.md §6.5)';

/** The three.js entry points, banned sim-side (core/math.ts aside). */
const THREE =
  "sim-side code never imports three.js: take its math classes from engine/core/math (engine code) or engine/sim-api (game code); drawing is gfx/'s (PLAN.md §6.5)";

const THREE_ENTRY = { regex: '^three(?:/|$)', caseSensitive: true, message: THREE };
const NODE_PREFIX = { regex: '^node:', caseSensitive: true, message: NODE };

/** A `sim/no-restricted-imports` block: every Node built-in by its bare name, then `patterns`. */
function imports(name: string, files: string[], patterns: object[]): Linter.Config {
  const paths = builtinModules
    .filter((module) => !module.startsWith('node:'))
    .map((module) => ({ name: module, message: NODE }));
  return {
    name,
    files,
    ignores: ['**/*.test.ts'],
    plugins: { sim: simPlugin },
    rules: { 'sim/no-restricted-imports': ['error', { paths, patterns }] },
  };
}

/** The sim-side blocks: globals, properties and syntax over all sim-side files, then imports (core/math.ts last). */
export function simSideBlocks(): Linter.Config[] {
  const banned = `/^(${Object.keys(GLOBALS).join('|')})$/`;
  const named = (node: string) => `:matches([${node}.name=${banned}], [${node}.value=${banned}])`;
  const viaHost = [
    `MemberExpression[object.name=${HOSTS}]${named('property')}`,
    `MemberExpression[object.name=${HOSTS}] > TemplateLiteral.property[expressions.length=0][quasis.0.value.cooked=${banned}]`,
    `:matches(VariableDeclarator[init.name=${HOSTS}], AssignmentExpression[right.name=${HOSTS}]) > ObjectPattern > Property${named('key')}`,
  ].join(', ');
  const swapped = `/^(${SIM_MATH_NAMES.join('|')})$/`;
  const mathFunction = `MemberExpression[object.name='Math']:matches([property.name=${swapped}], [property.value=${swapped}])`;
  const alias = [
    `:matches(VariableDeclarator[init.name='Math'], AssignmentExpression[right.name='Math']) > ObjectPattern`,
    `VariableDeclarator > ${mathFunction}.init`,
    `AssignmentExpression > ${mathFunction}.right`,
  ].join(', ');
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
        'sim/no-restricted-properties': ['error', { object: 'Math', property: 'random', message: RANDOM }],
        'sim/no-restricted-syntax': [
          'error',
          {
            selector: viaHost,
            message:
              "a banned global reached through globalThis, self or global is still banned: sim-side code reads no clock, schedules nothing by wall time, touches no DOM or Web Audio, and draws randomness only from named streams, rng('<stream>') (PLAN.md §6.5)",
          },
          { selector: 'ImportExpression', message: DYNAMIC },
          { selector: alias, message: ALIAS },
          {
            selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
            message:
              'write Math.pow in sim-side code: the sim swaps an fdlibm pow into Math while it steps, and ** escapes it (PLAN.md §6.5)',
          },
        ],
      },
    },
    imports('sim: three.js and Node built-ins', SIM_SIDE, [THREE_ENTRY, NODE_PREFIX]),
    imports('sim: Node built-ins in core/math.ts, which takes three.js', ['engine/core/math.ts'], [NODE_PREFIX]),
  ];
}
