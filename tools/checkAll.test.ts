/**
 * @file Tests tools/checkAll.ts (`npm run check`): the exit code is 1 when any tool fails and 0 only when all pass,
 * and each tool's output is printed whole, in the order given, however the tools finish. Its type check covers what
 * `tsc --noEmit` would: the projects of tsconfig.check.json hold tsconfig.json's files, each exactly once, and each
 * project rebuilds when the dependencies change (ADR-0014 amendment 7).
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAll, CHECK_TOOLS, type CheckTool } from './checkAll';
import { ROOT } from './x';

/** A fake tool: prints `lines` (after `delayMs`) and exits with `code`. */
const tool = (name: string, code: number, lines: string[], delayMs = 0): CheckTool => ({
  name,
  command: `node -e "setTimeout(() => { ${lines.map((line) => `console.log('${line}');`).join(' ')} process.exit(${code}); }, ${delayMs})"`,
});

afterEach(() => vi.restoreAllMocks());

/** Runs checkAll with console.log captured; returns the exit code and the printed lines. */
async function run(tools: CheckTool[]): Promise<{ code: number; printed: string[] }> {
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((text: string) => printed.push(...String(text).split('\n')));
  const code = await checkAll(tools);
  return { code, printed };
}

describe('checkAll', () => {
  it('returns 0 when every tool passes', async () => {
    const { code, printed } = await run([tool('a', 0, ['one']), tool('b', 0, [])]);
    expect(code).toBe(0);
    expect(printed.at(-1)).toMatch(/^check: ok in \d+\.\d s$/);
  });

  it('returns 1 when one tool fails, naming it, and still runs the others to the end', async () => {
    const { code, printed } = await run([tool('a', 0, ['fine']), tool('b', 1, ['broken']), tool('c', 0, ['also'])]);
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe('check: FAIL (b)');
    expect(printed).toContain('also');
  });

  it('prints each tool whole and in the given order, even when a later tool finishes first', async () => {
    const { printed } = await run([tool('slow', 0, ['s1', 's2'], 400), tool('fast', 2, ['f1', 'f2'])]);
    const body = printed.filter((line) => !line.startsWith('check:'));
    expect(body.map((line) => line.replace(/\(\d+\.\d s\)/, '(t)'))).toEqual([
      'ok   slow (t)',
      's1',
      's2',
      'FAIL fast (t)',
      'f1',
      'f2',
    ]);
  });
});

/** A tsconfig file parsed as tsc reads it (`extends` applied, globs expanded); throws on a config error. */
function parse(config: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(ROOT, config), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    },
  });
  if (!parsed) throw new Error(`${config} did not parse`);
  expect(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' '))).toEqual([]);
  return parsed;
}

/** A config's TypeScript files, relative to the root and sorted (package.json and package-lock.json left out). */
const sources = (parsed: ts.ParsedCommandLine) =>
  parsed.fileNames
    .filter((file) => !file.endsWith('.json'))
    .map((file) => relative(ROOT, file))
    .sort();

describe('the type check', () => {
  const projects = (parse('tsconfig.check.json').projectReferences ?? []).map((ref) => relative(ROOT, ref.path));

  it('runs npm run typecheck: tsc -b over tsconfig.check.json', () => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts.typecheck).toBe('tsc -b tsconfig.check.json');
    expect(CHECK_TOOLS.find((tool) => tool.name === 'tsc')?.command).toBe(`npx ${scripts.typecheck}`);
    expect(projects).toEqual(['tsconfig.engine.json', 'tsconfig.apps.json', 'tsconfig.tests.json']);
  });

  it("checks every file of tsconfig.json, in exactly one project, as tsconfig.json's options say", () => {
    const whole = parse('tsconfig.json');
    const owners = new Map<string, string[]>();
    for (const project of projects) {
      const parsed = parse(project);
      for (const [name, value] of Object.entries(whole.options)) {
        if (!['noEmit', 'configFilePath'].includes(name))
          expect(parsed.options[name], `${project}: ${name}`).toEqual(value);
      }
      for (const file of sources(parsed)) owners.set(file, [...(owners.get(file) ?? []), project]);
    }
    expect([...owners.keys()].sort()).toEqual(sources(whole));
    expect([...owners].filter(([, owner]) => owner.length > 1)).toEqual([]);
    expect(sources(whole).length).toBeGreaterThan(100);
  });

  it('keeps each project composite, emitting declarations only under node_modules/.cache/tsc/, rebuilt on a dependency change', () => {
    for (const project of projects) {
      const parsed = parse(project);
      expect(parsed.options, project).toMatchObject({
        composite: true,
        emitDeclarationOnly: true,
        outDir: join(ROOT, 'node_modules/.cache/tsc'),
      });
      // tsc -b skips a project by its own files alone, so the lockfile is one of them.
      expect(
        parsed.fileNames.map((file) => relative(ROOT, file)),
        project,
      ).toContain('package-lock.json');
    }
  });
});
