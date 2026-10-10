/**
 * @file Proves eslint.config.js's own blocks with failing and passing fixtures linted from a temporary directory: the
 * `@file` comment, the 400-line warning and the 600-line hard cap, no enums, typescript-eslint's recommended rules and
 * the ignored directories; and that the switches live in one place.
 */
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../x';
import { caseProblems, lintCases, loadConfigModule, type Case, type CaseResult } from './testing';

const lines = (count: number) =>
  `/** @file Fixture. */\n${Array.from({ length: count - 1 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`;

const CASES: Case[] = [
  {
    name: 'every module under tools/ opens with a @file comment',
    file: 'tools/lib/a.ts',
    bad: '/** Not a file comment. */\nexport const a = 1;',
    good: '/**\n * @file What this module is for.\n */\nexport const a = 1;',
    rule: 'jsdoc/require-file-overview',
  },
  {
    name: 'every module under engine/ too, tests included',
    file: 'engine/core/a.test.ts',
    bad: '/** Unit tests for a, without the tag. */\nexport const a = 1;',
    good: '/** @file Unit tests for a. */\nexport const a = 1;',
    rule: 'jsdoc/require-file-overview',
  },
  {
    name: 'a file over 400 lines is a warning',
    file: 'labs/box/long.ts',
    bad: lines(401),
    good: lines(400),
    rule: 'max-lines',
    severity: 1,
  },
  {
    name: 'a file over 600 lines is an error',
    file: 'tests/unit/long.ts',
    bad: lines(601),
    goodFile: 'scripts/long.ts',
    good: lines(601),
    rule: 'hard-cap/max-lines',
  },
  {
    name: 'no enums',
    file: 'tools/lib/kinds.ts',
    bad: "export enum Kind { Move = 'move' }",
    good: "export const Kind = { Move: 'move' } as const;\nexport type Kind = (typeof Kind)[keyof typeof Kind];",
    rule: 'no-restricted-syntax',
  },
  {
    name: "typescript-eslint's recommended rules",
    file: 'tools/lib/loose.ts',
    bad: 'export const parse = (text: string): any => JSON.parse(text);',
    good: 'export const parse = (text: string): unknown => JSON.parse(text);',
    rule: '@typescript-eslint/no-explicit-any',
  },
  {
    name: 'an underscore marks a name unused on purpose',
    file: 'tools/lib/unused.ts',
    bad: 'export const f = (used: number, unused: number) => { const extra = 1; return used; };',
    good: 'export const f = (used: number, _unused: number) => { const { a: _a, ...rest } = { a: 1, b: 2 }; return [used, rest]; };',
    rule: '@typescript-eslint/no-unused-vars',
  },
];

let results: CaseResult[];
beforeAll(async () => {
  results = await lintCases(CASES);
}, 60_000);

describe("eslint.config.js's own blocks", () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('ignores build output, test results and the source checkouts', async () => {
    const { default: config } = await loadConfigModule();
    const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: config });
    for (const path of ['out/x/a.ts', 'dist/a.js', '.cache/src-3d2dge/a.js', 'test-results/a.ts']) {
      expect(await eslint.isPathIgnored(join(ROOT, path)), path).toBe(true);
    }
    expect(await eslint.isPathIgnored(join(ROOT, 'tools/x.ts'))).toBe(false);
  });
});

describe('the switches', () => {
  it('are one object, each naming the WP that turns it on, and the default config uses them', async () => {
    const { SWITCHES, configure, default: config } = await loadConfigModule();
    expect(Object.keys(SWITCHES).sort()).toEqual(['askTheEntry', 'publicApi']);
    expect(config).toEqual(configure(SWITCHES));
  });
});
