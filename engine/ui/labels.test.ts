/**
 * @file Unit tests for engine/ui/labels.ts (T1, PLAN.md WP 6.5): a point lands on the overlay where three.js's
 * `Vector3.project` puts it, for perspective, orthographic and height-boosted cameras, and is culled before `near` and
 * past `far`; damage numbers rise 1.1 m over their 0.8 s and stack as the prototype's did (within 0.12 s and 1.75 m
 * of the last: five slots over the column's anchor, then round again); anchors are points or coded errors.
 * @see engine/ui/labels.ts
 */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createCamera, createCameraPair } from '../gfx/cameras/place';
import { damageRise, DAMAGE_NUMBERS, projectToOverlay, stackDamage, worldPoint, type DamageColumn } from './labels';

/** Where three.js's own `project` puts (x, y, z) on a `width` × `height` overlay, CSS px. */
function threeProjects(
  camera: PerspectiveCamera | OrthographicCamera,
  p: readonly number[],
  width: number,
  height: number,
) {
  const ndc = new Vector3(p[0], p[1], p[2]).project(camera);
  return [((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height];
}

/** A grid of points round the origin, m. */
const POINTS = [-3, 0, 2.5].flatMap((x) => [0, 1.2, 3].flatMap((y) => [-2, 0, 4].map((z) => [x, y, z])));

describe('projectToOverlay', () => {
  const pair = createCameraPair();
  const cameras: [string, PerspectiveCamera | OrthographicCamera][] = [
    ['a perspective camera', pair.place(createCamera('cam=brawler').update({ follow: [0, 0, 0] }), 16 / 9).clone()],
    [
      'a boosted orthographic camera',
      pair.place(createCamera('cam=threequarter').update({ follow: [0, 0, 0] }), 4 / 3),
    ],
  ];
  for (const [name, camera] of cameras) {
    it(`puts a point where three.js projects it, for ${name}`, () => {
      camera.updateMatrixWorld();
      const out = [0, 0, 0];
      for (const p of POINTS) {
        expect(projectToOverlay(camera, p[0], p[1], p[2], 800, 450, out)).toBe(true);
        const [x, y] = threeProjects(camera, p, 800, 450);
        expect(Math.abs(out[0] - x) + Math.abs(out[1] - y)).toBeLessThan(1e-9);
        expect(out[2]).toBeCloseTo(-new Vector3(...p).applyMatrix4(camera.matrixWorldInverse).z, 9);
      }
    });
  }

  it('culls a point nearer than near or beyond far, and keeps one between', () => {
    const camera = new PerspectiveCamera(50, 1, 0.5, 40);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const out = [7, 7, 7];
    expect(projectToOverlay(camera, 0, 0, 11, 100, 100, out)).toBe(false); // behind
    expect(projectToOverlay(camera, 0, 0, 9.6, 100, 100, out)).toBe(false); // nearer than near
    expect(projectToOverlay(camera, 0, 0, -31, 100, 100, out)).toBe(false); // beyond far
    expect(out).toEqual([7, 7, 7]);
    expect(projectToOverlay(camera, 0, 0, 0, 100, 100, out)).toBe(true);
    expect(out).toEqual([50, 50, 10]);
  });
});

describe('damage numbers', () => {
  it('rise 1.1 m over their life, slowing, never falling', () => {
    expect(damageRise(0)).toBe(0);
    expect(damageRise(DAMAGE_NUMBERS.life)).toBeCloseTo(1.1, 12);
    let step = Infinity;
    for (let t = 0.05; t <= DAMAGE_NUMBERS.life + 1e-9; t += 0.05) {
      const up = damageRise(t) - damageRise(t - 0.05);
      expect(up).toBeGreaterThan(0);
      expect(up).toBeLessThan(step);
      step = up;
    }
  });

  it('stack in five slots, then round again, while hits come within 0.12 s and 1.75 m', () => {
    let column: DamageColumn | null = null;
    const slots: number[] = [];
    for (let i = 0; i < 7; i++) {
      const hit = stackDamage(column, [2 + i * 0.2, 1.8 + i, 0], i * 0.1);
      column = hit.column;
      slots.push(hit.slot);
    }
    expect(slots).toEqual([0, 1, 2, 3, 4, 0, 1]);
    expect([column!.x, column!.y, column!.z]).toEqual([2, 1.8, 0]); // the first hit's anchor
  });

  it('start a new column for a hit 1.75 m away, or 0.12 s after the last', () => {
    const first = stackDamage(null, [0, 1, 0], 0).column;
    const far = stackDamage(first, [0, 1.5, 1.75], 0.01);
    expect([far.column === first, far.slot]).toEqual([false, 0]);
    const late = stackDamage(far.column, [0, 1.5, 1.75], 0.01 + DAMAGE_NUMBERS.stackTime);
    expect([late.column === far.column, late.slot]).toEqual([false, 0]);
    const soon = stackDamage(late.column, [1, 9, 1.75], 0.2);
    expect([soon.column === late.column, soon.slot, soon.column.y]).toEqual([true, 1, 1.5]);
  });
});

describe('worldPoint', () => {
  it('takes [x, y, z], a Vector3 or { x, y, z }', () => {
    expect(worldPoint([1, 2, 3], 'p')).toEqual([1, 2, 3]);
    expect(worldPoint(new Vector3(1, 2, 3), 'p')).toEqual([1, 2, 3]);
    expect(worldPoint({ x: 1, y: 2, z: 3 }, 'p')).toEqual([1, 2, 3]);
  });

  it('names what is wrong otherwise', () => {
    expect(() => worldPoint([1, 2], 'label "a"\'s at')).toThrow(
      '[UI_BAD_POINT] label "a"\'s at is [1,2], not a point in the world',
    );
    expect(() => worldPoint({ x: 1, y: NaN, z: 0 }, 'damage at')).toThrow(/UI_BAD_POINT.*damage at is/);
    expect(() => worldPoint(undefined, 'damage at')).toThrow('damage at is undefined');
  });
});
