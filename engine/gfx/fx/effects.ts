/**
 * @file The effects of a view (PLAN.md WP 6.4, §6.4's view state; doctrine: WebGPU only): `createEffects()` draws
 * particles, floor decals and telegraphs, socket trails, bolts and camera shake for a scene, all under one group
 * (`root`), as presentation that the sim never sees: the sim hash is the same with effects on or off.
 *
 * What a view gives it, then `frame(dt, camera)` once per rendered frame:
 * - **Events:** `event(type, payload)` bursts every emitter answering `type` (engine/gfx/fx/emitters.ts: its own
 *   particles, its layers, its shake and its floor ring) at the payload's `position` (or its `x`, `y`, `z`), scaled
 *   by its `size`, pushed by its `velocity`, in its `color` (hex), landing on its `ground`. `feed(trace)` plays the
 *   events of the sim world's trace (`world.events.trace()`) it has not played yet, reading it without listening, so
 *   the sim is untouched. `burst(id, at, options)` bursts one emitter.
 * - **This frame's shapes:** `emit(id, at, key)` runs an emitter at its `rate` for the frame (`key` names it, so its
 *   fractions carry over frames and its light flickers from its own phase), `telegraph(place)` draws a telegraph
 *   (engine/world/telegraphs.ts) at floor height, `trail(samples, tint)` a ribbon (an animator's trail), and
 *   `bolt(at, look)` a projectile's halo and hot core; `lights()` lists the frame's lights for the light pool (WP
 *   7.1): a running emitter's, flickering and pulsing as shardfall's object lights do, and the first bolts'.
 * - **Camera shake:** `shake` (engine/gfx/fx/shake.ts): `shake.apply(camera)` after placing the camera,
 *   `shake.restore(camera)` after drawing.
 * Randomness comes from the visual streams it is given (`fxRng`, the sim world's `w.fxRng`: never hashed).
 *
 * Budgets (`FX_BUDGET`): the pools are made at their full size before the warm-up and never grow: 4,096 particles
 * and 1,024 glows (sprites in pages of 1,024), 1,024 decals, 32 ribbons, so a frame costs at most 7 draw calls and
 * builds no pipeline. Past a budget, particles are not born and sprites, decals and ribbons are left out, and `stats()`
 * counts them. `register(warmup)` registers every pool with the warm-up.
 *
 * With `enabled` false it draws nothing, draws no random number and plays no event (the trace is still read, so turning
 * it on again plays only what comes next).
 *
 * Carried from `my-3d2dge:src/stress-world/35-effects.js:81-131` (`drawEffects`: telegraphs, trails, bolts with the
 * first four lit, particles) and `engine/my-3d2dge.js:1569-1580` (`hitFx`), with shardfall's event bursts and object
 * lights (`shardfall:crates/pav_view/src/fx.rs:264-276, 290-480`).
 *
 * Invariants: presentation only: it reads what it is given and writes only its own objects; equal calls, streams and
 * frames give equal pictures; every object it makes is under `root`.
 *
 * @example
 * import { PerspectiveCamera } from 'three/webgpu';
 * const fx = createEffects();
 * fx.event('hit', { position: [0, 1, 0], size: 1 }); // sparks and a star
 * fx.frame(1 / 60, new PerspectiveCamera());
 * fx.stats().particles.live; // 17
 * @see engine/gfx/fx/effects.test.ts
 * @see tests/e2e/fx.spec.ts
 */
import { Group, type Camera } from 'three/webgpu';
import { toLinear } from '../../core/color';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { RngStreams, type Rng } from '../../core/rng';
import { getTelegraph, pointOf, type PointLike, type TelegraphPlace } from '../../world/telegraphs';
import type { Warmup } from '../warmup';
import { createDecals } from './decals';
import { emitterKind, getEmitter, lightLevel, particleSpec, type Emitter, type FxLight } from './emitters';
import { ParticlePool, type BurstOptions, type ParticleStats } from './particles';
import { createRibbons, type TrailSampleLike } from './ribbons';
import { ScreenShake } from './shake';
import { createSprites } from './sprites';

/** The pools' sizes: see the file comment. */
export const FX_BUDGET = { particles: 4096, glows: 1024, decals: 1024, ribbons: 32, boltLights: 4 } as const;

/** How a bolt looks: the Stress test's hero bolt by default. */
export const BOLT = { color: '#ffb347', core: '#fff3c4', halo: 0.3125, radius: 0.125, light: 10, reach: 2.5 } as const;

/** What an event carries for its effects (any other keys are left alone). */
export interface FxEventPayload {
  /** Where it happens (m), or its `x`, `y`, `z`. */
  position?: PointLike;
  x?: number;
  y?: number;
  z?: number;
  /** Scales the burst: an explosion's radius, a body's size (1). */
  size?: number;
  /** Added to the particles' velocity (m/s). */
  velocity?: PointLike;
  /** Replaces the particles' colours, hex. */
  color?: string;
  /** The floor's height landing particles bounce on (the position's height). */
  ground?: number;
}

/** What `createEffects` takes. */
export interface EffectsOptions {
  /** The visual streams: the sim world's (`(...keys) => w.fxRng(...keys)`); seed 1's by default. */
  fxRng?: (...keys: readonly (string | number)[]) => Rng;
  /** The registry of the emitters and telegraphs; the shared one by default. */
  registry?: Registry;
}

/** What `stats()` reports. */
export interface FxStats {
  particles: ParticleStats;
  sprites: number;
  decals: number;
  ribbons: number;
  /** Sprites, decals and ribbons left out this frame: over their budgets. */
  skipped: number;
  /** Draw calls this frame. */
  drawCalls: number;
  /** Events played since it was made. */
  events: number;
}

/** The effects of a view: see the file comment. */
export interface Effects {
  readonly root: Group;
  enabled: boolean;
  readonly shake: ScreenShake;
  burst(id: string, at: PointLike, options?: BurstOptions & { size?: number }): number;
  event(type: string, payload?: FxEventPayload): number;
  feed(trace: readonly { seq: number; type: string; payload: unknown }[]): number;
  emit(id: string, at: PointLike, key: string | number): void;
  telegraph(place: TelegraphPlace): void;
  trail(samples: readonly TrailSampleLike[], tint: string): void;
  bolt(at: PointLike, look?: { color?: string; core?: string; size?: number }): void;
  /** Moves the effects `dt` seconds on and draws them as `camera` sees them; then the frame's shapes are cleared. */
  frame(dt: number, camera: Camera): void;
  lights(): FxLight[];
  drawCalls(): number;
  stats(): FxStats;
  register(warmup: Pick<Warmup, 'register'>): { dispose(): void };
  /** Forgets everything running (particles, rings, emitters, shake, the trace read): the view's run started again. */
  reset(): void;
  dispose(): void;
}

/** A floor ring growing and fading: a burst's shockwave. */
interface Ring {
  at: [number, number, number];
  r0: number;
  r1: number;
  width: number;
  rgb: number[];
  alpha: number;
  life: number;
  age: number;
}

/** A bolt of this frame: where, its colour (hex and linear), its core's and its size. */
interface Bolt {
  at: [number, number, number];
  hex: string;
  color: number[];
  core: number[];
  size: number;
}

/** Makes the effects; see the file comment. */
export function createEffects(options: EffectsOptions = {}): Effects {
  const registry = options.registry ?? sharedRegistry;
  emitterKind(registry);
  const streams = new RngStreams(1);
  const fxRng = options.fxRng ?? ((...keys) => streams.stream(...keys));
  const pool = new ParticlePool(FX_BUDGET.particles);
  const sprites = createSprites({ capacity: FX_BUDGET.particles + FX_BUDGET.glows });
  const decals = createDecals({ capacity: FX_BUDGET.decals });
  const ribbons = createRibbons({ capacity: FX_BUDGET.ribbons });
  const shake = new ScreenShake();
  const root = new Group();
  root.name = 'fx';
  root.add(decals.batch.root, ribbons.mesh, sprites.batch.root);
  const rings: Ring[] = [];
  const running = new Map<string, { carry: number; seed: number }>();
  let queued = { emits: [] as [Emitter, number[], string][], places: [] as TelegraphPlace[] };
  let shapes = { trails: [] as [readonly TrailSampleLike[], number[]][], bolts: [] as Bolt[] };
  let frameLights: FxLight[] = [];
  let [time, seen, played] = [0, -Infinity, 0];
  let answers: { size: number; byType: Map<string, Emitter[]> } = { size: -1, byType: new Map() };

  /** The emitters answering each event type, rebuilt when the kind's entries change. */
  function answering(type: string): readonly Emitter[] {
    const list = registry.list('emitter') as unknown as Emitter[];
    if (list.length !== answers.size) {
      const byType = new Map<string, Emitter[]>();
      for (const e of list) for (const t of e.events) byType.set(t, [...(byType.get(t) ?? []), e]);
      answers = { size: list.length, byType };
    }
    return answers.byType.get(type) ?? [];
  }

  /** Bursts `entry` at `at` (m), scaled by `size`: its particles, layers, shake and ring; returns particles born. */
  function burstEntry(entry: Emitter, at: number[], size: number, extra: BurstOptions): number {
    const options: BurstOptions = { ...extra, scale: size, ground: extra.ground ?? at[1] };
    const more = Math.min(4, Math.max(0.25, size));
    const place = (offset: readonly number[]) => at.map((v, k) => v + (entry.offset[k] + offset[k]) * size);
    let born = 0;
    const counted = (count: number) => (count > 0 ? Math.max(1, Math.round(count * more)) : 0);
    born += pool.burst(particleSpec(entry), counted(entry.count), place([0, 0, 0]), fxRng('fx'), options);
    for (const layer of entry.layers) {
      const spec = particleSpec(getEmitter(layer.emitter, registry), layer.set);
      born += pool.burst(spec, counted(layer.count), place(layer.offset), fxRng('fx'), options);
    }
    shake.add(entry.shake * size);
    const ring = entry.ring;
    if (ring.radius[1] > 0 && rings.length < FX_BUDGET.decals) {
      const [r0, r1] = [ring.radius[0] * size, ring.radius[1] * size];
      rings.push({
        at: [at[0], options.ground!, at[2]],
        r0,
        r1,
        width: ring.width * size,
        rgb: toLinear(ring.color),
        alpha: ring.alpha,
        life: ring.life,
        age: 0,
      });
    }
    return born;
  }

  /** The burst options of an event payload. */
  function payloadOptions(payload: FxEventPayload): BurstOptions {
    const options: BurstOptions = {};
    if (payload.velocity) options.velocity = pointOf(payload.velocity);
    if (payload.color) options.color = [toLinear(payload.color), toLinear(payload.color)];
    if (typeof payload.ground === 'number') options.ground = payload.ground;
    return options;
  }

  /** Where an event payload happens, or null. */
  function whereOf(payload: FxEventPayload | undefined): number[] | null {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.position) return pointOf(payload.position);
    const { x, y, z } = payload;
    return typeof x === 'number' && typeof z === 'number' ? [x, typeof y === 'number' ? y : 0, z] : null;
  }

  const fx: Effects = {
    root,
    enabled: true,
    shake,
    burst(id, at, burstOptions = {}) {
      if (!fx.enabled) return 0;
      return burstEntry(getEmitter(id, registry), pointOf(at), burstOptions.size ?? 1, burstOptions);
    },
    event(type, payload) {
      const at = whereOf(payload);
      const entries = answering(type);
      if (!fx.enabled || !at || !entries.length) return 0;
      played++;
      let born = 0;
      for (const entry of entries) born += burstEntry(entry, at, payload?.size ?? 1, payloadOptions(payload!));
      return born;
    },
    feed(trace) {
      let n = 0;
      for (const record of trace) {
        if (record.seq <= seen) continue;
        seen = record.seq;
        if (fx.enabled && whereOf(record.payload as FxEventPayload) && answering(record.type).length) n++;
        fx.event(record.type, record.payload as FxEventPayload);
      }
      return n;
    },
    emit(id, at, key) {
      if (fx.enabled) queued.emits.push([getEmitter(id, registry), pointOf(at), String(key)]);
    },
    telegraph(place) {
      if (fx.enabled) queued.places.push(place);
    },
    trail(samples, tint) {
      if (fx.enabled) shapes.trails.push([samples, toLinear(tint)]);
    },
    bolt(at, look = {}) {
      if (!fx.enabled) return;
      const hex = look.color ?? BOLT.color;
      shapes.bolts.push({
        at: pointOf(at),
        hex,
        color: toLinear(hex),
        core: toLinear(look.core ?? BOLT.core),
        size: look.size ?? 1,
      });
    },
    frame(dt, camera) {
      time += dt;
      frameLights = [];
      if (fx.enabled) {
        for (const [entry, at, key] of queued.emits) {
          let state = running.get(key);
          if (!state) running.set(key, (state = { carry: 0, seed: fxRng('fx', 'emit', key).range(0, 100) }));
          state.carry += entry.rate * dt;
          const n = Math.floor(state.carry);
          state.carry -= n;
          if (n > 0)
            pool.burst(
              particleSpec(entry),
              n,
              at.map((v, k) => v + entry.offset[k]),
              fxRng('fx'),
              { ground: at[1] },
            );
          if (entry.light.intensity > 0) {
            const [x, y, z] = at.map((v, k) => v + entry.light.offset[k]);
            const { color, distance } = entry.light;
            frameLights.push({
              position: [x, y, z],
              color,
              intensity: lightLevel(entry.light, time, state.seed),
              distance,
              decay: 2,
            });
          }
        }
        pool.update(dt, time);
      } else pool.clear();
      shake.update(dt);
      sprites.begin(camera);
      sprites.particles(pool);
      shapes.bolts.forEach(({ at, hex, color, core, size }, i) => {
        sprites.glow(
          at[0],
          at[1],
          at[2],
          BOLT.halo * size,
          color.map((c) => c * 0.5),
        );
        sprites.glow(at[0], at[1], at[2], BOLT.radius * size, core);
        if (i >= FX_BUDGET.boltLights) return;
        frameLights.push({ position: [...at], color: hex, intensity: BOLT.light, distance: BOLT.reach, decay: 2 });
      });
      sprites.end();
      decals.begin();
      for (const place of queued.places) decals.telegraph(getTelegraph(place.telegraph, registry), place);
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.age += dt;
        if (ring.age >= ring.life || !fx.enabled) rings.splice(i, 1);
      }
      for (const ring of rings) {
        const u = ring.age / ring.life;
        const r = ring.r0 + (ring.r1 - ring.r0) * (1 - (1 - u) * (1 - u));
        const fade = ring.alpha * (1 - u);
        decals.sector(
          ring.at,
          0,
          Math.max(0, r - ring.width / 2),
          r + ring.width / 2,
          Math.PI,
          r + ring.width / 2,
          ring.rgb,
          fade,
          0,
        );
      }
      decals.end();
      ribbons.begin();
      for (const [samples, rgb] of shapes.trails) ribbons.add(samples, rgb);
      ribbons.end();
      queued = { emits: [], places: [] };
      shapes = { trails: [], bolts: [] };
    },
    lights: () => frameLights.map((light) => ({ ...light, position: [...light.position] })),
    drawCalls: () => sprites.batch.drawCalls() + decals.batch.drawCalls() + (ribbons.count > 0 ? 1 : 0),
    stats: () => ({
      particles: pool.stats(),
      sprites: sprites.batch.count,
      decals: decals.batch.count,
      ribbons: ribbons.count,
      skipped: sprites.skipped + decals.skipped + ribbons.skipped,
      drawCalls: fx.drawCalls(),
      events: played,
    }),
    register(warmup) {
      const held = [
        sprites.batch.register(warmup, 'fx:sprites'),
        decals.batch.register(warmup, 'fx:decals'),
        warmup.register('fx:ribbons', { objects: () => [ribbons.mesh] }),
      ];
      return { dispose: () => held.forEach((registration) => registration.dispose()) };
    },
    reset() {
      pool.clear();
      rings.length = 0;
      running.clear();
      queued = { emits: [], places: [] };
      shapes = { trails: [], bolts: [] };
      frameLights = [];
      [shake.amount, seen] = [0, -Infinity];
    },
    dispose() {
      sprites.dispose();
      decals.dispose();
      ribbons.dispose();
      root.removeFromParent();
    },
  };
  return fx;
}
