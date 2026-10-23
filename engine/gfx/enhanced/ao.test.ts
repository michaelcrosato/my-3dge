/**
 * @file Unit tests for ambient occlusion (engine/gfx/enhanced/ao.ts): the pass is r182's GTAO at half the picture's
 * resolution and 16 samples, reading its camera's matrices by reference (so the chain's lens, copied each frame, is
 * what it sees); `set` writes how dark it gets and how far round a point it looks; its texture is the pass's. What it
 * draws is tests/e2e/enhanced.spec.ts's.
 */
import { DepthTexture, PerspectiveCamera, Texture } from 'three/webgpu';
import { texture } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import type GTAONode from 'three/addons/tsl/display/GTAONode.js';
import { AO, createOcclusion } from './ao';

/** The pass's camera uniforms, as r182 makes them (`GTAONode.js:184-192`). */
type Lensed = GTAONode & { _cameraProjectionMatrix: { value: unknown } };

describe('ambient occlusion', () => {
  it("runs r182's GTAO at half resolution and 16 samples, through the matrices of the camera it is given", () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
    const occlusion = createOcclusion({ depth: texture(new DepthTexture(4, 4)), normal: texture(new Texture()), camera }); // prettier-ignore
    const node = occlusion.node as Lensed;
    expect([node.resolutionScale, node.samples.value]).toEqual([AO.resolution, AO.samples]);
    expect(node._cameraProjectionMatrix.value).toBe(camera.projectionMatrix);
    expect(occlusion.texture).toBe(node.getTextureNode());
    occlusion.set(2, 1.5);
    expect([node.scale.value, node.radius.value]).toEqual([2, 1.5]);
    occlusion.dispose();
  });
});
