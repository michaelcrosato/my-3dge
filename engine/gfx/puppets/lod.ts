/**
 * @file The crowd's level of detail (PLAN.md WP 5.4, I-21): which bodies a frame draws, and in how much detail, from
 * the camera alone. `createCrowdLod(options)` makes one (`createCrowd` holds one, engine/gfx/puppets/crowd.ts); each
 * frame `begin(camera)`, then `see(x, y, z, radius)` for each body's bounding sphere: null when the frame does not
 * draw it, else the band it is drawn in. Pose the bodies that are seen, at their band's `pose`, and only those: a
 * body out of view costs nothing.
 *
 * The bands (`CROWD_LOD`), by the distance from the camera to the body's centre, times `scale`:
 * - up to 15 m: posed in full (the animator's level 0, engine/anim/weights.ts `LOD`), capes drawn;
 * - up to 30 m: level 1, without post IK and secondary motion;
 * - up to 60 m: level 2, re-solved every other tick, without capes;
 * - up to 200 m: level 3, re-solved every fourth tick, without capes. Further away, nothing is drawn.
 *
 * Culling, carried from `drawCrowd`: a body is drawn only when its sphere touches the camera's view (three.js's
 * `Frustum`, in the camera's own coordinate system) and its centre lies further than `near` metres from the camera
 * across the floor (first person: a body pressed against the camera would fill the picture; 0, off, by default).
 * With `enabled` false, every body in view is drawn in the first band, in full detail, whatever its distance.
 *
 * Invariants: presentation only. It reads the camera and the spheres it is given and writes only its own counts; the
 * sim never reads it, so the sim's hash is the same with LOD on, off, or with nothing drawn
 * (tests/e2e/crowd-render.spec.ts). Bands are checked when made (`GFX_CROWD_LOD`). `scale` and `enabled` may change
 * between frames.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:342-373` (`drawCrowd`'s culling: `vis`, the camera's view, and
 * `near`); the bands are new.
 *
 * @example
 * // const lod = createCrowdLod(); lod.begin(camera);
 * // const band = lod.see(x, y + 0.9, z, 1.4); // null: not drawn this frame
 * // if (band) animator.pose({ at, yaw, lod: band.pose });
 * CROWD_LOD.map((band) => band.upTo); // [15, 30, 60, 200]
 * @see engine/gfx/puppets/lod.test.ts
 * @see tests/e2e/crowd-render.spec.ts
 */
import { Frustum, Matrix4, Sphere, Vector3, type Camera } from 'three/webgpu';
import { LOD } from '../../anim/weights';
import { codeError, defineCodes } from '../../core/log';

/** The codes the crowd's level of detail raises, with their fixes. */
export const CROWD_LOD_CODES = defineCodes('gfx', {
  GFX_CROWD_LOD: {
    template: 'crowd LOD band {index} {problem}',
    fix: 'give each band an upTo in metres above the last one and a pose level from 0 to {last} (engine/anim/weights.ts LOD)',
    doc: 'Raised by `createCrowdLod` (engine/gfx/puppets/lod.ts) for bands that are not in increasing distance, or whose pose level is not one of the animator’s detail levels.',
  },
});

/** One band of detail: the bodies whose distance is under its `upTo` and at least the band before's. */
export interface CrowdBand {
  /** Its place among the bands, 0 nearest. */
  readonly index: number;
  /** Metres from the camera to the band's far edge. */
  readonly upTo: number;
  /** The animator's detail level for bodies in it: an index into engine/anim/weights.ts `LOD`. */
  readonly pose: number;
  /** Whether capes are drawn. */
  readonly capes: boolean;
}

/** A band as written: without its index. */
export type CrowdBandSpec = Omit<CrowdBand, 'index'>;

/** The default bands (see the file comment). */
export const CROWD_LOD: readonly CrowdBandSpec[] = [
  { upTo: 15, pose: 0, capes: true },
  { upTo: 30, pose: 1, capes: true },
  { upTo: 60, pose: 2, capes: false },
  { upTo: 200, pose: 3, capes: false },
];

/** How a crowd's level of detail is made. */
export interface CrowdLodOptions {
  /** The bands, nearest first; `CROWD_LOD` by default. */
  bands?: readonly CrowdBandSpec[];
  /** Whether bands apply (true); off, every body in view is drawn in full. */
  enabled?: boolean;
  /** Distances are multiplied by this before they are compared (1; 2 drops detail at half the distance). */
  scale?: number;
  /** Bodies whose centre is within this many metres of the camera, across the floor, are not drawn (0: off). */
  near?: number;
}

/** A frame's counts so far: bodies drawn in each band, and those culled by the view, the distance and `near`. */
export interface CrowdLodCounts {
  bands: number[];
  outside: number;
  far: number;
  near: number;
}

/** A crowd's level of detail (see the file comment). */
export interface CrowdLod {
  readonly bands: readonly CrowdBand[];
  enabled: boolean;
  scale: number;
  near: number;
  /** Starts a frame seen by `camera`: its view and position, and counts from 0. */
  begin(camera: Camera): void;
  /** The band a body whose bounding sphere is at (x, y, z) with `radius` is drawn in; null when it is not drawn. */
  see(x: number, y: number, z: number, radius: number): CrowdBand | null;
  /** This frame's counts so far (a copy). */
  counts(): CrowdLodCounts;
}

/** `bands` with their indices, checked. Throws `GFX_CROWD_LOD`. */
function checkBands(bands: readonly CrowdBandSpec[]): CrowdBand[] {
  const last = LOD.length - 1;
  if (!bands.length) throw codeError('GFX_CROWD_LOD', { index: 0, problem: 'is missing: give at least one', last });
  return bands.map((band, index) => {
    const before = index ? bands[index - 1].upTo : 0;
    const fail = (problem: string) => codeError('GFX_CROWD_LOD', { index, problem, last });
    if (!(band.upTo > before)) throw fail(`ends at ${band.upTo} m, not beyond ${before} m`);
    if (!Number.isInteger(band.pose) || band.pose < 0 || band.pose > last) throw fail(`has pose level ${band.pose}`);
    return { index, upTo: band.upTo, pose: band.pose, capes: band.capes };
  });
}

/** Makes a crowd's level of detail (see the file comment). Throws `GFX_CROWD_LOD` for bad bands. */
export function createCrowdLod(options: CrowdLodOptions = {}): CrowdLod {
  const bands = checkBands(options.bands ?? CROWD_LOD);
  const frustum = new Frustum();
  const view = new Matrix4();
  const eye = new Vector3();
  const sphere = new Sphere();
  let counts: CrowdLodCounts = { bands: bands.map(() => 0), outside: 0, far: 0, near: 0 };
  const lod: CrowdLod = {
    bands,
    enabled: options.enabled ?? true,
    scale: options.scale ?? 1,
    near: options.near ?? 0,
    begin(camera) {
      camera.updateWorldMatrix(true, false);
      view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(view, camera.coordinateSystem, camera.reversedDepth);
      eye.setFromMatrixPosition(camera.matrixWorld);
      counts = { bands: bands.map(() => 0), outside: 0, far: 0, near: 0 };
    },
    see(x, y, z, radius) {
      sphere.center.set(x, y, z);
      sphere.radius = radius;
      if (!frustum.intersectsSphere(sphere)) {
        counts.outside++;
        return null;
      }
      if (lod.near > 0 && Math.hypot(x - eye.x, z - eye.z) < lod.near) {
        counts.near++;
        return null;
      }
      let band = bands[0];
      if (lod.enabled) {
        const distance = sphere.center.distanceTo(eye) * lod.scale;
        const found = bands.find((b) => distance < b.upTo);
        if (!found) {
          counts.far++;
          return null;
        }
        band = found;
      }
      counts.bands[band.index]++;
      return band;
    },
    counts: () => ({ ...counts, bands: [...counts.bands] }),
  };
  return lod;
}
