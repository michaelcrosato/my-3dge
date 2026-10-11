/**
 * @file Unit tests for the crowd's level of detail (engine/gfx/puppets/lod.ts), in Node: the default bands (15, 30,
 * 60 and 200 m; the animator's levels 0–3; capes to 30 m), a body's band by its distance from the camera, times
 * `scale`; the draw distance; culling by the view (a sphere touching it counts, in either coordinate system) and by
 * `near`; LOD off (every body in view in full, at any distance); the frame's counts; and bad bands refused.
 * @see engine/gfx/puppets/lod.ts
 */
import { PerspectiveCamera, WebGPUCoordinateSystem } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { LOD } from '../../anim/weights';
import { createCrowdLod, CROWD_LOD } from './lod';

/** A camera at the origin, 1.5 m up, looking along −Z. */
function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(50, 16 / 9, 0.1, 500);
  view.position.set(0, 1.5, 0);
  view.lookAt(0, 1.5, -1);
  return view;
}

/** The band index each body straight ahead at `distances` gets (−1: not drawn). */
const bands = (lod: ReturnType<typeof createCrowdLod>, distances: number[]) =>
  distances.map((d) => lod.see(0, 1.5, -d, 1)?.index ?? -1);

describe('the bands', () => {
  it('pose in full near, then drop post IK, then re-solve less often, and drop capes beyond 30 m', () => {
    expect(CROWD_LOD.map((band) => band.upTo)).toEqual([15, 30, 60, 200]);
    expect(CROWD_LOD.map((band) => band.pose)).toEqual([0, 1, 2, 3]);
    expect(CROWD_LOD.map((band) => LOD[band.pose].every)).toEqual([1, 1, 2, 4]);
    expect(CROWD_LOD.map((band) => band.capes)).toEqual([true, true, false, false]);
  });

  it('puts a body in the band its distance falls in, and draws nothing beyond the last', () => {
    const lod = createCrowdLod();
    lod.begin(camera());
    expect(bands(lod, [2, 14.9, 15, 29, 31, 59, 61, 199, 201, 400])).toEqual([0, 0, 1, 1, 2, 2, 3, 3, -1, -1]);
    expect(lod.counts()).toEqual({ bands: [2, 2, 2, 2], outside: 0, far: 2, near: 0 });
    const band = lod.see(0, 1.5, -40, 1);
    expect(band).toEqual({ index: 2, upTo: 60, pose: 2, capes: false });
  });

  it('measures from the camera to the centre, in three dimensions, times scale', () => {
    const lod = createCrowdLod({ scale: 2 });
    lod.begin(camera());
    expect(bands(lod, [7, 8, 16, 99, 101])).toEqual([0, 1, 2, 3, -1]);
    lod.scale = 1;
    expect(lod.see(5, 1.5 + 3, -16, 1)?.index, 'hypot(5, 3, 16) ≈ 17 m').toBe(1);
  });

  it('takes bands of its own', () => {
    const lod = createCrowdLod({
      bands: [
        { upTo: 5, pose: 0, capes: true },
        { upTo: Infinity, pose: 3, capes: false },
      ],
    });
    lod.begin(camera());
    expect(bands(lod, [4, 6, 450])).toEqual([0, 1, 1]);
    expect(bands(lod, [600]), 'beyond the camera’s far plane').toEqual([-1]);
  });
});

describe('culling', () => {
  it('draws only bodies whose sphere touches the view: not behind, not beside, unless their radius reaches in', () => {
    const lod = createCrowdLod();
    lod.begin(camera());
    expect(lod.see(0, 1.5, 10, 1), 'behind').toBeNull();
    expect(lod.see(40, 1.5, -10, 1), 'far to the right').toBeNull();
    expect(lod.see(40, 1.5, -10, 40)?.index, 'its sphere reaches into the view, 41 m away').toBe(2);
    expect(lod.see(0, 1.5, -10, 0)?.index, 'a point in the middle').toBe(0);
    expect(lod.counts()).toMatchObject({ outside: 2 });
  });

  it('reads the camera as it is now, in the coordinate system of its projection (WebGPU’s too)', () => {
    const view = camera();
    view.coordinateSystem = WebGPUCoordinateSystem;
    view.updateProjectionMatrix();
    const lod = createCrowdLod();
    lod.begin(view);
    expect(bands(lod, [10, 20, -10])).toEqual([0, 1, -1]);
    view.rotation.y = Math.PI; // now looking along +Z
    lod.begin(view);
    expect([lod.see(0, 1.5, -10, 1), lod.see(0, 1.5, 10, 1)?.index]).toEqual([null, 0]);
  });

  it('hides bodies within near metres of the camera across the floor (first person)', () => {
    const lod = createCrowdLod({ near: 1 });
    lod.begin(camera());
    expect(lod.see(0.3, 0.9, -0.5, 1), '0.58 m away across the floor').toBeNull();
    expect(lod.see(0, 0.9, -1.2, 1)?.index).toBe(0);
    expect(lod.counts().near).toBe(1);
  });

  it('with LOD off, draws every body in view in full, at any distance', () => {
    const lod = createCrowdLod({ enabled: false });
    lod.begin(camera());
    expect(bands(lod, [2, 40, 150, 400])).toEqual([0, 0, 0, 0]);
    expect(lod.see(0, 1.5, 10, 1), 'still culled by the view').toBeNull();
    lod.enabled = true;
    expect(bands(lod, [40, 400])).toEqual([2, -1]);
  });

  it('counts from 0 at each frame, and hands out a copy', () => {
    const lod = createCrowdLod();
    lod.begin(camera());
    bands(lod, [2, 20]);
    const counts = lod.counts();
    counts.bands[0] = 99;
    expect(lod.counts().bands).toEqual([1, 1, 0, 0]);
    lod.begin(camera());
    expect(lod.counts()).toEqual({ bands: [0, 0, 0, 0], outside: 0, far: 0, near: 0 });
  });
});

describe('bad bands', () => {
  it('refuses bands out of order, pose levels the animator lacks, and none at all', () => {
    const band = (upTo: number, pose: number) => ({ upTo, pose, capes: true });
    expect(() => createCrowdLod({ bands: [band(20, 0), band(10, 1)] })).toThrow(/GFX_CROWD_LOD.*band 1 ends at 10 m/);
    expect(() => createCrowdLod({ bands: [band(0, 0)] })).toThrow(/GFX_CROWD_LOD/);
    expect(() => createCrowdLod({ bands: [band(10, 4)] })).toThrow(/GFX_CROWD_LOD.*pose level 4.*0 to 3/);
    expect(() => createCrowdLod({ bands: [band(10, 1.5)] })).toThrow(/GFX_CROWD_LOD/);
    expect(() => createCrowdLod({ bands: [] })).toThrow(/GFX_CROWD_LOD.*missing/);
  });
});
