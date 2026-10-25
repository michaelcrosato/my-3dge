/**
 * @file Unit tests for cascaded shadows (engine/gfx/enhanced/csm.ts): the sun casts through r182's `CSMShadowNode`,
 * three cascades over the view's first 90 m at 1,024² each, and the scene dump counts the cascades made; `follow`
 * leaves the node without a camera until its first build (r182 makes the cascades only then), then hands it the
 * frame's camera, splitting the cascades again only when that camera or its projection changed; each cascade's
 * shadow, a clone of the sun's, takes the engine's filter again; `dispose` gives the sun its own shadow back. The
 * shadows drawn are tests/e2e/enhanced.spec.ts's.
 */
import { DirectionalLight, OrthographicCamera, PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { dumpScene } from '../sceneDump';
import { SNAPPED_PCF } from '../shadows';
import { cascadeSun, CASCADES } from './csm';

/** The sun's line in the scene's dump. */
const sunLine = (scene: Scene) =>
  dumpScene(scene)
    .split('\n')
    .find((line) => line.includes('sky/sun'))!;

/** A sun in a scene, casting. */
function sunlit() {
  const scene = new Scene();
  const sun = new DirectionalLight('#ffffff', 2);
  sun.name = 'sky/sun';
  sun.castShadow = true;
  scene.add(sun);
  return { scene, sun };
}

describe('cascaded shadows', () => {
  it('casts the sun through three cascades, each a 1,024² map, and the scene dump says so', () => {
    const { scene, sun } = sunlit();
    expect(sunLine(scene)).toMatch(/ shadow$/);
    const cascades = cascadeSun(sun);
    expect(sun.shadow.shadowNode).toBe(cascades.node);
    expect([cascades.node.cascades, cascades.node.maxFar, cascades.node.mode]).toEqual([CASCADES.count, CASCADES.far, 'practical']); // prettier-ignore
    expect(sun.shadow.mapSize.toArray()).toEqual([CASCADES.map, CASCADES.map]);
    expect(sunLine(scene)).toMatch(/ shadow ×0 cascades$/); // none made before the node's first build
    const made = [new DirectionalLight(), new DirectionalLight(), new DirectionalLight()];
    scene.add(...made); // as r182's first build makes them, and its first frame adds them beside the sun
    cascades.node.lights.push(...made);
    expect(sunLine(scene)).toMatch(/ shadow ×3 cascades$/);
    cascades.dispose();
    expect(sun.shadow.shadowNode).toBeUndefined();
  });

  it("follows the frame's camera, splitting again only when the camera or its projection changes", () => {
    const { sun } = sunlit();
    const cascades = cascadeSun(sun);
    const perspective = new PerspectiveCamera(50, 16 / 9, 0.1, 200);
    cascades.follow(perspective);
    expect(cascades.node.camera).toBeNull(); // before its first build: r182 takes that build's camera, and only then splits
    let splits = 0;
    Object.assign(cascades.node, { mainFrustum: {}, updateFrustums: () => void splits++ }); // as after its first build
    cascades.follow(perspective);
    cascades.follow(perspective);
    expect(splits).toBe(1);
    const ortho = new OrthographicCamera(-20, 20, 12, -12, 0.1, 200);
    cascades.follow(ortho);
    expect([cascades.node.camera, splits]).toEqual([ortho, 2]);
    ortho.top = 14;
    ortho.updateProjectionMatrix();
    cascades.follow(ortho);
    expect(splits).toBe(3);
  });

  it("gives each cascade's shadow, cloned from the sun's, the engine's filter, which a clone leaves behind", () => {
    const { sun } = sunlit();
    const filterOf = (light: DirectionalLight) => (light.shadow as { filterNode?: unknown }).filterNode;
    const cascades = cascadeSun(sun);
    const made = new DirectionalLight();
    made.shadow = sun.shadow.clone(); // as r182's first build makes each cascade (CSMShadowNode.js:172)
    expect(filterOf(made)).toBe(SNAPPED_PCF);
    cascades.dispose();
    made.shadow = sun.shadow.clone();
    expect(filterOf(made)).toBeUndefined();
  });
});
