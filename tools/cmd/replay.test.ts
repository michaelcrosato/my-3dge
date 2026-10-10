/**
 * @file Tests for `x replay`'s Node half (tools/cmd/replay.ts): the kernel replays give their goldens, `--bisect` tells
 * where a dev action injected into a replay makes runs part (engine/sim/replay.test.ts proves the comparison itself),
 * a golden that differs while every run agrees is named as a behaviour change between two checkpoints, a replay from
 * another platform runs twice and reports "golden: other platform" (never "match"), `--update` needs `--browser sim`,
 * refuses `--swap`, and writes Prettier-clean goldens only once every file and the page came out clean, every failure
 * keeps its sentence under `--bisect` (the bisect's first line inside it), and bad files and flags are named. The
 * Chromium half is proven by `node x replay tests/replays --browser sim` (WP 1.5's Verify), through the same player;
 * here a second Node runtime stands in for it.
 * @see tools/cmd/replay.ts
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';
import type { Replay } from '../../engine/sim/replay';
import '../../fixtures/scenes/kernel';
import { dispatch, ROOT } from '../x';
import { checkFiles, findParting, partingLines, PLATFORM, type Run } from './replay';
import { nodeRuntime, type Runtime } from './sim';

const KERNEL = join(ROOT, 'tests/replays/kernel-movers.replay.json');
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A platform other than this one, for goldens recorded elsewhere. */
const ELSEWHERE = PLATFORM === 'darwin-arm64' ? 'linux-x64' : 'darwin-arm64';

/** A copy of the kernel-movers replay in a temporary directory, changed by `edit`; returns its path. */
function copyKernel(edit?: (replay: Replay) => Replay, name = 'kernel-copy'): string {
  const dir = mkdtempSync(join(tmpdir(), 'x-replay-'));
  temporary.push(dir);
  const path = join(dir, `${name}.replay.json`);
  copyFileSync(KERNEL, path);
  if (edit) writeFileSync(path, JSON.stringify(edit(JSON.parse(readFileSync(path, 'utf8')))));
  return path;
}

/** Runs `node x replay …` in this repository; resolves to the exit code, printed lines and report. */
async function replay(...args: string[]) {
  const lines: string[] = [];
  const code = await dispatch(['replay', ...args], { print: (line) => lines.push(line) });
  const path = lines.at(-1)?.replace('report: ', '') ?? '';
  return { code, lines, report: JSON.parse(readFileSync(join(ROOT, path), 'utf8')) };
}

/** A kernel-movers replay with a dev action injected at step 137, which moves entity 4 by 1e-9. */
function nudgedKernel(): Replay {
  const original = JSON.parse(readFileSync(KERNEL, 'utf8')) as Replay;
  const nudged = { ...original, inputs: [...original.inputs, [137, { dev: 'nudge', args: { id: 4, dx: 1e-9 } }]] };
  nudged.inputs.sort((a, b) => (a[0] as number) - (b[0] as number));
  return nudged as Replay;
}

/** A runtime that plays the nudged kernel-movers replay whatever it is given. */
function injectedRuntime(): Runtime {
  const node = nodeRuntime(ROOT);
  const text = JSON.stringify(nudgedKernel());
  return {
    ...node,
    name: 'Injected',
    play: (_, every) => node.play(text, every),
    stateAt: (_, k) => node.stateAt(text, k),
  };
}

/** Every step's hashes from `runtime`, as a bisection run. */
async function run(label: string, runtime: Runtime, text: string): Promise<Run> {
  return { label, runtime, hashes: await runtime.play(text, true) };
}

describe('x replay in Node', () => {
  it('gives the kernel replays their goldens, three runs each', async () => {
    const { code, lines, report } = await replay('tests/replays');
    expect(code).toBe(0);
    expect(lines[0]).toMatch(
      new RegExp(`^x replay: ok: \\d+ replays match their golden hashes \\(${PLATFORM}\\): Node ×3$`),
    );
    expect(
      lines.some((line) =>
        /^kernel-movers: 600 steps, 11 golden hashes, final [0-9a-f]{16}: Node ×3, all match$/.test(line),
      ),
    ).toBe(true);
    expect(report.metrics['kernel-movers.final']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('names a golden that every run misses as a behaviour change between two checkpoints', async () => {
    const path = copyKernel((r) => ({
      ...r,
      hashes: { [PLATFORM]: { ...r.hashes[PLATFORM], 360: '0123456789abcdef' } },
    }));
    const { code, lines } = await replay(path, '--bisect', '--runs', '1');
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('REPLAY_MISMATCH: kernel-copy: Node run 1 parts from the golden at step 360');
    expect(lines.join('\n')).toContain(
      'bisect: every run agrees step by step, but they part from the goldens between step 300 (matches) and 360',
    );
  });

  it('runs a replay from another platform twice and reports "golden: other platform", never "match"', async () => {
    const path = copyKernel((r) => ({ ...r, hashes: { [ELSEWHERE]: r.hashes[PLATFORM] } }));
    const { code, lines, report } = await replay(path, '--runs', '1');
    expect(code).toBe(0);
    expect(lines[0]).not.toContain('match');
    expect(lines[0]).toContain(`1 replay: golden: other platform (${PLATFORM} has no goldens; the runs agree)`);
    expect(lines).toContain(`kernel-copy: golden: other platform (${ELSEWHERE}); 2 runs agree`);
    expect(report.warnings[0].id).toBe('REPLAY_OTHER_PLATFORM');
    const mixed = await replay(path, KERNEL, '--runs', '1');
    expect(mixed.lines[0]).toContain('2 replays pass: 1 matches its golden hashes, 1 golden: other platform');
  });

  it('refuses goldens that do not cover the run: none, short of the last step, a step key padded, a platform misspelt', async () => {
    const cases: [(r: Replay) => Replay, string][] = [
      [(r) => ({ ...r, hashes: { [PLATFORM]: {} } }), `hashes.${PLATFORM} holds no hash`],
      [(r) => ({ ...r, steps: 1200 }), `hashes.${PLATFORM} has no hash for step 1200, the last`],
      [
        (r) => ({ ...r, hashes: { [PLATFORM]: { ...r.hashes[PLATFORM], '060': '0123456789abcdef' } } }),
        'the step "060"',
      ],
      [(r) => ({ ...r, hashes: { 'linux-x46': r.hashes[PLATFORM] } }), 'unknown platform "linux-x46" (did you mean'],
    ];
    for (const [edit, text] of cases) {
      const { code, report } = await replay(copyKernel(edit), '--runs', '1');
      expect([code, report.failures[0].id]).toEqual([1, 'REPLAY_BAD']);
      expect(report.failures[0].message).toContain(text);
    }
  });

  it('fails without goldens; --update needs --browser sim and refuses --swap', async () => {
    const path = copyKernel((r) => ({ ...r, hashes: {} }));
    const none = await replay(path);
    expect([none.code, none.report.failures[0].id]).toEqual([1, 'REPLAY_NO_GOLDEN']);
    expect(none.report.failures[0].message).toContain('--browser sim --update');
    const nodeOnly = await replay(path, '--update');
    expect(nodeOnly.code).toBe(2);
    expect(nodeOnly.lines.join('\n')).toContain('--browser sim');
    expect((await replay(path, '--update', '--browser', 'sim', '--swap', 'none')).code).toBe(2);
    expect(JSON.parse(readFileSync(path, 'utf8')).hashes).toEqual({});
  });

  it('names a malformed replay and bad flags', async () => {
    const path = copyKernel((r) => ({ ...r, stpes: 600 }) as Replay);
    const bad = await replay(path);
    expect(bad.report.failures[0]).toMatchObject({ id: 'REPLAY_BAD' });
    expect(bad.report.failures[0].message).toContain('unknown key "stpes" (did you mean "steps"?)');
    expect((await replay('tests/replays', '--browser', 'page')).code).toBe(2);
    expect((await replay('tests/replays', '--swap', 'none')).code).toBe(2);
    expect((await replay('tests/replays', '--browser', 'sim', '--swap', 'tan')).code).toBe(2);
    expect((await replay('tests/nowhere')).code).toBe(2);
  });
});

describe('--update', () => {
  const runtimes = () => [nodeRuntime(ROOT), nodeRuntime(ROOT, undefined, 'Other')];

  it('writes goldens, readable and Prettier-clean, once every runtime agrees', async () => {
    const path = copyKernel((r) => ({ ...r, hashes: {} }));
    const all = await checkFiles([path], { root: ROOT, runtimes: runtimes(), runs: 2, update: true });
    expect(all.failures).toEqual([]);
    const text = readFileSync(path, 'utf8');
    expect(JSON.parse(text).hashes[PLATFORM]).toEqual(JSON.parse(readFileSync(KERNEL, 'utf8')).hashes[PLATFORM]);
    expect(await check(text, { ...(await resolveConfig(KERNEL)), parser: 'json' })).toBe(true);
    expect(text).toContain('\n    [90, { "b": ["boost"] }],\n');
    const again = await checkFiles([path], { root: ROOT, runtimes: runtimes(), runs: 1, update: true });
    expect(again.lines).toContain(
      `kernel-copy: goldens for ${PLATFORM} unchanged (11 checkpoints; Node ×1, Other ×1 agree)`,
    );
  });

  it('writes nothing while any file fails, or the page threw', async () => {
    const good = copyKernel((r) => ({ ...r, hashes: {} }));
    const crashing = copyKernel((r) => ({ ...r, scene: 'kernal', hashes: {} }), 'kernel-bad');
    const options = { root: ROOT, runtimes: runtimes(), runs: 1, update: true };
    const blocked = await checkFiles([good, crashing], options);
    expect(blocked.failures.map((failure) => failure.id)).toEqual(['REPLAY_CRASH']);
    expect(blocked.lines.join('\n')).toContain('no goldens were written');
    expect(JSON.parse(readFileSync(good, 'utf8')).hashes).toEqual({});
    const pageError = { id: 'REPLAY_PAGE_ERROR', message: 'tests/pages/replay.html threw: boom' };
    const threw = await checkFiles([good], { ...options, pageErrors: async () => [pageError] });
    expect(threw.failures).toEqual([pageError]);
    expect(JSON.parse(readFileSync(good, 'utf8')).hashes).toEqual({});
    const unstable = await checkFiles([good], { ...options, runtimes: [nodeRuntime(ROOT), injectedRuntime()] });
    expect(unstable.failures[0].message).toContain('Node run 1 and Injected run 1 part at step 180');
    expect(JSON.parse(readFileSync(good, 'utf8')).hashes).toEqual({});
  });
});

describe('--bisect', () => {
  it('finds a dev action injected into a kernel replay: the step after it, its entity and its field', async () => {
    const text = readFileSync(KERNEL, 'utf8');
    const nudged = nudgedKernel();
    const node = nodeRuntime(ROOT);
    const injected = injectedRuntime();
    const parting = await findParting(text, [await run('Node', node, text), await run('Injected', injected, text)]);
    expect(parting?.step).toBe(138);
    expect(parting?.entities[0]).toBe(4);
    expect(parting?.fields.map((field) => field.path)).toContain('entities.4.mover.x');
    const lines = partingLines('kernel-movers', parting!, nudged);
    expect(lines[0]).toMatch(
      /^kernel-movers: Node and Injected part after step 138: parts entities; entities 4[\d, ]*; first field entities\.4\.mover\.\w+ \(Node -?[\d.e-]+, Injected -?[\d.e-]+\)$/,
    );
    expect(lines.at(-1)).toContain('inputs just before (at 137): {"dev":"nudge","args":{"id":4,"dx":1e-9}}');
  });

  it('keeps every failure in view: the first bisect line inside each, field lines only when one replay fails', async () => {
    const options = { root: ROOT, runtimes: [nodeRuntime(ROOT), injectedRuntime()], runs: 1, bisect: true };
    const two = await checkFiles([copyKernel(undefined, 'kernel-a'), copyKernel(undefined, 'kernel-b')], options);
    expect(two.failures.map((failure) => failure.id)).toEqual(['REPLAY_MISMATCH', 'REPLAY_MISMATCH']);
    for (const failure of two.failures) {
      expect(failure.message).toMatch(/Injected run 1 parts from the golden at step 180/);
      expect(failure.message).toMatch(
        /bisect: Node and Injected part after step 138: .*first field entities\.4\.mover\.\w+ \(Node /,
      );
    }
    expect(two.lines.filter((line) => line.startsWith('  '))).toEqual([]);
    const one = await checkFiles([copyKernel(undefined, 'kernel-a')], options);
    expect(one.lines.some((line) => line.startsWith('  entities.4.mover.x: Node '))).toBe(true);
    expect(one.lines.some((line) => line.startsWith('  inputs just before (at 137)'))).toBe(true);
  });

  it('reports no divergence when every run agrees at every step', async () => {
    const { code, lines } = await replay('tests/replays/kernel-crowd.replay.json', '--bisect', '--runs', '1');
    expect(code).toBe(0);
    expect(lines).toContain('kernel-crowd: no divergence: Node, Node again agree at every step');
  });
});
