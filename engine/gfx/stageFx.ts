/**
 * @file The stage's effects (PLAN.md §6.4's view: particles, shake; WP 6.4's effects shown in the box, WP 6.7 core
 * proposal, ADR-0008 amendment 8): what a running scene's sim shows engine/gfx/fx's effects, read from plain data, so
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
 *   emitter answering an event's type bursts where its payload says (`hit`, `slain`, `shot`, `slam`…), and each
 *   `gunshot` draws its tracer, flash, impact and hole (engine/gfx/weapons.ts `createWeaponFx`, `shots`), from the
 *   shooter's muzzle as `muzzle(id)` finds it (the stage's puppets' carried gun).
 *
 * The view setting `gfx.effects` (true) turns them on and off; off, they draw nothing and draw no random number, and
 * claim no bolt, so bolts draw as their stand-ins, which the ID pass names (§6.7: a view setting never hides a
 * gameplay entity); the sim hash is the same either way (doctrine: WebGPU only). The view sets it before each read,
 * and a frame that finds it switched reads the entities again first (engine/app/view.ts), so a flying bolt changes
 * hands in that frame, stepped or not (a paused page, a hit-stop, a shot).
 * Every pool is the effects' own, made at full size and registered for the warm-up (`register`), so the fight draws
 * with 0 pipelines built after it.
 *
 * Invariants: presentation only: it reads entities, the trace and the puppets' trails, and never writes the sim;
 * randomness comes from the visual streams it is given (`fxRng`: the world's, never hashed); `reset()` forgets
 * what runs and the trace read, for a new world only: a restore or a dev action keeps the world, whose trace is
 * history and never restored, so reading it again would play its events twice (engine/app/view.ts `restarted`).
 *
 * @example
 * // const fx = createStageFx({ registry, trails: () => actors.trails() });
 * // stage.scene.add(fx.effects.root);
 * // fx.capture(entities); fx.draw(0.5); fx.frame(dt, camera, world.events.trace());
 * @see engine/gfx/stageFx.test.ts
 */
import type { Camera, Vector3 } from 'three/webgpu';
import type { TrailSample } from '../anim/character';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Field } from '../core/schema';
import { defineSettings } from '../core/settings';
import type { EntityData } from '../sim/state';
import type { TelegraphPlace } from '../world/telegraphs';
import { gpuParticlesFor, type FeatureReport, type GpuParticles } from './features';
import { createEffects, type Effects } from './fx/effects';
import { TRAIL_TINTS } from './fx/ribbons';
import type { Warmup } from './warmup';
import { createWeaponFx, type WeaponFx } from './weapons';

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
  /** Where actor `id`'s carried gun's muzzle is now (the stage's puppets'), or null. */
  muzzle?: (id: number) => Vector3 | null;
}

/** The stage's effects (see the file comment). */
export interface StageFx {
  /** The effects (engine/gfx/fx/effects.ts): its `root` is under the stage's scene, its `shake` moves the camera. */
  readonly effects: Effects;
  /** The shots' tracers and holes (engine/gfx/weapons.ts), under the effects' root. */
  readonly shots: WeaponFx;
  /** The GPU's particle ring the effects burst `gpu` emitters into (WP 11.3), made by `register`; null until then. */
  readonly gpuParticles: GpuParticles | null;
  /** The component kinds it reads: the bolts' and the telegraphs'. */
  readonly kinds: readonly string[];
  /** Reads the entities after a sim step; returns the ids it draws as bolts (no stand-in for them): none while off. */
  capture(entities: Iterable<EntityData>): ReadonlySet<number>;
  /** Puts the bolts `alpha` of the way between their last two steps. */
  draw(alpha: number): void;
  /** Hands this frame's bolts, telegraphs and trails to the effects, plays the trace's new events, and moves them on. */
  frame(dt: number, camera: Camera, trace: readonly { seq: number; type: string; payload: unknown }[]): void;
  /**
   * Registers the effects' pools with the warm-up, and gives the effects the GPU's particle ring where `features` has
   * `feature:gpuParticles` on and an emitter of the registry asks for it (`gpu`): a page with none makes none. The
   * frame hands it to the post chain, which draws it and warms it up.
   */
  register(warmup: Pick<Warmup, 'register'>, features?: FeatureReport): { dispose(): void };
  /** Forgets what runs and the trace read: a new world, never the same one restored (it would play its trace again). */
  reset(): void;
  dispose(): void;
}

/** Makes the stage's effects (see the file comment). */
export function createStageFx(options: StageFxOptions = {}): StageFx {
  const registry = options.registry ?? sharedRegistry;
  const effects = createEffects({ registry, ...(options.fxRng ? { fxRng: options.fxRng } : {}) });
  const shots = createWeaponFx({ effects });
  effects.root.add(shots.root);
  let gpu: GpuParticles | null = null;
  const { bolts: boltKinds, telegraphs: telegraphKinds } = fxKinds(registry);
  const bolts = new Map<number, { before: [number, number, number]; after: [number, number, number] }>();
  const shown: [number, number, number][] = [];
  let places: TelegraphPlace[] = [];
  return {
    effects,
    shots,
    kinds: [...boltKinds, ...telegraphKinds],
    capture(entities) {
      const flying = new Set<number>();
      places = [];
      if (!effects.enabled) {
        bolts.clear(); // off, the stage draws them as stand-ins; on again, they start from where they are
        return flying;
      }
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
      shots.feed(trace, options.muzzle ?? (() => null), effects.enabled); // off, read but not played
      shots.root.visible = effects.enabled;
      shots.frame(dt);
      for (const at of shown) effects.bolt(at);
      for (const place of places) effects.telegraph(place);
      for (const trail of options.trails?.().values() ?? [])
        if (trail.length > 1) effects.trail(trail, TRAIL_TINTS.blade);
      effects.frame(dt, camera);
    },
    get gpuParticles() {
      return gpu;
    },
    register(warmup, features) {
      const make = gpuParticlesFor(features);
      const asked = (registry.list('emitter') as unknown as { gpu: boolean }[]).some((entry) => entry.gpu);
      if (make && asked && !gpu) effects.useGpuParticles((gpu = make()));
      const both = [effects.register(warmup), shots.register(warmup)];
      return { dispose: () => both.forEach((registration) => registration.dispose()) };
    },
    reset() {
      effects.reset();
      shots.reset();
      bolts.clear();
      shown.length = 0;
      places = [];
    },
    dispose() {
      effects.dispose();
      shots.dispose();
      gpu?.dispose();
      bolts.clear();
    },
  };
}
