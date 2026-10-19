/**
 * @file Unit tests for the viewmodel's arms rig (engine/gfx/viewmodel/rig.ts, PLAN.md WP 13.12): at rest the fists
 * stand low in the arms' frame with the forearms coming up from below it, the shoulders under and behind the eye
 * whatever the look; the sprint pumps them with the gait's phase, the slide spreads them, the air raises them; they sway
 * behind a turn of the look and come back, and dip with the weapon bob; a hand held on a contact is drawn on the
 * contact's ray, and one held out of the frame at its edge; a kick shows its leg; and `armsInputOf` reads the hands a
 * traversal holds, a gun and a kick off the body.
 */
import { describe, expect, it } from 'vitest';
import { Animator } from '../../anim/character';
import { jointPosition } from '../../anim/fk';
import { FootPlant } from '../../anim/footPlant';
import { TraversalPlant } from '../../anim/traversal/plant';
import { TraversalPose } from '../../anim/traversal/pose';
import { Quaternion, Vector3 } from '../../core/math';
import type { CameraPlayer } from '../cameras/effects';
import { makePose, poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../cameras/pose';
import { inArmsFrame, VIEWMODEL } from './lens';
import { ARMS, ArmsRig, armsInputOf, type ArmsInput } from './rig';

const camera = makePose({ position: [1, 1.52, 2], yaw: 0.4, pitch: 0, fov: 74, near: 0.05 });
const REST: ArmsInput = { player: null, effects: null, phase: 0, clock: 0, held: [null, null], kick: null, gun: null, aspect: 16 / 9 }; // prettier-ignore
const doing = (fields: Partial<CameraPlayer>): CameraPlayer => ({ velocity: [0, 0, 6], grounded: true, mode: 'ground', sprinting: false, sliding: false, boosted: false, aiming: false, ...fields }); // prettier-ignore

/** `p` in `pose`'s frame: across, up, along. */
function view(p: Vector3, pose: CameraPose = camera): Vec3 {
  const d: Vec3 = [p.x - pose.position[0], p.y - pose.position[1], p.z - pose.position[2]];
  const dot = (a: Vec3) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  return [dot(poseRight(pose)), dot(poseUp(pose)), dot(poseForward(pose))];
}

/** A rig stepped `n` frames with `input` (a function of the frame), its camera `pose`. */
function posed(
  input: ArmsInput | ((k: number) => ArmsInput),
  n = 1,
  pose: CameraPose | ((k: number) => CameraPose) = camera,
) {
  // prettier-ignore
  const rig = new ArmsRig('build:adult');
  for (let k = 0; k < n; k++) rig.update(typeof pose === 'function' ? pose(k) : pose, typeof input === 'function' ? input(k) : input, 1 / 60); // prettier-ignore
  return rig;
}

const inFrame = (p: Vector3, pose: CameraPose = camera) => inArmsFrame(pose, [p.x, p.y, p.z], 16 / 9);

describe('the arms rig', () => {
  it('stands the fists low in the arms’ frame at rest, the forearms coming up from below it, the shoulders under the eye', () => {
    for (const pitch of [0, -1.2, 1.2]) {
      const pose = makePose({ ...camera, pitch });
      const rig = posed(REST, 1, pose);
      const [left, right] = rig.hands.map((hand) => view(hand, pose));
      // on the ready places' rays (looking up or down, nearer the eye where the arm falls short of them)
      expect(right[0] / right[2]).toBeCloseTo(ARMS.ready[0] / ARMS.ready[2], 3);
      expect(left[0] / left[2]).toBeCloseTo(-ARMS.ready[0] / ARMS.ready[2], 3);
      expect(right[1] / right[2]).toBeCloseTo(ARMS.ready[1] / ARMS.ready[2], 3);
      if (pitch === 0) expect(right[2]).toBeCloseTo(ARMS.ready[2], 3);
      for (const hand of rig.hands) expect(inFrame(hand, pose)).toBe(true);
      for (const side of ['L', 'R'] as const) expect(inFrame(jointPosition(rig.world, `forearm${side}`), pose)).toBe(false); // prettier-ignore
      expect(rig.shown).toEqual(['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR']);
    }
    const shoulder = jointPosition(posed(REST).world, 'upperArmR');
    expect(shoulder.y - camera.position[1]).toBeCloseTo(-0.221, 3); // the adult's, as his eyes stand over them
    expect(view(shoulder)[2]).toBeCloseTo(-0.102, 3);
  });

  it('pumps the fists with the gait’s phase in a sprint, spreads them in a slide and raises them in the air', () => {
    const ready = posed(REST).hands.map((hand) => view(hand));
    const sprint = (phase: number) => posed({ ...REST, phase, player: doing({ sprinting: true }) }, 60).hands.map((hand) => view(hand)); // prettier-ignore
    const [up, down] = [sprint(Math.PI / 2), sprint(-Math.PI / 2)];
    expect(up[1][2] - down[1][2]).toBeGreaterThan(0.08); // the right fist forward, then back
    expect(up[1][1] - down[1][1]).toBeGreaterThan(0.04); // and up, then down
    expect(up[0][2]).toBeLessThan(down[0][2]); // the left the other way
    const slide = posed({ ...REST, player: doing({ sliding: true }) }, 60).hands.map((hand) => view(hand));
    expect(slide[1][0]).toBeGreaterThan(ready[1][0] + 0.05);
    expect(slide[0][0]).toBeLessThan(ready[0][0] - 0.05);
    expect(slide[0][2]).toBeGreaterThan(slide[1][2]); // the left out ahead
    const air = posed({ ...REST, player: doing({ grounded: false, mode: 'air' }) }, 60).hands.map((hand) => view(hand));
    expect(air[1][1]).toBeGreaterThan(ready[1][1] + 0.03);
    for (const hands of [up, down, slide, air]) for (const hand of hands) expect(Math.abs(hand[1] / (hand[2] * Math.tan((VIEWMODEL.fov * Math.PI) / 360)))).toBeLessThanOrEqual(ARMS.margin + 1e-6); // prettier-ignore
  });

  it('sways the hands behind a turn of the look, lets them come back, and dips them with the weapon bob', () => {
    const turning = (k: number) => makePose({ ...camera, yaw: camera.yaw - (k < 12 ? k : 12) * (2 / 60) }); // right at 2 rad/s for 0.2 s
    const turned = posed(REST, 12, turning);
    const end = turning(11);
    expect(view(turned.hands[1], end)[0]).toBeLessThan(ARMS.ready[0] - 0.01); // left, behind the turn
    const settled = posed(REST, 72, turning);
    expect(view(settled.hands[1], turning(71))[0]).toBeCloseTo(ARMS.ready[0], 3);
    const effects = { bobPhase: Math.PI, bobShare: 1 } as ArmsInput['effects'];
    const bobbed = posed({ ...REST, effects }).hands.map((hand) => view(hand));
    expect(bobbed[1][1]).toBeCloseTo(ARMS.ready[1] - ARMS.bob[1], 3);
  });

  it('draws a held hand on its contact’s ray, and keeps one held out of the frame at its edge', () => {
    const forward = poseForward(camera);
    const ledge = new Vector3(...camera.position)
      .add(new Vector3(...forward).multiplyScalar(0.7))
      .add(new Vector3(0.1, -0.25, 0));
    const held = { point: ledge, rotation: new Quaternion(), weight: 1 };
    const rig = posed({ ...REST, held: [null, held] });
    const [a, b] = [view(rig.hands[1]), view(ledge)];
    expect(a[0] / a[2]).toBeCloseTo(b[0] / b[2], 4);
    expect(a[1] / a[2]).toBeCloseTo(b[1] / b[2], 4);
    const cable = new Vector3(...camera.position).add(new Vector3(0, 0.55, 0)); // a zipline's, overhead
    const riding = posed({ ...REST, held: [{ point: cable, rotation: new Quaternion(), weight: 1 }, { point: cable, rotation: new Quaternion(), weight: 1 }] }); // prettier-ignore
    for (const hand of riding.hands) expect(inFrame(hand)).toBe(true);
    for (const hand of riding.hands) expect(view(hand)[1]).toBeGreaterThan(0.05); // up at the frame's top
  });

  it('shows a kick’s leg as the body kicks it, in front of the eye', () => {
    const raised = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -1.5); // the thigh swung forward and up
    const kick = { local: [raised, new Quaternion(), new Quaternion(), new Quaternion()], weight: 1 };
    const rig = posed({ ...REST, kick });
    expect(rig.shown).toEqual(expect.arrayContaining(['thighR', 'shinR', 'footR', 'toeR']));
    expect(view(jointPosition(rig.world, 'footR'))[2]).toBeGreaterThan(0.5);
    expect(posed(REST).shown).not.toContain('thighR');
  });

  it('reads the hands a traversal holds, a carried gun and a kick off the body', () => {
    const animator = new Animator({ build: 'build:adult', clock: 1, weapon: 'gun' });
    new FootPlant().attach(animator);
    const plant = new TraversalPlant().attach(animator);
    plant.pose = new TraversalPose();
    const hull = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };
    const feet = new Vector3(0, 0.3, 0);
    const hang = { mode: 'mantle', mantle: 'hang', mantleLeft: 10, mantleTotal: 27, lipX: 0, lipY: 2.2, lipZ: 0.45, wallX: 0, wallZ: -1, fromY: 0.3 }; // prettier-ignore
    for (let k = 0; k < 20; k++) {
      plant.pose.update(hang, null, hull, animator.body.build, feet, { vx: 0, vy: 0, vz: 0, yaw: 0 }, animator.body.dt);
      animator.update({ position: feet.clone(), air: true });
    }
    const input = armsInputOf(animator, plant, { player: null, effects: null, aspect: 16 / 9 });
    expect(input.held.map((hand) => hand?.weight)).toEqual([1, 1]);
    expect(input.held[1]!.point.distanceTo(plant.limbs[1].point)).toBe(0);
    expect(input.gun).toBeNull(); // both hands on the lip: the gun waits
    const free = new Animator({ build: 'build:adult', clock: 1, weapon: 'gun' }).update({ position: new Vector3() });
    const carried = armsInputOf(free, null, { player: null, effects: null, aspect: 16 / 9 });
    expect(carried.gun?.weight).toBe(1);
    Object.assign(free.body.state.arm, { kick: 1, weight: 0.6 });
    expect(armsInputOf(free, null, { player: null, effects: null, aspect: 1 }).kick?.weight).toBe(0.6);
  });
});
