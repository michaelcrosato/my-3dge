/**
 * @file Runs content QA for the families named, against their baselines (PLAN.md §8.6).
 *
 * A family is `tools/qa/<family>.ts`, whose default export (a `QaFamily`) returns the violations it finds, each
 * `{ id, metric, value, message }`, larger values worse. Families arrive with level (WP 2.2), tex (2.3), geo (2.4),
 * anim (6.6) and audio (9.4), each also run in T1 through `runQa`.
 *
 * Baselines `tests/baselines/qa-<family>[-<area>].json`, each owned by the WP that creates it, are JSON arrays of
 * accepted exceptions, `{ id, metric, value, reason }`. A violation passes only if an entry with its id and metric
 * accepts a value at least as large: new or worse violations fail; an entry with slack, or with nothing left to
 * accept, warns. Unknown keys are errors.
 *
 * `--only` keeps ids starting with a prefix (`clip:`, `action:`, `prop:`); repeat it or join prefixes with commas.
 * Usage: node x qa <family…> [--only <prefix>]. Exit 0, 1 on a new or worse violation, 2 for an unknown family.
 * @see tools/cmd/qa.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Finding } from '../lib/report';
import { closest, UsageError, type Command, type CommandResult } from '../x';

/** One violation a family found; a larger `value` is worse. */
export interface QaViolation {
  /** The item, namespaced by kind: `clip:walk`, `prop:crate`, `level:hall`. */
  id: string;
  /** What was measured: `pop`, `footSlide`, `seamDelta`. */
  metric: string;
  value: number;
  /** The sentence an agent reads: expected, actual, where, likely fix. */
  message: string;
  file?: string;
  line?: number;
}

/** What a family is given: the repository root and the id prefixes to keep (empty: every id). */
export interface QaContext {
  root: string;
  only: string[];
}

/** A QA family: the default export of `tools/qa/<family>.ts`. */
export interface QaFamily {
  run(context: QaContext): QaViolation[] | Promise<QaViolation[]>;
}

/** An accepted exception in `tests/baselines/qa-<family>[-<area>].json`. */
export interface QaBaseline {
  id: string;
  metric: string;
  value: number;
  /** Why it is accepted. A baseline changes only with a written reason. */
  reason: string;
}

const BASELINE_KEYS = ['id', 'metric', 'value', 'reason'];
const FAMILIES = 'level (WP 2.2), tex (2.3), geo (2.4), anim (6.6) and audio (9.4)';

/** The families in `tools/qa/`, by file name. */
export function qaFamilies(root: string): string[] {
  const dir = join(root, 'tools', 'qa');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => file.slice(0, -3))
    .sort();
}

/** Loads `tools/qa/<family>.ts`'s default export. */
export async function loadFamily(root: string, family: string): Promise<QaFamily> {
  const file = join(root, 'tools', 'qa', `${family}.ts`);
  const module = (await import(pathToFileURL(file).href)) as { default?: Partial<QaFamily> };
  if (typeof module.default?.run !== 'function') {
    throw new Error(`tools/qa/${family}.ts must export default a QaFamily ({ run(context) })`);
  }
  return module.default as QaFamily;
}

/** Reads every baseline file of `family`, with a failure per malformed file or entry. */
export function readBaselines(root: string, family: string): { entries: QaBaseline[]; failures: Finding[] } {
  const dir = join(root, 'tests', 'baselines');
  const entries: QaBaseline[] = [];
  const failures: Finding[] = [];
  const name = new RegExp(`^qa-${family}(-[a-z0-9-]+)?\\.json$`);
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => name.test(file)) : [];
  for (const file of files.sort()) {
    const path = `tests/baselines/${file}`;
    const fail = (message: string) => failures.push({ id: 'QA_BASELINE', message, file: path });
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      fail(`${path} is not valid JSON: ${(error as Error).message}`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      fail(`${path} must be a JSON array of { id, metric, value, reason }`);
      continue;
    }
    parsed.forEach((entry: Record<string, unknown>, i) => {
      const at = `${path}[${i}]`;
      const unknown = Object.keys(entry ?? {}).filter((key) => !BASELINE_KEYS.includes(key));
      for (const key of unknown) {
        const near = closest(key, BASELINE_KEYS);
        fail(
          `${at} has an unknown key "${key}"${near ? `: did you mean "${near}"?` : ''} (keys: id, metric, value, reason)`,
        );
      }
      const { id, metric, value, reason } = entry ?? {};
      if (
        typeof id !== 'string' ||
        typeof metric !== 'string' ||
        typeof value !== 'number' ||
        typeof reason !== 'string' ||
        !reason.trim()
      ) {
        return fail(`${at} needs an id, a metric, a numeric value and a reason`);
      }
      if (unknown.length === 0) entries.push({ id, metric, value, reason });
    });
  }
  return { entries, failures };
}

/** Whether `id` passes the `only` prefixes. */
const kept = (id: string, only: readonly string[]) => only.length === 0 || only.some((prefix) => id.startsWith(prefix));

/** Compares a family's violations with its baselines: failures for new or worse ones, warnings for slack entries. */
export function compareWithBaselines(
  family: string,
  violations: readonly QaViolation[],
  baselines: readonly QaBaseline[],
  only: readonly string[] = [],
): { failures: Finding[]; warnings: Finding[]; accepted: number } {
  const key = (item: { id: string; metric: string }) => `${item.id}\u0000${item.metric}`;
  const accepted = new Map(baselines.filter((entry) => kept(entry.id, only)).map((entry) => [key(entry), entry]));
  const failures: Finding[] = [];
  const warnings: Finding[] = [];
  let passed = 0;
  const seen = new Set<string>();
  for (const violation of violations.filter((item) => kept(item.id, only))) {
    const entry = accepted.get(key(violation));
    seen.add(key(violation));
    const where = { file: violation.file, line: violation.line };
    if (!entry) {
      failures.push({
        id: `QA_${family.toUpperCase()}`,
        message: `${violation.id} ${violation.metric}: ${violation.message}`,
        ...where,
      });
    } else if (violation.value > entry.value) {
      const message = `${violation.id} ${violation.metric} got worse: ${violation.value} > the accepted ${entry.value} (${entry.reason}): ${violation.message}`;
      failures.push({ id: `QA_${family.toUpperCase()}_WORSE`, message, ...where });
    } else {
      passed++;
      if (violation.value < entry.value) {
        const message = `${violation.id} ${violation.metric} improved to ${violation.value} (accepted ${entry.value}): tighten its entry in tests/baselines/qa-${family}*.json`;
        warnings.push({ id: 'QA_BASELINE_SLACK', message });
      }
    }
  }
  for (const [entryKey, entry] of accepted) {
    if (seen.has(entryKey)) continue;
    const message = `${entry.id} ${entry.metric} no longer fails: remove its entry from tests/baselines/qa-${family}*.json`;
    warnings.push({ id: 'QA_BASELINE_STALE', message });
  }
  return { failures, warnings, accepted: passed };
}

/** Runs one family against its baselines; T1 tests call this (`expect((await runQa(ROOT, 'level')).failures)…`). */
export async function runQa(
  root: string,
  family: string,
  only: readonly string[] = [],
  load: (root: string, family: string) => Promise<QaFamily> = loadFamily,
): Promise<{ failures: Finding[]; warnings: Finding[]; violations: number; accepted: number }> {
  const violations = await (await load(root, family)).run({ root, only: [...only] });
  const baselines = readBaselines(root, family);
  const compared = compareWithBaselines(family, violations, baselines.entries, only);
  return {
    failures: [...baselines.failures, ...compared.failures],
    warnings: compared.warnings,
    violations: violations.filter((item) => kept(item.id, only)).length,
    accepted: compared.accepted,
  };
}

export default {
  usage: 'qa <family…> [--only <prefix>]',
  options: { only: { type: 'string', multiple: true } },
  maxPositionals: 5,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const available = qaFamilies(root);
    const listed = available.length ? available.join(', ') : `none yet; they arrive with their WPs: ${FAMILIES}`;
    if (positionals.length === 0) throw new UsageError(`name a QA family (families: ${listed})`);
    for (const family of positionals) {
      if (available.includes(family)) continue;
      const near = closest(family, available);
      throw new UsageError(
        `there is no QA family "${family}"${near ? `: did you mean ${near}?` : ''} (families: ${listed})`,
      );
    }
    const only = ((values.only as string[] | undefined) ?? []).flatMap((value) => value.split(',')).filter(Boolean);
    const failures: Finding[] = [];
    const warnings: Finding[] = [];
    const metrics: Record<string, number> = {};
    const lines: string[] = [];
    for (const family of positionals) {
      const result = await runQa(root, family, only);
      failures.push(...result.failures);
      warnings.push(...result.warnings);
      Object.assign(metrics, { [`${family}.violations`]: result.violations, [`${family}.accepted`]: result.accepted });
      lines.push(
        `${family}: ${result.failures.length ? 'FAIL' : 'ok'}, ${result.violations} violations, ${result.accepted} accepted by the baseline`,
      );
    }
    return {
      ok: failures.length === 0,
      target: positionals.join('-'),
      summary: `${positionals.join(', ')}: ${failures.length ? `${failures.length} new or worse` : 'within the baselines'}`,
      lines,
      failures,
      warnings,
      metrics,
    };
  },
} satisfies Command;
