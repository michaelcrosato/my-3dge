/**
 * @file Scaffolds a new entry of a kind from its template (PLAN.md §8.13): `x new <kind> <id>` writes the files of
 * `tools/templates/<kind>/`, filled in for the id, then runs the kind's checks and prints the summary.
 *
 * A kind is a directory `tools/templates/<kind>/` holding its template files and a manifest, `template.json`:
 * `describe` (one sentence), `id` (what an id looks like), `pattern` (a regular expression every id must match),
 * `sample` (the id `--test` writes), `files` (template file → target path) and `checks`. Template files and
 * targets hold `{{id}}` (the id as given), `{{name}}` (its last segment) and `{{dir}}` (the rest); any other
 * placeholder, or any other manifest key, is an error. Written files are formatted by Prettier.
 *
 * Checks, run on the new files only: `types` (TypeScript's diagnostics, with tsconfig.json's options), `lint`
 * (ESLint's errors), `test` (Vitest runs the new `*.test.ts` files) and `docs` (a file comment, every export
 * documented, every `@example` runs; tools/cmd/docs.ts).
 *
 * `--test` writes the kind's `sample` into the repository, runs its checks and always removes it again, so a template
 * cannot rot; `--test-all` tests every kind (`x ci --local` runs it). With no arguments it lists the kinds.
 *
 * Invariants: it never overwrites a file. A new kind is a new directory: this file never changes for one.
 *
 * Usage: node x new [<kind> <id> | <kind> --test | --test-all]. Exit 0 when the entry is written (or the template
 * tested) and its checks pass; 1 otherwise; 2 on a usage error.
 *
 * @example
 * listKinds(process.cwd()).map((kind) => kind.kind); // ['module']
 * @see tools/cmd/new.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { format, getFileInfo, resolveConfig } from 'prettier';
import ts from 'typescript';
import { readModule } from '../lib/docs';
import { runExample } from '../lib/docsExamples';
import type { Finding } from '../lib/report';
import { closest, UsageError, type Command, type CommandResult } from '../x';
import { checkComments } from './docs';

/** The checks a kind may ask for. */
export const CHECKS = ['types', 'lint', 'test', 'docs'] as const;
/** One check's name. */
export type CheckName = (typeof CHECKS)[number];

/** A kind, as its manifest declares it. */
export interface Kind {
  kind: string;
  /** Its template directory, relative to the root (or absolute). */
  dir: string;
  describe: string;
  id: string;
  pattern: string;
  sample: string;
  files: Record<string, string>;
  checks: CheckName[];
}

const KEYS = ['describe', 'id', 'pattern', 'sample', 'files', 'checks'];
const TEMPLATES = 'tools/templates';

/** Reads and validates every kind under `tools/templates/`; throws naming the first problem. */
export function listKinds(root: string): Kind[] {
  const dir = join(root, TEMPLATES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((kind) => {
      const file = `${TEMPLATES}/${kind}/template.json`;
      const fail = (problem: string): never => {
        throw new Error(`${file}: ${problem}`);
      };
      if (!existsSync(join(root, file))) fail('missing: each kind has a manifest');
      const manifest = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
      for (const key of Object.keys(manifest)) {
        if (!KEYS.includes(key)) fail(`unknown key "${key}" (keys: ${KEYS.join(', ')})`);
      }
      for (const key of ['describe', 'id', 'pattern', 'sample']) {
        if (typeof manifest[key] !== 'string' || !manifest[key]) fail(`"${key}" must be a non-empty string`);
      }
      const files = manifest.files as Record<string, unknown>;
      if (!files || typeof files !== 'object' || !Object.keys(files).length)
        fail('"files" maps template files to targets');
      for (const [from, to] of Object.entries(files)) {
        if (typeof to !== 'string' || !existsSync(join(root, TEMPLATES, kind, from)))
          fail(`"files": ${from} is missing`);
      }
      const checks = manifest.checks;
      if (!Array.isArray(checks) || checks.some((check) => !CHECKS.includes(check))) {
        fail(`"checks" lists some of ${CHECKS.join(', ')}`);
      }
      const result = { kind, dir: `${TEMPLATES}/${kind}`, ...manifest } as Kind;
      if (!new RegExp(result.pattern).test(result.sample))
        fail(`its sample "${result.sample}" does not match its pattern`);
      return result;
    });
}

/** Fills `{{id}}`, `{{name}}` and `{{dir}}` in `text`; throws on any other placeholder. */
export function fill(text: string, id: string, where: string): string {
  const values: Record<string, string> = { id, name: posix.basename(id), dir: posix.dirname(id) };
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`${where} holds {{${key}}}: templates know {{id}}, {{name}} and {{dir}}`);
    return values[key];
  });
}

/** The files an entry of `kind` with `id` consists of: repository path → formatted text. Writes nothing. */
export async function render(root: string, kind: Kind, id: string): Promise<Record<string, string>> {
  if (!new RegExp(kind.pattern).test(id)) throw new UsageError(`"${id}" is not a ${kind.kind} id: ${kind.id}`);
  const files: Record<string, string> = {};
  for (const [from, to] of Object.entries(kind.files)) {
    const where = posix.join(kind.dir, from);
    const path = fill(to, id, where);
    const text = fill(readFileSync(resolve(root, where), 'utf8'), id, where);
    const info = await getFileInfo(join(root, path), { ignorePath: join(root, '.prettierignore') });
    const options = (await resolveConfig(join(root, path))) ?? {};
    files[path] =
      info.ignored || !info.inferredParser ? text : await format(text, { ...options, filepath: join(root, path) });
  }
  return files;
}

/** Writes rendered files; refuses (throws) when any exists. Returns their paths. */
export function writeFiles(root: string, files: Record<string, string>): string[] {
  const taken = Object.keys(files).filter((path) => existsSync(join(root, path)));
  if (taken.length)
    throw new UsageError(`${taken.join(', ')} already exist${taken.length === 1 ? 's' : ''}: x new never overwrites`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return Object.keys(files);
}

/** TypeScript's diagnostics for `files`, with tsconfig.json's options. */
function typeCheck(root: string, files: string[]): string[] {
  const config = join(root, 'tsconfig.json');
  const options = existsSync(config)
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config, ts.sys, root).options
    : { strict: true };
  const program = ts.createProgram(
    files.map((file) => join(root, file)),
    { ...options, noEmit: true },
  );
  return ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.file && files.includes(relative(root, item.file.fileName)))
    .map((item) => {
      const { line } = item.file!.getLineAndCharacterOfPosition(item.start ?? 0);
      return `${relative(root, item.file!.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`;
    });
}

/** Runs one check on the new files; returns one sentence per problem. */
export async function runCheck(root: string, check: CheckName, files: string[]): Promise<string[]> {
  const code = files.filter((file) => /\.(ts|js|mjs)$/.test(file));
  const tests = code.filter((file) => /\.test\.ts$/.test(file));
  if (check === 'types')
    return typeCheck(
      root,
      code.filter((file) => file.endsWith('.ts')),
    );
  if (check === 'lint') {
    const { ESLint } = await import('eslint');
    const results = await new ESLint({ cwd: root }).lintFiles(code.map((file) => join(root, file)));
    return results.flatMap((result) =>
      result.messages
        .filter((message) => message.severity === 2)
        .map((message) => `${relative(root, result.filePath)}:${message.line}: ${message.ruleId}: ${message.message}`),
    );
  }
  if (check === 'test') {
    if (!tests.length) return [];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
    const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const run = spawnSync(process.execPath, [vitest, 'run', ...tests, '--reporter=dot'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n');
    return run.status === 0
      ? []
      : [`vitest run ${tests.join(' ')} exited ${run.status}: ${output.slice(-3).join(' ')}`];
  }
  const modules = code.filter((file) => !tests.includes(file)).map((file) => readModule(root, file));
  const problems = checkComments(root, modules).map((finding) => finding.message);
  for (const example of modules.flatMap((module) => module.examples)) {
    const outcome = await runExample(root, example);
    if (!outcome.ok) problems.push(`the @example at ${example.module}:${example.line} does not run: ${outcome.error}`);
  }
  return problems;
}

/** Runs a kind's checks on `files`: one line per check, and a finding per problem. */
export async function runChecks(root: string, kind: Kind, files: string[]) {
  const lines: string[] = [];
  const failures: Finding[] = [];
  for (const check of kind.checks) {
    const problems = await runCheck(root, check, files);
    lines.push(`${check}: ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'ok'}`);
    failures.push(...problems.map((message) => ({ id: `NEW_${check.toUpperCase()}`, message })));
  }
  return { lines, failures };
}

/** Writes `kind`'s sample, checks it and removes it again. */
export async function testKind(root: string, kind: Kind) {
  const files = await render(root, kind, kind.sample);
  const taken = Object.keys(files).filter((path) => existsSync(join(root, path)));
  if (taken.length) {
    const message = `${taken.join(', ')} exist${taken.length === 1 ? 's' : ''}: a test run left ${taken.length === 1 ? 'it' : 'them'} behind, so delete ${taken.length === 1 ? 'it' : 'them'}`;
    return { lines: [], failures: [{ id: 'NEW_SAMPLE', message }] };
  }
  try {
    return await runChecks(root, kind, writeFiles(root, files));
  } finally {
    for (const path of Object.keys(files)) rmSync(join(root, path), { force: true });
  }
}

export default {
  usage: 'new [<kind> <id> | <kind> --test | --test-all]',
  options: { test: { type: 'boolean' }, 'test-all': { type: 'boolean' } },
  maxPositionals: 2,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const kinds = listKinds(root);
    const [name, id] = positionals;
    if (values['test-all']) {
      if (name || values.test) throw new UsageError('--test-all takes no kind and no --test');
      const lines: string[] = [];
      const failures: Finding[] = [];
      for (const kind of kinds) {
        const result = await testKind(root, kind);
        lines.push(`${kind.kind}: ${result.lines.join(', ') || 'not run'}`);
        failures.push(
          ...result.failures.map((finding) => ({ ...finding, message: `${kind.kind}: ${finding.message}` })),
        );
      }
      const summary = `${kinds.length} template${kinds.length === 1 ? '' : 's'} tested${failures.length ? '' : ': all pass'}`;
      return { ok: failures.length === 0, summary, lines, failures, target: 'test-all' };
    }
    if (!name) {
      const lines = kinds.map((kind) => `${kind.kind}: ${kind.describe} Id: ${kind.id}`);
      return {
        ok: true,
        summary: `${kinds.length} kind${kinds.length === 1 ? '' : 's'}: node x new <kind> <id>`,
        lines,
      };
    }
    const kind = kinds.find((candidate) => candidate.kind === name);
    if (!kind) {
      const near = closest(
        name,
        kinds.map((candidate) => candidate.kind),
      );
      throw new UsageError(
        `there is no kind "${name}" in ${TEMPLATES}/: ${near ? `did you mean ${near}?` : `kinds: ${kinds.map((k) => k.kind).join(', ')}`}`,
      );
    }
    if (values.test) {
      if (id) throw new UsageError("--test writes the kind's own sample: give no id");
      const result = await testKind(root, kind);
      const ok = result.failures.length === 0;
      return {
        ok,
        summary: `the ${kind.kind} template ${ok ? 'works' : 'is broken'} (sample ${kind.sample})`,
        ...result,
        target: kind.kind,
      };
    }
    if (!id) throw new UsageError(`name the new ${kind.kind}: ${kind.id}`);
    const written = writeFiles(root, await render(root, kind, id));
    const result = await runChecks(root, kind, written);
    const ok = result.failures.length === 0;
    const next = ok ? 'next: replace the placeholder text, then node x docs --write' : 'fix the problems below';
    return { ok, summary: `wrote ${written.join(', ')}; ${next}`, ...result, target: kind.kind };
  },
} satisfies Command;
