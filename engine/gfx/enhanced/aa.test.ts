/**
 * @file Unit tests for temporal edge smoothing (engine/gfx/enhanced/aa.ts): the camera is jittered by a sub-pixel step
 * only in frames the filter runs, and put back after each; the steps follow r182's Halton sequence, one a frame that
 * ran, the same each time; the jitter follows the chain's camera; the motion target reads the camera's projection
 * without the jitter, from before anything is built and after every frame. The smoothing drawn is
 * tests/e2e/post.spec.ts's.
 */
import { DepthTexture, PerspectiveCamera, Texture, type Matrix4 } from 'three/webgpu';
import { texture, velocity as motionNode } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import { createTemporalAa, STEADY } from './aa';

/** r182's hooks round each frame the chain draws (`TRAANode.js:443-452`). */
type Hooked = { setViewOffset(width: number, height: number): void; clearViewOffset(): void };

/** The smoothing over stand-in textures, run in frames `runs` says. */
function smoothing(runs: () => boolean) {
  const camera = new PerspectiveCamera(50, 2, 0.1, 100);
  const [beauty, velocity] = [texture(new Texture()), texture(new Texture())];
  const temporal = createTemporalAa({ beauty, depth: texture(new DepthTexture(4, 4)), velocity, camera, runs });
  return { camera, temporal, hooks: temporal.node as unknown as Hooked };
}

/** The sub-pixel step a frame's hooks give `camera`, or null when they leave it alone, and whether it is put back. */
function frame(hooks: Hooked, camera: PerspectiveCamera): { step: number[] | null; restored: boolean } {
  hooks.setViewOffset(200, 100);
  const step = camera.view?.enabled ? [camera.view.offsetX, camera.view.offsetY] : null;
  hooks.clearViewOffset();
  return { step, restored: !camera.view?.enabled };
}

describe('temporal edge smoothing', () => {
  it('jitters the camera only in frames it runs, puts it back after each, and steps on only then', () => {
    let on = false;
    const { camera, hooks } = smoothing(() => on);
    expect(frame(hooks, camera)).toEqual({ step: null, restored: true });
    on = true;
    const first = frame(hooks, camera);
    expect(first.restored).toBe(true);
    expect(first.step!.every((x) => Math.abs(x) < 0.5)).toBe(true);
    on = false;
    expect(frame(hooks, camera).step).toBeNull();
    on = true;
    const second = frame(hooks, camera).step;
    expect(second).not.toEqual(first.step);
    const again = smoothing(() => true);
    expect([frame(again.hooks, again.camera).step, frame(again.hooks, again.camera).step]).toEqual([first.step, second]); // prettier-ignore
  });

  it("jitters the chain's camera of the frame", () => {
    const { camera, temporal, hooks } = smoothing(() => true);
    const other = new PerspectiveCamera(70, 1, 0.1, 50);
    temporal.follow(other);
    hooks.setViewOffset(200, 100);
    expect([camera.view?.enabled ?? false, other.view?.enabled]).toEqual([false, true]);
    hooks.clearViewOffset();
    expect(other.view?.enabled).toBe(false);
  });

  it("gives the motion target the camera's projection without the jitter, from the start and after every frame", () => {
    const motion = motionNode as unknown as { projectionMatrix: Matrix4 | null };
    expect(motion.projectionMatrix).toBe(STEADY); // when the module loads, before any material is built
    const { camera, hooks } = smoothing(() => true);
    const unjittered = camera.projectionMatrix.clone();
    hooks.setViewOffset(200, 100);
    expect(camera.projectionMatrix.equals(unjittered)).toBe(false);
    expect([STEADY.equals(unjittered), motion.projectionMatrix === STEADY]).toEqual([true, true]);
    hooks.clearViewOffset(); // r182 takes its own away here
    expect(motion.projectionMatrix).toBe(STEADY);
  });
});
