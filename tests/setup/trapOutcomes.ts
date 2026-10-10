/**
 * @file What the advice trap's fixture tests must give in either harness (WP 0.5): every `passes:` test passed, and
 * every `fails:` test failed through the trap, naming what it printed and the allow-list fix. The Vitest half runs
 * in T1 (tests/setup/harnesses.test.ts), the Playwright half, which drives Chromium, in T2
 * (tests/e2e/adviceTrap.spec.ts); both hand their runner's `expect` to `expectTrapOutcomes` (ADR-0014 amendment 7).
 */

/** What the trap must print for each `fails:` fixture, by test name. */
export const PRINTED: Record<string, string> = {
  'fails: an unlisted advice code': 'console.info "[TRAP_UNLISTED] nobody listed this code"',
  'fails: an unlisted console.warn': 'console.warn "a plain warning nobody listed"',
  'fails: a three.js deprecation': 'console.log "THREE.Fixture: .old() is deprecated. Use .new() instead."',
};

/** One fixture test's outcome, read from its harness's JSON report. */
export interface TrapOutcome {
  title: string;
  ok: boolean;
  message: string;
}

/** The matchers `expectTrapOutcomes` uses, as Vitest's and Playwright's `expect` both provide them. */
export type TrapExpect = (
  actual: unknown,
  message?: string,
) => { toBe(expected: unknown): void; toContain(expected: string): void; toHaveLength(length: number): void };

/** Checks one harness's outcomes: `passes:` tests passed, `fails:` tests (`fails` of them) failed with the trap's message. */
export function expectTrapOutcomes(expect: TrapExpect, outcomes: TrapOutcome[], fails: number): void {
  expect(outcomes.filter((outcome) => outcome.title.startsWith('fails:'))).toHaveLength(fails);
  for (const { title, ok, message } of outcomes) {
    if (title.startsWith('passes:')) expect(ok, `${title}: ${message}`).toBe(true);
    else {
      expect(ok, `${title} passed, but the trap should have failed it`).toBe(false);
      expect(message).toContain('unlisted warning');
      expect(message).toContain(PRINTED[title]);
      expect(message).toContain('tests/baselines/advice/<area>.json');
    }
  }
}
