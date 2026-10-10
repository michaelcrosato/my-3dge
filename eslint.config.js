/**
 * @file ESLint's settings for T0 (PLAN.md §6.10; `npm run lint`, inside `npm run check`): typescript-eslint's
 * recommended rules without type information (so T0 stays fast), the file-comment and size rules, then the doctrine's
 * rule families from tools/eslint/, one block per family, each message naming the fix.
 *
 * Families, in order: the layer rules (layers.ts), the public-API rule (publicApi.ts), the reproducibility bans for
 * sim-side code (simSide.ts), the banned three.js APIs (banned.ts) and the local rule "ask the entry, never the id"
 * (askTheEntry.ts). Each family's rule ids carry its name (`layer/no-restricted-imports`, `sim/no-restricted-globals`,
 * `banned/no-restricted-syntax`, `local/ask-the-entry`); tools/eslint/family.ts says why.
 *
 * Invariants: rules written ahead of the code they guard are switched in `SWITCHES` and nowhere else. The cache lives
 * in node_modules/.cache/eslint/ (package.json's scripts). Tests lint fixtures with `configure(…)` from a temporary
 * directory (tools/eslint/testing.ts).
 *
 * @example
 * // npm run lint  → eslint --cache --cache-location node_modules/.cache/eslint/ .
 * @see tools/eslint/index.ts
 */
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import { tsImport } from 'tsx/esm/api';
import tseslint from 'typescript-eslint';

/** The families are TypeScript under tools/eslint/; tsx loads them, as x.js loads the x commands. */
const families = await tsImport('./tools/eslint/index.ts', import.meta.url);

/** Rules written ahead of the code they guard. The WP named flips its switch to true, here and only here. */
export const SWITCHES = {
  /** Game code imports only engine/index.ts and engine/sim-api.ts (tools/eslint/publicApi.ts). WP 1.6 turns it on. */
  publicApi: false,
  /** "Ask the entry, never the id" (tools/eslint/askTheEntry.ts). WP 1.2 turns it on, with the registry. */
  askTheEntry: false,
};

/** Code under these directories opens with a `@file` comment and stays under 400 lines (hard cap 600). */
const AGENT_READABLE = [
  'engine/**/*.{ts,js,mjs}',
  'tools/**/*.{ts,js,mjs}',
  'labs/**/*.{ts,js,mjs}',
  'tests/**/*.{ts,js,mjs}',
];

/** Builds the whole config; `switches` defaults to `SWITCHES` (tests turn every switch on). */
export function configure(switches = SWITCHES) {
  return [
    { name: 'ignores', ignores: ['out/**', 'dist/**', '.cache/**', 'test-results/**'] },
    ...tseslint.configs.recommended,
    {
      name: 'typescript: unused names',
      rules: {
        // The usual exceptions: a leading underscore marks a name unused on purpose; `{ dropped, ...rest }` omits a key.
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
          },
        ],
      },
    },
    { name: 'globals', languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    {
      name: 'agent-readable: file comments and size (PLAN.md §6.8)',
      files: AGENT_READABLE,
      plugins: { jsdoc, 'hard-cap': families.family('hard-cap', 'max-lines') },
      rules: {
        'jsdoc/require-file-overview': 'error',
        'max-lines': ['warn', { max: 400 }],
        'hard-cap/max-lines': ['error', { max: 600 }],
      },
    },
    {
      name: 'no enums (erasableSyntaxOnly)',
      files: ['**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSEnumDeclaration',
            message: 'no enums (erasableSyntaxOnly): use an `as const` object and a union of its values (ADR-0003)',
          },
        ],
      },
    },
    ...families.layerBlocks(),
    ...families.publicApiBlocks(switches.publicApi),
    ...families.simSideBlocks(),
    ...families.bannedBlocks(),
    ...families.askTheEntryBlocks(switches.askTheEntry),
  ];
}

export default configure();
