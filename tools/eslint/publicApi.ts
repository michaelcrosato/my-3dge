/**
 * @file The public-API rule (PLAN.md §6.1, ADR-0020; doctrine: Quality under the hood): game code imports the engine
 * only through its barrels, `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code), and never three.js or
 * Rapier directly, so game agents never depend on, or need to read, the internals.
 *
 * Game code is `labs/` (the box's pages, scenes and cast) and `fixtures/scenes/`; `labs/hello/` is a harness page and
 * is exempt, and so are `*.test.ts` files. Sim-side game code (`labs/box/scenes/`, `labs/box/cast/`,
 * `fixtures/scenes/`) takes only `engine/sim-api.ts`, so `x sim` runs it in Node. Each report names the import it
 * refused: the barrel re-exports it under the same name, and when it does not, the barrel gains the re-export with its
 * doc comment. Relative sources are matched as resolved from the importing file (`resolvingImports`, family.ts).
 * Side-effect imports (`import 'three/webgpu'`), dynamic ones (`import('…')` with a literal source) and TS import
 * types (`type W = import('…').World`, `typeof import('…')`) never reach `no-restricted-imports`, so
 * `public-api/no-unnamed-imports` refuses them with the same messages, its relative sources resolved the same way
 * (`./../../engine/core/x` is `../../engine/core/x`). Pages may name the page barrel by its folder (`'../../engine'`
 * is engine/index.ts); sim-side game code may not.
 *
 * Invariants: switched on by WP 1.6 with the barrels (`SWITCHES.publicApi` in eslint.config.js); switched off, the
 * blocks stay in place with both rules off.
 *
 * @example
 * // labs/box/scenes/room.ts: import { Vector3 } from '../../../engine/core/math';
 * // → public-api/no-restricted-imports: 'Vector3' import from … Import it from engine/sim-api.ts …
 * @see tools/eslint/publicApi.test.ts
 */
import { posix } from 'node:path';
import type { ESLint, Linter, Rule } from 'eslint';
import { family, resolvingImports, shortest } from './family';
import { THREE_MATH } from './layers';

/** A restriction: a regular expression over the import source (relative ones resolved) and the fix. */
interface SourcePattern {
  regex: string;
  message: string;
}

/**
 * `public-api/no-unnamed-imports`: side-effect imports, dynamic imports with a literal source and TS import types,
 * matched like `no-restricted-imports` matches named ones (options `{ patterns: [{ regex, message }] }`).
 */
export const unnamedImports: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Side-effect, dynamic and TS-import-type imports of what game code may not import (PLAN.md §6.1)',
    },
    schema: [{ type: 'object', properties: { patterns: { type: 'array' } }, additionalProperties: false }],
  },
  create(context) {
    const { patterns = [] } = (context.options[0] ?? {}) as { patterns?: SourcePattern[] };
    const compiled = patterns.map(({ regex, message }) => ({ regex: new RegExp(regex, 'u'), message }));
    const dir = posix.dirname(context.filename);
    const check = (node: Rule.Node, source: unknown, how = 'imports no name') => {
      if (typeof source !== 'string') return;
      const spelled = /^\.\.?(?:\/|$)/.test(source) ? shortest(dir, source) : source;
      const hit = compiled.find((pattern) => pattern.regex.test(spelled));
      if (hit) context.report({ node, message: `'${source}' ${how}: ${hit.message}` });
    };
    return {
      ImportDeclaration(node) {
        if (node.specifiers.length === 0) check(node, node.source.value);
      },
      ImportExpression(node) {
        const source = node.source;
        if (source.type === 'Literal') check(node, source.value);
        else if (source.type === 'TemplateLiteral' && source.expressions.length === 0) {
          check(node, source.quasis[0].value.cooked);
        }
      },
      // typescript-eslint's node: `source` is the literal (`argument.literal`, deprecated, warns when read).
      TSImportType(node: Rule.Node) {
        check(node, (node as unknown as { source?: { value?: unknown } }).source?.value, 'is an import type');
      },
    } as Rule.RuleListener;
  },
};

/** The plugin the public-API blocks use: core's `no-restricted-imports` (resolving) and `no-unnamed-imports`. */
export const publicApiPlugin: ESLint.Plugin = {
  ...resolvingImports(family('public-api', 'no-restricted-imports')),
  rules: {
    ...resolvingImports(family('public-api', 'no-restricted-imports')).rules,
    'no-unnamed-imports': unnamedImports,
  },
};

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

/** The public-API blocks; `on` is `SWITCHES.publicApi` (on since WP 1.6). */
export function publicApiBlocks(on: boolean): Linter.Config[] {
  const severity = on ? 'error' : 'off';
  const block = (name: string, files: string[], ignores: string[], allowed: string, where: string): Linter.Config => {
    const internal = `(?:/(?!(?:${allowed})(?:\\.ts)?$).*)`; // a path under engine/ other than an allowed barrel
    const folder = allowed.split('|').includes('index'); // `engine` alone is engine/index.ts: refused unless allowed
    const patterns = [
      {
        regex: `^(?:\\.\\./)+engine${internal}${folder ? '' : '?'}$`,
        importNamePattern: EVERY_NAME,
        caseSensitive: true,
        message: `${where}: import it from ${allowed === 'sim-api' ? 'engine/sim-api.ts' : 'engine/index.ts (pages) or engine/sim-api.ts (sim-side code)'} under the same name; if the barrel lacks it, add the re-export there with its doc comment (PLAN.md §6.1, ADR-0020)`,
      },
      { ...THREE, caseSensitive: true },
      { ...RAPIER, caseSensitive: true },
    ];
    return {
      name,
      files,
      ignores: ['**/*.test.ts', ...ignores],
      plugins: { 'public-api': publicApiPlugin },
      rules: {
        'public-api/no-restricted-imports': [severity, { patterns }],
        'public-api/no-unnamed-imports': [
          severity,
          { patterns: patterns.map(({ regex, message }) => ({ regex, message })) },
        ],
      },
    };
  };
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
