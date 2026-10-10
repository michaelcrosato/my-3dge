/**
 * @file The local ESLint plugin and the rule families eslint.config.js assembles (PLAN.md §6.1, §6.5, §6.10,
 * Appendix B): one module per family, each exporting its blocks, and `local`, the plugin for what no stock rule
 * expresses.
 *
 * Families: layers.ts (the layer rules), publicApi.ts (game code sees only the barrels), simSide.ts (the
 * reproducibility bans), banned.ts (Appendix B's three.js bans, with namespaceNames.ts for names read off a
 * namespace), and the local rule askTheEntry.ts. family.ts holds the plumbing: core rules aliased under each
 * family's name, so no family replaces another's options.
 *
 * Invariants: eslint.config.js loads this module through tsx (as x.js loads the `x` commands), so these files are
 * TypeScript checked by tsc; a rule written ahead of its code is switched in eslint.config.js's `SWITCHES` only.
 *
 * @example
 * const blocks = [...layerBlocks(), ...simSideBlocks(), ...askTheEntryBlocks(true)];
 * @see eslint.config.js
 */
import type { ESLint, Linter } from 'eslint';
import askTheEntry from './askTheEntry';

export { bannedBlocks } from './banned';
export { family } from './family';
export { layerBlocks } from './layers';
export { publicApiBlocks } from './publicApi';
export { simSideBlocks } from './simSide';

/** The local plugin: rules no stock rule expresses, as `local/<rule>`. */
export const local: ESLint.Plugin = { meta: { name: 'local' }, rules: { 'ask-the-entry': askTheEntry } };

/** The "ask the entry, never the id" block over shared code; `on` is `SWITCHES.askTheEntry` (WP 1.2 turns it on). */
export function askTheEntryBlocks(on: boolean): Linter.Config[] {
  return [
    {
      name: 'local: ask the entry, never the id',
      files: ['engine/**'],
      ignores: ['**/*.test.ts'],
      plugins: { local },
      rules: { 'local/ask-the-entry': on ? 'error' : 'off' },
    },
  ];
}
