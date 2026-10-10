/**
 * @file Tests for `x sim` and its scene helpers (tools/cmd/sim.ts): scene modules are found by path or by id, the
 * command prints the hash and events within 20 lines, records `--set` values in its report, writes a replay of the
 * run that plays back to the same hash, gives the same hash on every run, and refuses unknown settings, scenes and
 * flags with exit 2 naming the closest; `replayText` writes readable, exact text.
 * @see tools/cmd/sim.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReplay, playReplay, type Replay } from '../../engine/sim/replay';
import { dispatch, ROOT } from '../x';
import { replayText, resolveSceneModule, sceneModules, sceneRoots } from './sim';

/** Runs `node x sim …` in this repository; resolves to the exit code and printed lines. */
async function sim(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await dispatch(['sim', ...args], { print: (line) => lines.push(line) });
  return { code, lines };
}

describe('scene modules', () => {
  it('are found by directory, file and scene id', () => {
    expect(sceneRoots(ROOT)[0]).toBe('fixtures/scenes/');
    expect(sceneModules(ROOT).get('kernel')).toBe('fixtures/scenes/kernel/index.ts');
    for (const target of ['fixtures/scenes/kernel', 'fixtures/scenes/kernel/index.ts', 'kernel']) {
      expect(resolveSceneModule(ROOT, target)).toBe('fixtures/scenes/kernel/index.ts');
    }
    expect(() => resolveSceneModule(ROOT, 'kernal')).toThrow(
      /neither a scene module .* nor a scene id \(scenes: .*kernel/,
    );
  });
});

describe('x sim', () => {
  it('prints the hash and events within 20 lines, records --set, and writes a replay of the run', async () => {
    const { code, lines } = await sim('fixtures/scenes/kernel', '--steps', '240', '--set', 'kernel.movers=4');
    expect(code).toBe(0);
    expect(lines.length).toBeLessThanOrEqual(20);
    const hash = /hash ([0-9a-f]{16})$/.exec(lines[0])?.[1];
    expect(lines[0]).toMatch(/^x sim: ok: kernel: 240 steps, seed 1, hash [0-9a-f]{16}$/);
    expect(lines).toContain('settings: kernel.movers=4');
    expect(lines.some((line) => /^events: .*pulse 1/.test(line))).toBe(true);
    const report = JSON.parse(readFileSync(join(ROOT, 'out/sim/kernel/report.json'), 'utf8'));
    expect(report.args.set).toEqual(['kernel.movers=4']);
    expect(report.metrics).toMatchObject({ hash, steps: 240, entities: 4, 'set.kernel.movers': '4' });
    const replay = checkReplay(JSON.parse(readFileSync(join(ROOT, 'out/sim/kernel/run.replay.json'), 'utf8')));
    expect(replay.settings).toEqual({ 'kernel.movers': 4 });
    expect(playReplay(replay).hashes['240']).toBe(hash);
    const again = await sim('kernel', '--steps', '240', '--set', 'kernel.movers=4');
    expect(again.lines[0]).toBe(lines[0]);
  });

  it('leaves view settings out of the hash', async () => {
    const plain = await sim('kernel', '--steps', '60');
    const viewed = await sim('kernel', '--steps', '60', '--set', 'kernel.trail=3');
    expect(viewed.lines[0]).toBe(plain.lines[0]);
    const seeded = await sim('kernel', '--steps', '60', '--seed', '2');
    expect(seeded.lines[0]).not.toBe(plain.lines[0].replace('seed 1', 'seed 2'));
  });

  it('refuses unknown settings, scenes and flags with exit 2, naming the closest', async () => {
    const setting = await sim('kernel', '--set', 'kernel.mvoers=3');
    expect(setting.code).toBe(2);
    expect(setting.lines.join('\n')).toContain('did you mean "kernel.movers"?');
    expect((await sim('kernel', '--set', 'kernel.movers')).lines.join('\n')).toContain('--set takes key=value');
    expect((await sim('kernel', '--steps', 'many')).code).toBe(2);
    // Seeds are whole numbers from 0, as a replay's seed (engine/sim/replay.ts checkReplay).
    expect([(await sim('kernel', '--seed', '1.5')).code, (await sim('kernel', '--seed=-1')).code]).toEqual([2, 2]);
    expect((await sim('nowhere')).code).toBe(2);
    expect((await sim('kernel', '--scene', 'kernal')).lines.join('\n')).toContain('kernel');
    expect((await sim('kernel', '--stpes', '3')).lines.join('\n')).toContain('did you mean --steps?');
  });
});

describe('replayText', () => {
  it('writes every value exactly, -0 included, in file order', () => {
    const replay: Replay = {
      format: 'my3dge-replay/1',
      description: 'demo',
      scene: 'kernel',
      settings: { 'kernel.speed': 2 },
      seed: 1,
      hz: 60,
      steps: 9,
      inputs: [
        [0, { move: [-0, 1], cam: 0.1 }],
        [3, { dev: 'nudge', args: { id: 1, dx: 1e-300 } }],
      ],
      hashes: { 'linux-x64': { 9: '0123456789abcdef', 0: 'fedcba9876543210' } },
    };
    const text = replayText(replay);
    expect(Object.is((JSON.parse(text) as Replay).inputs[0][1].move?.[0], -0)).toBe(true);
    expect(JSON.parse(text)).toEqual(replay);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'description',
      'scene',
      'settings',
      'seed',
      'hz',
      'steps',
      'inputs',
      'hashes',
    ]);
    expect(text).toContain('\n    [3, {"args":{"dx":1e-300,"id":1},"dev":"nudge"}]\n');
    expect(text.indexOf('"0": "fedcba9876543210"')).toBeLessThan(text.indexOf('"9": "0123456789abcdef"'));
  });
});
