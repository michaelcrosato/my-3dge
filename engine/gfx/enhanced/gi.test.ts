/**
 * @file Unit tests for bounce light (engine/gfx/enhanced/gi.ts): its screen scale is the pixels a metre-tall thing one
 * metre ahead spans, through perspective and orthographic cameras alike; the WGSL is shardfall's spiral with the taps
 * and pixel bounds `GI` names, reading view positions through its include. What it draws is
 * tests/e2e/enhanced.spec.ts's.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { GI, giScale, shadeGi, shadeViewPos } from './gi';

/** The pixels of a `height` px picture a metre-tall thing `ahead` metres in front of `camera` spans. */
function span(camera: Camera, height: number, ahead: number): number {
  const [top, bottom] = [0.5, -0.5].map((y) => new Vector3(0, y, -ahead).applyMatrix4(camera.projectionMatrix).y);
  return ((top - bottom) / 2) * height;
}

/** A WGSL function's code and includes (r182's `wgslFn`, `FunctionNode.js:158-168`). */
const fn = (f: unknown) => (f as { functionNode: { code: string; includes: unknown[] } }).functionNode;

describe('bounce light', () => {
  it('scales its spiral to the pixels a metre spans one metre ahead, through either kind of camera', () => {
    const perspective = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
    expect(giScale(720, perspective.projectionMatrix.elements[5])).toBeCloseTo(span(perspective, 720, 1), 6);
    expect(span(perspective, 720, 4)).toBeCloseTo(span(perspective, 720, 1) / 4, 6); // the WGSL divides by the depth
    const ortho = new OrthographicCamera(-20, 20, 12, -12, 0.1, 100);
    expect(giScale(720, ortho.projectionMatrix.elements[5])).toBeCloseTo(30, 9); // 720 px over 24 m, at any depth
    expect(span(ortho, 720, 37)).toBeCloseTo(30, 9);
  });

  it("is shardfall's spiral: the taps and pixel bounds GI names, view positions through its include", () => {
    const { code, includes } = fn(shadeGi);
    expect(code).toContain(`for (var i = 0; i < ${GI.taps}; i++)`);
    expect(code).toContain(`clamp(rad * gi.z / reach, ${GI.minPx}.0, ${GI.maxPx}.0)`);
    expect(includes).toEqual([fn(shadeViewPos)]);
  });
});
