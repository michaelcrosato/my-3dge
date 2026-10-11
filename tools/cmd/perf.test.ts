/**
 * @file Tests for `x perf` (tools/cmd/perf.ts): medians, budgets with a tolerance, the budget file's shape and
 * sections (unknown keys named with the closest), the trend file and its 15% warning, a measured run of the kernel
 * within its recorded budget, and, on a scene in a temporary repository, `--budget` failing over a budget and without
 * a budget file, measuring at the file's steps, refusing a run that is not the one the budget was measured on (other
 * steps, another scene, `--set`, another `--agents`), the crowd ladder at 100, 1,000 and 5,000 agents against its
 * section, and the page way's usage errors (its browser run is the WP's Verify: `node x perf labs/box --scene room
 * --budget`).
 * @see tools/cmd/perf.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, loadCommand, ROOT } from '../x';
import { budgetPath, LADDER, median, readBudget, recordTrend, regressions, TREND_FILE, withinBudget } from './perf';

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

/**
 * A temporary repository holding one scene module, `fixtures/scenes/tiny/index.ts` (scene `id`, with the setting
 * `<id in lower case>.agents` that spawns that many entities when it starts), and a package.json.
 */
function tinyRepository(id = 'perfTiny'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'x-perf-')));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0', type: 'module' }));
  mkdirSync(join(root, 'fixtures/scenes/tiny'), { recursive: true });
  const scene = JSON.stringify(join(realpathSync(ROOT), 'engine/sim/scene.ts'));
  writeFileSync(
    join(root, 'fixtures/scenes/tiny/index.ts'),
    [
      `/** @file A scene for x perf's tests. */`,
      `import { defineScene, defineSettings } from ${scene.replace('sim/scene.ts', 'sim-api.ts')};`,
      `const agents = { type: 'integer', default: 1, minimum: 0, maximum: 5000, when: 'scene', description: 'Agents.' };`,
      `defineSettings({ '${id.toLowerCase()}.agents': agents });`,
      `const setup = (w) => { for (let n = w.settings.get('${id.toLowerCase()}.agents'), i = 0; i < n; i++) w.spawn(); };`,
      `export default defineScene('${id}', { setup });`,
    ].join('\n'),
  );
  return root;
}

describe('median and budgets', () => {
  it('takes the middle value, and reads only well-formed budget files', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2])]).toEqual([2, 2.5]);
    expect(readBudget(join(ROOT, 'tests/baselines/perf/kernel.json')).budgets?.stepMs).toBeGreaterThan(0);
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
      /budgets has an unknown key "stpeMs" \(did you mean "stepMs"\?\)/,
    );
    expect(() => readBudget(write({ ...good, steps: undefined }))).toThrow(
      /steps is absent; the steps it was measured over/,
    );
    expect(() => readBudget(write({ ...good, scene: '' }))).toThrow(/scene is ""/);
  });
});

describe('tolerance, sections and trends', () => {
  it('holds a value within its budget plus the tolerance, and names a scene id’s file without its colon', () => {
    expect([withinBudget(11.4, 10, 0.15), withinBudget(11.6, 10, 0.15), withinBudget(10, 10)]).toEqual([
      true,
      false,
      true,
    ]);
    expect([withinBudget(0, 0, 0.15), withinBudget(1, 0, 0.15)]).toEqual([true, false]);
    expect(budgetPath('box:room')).toBe(join('tests', 'baselines', 'perf', 'box-room.json'));
  });

  it('reads the page and ladder sections and the tolerance, and names what is wrong with them', () => {
    const root = tinyRepository();
    const write = (budget: object) => (
      writeFileSync(join(root, 'sections.json'), JSON.stringify(budget)),
      join(root, 'sections.json')
    );
    const page = { steps: 120, budgets: { drawCalls: 30, pipelinesAfterWarmUp: 0, renderMs: 8 } };
    const ladder = { setting: 'perftiny.agents', steps: 300, rungs: { '100': { stepMs: 1 }, '5000': { stepMs: 40 } } };
    const good = { scene: 'box:room', page, ladder, tolerance: 0.15, reason: 'r' };
    expect(readBudget(write(good))).toEqual(good);
    expect(() => readBudget(write({ ...good, page: { ...page, budgets: { fps: 60 } } }))).toThrow(
      /page\.budgets has an unknown key "fps"/,
    );
    expect(() => readBudget(write({ ...good, page: { budgets: page.budgets } }))).toThrow(/page\.steps is required/);
    expect(() => readBudget(write({ ...good, ladder: { ...ladder, rungs: { '200': { stepMs: 1 } } } }))).toThrow(
      /ladder\.rungs has an unknown key "200"/,
    );
    expect(() => readBudget(write({ ...good, tolerance: 15 }))).toThrow(/tolerance is 15, above its maximum 1/);
    expect(() => readBudget(write({ scene: 'x', tolerance: 0.1, reason: 'r' }))).toThrow(/it has no budgets/);
    expect(() => readBudget(write({ ...good, steps: 10 }))).toThrow(/steps is 10; .* come with its budgets/);
  });

  it('appends each run to the trend file and warns for each number that grew over 15%', () => {
    expect(regressions({ stepMs: 1, drawCalls: 0, hashMs: 2 }, { stepMs: 1.2, drawCalls: 1, hashMs: 2.2 })).toEqual([
      'stepMs 1 → 1.2',
      'drawCalls 0 → 1',
    ]);
    const root = tinyRepository();
    expect(recordTrend(root, 'node perfTiny 10 steps', { stepMs: 1, hashMs: 1 })).toEqual([]);
    const warned = recordTrend(root, 'node perfTiny 10 steps', { stepMs: 1.1, hashMs: 1.5 });
    expect(warned.map((finding) => [finding.id, finding.message])).toEqual([
      ['PERF_TREND', `node perfTiny 10 steps: hashMs 1 → 1.5, over 15% since the run before (${TREND_FILE})`],
    ]);
    for (let k = 0; k < 25; k++) recordTrend(root, 'other', { stepMs: 1 });
    const trend = JSON.parse(readFileSync(join(root, TREND_FILE), 'utf8')) as Record<string, unknown[]>;
    expect([trend['node perfTiny 10 steps'].length, trend.other.length]).toEqual([2, 20]);
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

  it('runs the crowd ladder in Node at 100, 1,000 and 5,000 agents, against its section with a tolerance', async () => {
    const root = tinyRepository('perfLadder');
    const run = (...args: string[]) => perf(root, 'fixtures/scenes/tiny', '--ladder', '--runs', '1', ...args);
    const unnamed = await run('--steps', '2');
    expect([unnamed.code, unnamed.lines.join('\n')]).toEqual([2, expect.stringContaining('name it with --agents')]);
    const ladder = await run('--steps', '2', '--agents', 'perfladder.agents');
    expect(ladder.code).toBe(0);
    expect(ladder.lines[0]).toMatch(/perfLadder: 2 steps × 1 runs a rung, perfladder\.agents at 100, 1000, 5000/);
    for (const agents of LADDER) {
      expect(ladder.lines.some((line) => line.startsWith(`${agents} agents: stepMs `))).toBe(true);
      expect(ladder.report.metrics[`${agents}.stepMs`]).toBeGreaterThan(0);
    }
    expect(ladder.report.metrics['5000.hashMs']).toBeGreaterThan(ladder.report.metrics['100.hashMs']);
    const missing = await run('--steps', '2', '--agents', 'perfladder.agents', '--budget');
    expect([missing.code, missing.report.failures[0].id]).toEqual([1, 'PERF_NO_BUDGET']);
    mkdirSync(join(root, 'tests/baselines/perf'), { recursive: true });
    const path = join(root, 'tests/baselines/perf/perfLadder.json');
    const rungs = { '100': { stepMs: 1000 }, '1000': { stepMs: 1000 }, '5000': { stepMs: 1000, hashMs: 0 } };
    const budget = { scene: 'perfLadder', ladder: { setting: 'perfladder.agents', steps: 2, rungs }, reason: 'a test' };
    writeFileSync(path, JSON.stringify({ ...budget, tolerance: 0.15 }));
    const over = await run('--budget');
    expect(over.code).toBe(1);
    expect(over.report.failures.map((f: { id: string; message: string }) => [f.id, f.message])).toEqual([
      [
        'PERF_OVER_BUDGET',
        expect.stringMatching(/^perfLadder \(5000 agents\): hashMs [\d.]+ is over its budget 0 \+15%/),
      ],
    ]);
    expect(over.lines.some((line) => /^100 agents: stepMs [\d.]+ \([\d.–]+\), within 1000 \+15%/.test(line))).toBe(
      true,
    );
    writeFileSync(
      path,
      JSON.stringify({ ...budget, ladder: { ...budget.ladder, rungs: { '100': { stepMs: 1000 } } } }),
    );
    expect((await run('--budget')).code).toBe(0);
    const other = await run('--agents', 'time.hz', '--budget');
    expect([other.code, other.lines.join('\n')]).toEqual([2, expect.stringContaining('allowing 5000')]);
    const typo = await run('--agents', 'perfladder.agnets');
    expect(typo.lines.join('\n')).toMatch(
      /--agents perfladder\.agnets is no setting \(did you mean "perfladder\.agents"\?\)/,
    );
  });

  it('refuses --agents without --ladder, --runs on a page, and a page that does not exist, before opening one', async () => {
    const root = tinyRepository();
    expect((await perf(root, 'fixtures/scenes/tiny', '--agents', 'perftiny.agents')).code).toBe(2);
    mkdirSync(join(root, 'labs/box'), { recursive: true });
    writeFileSync(join(root, 'labs/box/index.html'), '<!doctype html>');
    const runs = await perf(root, 'labs/box', '--scene', 'room', '--runs', '2');
    expect([runs.code, runs.lines.join('\n')]).toEqual([2, expect.stringContaining('--runs is for Node runs')]);
    const absent = await perf(root, 'tests/pages/none.html');
    expect([absent.code, absent.lines.join('\n')]).toEqual([
      2,
      expect.stringContaining('there is no tests/pages/none.html'),
    ]);
  });
});
