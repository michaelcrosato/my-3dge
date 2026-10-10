/**
 * @file Error and advice codes, warn-once advice and structured errors (PLAN.md WP 1.2, §6.8; doctrine:
 * Agent-operable): every message the engine prints carries a stable code and names its fix in public-API terms.
 *
 * Each module registers its own codes beside the code that raises them, `defineCodes('<area>', { AREA_NAME: {
 * template, fix, doc } })`, with literal arguments: `x docs` reads those calls statically into docs/ERRORS.md
 * (tools/lib/docsCodes.ts gives the form), so there is no central table. At run time the call returns its table,
 * typed, and records each code, so `codeError`, `warnOnce` and `error` can fill its template (`{name}` marks a value).
 *
 * Invariants: a printed or thrown message is `[CODE] message: fix`, the form the advice trap reads
 * (tests/setup/adviceTrap.ts). Advice prints through `console.warn` once per distinct message and counts the
 * repeats; errors print through `console.error` once per distinct message and are all recorded, up to `maxErrors`.
 * `advice` and `errors` are what `__engine.advice` and `__engine.errors` show (PLAN.md §8.3). A code is upper-case
 * words starting with its area's (`CORE_` in area `core`), registered once; registering it again with other text,
 * or using a code nobody registered, throws.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:65` (warn-once), with codes, fixes and records added.
 *
 * @example
 * const codes = defineCodes('demo', { DEMO_SLOW: { template: '{what} took {ms} ms', fix: 'cache {what}' } });
 * const printed: string[] = [];
 * const quiet = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
 * quiet.warnOnce('DEMO_SLOW', { what: 'the bake', ms: 40 });
 * quiet.warnOnce('DEMO_SLOW', { what: 'the bake', ms: 40 }); // counted, not printed again
 * printed; // ['[DEMO_SLOW] the bake took 40 ms: cache the bake']
 * codeError('DEMO_SLOW', { what: 'x', ms: 1 }).code; // 'DEMO_SLOW'
 * codes.DEMO_SLOW.fix; // 'cache {what}'
 * @see engine/core/log.test.ts
 */

/** One code's text: the message (`{name}` marks a value), what to do about it, and more detail for docs/ERRORS.md. */
export interface CodeText {
  template: string;
  fix: string;
  doc?: string;
}

/** A registered code: its text, its name and its area. */
export interface CodeInfo extends CodeText {
  code: string;
  area: string;
}

/** The values a template's `{name}` markers are filled with. */
export type CodeValues = Readonly<Record<string, unknown>>;

/** Every code registered so far, by name. */
const CODES = new Map<string, CodeInfo>();

/** The codes this module raises, with their fixes. */
export const LOG_CODES = defineCodes('core', {
  CORE_BAD_CODE: {
    template: '{problem}',
    fix: "register each code once, beside the code that raises it: defineCodes('<area>', { AREA_NAME: { template, fix, doc } }), the name in upper-case words starting with the area's",
    doc: 'Raised by `defineCodes` (engine/core/log.ts) for an area that is not one lower-case word, a code that does not start with its area, a template or fix that is empty, or a code registered again with other text. `x docs --check` reports the same problems statically.',
  },
  CORE_UNKNOWN_CODE: {
    template: 'no module registered the code {code}{suggestion}',
    fix: "register it with defineCodes('<area>', { … }) in the module that raises it, or use the code docs/ERRORS.md lists",
    doc: 'Raised by `codeError`, `warnOnce` and `error` (engine/core/log.ts) when the code was never registered, usually a typo or a module that raises a code before its `defineCodes` call ran.',
  },
});

/**
 * Registers a module's codes and returns the table as given, typed. Write it with literal arguments, as
 * tools/lib/docsCodes.ts reads it; throws `CORE_BAD_CODE` for a malformed code or one registered again with other text.
 */
export function defineCodes<const T extends Record<string, CodeText>>(area: string, codes: T): T {
  const bad = (problem: string): never => {
    throw codeError('CORE_BAD_CODE', { problem });
  };
  if (!/^[a-z][a-z0-9]*$/.test(area)) bad(`the area "${area}" is not one lower-case word`);
  for (const [code, text] of Object.entries(codes)) {
    if (!new RegExp(`^${area.toUpperCase()}(_[A-Z0-9]+)+$`).test(code)) {
      bad(`the code ${code} must be upper-case words joined by _, starting with ${area.toUpperCase()}_`);
    }
    if (!text?.template?.trim() || !text.fix?.trim()) bad(`the code ${code} needs a template and a fix`);
    const known = CODES.get(code);
    if (known && (known.template !== text.template || known.fix !== text.fix || known.area !== area)) {
      bad(`the code ${code} is already registered with other text`);
    }
    CODES.set(code, { code, area, ...text });
  }
  return codes;
}

/** The registered code `code`, or undefined. */
export function codeInfo(code: string): CodeInfo | undefined {
  return CODES.get(code);
}

/** Every registered code, sorted by name. */
export function listCodes(): CodeInfo[] {
  return [...CODES.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** `template` with each `{name}` replaced by `values.name` (a marker without a value stays as written). */
export function fill(template: string, values: CodeValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (marker, name: string) => (name in values ? String(values[name]) : marker));
}

/** The registered code, or `CORE_UNKNOWN_CODE` thrown with the closest registered name. */
function lookup(code: string): CodeInfo {
  const info = CODES.get(code);
  if (info) return info;
  throw codeError('CORE_UNKNOWN_CODE', { code, suggestion: didYouMean(code, CODES.keys()) });
}

/** A thrown engine error: its code, the filled message, the code's fix and the values that filled it. */
export class EngineError extends Error {
  override name = 'EngineError';
  /** The code, as docs/ERRORS.md lists it. */
  readonly code: string;
  /** The code's area: `core`, `gfx`… */
  readonly area: string;
  /** What to do about it, from the code's `fix`, filled. */
  readonly fix: string;
  /** The values that filled the template. */
  readonly values: CodeValues;

  /** Fills `code`'s template and fix with `values`; the message is `[CODE] message: fix`. */
  constructor(code: string, values: CodeValues = {}, options?: { cause?: unknown }) {
    const info = lookup(code);
    const fix = fill(info.fix, values);
    super(`[${code}] ${fill(info.template, values)}: ${fix}`, options);
    this.code = code;
    this.area = info.area;
    this.fix = fix;
    this.values = values;
  }
}

/** An `EngineError` for `code`, to throw: `throw codeError('CORE_NO_ENTRY', { kind, id })`. */
export function codeError(code: string, values: CodeValues = {}, cause?: unknown): EngineError {
  return new EngineError(code, values, cause === undefined ? undefined : { cause });
}

/** Edit distance between two strings, a swap of neighbours counting as one edit (optimal string alignment). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/**
 * The candidates closest to `wanted`, best first, at most `count`: a case-insensitive match, then names one starts
 * with the other or ending in `.wanted` (`runSpeed` finds `hero.runSpeed`), then those a few edits away (one per
 * three letters, at least one; a swap of neighbours is one edit).
 */
export function closest(wanted: string, candidates: Iterable<string>, count = 3): string[] {
  const lower = wanted.toLowerCase();
  const scored: [number, string][] = [];
  for (const candidate of candidates) {
    const name = candidate.toLowerCase();
    const edits = distance(lower, name);
    const related = name.startsWith(lower) || lower.startsWith(name) || name.endsWith(`.${lower}`);
    if (name === lower) scored.push([0, candidate]);
    else if (related && lower.length >= 2) scored.push([1 + edits / 100, candidate]);
    else if (edits <= Math.max(1, Math.floor(lower.length / 3))) scored.push([2 + edits, candidate]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return scored.slice(0, count).map(([, candidate]) => candidate);
}

/** ` (did you mean "a" or "b"?)` for the names closest to `wanted`, or `''` when none is close. */
export function didYouMean(wanted: string, candidates: Iterable<string>): string {
  const near = closest(wanted, candidates).map((name) => JSON.stringify(name));
  if (!near.length) return '';
  return ` (did you mean ${near.length === 1 ? near[0] : `${near.slice(0, -1).join(', ')} or ${near.at(-1)}`}?)`;
}

/** One piece of advice the log printed: its code, message and fix, and how often it was raised. */
export interface AdviceRecord {
  code: string;
  message: string;
  fix: string;
  count: number;
}

/** One structured error: its code, message, fix and values, how often it happened, and its cause when there was one. */
export interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
  values: CodeValues;
  count: number;
  cause?: { name: string; message: string; stack?: string };
}

/** Where a log prints; tests pass their own to keep the console quiet. */
export interface LogConsole {
  warn(line: string): void;
  error(line: string, cause?: unknown): void;
}

/** Warn-once advice and structured errors, with what was raised kept for `__engine.advice` and `__engine.errors`. */
export interface Log {
  /** The advice raised so far, one record per distinct message, in order. */
  readonly advice: readonly AdviceRecord[];
  /** The errors recorded so far, one record per distinct message, the latest `maxErrors`, in order. */
  readonly errors: readonly ErrorRecord[];
  /** Raises advice: prints `[CODE] message: fix` once per distinct message and counts repeats; true when it printed. */
  warnOnce(code: string, values?: CodeValues): boolean;
  /** Records an error, printing it the first time its message occurs; `cause` is the thrown value behind it. */
  error(code: string, values?: CodeValues, cause?: unknown): ErrorRecord;
  /** Forgets the advice and errors, so each prints again. */
  clear(): void;
}

/** How a log is made: where it prints (the console by default) and how many errors it keeps (200). */
export interface LogOptions {
  console?: LogConsole;
  maxErrors?: number;
}

/** A thrown value as plain data. */
function causeOf(cause: unknown): ErrorRecord['cause'] {
  if (cause instanceof Error) return { name: cause.name, message: cause.message, stack: cause.stack };
  return { name: typeof cause, message: String(cause) };
}

/** Makes a log; `log` is the engine's shared one. */
export function createLog(options: LogOptions = {}): Log {
  const out = options.console ?? console;
  const maxErrors = options.maxErrors ?? 200;
  const advice: AdviceRecord[] = [];
  const errors: ErrorRecord[] = [];
  const adviceSeen = new Map<string, AdviceRecord>();
  const errorSeen = new Map<string, ErrorRecord>();
  return {
    advice,
    errors,
    warnOnce(code, values = {}) {
      const info = lookup(code);
      const message = fill(info.template, values);
      const key = `${code}\0${message}`;
      const seen = adviceSeen.get(key);
      if (seen) {
        seen.count++;
        return false;
      }
      const record: AdviceRecord = { code, message, fix: fill(info.fix, values), count: 1 };
      adviceSeen.set(key, record);
      advice.push(record);
      out.warn(`[${code}] ${message}: ${record.fix}`);
      return true;
    },
    error(code, values = {}, cause) {
      const info = lookup(code);
      const message = fill(info.template, values);
      const key = `${code}\0${message}`;
      const seen = errorSeen.get(key);
      if (seen && errors.includes(seen)) {
        seen.count++;
        return seen;
      }
      const record: ErrorRecord = { code, message, fix: fill(info.fix, values), values, count: 1 };
      if (cause !== undefined) record.cause = causeOf(cause);
      errorSeen.set(key, record);
      errors.push(record);
      if (errors.length > maxErrors) errors.splice(0, errors.length - maxErrors);
      if (!seen) out.error(`[${code}] ${message}: ${record.fix}`, ...(cause === undefined ? [] : [cause]));
      return record;
    },
    clear() {
      advice.length = 0;
      errors.length = 0;
      adviceSeen.clear();
      errorSeen.clear();
    },
  };
}

/** The engine's shared log: registry, events and settings report through it unless given another. */
export const log: Log = createLog();
