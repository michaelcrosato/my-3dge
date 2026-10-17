/**
 * @file Skies (PLAN.md WP 7.1, §6.6 kind `sky`): what surrounds and lights a level, as presets of data, and
 * `createSky`, which puts a preset on a scene. A `sky` entry gives the background colour, a sky dome (three.js's
 * `SkyMesh` addon, the Preetham daylight model), a backdrop (silhouette layers round the horizon), a sun (a
 * `DirectionalLight` the dome agrees with), the ambient light and fog (engine/gfx/atmosphere.ts), and how bright the
 * light pool's point lights shine (engine/gfx/lights.ts). The presets: `sky:hall`, the torch-lit hall (dark, torches,
 * fog past the focus), and `sky:daylight`, a plain day for fixtures. Others arrive when a scene needs one.
 *
 * Switching presets changes uniforms, colours and visibility only: the dome and the backdrop are always in the scene
 * and registered with the warm-up, the sun and the pool's lights are made once, and the fog node stays installed. The
 * one exception is who casts shadows (engine/gfx/shadows.ts): a preset with a sun gives the sun the first caster,
 * which changes the shader key, so the renderer warms up again before the next frame instead of stalling it. Nothing
 * here touches the sim, so no preset changes the hash.
 *
 * The backdrop is baked on the CPU into one strip (`bakeBackdrop`, RGBA bytes, row 0 at the bottom), its layers drawn
 * far to near: ridged `mountains`, smooth `hills` and a `forest` tree line, each a sum of sines with whole cycles
 * across the strip, so it tiles, shaded darker toward its foot and hazed toward the preset's haze colour. The strip
 * wraps three times round an open cylinder that follows the camera, its foot just under eye level, drawn at the far
 * plane like the dome, so the level always stands in front of both.
 *
 * Measured on r182 (WP 7.1): its lights node sorts its lights by id, in place, whenever it builds a shader, while the
 * render list gives them in scene order; where the two orders differ the light key flips from frame to frame, and
 * every instanced mesh rebuilds its pipelines (each build names its own instance buffer). So `createSky` adds its
 * lights in id order (the pool, the ambient light, then the sun), and a light made later belongs after them in the
 * scene. And a TSL uniform in the object group (the default) refreshes only when its object or material changes, so
 * a still floor keeps its first fog: the dome's knobs and the fog's numbers are render-group uniforms.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3859-3958` (§21b, the backdrop generators: the `day` preset's colours,
 * `ridge`, `smooth`, `range` and the tones), rebuilt as a cylinder round a 3D camera instead of screen layers.
 * Invariants: equal presets bake equal strips; the scene's light count never changes after `createSky`.
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
import { Fn, modelViewProjection, renderGroup, uniform, vec4 } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { hex, mix, tones } from '../core/color';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { derive, Rng } from '../core/rng';
import type { Schema } from '../core/schema';
import type { CompiledLevel } from '../world/level/types';
import { AMBIENT_FIELDS, createAtmosphere, FOG_FIELDS, type Atmosphere, type FogReport } from './atmosphere';
import { createLightPool, lightSources, type LightPool, type PoolSlot } from './lights';
import type { QualityBudget } from './quality';
import { shadowCasters, splitCasters, type Casters } from './shadows';
import type { Warmup } from './warmup';

const text = (description: string, value: string) => ({ type: 'string', default: value, description }) as const;
const num = (description: string, value: number, minimum = 0, maximum?: number, unit?: string) =>
  ({ type: 'number', default: value, minimum, ...(maximum === undefined ? {} : { maximum }), ...(unit ? { unit } : {}), description }) as const; // prettier-ignore
/** An object field whose default holds every property's default, so a preset may leave the whole object out. */
const group = <const P extends Schema>(description: string, properties: P) => {
  const defaults = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));
  return { type: 'object', default: defaults, description, properties } as const;
};

/** The kinds of backdrop layer. */
export const BACKDROP_KINDS = ['mountains', 'hills', 'forest'] as const;

/** The fields of a `sky` entry; see the file comment. Angles in radians, lengths in metres. */
export const SKY_FIELDS = {
  description: text('What it looks like, in plain sentences.', ''),
  background: text('The colour behind everything, hex, where neither dome nor backdrop is drawn.', '#06050b'),
  pointLights: num("A multiplier on the light pool's intensities: 1 as the light kinds say, 0 puts them out.", 1),
  dome: group("The sky dome: three.js's SkyMesh (the Preetham daylight model), lit by the sun's direction.", {
    show: { type: 'boolean', default: false, description: 'Whether the dome is drawn.' },
    turbidity: num('Haze in the air (SkyMesh turbidity): 2 is clear, 10 is hazy.', 2),
    rayleigh: num('Rayleigh scattering (SkyMesh rayleigh): more is bluer, then redder.', 1),
    mieCoefficient: num('Mie scattering (SkyMesh mieCoefficient): the glow round the sun.', 0.005),
    mieDirectionalG: num('How tight the glow round the sun is (SkyMesh mieDirectionalG), 0 to 1.', 0.8, 0, 1),
    exposure: num('A multiplier on its colour: the frame has no tone mapping, so a clear day wants about 0.5.', 1),
  }),
  sun: group("The sun: three.js's DirectionalLight, shining from its azimuth and elevation; intensity 0 for none.", {
    color: text('Its colour, hex.', '#fff0d8'),
    intensity: num('How bright it is (DirectionalLight intensity); 0 for no sun.', 0),
    azimuth: num('Where it stands round the level, from +Z toward +X.', 0, -7, 7, 'rad'),
    elevation: num('How high it stands above the horizon.', 0.9, 0, 1.5708, 'rad'),
  }),
  ambient: group(
    "The ambient light: three.js's HemisphereLight, one colour from above and one from below.",
    AMBIENT_FIELDS,
  ),
  fog: group(
    'Range fog past the focus plus height fog on the floor (engine/gfx/atmosphere.ts); amount 0 for none.',
    FOG_FIELDS,
  ),
  backdrop: group('Silhouettes round the horizon, far layers first; no layers draws no backdrop.', {
    haze: text('The colour hazed layers fade toward, hex.', '#c8e4f8'),
    layers: {
      type: 'array',
      default: [],
      description: 'The layers, far to near.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: BACKDROP_KINDS, required: true, description: 'Its silhouette.' },
          color: text('Its colour, hex.', '#5aa060'),
          height: num('Its tallest point, as a share of the backdrop band.', 0.5, 0, 1),
          haze: num('How far it fades toward the haze colour, 0 to 1.', 0, 0, 1),
          seed: { type: 'integer', default: 1, description: 'Its seed: another seed, another skyline.' },
        },
      },
    },
  }),
} as const satisfies Schema;

/** A `sky` entry. */
export type SkyEntry = Entry<typeof SKY_FIELDS>;

/** What `defineSky` takes: any of the fields, and any of a nested object's (a backdrop's layers whole). */
export type SkySpec = {
  [K in Exclude<keyof SkyEntry, 'id' | 'kind'>]?: SkyEntry[K] extends string | number
    ? SkyEntry[K]
    : Partial<SkyEntry[K]>;
};

/** A backdrop as a `sky` entry gives it. */
export type BackdropSpec = SkyEntry['backdrop'];

/** Declares the kind `sky` and the built-in presets on `registry`, unless it has them. */
export function defineSkies(registry: Registry = sharedRegistry): void {
  if (!registry.kinds().includes('sky')) {
    registry.defineKind('sky', {
      description:
        'Sky presets: what surrounds and lights a level (background, dome, backdrop, sun, ambient light, fog, how bright the point lights shine).',
      fields: SKY_FIELDS,
      fallback: 'sky:daylight',
      defineWith: "defineSky('sky:<name>', { background, dome, sun, ambient, fog, backdrop, pointLights })",
    });
  }
  const sky = (id: string, spec: Record<string, unknown>) => registry.has('sky', id) || registry.def('sky', id, spec);
  sky('sky:hall', {
    description: 'The torch-lit hall: a dark vault, torchlight from the light pool, fog from 12 m past the focus.',
    background: '#06050b',
    pointLights: 1,
    ambient: { sky: '#5a5480', ground: '#241f30', intensity: 4 },
    fog: { color: '#06050b', start: 12, end: 70, amount: 1, floor: 0, ceiling: 1.2, height: 0.3 },
  });
  sky('sky:daylight', {
    description: 'A plain day for fixtures: a clear sky dome, a sun from the south-west, hills and mountains far off.',
    background: '#9cc4ec',
    pointLights: 0,
    dome: { show: true, exposure: 0.5 },
    sun: { color: '#fff0d8', intensity: 2.6, azimuth: 3.7, elevation: 0.9 },
    ambient: { sky: '#c8d4ff', ground: '#4a3f30', intensity: 1.6 },
    fog: { color: '#c8daf0', start: 40, end: 220, amount: 0.5 },
    backdrop: {
      haze: '#c8e4f8',
      layers: [
        { kind: 'mountains', color: '#7a98c8', height: 0.95, haze: 0.45, seed: 3 },
        { kind: 'hills', color: '#5aa060', height: 0.5, haze: 0.25, seed: 7 },
        { kind: 'forest', color: '#2f7040', height: 0.32, haze: 0.1, seed: 11 },
      ],
    },
  });
}
defineSkies();

/** Declares a sky preset (`sky:<name>`); see `SKY_FIELDS`. */
export function defineSky(id: string, spec: SkySpec, registry: Registry = sharedRegistry): SkyEntry {
  return registry.def('sky', id, spec) as SkyEntry;
}

/** The backdrop strip's size in texels, and its band round the camera (m): radius, height, foot below the eye. */
export const BACKDROP = { width: 1024, height: 128, repeat: 3, radius: 100, band: 30, foot: 4 } as const;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));
const ridge = (u: number, p: number[]) =>
  0.52 * (1 - Math.abs(Math.sin(u * 1.5 + p[0]))) +
  0.3 * (1 - Math.abs(Math.sin(u * 3.5 + p[1]))) +
  0.18 * (1 - Math.abs(Math.sin(u * 8.5 + p[2])));
const smooth = (u: number, p: number[]) =>
  0.55 + 0.25 * Math.sin(u * 2 + p[3]) + 0.14 * Math.sin(u * 5 + p[4]) + 0.06 * Math.sin(u * 11 + p[5]);

/** Each layer kind's skyline, 0 to 1, at `u` (rad round the strip), with phases `p`. */
const PROFILES: Record<(typeof BACKDROP_KINDS)[number], (u: number, p: number[]) => number> = {
  mountains: (u, p) => range(ridge(u, p), 0.12, 0.95),
  hills: (u, p) => range(smooth(u, p), 0.15, 1),
  forest: (u, p) => 0.6 * range(smooth(u, p), 0.2, 1) + 0.4 * (1 - Math.abs(Math.sin(u * 61 + p[0]))) ** 3,
};

/** Bakes a backdrop into RGBA bytes, `width` × `height`, row 0 at the bottom; above the skylines is clear. */
export function bakeBackdrop(spec: BackdropSpec, width: number = BACKDROP.width, height: number = BACKDROP.height) {
  const data = new Uint8Array(width * height * 4);
  for (const layer of spec.layers) {
    const rng = new Rng(derive(layer.seed, 'backdrop', layer.kind));
    const phases = Array.from({ length: 6 }, () => rng.range(0, TAU));
    const tone = tones(layer.color);
    const shades = Array.from({ length: 16 }, (_, k) =>
      hex(mix(mix(tone.base, tone.sh, k / 15), spec.haze, layer.haze)),
    );
    const rim = hex(mix(tone.lt, spec.haze, layer.haze));
    for (let x = 0; x < width; x++) {
      const top = Math.round(PROFILES[layer.kind]((x / width) * TAU, phases) * layer.height * (height - 1));
      for (let y = 0; y <= top; y++) {
        const rgb = y === top && top > 0 ? rim : shades[Math.round((1 - y / Math.max(1, top)) * 15)];
        data.set([rgb[0], rgb[1], rgb[2], 255], (y * width + x) * 4);
      }
    }
  }
  return data;
}

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
  /** Takes a quality tier's shadow budget (engine/gfx/quality.ts). */
  budget(budget: Pick<QualityBudget, 'shadowCasters'>): void;
  /** Follows the camera and the focus (m), flickering at `time` (s); call it each frame. Returns the pool's slots. */
  update(view: { camera: Camera; focus: readonly number[]; time: number }): PoolSlot[];
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

/**
 * Puts a sky on `scene`: the light pool lit from `level`'s light spots (phases from `rng`, a visual stream), the sun,
 * the dome, the backdrop and the atmosphere; shows `sky:daylight` until `set` names another preset.
 */
export function createSky(
  scene: Scene,
  options: { level?: Pick<CompiledLevel, 'lights' | 'bounds'>; poolSize?: number; rng?: Rng; registry?: Registry } = {},
): Sky {
  const registry = options.registry ?? sharedRegistry;
  const pool = createLightPool({ size: options.poolSize, registry });
  if (options.level) pool.setSources(lightSources(options.level), options.rng);
  const atmosphere = createAtmosphere();
  const sun = new DirectionalLight('#ffffff', 0);
  sun.name = 'sky/sun';
  sun.target.name = 'sky/sun/target';
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  const { min, max } = options.level?.bounds ?? { min: [-8, 0, -8], max: [8, 4, 8] };
  const centre = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2] as const;
  const half = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2 + 2;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 3 * half + 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.set(...centre);

  const dome = new SkyMesh();
  dome.name = 'sky/dome';
  dome.scale.setScalar(BACKDROP.radius);
  dome.material.fog = false;
  // The render group, so a new preset reaches the dome however still the camera stands (see atmosphere.ts).
  for (const knob of [dome.turbidity, dome.rayleigh, dome.mieCoefficient, dome.mieDirectionalG, dome.sunPosition])
    knob.setGroup(renderGroup);
  const exposure = uniform(1).setGroup(renderGroup);
  dome.material.colorNode = vec4((dome.material.colorNode as Node).rgb.mul(exposure), 1);
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
    set(id) {
      preset = registry.get('sky', id) as SkyEntry;
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
      backdrop.visible = preset.backdrop.layers.length > 0;
      if (backdrop.visible) {
        strip.image.data = bakeBackdrop(preset.backdrop);
        strip.needsUpdate = true;
      }
      applyCasters();
      return preset;
    },
    budget(budget) {
      casters = shadowCasters(budget);
      applyCasters();
    },
    update({ camera, focus, time }) {
      const eye = camera.position;
      dome.position.copy(eye);
      backdrop.position.set(eye.x, eye.y - BACKDROP.foot + BACKDROP.band / 2, eye.z);
      atmosphere.follow(eye.toArray(), focus);
      return pool.update(focus, time);
    },
    register(warmup) {
      const parts = [warmup.register('sky', { objects: () => [dome, backdrop] }), atmosphere.register(warmup)];
      return { dispose: () => parts.forEach((part) => part.dispose()) };
    },
    report: () => ({ preset: preset.id, casters: { ...split }, slots: pool.slots(), fog: atmosphere.report() }),
    dispose() {
      for (const object of [pool.group, sun, sun.target, dome, backdrop]) object.removeFromParent();
      atmosphere.dispose();
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
