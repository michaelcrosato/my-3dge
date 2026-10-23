/**
 * @file The stage's lights (PLAN.md §6.4's view, WP 7.8, ADR-0008 amendment 10): the stage's own, a hemisphere light
 * and one shadow-casting sun fitted to the level under a plain background, and a sky on demand (engine/gfx/sky.ts: the
 * light pool lit from the level's light spots and flickering, the sky's sun, its dome and backdrop, the ambient light
 * and the fog). A look names the sky (`look.sky`, engine/gfx/post/looks.ts) and the app shows it (engine/app/look.ts):
 * `show('')` draws with the stage's own lights; `show(id)` makes the sky the first time a preset is asked for, then
 * hides the stage's own lights and shows the preset. Each frame, `update` follows the camera and the focus, the pool's
 * lights flickering at the frame time (engine/app/view.ts).
 *
 * Why on demand, and hidden rather than out: every lit shader pays for each visible light, and the pool's 12 point
 * lights with their cube shadow maps would cost every frame of a page that never asks for them (the box's suites draw
 * thousands of frames on SwiftShader). Hidden lights are out of r182's lights node and of the warm-up's shader key
 * (engine/gfx/warmup.ts keys the visible lights), and the fog node is installed only while a sky shows, so a stage
 * draws with exactly its own pipelines until a look names a sky. Switching between the stage's lights and a sky
 * changes the key, so the renderer warms up again before it draws, never stalling a frame; switching between two skies
 * changes uniforms, and who casts shadows only as engine/gfx/sky.ts says.
 *
 * Invariants: presentation only, never in the hash; the stage's own lights are made first and the sky's later, so the
 * sky's lights have the higher ids and come after them in the scene (r182 sorts its lights by id, engine/gfx/sky.ts);
 * one sky per stage, made once, its flicker phases drawn from the visual stream `rng` gives (`world.fxRng`).
 *
 * @example
 * // const lights = createStageSky(scene, { level, registry, background: '#2a3140', rng: () => world.fxRng('lights') });
 * // lights.register(gfx.warmup);
 * // lights.show('sky:hall'); // the torch-lit hall: the next frame warms up first
 * // lights.update({ camera, focus: hero, time: seconds }); // each frame
 * // lights.show(''); // the stage's own lights again
 * @see engine/gfx/stageSky.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { Color, DirectionalLight, HemisphereLight, type Camera, type Object3D, type Scene } from 'three/webgpu';
import type { Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { CompiledLevel } from '../world/level/types';
import type { QualityBudget } from './quality';
import type { FeatureReport } from './features';
import { createSky, type Sky, type SkyReport } from './sky';
import type { Warmup } from './warmup';

/** What the stage's lights are made from. */
export interface StageSkyOptions {
  /** The level they light (its size places the sun, its light spots feed the pool), or null. */
  level: CompiledLevel | null;
  /** Without a level, the ground they light (a terrain's): its north-west corner [x, z] and its size [x, z] (m). */
  area?: { readonly corner: readonly [number, number]; readonly size: readonly [number, number] };
  /** Where the sky presets and light kinds are declared. */
  registry: Registry;
  /** The background the stage's own lights stand under, hex. */
  background: string;
  /** The visual stream the pool's flicker phases come from, asked for when the sky is made. */
  rng?: () => Rng | undefined;
}

/** The stage's lights (see the file comment). */
export interface StageSky {
  /** The sky preset shown, or `''` while the stage's own lights draw. */
  readonly shown: string;
  /** The sky, once a preset has been shown; null before. */
  readonly sky: Sky | null;
  /** The stage's own lights. */
  readonly own: { readonly ambient: HemisphereLight; readonly sun: DirectionalLight };
  /** Shows the sky preset `id` (kind `sky`), or the stage's own lights for `''`. */
  show(id: string): void;
  /** Takes a quality tier's shadow budget for the sky (engine/gfx/quality.ts). */
  budget(budget: Pick<QualityBudget, 'shadowCasters'>): void;
  /** Follows the camera and the focus (m), flickering at `time` (s), while a sky shows; call it each frame. */
  update(view: { camera: Camera; focus: readonly number[]; time: number }): void;
  /** Registers the sky with `warmup`, now or when it is made; `dispose()` undoes it. */
  /**
   * Registers the sky's parts with `warmup` (and the sky made later); `features`, the renderer's report
   * (engine/gfx/features.ts), sizes the sky made after it (tiled lighting's pool, the sun's cascades).
   */
  register(warmup: Pick<Warmup, 'register' | 'keyPart'>, features?: FeatureReport): { dispose(): void };
  /** What draws now: the preset, and the sky's report while it shows. */
  report(): { shown: string; sky: SkyReport | null };
  /** Takes the sky out of the scene and frees it. */
  dispose(): void;
}

/** The stage's own lights, fitted to `level` (else `area`, else 16 × 16 m); added to `scene` in this order. */
function ownLights(scene: Scene, level: CompiledLevel | null, area?: StageSkyOptions['area']): StageSky['own'] {
  const ambient = new HemisphereLight('#c8d4ff', '#4a3f30', 1.6);
  ambient.name = 'light:sky';
  const sun = new DirectionalLight('#fff0d8', 2.6);
  sun.name = 'light:sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.target.name = 'light:sun/target';
  scene.add(ambient, sun, sun.target);
  const [w, d] = level ? [level.cols * level.tile, level.rows * level.tile] : (area?.size ?? [16, 16]);
  const [x0, z0] = level ? [0, 0] : (area?.corner ?? [0, 0]);
  sun.position.set(x0 + w / 2 - w * 0.4, 14, z0 + d / 2 - d * 0.6);
  sun.target.position.set(x0 + w / 2, 0, z0 + d / 2);
  const half = Math.hypot(w, d) / 2 + 2;
  // A level's sun reaches 60 m; a terrain's as far as its far corner.
  const far = level || !area ? 60 : sun.position.distanceTo(sun.target.position) + half;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far });
  sun.shadow.camera.updateProjectionMatrix();
  return { ambient, sun };
}

/** The sky's objects that hide with it: its lights, its dome and its backdrop. */
const skyParts = (sky: Sky): Object3D[] => [sky.pool.group, sky.atmosphere.ambient, sky.sun, sky.dome, sky.backdrop];

/** Makes the stage's lights on `scene` (see the file comment); the stage's own show until a sky is asked for. */
export function createStageSky(scene: Scene, options: StageSkyOptions): StageSky {
  const own = ownLights(scene, options.level, options.area);
  let sky: Sky | null = null;
  let shown = '';
  let budget: Pick<QualityBudget, 'shadowCasters'> = { shadowCasters: null };
  let warmup: Pick<Warmup, 'register' | 'keyPart'> | null = null;
  let registered: { dispose(): void } | null = null;
  let features: FeatureReport | undefined;
  const background = () => {
    if (scene.background instanceof Color) scene.background.set(options.background);
    else scene.background = new Color(options.background);
  };

  /** The sky, made the first time a preset is asked for. */
  const make = (): Sky => {
    const made = createSky(scene, {
      level: options.level ?? undefined,
      rng: options.rng?.(),
      registry: options.registry,
      features,
    });
    made.budget(budget);
    if (warmup) registered = made.register(warmup as Warmup);
    return made;
  };

  const lights: StageSky = {
    get shown() {
      return shown;
    },
    get sky() {
      return sky;
    },
    own,
    show(id) {
      if (id === shown) return;
      if (id) {
        sky ??= make();
        own.ambient.visible = own.sun.visible = false;
        for (const part of skyParts(sky)) part.visible = true;
        scene.fogNode = sky.atmosphere.fogNode;
        sky.set(id); // the background, the dome's and backdrop's visibility, who casts shadows
      } else {
        own.ambient.visible = own.sun.visible = true;
        if (sky) for (const part of skyParts(sky)) part.visible = false;
        if (sky && scene.fogNode === sky.atmosphere.fogNode) scene.fogNode = null;
        background();
      }
      shown = id;
    },
    budget(given) {
      budget = { shadowCasters: given.shadowCasters };
      sky?.budget(budget);
    },
    update(view) {
      if (shown && sky) sky.update(view);
    },
    register(given, report) {
      features = report ?? features;
      warmup = given;
      if (sky && !registered) registered = sky.register(given as Warmup);
      return {
        dispose() {
          registered?.dispose();
          registered = null;
          warmup = null;
        },
      };
    },
    report: () => ({ shown, sky: shown && sky ? sky.report() : null }),
    dispose() {
      registered?.dispose();
      registered = null;
      if (sky && scene.fogNode === sky.atmosphere.fogNode) scene.fogNode = null;
      sky?.dispose();
      sky = null;
      own.ambient.removeFromParent();
      own.sun.removeFromParent();
      own.sun.target.removeFromParent();
    },
  };
  return lights;
}
