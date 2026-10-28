/**
 * @file Skies (PLAN.md WP 7.1, §6.6 kind `sky`): what surrounds and lights a level, as presets of data, and
 * `createSky`, which puts a preset on a scene. A `sky` entry gives the background colour, a sky dome (three.js's
 * `SkyMesh` addon, the Preetham daylight model), a backdrop (silhouette layers round the horizon), a sun (a
 * `DirectionalLight` the dome agrees with), the ambient light and fog (engine/gfx/atmosphere.ts), and how bright the
 * light pool's point lights shine (engine/gfx/lights.ts). The kind, its fields and its presets (`sky:hall`,
 * `sky:daylight`) are engine/gfx/skyKind.ts's.
 *
 * Switching presets, or showing the hour's sky (engine/gfx/daylight.ts), changes uniforms, colours and visibility
 * only: the dome and the backdrop stay in the scene, registered with the warm-up, the sun and the pool's lights are
 * made once, and the fog node stays installed. The one exception is who casts shadows (engine/gfx/shadows.ts): a
 * preset with a sun gives the sun the first caster, which changes the shader key, so the renderer warms up again
 * before the next frame instead of stalling it. Nothing here touches the sim, so no preset changes the hash. A look
 * may draw the dome as a clean gradient instead (`gradient`, WP 13.24: the cel look's), a uniform too.
 *
 * The backdrop is baked on the CPU into one strip (engine/gfx/backdrop.ts `bakeBackdrop`), which wraps three times
 * round an open cylinder that follows the camera, its foot just under eye level, drawn at the far plane like the
 * dome, so the level always stands in front of both. With `feature:cascadedShadows` on, the sun casts through
 * cascades that follow the camera (engine/gfx/enhanced/csm.ts, through engine/gfx/features.ts); with tiled lighting,
 * the light pool holds 64 lights (engine/gfx/lights.ts). Both come from the renderer's feature report (`features`).
 *
 * Measured on r182 (WP 7.1): its lights node sorts its lights by id, in place, whenever it builds a shader, while the
 * render list gives them in scene order; where the two orders differ the light key flips from frame to frame, and
 * every instanced mesh rebuilds its pipelines (each build names its own instance buffer). So `createSky` adds its
 * lights in id order (the pool, the ambient light, then the sun), and a light made later belongs after them in the
 * scene. And a TSL uniform in the object group (the default) refreshes only when its object or material changes, so
 * a still floor keeps its first fog: the dome's knobs and the fog's numbers are render-group uniforms.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3859-3958` (§21b: the `day` preset's colours), as a cylinder round a 3D
 * camera. Invariants: equal presets bake equal strips; the scene's light count never changes after `createSky`.
 *
 * @example
 * bakeBackdrop({ haze: '#c8e4f8', layers: [{ kind: 'hills', color: '#5aa060', height: 0.5, haze: 0, seed: 1 }] }, 64, 16).length; // 4096
 * // const sky = createSky(scene, { level });
 * // sky.register(gfx.warmup);
 * // sky.set('sky:hall');
 * // sky.update({ camera, focus: hero, time: seconds }); // each frame
 * @see engine/gfx/sky.test.ts
 * @see tests/e2e/lights.spec.ts
 */
import {
  BackSide,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Camera,
  type Node,
  type Scene,
} from 'three/webgpu';
import { cameraPosition, Fn, mix, modelViewProjection, positionWorld, renderGroup, smoothstep, uniform, vec4 } from 'three/tsl'; // prettier-ignore
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { CompiledLevel } from '../world/level/types';
import { createAtmosphere, type Atmosphere, type FogReport } from './atmosphere';
import { BACKDROP, bakeBackdrop } from './backdrop';
import { cascadeSunFor, lightPoolOf, type FeatureReport } from './features';
import { createLightPool, lightSources, type LightPool, type PoolLamp, type PoolSlot } from './lights';
import type { QualityBudget } from './quality';
import { shadowCasters, snapShadow, splitCasters, type Casters } from './shadows';
import type { SkyEntry } from './skyKind';
import type { Warmup } from './warmup';

export { BACKDROP, BACKDROP_KINDS, bakeBackdrop } from './backdrop';
export { defineSkies, defineSky, SKY_FIELDS, type BackdropSpec, type SkyEntry, type SkySpec } from './skyKind';

/** A sky on a scene; see the file comment. */
export interface Sky {
  readonly pool: LightPool;
  readonly atmosphere: Atmosphere;
  readonly sun: DirectionalLight;
  readonly dome: SkyMesh;
  readonly backdrop: Mesh;
  /** The preset shown. */
  readonly preset: SkyEntry;
  /** Shows the preset `id` (kind `sky`); returns it. */
  set(id: string): SkyEntry;
  /**
   * Shows `entry`, a sky as the kind's entries hold one (engine/gfx/daylight.ts's blend); returns it. The backdrop's
   * silhouettes are drawn through its `tint` (the night darkens them) and baked again only when they change.
   */
  show(entry: SkyEntry): SkyEntry;
  /** Takes a quality tier's shadow budget (engine/gfx/quality.ts). */
  budget(budget: Pick<QualityBudget, 'shadowCasters'>): void;
  /** Draws `share` (0 to 1) of the dome as a clean gradient, the haze at the horizon to a deeper zenith (WP 13.24). */
  gradient(share: number): void;
  /**
   * Follows the camera and the focus (m), flickering at `time` (s), the frame's `lamps` among the pool's sources
   * (engine/gfx/lights.ts); call it each frame. Returns the pool's slots.
   */
  update(view: { camera: Camera; focus: readonly number[]; time: number; lamps?: readonly PoolLamp[] }): PoolSlot[];
  /** Registers the dome, the backdrop and the fog with the warm-up; `dispose()` takes them out. */
  register(warmup: Warmup): { dispose(): void };
  report(): SkyReport;
  /** Takes everything out of the scene and frees the backdrop's texture and geometries. */
  dispose(): void;
}

/** What a sky shows now. */
export interface SkyReport {
  preset: string;
  /** Lights that cast shadows now: the sun first, then the pool's. */
  casters: Casters;
  slots: PoolSlot[];
  fog: FogReport;
}

/** Draws `mesh` at the far plane, behind everything, as SkyMesh draws its dome. */
function atFarPlane(material: MeshBasicNodeMaterial): void {
  material.vertexNode = Fn(() => {
    const position = modelViewProjection.toVar();
    position.z.assign(position.w);
    return position;
  })();
}

/** How `createSky` makes a sky. */
export interface SkyOptions {
  /** The level whose light spots light the pool and whose bounds the sun's shadow covers. */
  level?: Pick<CompiledLevel, 'lights' | 'bounds'>;
  /** Without a level, the ground the sun's shadow covers (a terrain's or a site's), as a level's bounds. */
  bounds?: CompiledLevel['bounds'];
  /** The pool's size (engine/gfx/lights.ts); by default what the renderer's `features` afford. */
  poolSize?: number;
  /** The visual stream the flicker phases are drawn from. */
  rng?: Rng;
  registry?: Registry;
  /** The renderer's feature report (engine/gfx/features.ts): tiled lighting's bigger pool, the sun's cascades. */
  features?: FeatureReport;
}

/**
 * Puts a sky on `scene`: the light pool lit from `level`'s light spots (phases from `rng`, a visual stream), the sun,
 * the dome, the backdrop and the atmosphere; shows `sky:daylight` until `set` names another preset.
 */
export function createSky(scene: Scene, options: SkyOptions = {}): Sky {
  const registry = options.registry ?? sharedRegistry;
  const pool = createLightPool({ ...lightPoolOf(options.features), ...(options.poolSize ? { size: options.poolSize } : {}), registry }); // prettier-ignore
  if (options.level) pool.setSources(lightSources(options.level), options.rng);
  const atmosphere = createAtmosphere();
  const sun = new DirectionalLight('#ffffff', 0);
  sun.name = 'sky/sun';
  sun.target.name = 'sky/sun/target';
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  snapShadow(sun.shadow);
  const { min, max } = options.level?.bounds ?? options.bounds ?? { min: [-8, 0, -8], max: [8, 4, 8] };
  const centre = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2] as const;
  const half = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2 + 2;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 3 * half + 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.set(...centre);
  const cascades = cascadeSunFor(sun, options.features);

  const dome = new SkyMesh();
  dome.name = 'sky/dome';
  dome.scale.setScalar(BACKDROP.radius);
  dome.material.fog = false;
  // The render group, so a new preset reaches the dome however still the camera stands (see atmosphere.ts).
  for (const knob of [dome.turbidity, dome.rayleigh, dome.mieCoefficient, dome.mieDirectionalG, dome.sunPosition])
    knob.setGroup(renderGroup);
  const exposure = uniform(1).setGroup(renderGroup);
  // A look's gradient (WP 13.24): from the fog's haze at the horizon to the background deepened at the zenith.
  const [gradient, zenith, horizon] = [uniform(0), uniform(new Color()), uniform(new Color())];
  for (const knob of [gradient, zenith, horizon]) knob.setGroup(renderGroup);
  const ramp = mix(horizon, zenith, smoothstep(0, 0.45, positionWorld.sub(cameraPosition).normalize().y));
  dome.material.colorNode = vec4(mix((dome.material.colorNode as Node).rgb.mul(exposure), ramp, gradient), 1);
  Object.assign(dome, { frustumCulled: false, renderOrder: -2 });
  dome.userData.background = true; // drawn at the far plane, behind everything: the ID pass's empty space (idpass.ts)
  const strip = new DataTexture(bakeBackdrop({ haze: '#000000', layers: [] }), BACKDROP.width, BACKDROP.height);
  Object.assign(strip, { format: RGBAFormat, type: UnsignedByteType, colorSpace: SRGBColorSpace });
  Object.assign(strip, { wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping, magFilter: LinearFilter });
  Object.assign(strip, { minFilter: LinearFilter, generateMipmaps: false, name: 'sky/backdrop' });
  const geometry = new CylinderGeometry(1, 1, 1, 96, 1, true);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * BACKDROP.repeat);
  const material = new MeshBasicNodeMaterial({ map: strip, alphaTest: 0.5, side: BackSide, fog: false });
  material.depthWrite = false;
  atFarPlane(material);
  const backdrop = new Mesh(geometry, material);
  backdrop.name = 'sky/backdrop';
  backdrop.scale.set(BACKDROP.radius, BACKDROP.band, BACKDROP.radius);
  Object.assign(backdrop, { frustumCulled: false, renderOrder: -1 });
  backdrop.userData.background = true;
  // In id order (the pool's lights, the ambient light, the sun): see the file comment.
  scene.add(pool.group);
  atmosphere.install(scene);
  scene.add(sun, sun.target, dome, backdrop);

  let preset = registry.get('sky', 'sky:daylight') as SkyEntry;
  let baked = ''; // the backdrop baked into the strip, as its spec's text
  const hsl = { h: 0, s: 0, l: 0 };
  let casters = shadowCasters({ shadowCasters: null });
  let split: Casters = { sun: false, points: 0 };
  const applyCasters = () => {
    split = splitCasters(casters, { sun: preset.sun.intensity > 0, points: preset.pointLights > 0 });
    sun.castShadow = split.sun;
    pool.casters = split.points;
  };

  const sky: Sky = {
    pool,
    atmosphere,
    sun,
    dome,
    backdrop,
    get preset() {
      return preset;
    },
    set: (id) => sky.show(registry.get('sky', id) as SkyEntry),
    show(entry) {
      preset = entry;
      if (scene.background instanceof Color) scene.background.set(preset.background);
      else scene.background = new Color(preset.background);
      pool.scale = preset.pointLights;
      atmosphere.set({ fog: preset.fog, ambient: preset.ambient });
      const { azimuth, elevation } = preset.sun;
      const flat = Math.cos(elevation);
      const direction = [Math.sin(azimuth) * flat, Math.sin(elevation), Math.cos(azimuth) * flat];
      sun.color.set(preset.sun.color);
      sun.intensity = preset.sun.intensity;
      sun.position.set(centre[0] + direction[0] * 60, centre[1] + direction[1] * 60, centre[2] + direction[2] * 60);
      dome.visible = preset.dome.show;
      dome.sunPosition.value.set(direction[0], direction[1], direction[2]);
      dome.turbidity.value = preset.dome.turbidity;
      dome.rayleigh.value = preset.dome.rayleigh;
      dome.mieCoefficient.value = preset.dome.mieCoefficient;
      dome.mieDirectionalG.value = preset.dome.mieDirectionalG;
      exposure.value = preset.dome.exposure;
      horizon.value.set(preset.fog.color);
      zenith.value.set(preset.background).getHSL(hsl);
      zenith.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.3), hsl.l * 0.78);
      backdrop.visible = preset.backdrop.layers.length > 0;
      material.color.set(preset.backdrop.tint);
      const strips = JSON.stringify([preset.backdrop.haze, preset.backdrop.layers]);
      if (backdrop.visible && strips !== baked) {
        strip.image.data = bakeBackdrop(preset.backdrop);
        strip.needsUpdate = true;
        baked = strips;
      }
      applyCasters();
      return preset;
    },
    budget(budget) {
      casters = shadowCasters(budget);
      applyCasters();
    },
    gradient: (share) => void (gradient.value = Math.min(1, Math.max(0, share))),
    update({ camera, focus, time, lamps }) {
      const eye = camera.position;
      dome.position.copy(eye);
      backdrop.position.set(eye.x, eye.y - BACKDROP.foot + BACKDROP.band / 2, eye.z);
      atmosphere.follow(eye.toArray(), focus);
      cascades?.follow(camera);
      return pool.update(focus, time, lamps);
    },
    register(warmup) {
      const parts = [warmup.register('sky', { objects: () => [dome, backdrop] }), atmosphere.register(warmup)];
      return { dispose: () => parts.forEach((part) => part.dispose()) };
    },
    report: () => ({ preset: preset.id, casters: { ...split }, slots: pool.slots(), fog: atmosphere.report() }),
    dispose() {
      for (const object of [pool.group, sun, sun.target, dome, backdrop]) object.removeFromParent();
      atmosphere.dispose();
      cascades?.dispose();
      strip.dispose();
      geometry.dispose();
      material.dispose();
      dome.geometry.dispose();
      dome.material.dispose();
    },
  };
  sky.set(preset.id);
  return sky;
}
