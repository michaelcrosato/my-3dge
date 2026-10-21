/**
 * @file Tests for `x feel` (tools/cmd/feel.ts): a lab is named by its directory or its name; a tolerance and a miss read
 * as sentences; the playground's courses run headless within their tolerances, each with its own report, in at most
 * 20 lines; and a missing lab, a lab without courses or an unknown course name is a usage error naming what there is.
 * @see tools/cmd/feel.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT_MS, dispatch, ROOT } from '../x';
import { labOf, missText, toleranceText } from './feel';

/** Runs `node x feel …` in this repository; resolves to the exit code and printed lines. */
async function feel(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await dispatch(['feel', ...args], { print: (line) => lines.push(line) });
  return { code, lines };
}

describe('x feel', () => {
  it('names a lab by its directory or its name, and reads tolerances and misses as sentences', () => {
    expect(labOf(ROOT, 'labs/playground/')).toEqual({ lab: 'playground', dir: 'labs/playground' });
    expect(labOf(ROOT, 'playground').dir).toBe('labs/playground');
    expect(() => labOf(ROOT, 'labs/nothing')).toThrow(/is no lab \(labs: .*playground/);
    expect([toleranceText({ share: 0.02 }), toleranceText({ abs: 0.3 }), toleranceText({ ticks: 1, share: 0.05 })]).toEqual(['±2%', '±0.3', '±5% or ±1 tick']); // prettier-ignore
    const miss = { name: 'sprint', metric: 'topSpeed', value: 7.1234, reference: 7.59, off: -0.47, tolerance: { share: 0.02 }, pass: false } as const; // prettier-ignore
    expect(missText('strip', miss)).toBe('strip: sprint (topSpeed) is 7.123 against 7.59 ±2%');
  });

  // The whole command's work, every course with its five cameras (WP 13.8): 15 s alone, over 30 s in a full run.
  it(
    'runs the playground’s courses within their tolerances, each with its own report',
    { timeout: CHILD_TIMEOUT_MS },
    async () => {
      const { code, lines } = await feel('labs/playground');
      expect(lines.join('\n'), lines.join('\n')).toMatch(/^x feel: ok: labs\/playground: \d+ courses, \d+ measures, all within their tolerances/); // prettier-ignore
      expect(code).toBe(0);
      expect(lines.length).toBeLessThanOrEqual(20);
      const report = JSON.parse(readFileSync(join(ROOT, 'out/feel/playground-strip/report.json'), 'utf8'));
      expect(report.ok).toBe(true);
      expect(report.metrics['run.pass']).toBe(true);
      expect(report.metrics['run.tolerance']).toBe('±2%');
    },
  );

  it('refuses a missing lab and an unknown course, naming what there is', async () => {
    const none = await feel('labs/nothing');
    expect(none.code).toBe(2);
    const unknown = await feel('labs/playground', '--course', 'strp');
    expect(unknown.code).toBe(2);
    expect(unknown.lines.join('\n')).toMatch(/has no course strp \(did you mean strip\?/);
    const bare = await feel('labs/box');
    expect(bare.lines.join('\n')).toMatch(/labs\/box\/courses\/ defines no course/);
  });
});
