/**
 * @file The crowd-render page's scene in Node (tests/pages/crowdRenderScene.ts, PLAN.md WP 5.4): drawing it through a
 * crowd (engine/gfx/puppets/crowd.ts) with LOD on, with LOD off, or not at all leaves the sim's hash as it is, step for
 * step; with LOD on every band is used and the animators are posed at their band's level, with LOD off all in full.
 * The GPU half, and Node against Chromium, is tests/e2e/crowd-render.spec.ts.
 * @see tests/pages/crowdRenderScene.ts
 */
import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { FLOATER_BODY } from '../../engine/gfx/puppets/bodies/floater';
import { createCrowd } from '../../engine/gfx/puppets/crowd';
import { createCrowdScene, SLIME_LOOKS, WALKER_LOOKS } from '../pages/crowdRenderScene';

const crowd = createCrowd({ materials: createMaterialLibrary() });
crowd.prepare(...WALKER_LOOKS, ...SLIME_LOOKS, FLOATER_BODY);
const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
camera.position.set(-31, 3, 31);
camera.lookAt(0, 0, 0);

/** The hash after each of 40 steps of 300 wanderers, drawn after each with LOD `on`, `off`, or not at all. */
function run(mode: 'on' | 'off' | 'none') {
  const scene = createCrowdScene({ seed: 7, side: 60 });
  scene.grow(300);
  crowd.lod.enabled = mode === 'on';
  const hashes: string[] = [];
  const bands = [0, 0, 0, 0];
  for (let tick = 0; tick < 40; tick++) {
    scene.world.step();
    if (mode !== 'none') {
      scene.draw(crowd, camera);
      crowd.stats().lod.bands.forEach((count, band) => (bands[band] += count));
    }
    hashes.push(scene.world.hash());
  }
  return { hashes, bands };
}

describe('the crowd-render scene', () => {
  it('hashes the same, step for step, with LOD on, off and nothing drawn', () => {
    const [on, off, none] = [run('on'), run('off'), run('none')];
    expect(off.hashes).toEqual(on.hashes);
    expect(none.hashes).toEqual(on.hashes);
    expect(new Set(on.hashes).size, 'the world moves').toBe(40);
    expect(
      on.bands.every((count) => count > 0),
      `every band used: ${on.bands}`,
    ).toBe(true);
    expect(off.bands.slice(1)).toEqual([0, 0, 0]);
    expect(off.bands[0]).toBe(on.bands.reduce((a, b) => a + b));
  });
});
