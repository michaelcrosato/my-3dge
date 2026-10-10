/**
 * @file Unit tests for the height boost (`engine/gfx/cameras/boost.ts`), in Node with three.js's real cameras: every
 * classic view draws a 1 m cube where the 2D engine's `View.p()` drew it (orthographic, within 1% of the cube's
 * height on screen), the cube's projected height is the view's boost times its unboosted height within 1% in both
 * projections, a perspective view frames the cube as its orthographic twin does, and the boosted cameras keep their
 * boost through a refit of the lens (the renderer's `frame()` sets a perspective camera's aspect).
 */
import { OrthographicCamera, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyBoost, boost, BoostedOrthographicCamera, BoostedPerspectiveCamera, isBoosted } from './boost';
import type { ViewName } from './codes';
import { createCameraPair } from './place';
import { createViewCamera, VIEW_PRESETS } from './presets';
import { PIXEL_LINES } from '../resolution';

const DEG = Math.PI / 180;
const CLASSIC: ViewName[] = ['iso', 'threequarter', 'topdown', 'brawler', 'side'];
const ASPECT = 16 / 9;

/** The 2D engine's view projection, `my-3d2dge:engine/my-3d2dge.js:348-363`: world units to pixels, y down. */
function engineView(yawDeg: number, pitchDeg: number, scale: number, zBoost: number) {
  const w = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const [cw, sw, cp, sp] = [Math.cos(w), Math.sin(w), Math.cos(p), Math.sin(p)];
  const [ax, ay] = [scale * cw, -scale * sw];
  const [bx, by, bz] = [scale * sp * sw, scale * sp * cw, -scale * cp * zBoost];
  return (x: number, y: number, z: number): [number, number] => [ax * x + ay * y, bx * x + by * y + bz * z];
}

/** my-3dge's point in the 2D engine's frame (x east, y south, z up, 16 units per metre; PLAN.md Appendix C). */
const toEngine = ([x, y, z]: number[]): [number, number, number] => [16 * x, 16 * z, 16 * y];

/** A 1 m cube centred on the origin (the view's fixed target): its 8 corners. */
const CUBE = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z])));

/** Where three.js draws `p` through `camera`, in the frame's pixels (PIXEL_LINES tall), y up from the centre. */
function screen(camera: PerspectiveCamera | OrthographicCamera, p: number[]): [number, number] {
  const ndc = new Vector3(p[0], p[1], p[2]).project(camera);
  return [(ndc.x * ASPECT * PIXEL_LINES) / 2, (ndc.y * PIXEL_LINES) / 2];
}

/** The height on screen of the cube's vertical edge through the target, in the frame's pixels. */
function edge(camera: PerspectiveCamera | OrthographicCamera): number {
  return screen(camera, [0, 0.5, 0])[1] - screen(camera, [0, -0.5, 0])[1];
}

/** A view fixed on the origin, placed on a three.js camera; `boost: false` places it without the view's boost. */
function placed(view: ViewName, projection: 'orthographic' | 'perspective', withBoost = true) {
  const pose = createViewCamera({ view, projection, target: [0, 0, 0] }).pose();
  return createCameraPair().place(withBoost ? pose : { ...pose, boost: 1 }, ASPECT);
}

describe('the classic views reproduce the 2D engine', () => {
  it.each(CLASSIC)('%s draws a 1 m cube where the 2D engine drew it (orthographic, within 1%)', (view) => {
    const preset = VIEW_PRESETS[view];
    const engine = engineView(preset.azimuth / DEG, preset.elevation / DEG, preset.pixelsPerMetre / 16, preset.boost);
    const camera = placed(view, 'orthographic');
    const drawn = CUBE.map((corner) => screen(camera, corner));
    const expected = CUBE.map((corner) => engine(...toEngine(corner)));
    const tall = Math.max(...expected.map((p) => p[1])) - Math.min(...expected.map((p) => p[1]));
    for (let i = 0; i < CUBE.length; i++) {
      expect(Math.abs(drawn[i][0] - expected[i][0])).toBeLessThan(0.01 * tall);
      expect(Math.abs(drawn[i][1] + expected[i][1])).toBeLessThan(0.01 * tall); // the engine's y points down
    }
    const height = Math.max(...drawn.map((p) => p[1])) - Math.min(...drawn.map((p) => p[1]));
    expect(height / tall).toBeCloseTo(1, 2);
  });

  it.each(CLASSIC.flatMap((view) => [[view, 'orthographic'] as const, [view, 'perspective'] as const]))(
    "%s (%s): the cube's height on screen is the view's boost times its true height, within 1%",
    (view, projection) => {
      const k = VIEW_PRESETS[view].boost;
      const boosted = edge(placed(view, projection));
      const plain = edge(placed(view, projection, false));
      expect(Math.abs(boosted / plain / k - 1)).toBeLessThan(0.01);
      const engine = (VIEW_PRESETS[view].pixelsPerMetre * Math.cos(VIEW_PRESETS[view].elevation) * k) / 1;
      expect(Math.abs(boosted / engine - 1)).toBeLessThan(0.01); // and as tall as the 2D engine drew it
    },
  );

  it('a perspective view frames its target as its orthographic twin does', () => {
    for (const view of ['iso', 'threequarter', 'brawler'] as const) {
      const ortho = edge(placed(view, 'orthographic'));
      expect(Math.abs(edge(placed(view, 'perspective')) / ortho - 1)).toBeLessThan(0.01);
    }
  });
});

describe('boost()', () => {
  it("is the prototype's: k = 1 leaves three.js's projection, k scales heights in the projection only", () => {
    const camera = new PerspectiveCamera(40, ASPECT, 0.1, 100);
    camera.coordinateSystem = WebGPUCoordinateSystem;
    camera.position.set(3, 8, 9);
    camera.lookAt(0, 0, 0);
    boost(camera, 1);
    const plain = camera.projectionMatrix.clone();
    camera.updateProjectionMatrix();
    expect(camera.projectionMatrix.equals(plain)).toBe(true);
    boost(camera, 2);
    const twin = new PerspectiveCamera(40, ASPECT, 0.1, 100);
    twin.coordinateSystem = WebGPUCoordinateSystem;
    twin.position.copy(camera.position);
    twin.quaternion.copy(camera.quaternion);
    twin.updateMatrixWorld();
    twin.updateProjectionMatrix();
    const top = new Vector3(1, 1.5, -2);
    // drawn through the boost = drawn without it at twice the height; the view matrix keeps true heights
    expect(
      top
        .clone()
        .project(camera)
        .distanceTo(new Vector3(1, 3, -2).project(twin)),
    ).toBeLessThan(1e-12);
    expect(camera.matrixWorldInverse.equals(twin.matrixWorldInverse)).toBe(true);
    expect(camera.projectionMatrixInverse.clone().multiply(camera.projectionMatrix).determinant()).toBeCloseTo(1, 9);
  });

  it('boosted cameras keep their boost through updateProjectionMatrix, as a refit of the aspect does', () => {
    const pair = createCameraPair();
    const pose = createViewCamera({ view: 'threequarter', projection: 'perspective', target: [0, 0, 0] }).pose();
    const camera = pair.place(pose, ASPECT) as BoostedPerspectiveCamera;
    expect(isBoosted(camera)).toBe(true);
    const before = edge(camera);
    camera.aspect = 4 / 3; // what gfx.frame() does when the canvas's aspect differs
    camera.updateProjectionMatrix();
    camera.aspect = ASPECT;
    camera.updateProjectionMatrix();
    expect(edge(camera)).toBeCloseTo(before, 9);
    const plain = new PerspectiveCamera();
    expect(isBoosted(plain)).toBe(false);
  });

  it('a boosted camera starts at 1, copies and clones its boost, and applyBoost composes', () => {
    const ortho = new BoostedOrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    expect(ortho.boost).toBe(1);
    ortho.boost = 1.3;
    expect(ortho.clone().boost).toBe(1.3);
    expect(new BoostedPerspectiveCamera().copy(new PerspectiveCamera()).boost).toBe(1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 5, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    applyBoost(camera, 2);
    applyBoost(camera, 0.5);
    const fresh = camera.clone();
    fresh.updateProjectionMatrix();
    for (let i = 0; i < 16; i++)
      expect(camera.projectionMatrix.elements[i]).toBeCloseTo(fresh.projectionMatrix.elements[i], 12);
  });
});
