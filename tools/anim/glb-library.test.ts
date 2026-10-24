/**
 * @file Tests reading a library out of a `.glb` (tools/anim/glb-library.ts and tools/anim/rigs.ts, WP 8.5) on a
 * T-posed humanoid built in memory (tools/anim/glb-fixture.ts): the rig recognised, the 36 points in the rig's frame
 * (forward, right, up, mm, the root on the ground), a clip sampled at the asked rate, a quantized or splined track read
 * as its float or linear twin would be, the root's travel kept apart, a skinned mesh read (WP 8.8's prerequisite: its
 * vertices on their bones, through the inverse bind matrices), and the errors that name what is missing.
 */
import { describe, expect, it } from 'vitest';
import { POINT_INDEX } from '../../engine/anim/clip/readable';
import { GlbBuilder, riggedGlb, turn, type FixtureVertex } from './glb-fixture';
import { listGlb, readGlbLibrary } from './glb-library';
import { bonesFor } from './rigs';

/** Point `name` of frame `f` of a capture's data, `[f, r, z]` mm. */
const at = (data: Float32Array, f: number, name: string) =>
  [...data.subarray((f * 36 + POINT_INDEX[name]) * 3)].slice(0, 3);

describe('a library read from a .glb', () => {
  it('recognises the rig and maps every body point to a bone', () => {
    expect(listGlb(riggedGlb(), 't.glb')).toMatchObject({ rig: 'unreal', clips: ['Wave_Loop'] });
    expect(bonesFor('unreal')).toHaveLength(36);
    expect(bonesFor('rigify').find(([p]) => p === 'toeR')).toEqual(['toeR', 'DEF-toe.R', 'tip']);
  });

  it('samples each clip at the asked rate, in the rig frame: forward, right, up, mm', () => {
    const library = readGlbLibrary(riggedGlb(), 't.glb', 30);
    expect(library.rig).toBe('unreal');
    expect(library.body).toBeNull();
    expect(library.notes).toEqual(['t.glb: no skinned mesh: the body is measured from the bones alone']);
    const wave = library.clips.Wave_Loop;
    expect(wave).toMatchObject({ n: 31, dur: 1, loop: true, fps: 30, move: null, sourceFps: 2 });
    const pelvis = at(wave.data, 0, 'pelvis');
    pelvis.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 950][i], 3));
    const [hipL, hipR, toeL] = ['hipL', 'hipR', 'toeL'].map((p) => at(wave.data, 0, p));
    expect(hipR[1]).toBeGreaterThan(hipL[1]); // right is +r
    expect(toeL[0]).toBeGreaterThan(150); // the toes point forward
    // the left arm swings down at 0.5 s: the fist far below the shoulder, then back out level
    expect(at(wave.data, 15, 'fistL')[2]).toBeLessThan(at(wave.data, 15, 'shL')[2] - 400);
    expect(at(wave.data, 30, 'fistL')[2]).toBeCloseTo(at(wave.data, 0, 'fistL')[2], 2);
  });

  it('reads quantized and splined tracks as their float, linear twins', () => {
    const q = [...turn([0, 0, 1], 0), ...turn([0, 0, 1], -60)];
    const float = { bone: 'upperarm_l', path: 'rotation' as const, times: [0, 1], values: q };
    const quantized = { ...float, values: q.map((v) => Math.round(v * 32767)), componentType: 5122, normalized: true };
    const tangents = [0, 0, 0, 0];
    const spline = {
      ...float,
      interpolation: 'CUBICSPLINE' as const,
      values: [...tangents, ...q.slice(0, 4), ...tangents, ...tangents, ...q.slice(4), ...tangents],
    };
    const read = (track: typeof float) => readGlbLibrary(riggedGlb({ Swing: [track] }), 't.glb').clips.Swing;
    const [a, b, c] = [read(float), read(quantized), read(spline)];
    for (const f of [0, 30]) {
      at(b.data, f, 'fistL').forEach((v, i) => expect(Math.abs(v - at(a.data, f, 'fistL')[i])).toBeLessThan(0.5));
      at(c.data, f, 'fistL').forEach((v, i) => expect(v).toBeCloseTo(at(a.data, f, 'fistL')[i], 2));
    }
    expect(Math.abs(at(c.data, 15, 'fistL')[2] - at(a.data, 15, 'fistL')[2])).toBeLessThan(20);
  });

  it('keeps the root’s travel apart, the points following the root', () => {
    const walk = { bone: 'root', path: 'translation' as const, times: [0, 2], values: [0, 0, 0, 0, 0, 1.5] };
    const clip = readGlbLibrary(riggedGlb({ Walk_RM: [walk] }), 't.glb').clips.Walk_RM;
    expect(clip.loop).toBe(false);
    expect(clip.move?.at(-2)).toBeCloseTo(1500, 3);
    at(clip.data, clip.n - 1, 'pelvis').forEach((v, i) => expect(v).toBeCloseTo([0, 0, 950][i], 3));
  });

  it('reads a skinned mesh: each vertex on the bone that moves it most, in its frame (its inverse bind matrix)', () => {
    // the head's vertices reach 25 cm above it; ten more lean on it, but on the neck more, so they are the neck's
    const head = Array.from({ length: 50 }, (_, k) => ({ at: [0.01 * (k % 5), 1.85, 0], bones: [['Head', 1]] }));
    const neck = Array.from({ length: 10 }, () => ({
      at: [0, 2.5, 0],
      bones: [
        ['Head', 0.3],
        ['neck_01', 0.7],
      ],
    }));
    const library = readGlbLibrary(riggedGlb(undefined, [...head, ...neck] as FixtureVertex[]), 't.glb', 30);
    expect(library.notes).toEqual([]);
    // the head's top: where its own vertices end, not its leaf bone (1.8 m, the reading without a mesh)
    expect(at(library.clips.Wave_Loop.data, 0, 'headTop')[2]).toBeCloseTo(1850, 1);
    expect(at(readGlbLibrary(riggedGlb(), 't.glb', 30).clips.Wave_Loop.data, 0, 'headTop')[2]).toBeCloseTo(1800, 1);
  });

  it('names the rig or the bones it cannot find', () => {
    const builder = new GlbBuilder();
    const bare = builder.build({ nodes: [{ name: 'Armature' }] });
    expect(() => readGlbLibrary(bare, 'bare.glb')).toThrow(/bare.glb: its rig is none the importer knows.*rigs.ts/);
    const partial = new GlbBuilder().build({ nodes: [{ name: 'spine_01' }, { name: 'pelvis' }] });
    expect(() => readGlbLibrary(partial, 'part.glb')).toThrow(/part.glb lacks bones the unreal map needs: spine_02/);
  });
});
