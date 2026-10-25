/**
 * @file Tests for the mannequin (WP 8.4): the quaternius set's measured body as a body of the grammar, its build from
 * the set's rest body, both registered once, drawn in two draw calls, the libraries' clips standing on the floor on
 * it, and what the clip layer's retargeting onto it moves, every set, against tests/baselines/anim-clips.json ("the
 * differences go in the baseline").
 */
import { describe, expect, it } from 'vitest';
import { loadClipLibrary } from '../../../anim/clip/library';
import { restBuild } from '../../../anim/clip/rest';
import { retargetPose } from '../../../anim/clip/retarget';
import { createWorldPose, jointPosition, socketPosition, tipPosition } from '../../../anim/fk';
import { Pose } from '../../../anim/pose';
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

describe('the libraries’ clips on the mannequin', () => {
  it('stand and walk on the floor: CMU’s Walk_Loop kept its soles 114 mm up when the pelvis, not the hips, was scaled', () => {
    const skeleton = createSkeleton(build);
    const [pose, world] = [new Pose(), createWorldPose()];
    const low = (s: 'L' | 'R') =>
      Math.min(socketPosition(skeleton, world, `contact${s}`).y, tipPosition(skeleton, world, `toe${s}`).y, jointPosition(world, `toe${s}`).y); // prettier-ignore
    for (const [dir, name] of [
      ['cmu', 'Walk_Loop'],
      ['cmu', 'Shrug'],
      ['mesh2motion', 'Idle_A'],
      ['quaternius', 'Walk_Loop'],
    ]) {
      const baked = loadClipLibrary(setOf(dir)).bake(name);
      let lowest = Infinity;
      for (let k = 0; k <= baked.duration * 60; k++) {
        retargetPose(baked, k / 60, skeleton, pose, { world });
        lowest = Math.min(lowest, low('L'), low('R'));
      }
      expect(lowest, `${dir}/${name}`).toBeLessThan(0.001);
      expect(lowest, `${dir}/${name}`).toBeGreaterThan(-1e-6);
    }
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
      'The clip layer’s pose on build:mannequin (rotation copy aligned at rest, the hip joints placed by the hip-height ratio, contact IK, the lift) against the format-1 decode scaled by the same ratio, over the 22 points its joints stand for, at 30 fps and the 60 Hz midpoints. A build lays its bones out straight: its hip joints sit level with its pelvis and its spine stands on them, and its shoulders sit level with the neck, where the libraries’ sit 4–6 cm lower and behind it. Retargeting puts the hip joints where the source’s are (as my-3d2dge’s drive did), so the legs follow the source’s and the torso moves by the source’s own hip layout: on Quaternius’ clips the hips match to 0 mm and the knees and ankles to 6–7 mm on average, while the pelvis and spine stand 4 cm ahead, since its hips sit 5 cm ahead of its pelvis point (mesh2motion’s too); on CMU’s, whose hips sit 10 cm under the pelvis point, the pelvis stands 13 cm lower than the decode’s on average. The other sets’ bodies have other proportions than the mannequin’s. The worst cases are clips that lie on the floor or dip below it and the parity’s own fast pole swings. Re-recorded after G9: the lift raises a pose only as far as it sinks below its source’s own lowest point (Quaternius’ swims stood up to 1,813 mm up, Swim_Idle_Loop), and contact IK bends each knee toward the source’s once it stands 2 cm off its hip–ankle line. Re-recorded for WP 8.8: mesh2motion’s 175 and CMU’s 51 clips re-imported from their sources in format 2 (hands, the spine override, foot roll), the decode taken with their grips open (the skeleton has no fingers). Re-recorded at WP 8.8’s review: a hand’s contact IK fades in and out over 0.2 s at its contact’s edges, and a hand off the floor holds only within 50 mm of where its hold began and hangs only with the body below it (46 clips keep hand contacts of 74): CMU’s mean 93.114 → 93.274 mm, mesh2motion’s 56.988 → 57.458.',
    );
  }
  it.each(SET_DIRS)('%s', (dir) => {
    expect(recorded[dir], `no baseline for ${dir}: run with ANIM_CLIPS_BASELINE=write`).toBeDefined();
    expect(measured[dir].mean).toBeCloseTo(recorded[dir].mean, 2);
    expect(measured[dir].worstClips.map((c) => c.clip)).toEqual(recorded[dir].worstClips.map((c) => c.clip));
  });
});
