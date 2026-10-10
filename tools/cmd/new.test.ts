/**
 * @file Tests `x new` (WP 0.6): kinds are discovered and their manifests validated, templates fill and never
 * overwrite, the module template passes its own checks (`x new module --test`), and a broken template fails them.
 * Fixture templates live in temporary directories; `--test` writes its sample into this repository and removes it.
 * @see tools/cmd/new.ts
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT, UsageError } from '../x';
import command, { CHECKS, fill, listKinds, render, testKind, type Kind } from './new';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary directory holding `files`. */
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'new-')));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const manifest = (extra: object = {}) =>
  JSON.stringify({
    describe: 'A thing.',
    id: 'a path',
    pattern: '^things/[a-z]+$',
    sample: 'things/sample',
    files: { 'thing.txt': '{{id}}.txt' },
    checks: [],
    ...extra,
  });

describe('kinds', () => {
  it('discovers the module kind from tools/templates/', () => {
    const kinds = listKinds(ROOT);
    expect(kinds.map((kind) => kind.kind)).toContain('module');
    expect(kinds.find((kind) => kind.kind === 'module')?.checks).toEqual([...CHECKS]);
  });

  it.each([
    [{ extra: 1 }, 'unknown key "extra"'],
    [{ files: { 'gone.txt': 'x' } }, '"files": gone.txt is missing'],
    [{ checks: ['spell'] }, '"checks" lists some of types, lint, test, docs'],
    [{ sample: 'elsewhere/x' }, 'does not match its pattern'],
    [{ describe: '' }, '"describe" must be a non-empty string'],
  ])('rejects a manifest with %j', (extra, problem) => {
    const root = tree({
      'tools/templates/thing/template.json': manifest(extra),
      'tools/templates/thing/thing.txt': 'x',
    });
    expect(() => listKinds(root)).toThrow(problem);
  });

  it('fills {{id}}, {{name}} and {{dir}}, and rejects any other placeholder', () => {
    expect(fill('{{dir}} / {{name}} / {{id}}', 'engine/core/clock', 't')).toBe(
      'engine/core / clock / engine/core/clock',
    );
    expect(() => fill('{{nmae}}', 'a/b', 'tools/templates/x/y')).toThrow('tools/templates/x/y holds {{nmae}}');
  });
});

describe('writing an entry', () => {
  it('writes the files formatted, runs the checks, and never overwrites', async () => {
    const root = tree({ '.prettierrc.json': readFileSync(join(ROOT, '.prettierrc.json'), 'utf8') });
    cpSync(join(ROOT, 'tools/templates/module'), join(root, 'tools/templates/module'), { recursive: true });
    const file = join(root, 'tools/templates/module/template.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), checks: [] }));
    const run = (positionals: string[]) => command.run({ values: {}, positionals, root });
    const result = await run(['module', 'engine/core/clock']);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('wrote engine/core/clock.ts, engine/core/clock.test.ts');
    expect(readFileSync(join(root, 'engine/core/clock.ts'), 'utf8')).toContain(
      "export function clock(): string {\n  return 'clock';\n}",
    );
    expect(readFileSync(join(root, 'engine/core/clock.test.ts'), 'utf8')).toContain("import { clock } from './clock';");
    await expect(run(['module', 'engine/core/clock'])).rejects.toThrow('already exist: x new never overwrites');
    await expect(run(['module', 'engine/core/Clock'])).rejects.toThrow(UsageError);
    await expect(run(['modul', 'engine/core/x'])).rejects.toThrow('did you mean module?');
    await expect(run(['module'])).rejects.toThrow('name the new module');
  });

  it('lists the kinds when given none', async () => {
    const result = await command.run({ values: {}, positionals: [], root: ROOT });
    expect(result.lines).toContainEqual(expect.stringMatching(/^module: /));
  });

  it('rejects an id that does not match the pattern', async () => {
    const kind = listKinds(ROOT).find((candidate) => candidate.kind === 'module') as Kind;
    await expect(render(ROOT, kind, 'Engine/core/clock')).rejects.toThrow('is not a module id');
  });
});

describe('testing templates (x new … --test)', () => {
  it('passes the module template and leaves nothing behind', { timeout: 60_000 }, async () => {
    const result = await command.run({ values: { test: true }, positionals: ['module'], root: ROOT });
    expect(result.failures).toEqual([]);
    expect(result.lines).toEqual(['types: ok', 'lint: ok', 'test: ok', 'docs: ok']);
    expect(existsSync(join(ROOT, 'tools/templates/module/sampleModule.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'tools/templates/module/sampleModule.test.ts'))).toBe(false);
  });

  it('fails a broken template on every check', { timeout: 60_000 }, async () => {
    const dir = tree({
      'broken.ts.tmpl': "export const {{name}}: number = 'text';\n",
      'broken.test.ts.tmpl':
        "/**\n * @file A failing test.\n */\nimport { expect, it } from 'vitest';\n\nit('fails', () => expect(1).toBe(2));\n",
    });
    const kind: Kind = {
      kind: 'broken',
      dir,
      describe: 'A broken template.',
      id: 'a path',
      pattern: '.',
      sample: 'tools/templates/module/brokenSample',
      files: { 'broken.ts.tmpl': '{{id}}.ts', 'broken.test.ts.tmpl': '{{id}}.test.ts' },
      checks: [...CHECKS],
    };
    const result = await testKind(ROOT, kind);
    expect(result.lines).toEqual(['types: 1 problem', 'lint: 1 problem', 'test: 1 problem', 'docs: 2 problems']);
    expect(result.failures.map((finding) => finding.id)).toEqual([
      'NEW_TYPES',
      'NEW_LINT',
      'NEW_TEST',
      'NEW_DOCS',
      'NEW_DOCS',
    ]);
    expect(existsSync(join(ROOT, 'tools/templates/module/brokenSample.ts'))).toBe(false);
  });
});
