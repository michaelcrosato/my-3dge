/**
 * @file The `report.json` every `x` command writes (PLAN.md §8.1): its schema, its validation, and the writer that
 * also updates `out/latest.json`. Agents read these files instead of scrolling output.
 *
 * Invariants: a report has exactly the keys of `Report` (unknown keys are errors, like unknown flags); it lives at
 * `out/<cmd>/<target>/report.json`; `out/latest.json` is the last report written, plus its `report` path; every
 * report records the runtime it ran on.
 *
 * @example
 * const report = makeReport({ tool: 'x src', args: {}, ms: 12, ok: true, root: process.cwd() });
 * validateReport(report); // []
 * @see tools/lib/report.test.ts
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** One failure or warning: what was expected and what happened, where, and the likely fix, as a plain sentence. */
export interface Finding {
  /** A stable code, such as `SRC_UNRESOLVED` or `X_UNKNOWN_FLAG`. */
  id: string;
  /** The sentence an agent reads: expected, actual, where, likely fix. */
  message: string;
  /** Repository-relative file the finding points at, when there is one. */
  file?: string;
  /** 1-based line in `file`. */
  line?: number;
  /** The entity id, for findings about one entity in a scene. */
  entity?: number;
}

/** A file a command wrote, for example a PNG, with what it shows. */
export interface Artifact {
  /** Repository-relative path, under `out/`. */
  path: string;
  /** What kind of file it is: `image`, `json`, `text`… */
  kind: string;
  /** One line saying what the file shows. */
  describes: string;
}

/** The fixed schema of `out/<cmd>/<target>/report.json`. */
export interface Report {
  /** The command as typed, without arguments: `x help`. */
  tool: string;
  /** The engine's version (`package.json`). */
  version: string;
  /** The parsed arguments: flag values plus `positionals`. */
  args: Record<string, unknown>;
  /** Wall time of the whole command, in milliseconds. */
  ms: number;
  /** The verdict: true exactly when the command exits 0. */
  ok: boolean;
  /** Where it ran, from `runtime()`: `linux-x64 node24.21.0`, plus the browser when one was used. */
  runtime: string;
  /** What failed; empty when `ok`. */
  failures: Finding[];
  /** What deserves a look without failing. */
  warnings: Finding[];
  /** Named numbers (and short strings) the command measured. */
  metrics: Record<string, number | string | boolean>;
  /** Files the command wrote. */
  artifacts: Artifact[];
}

const REPORT_KEYS: readonly (keyof Report)[] = [
  'tool',
  'version',
  'args',
  'ms',
  'ok',
  'runtime',
  'failures',
  'warnings',
  'metrics',
  'artifacts',
];
const FINDING_KEYS = ['id', 'message', 'file', 'line', 'entity'];
const ARTIFACT_KEYS = ['path', 'kind', 'describes'];

/** Names the platform: `linux-x64 node24.21.0`, followed by `browser` (such as `chromium141`) when one was used. */
export function runtime(browser?: string): string {
  const base = `${process.platform}-${process.arch} node${process.versions.node}`;
  return browser ? `${base} ${browser}` : base;
}

/** Reads the engine's version from `package.json` under `root`. */
export function packageVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/** Turns a command's target (a page, a scene, a file) into one safe directory name; no target gives `all`. */
export function targetSlug(target: string | undefined): string {
  const slug = (target ?? '')
    .replace(/\.(html|ts|json)$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '');
  return slug || 'all';
}

/** Builds a complete report from the parts a command knows, filling the version, the runtime and empty lists. */
export function makeReport(parts: {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  root: string;
  browser?: string;
  failures?: Finding[];
  warnings?: Finding[];
  metrics?: Report['metrics'];
  artifacts?: Artifact[];
}): Report {
  return {
    tool: parts.tool,
    version: packageVersion(parts.root),
    args: parts.args,
    ms: Math.round(parts.ms),
    ok: parts.ok,
    runtime: runtime(parts.browser),
    failures: parts.failures ?? [],
    warnings: parts.warnings ?? [],
    metrics: parts.metrics ?? {},
    artifacts: parts.artifacts ?? [],
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

function checkFindings(value: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(value)) return void errors.push(`${where}: expected an array`);
  value.forEach((item, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(item)) return void errors.push(`${at}: expected an object`);
    checkKeys(item, FINDING_KEYS, at, errors);
    if (typeof item.id !== 'string' || !item.id) errors.push(`${at}.id: expected a non-empty string`);
    if (typeof item.message !== 'string' || !item.message) errors.push(`${at}.message: expected a non-empty string`);
    if (item.file !== undefined && typeof item.file !== 'string') errors.push(`${at}.file: expected a string`);
    for (const key of ['line', 'entity'] as const) {
      if (item[key] !== undefined && !Number.isInteger(item[key])) errors.push(`${at}.${key}: expected an integer`);
    }
  });
}

/** Checks a parsed report against the schema; returns one sentence per problem, or an empty list. */
export function validateReport(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['report: expected an object'];
  checkKeys(value, REPORT_KEYS, 'report', errors);
  for (const key of REPORT_KEYS) if (!(key in value)) errors.push(`report: missing key "${key}"`);
  for (const key of ['tool', 'version', 'runtime'] as const) {
    if (key in value && (typeof value[key] !== 'string' || !value[key]))
      errors.push(`${key}: expected a non-empty string`);
  }
  if ('args' in value && !isObject(value.args)) errors.push('args: expected an object');
  if ('ms' in value && !(typeof value.ms === 'number' && value.ms >= 0)) errors.push('ms: expected a number ≥ 0');
  if ('ok' in value && typeof value.ok !== 'boolean') errors.push('ok: expected a boolean');
  if ('failures' in value) checkFindings(value.failures, 'failures', errors);
  if ('warnings' in value) checkFindings(value.warnings, 'warnings', errors);
  if (value.ok === true && Array.isArray(value.failures) && value.failures.length > 0) {
    errors.push('ok: a report with failures cannot be ok');
  }
  if ('metrics' in value) {
    if (!isObject(value.metrics)) errors.push('metrics: expected an object');
    else {
      for (const [key, metric] of Object.entries(value.metrics)) {
        if (!['number', 'string', 'boolean'].includes(typeof metric)) {
          errors.push(`metrics.${key}: expected a number, string or boolean`);
        }
      }
    }
  }
  if ('artifacts' in value) {
    if (!Array.isArray(value.artifacts)) errors.push('artifacts: expected an array');
    else {
      value.artifacts.forEach((item, i) => {
        const at = `artifacts[${i}]`;
        if (!isObject(item)) return void errors.push(`${at}: expected an object`);
        checkKeys(item, ARTIFACT_KEYS, at, errors);
        for (const key of ARTIFACT_KEYS) {
          if (typeof item[key] !== 'string' || !item[key]) errors.push(`${at}.${key}: expected a non-empty string`);
        }
      });
    }
  }
  return errors;
}

/** The repository-relative path of a command's report: `out/<cmd>/<target>/report.json`. */
export function reportPath(cmd: string, target: string): string {
  return `out/${cmd}/${targetSlug(target)}/report.json`;
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

/**
 * Validates `report`, writes it to `out/<cmd>/<target>/report.json` under `root`, copies it to `out/latest.json`
 * (with its `report` path) and returns the repository-relative path. Throws, naming each problem, if it is invalid.
 */
export function writeReport(root: string, cmd: string, target: string, report: Report): string {
  const errors = validateReport(report);
  if (errors.length > 0) throw new Error(`invalid report for x ${cmd}: ${errors.join('; ')}`);
  const path = reportPath(cmd, target);
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeJson(join(root, path), report);
  writeJson(join(root, 'out', 'latest.json'), { report: path, ...report });
  return path;
}
