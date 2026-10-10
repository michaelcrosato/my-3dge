/**
 * @file Tests for `x perf` (tools/cmd/perf.ts): medians, the budget file's shape (unknown keys named with the closest),
 * a measured run of the kernel within its recorded budget, and, on a scene in a temporary repository, `--budget`
 * failing over a budget and without a budget file, measuring at the file's steps, and refusing a run that is not the
 * one the budget was measured on (other steps, another scene, `--set`).
 * @see tools/cmd/perf.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, loadCommand, ROOT } from '../x';
import { median, readBudget } from './perf';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `node x perf …` against `root`; resolves to the exit code, lines and report. */
async function perf(root: string, ...args: string[]) {
  const lines: string[] = [];
  const commands = { perf: () => loadCommand(ROOT, 'perf') };
  const code = await dispatch(['perf', ...args], { root, commands, print: (line) => lines.push(line) });
  const path = lines.at(-1)?.replace('report: ', '') ?? '';
  return { code, lines, report: JSON.parse(readFileSync(join(root, path), 'utf8')) };
}

/** A temporary repository holding one scene module, `fixtures/scenes/tiny/index.ts` (scene `id`), and a package.json. */
function tinyRepository(id = 'perfTiny'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-perf-')));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0', type: 'module' }));
  mkdirSync(join(root, 'fixtures/scenes/tiny'), { recursive: true });
  const scene = JSON.stringify(join(realpathSync(ROOT), 'engine/sim/scene.ts'));
  writeFileSync(
    join(root, 'fixtures/scenes/tiny/index.ts'),
    `/** @file A scene for x perf's tests. */\nimport { defineScene } from ${scene};\nexport default defineScene('${id}', { setup: () => {} });\n`,
  );
  return root;
}

describe('median and budgets', () => {
  it('takes the middle value, and reads only well-formed budget files', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2])]).toEqual([2, 2.5]);
    expect(readBudget(join(ROOT, 'tests/baselines/perf/kernel.json')).budgets.stepMs).toBeGreaterThan(0);
    const root = tinyRepository();
    const write = (budget: object) => (
      writeFileSync(join(root, 'bad.json'), JSON.stringify(budget)),
      join(root, 'bad.json')
    );
    const good = { scene: 'x', steps: 10, budgets: { stepMs: 1 }, reason: 'r' };
    expect(readBudget(write(good))).toEqual(good);
    expect(() => readBudget(write({ ...good, budgets: { fps: 60 } }))).toThrow(
      /budgets: \{ stepMs, hashMs, captureMs \}/,
    );
    expect(() => readBudget(write({ ...good, stpes: 10 }))).toThrow(/unknown key "stpes" \(did you mean "steps"\?\)/);
    expect(() => readBudget(write({ ...good, budgets: { stpeMs: 1 } }))).toThrow(
      /budgets: unknown key "stpeMs" \(did you mean "stepMs"\?\)/,
    );
    expect(() => readBudget(write({ ...good, steps: undefined }))).toThrow(
      /steps is absent; the steps it was measured over/,
    );
    expect(() => readBudget(write({ ...good, scene: '' }))).toThrow(/scene is ""/);
  });
});

describe('x perf', () => {
  it('measures the kernel: median milliseconds per step, hash and capture, within its budget', async () => {
    const { code, lines, report } = await perf(ROOT, 'fixtures/scenes/kernel', '--runs', '2', '--budget');
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^x perf: ok: kernel: 600 steps × 2 runs, [\d.]+ ms per step \(median, Node\)$/);
    expect(lines.some((line) => /^stepMs: [\d.]+ \([\d.]+–[\d.]+\), within [\d.]+$/.test(line))).toBe(true);
    expect(report.metrics.stepMs).toBeGreaterThan(0);
    expect(report.metrics.hashMs).toBeGreaterThan(0);
  });

  it('fails --budget without a budget file, and over a budget', async () => {
    const root = tinyRepository();
    const missing = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--steps', '10', '--budget');
    expect([missing.code, missing.report.failures[0].id]).toEqual([1, 'PERF_NO_BUDGET']);
    mkdirSync(join(root, 'tests/baselines/perf'), { recursive: true });
    const budget = { scene: 'perfTiny', steps: 10, budgets: { stepMs: 0 }, reason: 'a test budget nothing meets' };
    writeFileSync(join(root, 'tests/baselines/perf/perfTiny.json'), JSON.stringify(budget));
    const over = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--steps', '10', '--budget');
    expect([over.code, over.report.failures[0].id]).toEqual([1, 'PERF_OVER_BUDGET']);
    const shown = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--steps', '10');
    expect(shown.code).toBe(0);
    expect(shown.lines.some((line) => line.includes('OVER 0'))).toBe(true);
  });

  it("measures at the budget file's steps, and refuses a run the budget does not describe", async () => {
    const root = tinyRepository('perfSteps');
    mkdirSync(join(root, 'tests/baselines/perf'), { recursive: true });
    const path = join(root, 'tests/baselines/perf/perfSteps.json');
    const budget = { scene: 'perfSteps', steps: 12, budgets: { stepMs: 1000 }, reason: 'a test budget all meet' };
    writeFileSync(path, JSON.stringify(budget));
    const atFile = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--budget');
    expect(atFile.code).toBe(0);
    expect(atFile.lines[0]).toContain('perfSteps: 12 steps × 1 runs');
    const steps = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--steps', '10', '--budget');
    expect(steps.code).toBe(2);
    expect(steps.lines.join('\n')).toMatch(/measured over 12 steps.*drop --steps/);
    const set = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--set', 'time.hz=30', '--budget');
    expect(set.code).toBe(2);
    expect(set.lines.join('\n')).toContain('--set');
    writeFileSync(path, JSON.stringify({ ...budget, scene: 'perfStpes' }));
    const scene = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--budget');
    expect(scene.code).toBe(2);
    expect(scene.lines.join('\n')).toContain('perfStpes');
    writeFileSync(path, JSON.stringify({ ...budget, extra: 1 }));
    expect((await perf(root, 'fixtures/scenes/tiny', '--runs', '1')).code).toBe(2);
    writeFileSync(path, JSON.stringify(budget));
    const shown = await perf(root, 'fixtures/scenes/tiny', '--runs', '1', '--steps', '10');
    expect(shown.code).toBe(0);
    expect(shown.lines.join('\n')).toContain('measured over 12 steps; this run took 10, so they are not compared');
  });
});
