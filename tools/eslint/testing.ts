/**
 * @file Lints fixtures for the ESLint tests (WP 0.4): writes each source at its repository path inside a temporary
 * directory and lints it through ESLint's Node API with eslint.config.js's own `configure(…)`, so every rule is proved
 * by a failing and a passing fixture, and nothing failing is ever committed.
 *
 * Invariants: a fixture gets a `@file` comment unless it starts with `/**`; cases whose paths collide are linted in
 * separate directories; every switch is on unless a test says otherwise; temporary directories are removed.
 *
 * @example
 * const [result] = await lintCases([{ name: 'clock', file: 'engine/sim/a.ts', bad: 'export const t = Date.now();',
 *   good: 'export const t = 0;', rule: 'sim/no-restricted-globals' }]);
 * // result.bad holds the sim/no-restricted-globals error; result.good is empty
 * @see tools/eslint/config.test.ts
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { ROOT } from '../x';

/** eslint.config.js's switches. */
export interface Switches {
  publicApi: boolean;
  askTheEntry: boolean;
}

/** Every switch on: the rules written ahead of their code are tested now. */
export const ALL_ON: Switches = { publicApi: true, askTheEntry: true };

/** What eslint.config.js exports. */
export interface ConfigModule {
  SWITCHES: Switches;
  configure(switches?: Switches): Linter.Config[];
  default: Linter.Config[];
}

/** Imports the repository's eslint.config.js. */
export async function loadConfigModule(): Promise<ConfigModule> {
  return (await import(pathToFileURL(join(ROOT, 'eslint.config.js')).href)) as ConfigModule;
}

/** One rule proved both ways. */
export interface Case {
  /** What it shows, for the test's name. */
  name: string;
  /** Where the failing source goes, relative to the repository root. */
  file: string;
  /** Source that breaks the rule. */
  bad: string;
  /** The same intent written the allowed way, or the same source at an exempt `goodFile`. */
  good: string;
  /** Where the passing source goes, when not `file`. */
  goodFile?: string;
  /** The rule id the failing source must trip. */
  rule: string;
  /** The severity it must trip with: 2 (error, the default) or 1 (warning). */
  severity?: 1 | 2;
}

/** A case and the messages ESLint gave its two sources. */
export interface CaseResult {
  case: Case;
  bad: Linter.LintMessage[];
  good: Linter.LintMessage[];
}

/** Adds the file comment every module under engine/, tools/, labs/ and tests/ needs, unless it has one. */
const withFileComment = (source: string) => (source.startsWith('/**') ? source : `/** @file Fixture. */\n${source}\n`);

/** Lints `files` (repository path → source) in fresh temporary directories, one per group of distinct paths. */
async function lintGroups(
  groups: Map<string, string>[],
  switches: Switches,
): Promise<Map<string, Linter.LintMessage[]>[]> {
  const { configure } = await loadConfigModule();
  const config = configure(switches);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'eslint-fixtures-')));
  try {
    return await Promise.all(
      groups.map(async (files, index) => {
        const root = join(base, String(index));
        for (const [path, source] of files) {
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), source);
        }
        const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config, cache: false });
        const results = await eslint.lintFiles([...files.keys()]);
        return new Map(results.map((result) => [result.filePath.slice(root.length + 1), result.messages] as const));
      }),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** Lints `files` (repository path → source, each given a file comment) and returns each path's messages. */
export async function lintFixtures(
  files: Record<string, string>,
  switches: Switches = ALL_ON,
): Promise<Record<string, Linter.LintMessage[]>> {
  const group = new Map(Object.entries(files).map(([path, source]) => [path, withFileComment(source)]));
  const [messages] = await lintGroups([group], switches);
  return Object.fromEntries(messages);
}

/** Lints every case's failing and passing source and pairs the results, in the order given. */
export async function lintCases(cases: readonly Case[], switches: Switches = ALL_ON): Promise<CaseResult[]> {
  const groups: Map<string, string>[] = [];
  const placed: { group: number; path: string }[][] = [];
  const place = (path: string, source: string) => {
    let group = groups.findIndex((files) => !files.has(path));
    if (group < 0) group = groups.push(new Map()) - 1;
    groups[group].set(path, withFileComment(source));
    return { group, path };
  };
  for (const item of cases) placed.push([place(item.file, item.bad), place(item.goodFile ?? item.file, item.good)]);
  const linted = await lintGroups(groups, switches);
  const messages = ({ group, path }: { group: number; path: string }) => linted[group].get(path) ?? [];
  return cases.map((item, i) => ({ case: item, bad: messages(placed[i][0]), good: messages(placed[i][1]) }));
}

/** One line per message, for readable assertion failures. */
export const describeMessages = (messages: readonly Linter.LintMessage[]) =>
  messages.map((message) => `${message.line}: ${message.ruleId ?? 'parse'}: ${message.message}`);

/** What is wrong with a case's result: its failing source must trip its rule, its passing source lint clean. */
export function caseProblems({ case: item, bad, good }: CaseResult): string[] {
  const problems: string[] = [];
  const severity = item.severity ?? 2;
  if (!bad.some((message) => message.ruleId === item.rule && message.severity === severity)) {
    problems.push(`${item.file} did not trip ${item.rule}: ${describeMessages(bad).join(' | ') || 'no messages'}`);
  }
  if (good.length > 0)
    problems.push(`${item.goodFile ?? item.file} should pass: ${describeMessages(good).join(' | ')}`);
  return problems;
}

/** The configured messages (from `messages`) that no failing fixture produced. */
export function uncovered(messages: readonly string[], results: readonly CaseResult[]): string[] {
  const seen = results.flatMap((result) => result.bad.map((message) => message.message));
  return messages.filter((message) => !seen.some((text) => text.includes(message)));
}
