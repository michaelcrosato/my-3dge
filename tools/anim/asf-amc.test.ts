/**
 * @file Tests the CMU readers (tools/anim/asf-amc.ts and tools/anim/cycle.ts, WP 8.5) on a skeleton and takes written
 * here (tools/anim/asf-amc-fixture.ts): the formats parsed, the rest pose, picks cut and faced forward, a loop cut at
 * its cycle and closed, the floor under `_rest`, in-betweened frames by default, and rotations from rest. With the
 * my-3d2dge checkout (else deferred: no source): `legacy` reads exactly what the source's `readCmu` reads, every bit.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { POINT_INDEX } from '../../engine/anim/clip/readable';
import { requireSource } from '../lib/source';
import { pose, readAmc, readAsf, readCmu, type Pick } from './asf-amc';
import { testAmc, testAsf } from './asf-amc-fixture';
import { bestCycle } from './cycle';

/** A directory holding the test subject's skeleton (`99.asf`) and takes `99_01` (a walk) and `99_02` (in place). */
function subject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'asf-amc-'));
  writeFileSync(join(dir, '99.asf'), testAsf());
  writeFileSync(join(dir, '99_01.amc'), testAmc(600));
  writeFileSync(join(dir, '99_02.amc'), testAmc(300, 0));
  return join(dir, '99.asf');
}
const PICKS: Pick[] = [
  { name: 'Walk_Loop', take: '99_01', from: 0.5, to: 4, fps: 120, loop: true },
  { name: 'Walk_Start', take: '99_01', from: 0.2, to: 1.7, fps: 120 },
  { name: 'Step_Loop', take: '99_02', fps: 120, loop: true },
  { name: 'Step_All', take: '99_02', fps: 120 },
];
/** Point `name` of frame `f` of a capture's data. */
const at = (data: Float32Array, f: number, name: string) =>
  [...data.subarray((f * 36 + POINT_INDEX[name]) * 3)].slice(0, 3);

describe('the Acclaim formats', () => {
  it('read a skeleton (parents first, metres a unit) and a take', () => {
    const sk = readAsf(testAsf());
    expect(sk.scale).toBeCloseTo(0.0254 / 0.45, 12);
    expect(sk.order).toHaveLength(30);
    expect(sk.order.indexOf('lfemur')).toBeGreaterThan(sk.order.indexOf('lhipjoint'));
    expect(sk.bones.ltibia.dof).toEqual(['rx']);
    const frames = readAmc(testAmc(5));
    expect(frames).toHaveLength(5);
    expect(frames[0].root).toHaveLength(6);
  });

  it('pose the rest at the origin, each bone’s end its parent’s plus its length along its direction', () => {
    const sk = readAsf(testAsf());
    const rest = pose(sk, null);
    expect(rest.end.root).toEqual([0, 0, 0]);
    const gap = Math.hypot(...rest.end.lfemur.map((v, i) => v - rest.end.lhipjoint[i]));
    expect(gap).toBeCloseTo(7.2 * sk.scale, 12);
  });

  it('finds a cycle: a point going round once a second repeats after 30 frames', () => {
    const turnAt = (k: number) =>
      new Float64Array([Math.cos((k / 30) * 2 * Math.PI), Math.sin((k / 30) * 2 * Math.PI), 0]);
    const [from, to] = bestCycle(91, 30, 0, 3, turnAt);
    expect(Math.round((to - from) * 30)).toBe(30);
    expect(() => bestCycle(91, 30, 0, 0.3, turnAt)).toThrow(/no cycle of 0.5 s or more between 0 s and 0.3 s/);
  });
});

describe('picks read from takes', () => {
  const asf = subject();
  const notes: string[] = [];
  const caps = readCmu(asf, PICKS, { notes });
  const legacy = readCmu(asf, PICKS, { legacy: true });

  it('cut each stretch at 30 frames a second, facing forward and starting at the origin', () => {
    const start = caps.Walk_Start;
    expect(start).toMatchObject({ n: 46, dur: 1.5, loop: false, fps: 30, take: '99_01 0.20-1.70' });
    expect(start.move?.[0]).toBe(0);
    expect(start.move?.at(-2)).toBeGreaterThan(1500); // it walks forward, about 1.13 m a second
    expect(Math.abs(start.move?.at(-1) ?? 1)).toBeLessThan(0.1 * (start.move?.at(-2) ?? 0)); // facing the way it went
    expect(at(start.data, 0, 'pelvisF')[0]).toBeGreaterThan(at(start.data, 0, 'pelvis')[0]);
  });

  it('cuts a loop at a one-second cycle, closes it, and keeps its stride', () => {
    const loop = caps.Walk_Loop;
    expect(loop.loop).toBe(true);
    expect(loop.dur).toBeCloseTo(1, 1);
    expect(at(loop.data, loop.n - 1, 'fistL')).toEqual(at(loop.data, 0, 'fistL'));
    expect(loop.stride).toBeCloseTo(20 * 0.0254 * (1000 / 0.45) * loop.dur, -1);
    expect(caps.Step_Loop.stride).toBeLessThan(20);
    expect(notes[0]).toMatch(/^Walk_Loop: a 1.0\d s cycle at .* of 99_01 \(its seam is off by \d+ mm\)$/);
  });

  it('stands the rest pose on the floor the takes stand on', () => {
    const rest = caps._rest;
    expect(rest).toMatchObject({ n: 1, dur: 0, loop: false });
    const lowest = Math.min(...['toeL', 'toeR', 'ballL', 'ballR'].map((p) => at(rest.data, 0, p)[2]));
    expect(lowest).toBeGreaterThan(-60);
    expect(lowest).toBeLessThan(60);
  });

  it('in-betweens source frames by default, and takes the nearest with legacy', () => {
    const [blend, near] = [caps.Walk_Start, legacy.Walk_Start];
    let [most, differ] = [0, 0];
    for (let i = 0; i < blend.data.length; i++) {
      most = Math.max(most, Math.abs(blend.data[i] - near.data[i]));
      if (blend.data[i] !== near.data[i]) differ++;
    }
    expect(most).toBeLessThan(15);
    expect(differ).toBeGreaterThan(0);
  });

  it('gives each bone’s turn from rest about the rig’s axes, unit quaternions', () => {
    const { bones = [], rotations = new Float32Array(0), n } = caps.Step_All;
    expect(rotations).toHaveLength(n * bones.length * 4);
    for (let k = 0; k < rotations.length; k += 4) expect(Math.hypot(...rotations.subarray(k, k + 4))).toBeCloseTo(1, 5);
    // at 0 s only the root turns, 4° about the left–right axis: the neck carries that turn and no other
    const neck = [...rotations.subarray(bones.indexOf('upperneck') * 4, bones.indexOf('upperneck') * 4 + 4)];
    expect(neck.map((v) => Math.abs(v))).toEqual(
      [0, Math.sin(Math.PI / 90), 0, Math.cos(Math.PI / 90)].map((v) => expect.closeTo(v, 5)),
    );
  });

  it('names the take and the seconds it lacks', () => {
    expect(() => readCmu(asf, [{ name: 'Late', take: '99_02', from: 9, fps: 120 }])).toThrow(
      /Late: 99_02 has no frames from 9 s to undefined s \(it lasts 2.49 s\)/,
    );
  });
});

describe('against the source (needs the my-3d2dge checkout)', () => {
  it('reads with legacy exactly what the source reads', async (context) => {
    const source = requireSource('my-3d2dge', context);
    const url = pathToFileURL(join(source, 'tools/asf-amc.mjs')).href;
    const oracle = (await import(url)) as { readCmu(asf: string, picks: Pick[], fps: number): { clips: object } };
    const asf = subject();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const theirs = oracle.readCmu(asf, PICKS, 30).clips as Record<string, Record<string, unknown>>;
    log.mockRestore();
    const ours = readCmu(asf, PICKS, { legacy: true });
    expect(Object.keys(ours)).toEqual(Object.keys(theirs));
    for (const [name, cap] of Object.entries(ours)) {
      const { bones: _b, rotations: _r, stride: _s, ...plain } = cap;
      expect(plain, name).toEqual(theirs[name]);
    }
  });
});
