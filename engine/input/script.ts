/**
 * @file The input script grammar (PLAN.md WP 3.3, §5.8; doctrine: Agent-operable): shardfall's scripted gamepad, one
 * line per stretch of time, `<count> key=value key=value …` with `#` comments. Two vocabularies use it: the scripted
 * gamepad of the tests (engine/input/devices/padScript.ts: `30 left=0,-1 hold=South`, a count of frames) and the
 * virtual device's `__engine.input.play` (engine/input/devices/virtual.ts: `30 move=0,1 hold=sprint tap=jump`, a
 * count of sim steps). Each says which keys it takes and how each value reads.
 *
 * Invariants: a line is a whole number from 1, then keys; a key appears once per line; every problem in the text is
 * reported at once as `INPUT_BAD_SCRIPT`, naming its line, the key and the closest known key.
 *
 * Carried from `shardfall:crates/pav_app/src/input.rs:299-380` (`PadScript::parse`).
 *
 * @example
 * const keys = { hold: names, left: numbers(2) };
 * parseScript('# walk, then jump\n30 left=0,-1\n1 hold=South', keys);
 * // [{ count: 30, line: 2, values: { left: [0, -1] } }, { count: 1, line: 3, values: { hold: ['South'] } }]
 * @see engine/input/script.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';

/** The codes this module raises, with their fixes. */
export const SCRIPT_CODES = defineCodes('input', {
  INPUT_BAD_SCRIPT: {
    template: '{where}: {problems}',
    fix: 'write one line per stretch: "<count> key=value …" (a whole count from 1, keys as listed, "#" starts a comment), e.g. "30 move=0,1 hold=sprint tap=jump"',
    doc: 'Raised by the input scripts (engine/input/script.ts): the scripted gamepad of the tests and `__engine.input.play`. Every bad line is named with its problem.',
  },
});

/** Reads one value, or returns a problem as a string. */
export type ValueReader = (text: string) => { value: unknown } | string;

/** One line of a script: how many frames or steps it lasts, its values by key, and its line number (from 1). */
export interface ScriptLine {
  count: number;
  line: number;
  values: Record<string, unknown>;
}

/** Reads a comma-separated list of names: `South,North`. */
export const names: ValueReader = (text) => {
  const list = text.split(',').map((name) => name.trim());
  return list.every(Boolean) ? { value: list } : `"${text}" holds an empty name`;
};

/** Reads `n` comma-separated finite numbers: `0,-1`. */
export function numbers(n: number): ValueReader {
  return (text) => {
    const list = text.split(',').map((part) => (part.trim() === '' ? NaN : Number(part)));
    if (list.length !== n || !list.every(Number.isFinite)) return `"${text}" is not ${n} number${n > 1 ? 's' : ''}`;
    return { value: n === 1 ? list[0] : list };
  };
}

/** Parses `text` with `keys` (key → reader); `match` admits extra keys by pattern (`game:charge`). */
export function parseScript(
  text: string,
  keys: Readonly<Record<string, ValueReader>>,
  where = 'the script',
  match?: { pattern: RegExp; read: ValueReader },
): ScriptLine[] {
  const lines: ScriptLine[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((raw, i) => {
    const body = raw.split('#')[0].trim();
    if (!body) return;
    const [first, ...words] = body.split(/\s+/);
    const count = Number(first);
    const at = `line ${i + 1}`;
    if (!/^\d+$/.test(first) || count < 1) return void problems.push(`${at} starts with "${first}", not a count`);
    const values: Record<string, unknown> = {};
    for (const word of words) {
      const cut = word.indexOf('=');
      const key = cut < 0 ? word : word.slice(0, cut);
      const read = Object.hasOwn(keys, key) ? keys[key] : match?.pattern.test(key) ? match.read : undefined;
      if (!read) problems.push(`${at}: unknown key "${key}"${didYouMean(key, Object.keys(keys))}`);
      else if (cut < 0) problems.push(`${at}: ${key} needs a value (${key}=…)`);
      else if (Object.hasOwn(values, key)) problems.push(`${at}: ${key} is given twice`);
      else {
        const result = read(word.slice(cut + 1));
        if (typeof result === 'string') problems.push(`${at}: ${key}: ${result}`);
        else values[key] = result.value;
      }
    }
    lines.push({ count, line: i + 1, values });
  });
  if (problems.length) throw codeError('INPUT_BAD_SCRIPT', { where, problems: problems.join('; ') });
  return lines;
}
