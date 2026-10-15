/**
 * @file Tests for retargeting (WP 8.4): the rest body's own skeleton and build, the rotation copy aligned at rest, the
 * hip joints by the hip-height ratio, contact IK for feet and hands, the lift, the held blade kept above the floor,
 * the libraries' clips standing on the floor on builds whatever their hips' layout (CMU's, mesh2motion's,
 * Quaternius'), and three.js's `AnimationClip` played by an `AnimationMixer` matching the clip layer's pose within
 * 0.1 mm (Done when).
 */
import { AnimationClip, AnimationMixer, Bone, Object3D, Vector3 as ThreeVector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { Vector3 } from '../../core/math';
import { defineBuild } from '../builds';
import { createWorldPose, jointPosition, jointRotation, socketPosition, tipPosition, type WorldPose } from '../fk';
import { Pose } from '../pose';
import { createSkeleton, JOINTS, PARENTS, type Skeleton } from '../skeleton';
import { busy, clipOf, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { setOf } from '../../../tests/unit/anim/clip-parity';
import { Animator } from '../character';
import { bakeClip } from './bake';
import { ClipLayer } from './layer';
import { loadClipLibrary } from './library';
import type { ClipKey } from './readable';
import { restBuild, restSkeleton } from './rest';
import { clipJSON, hipRatio, RETARGET, retargetPose, standingHipHeight } from './retarget';

const heroic = createSkeleton('build:heroic');
const stand = bakeClip(clipOf([standing(0), standing(1)]), REST);
/** The height of a foot's lowest point: its sole, its ball or its toe's tip. */
const footLow = (k: Skeleton, w: WorldPose, s: 'L' | 'R') =>
  Math.min(socketPosition(k, w, `contact${s}`).y, jointPosition(w, `toe${s}`).y, tipPosition(k, w, `toe${s}`).y);
/** The height of a pose's lowest point: a joint, a foot's, or a hand's or the head's tip. */
const lowest = (k: Skeleton, w: WorldPose) =>
  Math.min(
    ...JOINTS.map((_, j) => w.positions[j * 3 + 1]),
    footLow(k, w, 'L'),
    footLow(k, w, 'R'),
    ...(['handL', 'handR', 'head'] as const).map((j) => tipPosition(k, w, j).y),
  );

describe('restSkeleton and restBuild', () => {
  it('measures the rest body’s bones, stands its pelvis at H0, and is made once', () => {
    const skeleton = restSkeleton(REST);
    expect(restSkeleton(REST)).toBe(skeleton);
    expect(standingHipHeight(skeleton)).toBeCloseTo((REST.H0 + REST.hip.L[2]) / 1000, 9); // the hip joints'
    expect(skeleton.lengths[JOINTS.indexOf('shinL')]).toBeCloseTo(REST.thigh / 1000, 9);
    expect(skeleton.lengths[JOINTS.indexOf('handR')]).toBeCloseTo(REST.fore / 1000, 9);
    expect(skeleton.height).toBeGreaterThan(1.7);
    expect(hipRatio(stand, skeleton)).toBe(1);
  });

  it('makes a valid build of the rest body’s proportions', () => {
    const build = defineBuild('build:test', restBuild(REST), createRegistry());
    expect([build.legUpper, build.armUpper, build.ankleHeight]).toEqual([0.40031, 0.27444, 0.1037]);
    expect(build.legUpper + build.legLower).toBeCloseTo((REST.thigh + REST.shin + REST.ankleZ) / 1000, 9);
    expect(build.headRadius).toBeCloseTo(0.128, 9);
  });
});

describe('retargetPose', () => {
  it('stands a build on its hip joints, where the source’s are by the hip-height ratio, its feet on the floor', () => {
    const [world, free, source] = [createWorldPose(), createWorldPose(), createWorldPose()];
    const pose = retargetPose(stand, 0.5, heroic, new Pose(), { world });
    retargetPose(stand, 0.5, heroic, new Pose(), { world: free, ik: false, lift: false });
    retargetPose(stand, 0.5, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const ratio = 0.925 / ((REST.H0 + REST.hip.L[2]) / 1000); // standing hip joints: the heroic legs over REST's
    expect(hipRatio(stand, heroic)).toBeCloseTo(ratio, 9);
    const hips = (w: WorldPose) => jointPosition(w, 'thighL').lerp(jointPosition(w, 'thighR'), 0.5);
    expect(hips(free).distanceTo(hips(source).multiplyScalar(ratio))).toBeLessThan(1e-6);
    // REST's hip joints sit 15 mm over its pelvis and 51.5 mm ahead of it; heroic's level with its pelvis
    expect(jointPosition(free, 'pelvis').y).toBeCloseTo(((REST.H0 + REST.hip.L[2]) / 1000) * ratio, 6);
    expect(jointPosition(free, 'pelvis').z).toBeCloseTo((REST.hip.L[0] / 1000) * ratio, 6);
    expect(pose.rootRot.w).toBe(1);
    // each foot's lowest point on the floor; REST stands narrower than heroic's hips, so the pelvis drops just enough
    // for the legs to reach in to it, straight (3 mm)
    for (const s of ['L', 'R'] as const) expect(Math.abs(footLow(heroic, world, s))).toBeLessThan(1e-6);
    const leg = (s: 'L' | 'R') => jointPosition(world, `thigh${s}`).distanceTo(jointPosition(world, `foot${s}`));
    expect(Math.max(leg('L'), leg('R'))).toBeCloseTo(0.925 - 0.085 - 0.01 / 8, 6);
    expect(pose.rootPos.y).toBeCloseTo(-0.0027, 4);
  });

  it('copies the rotations: limbs as they are, the spine, neck, head and feet aligned to the rest body’s bones', () => {
    const baked = bakeClip(clipOf([busy(0)]), REST);
    const [source, target] = [createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    retargetPose(baked, 0, heroic, new Pose(), { world: target, ik: false, lift: false });
    for (const joint of ['upperArmL', 'forearmR', 'handR', 'thighL', 'shinR'] as const) {
      expect(jointRotation(target, joint).angleTo(jointRotation(source, joint))).toBeLessThan(1e-6);
    }
    const bone = (world: typeof source, joint: (typeof JOINTS)[number]) => {
      const child = JOINTS.indexOf(joint);
      return jointPosition(world, child).sub(jointPosition(world, PARENTS[child])).normalize();
    };
    for (const joint of ['spine2', 'chest', 'neck', 'head', 'toeL'] as const) {
      expect(bone(target, joint).angleTo(bone(source, joint))).toBeLessThan(1e-6);
    }
  });

  it('plants each foot where the source’s is, scaled, on a build with other leg shares: its lowest point at its height', () => {
    const chibi = createSkeleton('build:chibi');
    const baked = bakeClip(clipOf([{ ...busy(0), hips: [5, -3, 96] }]), REST);
    const [world, free, source] = [createWorldPose(), createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, chibi, new Pose(), { world, lift: false });
    retargetPose(baked, 0, chibi, new Pose(), { world: free, ik: false, lift: false });
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const ratio = hipRatio(baked, chibi);
    for (const s of ['L', 'R'] as const) {
      // the ankle over the source's, scaled; the foot keeps the clip's turn, its lowest point at the source's height
      const [want, got] = [jointPosition(source, `foot${s}`).multiplyScalar(ratio), jointPosition(world, `foot${s}`)];
      expect(Math.hypot(got.x - want.x, got.z - want.z)).toBeLessThan(1e-6);
      expect(footLow(chibi, world, s)).toBeCloseTo(Math.max(0, footLow(restSkeleton(REST), source, s) * ratio), 6);
      expect(jointRotation(world, `foot${s}`).angleTo(jointRotation(free, `foot${s}`))).toBeLessThan(1e-6);
    }
    expect(footLow(restSkeleton(REST), source, 'R')).toBeGreaterThan(0.01); // a raised foot goes where it is raised to
    expect(jointPosition(free, 'footR').distanceTo(jointPosition(world, 'footR'))).toBeGreaterThan(0.005);
  });

  it('reaches with a hand inside a contacts interval, and keeps a pose that dips below the floor as deep as its source', () => {
    const baked = bakeClip(clipOf([{ ...busy(0), hips: [0, 0, 20] }]), REST);
    const [world, source] = [createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const contacts = [{ part: 'handL', from: 0, to: 1 }];
    retargetPose(baked, 0, heroic, new Pose(), { world, contacts });
    const ratio = hipRatio(baked, heroic);
    // after G9 the lift raises a pose only as far as it sinks below its source's lowest point, scaled: this source dips
    // below its floor, so its hand stays where the source's is (it was lifted to stand on the floor before)
    const reach = jointPosition(world, 'handL').sub(jointPosition(source, 'handL').multiplyScalar(ratio));
    expect(reach.length()).toBeLessThan(1e-6);
    const own = lowest(restSkeleton(REST), source) * ratio;
    expect(own).toBeLessThan(0);
    expect(lowest(heroic, world)).toBeGreaterThan(own - 1e-9);
  });

  it('keeps a held blade’s tip above the floor: lowered only to lie along it, its heading kept, the wrist still', () => {
    const length = 1.1; // shardfall's reach: 1.19 standing hip heights
    const turned = (world: ReturnType<typeof createWorldPose>) => {
      const grip = socketPosition(heroic, world, 'weaponR');
      const tip = new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'handR')).multiplyScalar(length).add(grip);
      return { tip, heading: Math.atan2(tip.x - grip.x, tip.z - grip.z), wrist: jointPosition(world, 'handR') };
    };
    for (const [blade, through] of [
      [[30, 30, -100], true],
      [[100, 0, 0], false],
    ] as const) {
      const crouch = { hips: [0, 0, 55], legL: [70, 0, -50, 100, 0], legR: [70, 0, -50, 100, 0] } as const;
      const key: ClipKey = { ...standing(0), ...crouch, armR: [100, 0, -40, 0, 0], blade: [...blade] } as ClipKey;
      const baked = bakeClip(clipOf([key]), REST);
      const [free, held] = [createWorldPose(), createWorldPose()];
      const [loose, holding] = [new Pose(), new Pose()];
      retargetPose(baked, 0, heroic, loose, { world: free });
      retargetPose(baked, 0, heroic, holding, { world: held, blade: length });
      const [a, b] = [turned(free), turned(held)];
      if (!through) {
        expect(holding.equals(loose)).toBe(true); // a blade over the floor is left as the clip holds it
        continue;
      }
      expect(a.tip.y).toBeLessThan(-0.1); // the clip's blade goes through the floor
      expect(Math.abs(b.tip.y - RETARGET.bladeFloor)).toBeLessThan(1e-4); // its own margin over the floor
      expect(b.heading).toBeCloseTo(a.heading, 5);
      expect(b.wrist.distanceTo(a.wrist)).toBeLessThan(1e-9);
    }
  });
});

describe('the libraries’ clips on builds: the feet on the floor, whatever the source’s hips', () => {
  // CMU's hip joints sit 10 cm under its pelvis, Quaternius' and mesh2motion's 1.5 cm over it and 5 cm ahead; a build's
  // level with it. The hip joints go where the source's are, so the legs reach the floor the source stands on.
  const builds = { heroic, chibi: createSkeleton('build:chibi') };
  const SETS = ['cmu', 'mesh2motion', 'quaternius'] as const;

  // The lift on (after G9; it was off here): it raises a pose only where the build's proportions would sink it below the
  // source's own lowest point (a hand or the head on the floor), and then by just that much.
  it('puts every foot the source stands on (within 1 mm of the floor) on it, scaled, at every 60 Hz tick, lifted only where a lower point needs it', () => {
    const [pose, world, source, unlifted] = [new Pose(), createWorldPose(), createWorldPose(), createWorldPose()];
    const lifted = new Set<string>();
    for (const dir of SETS) {
      const set = setOf(dir);
      let [planted, worst] = [0, 0];
      for (const [name, clip] of Object.entries(set.clips)) {
        const R = set.sources![clip.src!].rest;
        const [baked, rest] = [bakeClip(clip, R, name), restSkeleton(R)];
        for (let k = 0; k <= clip.dur * 60 + 1e-9; k++) {
          retargetPose(baked, k / 60, rest, pose, { world: source, ik: false, lift: false });
          const on = (['L', 'R'] as const).filter((s) => Math.abs(footLow(rest, source, s)) <= 0.001);
          for (const skeleton of on.length ? Object.values(builds) : []) {
            const ratio = hipRatio(baked, skeleton);
            retargetPose(baked, k / 60, skeleton, pose, { world: unlifted, lift: false });
            const lift = Math.max(0, Math.min(0, lowest(rest, source) * ratio) - lowest(skeleton, unlifted));
            if (lift > 0) {
              lifted.add(`${dir}/${name}`); // a hand or the head is what sank, never a planted foot
              expect(lowest(skeleton, unlifted)).toBeLessThan(Math.min(footLow(skeleton, unlifted, 'L'), footLow(skeleton, unlifted, 'R'))); // prettier-ignore
            }
            retargetPose(baked, k / 60, skeleton, pose, { world });
            for (const s of on) {
              const want = Math.max(0, footLow(rest, source, s) * ratio) + lift;
              [planted, worst] = [planted + 1, Math.max(worst, Math.abs(footLow(skeleton, world, s) - want))];
            }
          }
        }
      }
      expect(planted, dir).toBeGreaterThan(1000);
      expect(worst, dir).toBeLessThan(1e-5);
    }
    // the clips on hands or knees: a push-up, harvesting, kneeling, the get-ups, a breakdance (15 when written)
    expect(lifted.size).toBeGreaterThan(0);
    expect(lifted.size).toBeLessThanOrEqual(15);
  });

  it('stands and walks them on the floor through the clip layer: CMU’s Shrug was 197 mm up on heroic', () => {
    const named = { cmu: ['Shrug', 'Walk_Loop', 'Wave_Hello'], mesh2motion: ['Idle_A', 'Idle_Rail'], quaternius: ['Idle_Loop', 'Walk_Loop'] }; // prettier-ignore
    for (const [dir, clips] of Object.entries(named)) {
      const library = loadClipLibrary(setOf(dir));
      for (const [build, skeleton] of Object.entries(builds)) {
        for (const name of clips) {
          const layer = new ClipLayer({ library, build: `build:${build}` });
          const hero = new Animator({ build: `build:${build}`, clock: 0 }).use('clips', layer);
          layer.play(name, { fade: 0 });
          let low = Infinity;
          for (let k = 0; k < library.bake(name).duration * 60; k++) {
            hero.step().pose();
            low = Math.min(low, footLow(skeleton, hero.body.world, 'L'), footLow(skeleton, hero.body.world, 'R'));
            layer.step();
          }
          expect(low, `${dir}/${name} on ${build}`).toBeLessThan(0.001);
          expect(low, `${dir}/${name} on ${build}`).toBeGreaterThan(-1e-6);
        }
      }
    }
  });
});

describe('clipJSON: the baked clip as three.js’s AnimationClip', () => {
  it('played by an AnimationMixer, matches the clip layer’s pose within 0.1 mm (the rotation copy, no contact IK)', () => {
    const library = loadClipLibrary(setOf('quaternius'));
    const baked = library.bake('Sword_Attack');
    const three = AnimationClip.parse(clipJSON(baked, heroic));
    expect(three.tracks).toHaveLength(JOINTS.length + 1);
    // the puppets' bones: `root`, then one per joint at its rest offset (engine/gfx/puppets/draw.ts)
    const holder = new Object3D();
    const bones = [new Bone(), ...JOINTS.map(() => new Bone())];
    bones[0].name = 'root';
    holder.add(bones[0]);
    JOINTS.forEach((name, j) => {
      bones[j + 1].name = name;
      bones[j + 1].position.fromArray(heroic.offsets, j * 3);
      bones[PARENTS[j] + 1].add(bones[j + 1]);
    });
    const mixer = new AnimationMixer(holder);
    mixer.clipAction(three).play();
    const layer = new ClipLayer({ library, build: 'build:heroic', ik: false });
    const hero = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
    layer.play('Sword_Attack', { fade: 0 });
    const at = new ThreeVector3();
    let [worst, samples] = [0, 0];
    while (layer.current && layer.current.t < baked.duration) {
      hero.step().pose();
      mixer.setTime(layer.current.t);
      holder.updateMatrixWorld(true);
      JOINTS.forEach((_, j) => {
        at.setFromMatrixPosition(bones[j + 1].matrixWorld);
        worst = Math.max(worst, at.distanceTo(new Vector3().fromArray(hero.body.world.positions, j * 3)));
      });
      [samples] = [samples + 1, layer.step()];
    }
    expect(samples).toBeGreaterThan(90); // every 60 Hz tick of its 1.53 s
    expect(worst).toBeLessThan(1e-4);
  });
});
