/**
 * @file The light pool (PLAN.md WP 7.1, I-17): a fixed set of point lights near the focus. A level holds many light
 * spots (the hall's 30 torches, engine/world/level); every lit shader would pay for each light in the scene, and
 * adding or removing one rebuilds every lit pipeline (r182's lights node keys shaders on the light list). So the pool
 * makes `size` point lights once (8 to 16; 12 by default), never adds or removes one, and on each frame's `update`
 * gives them to the light sources that matter most near the focus: the shaders never rebuild as the focus moves. On a
 * renderer with tiled lighting (`feature:tiledLighting`, engine/gfx/enhanced/lighting.ts) it may hold up to 64
 * (`tiled`), since a lit shader then pays for the lights of its screen tile alone.
 *
 * Choosing: a source's rank is its distance from the focus divided by its kind's `priority` (a light of priority 2
 * counts as if it were half as far), ties going to the earlier source; the `size` best take the slots in rank order,
 * so the first slots, which cast shadows within the budget (engine/gfx/shadows.ts), hold the most important lights.
 * Lights near the cut-off fade out over the last `FADE` of the rank (the rank of the first source left out), so a
 * source handed from one frame's choice to the next never pops. A slot with no source shines with intensity 0.
 *
 * Lamps (WP 13.23): `update` also ranks the frame's lamps, the props' lights that are on (engine/gfx/props.ts), each
 * with its own colour, intensity and reach; one standing on a level's spot of its kind is that spot's, lit once.
 *
 * Light kinds (registry kind `light`): what a level's light-spot tag means, as three.js's `PointLight` parameters
 * (`color`, `intensity` in candela, `distance`, `decay`) plus the pool's `priority` and how much it `flicker`s; the
 * spot tag `torch` is `light:torch`. Flicker is the prototype's torch flicker (`FLICKER`, about ±13% round 0.9), each
 * source at a phase drawn from the random stream `setSources` is given: a visual stream (`world.fxRng`), never
 * hashed, so lights never change play.
 *
 * Invariants: the pool's light count never changes, nor any light's `castShadow` except through the shadow budget;
 * equal sources, focus, time and stream give equal slots; nothing here reads or writes the sim.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:435-466`: the fixed light set, `FLICKER`, the torch's colour,
 * reach and decay (`TORCH_COLOR`, `TORCH_REACH`, 0.5), its intensity (`LIGHT.torch`), and the shadow lights taking
 * the lit torches nearest the hero.
 *
 * @example
 * flicker(0, 0, 1); // 0.9: the torch flicker at rest
 * rankSources([{ light: 'light:torch', position: [9, 1, 0] }, { light: 'light:torch', position: [2, 1, 0] }], [0, 1, 0], 1).order; // [1]
 * // const pool = createLightPool({ size: 12 });
 * // pool.setSources(lightSources(level), world.fxRng('lights'));
 * // scene.add(pool.group);
 * // pool.update(hero, seconds); // each frame
 * @see engine/gfx/lights.test.ts
 */
import { Group, PointLight } from 'three/webgpu';
import { codeError, defineCodes } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Schema } from '../core/schema';
import type { CompiledLevel } from '../world/level/types';
import { configurePointCaster, MAX_SHADOW_CASTERS } from './shadows';

/** The codes this module raises, with their fixes. */
export const LIGHTS_CODES = defineCodes('gfx', {
  GFX_BAD_LIGHT_POOL: {
    template: 'a light pool of {size} lights: it holds {min} to {max}',
    fix: 'give createLightPool a whole size from 8 to 16 (12 by default), or to 64 with tiled: true on a renderer with tiled lighting (feature:tiledLighting, WP 11.5)',
  },
});

/** The fields of a `light` entry: three.js's `PointLight` parameters, and how the pool treats it. */
export const LIGHT_FIELDS = {
  description: { type: 'string', default: '', description: 'What it is, in plain sentences.' },
  color: { type: 'string', default: '#ffffff', description: "Its colour, hex (three.js's PointLight color)." },
  intensity: {
    type: 'number',
    default: 10,
    minimum: 0,
    unit: 'cd',
    description: "How bright it is, in candela (three.js's PointLight intensity).",
  },
  distance: {
    type: 'number',
    default: 10,
    minimum: 0.1,
    unit: 'm',
    description: "How far it reaches: its light ends there (three.js's PointLight distance).",
  },
  decay: {
    type: 'number',
    default: 2,
    minimum: 0,
    description: "How fast it dims with distance (three.js's decay: 2 is physical, lower reaches further).",
  },
  priority: {
    type: 'number',
    default: 1,
    minimum: 0.01,
    description: 'How much it matters when the pool chooses: a light of priority 2 counts as if it were half as far.',
  },
  flicker: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 1,
    description: "How much it flickers: 0 is steady, 1 the prototype torch's flicker (about ±13% round 0.9).",
  },
} as const satisfies Schema;

/** A `light` entry. */
export type LightEntry = Entry<typeof LIGHT_FIELDS>;

/** A light source the pool may light: a `light` entry's id and where it shines (m). */
export interface LightSource {
  readonly light: string;
  readonly position: readonly [number, number, number];
}

/** A lamp the pool may light this frame: a prop's light spot in the world (engine/gfx/props.ts `PropLight`). */
export interface PoolLamp {
  /** Its kind's tag: a `light:<tag>` declared gives its priority. */
  readonly tag: string;
  readonly position: readonly [number, number, number];
  readonly color: string;
  /** Its intensity this frame (cd), its own flicker included. */
  readonly intensity: number;
  readonly distance: number;
  readonly decay: number;
}

/** One slot of the pool, as the last `update` left it. */
export interface PoolSlot {
  /** The source it lights (an index into the pool's sources, then into the frame's lamps after them), or -1. */
  source: number;
  /** The source's light kind, or `''`. */
  light: string;
  castShadow: boolean;
  /** Its intensity this frame (cd), flicker, fade and the pool's scale included. */
  intensity: number;
}

/** The pool's sizes: the fewest and most lights, the default, and the most with tiled lighting (WP 11.5). */
export const POOL_SIZES = { min: 8, max: 16, default: 12, tiled: 64 } as const;

/** Phases (s) without a stream: the golden angle's step, so neighbouring sources never flicker in step. */
const GOLDEN = 2.399963229728653;

/** The share of the cut-off rank over which the last lights chosen fade out. */
export const FADE = 0.15;

/** Declares the kind `light` and the built-in light kinds on `registry`, unless it has them. */
export function defineLights(registry: Registry = sharedRegistry): void {
  if (!registry.kinds().includes('light')) {
    registry.defineKind('light', {
      description:
        "What a level's light spot shines with: three.js's PointLight parameters, its priority in the light pool and its flicker.",
      fields: LIGHT_FIELDS,
      defineWith: "defineLight('light:<tag>', { color, intensity, distance, decay, priority, flicker })",
    });
  }
  if (!registry.has('light', 'light:torch')) {
    registry.def('light', 'light:torch', {
      description: 'A brazier torch: warm, flickering, reaching about 10 m.',
      color: '#ffc8a0',
      intensity: 30,
      distance: 10.625,
      decay: 0.5,
      flicker: 1,
    });
  }
}
defineLights();

/** Declares a light kind (`light:<tag>`, the tag a level's light spots carry); see `LIGHT_FIELDS`. */
export function defineLight(
  id: string,
  spec: Partial<Omit<LightEntry, 'id' | 'kind'>>,
  registry: Registry = sharedRegistry,
): LightEntry {
  return registry.def('light', id, spec) as LightEntry;
}

/** The light sources of a compiled level: one per light spot, of the kind `light:<tag>`. */
export function lightSources(level: Pick<CompiledLevel, 'lights'>): LightSource[] {
  return level.lights.map((spot) => ({ light: `light:${spot.tag}`, position: spot.position }));
}

/** The prototype's torch flicker at `time` (s), shifted by `phase` (s) and scaled by `amount` (0 is steady). */
export function flicker(time: number, phase: number, amount: number): number {
  const t = time + phase;
  const torch = 0.9 + Math.sin(t * 13) * 0.05 + Math.sin(t * 29) * 0.04 + Math.sin(t * 7.3) * 0.04;
  return 1 - amount * (1 - torch);
}

/** What `rankSources` chose: the sources best first, their ranks, and the rank of the first left out. */
export interface Ranking {
  order: number[];
  ranks: number[];
  /** The first source left out's rank; `Infinity` when every source was chosen. */
  cutoff: number;
}

/** The `count` sources that matter most at `focus` (see the file comment); `priorities` default to 1. */
export function rankSources(
  sources: readonly LightSource[],
  focus: readonly number[],
  count: number,
  priorities: readonly number[] = [],
): Ranking {
  const ranked = sources.map((source, index) => {
    const [x, y, z] = source.position;
    const distance = Math.hypot(x - focus[0], y - focus[1], z - focus[2]);
    return { index, rank: distance / (priorities[index] ?? 1) };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const chosen = ranked.slice(0, count);
  return {
    order: chosen.map((r) => r.index),
    ranks: chosen.map((r) => r.rank),
    cutoff: ranked[count]?.rank ?? Infinity,
  };
}

/** How much a source of `rank` shines when the first left out ranks `cutoff`: 1, fading to 0 at the cut-off. */
export function fadeOf(rank: number, cutoff: number): number {
  if (!Number.isFinite(cutoff)) return 1;
  const span = FADE * cutoff;
  return span > 0 ? Math.min(1, Math.max(0, (cutoff - rank) / span)) : 0;
}

/** How near (m) a lamp stands to a level's spot of its kind to be that spot's light. */
const ON_SPOT = 0.05;

/** Whether `lamp` stands on one of `sources` of its kind (see the file comment). */
function onSpot(sources: readonly LightSource[], lamp: PoolLamp): boolean {
  const kind = `light:${lamp.tag}`;
  return sources.some(({ light, position: [x, y, z] }) => light === kind && Math.hypot(x - lamp.position[0], y - lamp.position[1], z - lamp.position[2]) < ON_SPOT); // prettier-ignore
}

/** A fixed pool of point lights; see the file comment. */
export interface LightPool {
  /** Its lights, under one group: add it to the scene once. */
  readonly group: Group;
  /** The lights, in slot order: the first ones cast shadows within the budget. */
  readonly lights: readonly PointLight[];
  readonly size: number;
  /** A multiplier on every light's intensity (a sky preset's `pointLights`): 0 puts them all out. */
  scale: number;
  /** How many slots cast shadows (the shadow budget's share, 0 to `MAX_SHADOW_CASTERS`); changes the shader key. */
  casters: number;
  /** The sources it chooses from, each given a flicker phase from `rng` (a visual stream, `world.fxRng`), else spread. */
  setSources(sources: readonly LightSource[], rng?: Rng): void;
  readonly sources: readonly LightSource[];
  /**
   * Gives the slots to the sources and the frame's `lamps` that matter most at `focus` (m), flickering at `time` (s);
   * returns the slots. A lamp is a prop's light spot that is on (a room's lamp its switch turned on, a street lamp
   * lit at dusk), its flicker in its intensity, a declared `light:<tag>` giving its priority; one standing on one of
   * the level's spots of its kind (a brazier on its torch spot, where the level places it) is that spot's light.
   */
  update(focus: readonly number[], time: number, lamps?: readonly PoolLamp[]): PoolSlot[];
  /** The slots as the last `update` left them. */
  slots(): PoolSlot[];
  /** Takes the group out of its parent; the lights hold no GPU memory of their own. */
  dispose(): void;
}

/**
 * Makes a light pool of `size` lights (8 to 16, or to 64 on a renderer with tiled lighting, `tiled`; 12 by default).
 * Throws `GFX_BAD_LIGHT_POOL`.
 */
export function createLightPool(options: { size?: number; tiled?: boolean; registry?: Registry } = {}): LightPool {
  const { size = POOL_SIZES.default, registry = sharedRegistry } = options;
  const max = options.tiled ? POOL_SIZES.tiled : POOL_SIZES.max;
  if (!Number.isInteger(size) || size < POOL_SIZES.min || size > max) {
    throw codeError('GFX_BAD_LIGHT_POOL', { size: String(size), min: POOL_SIZES.min, max });
  }
  const group = new Group();
  group.name = 'lights:pool';
  const lights = Array.from({ length: size }, (_, i) => {
    const light = new PointLight('#ffffff', 0);
    light.name = `lights:pool/${i}`;
    if (i < MAX_SHADOW_CASTERS) configurePointCaster(light);
    group.add(light);
    return light;
  });
  let sources: readonly LightSource[] = [];
  let entries: LightEntry[] = [];
  let phases: number[] = [];
  let casters = 0;
  let slots: PoolSlot[] = lights.map(() => ({ source: -1, light: '', castShadow: false, intensity: 0 }));

  const pool: LightPool = {
    group,
    lights,
    size,
    scale: 1,
    get casters() {
      return casters;
    },
    set casters(count: number) {
      casters = Math.max(0, Math.min(MAX_SHADOW_CASTERS, Math.floor(count)));
      lights.forEach((light, i) => (light.castShadow = i < casters));
    },
    setSources(given, rng) {
      sources = given.map((source) => ({ light: source.light, position: [...source.position] as const }));
      entries = sources.map((source) => registry.get('light', source.light) as LightEntry);
      phases = sources.map((_, i) => (rng ? rng.range(0, 64) : (i * GOLDEN) % 64));
    },
    get sources() {
      return sources;
    },
    update(focus, time, given = []) {
      const lamps = given.filter((lamp) => !onSpot(sources, lamp));
      const kinds = lamps.map((lamp) => `light:${lamp.tag}`);
      const priority = (kind: string) => (registry.has('light', kind) ? (registry.get('light', kind) as LightEntry).priority : 1); // prettier-ignore
      const ranking = rankSources(
        [...sources, ...lamps.map((lamp, i) => ({ light: kinds[i], position: lamp.position }))],
        focus,
        size,
        [...entries.map((entry) => entry.priority), ...kinds.map(priority)],
      );
      slots = lights.map((light, i) => {
        const source = ranking.order[i] ?? -1;
        if (source < 0) {
          light.intensity = 0;
          return { source, light: '', castShadow: light.castShadow, intensity: 0 };
        }
        const fade = fadeOf(ranking.ranks[i], ranking.cutoff);
        if (source >= sources.length) {
          const lamp = lamps[source - sources.length];
          light.position.fromArray(lamp.position);
          light.color.set(lamp.color);
          light.distance = lamp.distance;
          light.decay = lamp.decay;
          light.intensity = lamp.intensity * pool.scale * fade;
          return { source, light: kinds[source - sources.length], castShadow: light.castShadow, intensity: light.intensity }; // prettier-ignore
        }
        const entry = entries[source];
        light.position.fromArray(sources[source].position);
        light.color.set(entry.color);
        light.distance = entry.distance;
        light.decay = entry.decay;
        light.intensity = entry.intensity * pool.scale * fade * flicker(time, phases[source], entry.flicker);
        return { source, light: entry.id, castShadow: light.castShadow, intensity: light.intensity };
      });
      return pool.slots();
    },
    slots: () => slots.map((slot) => ({ ...slot })),
    dispose() {
      group.removeFromParent();
    },
  };
  return pool;
}
