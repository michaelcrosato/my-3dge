/**
 * @file Unit tests for screen-space reflections (engine/gfx/enhanced/ssr.ts): two of r182's SSR passes at half
 * resolution, one through a perspective lens and one through an orthographic one; `set` reaches both; `follow` copies
 * the frame's camera into the lens of its kind, leaves the other as it was, and says which kind runs. What they draw
 * is tests/e2e/enhanced.spec.ts's.
 */
import { DepthTexture, OrthographicCamera, PerspectiveCamera, Texture, type Camera } from 'three/webgpu';
import { texture } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import type SSRNode from 'three/addons/tsl/display/SSRNode.js';
import { createReflections, SSR } from './ssr';

/** Reflections over stand-in textures, and their two passes. */
function reflections() {
  const [colour, normal, metalrough] = [texture(new Texture()), texture(new Texture()), texture(new Texture())];
  const made = createReflections({ colour, depth: texture(new DepthTexture(4, 4)), normal, metalrough });
  return { made, passes: made.nodes as unknown as [SSRNode, SSRNode] };
}

/** Whether `lens` has `camera`'s projection, place and planes. */
function copies(lens: Camera | null, camera: PerspectiveCamera | OrthographicCamera): boolean {
  const { near, far } = lens as PerspectiveCamera;
  return (
    !!lens &&
    lens.projectionMatrix.equals(camera.projectionMatrix) &&
    lens.projectionMatrixInverse.equals(camera.projectionMatrixInverse) &&
    lens.matrixWorld.equals(camera.matrixWorld) &&
    lens.matrixWorldInverse.equals(camera.matrixWorldInverse) &&
    near === camera.near &&
    far === camera.far
  );
}

describe('screen-space reflections', () => {
  it("runs two of r182's SSR passes at half resolution, one through each kind of lens; set reaches both", () => {
    const { made, passes } = reflections();
    expect(passes.map((node) => (node.camera as PerspectiveCamera).isPerspectiveCamera === true)).toEqual([
      true,
      false,
    ]);
    expect(passes.map((node) => (node.camera as OrthographicCamera).isOrthographicCamera === true)).toEqual([false, true]); // prettier-ignore
    for (const node of passes)
      expect([node.resolutionScale, node.quality.value]).toEqual([SSR.resolution, SSR.quality]);
    made.set(0.8, 12, 0.3);
    for (const node of passes) expect([node.opacity.value, node.maxDistance.value, node.thickness.value]).toEqual([0.8, 12, 0.3]); // prettier-ignore
    made.dispose();
  });

  it("copies each frame's camera into the lens of its kind, and says which kind runs", () => {
    const { made, passes } = reflections();
    const perspective = new PerspectiveCamera(60, 1.5, 0.2, 80);
    perspective.position.set(1, 2, 3);
    perspective.updateMatrixWorld();
    made.follow(perspective);
    expect(made.kind).toBe('perspective');
    expect(copies(passes[0].camera, perspective)).toBe(true);
    const ortho = new OrthographicCamera(-10, 10, 6, -6, 0.5, 120);
    ortho.position.set(-4, 9, 4);
    ortho.lookAt(0, 0, 0);
    ortho.updateMatrixWorld();
    made.follow(ortho);
    expect(made.kind).toBe('orthographic');
    expect([copies(passes[1].camera, ortho), copies(passes[0].camera, perspective)]).toEqual([true, true]);
    made.dispose();
  });
});
