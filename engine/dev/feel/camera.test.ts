/**
 * @file Unit tests for the feel kit's camera metrics (engine/dev/feel/camera.ts): a point is in the picture only in
 * front of the camera and within its lens or its frustum; a chase camera following a steady run never jumps past the
 * player's move, never turns and never loses the player; a blended switch and the sim's look move the camera only as
 * far as they account for; a fixed camera inside a wall counts its frames inside, one looking away counts them lost,
 * and one standing still while the player stands still never jumps.
 * @see engine/dev/feel/camera.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { makePose } from '../../gfx/cameras/pose';
import { physicsOf } from '../../physics/binding';
import { queryViewOf } from '../../sim/queryView';
import { defineScene, startScene } from '../../sim/scene';
import type { World } from '../../sim/world';
import { createCameraTrack, inPicture } from './camera';

/** The query view of a world with a floor and a 4 m cube whose centre is at (0, 2, 10). */
function walls() {
  const registry = createRegistry();
  const setup = (w: World) => {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [200, 1, 200] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [4, 4, 4] }, position: [0, 2, 10] }] }); // prettier-ignore
  };
  defineScene('walls', { physics: true, setup }, registry);
  const { world } = startScene('walls', { registry });
  world.step({});
  return queryViewOf(world);
}

describe('camera metrics', () => {
  it('see a point only in front of the camera, within its lens or its frustum', () => {
    const ahead = makePose({ position: [0, 1.5, 0], yaw: 0, pitch: 0, fov: 60, distance: 5 });
    expect(inPicture(ahead, [0, 1.5, 5])).toBe(true);
    expect(inPicture(ahead, [0, 1.5, -5])).toBe(false); // behind it
    expect(inPicture(ahead, [6, 1.5, 5])).toBe(false); // past the lens's edge at 5 m (±5.1 m across at 16:9)
    const above = makePose({ position: [0, 20, 0], yaw: 0, pitch: -Math.PI / 2, projection: 'orthographic', frustumSize: 10, distance: 20 }); // prettier-ignore
    expect([inPicture(above, [0, 0, 4]), inPicture(above, [0, 0, 6])]).toEqual([true, false]);
  });

  it('find no jump, turn or loss behind a steady run in the chase camera', () => {
    const queries = walls();
    const track = createCameraTrack('cam3=chase');
    for (let k = 0; k < 120; k++) track.frame([k * 0.08, 0, -20], { queries });
    expect(track.metrics()).toEqual({ jump: 0, turn: expect.closeTo(0, 9), inside: 0, lost: 0 });
  });

  it('allow what a blended switch and the sim’s look move the camera, and nothing else', () => {
    const track = createCameraTrack('cam=iso');
    for (let k = 0; k < 120; k++) {
      if (k === 40) track.set('cam3=shoulder');
      track.frame([k * 0.08, 0, 0], { look: [k < 80 ? 0 : Math.PI / 2, 0] }); // a quarter turn of the look at 80
    }
    const switching = track.frames.slice(41, 62);
    expect(Math.max(...switching.map((f) => f.allowed.move))).toBeGreaterThan(1); // the blend swept it far
    expect(track.frames[80].allowed.turn).toBeCloseTo(Math.PI / 2, 6);
    expect(track.metrics()).toMatchObject({ jump: expect.any(Number), lost: 0 });
    expect(track.metrics().jump).toBeLessThan(0.3);
    expect(track.metrics().turn).toBeLessThan(0.01);
  });

  it('allow the look only to the cameras that look along it, so a cut between views is counted whatever the look', () => {
    const track = createCameraTrack('cam=iso', { blend: 0 });
    const north: [number, number] = [Math.PI, 0]; // the top-down view's own heading: no look turns it
    for (let k = 0; k < 20; k++) {
      if (k === 10) track.set('cam=overhead'); // blend 0: a cut
      track.frame([0, 0, 0], { look: north });
    }
    expect(track.frames.every((f) => f.allowed.turn === 0 && f.allowed.move === 0)).toBe(true);
    expect(track.metrics().jump).toBeGreaterThan(1); // the cut's move, counted
    expect(track.metrics().turn).toBeGreaterThan(0.5); // and its turn
  });

  it('count the frames a camera stands inside the level, or loses the player, and a still camera never jumps', () => {
    const queries = walls();
    const inside = createCameraTrack('cam3=fixed,0,2,10,0,0');
    const away = createCameraTrack('cam3=fixed,0,1.5,-5,180,0'); // looking north, the player to its south
    for (let k = 0; k < 30; k++) {
      inside.frame([0, 0, 0], { queries });
      away.frame([0, 0, 0], { queries });
    }
    expect(inside.metrics()).toMatchObject({ inside: 30, jump: 0, turn: 0 });
    expect(away.metrics()).toMatchObject({ inside: 0, lost: 30, jump: 0 });
  });
});
