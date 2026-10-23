/**
 * @file The chain's shading stage (PLAN.md WP 11.5): the look's `ao`, `gi`, `air` and `ssr` sections laid on the
 * scene's light before bloom and the display colours (engine/gfx/post/chain.ts builds `apply` into its output graph
 * once). Each is a technique of engine/gfx/enhanced/, handed out by engine/gfx/features.ts with its feature on:
 * - `ao`: r182's GTAO pass (engine/gfx/enhanced/ao.ts) multiplies the light by its occlusion;
 * - `gi`: the 12-tap spiral (engine/gfx/enhanced/gi.ts) adds bounce light and soft occlusion;
 * - `air`: the haze march and lamp halos (engine/gfx/enhanced/air.ts) dim what lies behind and add their light;
 * - `ssr`: r182's SSR passes (engine/gfx/enhanced/ssr.ts) mix reflections over metal, first of all.
 * The `gi` and `air` WGSL runs inside the display pass, a part of it included only when its feature is on, each
 * behind a uniform; the AO pass runs only in frames that ask for it (and the warm-up's). So a look switching any of
 * them builds no pipeline, and a look without them pays a comparison or two a pixel; the AO and SSR passes likewise.
 *
 * The techniques see each frame's camera through the stage's lens, a stand-in whose matrices copy the frame camera's
 * (`frame`): the chain draws through whichever camera the page shows (five codes, orthographic ones among them),
 * while r182's nodes keep the camera they are made with. The quality tier (engine/gfx/quality.ts) turns bounce light
 * and light shafts off below `high` and halos at `low`; a look that asks for one there gets `GFX_POST_TIER` once.
 *
 * Invariants: presentation only: nothing here reaches the sim or the hash; the uniforms are render-group uniforms,
 * written by `sync` and `frame` alone; a technique whose feature is off is never made.
 *
 * @example
 * // engine/gfx/post/chain.ts: const shading = createShading({ scenePass, features: gfx.features, warming, log });
 * // lit = shading.apply(scenePass.getTextureNode('output')).add(glow); // once, in the output graph
 * // shading.sync(chain, budget, look.id); shading.frame(camera, scene, frames, height); // each frame
 * @see engine/gfx/post/shading.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { Matrix4, PerspectiveCamera, Vector4, type Camera, type Node, type Object3D, type PassNode, type TextureNode } from 'three/webgpu'; // prettier-ignore
import { float, mix, renderGroup, screenUV, select, uniform, vec4 } from 'three/tsl';
import { defineCodes, type Log } from '../../core/log';
import { shadingFor, type FeatureReport } from '../features';
import type { QualityBudget } from '../quality';
import { gateUpdates } from './aa';
import type { FilterChain } from './filters';
import { wgsl } from './shaders/common';

/** The codes this module raises, with their fixes. */
export const SHADING_CODES = defineCodes('gfx', {
  GFX_POST_TIER: {
    template: "{effect} is off at the '{tier}' quality tier, though the look {look} asks for it",
    fix: "nothing to do for play; set the view setting quality to 'high' to draw it",
    doc: 'Advice from the chain\'s shading stage (engine/gfx/post/shading.ts): the quality tier turns bounce light and light shafts off below `high`, and lamp halos at `low` (engine/gfx/quality.ts).', // prettier-ignore
  },
});

/** The chain's shading stage (see the file comment). */
export interface Shading {
  /** The scene's light `colour` with the look's shading laid on: built once into the chain's output graph. */
  apply(colour: TextureNode): Node;
  /** Before each frame: the look's sections and the quality tier set what runs. */
  sync(chain: FilterChain, budget: QualityBudget, look: string): void;
  /** Before each frame: the lens follows `camera`; the air reads `scene`'s lights while it runs. */
  frame(camera: Camera, scene: Object3D, frame: number, height: number): void;
  /** What runs this frame. */
  readonly running: { ao: boolean; gi: boolean; air: boolean; ssr: boolean };
  dispose(): void;
}

/** Makes the stage over `scenePass` (see the file comment). */
export function createShading(options: {
  scenePass: PassNode;
  features?: FeatureReport;
  warming: () => boolean;
  log: Log;
}): Shading {
  const { scenePass, log } = options;
  const techniques = shadingFor(options.features);
  const lens = new PerspectiveCamera();
  const vec = () => uniform(new Vector4()).setGroup(renderGroup);
  const [aoGate, ssrGate] = [uniform(0).setGroup(renderGroup), uniform(0).setGroup(renderGroup)];
  const [gi, lensFlags, air, air2] = [vec(), vec(), vec(), vec()];
  const [invProj, invView] = [uniform(new Matrix4()).setGroup(renderGroup), uniform(new Matrix4()).setGroup(renderGroup)]; // prettier-ignore
  const [depth, normals] = [scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal')];
  const running = { ao: false, gi: false, air: false, ssr: false };
  const occlusion = techniques.occlusion?.({ depth, normal: normals, camera: lens }) ?? null;
  if (occlusion) gateUpdates(occlusion.node, () => options.warming() || running.ao);
  const colourNode = scenePass.getTextureNode('output');
  const metalrough = techniques.reflections ? scenePass.getTextureNode('metalrough') : null;
  const reflections = metalrough && techniques.reflections!({ colour: colourNode, depth, normal: normals, metalrough });
  if (reflections) {
    const kinds = ['perspective', 'orthographic'] as const;
    reflections.nodes.forEach((node, i) => gateUpdates(node, () => options.warming() || (running.ssr && reflections.kind === kinds[i]))); // prettier-ignore
  }
  const lights = techniques.air?.lights() ?? null;

  /** The WGSL that lays bounce light and air on a pixel, with the parts whose features are on. */
  const shade = (() => {
    if (!techniques.gi && !techniques.air) return null;
    const giPart = techniques.gi ? `if (gi.x > 0.0) {\n    let g = shade_gi(colour, depth, normals, px, dims, inv_proj, gi, lens);\n    col = col * (1.0 - min(g.a * gi.x * 1.5, 0.7)) + g.rgb * gi.x * 1.6;\n  }` : ''; // prettier-ignore
    const airPart = techniques.air ? `if (air.x > 0.0 || air2.y > 0.0) {\n    let a = shade_air(depth, px, dims, inv_proj, inv_view, air, air2, sun, sun_color, sky, light_vp, shadow_map, lamps);\n    col = col * a.a + a.rgb;\n  }` : ''; // prettier-ignore
    const includes = [...(techniques.gi ? [techniques.gi.shade] : []), ...(techniques.air ? [techniques.air.shade] : [])]; // prettier-ignore
    return wgsl(
      `
fn shade_scene(base: vec3<f32>, uv_in: vec2<f32>, colour: texture_2d<f32>, depth: texture_depth_2d, normals: texture_2d<f32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>, gi: vec4<f32>, lens: vec4<f32>, air: vec4<f32>, air2: vec4<f32>, sun: vec4<f32>, sun_color: vec4<f32>, sky: vec4<f32>, light_vp: mat4x4<f32>, shadow_map: texture_depth_2d, lamps: texture_2d<f32>) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(depth));
  let px = clamp(vec2<i32>(uv_in * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
  var col = base;
  ${giPart}
  ${airPart}
  return vec4<f32>(col, 1.0);
}`,
      includes,
    );
  })();

  const warn = (effect: string, budget: QualityBudget, look: string) =>
    log.warnOnce('GFX_POST_TIER', { effect, tier: budget.tier, look }, `${effect}:${look}`);

  return {
    running,
    apply(colour) {
      const lit = occlusion ? colour.mul(vec4(mix(float(1), occlusion.texture.r, aoGate).xxx, 1)) : colour;
      // Only metal shows a reflection: r182's blurred levels spread it past a metal surface's edges.
      const shown = reflections && reflections.texture.a.mul(ssrGate).mul(select(metalrough!.r.greaterThan(0), 1, 0));
      const base = reflections ? mix(lit, vec4(reflections.texture.rgb, 1), shown!) : lit;
      if (!shade) return base;
      const sun = lights ?? { sun: vec(), sunColor: vec(), sky: vec(), lightVp: invView, shadow: depth, lamps: colour };
      return shade({
        base: base.rgb,
        uv_in: screenUV,
        colour,
        depth,
        normals,
        inv_proj: invProj,
        inv_view: invView,
        gi,
        lens: lensFlags,
        air,
        air2,
        sun: sun.sun,
        sun_color: sun.sunColor,
        sky: sun.sky,
        light_vp: sun.lightVp,
        shadow_map: sun.shadow,
        lamps: sun.lamps,
      });
    },
    sync(chain, budget, look) {
      running.ssr = !!reflections && chain.ssr.scope === 'all' && chain.ssr.strength > 0;
      ssrGate.value = running.ssr ? 1 : 0;
      reflections?.set(chain.ssr.strength, chain.ssr.distance, chain.ssr.thickness);
      running.ao = !!occlusion && chain.ao.scope === 'all' && chain.ao.strength > 0;
      aoGate.value = running.ao ? 1 : 0;
      occlusion?.set(chain.ao.strength, chain.ao.radius);
      const giAsked = !!techniques.gi && chain.gi.scope === 'all' && chain.gi.strength > 0;
      if (giAsked && !budget.gi) warn('bounce light', budget, look);
      running.gi = giAsked && budget.gi;
      gi.value.x = running.gi ? chain.gi.strength : 0;
      gi.value.y = chain.gi.radius;
      const a = chain.air;
      const airAsked = !!techniques.air && a.scope === 'all';
      if (airAsked && a.shafts > 0 && a.haze > 0 && !budget.godRays) warn('light shafts', budget, look);
      if (airAsked && a.halos > 0 && !budget.halos) warn('lamp halos', budget, look);
      const [haze, shafts, halos] = airAsked ? [a.haze, budget.godRays ? a.shafts : 0, budget.halos ? a.halos : 0] : [0, 0, 0]; // prettier-ignore
      running.air = haze > 0 || halos > 0;
      air.value.set(haze, a.height, 0, shafts);
      air2.value.set(a.forward, halos, 0, 0);
    },
    frame(camera, scene, frame, height) {
      lens.projectionMatrix.copy(camera.projectionMatrix);
      lens.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      lens.matrixWorld.copy(camera.matrixWorld);
      lens.matrixWorldInverse.copy(camera.matrixWorldInverse);
      const { near, far } = camera as Camera & { near?: number; far?: number };
      [lens.near, lens.far] = [near ?? lens.near, far ?? lens.far];
      invProj.value.copy(camera.projectionMatrixInverse);
      invView.value.copy(camera.matrixWorld);
      const ortho = (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
      gi.value.z = techniques.gi?.scale(height, camera.projectionMatrix.elements[5]) ?? 0;
      gi.value.w = frame;
      lensFlags.value.x = ortho ? 1 : 0;
      reflections?.follow(camera);
      if (running.air) lights?.gather(scene);
    },
    dispose() {
      occlusion?.dispose();
      reflections?.dispose();
      lights?.dispose();
    },
  };
}
