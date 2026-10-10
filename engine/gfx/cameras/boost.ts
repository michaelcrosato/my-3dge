/**
 * @file The height boost (PLAN.md WP 2.5; doctrine: Quality under the hood): the 2D engine's `zBoost`, the classic
 * pixel-art cheat that draws heights taller than they are so walls and characters read, done in the projection matrix
 * only. The projection becomes P·V·S·V⁻¹, with S a scale of world y by `k` about the floor (y = 0), so a point is
 * drawn where P·V·S puts it while the view matrix, lights, shadows, physics and picking keep true heights.
 *
 * `boost(camera, k)` is the prototype's function. `BoostedPerspectiveCamera` and `BoostedOrthographicCamera` are
 * three.js's cameras with a `boost` field that every `updateProjectionMatrix()` keeps, so a caller that refits the
 * lens (the renderer's `frame()` sets a perspective camera's aspect, engine/gfx/renderer.ts) does not drop the boost.
 * engine/gfx/cameras/place.ts uses them.
 *
 * Invariants: k = 1 leaves three.js's projection untouched. The boost uses the camera's matrices at the time of the
 * last `updateProjectionMatrix()`: a camera moved afterwards needs it again (`placeCamera` does both, every frame).
 * A vertical 1 m edge at the target projects k times as tall as without the boost (engine/gfx/cameras/boost.test.ts
 * checks every classic view against the 2D engine's projection, within 1%).
 *
 * Carried from `my-3d2dge:src/lab3d/50-cameras.js:31-40` (`boost()`, COPY).
 *
 * @example
 * const camera = new BoostedOrthographicCamera(-5, 5, 5, -5, 0.1, 100);
 * camera.position.set(0, 10, 10);
 * camera.lookAt(0, 0, 0);
 * camera.boost = 1.35; // threequarter's height boost
 * camera.updateProjectionMatrix(); // the projection now stretches heights by 1.35
 * @see engine/gfx/cameras/boost.test.ts
 */
import { Matrix4, OrthographicCamera, PerspectiveCamera, type Camera, type Object3D } from 'three/webgpu';

const _S = new Matrix4();
const _M = new Matrix4();

/** Multiplies `camera`'s projection by V·S·V⁻¹ (S: world y × `k`), with its current matrices. */
export function applyBoost(camera: Camera, k: number): void {
  _M.copy(camera.matrixWorldInverse)
    .multiply(_S.makeScale(1, k, 1))
    .multiply(camera.matrixWorld);
  camera.projectionMatrix.multiply(_M);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/** A camera that keeps a height boost through `updateProjectionMatrix()`. */
export interface Boosted {
  /** Heights are stretched by this in the picture; 1 shows true heights. */
  boost: number;
}

/** Whether `camera` keeps its own boost (one of this module's camera classes). */
export function isBoosted(camera: Camera): camera is Camera & Boosted {
  return camera instanceof BoostedPerspectiveCamera || camera instanceof BoostedOrthographicCamera;
}

/**
 * The prototype's `boost()`: updates `camera`'s world and projection matrices, then stretches heights by `k` in the
 * projection. On a boosted camera it sets the camera's `boost` instead, which its projection keeps from then on.
 */
export function boost(camera: PerspectiveCamera | OrthographicCamera, k: number): void {
  camera.updateMatrixWorld();
  if (isBoosted(camera)) {
    camera.boost = k;
    camera.updateProjectionMatrix();
    return;
  }
  camera.updateProjectionMatrix();
  if (k !== 1) applyBoost(camera, k);
}

/** Applies a boosted camera's boost after three.js rebuilt its projection (constructors run before `boost` is set). */
function keep(camera: Camera & Partial<Boosted>): void {
  const k = camera.boost;
  if (k === undefined || k === 1) return;
  camera.updateMatrixWorld();
  applyBoost(camera, k);
}

/** three.js's `PerspectiveCamera` with a height `boost` its projection keeps (see the file comment). */
export class BoostedPerspectiveCamera extends PerspectiveCamera {
  /** Heights are stretched by this in the picture; 1 (the default) shows true heights. */
  declare boost: number;

  /** As `PerspectiveCamera`'s constructor; the boost starts at 1. */
  constructor(fov?: number, aspect?: number, near?: number, far?: number) {
    super(fov, aspect, near, far);
    this.boost = 1;
  }

  /** three.js's projection for the lens, then the boost. */
  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    keep(this);
  }

  /** Copies `source` as three.js does, and its boost. */
  override copy(source: Object3D, recursive?: boolean): this {
    super.copy(source as PerspectiveCamera, recursive);
    this.boost = (source as Object3D & Partial<Boosted>).boost ?? 1;
    return this;
  }
}

/** three.js's `OrthographicCamera` with a height `boost` its projection keeps (see the file comment). */
export class BoostedOrthographicCamera extends OrthographicCamera {
  /** Heights are stretched by this in the picture; 1 (the default) shows true heights. */
  declare boost: number;

  /** As `OrthographicCamera`'s constructor; the boost starts at 1. */
  constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number) {
    super(left, right, top, bottom, near, far);
    this.boost = 1;
  }

  /** three.js's projection for the frustum, then the boost. */
  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    keep(this);
  }

  /** Copies `source` as three.js does, and its boost. */
  override copy(source: Object3D, recursive?: boolean): this {
    super.copy(source as OrthographicCamera, recursive);
    this.boost = (source as Object3D & Partial<Boosted>).boost ?? 1;
    return this;
  }
}
