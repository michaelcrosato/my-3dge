/**
 * @file The advice trap (PLAN.md §8.2, WP 0.5): a test fails when it prints an engine advice code, a `console.warn` or
 * a three.js deprecation that no file under `tests/baselines/advice/` lists. One module serves both harnesses:
 * Vitest runs it as its setup file (vite.config.ts), and the e2e fixture (tests/e2e/fixtures.ts) checks each page's
 * console with `findUnlisted`.
 *
 * What it traps:
 * - **an engine advice line**, at any console level: the message starts with `[CODE]`, where CODE is upper-case
 *   words joined by `_`, area first: `[GFX_NO_TIMESTAMP] timestamp-query is missing: gpuMs is absent`. The engine's
 *   log (WP 1.2) prints advice in this form, through `console.warn`;
 * - **a three.js deprecation**, at any level: `THREE.…deprecated…` (r182 prints them through `console.warn`);
 * - **any `console.warn`**, from the engine, a dependency or the browser.
 *
 * **The allow list** is every `*.json` file in `tests/baselines/advice/`: one file per area, owned by the WP that
 * adds its entries, each an array of `{ code, reason }` (both non-empty strings; any other key is an error). An entry
 * lists an advice line by its code, exactly, and any other warning by a text its message contains.
 *
 * Invariants: a test that provokes a warning on purpose handles it, so the trap never sees it: in Vitest it spies on
 * the console (`vi.spyOn(console, 'warn').mockImplementation(() => {})`), in the e2e fixture it reads
 * `harness.advice()`. In Vitest a warning printed outside any test (a module's top level, `beforeAll`) fails the file
 * in `afterAll`. The Vitest hooks install only inside a Vitest worker (`VITEST_WORKER_ID` set, `TEST_WORKER_INDEX`
 * unset); a Vitest test that starts Playwright Test removes the `VITEST_*` variables from the child's environment.
 *
 * @example
 * const allowed = loadAllowList(); // every entry of tests/baselines/advice/*.json
 * const caught = findUnlisted([{ type: 'warning', text: '[GFX_NO_TIMESTAMP] timestamp-query is missing' }], allowed);
 * const why = describeUnlisted(caught); // names GFX_NO_TIMESTAMP and where to list it; the trap throws this
 * @see tests/setup/adviceTrap.test.ts
 * @see tests/setup/harnesses.test.ts
 * @see tests/e2e/adviceTrap.spec.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

/** The repository root, two levels above this file. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The allow list's directory: every `*.json` file in it is read. */
export const ADVICE_DIR = join(ROOT, 'tests', 'baselines', 'advice');

/** An engine advice line: `[AREA_WORDS] message`; group 1 is the code. */
export const ADVICE_CODE = /^\s*\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/;

/** A three.js deprecation, whatever its level: three.js prefixes its messages with `THREE.`. */
export const THREE_DEPRECATION = /^\s*THREE\.[\s\S]*\bdeprecated\b/i;

/** A console message the trap caught. */
export interface Warning {
  /** The console method: `warn`, `log`, `info`, `debug` or `error` (a browser's `warning` reads as `warn`). */
  level: string;
  text: string;
  /** The advice code, for an engine advice line. */
  code?: string;
  /** Where it was printed, when known: `engine/gfx/renderer.ts:120:7` or a served URL and line. */
  where?: string;
}

/** One allow-list entry, with the file that lists it. */
export interface AllowEntry {
  /** An advice code (`GFX_NO_TIMESTAMP`), or a text an uncoded warning's message contains. */
  code: string;
  /** Why the warning is expected. */
  reason: string;
  /** The listing file, relative to the repository root. */
  file: string;
}

/** A console message as either harness records it: `type` is a console method or a browser's message type. */
export interface ConsoleLine {
  type: string;
  text: string;
  /** The page URL or file that printed it, when known. */
  url?: string;
  line?: number;
}

/** The trap's verdict on one console message: a `Warning` when it is advice, a deprecation or a `console.warn`. */
export function trap(type: string, text: string, where?: string): Warning | undefined {
  const level = type === 'warning' ? 'warn' : type;
  const code = ADVICE_CODE.exec(text)?.[1];
  if (code === undefined && level !== 'warn' && !THREE_DEPRECATION.test(text)) return undefined;
  return { level, text, ...(code === undefined ? {} : { code }), ...(where === undefined ? {} : { where }) };
}

/** Reads and checks every `*.json` file in `dir`; a malformed file throws, naming the file, the entry and the fix. */
export function loadAllowList(dir: string = ADVICE_DIR): AllowEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: AllowEntry[] = [];
  for (const name of names.sort()) {
    const file = relative(ROOT, join(dir, name));
    const fix = `each entry is { "code": "AREA_CODE or warning text", "reason": "why it is expected" } (tests/baselines/advice/README.md)`;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (error) {
      throw new Error(`${file} is not valid JSON (${(error as Error).message}): ${fix}`);
    }
    if (!Array.isArray(data)) throw new Error(`${file} must hold an array of entries: ${fix}`);
    data.forEach((entry: unknown, index) => {
      const at = `${file}, entry ${index + 1}`;
      if (typeof entry !== 'object' || entry === null) throw new Error(`${at} is not an object: ${fix}`);
      const extra = Object.keys(entry).filter((key) => key !== 'code' && key !== 'reason');
      if (extra.length) throw new Error(`${at} has the unknown key "${extra[0]}": ${fix}`);
      const { code, reason } = entry as Record<string, unknown>;
      for (const [key, value] of [['code', code] as const, ['reason', reason] as const]) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${at} lacks a non-empty "${key}": ${fix}`);
      }
      entries.push({ code: code as string, reason: reason as string, file });
    });
  }
  return entries;
}

/** The entry that lists `warning`: its code exactly for an advice line, a contained text for any other warning. */
export function listing(warning: Warning, allowed: readonly AllowEntry[]): AllowEntry | undefined {
  return allowed.find((entry) =>
    warning.code === undefined ? warning.text.includes(entry.code) : entry.code === warning.code,
  );
}

/** The trapped messages among `lines` that `allowed` does not list, in order. */
export function findUnlisted(lines: readonly ConsoleLine[], allowed: readonly AllowEntry[]): Warning[] {
  const caught: Warning[] = [];
  for (const line of lines) {
    const where = line.url ? `${line.url}${line.line ? `:${line.line}` : ''}` : undefined;
    const warning = trap(line.type, line.text, where);
    if (warning && !listing(warning, allowed)) caught.push(warning);
  }
  return caught;
}

/** One message naming every unlisted warning, where it was printed, and the two fixes. */
export function describeUnlisted(caught: readonly Warning[], context = ''): string {
  const shown = caught.slice(0, 5).map((warning) => {
    const text = warning.text.length > 160 ? `${warning.text.slice(0, 157)}...` : warning.text;
    return `console.${warning.level} ${JSON.stringify(text)}${warning.where ? ` at ${warning.where}` : ''}`;
  });
  if (caught.length > 5) shown.push(`and ${caught.length - 5} more`);
  const first = caught[0];
  const code = first?.code ?? first?.text.slice(0, 60) ?? '';
  return (
    `${caught.length} unlisted warning${caught.length === 1 ? '' : 's'}${context}: ${shown.join('; ')}. ` +
    `Fix the cause, or list it with a reason in tests/baselines/advice/<area>.json as ` +
    `{ "code": ${JSON.stringify(code)}, "reason": "why it is expected" } (tests/baselines/advice/README.md)`
  );
}

/** The first stack frame outside this file and node_modules: where a console method was called. */
function caller(stack: string | undefined): string | undefined {
  const here = fileURLToPath(import.meta.url);
  for (const frame of (stack ?? '').split('\n').slice(1)) {
    const at = /\(?((?:file:\/\/)?\/[^()\s]+?):(\d+):(\d+)\)?$/.exec(frame.trim());
    if (!at) continue;
    const file = at[1].replace(/^file:\/\//, '');
    if (file === here || file.includes('/node_modules/') || file.startsWith('node:')) continue;
    return `${relative(ROOT, file)}:${at[2]}:${at[3]}`;
  }
  return undefined;
}

/** The console methods the trap watches. */
const LEVELS = ['warn', 'log', 'info', 'debug', 'error'] as const;

/** Wraps `target`'s methods so each trapped message reaches `sink` before it prints; returns the unwrap function. */
export function watchConsole(target: Console, sink: (warning: Warning) => void): () => void {
  const originals = LEVELS.map((level) => target[level]);
  LEVELS.forEach((level, index) => {
    const original = originals[index];
    target[level] = function (this: Console, ...args: unknown[]) {
      const warning = trap(level, format(...args), caller(new Error().stack));
      if (warning) sink(warning);
      return original.apply(this, args);
    };
  });
  return () => LEVELS.forEach((level, index) => (target[level] = originals[index]));
}

/** Installs the trap in this Vitest worker: each test fails on its unlisted warnings, the file on stray ones. */
async function installInVitest(): Promise<void> {
  const { afterAll, afterEach, beforeEach } = await import('vitest');
  const allowed = loadAllowList();
  const caught: Warning[] = [];
  const outside: Warning[] = [];
  watchConsole(console, (warning) => {
    if (!listing(warning, allowed)) caught.push(warning);
  });
  beforeEach(() => {
    outside.push(...caught.splice(0));
  });
  afterEach(() => {
    const mine = caught.splice(0);
    if (mine.length) throw new Error(describeUnlisted(mine, ' during this test'));
  });
  afterAll(() => {
    outside.push(...caught.splice(0));
    if (outside.length) throw new Error(describeUnlisted(outside, ' outside any test of this file'));
  });
}

if (process.env.VITEST_WORKER_ID !== undefined && process.env.TEST_WORKER_INDEX === undefined) await installInVitest();
