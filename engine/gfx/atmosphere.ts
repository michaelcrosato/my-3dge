/**
 * @file The atmosphere (PLAN.md WP 7.1): the fog and the ambient light a sky preset gives (engine/gfx/sky.ts).
 *
 * Fog is range fog plus height fog, one TSL fog node on `scene.fogNode` whose numbers are all uniforms, so changing
 * them, or turning the fog off (`amount` 0), never rebuilds a shader. Range fog starts `start` metres past the focus
 * and is whole `end` metres past it, measured along the view, however far back the camera stands (an orthographic
 * camera stands far back): `follow(camera, focus)` moves it each frame. Height fog lies on the floor: `height` at
 * `floor` (m), thinning to none at `ceiling`, and grows from nothing at the focus to whole at the range fog's end, so
 * the play area stays clear. The two combine as `1 − (1 − range)(1 − height)`, scaled by `amount`; `fogAt` is the same
 * sum on the CPU, for tests and tools. Materials with `fog: false` (the sky dome, the backdrop) are never fogged.
 *
 * Ambient light is three.js's `HemisphereLight`: a sky colour from above, a ground colour from below.
 *
 * `register(warmup)` adds the fog to the warm-up's shader key (engine/gfx/warmup.ts reads `scene.fog`, never a fog
 * node), so installing it makes the next frame warm up first instead of stalling.
 *
 * Invariants: presentation only, never in the hash; one fog node and one ambient light per atmosphere, made once.
 *
 * Carried from `my-3d2dge:src/stress-world/50-frame.js:54-56` (the fog that starts a little past the hero, however
 * far the camera is: 12 m to 70 m past it) and the hall's hemisphere light (`10-hall.js:438`).
 *
 * @example
 * const spec = { color: '#000000', start: 12, end: 70, amount: 1, floor: 0, ceiling: 2, height: 0 };
 * fogAt(spec, 30, 5, 30); // 0: the focus itself is clear
 * fogAt(spec, 100, 5, 30); // 1: 70 m past the focus
 * // const atmosphere = createAtmosphere();
 * // atmosphere.install(scene);
 * // atmosphere.follow(camera.position.toArray(), hero); // each frame
 * @see engine/gfx/atmosphere.test.ts
 */
import { Color, HemisphereLight, type Node, type Scene } from 'three/webgpu';
import { float, fog, positionView, positionWorld, renderGroup, smoothstep, uniform } from 'three/tsl';
import type { Schema } from '../core/schema';
import type { Warmup } from './warmup';

/** The fields of a sky preset's `fog` (engine/gfx/sky.ts); see `FogSpec`. */
export const FOG_FIELDS = {
  color: { type: 'string', default: '#06050b', description: 'Its colour, hex.' },
  start: { type: 'number', default: 12, minimum: 0, unit: 'm', description: 'Where range fog starts, past the focus.' },
  end: { type: 'number', default: 70, minimum: 0, unit: 'm', description: 'Where range fog is whole, past the focus.' },
  amount: { type: 'number', default: 0, minimum: 0, maximum: 1, description: "The fog's strength, 0 (none) to 1." },
  floor: { type: 'number', default: 0, unit: 'm', description: 'The height where height fog is densest.' },
  ceiling: { type: 'number', default: 1.5, unit: 'm', description: 'The height above which there is no height fog.' },
  height: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 1,
    description: "Height fog's density at the floor, 0 (none) to 1.",
  },
} as const satisfies Schema;

/** The fields of a sky preset's `ambient` (engine/gfx/sky.ts); see `AmbientSpec`. */
export const AMBIENT_FIELDS = {
  sky: { type: 'string', default: '#c8d4ff', description: 'The colour from above, hex.' },
  ground: { type: 'string', default: '#4a3f30', description: 'The colour from below, hex.' },
  intensity: { type: 'number', default: 1, minimum: 0, description: 'How bright it is.' },
} as const satisfies Schema;

/** The fog a sky preset gives; see the file comment. Lengths in metres. */
export interface FogSpec {
  color: string;
  /** Where range fog starts, past the focus. */
  start: number;
  /** Where range fog is whole, past the focus. */
  end: number;
  /** The whole fog's strength, 0 (none) to 1. */
  amount: number;
  /** The height where height fog is densest. */
  floor: number;
  /** The height above which there is no height fog. */
  ceiling: number;
  /** Height fog's density at the floor, 0 (none) to 1. */
  height: number;
}

/** The ambient light a sky preset gives: three.js's HemisphereLight. */
export interface AmbientSpec {
  sky: string;
  ground: string;
  intensity: number;
}

/** What the fog does now. */
export interface FogReport {
  /** Where range fog starts and is whole, as view depths (m). */
  near: number;
  far: number;
  /** The focus's view depth (m). */
  focus: number;
  amount: number;
}

/** The atmosphere: its ambient light and fog; see the file comment. */
export interface Atmosphere {
  readonly ambient: HemisphereLight;
  /** The fog node `install` puts on the scene. */
  readonly fogNode: Node;
  /** Takes a preset's fog and ambient light. */
  set(spec: { fog: FogSpec; ambient: AmbientSpec }): void;
  /** Moves the range fog to start past `focus`, as `camera` (both in metres) sees it. */
  follow(camera: readonly number[], focus: readonly number[]): void;
  /** Puts the fog node on `scene` and the ambient light in it. */
  install(scene: Scene): void;
  /** Adds the fog to `warmup`'s shader key; `dispose()` takes it out. */
  register(warmup: Warmup): { dispose(): void };
  report(): FogReport;
  /** Takes the fog node off its scene and the ambient light out of it. */
  dispose(): void;
}

/** `smoothstep` as WGSL computes it, for `fogAt`. */
function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How much fog covers a point `depth` metres along the view and `y` high, the focus at view depth `focus` (0..1). */
export function fogAt(spec: FogSpec, depth: number, y: number, focus: number): number {
  const range = smooth(focus + spec.start, focus + spec.end, depth);
  const height = spec.height * (1 - smooth(spec.floor, spec.ceiling, y)) * smooth(focus, focus + spec.end, depth);
  return (1 - (1 - range) * (1 - height)) * spec.amount;
}

/** Makes an atmosphere (fog and ambient light), off until `set` gives it a preset. */
export function createAtmosphere(): Atmosphere {
  const ambient = new HemisphereLight('#ffffff', '#000000', 0);
  ambient.name = 'atmosphere/ambient';
  let spec: FogSpec = { color: '#000000', start: 0, end: 1, amount: 0, floor: 0, ceiling: 1, height: 0 };
  // The render group, as three.js's own fog: an object's group refreshes only when the object or its material
  // changes, so a still floor would keep the fog it was first drawn with (measured on r182).
  const number = (value: number) => uniform(value).setGroup(renderGroup);
  const u = {
    color: uniform(new Color()).setGroup(renderGroup),
    near: number(0),
    far: number(1),
    focus: number(0),
    amount: number(0),
    floor: number(0),
    ceiling: number(1),
    height: number(0),
  };
  const depth = positionView.z.negate();
  const range = smoothstep(u.near, u.far, depth);
  const low = float(1).sub(smoothstep(u.floor, u.ceiling, positionWorld.y));
  const height = u.height.mul(low).mul(smoothstep(u.focus, u.far, depth));
  const factor = float(1)
    .sub(float(1).sub(range).mul(float(1).sub(height)))
    .mul(u.amount);
  const fogNode = fog(u.color, factor);
  let scene: Scene | null = null;

  const atmosphere: Atmosphere = {
    ambient,
    fogNode,
    set(given) {
      spec = { ...given.fog, end: Math.max(given.fog.end, given.fog.start + 0.01) };
      spec.ceiling = Math.max(spec.ceiling, spec.floor + 0.01);
      u.color.value.set(spec.color);
      u.amount.value = spec.amount;
      u.floor.value = spec.floor;
      u.ceiling.value = spec.ceiling;
      u.height.value = spec.height;
      ambient.color.set(given.ambient.sky);
      ambient.groundColor.set(given.ambient.ground);
      ambient.intensity = given.ambient.intensity;
    },
    follow(camera, focus) {
      const along = Math.hypot(focus[0] - camera[0], focus[1] - camera[1], focus[2] - camera[2]);
      u.focus.value = along;
      u.near.value = along + spec.start;
      u.far.value = along + spec.end;
    },
    install(target) {
      scene = target;
      target.fogNode = fogNode;
      target.add(ambient);
    },
    register(warmup) {
      return warmup.keyPart('atmosphere', () => (scene?.fogNode === fogNode ? 'fog' : 'none'));
    },
    report: () => ({ near: u.near.value, far: u.far.value, focus: u.focus.value, amount: u.amount.value }),
    dispose() {
      if (scene?.fogNode === fogNode) scene.fogNode = null;
      ambient.removeFromParent();
      scene = null;
    },
  };
  return atmosphere;
}
