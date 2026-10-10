/**
 * @file The public-API rule (PLAN.md §6.1, ADR-0020; doctrine: Quality under the hood): game code imports the engine
 * only through its barrels, `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code), and never three.js or
 * Rapier directly, so game agents never depend on, or need to read, the internals.
 *
 * Game code is `labs/` (the box's pages, scenes and cast) and `fixtures/scenes/`; `labs/hello/` is a harness page and
 * is exempt, and so are `*.test.ts` files. Sim-side game code (`labs/box/scenes/`, `labs/box/cast/`,
 * `fixtures/scenes/`) takes only `engine/sim-api.ts`, so `x sim` runs it in Node. Each report names the import it
 * refused: the barrel re-exports it under the same name, and when it does not, the barrel gains the re-export with its
 * doc comment.
 *
 * Invariants: written now, switched on by WP 1.6 once the barrels exist (`SWITCHES.publicApi` in eslint.config.js);
 * switched off, the blocks stay in place with the rule off.
 *
 * @example
 * // labs/box/scenes/room.ts: import { Vector3 } from '../../../engine/core/math';
 * // → public-api/no-restricted-imports: 'Vector3' import from … Import it from engine/sim-api.ts …
 * @see tools/eslint/publicApi.test.ts
 */
import type { Linter } from 'eslint';
import { family } from './family';
import { THREE_MATH } from './layers';

/** The plugin the public-API blocks use: core's `no-restricted-imports` as `public-api/no-restricted-imports`. */
export const publicApiPlugin = family('public-api', 'no-restricted-imports');

/** Sim-side game code: the sim barrel only. */
export const SIM_SIDE_GAME_CODE = ['labs/box/scenes/**', 'labs/box/cast/**', 'fixtures/scenes/**'];

const EVERY_NAME = '^';
const THREE = {
  regex: '^three(?:/|$)',
  importNamePattern: EVERY_NAME,
  message: `game code reaches three.js through the barrels: its math classes (${THREE_MATH.join(', ')}) from engine/sim-api.ts, AnimationClip and AnimationMixer from engine/index.ts; for anything else, the barrel gains a documented re-export (PLAN.md §6.1)`,
};
const RAPIER = {
  regex: '^@dimforge/',
  importNamePattern: EVERY_NAME,
  message:
    'game code reaches physics through engine/sim-api.ts (bodies, queries), never Rapier itself (PLAN.md §6.1, ADR-0020)',
};

/** The public-API blocks; `on` is `SWITCHES.publicApi` (WP 1.6 turns it on). */
export function publicApiBlocks(on: boolean): Linter.Config[] {
  const severity = on ? 'error' : 'off';
  const block = (name: string, files: string[], ignores: string[], allowed: string, where: string): Linter.Config => ({
    name,
    files,
    ignores: ['**/*.test.ts', ...ignores],
    plugins: { 'public-api': publicApiPlugin },
    rules: {
      'public-api/no-restricted-imports': [
        severity,
        {
          patterns: [
            {
              regex: `^(?:\\.\\./)+engine(?:/(?!(?:${allowed})(?:\\.ts)?$).*)?$`,
              importNamePattern: EVERY_NAME,
              caseSensitive: true,
              message: `${where}: import it from ${allowed === 'sim-api' ? 'engine/sim-api.ts' : 'engine/index.ts (pages) or engine/sim-api.ts (sim-side code)'} under the same name; if the barrel lacks it, add the re-export there with its doc comment (PLAN.md §6.1, ADR-0020)`,
            },
            { ...THREE, caseSensitive: true },
            { ...RAPIER, caseSensitive: true },
          ],
        },
      ],
    },
  });
  return [
    block(
      'public-api: game code',
      ['labs/**'],
      ['labs/hello/**'],
      'index|sim-api',
      'game code imports the engine only through its barrels',
    ),
    block(
      'public-api: sim-side game code',
      SIM_SIDE_GAME_CODE,
      [],
      'sim-api',
      'sim-side game code imports only the sim barrel, so x sim runs it in Node',
    ),
  ];
}
