/**
 * @file Unit tests for cascaded shadows (engine/gfx/enhanced/csm.ts): the sun casts through r182's `CSMShadowNode`,
 * three cascades over the view's first 90 m at 1,024² each, and the scene dump says so; `follow` hands the node the
 * frame's camera, and splits the cascades again only when that camera or its projection changed; `dispose` gives the
 * sun its own shadow back. The shadows drawn are tests/e2e/enhanced.spec.ts's.
 */
import { DirectionalLight, OrthographicCamera, PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { dumpScene } from '../sceneDump';
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
    expect(sunLine(scene)).toMatch(/ shadow ×3 cascades$/);
    cascades.dispose();
    expect(sun.shadow.shadowNode).toBeUndefined();
  });

  it("follows the frame's camera, splitting again only when the camera or its projection changes", () => {
    const { sun } = sunlit();
    const cascades = cascadeSun(sun);
    const perspective = new PerspectiveCamera(50, 16 / 9, 0.1, 200);
    cascades.follow(perspective);
    expect(cascades.node.camera).toBe(perspective); // before its first build: kept for it, nothing split
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
});
