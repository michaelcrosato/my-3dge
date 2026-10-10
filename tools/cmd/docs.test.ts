/**
 * @file Tests `x docs` (WP 0.6) on fixture repositories written to temporary directories, never committed: a broken
 * example, a stale INDEX and a missing path each fail; so do undocumented exports, a long PROGRESS.md, bad codes and
 * bad citations. The last tests cover the `x check` plugin: drift checks without the examples, a warning in lanes.
 * @see tools/cmd/docs.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readModule } from '../lib/docs';
import { compileExample } from '../lib/docsExamples';
import { expand, isPlanned, readPlanned, type Planned } from '../lib/docsPaths';
import type { Finding } from '../lib/report';
import { ROOT, UsageError } from '../x';
import { discoverPlugins } from './check';
import { check, createDocsCommand } from './docs';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const MODULE = `/**
 * @file Adds numbers, for the docs fixtures.
 *
 * @example
 * add(1, 2); // 3
 */

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}
`;

/** Writes a fixture repository: a module, a short PROGRESS.md, package.json, plus \`files\`. */
function repo(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'docs-')));
  made.push(root);
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { check: 'true' } }),
    'docs/PROGRESS.md': '# Progress\n\nAll fine.\n',
    'engine/core/add.ts': MODULE,
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const NO_PLAN: Planned = { owned: [], layout: [] };

async function docs(root: string, mode: 'check' | 'write', sources: Record<string, string | undefined> = {}) {
  return createDocsCommand({ sources, planned: NO_PLAN }).run({ values: { [mode]: true }, positionals: [], root });
}

const ids = (findings: Finding[] = []) => findings.map((finding) => finding.id);

describe('x docs on fixture repositories', () => {
  it('passes a documented repository once --write has generated INDEX, API and ERRORS', async () => {
    const root = repo();
    expect(ids((await docs(root, 'check')).failures)).toContain('DOCS_STALE');
    const write = await docs(root, 'write');
    expect(write.lines?.[0]).toBe('wrote docs/INDEX.md, docs/API.md, docs/ERRORS.md');
    const check = await docs(root, 'check');
    expect(check.failures).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.metrics).toMatchObject({ modules: 1, exports: 1, 'examples.ran': 1, stale: 0 });
    const index = readFileSync(join(root, 'docs/INDEX.md'), 'utf8');
    expect(index).toContain('## engine/core');
    expect(index).toContain('Adds numbers, for the docs fixtures.');
    expect(readFileSync(join(root, 'docs/API.md'), 'utf8')).toContain('- `add` (function): Adds two numbers.');
  });

  it('fails a broken example', async () => {
    const root = repo({ 'engine/core/add.ts': MODULE.replace('add(1, 2); // 3', 'addd(1, 2);') });
    await docs(root, 'write');
    const check = await docs(root, 'check');
    expect(check.ok).toBe(false);
    expect(check.failures).toEqual([
      expect.objectContaining({
        id: 'DOCS_EXAMPLE',
        file: 'engine/core/add.ts',
        line: 4,
        message: expect.stringContaining('addd is not defined'),
      }),
    ]);
  });

  it('fails a stale INDEX', async () => {
    const root = repo();
    await docs(root, 'write');
    const renamed = MODULE.replace('export function add', 'export function plus').replace('add(1, 2)', 'plus(1, 2)');
    writeFileSync(join(root, 'engine/core/add.ts'), renamed);
    const check = await docs(root, 'check');
    expect(check.failures).toEqual([
      expect.objectContaining({ id: 'DOCS_STALE', file: 'docs/INDEX.md' }),
      expect.objectContaining({ id: 'DOCS_STALE', file: 'docs/API.md' }),
    ]);
  });

  it('fails a missing path, a broken link, an unknown command or script, and skips the frozen docs', async () => {
    const root = repo({
      'engine/core/add.ts': MODULE.replace('Adds numbers,', 'Adds numbers (see engine/core/gone.ts),'),
      'AGENTS.md': 'Run `x nope`, then npm run lint; npm run check passes. See [the index](docs/INDEX.md).\n',
      'docs/GUIDE.md': 'Read [the add module](../engine/core/add.ts) and [this](missing.md); tools/{a,b}.ts.\n',
      'docs/research/old.md': 'engine/core/old.ts is long gone.\n',
    });
    await docs(root, 'write');
    const failures = (await docs(root, 'check')).failures ?? [];
    expect(failures.map((f) => [f.id, f.file, f.line])).toEqual([
      ['DOCS_PATH', 'engine/core/add.ts', 2],
      ['DOCS_NAME', 'AGENTS.md', 1],
      ['DOCS_NAME', 'AGENTS.md', 1],
      ['DOCS_PATH', 'docs/GUIDE.md', 1],
      ['DOCS_PATH', 'docs/GUIDE.md', 1],
      ['DOCS_LINK', 'docs/GUIDE.md', 1],
    ]);
    expect(failures[0].message).toContain('engine/core/gone.ts does not exist');
    expect(failures.map((f) => f.message).join('\n')).toMatch(
      /x nope[\s\S]*"lint"[\s\S]*tools\/a\.ts[\s\S]*tools\/b\.ts[\s\S]*missing\.md/,
    );
  });

  it('checks source citations against the checkouts, and only warns when one is unresolved', async () => {
    const source = repo({ 'tools/old.mjs': 'a\nb\nc\n' });
    const root = repo({
      'docs/PORT.md':
        'From my-3d2dge:tools/old.mjs:2-3, not my-3d2dge:tools/old.mjs:9 or my-3d2dge:tools/gone.mjs.\nshardfall:docs/HISTORY.md:4\n',
    });
    await docs(root, 'write');
    const check = await docs(root, 'check', { 'my-3d2dge': source });
    expect(check.failures?.map((f) => f.message)).toEqual([
      expect.stringContaining('my-3d2dge:tools/old.mjs:9 is past the end'),
      expect.stringContaining('my-3d2dge:tools/gone.mjs does not exist'),
    ]);
    expect(check.warnings).toEqual([
      expect.objectContaining({
        id: 'DOCS_SOURCE_DEFERRED',
        message: expect.stringContaining('1 citation of shardfall'),
      }),
    ]);
  });

  it('fails missing and long file comments, undocumented exports, and a PROGRESS.md past one screen', async () => {
    const long = `/**\n * @file Too long.\n${' *\n'.repeat(40)} */\nexport const quiet = 1;\n`;
    const root = repo({
      'tools/bare.ts': 'export const bare = 1;\n',
      'tools/long.ts': long,
      'docs/PROGRESS.md': 'line\n'.repeat(41),
    });
    await docs(root, 'write');
    const failures = (await docs(root, 'check')).failures ?? [];
    expect(ids(failures)).toEqual([
      'DOCS_FILE_COMMENT',
      'DOCS_UNDOCUMENTED',
      'DOCS_FILE_COMMENT_LONG',
      'DOCS_UNDOCUMENTED',
      'DOCS_PROGRESS',
    ]);
    expect(failures.at(-1)?.message).toContain('runs 41 lines, over 40');
  });

  it('follows the public barrels to each declaration, lists them first in API, and fails an undocumented one', async () => {
    const root = repo({
      'engine/index.ts':
        "/**\n * @file The public API for pages.\n */\nexport * from './sim-api';\nexport { add as sum } from './core/add';\n",
      'engine/sim-api.ts':
        "/**\n * @file The public API for sim-side code.\n */\nexport { add, hidden } from './core/add';\n",
      'engine/core/add.ts': `${MODULE}export const hidden = 2;\n`,
    });
    await docs(root, 'write');
    const failures = (await docs(root, 'check')).failures ?? [];
    expect(failures.map((f) => [f.id, f.file])).toEqual([
      ['DOCS_UNDOCUMENTED', 'engine/core/add.ts'],
      ['DOCS_PUBLIC_UNDOCUMENTED', 'engine/core/add.ts'],
      ['DOCS_PUBLIC_UNDOCUMENTED', 'engine/core/add.ts'],
    ]);
    const api = readFileSync(join(root, 'docs/API.md'), 'utf8');
    expect(api.indexOf('### [`engine/index.ts`]')).toBeLessThan(api.indexOf('## Engine internals and tools'));
    expect(api).toContain('- `sum` (function from [`engine/core/add.ts`](../engine/core/add.ts)): Adds two numbers.');
  });

  it('collects defineCodes into ERRORS, and fails a code without its fix or registered twice', async () => {
    const codes = `/**\n * @file Registers the fixture's codes.\n */\n/** The codes. */\nexport const codes = defineCodes('gfx', {\n  GFX_NO_WEBGPU: { template: 'no WebGPU adapter', fix: 'run in Chromium with WebGPU on', doc: 'Raised at startup.' },\n  GFX_SLOW: { template: 'slow' },\n});\ndeclare function defineCodes(area: string, codes: object): object;\n`;
    const again = `/**\n * @file Registers a code twice.\n */\n/** Again. */\nexport const again = defineCodes('gfx', { GFX_NO_WEBGPU: { template: 'x', fix: 'y' }, BAD: { template: 'x', fix: 'y' } });\ndeclare function defineCodes(area: string, codes: object): object;\n`;
    const root = repo({ 'engine/gfx/codes.ts': codes, 'engine/gfx/again.ts': again });
    await docs(root, 'write');
    const failures = (await docs(root, 'check')).failures ?? [];
    expect(failures.map((f) => f.message)).toEqual([
      'BAD: its code must be upper-case words joined by _, starting with GFX_',
      'GFX_NO_WEBGPU is registered twice, at engine/gfx/again.ts:5 and engine/gfx/codes.ts:6: each code has one home',
      'GFX_SLOW: it has no fix: name what to do, in public-API terms',
    ]);
    const errors = readFileSync(join(root, 'docs/ERRORS.md'), 'utf8');
    expect(errors).toMatch(
      /## gfx[\s\S]*### GFX_NO_WEBGPU\n\n- Message: `no WebGPU adapter`\n- Fix: run in Chromium with WebGPU on/,
    );
  });

  it('flags browser examples for T2 instead of running them', async () => {
    const page = `/**\n * @file A page module.\n *\n * @example\n * document.body.append('x');\n */\n/** One. */\nexport const one = 1;\n`;
    const marked = MODULE.replace('add(1, 2); // 3', '// browser: it draws\nwindow.alert(add(1, 2));');
    const root = repo({ 'labs/demo/page.ts': page, 'engine/core/add.ts': marked });
    await docs(root, 'write');
    const check = await docs(root, 'check');
    expect(check.failures).toEqual([]);
    expect(check.metrics).toMatchObject({
      'examples.ran': 0,
      'examples.t2': 2,
      'examples.t2List': 'engine/core/add.ts:4, labs/demo/page.ts:4',
    });
  });

  it('refuses --check with --write', async () => {
    await expect(
      docs(repo(), 'check').then(() =>
        createDocsCommand().run({ values: { check: true, write: true }, positionals: [], root: ROOT }),
      ),
    ).rejects.toThrow(UsageError);
  });
});

describe('the pieces', () => {
  it('reads examples whose imports resolve from their module, and TypeScript in them', () => {
    expect(compileExample("import { a, b as c } from './x';\nconst n: number = a + c;")).toBe(
      'const { a, b: c } = await __import("./x");\nconst n = a + c;\n',
    );
    expect(compileExample("import * as all from 'node:path';\nimport d from './d';")).toContain(
      'const all = await __import("node:path");',
    );
  });

  it('expands alternatives', () => {
    expect(expand('tools/cmd/{docs,new}.ts')).toEqual(['tools/cmd/docs.ts', 'tools/cmd/new.ts']);
    expect(expand('data/<a|b>/x.json')).toEqual(['data/a/x.json', 'data/b/x.json']);
  });

  it('plans the paths of WPs still to come and of the layout, never of done WPs', () => {
    const plan = [
      '### 6.2 Repository layout',
      '```',
      'my-3dge/',
      '  data/',
      '    fonts/                  approved fonts only',
      '    APPROVED-BINARIES.json',
      '```',
      '#### WP-0.6 Docs system',
      '- **Owns:** `tools/cmd/{docs,new}.ts`',
      '#### WP-0.7 Escalations',
      '- **Owns:** `docs/escalations/README.md`, `engine/world/level/**`',
      '| WP | Title | Lane | Status | Commit | Notes |',
      '| 0.6 | Docs | T | done | | |',
      '| 0.7 | Esc | T | todo | | |',
    ].join('\n');
    const root = repo({ 'PLAN.md': plan });
    const planned = readPlanned(root);
    expect(planned.layout).toEqual(['data/', 'data/fonts/', 'data/APPROVED-BINARIES.json']);
    expect(
      ['docs/escalations/', 'docs/escalations/README.md', 'engine/world/level/a.ts', 'data/fonts/'].map((p) =>
        isPlanned(p, planned),
      ),
    ).toEqual([true, true, true, true]);
    expect(['tools/cmd/docs.ts', 'data/fonts/x.ttf', 'docs/other.md'].map((p) => isPlanned(p, planned))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('reads re-exports, overloads and the default export of a module', () => {
    const root = repo({
      'tools/many.ts':
        "/**\n * @file Many kinds.\n */\n/** F. */\nexport function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: unknown) { return a; }\nexport * from './other';\nexport type { T } from './other';\nexport default 1;\n",
      'tools/other.ts': '/**\n * @file Other.\n */\n/** T. */\nexport type T = 1;\n',
    });
    const module = readModule(root, 'tools/many.ts');
    expect(module.exports.map((item) => [item.name, item.kind, Boolean(item.doc)])).toEqual([
      ["* from './other'", 're-export', false],
      ['default', 'default', false],
      ['f', 'function', true],
      ['T', 're-export', false],
    ]);
  });
});

describe('the x check plugin', () => {
  it('runs the drift checks but not the examples, which T1 and x docs --check run', async () => {
    const root = repo({ 'engine/core/add.ts': MODULE.replace('add(1, 2); // 3', 'addd(1, 2);') });
    await docs(root, 'write');
    expect((await check.run({ root, lane: false })).failures).toEqual([]);
    writeFileSync(join(root, 'docs/INDEX.md'), 'edited by hand\n');
    expect(ids((await check.run({ root, lane: false })).failures)).toEqual(['DOCS_STALE']);
  });

  it('registers the drift checks with x check, as a warning in ultracode lanes', async () => {
    const plugin = (await discoverPlugins(ROOT)).find((candidate) => candidate.name === 'docs');
    expect(plugin?.warnInLane).toBe(true);
  });
});
