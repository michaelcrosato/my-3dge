/**
 * @file Unit tests for the chase camera (`engine/gfx/cameras/chase.ts`), with WP 3.9's Done-when: following the walker
 * of fixtures/scenes/chase-walls/ there and back, turning all the way round and tilting, the camera never ends inside a
 * wall, checked with the scene's `QueryView` (the ground probed under it is below it, its near-plane ball overlaps
 * nothing, the line from the hero's head to it is clear), where the same camera without walls ends inside one often.
 * Also: the arm's place and look, following with its lag, turning and zooming within the limits, snapping in front
 * of a wall and easing back out, its yaw driving the intents' `fromCamera`, and its codes round-tripping.
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { fromCamera } from '../../input/intents';
import { createPhysics } from '../../physics/world';
import { startScene } from '../../sim/scene';
import { queryView, queryViewOf, type QueryView } from '../../sim/queryView';
import chaseWalls, { CHASE_WALLS } from '../../../fixtures/scenes/chase-walls';
import {
  CHASE_DEFAULTS,
  CHASE_HEIGHT,
  CHASE_LAG,
  CHASE_LIMITS,
  CHASE_RADIUS,
  CHASE_RETURN,
  chaseState,
  createChaseCamera,
  formatChaseCode,
  parseChaseCode,
  readCode,
  stepChase,
} from './chase';
import { ORBIT_ZOOM_STEP } from './orbit';
import { poseForward, poseTarget, type CameraPose, type Vec3 } from './pose';

const DEG = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** How far the near plane's corners are from the eye, at 16:9 (what must stay clear of walls). */
function nearCorner(pose: CameraPose, aspect = 16 / 9): number {
  const t = Math.tan((pose.fov / 2) * DEG);
  return pose.near * Math.sqrt(1 + t * t * (1 + aspect * aspect));
}

/** What the QueryView probes find wrong with a camera at `pose` watching a hero whose head is at `head`. */
function inWall(q: QueryView, pose: CameraPose, head: Vec3): string[] {
  const [x, y, z] = pose.position;
  const problems: string[] = [];
  const ground = q.probe(x, z, { groups: 'world' });
  if (!ground || ground.y >= y)
    problems.push(`below the surface at ${ground?.y ?? 'none'} (inside a wall or the floor)`);
  if (q.overlap({ type: 'ball', radius: nearCorner(pose) }, pose.position, { groups: 'world' }).length)
    problems.push('its near plane overlaps a wall');
  const toCamera = sub(pose.position, head);
  if (length(toCamera) > 1e-6 && q.raycast(head, toCamera, { maxDistance: length(toCamera), groups: 'world' }))
    problems.push('a wall stands between the hero and the camera');
  return problems;
}

/** Follows the chase-walls walker for `steps` frames, turning and tilting; returns the frames that went wrong. */
function walkChaseWalls(steps: number, walls: boolean) {
  const { world } = startScene(chaseWalls);
  const q = queryViewOf(world);
  const chase = createChaseCamera();
  const bad: string[] = [];
  let shortened = 0;
  let shortest = Infinity;
  for (let frame = 0; frame < steps; frame++) {
    world.step({});
    const { x, y, z } = world.query('walker')[0].walker;
    const tilt = (frame % 480 < 240 ? 1 : -1) * 0.012; // up and down between the pitch limits, every 8 s
    const pose = chase.update(
      { follow: [x, y, z], look: [0.021, tilt], ...(walls ? { queries: q } : {}) }, // once round every 5 s
      1 / 60,
    );
    if (pose.distance < chase.spec().distance! - 1e-9) shortened++;
    shortest = Math.min(shortest, pose.distance);
    const problems = inWall(q, pose, [x, y + CHASE_HEIGHT, z]);
    if (problems.length) bad.push(`frame ${frame} at ${pose.position.map((v) => v.toFixed(2))}: ${problems}`);
  }
  return { bad, shortened, shortest };
}

describe('the chase camera', () => {
  it('in the chase-walls fixture never ends inside a wall, checked with QueryView probes (Done-when)', () => {
    expect(CHASE_WALLS.cols * CHASE_WALLS.rows).toBe(16 * 12);
    const { bad, shortened, shortest } = walkChaseWalls(2400, true); // the route there and back: 40 s
    expect(bad).toEqual([]);
    expect(shortened).toBeGreaterThan(1800); // walls cut the arm on most frames
    expect(shortest).toBeGreaterThan(0.5 - CHASE_RADIUS - 0.05); // and never into the head: 1 m corridors leave 0.28 m
    const blind = walkChaseWalls(2400, false); // the same camera without the QueryView
    expect(blind.bad.length).toBeGreaterThan(1200);
  });

  it('hangs behind and above the pivot on its arm and looks at the pivot', () => {
    const chase = createChaseCamera({ yaw: 0, pitch: -0.36, distance: 5.5 });
    const pose = chase.update({ follow: [2, 0, 3] }, 1 / 60); // the first follow snaps
    close(poseTarget(pose), [2, CHASE_HEIGHT, 3]);
    close(pose.position, [2, 1.5 + 5.5 * Math.sin(0.36), 3 - 5.5 * Math.cos(0.36)]);
    expect(pose).toMatchObject({ projection: 'perspective', fov: CHASE_DEFAULTS.fov, distance: 5.5, pitch: -0.36 });
    expect(chase.yaw()).toBe(0);
    close(fromCamera(chase.yaw(), [0, 1]), [0, 1]); // W walks away from the camera: along +Z
  });

  it('follows with a lag of CHASE_LAG real seconds, the same at any frame rate', () => {
    const a = createChaseCamera();
    const b = createChaseCamera();
    a.update({ follow: [0, 0, 0] }, 1 / 60);
    b.update({ follow: [0, 0, 0] }, 1 / 60);
    a.update({ follow: [1, 0, 0] }, CHASE_LAG);
    for (let i = 0; i < 10; i++) b.update({ follow: [1, 0, 0] }, CHASE_LAG / 10);
    expect(poseTarget(a.pose())[0]).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(poseTarget(b.pose())[0]).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it('turns right and up with look and turn, steps its arm with zoom, within its limits', () => {
    const state = chaseState({ yaw: 0, pitch: 0, distance: 5 });
    expect(stepChase(state, { look: [0.2, 0.1] }, 0)).toMatchObject({ yaw: -0.2, pitch: 0.1 });
    expect(stepChase(state, { turn: [1, 0] }, 0.5).yaw).toBeCloseTo(-1.1, 12); // 2.2 rad/s
    expect(stepChase(state, { look: [0, -9] }, 0).pitch).toBe(CHASE_LIMITS.pitch[0]);
    expect(stepChase(state, { zoom: 1 }, 0).distance).toBeCloseTo(5 / ORBIT_ZOOM_STEP, 12);
    expect(stepChase(state, { zoom: -99 }, 0).distance).toBe(CHASE_LIMITS.distance[1]);
    expect(() => chaseState({ distance: 0 })).toThrow(/GFX_BAD_CAMERA/);
  });

  it('snaps in front of a wall, CHASE_RADIUS short of it, and eases back out when it turns away', () => {
    const physics = createPhysics();
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [10, 6, 1] }, position: [0, 0, -3.5] }],
    });
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    const q = queryView(physics); // a wall whose face is 3 m behind the hero (−Z), the arm 5.5 m long
    const chase = createChaseCamera({ yaw: 0, pitch: 0, distance: 5.5 });
    const pose = chase.update({ follow: [0, 0, 0], queries: q }, 1 / 60);
    expect(pose.position[2]).toBeGreaterThan(-3 + CHASE_RADIUS - 1e-6);
    expect(pose.position[2]).toBeLessThan(-3 + CHASE_RADIUS + 0.05);
    const turned = chase.update({ follow: [0, 0, 0], queries: q, look: [Math.PI, 0] }, 0); // the arm now runs to +Z
    expect(turned.distance).toBeCloseTo(pose.distance, 12); // no jump out
    const out = chase.update({ follow: [0, 0, 0], queries: q }, CHASE_RETURN);
    expect(out.distance).toBeCloseTo(5.5 - (5.5 - pose.distance) * Math.exp(-1), 9);
    expect(poseForward(out)[2]).toBeCloseTo(-1, 12);
  });

  it('starts from the heading of the camera before it', () => {
    const before = { yaw: 1.2 } as CameraPose;
    expect(createChaseCamera({ from: before }).yaw()).toBeCloseTo(1.2, 12);
  });

  it('round-trips its codes (Done-when)', () => {
    for (const code of ['cam3=chase', 'cam3=chase,0,-20.63,5.5', 'cam3=chase,-90,10,2.25', 'cam3=chase,180,-45,12']) {
      expect(formatChaseCode(parseChaseCode(code))).toBe(code);
    }
    expect(parseChaseCode('?cam3=chase,90,-30,4')).toEqual({
      type: 'chase',
      yaw: 90 * DEG,
      pitch: -30 * DEG,
      distance: 4,
    });
    expect(parseChaseCode('chase')).toEqual({ type: 'chase' });
    const chase = createChaseCamera({ yaw: 2, pitch: -0.5, distance: 7.25 });
    chase.update({ follow: [1, 0, 1] }, 1 / 60);
    const again = createChaseCamera(parseChaseCode(chase.code()));
    again.update({ follow: [1, 0, 1] }, 1 / 60);
    close(again.pose().position, chase.pose().position, 3);
    expect(again.code()).toBe(chase.code());
    expect(chase.describe()).toBe(
      'Chase camera (perspective, 60° field of view), 7.25 m behind, heading 114.59°, pitch -28.65°',
    );
  });

  it('refuses bad codes, listing every problem', () => {
    expect(() => parseChaseCode('cam3=chase,1,2')).toThrow(/GFX_BAD_CAMERA_CODE.*takes 0 or 3 numbers/);
    expect(() => parseChaseCode('cam3=chase,x,-100,0')).toThrow(/part 2 \(x\).*pitch is -100.*distance is 0/);
    expect(() => parseChaseCode('cam=chase')).toThrow(/write cam3=chase/);
    expect(() => parseChaseCode('cam3=chace')).toThrow(/GFX_UNKNOWN_CAMERA.*did you mean "chase"/);
    expect(() => readCode('cam3=chase,,1', 'chase', [], [0])).toThrow(/empty part/);
  });
});
