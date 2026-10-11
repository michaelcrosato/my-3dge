/**
 * @file The stage's effects (PLAN.md §6.4's view: particles, shake; WP 6.4's effects shown in the box, WP 6.7 core
 * proposal, ADR-0008 amendment 7): what a running scene's sim shows engine/gfx/fx's effects, read from plain data, so
 * a scene draws particles, telegraphs, trails and bolts with no view code of its own. The stage
 * (engine/gfx/stage.ts) makes one (`stage.fx`), under its scene; the run's view (engine/app/view.ts) hands it each
 * rendered frame.
 *
 * What it reads, asked of the component entries, never of a name (`fxKinds`):
 * - **Bolts**: an entity whose component declares the projectile's fields (engine/world/projectiles.ts
 *   `PROJECTILE_FIELDS`: `state`, `kind`, `team`, `x`…`vz`, `radius`) is drawn as a bolt while it is `flying`, `alpha`
 *   of the way between its last two steps, instead of a stand-in.
 * - **Telegraphs**: a component that declares `telegraph` (a string), `position` (an array), `yaw` and `u` (numbers),
 *   and optionally `size`, is a `TelegraphPlace` (engine/world/telegraphs.ts) as plain data: drawn at floor height,
 *   filling, while `telegraph` names one.
 * - **Trails**: every actor's trail as its puppet's last pose sampled it (engine/gfx/puppets/actors.ts `trails`), as a
 *   ribbon in the blade's tint (engine/gfx/fx/ribbons.ts `TRAIL_TINTS`), while its strike sweeps.
 * - **Events**: `frame` feeds the sim world's event trace (`world.events.trace()`, read without listening): every
 *   emitter answering an event's type bursts where its payload says (`hit`, `slain`, `shot`, `slam`…).
 *
 * The view setting `gfx.effects` (true) turns them on and off; off, they draw nothing and draw no random number, and
 * the sim hash is the same either way (doctrine: WebGPU only). Every pool is the effects' own, made at full size and
 * registered for the warm-up (`register`), so the fight draws with 0 pipelines built after it.
 *
 * Invariants: presentation only: it reads entities, the trace and the puppets' trails, and never writes the sim;
 * randomness comes from the visual streams it is given (`fxRng`: the world's, never hashed); `reset()` forgets
 * what runs and the trace read, for a run started again.
 *
 * @example
 * // const fx = createStageFx({ registry, trails: () => actors.trails() });
 * // stage.scene.add(fx.effects.root);
 * // fx.capture(entities); fx.draw(0.5); fx.frame(dt, camera, world.events.trace());
 * @see engine/gfx/stageFx.test.ts
 */
import type { Camera } from 'three/webgpu';
import type { TrailSample } from '../anim/character';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Field } from '../core/schema';
import { defineSettings } from '../core/settings';
import type { EntityData } from '../sim/state';
import type { TelegraphPlace } from '../world/telegraphs';
import { createEffects, type Effects } from './fx/effects';
import { TRAIL_TINTS } from './fx/ribbons';
import type { Warmup } from './warmup';

/** The view setting that turns the stage's effects on and off. */
export const STAGE_FX_SETTINGS = defineSettings({
  'gfx.effects': {
    type: 'boolean',
    default: true,
    view: true,
    description:
      'Draws the effects: particles, telegraphs, trails, bolts and camera shake. A view setting: never in the hash.',
  },
});

/** The fields a component declares to be drawn as a bolt, and as a telegraph. */
const BOLT_FIELDS = ['state', 'kind', 'team', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'radius'] as const;
const TELEGRAPH_FIELDS = { telegraph: 'string', position: 'array', yaw: 'number', u: 'number' } as const;

/** The component kinds the effects draw: bolts and telegraphs (see the file comment), in registry order. */
export function fxKinds(registry: Registry = sharedRegistry): { bolts: string[]; telegraphs: string[] } {
  if (!registry.kinds().includes('component')) return { bolts: [], telegraphs: [] };
  const entries = registry.list('component');
  const fieldsOf = (entry: (typeof entries)[number]) => entry.fields as Record<string, Field | undefined>;
  return {
    bolts: entries.filter((e) => BOLT_FIELDS.every((name) => fieldsOf(e)[name])).map((e) => e.id),
    telegraphs: entries
      .filter((e) => Object.entries(TELEGRAPH_FIELDS).every(([name, type]) => fieldsOf(e)[name]?.type === type))
      .map((e) => e.id),
  };
}

/** A bolt's place, as a projectile component holds it. */
interface BoltData {
  state: string;
  x: number;
  y: number;
  z: number;
}

/** What `createStageFx` takes. */
export interface StageFxOptions {
  /** Where the component kinds, emitters and telegraphs are declared (the shared registry). */
  registry?: Registry;
  /** The visual streams: the sim world's (`(...keys) => world.fxRng(...keys)`). */
  fxRng?: (...keys: readonly (string | number)[]) => Rng;
  /** The actors' trails, by entity id (the stage's puppets'). */
  trails?: () => ReadonlyMap<number, readonly TrailSample[]>;
}

/** The stage's effects (see the file comment). */
export interface StageFx {
  /** The effects (engine/gfx/fx/effects.ts): its `root` is under the stage's scene, its `shake` moves the camera. */
  readonly effects: Effects;
  /** The component kinds it reads: the bolts' and the telegraphs'. */
  readonly kinds: readonly string[];
  /** Reads the entities after a sim step; returns the ids it draws as bolts (no stand-in for them). */
  capture(entities: Iterable<EntityData>): ReadonlySet<number>;
  /** Puts the bolts `alpha` of the way between their last two steps. */
  draw(alpha: number): void;
  /** Hands this frame's bolts, telegraphs and trails to the effects, plays the trace's new events, and moves them on. */
  frame(dt: number, camera: Camera, trace: readonly { seq: number; type: string; payload: unknown }[]): void;
  /** Registers the effects' pools with the warm-up. */
  register(warmup: Pick<Warmup, 'register'>): { dispose(): void };
  /** Forgets what runs and the trace read: the run started again. */
  reset(): void;
  dispose(): void;
}

/** Makes the stage's effects (see the file comment). */
export function createStageFx(options: StageFxOptions = {}): StageFx {
  const registry = options.registry ?? sharedRegistry;
  const effects = createEffects({ registry, ...(options.fxRng ? { fxRng: options.fxRng } : {}) });
  const { bolts: boltKinds, telegraphs: telegraphKinds } = fxKinds(registry);
  const bolts = new Map<number, { before: [number, number, number]; after: [number, number, number] }>();
  const shown: [number, number, number][] = [];
  let places: TelegraphPlace[] = [];
  return {
    effects,
    kinds: [...boltKinds, ...telegraphKinds],
    capture(entities) {
      const flying = new Set<number>();
      places = [];
      for (const entity of entities) {
        for (const kind of boltKinds) {
          const bolt = entity[kind] as BoltData | undefined;
          if (!bolt || bolt.state !== 'flying') continue;
          const after: [number, number, number] = [bolt.x, bolt.y, bolt.z];
          bolts.set(entity.id, { before: bolts.get(entity.id)?.after ?? after, after });
          flying.add(entity.id);
        }
        for (const kind of telegraphKinds) {
          const place = entity[kind] as TelegraphPlace | undefined;
          if (place?.telegraph) places.push(place);
        }
      }
      for (const id of [...bolts.keys()]) if (!flying.has(id)) bolts.delete(id);
      return flying;
    },
    draw(alpha) {
      const k = Math.min(1, Math.max(0, alpha));
      shown.length = 0;
      for (const { before: a, after: b } of bolts.values()) {
        shown.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      }
    },
    frame(dt, camera, trace) {
      effects.feed(trace);
      for (const at of shown) effects.bolt(at);
      for (const place of places) effects.telegraph(place);
      for (const trail of options.trails?.().values() ?? [])
        if (trail.length > 1) effects.trail(trail, TRAIL_TINTS.blade);
      effects.frame(dt, camera);
    },
    register: (warmup) => effects.register(warmup),
    reset() {
      effects.reset();
      bolts.clear();
      shown.length = 0;
      places = [];
    },
    dispose() {
      effects.dispose();
      bolts.clear();
    },
  };
}
