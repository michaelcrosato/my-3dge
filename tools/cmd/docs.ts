/**
 * @file Generates and checks the docs that come from the code (PLAN.md §6.8, §8.12): `docs/INDEX.md`, `docs/API.md`
 * and `docs/ERRORS.md`, the `@example` blocks, the paths the docs mention, and `docs/PROGRESS.md`'s length.
 *
 * `--check` (the default) fails when:
 * - an `@example` does not run (tools/lib/docsExamples.ts; browser examples are listed for T2);
 * - a path, source citation, command or script the comments, AGENTS.md, README.md or `docs/` mention does not exist
 *   (tools/lib/docsPaths.ts says what counts);
 * - a module has no file comment, or one over 40 lines; an export has no doc comment (a default export is
 *   documented by the file comment); a public export (anything `engine/index.ts` or `engine/sim-api.ts` exports,
 *   followed to its declaration) has none; a code registered with `defineCodes` lacks its template or fix, or is
 *   registered twice; or a kind declared with `defineKind` cannot be read, or is declared twice (tools/lib/docs.ts
 *   gives the forms);
 * - INDEX, API or ERRORS differ from what `--write` would write;
 * - `docs/PROGRESS.md` is missing or longer than 40 lines (it is one screen, read first by every session).
 *
 * `--write` regenerates INDEX, API and ERRORS, then runs the same checks except the examples.
 *
 * `x check` runs everything but the examples as its `docs` plugin (T0 stays fast); in an ultracode lane its
 * failures are warnings, since the integrator regenerates (§11.3). T1 runs the examples (tests/unit/examples.test.ts).
 *
 * Usage: node x docs [--check | --write]. Exit 0 when every check passes, 1 otherwise.
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readModules, resolveExports, type ModuleDoc } from '../lib/docs';
import { runExamples } from '../lib/docsExamples';
import { BARRELS, GENERATED, generateDocs } from '../lib/docsGenerate';
import { checkPaths, type PathOptions } from '../lib/docsPaths';
import type { Finding } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';
import type { CheckOutcome, CheckPlugin } from './check';

/** The longest a file comment (PLAN.md §6.8) or `docs/PROGRESS.md` (one screen) may run, in lines. */
export const MAX_COMMENT_LINES = 40;
/** The one screen every session reads first: where things stand, what is next, the open issues. */
export const PROGRESS = 'docs/PROGRESS.md';

/** What the code says about its own documentation: missing or long file comments, undocumented exports, bad codes. */
export function checkComments(root: string, modules: readonly ModuleDoc[]): Finding[] {
  const failures: Finding[] = [];
  for (const module of modules) {
    const file = module.path;
    if (!module.fileComment) {
      failures.push({
        id: 'DOCS_FILE_COMMENT',
        message: `${file} has no @file comment: open it with one (PLAN.md §6.8)`,
        file,
        line: 1,
      });
    } else if (module.fileComment.lines > MAX_COMMENT_LINES) {
      const message = `${file}'s file comment runs ${module.fileComment.lines} lines, over ${MAX_COMMENT_LINES}: move detail to the exports' comments`;
      failures.push({ id: 'DOCS_FILE_COMMENT_LONG', message, file, line: module.fileComment.line });
    }
    if (BARRELS.includes(file)) continue;
    for (const item of module.exports) {
      const own = item.kind !== 're-export' || (item.from !== undefined && !item.from.startsWith('.'));
      if (!own || item.doc || (item.name === 'default' && module.fileComment)) continue;
      const message = `${file} exports ${item.name} without a doc comment: give it one, starting with one sentence`;
      failures.push({ id: 'DOCS_UNDOCUMENTED', message, file, line: item.line });
    }
  }
  for (const barrel of modules.filter((module) => BARRELS.includes(module.path))) {
    for (const item of resolveExports(root, barrel.path)) {
      if (item.doc || item.name === 'default') continue;
      const message = `${barrel.path} exports ${item.name} (declared in ${item.declaredIn}:${item.line}) without a doc comment: the public API is the game agent's manual, so document it there`;
      const inRepository = /\.(ts|js|mjs)$/.test(item.declaredIn) && !item.declaredIn.startsWith('.');
      const at = inRepository ? { file: item.declaredIn, line: item.line } : { file: barrel.path };
      failures.push({ id: 'DOCS_PUBLIC_UNDOCUMENTED', message, ...at });
    }
  }
  const seen = new Map<string, string>();
  for (const entry of modules.flatMap((module) => module.codes)) {
    const at = `${entry.module}:${entry.line}`;
    for (const problem of entry.problems) {
      failures.push({ id: 'DOCS_CODE', message: `${entry.code}: ${problem}`, file: entry.module, line: entry.line });
    }
    const first = seen.get(entry.code);
    if (first && entry.code !== '?') {
      const message = `${entry.code} is registered twice, at ${first} and ${at}: each code has one home`;
      failures.push({ id: 'DOCS_CODE_DUPLICATE', message, file: entry.module, line: entry.line });
    }
    seen.set(entry.code, first ?? at);
  }
  const declared = new Map<string, string>();
  for (const entry of modules.flatMap((module) => module.kinds)) {
    const at = `${entry.module}:${entry.line}`;
    for (const problem of entry.problems) {
      failures.push({
        id: 'DOCS_KIND',
        message: `kind ${entry.kind}: ${problem}`,
        file: entry.module,
        line: entry.line,
      });
    }
    const first = declared.get(entry.kind);
    if (first) {
      const message = `kind ${entry.kind} is declared twice, at ${first} and ${at}: declare each kind once`;
      failures.push({ id: 'DOCS_KIND_DUPLICATE', message, file: entry.module, line: entry.line });
    }
    declared.set(entry.kind, first ?? at);
  }
  return failures;
}

/** Options for the checks; tests inject the source checkouts and the planned paths. */
export type DocsOptions = PathOptions;

/** Every drift check except the examples: comments, codes, paths, generated docs and PROGRESS.md. */
export async function driftChecks(
  root: string,
  options: DocsOptions = {},
  modules = readModules(root),
): Promise<CheckOutcome> {
  const failures = checkComments(root, modules);
  const paths = checkPaths(root, modules, options);
  failures.push(...paths.failures);
  const generated = await generateDocs(root, modules);
  const stale = GENERATED.filter((file) => {
    const path = join(root, file);
    return !existsSync(path) || readFileSync(path, 'utf8') !== generated[file];
  });
  for (const file of stale) {
    failures.push({
      id: 'DOCS_STALE',
      message: `${file} is stale: run node x docs --write (never edit it by hand)`,
      file,
    });
  }
  const progress = join(root, PROGRESS);
  const progressLines = existsSync(progress) ? readFileSync(progress, 'utf8').trimEnd().split('\n').length : 0;
  if (!progressLines) {
    failures.push({
      id: 'DOCS_PROGRESS',
      message: `${PROGRESS} is missing: write where things stand, what is next and the open issues`,
      file: PROGRESS,
    });
  } else if (progressLines > MAX_COMMENT_LINES) {
    const message = `${PROGRESS} runs ${progressLines} lines, over ${MAX_COMMENT_LINES}: keep it one screen (the ledger and the ADRs hold the detail)`;
    failures.push({ id: 'DOCS_PROGRESS', message, file: PROGRESS });
  }
  const exports = modules.reduce((sum, module) => sum + module.exports.length, 0);
  const codes = modules.reduce((sum, module) => sum + module.codes.length, 0);
  return {
    failures,
    warnings: paths.warnings,
    summary: `${modules.length} modules, ${exports} exports, ${codes} codes, ${paths.checked} paths; ${stale.length ? `${stale.length} stale` : 'generated docs current'}`,
    metrics: { modules: modules.length, exports, codes, paths: paths.checked, stale: stale.length },
  };
}

/** The `x check` plugin: the drift checks without the examples (they run in T1 and in `x docs --check`). */
export const check: CheckPlugin = {
  name: 'docs',
  warnInLane: true,
  run: ({ root }) => driftChecks(root),
};

/** Builds the command; tests inject the source checkouts and the planned paths. */
export function createDocsCommand(options: DocsOptions = {}): Command {
  return {
    usage: 'docs [--check | --write]',
    options: { check: { type: 'boolean' }, write: { type: 'boolean' } },
    maxPositionals: 0,
    async run({ values, root }): Promise<CommandResult> {
      if (values.check && values.write) throw new UsageError('choose --check or --write, not both');
      const modules = readModules(root);
      const lines: string[] = [];
      const written: string[] = [];
      if (values.write) {
        const generated = await generateDocs(root, modules);
        for (const file of GENERATED) {
          const path = join(root, file);
          if (existsSync(path) && readFileSync(path, 'utf8') === generated[file]) continue;
          writeFileSync(path, generated[file]);
          written.push(file);
        }
        lines.push(written.length ? `wrote ${written.join(', ')}` : 'INDEX, API and ERRORS were already current');
      }
      const outcome = await driftChecks(root, options, modules);
      const failures = [...outcome.failures];
      const metrics = { ...outcome.metrics, written: written.length };
      if (!values.write) {
        const results = await runExamples(
          root,
          modules.flatMap((module) => module.examples),
        );
        const browser = results
          .filter((result) => !result.outcome)
          .map(({ example }) => `${example.module}:${example.line}`);
        const ran = results.filter((result) => result.outcome);
        for (const { example, outcome: run } of ran) {
          if (run?.ok) continue;
          const message = `the @example at ${example.module}:${example.line} does not run: ${run?.error}`;
          failures.push({ id: 'DOCS_EXAMPLE', message, file: example.module, line: example.line });
        }
        Object.assign(metrics, {
          'examples.ran': ran.length,
          'examples.t2': browser.length,
          'examples.t2List': browser.join(', '),
        });
        lines.push(
          `examples: ${ran.length} ran in Node${browser.length ? `; ${browser.length} flagged for T2: ${browser.join(', ')}` : ''}`,
        );
      }
      return {
        ok: failures.length === 0,
        summary: outcome.summary ?? '',
        lines,
        failures,
        warnings: outcome.warnings,
        metrics,
        target: values.write ? 'write' : 'check',
      };
    },
  };
}

export default createDocsCommand();
