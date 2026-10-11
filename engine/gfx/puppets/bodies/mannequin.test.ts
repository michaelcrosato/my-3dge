/**
 * @file Tests for the mannequin (WP 8.4): the quaternius set's measured body as a body of the grammar, its build from
 * the set's rest body, both registered once, drawn in two draw calls, and what the clip layer's retargeting onto it
 * moves, every set, against tests/baselines/anim-clips.json ("the differences go in the baseline").
 */
import { describe, expect, it } from 'vitest';
import { restBuild } from '../../../anim/clip/retarget';
import { createSkeleton, jointIndex, JOINTS } from '../../../anim/skeleton';
import { createRegistry } from '../../../core/registry';
import { buildParity, readBaseline, SET_DIRS, setOf, WRITING, writeBaseline } from '../../../../tests/unit/anim/clip-parity'; // prettier-ignore
import { compileBody } from '../compile';
import { createPuppet } from '../draw';
import { createMaterialLibrary } from '../../materials/library';
import { defineMannequin, MANNEQUIN_SLOTS, mannequinBody, type MannequinData } from './mannequin';

const quaternius = setOf('quaternius');
const data = quaternius.body as unknown as MannequinData;
const registry = createRegistry();
const { build, body } = defineMannequin(quaternius, { registry });

describe('the mannequin', () => {
  it('is the set’s rest body as a build, and its measured figure as a body: amber limbs, purple rings', () => {
    expect([data.segs.length, data.bands.length, data.height]).toEqual([22, 24, 1829]);
    expect(build).toMatchObject({ id: 'build:mannequin', ...restBuild(quaternius.sources!.UAL1.rest) });
    expect(body.slots).toEqual(MANNEQUIN_SLOTS);
    const rings = body.parts.filter((part) => part.at(-2) === 'joint' || part[5] === 'joint');
    expect(rings).toHaveLength(24);
    expect(body.parts.length).toBeGreaterThanOrEqual(22 + 24);
  });

  it('hangs each segment on the bone that carries it, and compiles for its build', () => {
    const spec = mannequinBody(data, quaternius.sources!.UAL1.rest, build);
    const on = (a: string) => spec.parts!.find((part) => JSON.stringify(part).includes(`"${a}"`))!.at(-1);
    expect(on('spine0')).toEqual({ on: 'spine0' }); // pelvis to spine1 turns with the lowest spine bone
    expect(on('shinL')).toEqual({ on: 'thighL' });
    const compiled = compileBody(body, build, { registry });
    expect(compiled.pieces.length).toBe(body.parts.length);
    expect(new Set(compiled.pieces.map((p) => JOINTS[p.bone]))).toContain('toeR');
    const puppet = createPuppet(compiled, { materials: createMaterialLibrary() });
    expect(puppet.drawCalls()).toBe(1); // one lit group: no eyes
    expect(compiled.skeleton.lengths[jointIndex('shinL')]).toBeCloseTo(build.legUpper, 9);
  });

  it('is defined once a registry, and needs a set with a body', () => {
    expect(defineMannequin(quaternius, { registry }).body).toBe(body);
    expect(() => defineMannequin(setOf('cmu'), { registry: createRegistry() })).toThrow(/GFX_NO_MANNEQUIN.*body/);
  });
});

describe('what retargeting onto the mannequin moves, every set (the baseline)', () => {
  const skeleton = createSkeleton(build);
  const recorded = readBaseline().mannequin?.sets ?? {};
  const measured = Object.fromEntries(SET_DIRS.map((dir) => [dir, buildParity(dir, skeleton)]));
  if (WRITING) {
    writeBaseline(
      'mannequin',
      measured,
      'The clip layer’s pose on build:mannequin (rotation copy aligned at rest, the hip-height ratio, contact IK, the lift) against the format-1 decode scaled by the same ratio, over the 20 points its joints stand for, at 30 fps and the 60 Hz midpoints. A build lays its bones out straight: its shoulders sit level with the neck, where the libraries’ sit 4–6 cm lower and behind it, and its hips beside the pelvis, where Quaternius’ sit 5 cm ahead of it; the other sets’ bodies have other proportions than the mannequin’s. The worst cases are clips that lie on the floor or dip below it (the lift raises them) and the parity’s own fast pole swings.',
    );
  }
  it.each(SET_DIRS)('%s', (dir) => {
    expect(recorded[dir], `no baseline for ${dir}: run with ANIM_CLIPS_BASELINE=write`).toBeDefined();
    expect(measured[dir].mean).toBeCloseTo(recorded[dir].mean, 2);
    expect(measured[dir].worstClips.map((c) => c.clip)).toEqual(recorded[dir].worstClips.map((c) => c.clip));
  });
});
