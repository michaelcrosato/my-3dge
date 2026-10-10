/**
 * @file Tests for `x replay`'s Node half (tools/cmd/replay.ts): the kernel replays give their goldens, `--bisect` tells
 * where a dev action injected into a replay makes runs part (engine/sim/replay.test.ts proves the comparison itself),
 * a golden that differs while every run agrees is named as a behaviour change between two checkpoints, a replay from
 * another platform runs twice and reports "golden: other platform", `--update` writes Prettier-clean goldens, and bad
 * files and flags are named. The Chromium half is proven by `node x replay tests/replays --browser sim` (WP 1.5's
 * Verify), through the same player.
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
import { findParting, partingLines, PLATFORM, type Run } from './replay';
import { nodeRuntime, type Runtime } from './sim';

const KERNEL = join(ROOT, 'tests/replays/kernel-movers.replay.json');
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the kernel-movers replay in a temporary directory, changed by `edit`; returns its path. */
function copyKernel(edit?: (replay: Replay) => Replay): string {
  const dir = mkdtempSync(join(tmpdir(), 'x-replay-'));
  temporary.push(dir);
  const path = join(dir, 'kernel-copy.replay.json');
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
      'every run agrees step by step, but they part from the goldens between step 300 (matches) and 360',
    );
  });

  it('runs a replay from another platform twice and reports "golden: other platform"', async () => {
    const path = copyKernel((r) => ({ ...r, hashes: { 'plan9-mips': r.hashes[PLATFORM] } }));
    const { code, lines, report } = await replay(path, '--runs', '1');
    expect(code).toBe(0);
    expect(lines).toContain('kernel-copy: golden: other platform (plan9-mips); 2 runs agree');
    expect(report.warnings[0].id).toBe('REPLAY_OTHER_PLATFORM');
  });

  it('writes goldens with --update, readable and Prettier-clean, and fails without any', async () => {
    const path = copyKernel((r) => ({ ...r, hashes: {} }));
    const none = await replay(path);
    expect([none.code, none.report.failures[0].id]).toEqual([1, 'REPLAY_NO_GOLDEN']);
    const update = await replay(path, '--update', '--runs', '2');
    expect(update.code).toBe(0);
    const text = readFileSync(path, 'utf8');
    expect(JSON.parse(text).hashes[PLATFORM]).toEqual(JSON.parse(readFileSync(KERNEL, 'utf8')).hashes[PLATFORM]);
    expect(await check(text, { ...(await resolveConfig(KERNEL)), parser: 'json' })).toBe(true);
    expect(text).toContain('\n    [90, { "b": ["boost"] }],\n');
    expect((await replay(path, '--update')).lines).toContain(
      `kernel-copy: goldens for ${PLATFORM} unchanged (11 checkpoints; Node ×3 agree)`,
    );
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

describe('--bisect', () => {
  it('finds a dev action injected into a kernel replay: the step after it, its entity and its field', async () => {
    const text = readFileSync(KERNEL, 'utf8');
    const original = JSON.parse(text) as Replay;
    const nudged = { ...original, inputs: [...original.inputs, [137, { dev: 'nudge', args: { id: 4, dx: 1e-9 } }]] };
    nudged.inputs.sort((a, b) => (a[0] as number) - (b[0] as number));
    const node = nodeRuntime(ROOT);
    const injected: Runtime = {
      ...node,
      name: 'Injected',
      play: (_, every) => node.play(JSON.stringify(nudged), every),
      stateAt: (_, step) => node.stateAt(JSON.stringify(nudged), step),
    };
    const parting = await findParting(text, [await run('Node', node, text), await run('Injected', injected, text)]);
    expect(parting?.step).toBe(138);
    expect(parting?.entities[0]).toBe(4);
    expect(parting?.fields.map((field) => field.path)).toContain('entities.4.mover.x');
    const lines = partingLines('kernel-movers', parting!, nudged as Replay);
    expect(lines[0]).toMatch(/^kernel-movers: Node and Injected part after step 138: parts entities; entities 4/);
    expect(lines.at(-1)).toContain('inputs just before (at 137): {"dev":"nudge","args":{"id":4,"dx":1e-9}}');
  });

  it('reports no divergence when every run agrees at every step', async () => {
    const { code, lines } = await replay('tests/replays/kernel-crowd.replay.json', '--bisect', '--runs', '1');
    expect(code).toBe(0);
    expect(lines).toContain('kernel-crowd: no divergence: Node, Node again agree at every step');
  });
});
