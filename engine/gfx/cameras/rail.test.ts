/**
 * @file Unit tests for the depth rail (`engine/gfx/cameras/rail.ts`): where it starts and how it looks, following
 * along the rail and in height with its lag, keeping the hero between near and far in depth (and staying put in
 * between), a rail on another side, zoom steps, W walking into the depth, and its codes round-tripping.
 */
import { describe, expect, it } from 'vitest';
import { fromCamera } from '../../input/intents';
import { poseForward } from './pose';
import { VIEW_ZOOMS } from './presets';
import {
  createRailCamera,
  formatRailCode,
  parseRailCode,
  RAIL_DEFAULTS,
  RAIL_FOV,
  RAIL_HEIGHT,
  RAIL_LAG,
  RAIL_START,
  RAIL_TILT,
} from './rail';

const DEG = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('the depth rail', () => {
  it('starts RAIL_START out on the +Z side, RAIL_HEIGHT up, looking across and tilted down', () => {
    const rail = createRailCamera();
    const pose = rail.update({ follow: [2, 0.5, -1] }, 1 / 60);
    close(pose.position, [2, 0.5 + RAIL_HEIGHT, -1 + RAIL_START]);
    expect(pose).toMatchObject({ projection: 'perspective', fov: RAIL_FOV, pitch: -RAIL_TILT, zoom: 1 });
    close(poseForward(pose), [0, -Math.sin(RAIL_TILT), -Math.cos(RAIL_TILT)]);
    close(fromCamera(rail.yaw(), [0, 1]), [0, -1]); // W walks into the depth, away from the rail
    close(fromCamera(rail.yaw(), [1, 0]), [1, 0]); // D walks along it, to the right of the picture
  });

  it('follows along the rail and in height with RAIL_LAG, and stays put in depth between near and far', () => {
    const rail = createRailCamera();
    rail.update({ follow: [0, 0, 0] }, 1 / 60);
    const pose = rail.update({ follow: [3, 1, -2] }, RAIL_LAG); // 2 m deeper: 12 m away, within 6.875–16.25
    const k = 1 - Math.exp(-1);
    close(pose.position, [3 * k, k + RAIL_HEIGHT, RAIL_START]);
  });

  it('backs off when the hero comes nearer than near, follows when he goes past far', () => {
    const rail = createRailCamera();
    rail.update({ follow: [0, 0, 0] }, 1 / 60);
    for (let i = 0; i < 300; i++) rail.update({ follow: [0, 0, 8] }, 1 / 60); // 2 m from the rail
    expect(rail.pose().position[2]).toBeCloseTo(8 + RAIL_DEFAULTS.near, 6);
    for (let i = 0; i < 300; i++) rail.update({ follow: [0, 0, -20] }, 1 / 60);
    expect(rail.pose().position[2]).toBeCloseTo(-20 + RAIL_DEFAULTS.far, 6);
    const twice = createRailCamera();
    twice.update({ follow: [0, 0, 0] }, 1 / 60);
    const z = twice.update({ follow: [0, 0, 8] }, RAIL_LAG / 2).position[2]; // depth moves at twice the rate
    expect(z).toBeCloseTo(RAIL_START + (8 + RAIL_DEFAULTS.near - RAIL_START) * (1 - Math.exp(-1)), 9);
  });

  it('stands on any side: azimuth 90° puts it on +X, looking along −X', () => {
    const rail = createRailCamera({ azimuth: 90 * DEG, near: 4, far: 8 });
    const pose = rail.update({ follow: [1, 0, 1] }, 1 / 60);
    close(pose.position, [1 + RAIL_START, RAIL_HEIGHT, 1]);
    expect(rail.yaw()).toBeCloseTo(-90 * DEG, 12);
    for (let i = 0; i < 300; i++) rail.update({ follow: [1, 0, 1] }, 1 / 60);
    expect(rail.pose().position[0]).toBeCloseTo(1 + 8, 6); // back within far
  });

  it('steps its zoom through the views’ steps', () => {
    const rail = createRailCamera();
    expect(rail.update({ zoom: 1 }).zoom).toBe(VIEW_ZOOMS[3]);
    expect(rail.update({ zoom: -99 }).zoom).toBe(VIEW_ZOOMS[0]);
  });

  it('round-trips its codes', () => {
    for (const code of ['cam3=rail', 'cam3=rail,0,6.875,16.25', 'cam3=rail,90,4,8,2', 'cam3=rail,-45,3.5,20,0.5']) {
      expect(formatRailCode(parseRailCode(code))).toBe(code);
    }
    expect(parseRailCode('rail,90,4,8')).toEqual({ type: 'rail', azimuth: 90 * DEG, near: 4, far: 8 });
    const rail = createRailCamera({ azimuth: 1, near: 5, far: 9, zoom: 1.5 });
    const again = createRailCamera(parseRailCode(rail.code()));
    expect(again.code()).toBe(rail.code());
    close(again.update({ follow: [1, 0, 2] }).position, rail.update({ follow: [1, 0, 2] }).position, 2); // 0.01° at 10 m
    expect(rail.describe()).toBe(
      'Depth rail (perspective, 50° field of view), on the 57.3° side, the hero 5 to 9 m away, zoom 1.5x',
    );
    expect(() => parseRailCode('cam3=rail,0,9,5')).toThrow(/far \(5\) is nearer than near \(9\)/);
    expect(() => parseRailCode('cam3=rail,0,0,5')).toThrow(/near is 0/);
  });
});
