/**
 * @file CPU particles (PLAN.md WP 6.4, §6.4's view state): `ParticlePool` holds up to `capacity` live particles in
 * flat arrays, bursts them from an emitter's `ParticleSpec` (engine/gfx/fx/emitters.ts) with a visual random stream
 * (`fxRng`: never the sim's), and moves them a rendered frame at a time. engine/gfx/fx/sprites.ts draws them.
 *
 * A burst of `count` at `origin`, as shardfall bursts its presets: each particle starts in the spec's `area` around
 * the origin, at its `velocity` plus up to `spread` m/s in a direction drawn evenly in the unit ball, plus the
 * caller's `velocity`; it lives between the spec's shortest and longest life. A landing spec bounces at `ground` (the
 * origin's height when not given) plus its `floor`. `scale` multiplies the area, spread and sizes, so an event's size
 * makes a bigger burst. A `prewarm` spec's particles are born already flying (ages spread over it, drag and
 * turbulence left out). Each frame, `update(dt, time)`: gravity, drag (the share `drag × dt` of the speed lost),
 * turbulence (shardfall's swirl of sines in position and time), the move, and the bounce (the fall reversed times
 * `bounce`, the slide kept at 0.7); a particle whose age reaches its life leaves.
 *
 * Budgets: a burst never grows the pool. Particles past `capacity` are not born and are counted (`dropped`), so a
 * crowded fight costs at most the pool, never a frame spike; `stats()` says how many live, were born and dropped.
 *
 * Births are written by `planBurst` and `writeParticle`, which the GPU's ring shares (engine/gfx/enhanced/
 * particles.ts, WP 11.3: the same floats, `PARTICLE_FLOATS`), so a burst gives the same particles on either.
 *
 * Carried from `shardfall:crates/pav_render/src/fx.rs:584-618` (births: area, the unit ball, prewarm) and
 * `shaders/particle_update.wgsl` (the step), on the CPU, with `my-3d2dge:engine/my-3d2dge.js:940-959` (`Particles`:
 * a capped list, swap-removal).
 *
 * Invariants: view state only (doctrine: WebGPU only): nothing here reads or writes the sim; draws only from the
 * stream it is given, so the same bursts, stream and frames give the same particles; particles are kept in slots
 * 0 to `count` − 1 (a leaving particle's slot takes the last one's).
 *
 * @example
 * import { Rng } from '../../core/rng';
 * import { getEmitter, particleSpec } from './emitters';
 * const pool = new ParticlePool(1024);
 * pool.burst(particleSpec(getEmitter('emitter:sparks')), 16, [0, 1, 0], new Rng(1));
 * pool.update(1 / 60, 0);
 * pool.count; // 16
 * @see engine/gfx/fx/particles.test.ts
 */
import type { Rng } from '../../core/rng';
import type { ParticleSpec } from './emitters';

/** How a burst differs from its spec. */
export interface BurstOptions {
  /** Added to every particle's velocity (m/s): a hit's direction. */
  velocity?: readonly number[];
  /** Multiplies the area, the spread and the sizes (1). */
  scale?: number;
  /** The ground a landing spec bounces on, plus its floor; the origin's height when left out. */
  ground?: number;
  /** Replaces the colours, keeping their brightness and opacity (birth, death), as linear RGB. */
  color?: readonly (readonly number[])[];
}

/** What a pool did. */
export interface ParticleStats {
  live: number;
  capacity: number;
  /** Born since the pool was made. */
  born: number;
  /** Not born because the pool was full. */
  dropped: number;
}

/** The box round live particles (m). */
export interface ParticleBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * What bursts the particles of an emitter whose entry says `gpu`, as the effects meet it: the GPU's ring
 * (engine/gfx/enhanced/particles.ts, WP 11.3), moved by `update` and counted by `stats` as the pool is.
 */
export interface ParticleRing {
  burst(spec: ParticleSpec, count: number, origin: readonly number[], rng: Rng, options?: BurstOptions): number;
  update(dt: number, time: number): void;
  bounds(): ParticleBounds | null;
  stats(): ParticleStats & { recycled: number };
  clear(): void;
}

/**
 * The floats a particle keeps, by name: offsets into its stride. The GPU's ring keeps the same (engine/gfx/enhanced/
 * particles.ts), so one writer births both.
 */
export const PARTICLE_FLOATS = {
  x: 0,
  y: 1,
  z: 2,
  vx: 3,
  vy: 4,
  vz: 5,
  age: 6,
  life: 7,
  s0: 8,
  s1: 9,
  gravity: 10,
  drag: 11,
  turbulence: 12,
  floor: 13,
  bounce: 14,
  c0: 15, // r, g, b, a
  c1: 19, // r, g, b, a
  flags: 23, // 1: additive, 2: stretch
} as const;
const F = PARTICLE_FLOATS;
/** Floats per particle. */
export const PARTICLE_STRIDE = 24;
/** No floor. */
const NO_FLOOR = -Infinity;

/** A particle as the drawing reads it. */
export interface ParticleView {
  /** Position (m) and velocity (m/s). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Radius (m), linear RGB, opacity, now. */
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  additive: boolean;
  stretch: boolean;
}

/** The CPU particle pool: see the file comment. */
export class ParticlePool {
  /** The most particles alive at once. */
  readonly capacity: number;
  /** Every particle's floats, `PARTICLE_STRIDE` a particle. */
  readonly data: Float64Array;
  /** Live particles: slots 0 to count − 1. */
  count = 0;
  #born = 0;
  #dropped = 0;

  /** A pool of `capacity` particles. */
  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.data = new Float64Array(this.capacity * PARTICLE_STRIDE);
  }

  /** Bursts `count` particles of `spec` at `origin` (m), drawing from `rng`; returns how many were born. */
  burst(spec: ParticleSpec, count: number, origin: readonly number[], rng: Rng, options: BurstOptions = {}): number {
    const n = Math.max(0, Math.round(count));
    const room = Math.min(n, this.capacity - this.count);
    this.#dropped += n - room;
    const plan = planBurst(spec, origin, options);
    for (let i = 0; i < room; i++) writeParticle(this.data, (this.count + i) * PARTICLE_STRIDE, spec, plan, rng);
    this.count += room;
    this.#born += room;
    return room;
  }

  /** Moves every particle `dt` seconds on, at presentation time `time` (s, for the swirl); see the file comment. */
  update(dt: number, time: number): void {
    const d = this.data;
    for (let i = this.count - 1; i >= 0; i--) {
      const o = i * PARTICLE_STRIDE;
      d[o + F.age] += dt;
      if (d[o + F.age] >= d[o + F.life]) {
        this.#remove(i);
        continue;
      }
      const keep = Math.max(1 - d[o + F.drag] * dt, 0);
      let vx = d[o + F.vx] * keep;
      let vy = (d[o + F.vy] - d[o + F.gravity] * dt) * keep;
      let vz = d[o + F.vz] * keep;
      const swirl = d[o + F.turbulence] * dt;
      if (swirl > 0) {
        const [x, y, z] = [d[o + F.x], d[o + F.y], d[o + F.z]];
        vx += Math.sin(y * 1.7 + time * 1.3 + z * 0.7) * swirl;
        vy += Math.sin(z * 1.9 + time * 1.1 + x * 0.8) * 0.5 * swirl;
        vz += Math.cos(x * 1.5 + time * 1.7 + y * 0.9) * swirl;
      }
      d[o + F.x] += vx * dt;
      d[o + F.y] += vy * dt;
      d[o + F.z] += vz * dt;
      if (d[o + F.y] < d[o + F.floor]) {
        d[o + F.y] = d[o + F.floor];
        vx *= 0.7;
        vy *= -d[o + F.bounce];
        vz *= 0.7;
      }
      d[o + F.vx] = vx;
      d[o + F.vy] = vy;
      d[o + F.vz] = vz;
    }
  }

  /** Particle `i` (0 to count − 1) as the drawing reads it, into `out`. */
  read(i: number, out: ParticleView): ParticleView {
    const d = this.data;
    const o = i * PARTICLE_STRIDE;
    const u = Math.min(1, d[o + F.age] / d[o + F.life]);
    const mix = (k: number) => d[o + F.c0 + k] + (d[o + F.c1 + k] - d[o + F.c0 + k]) * u;
    const flags = d[o + F.flags];
    out.x = d[o + F.x];
    out.y = d[o + F.y];
    out.z = d[o + F.z];
    out.vx = d[o + F.vx];
    out.vy = d[o + F.vy];
    out.vz = d[o + F.vz];
    out.size = d[o + F.s0] + (d[o + F.s1] - d[o + F.s0]) * u;
    out.r = mix(0);
    out.g = mix(1);
    out.b = mix(2);
    out.a = mix(3);
    out.additive = flags % 2 === 1;
    out.stretch = flags >= 2;
    return out;
  }

  /** The box round every live particle, each its size out from its middle and a streak `streak` × its speed more. */
  bounds(streak = 0): ParticleBounds | null {
    if (!this.count) return null;
    const box: ParticleBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const seen = {} as ParticleView;
    for (let i = 0; i < this.count; i++) {
      const { x, y, z, vx, vy, vz, size, stretch } = this.read(i, seen);
      const r = size + (stretch ? Math.hypot(vx, vy, vz) * streak : 0);
      [x, y, z].forEach((v, k) => ([box.min[k], box.max[k]] = [Math.min(box.min[k], v - r), Math.max(box.max[k], v + r)])); // prettier-ignore
    }
    return box;
  }

  /** Removes every particle. */
  clear(): void {
    this.count = 0;
  }

  /** How many live, were born and were dropped. */
  stats(): ParticleStats {
    return { live: this.count, capacity: this.capacity, born: this.#born, dropped: this.#dropped };
  }

  /** Removes particle `i`: the last one takes its slot. */
  #remove(i: number): void {
    const last = --this.count;
    if (i !== last) this.data.copyWithin(i * PARTICLE_STRIDE, last * PARTICLE_STRIDE, (last + 1) * PARTICLE_STRIDE);
  }
}

/** What every particle of one burst shares: its scale, origin, added velocity, floor and colours (`planBurst`). */
export interface BurstPlan {
  k: number;
  origin: readonly number[];
  add: readonly number[];
  floor: number;
  c0: readonly number[];
  c1: readonly number[];
}

/** The plan of a burst of `spec` at `origin` (m) as `options` change it (see the file comment). */
export function planBurst(spec: ParticleSpec, origin: readonly number[], options: BurstOptions = {}): BurstPlan {
  const [c0, c1] = options.color
    ? [0, 1].map((i) => [
        ...options.color![i].map((c) => c * brightest(i ? spec.c1 : spec.c0)),
        (i ? spec.c1 : spec.c0)[3],
      ])
    : [spec.c0, spec.c1];
  const floor = spec.lands ? (options.ground ?? origin[1]) + spec.floor : NO_FLOOR;
  return { k: options.scale ?? 1, origin, add: options.velocity ?? [0, 0, 0], floor, c0, c1 };
}

/**
 * Writes one particle of a burst into `d` from float `o` (a slot's first, `PARTICLE_STRIDE` floats), drawing from
 * `rng` in a fixed order: its place in the area, its direction in the unit ball, its life, and its age when prewarmed.
 */
export function writeParticle(
  d: Float32Array | Float64Array,
  o: number,
  spec: ParticleSpec,
  plan: BurstPlan,
  rng: Rng,
): void {
  const { k, origin, add, floor } = plan;
  d[o + F.x] = origin[0] + rng.range(-1, 1) * spec.area[0] * k;
  d[o + F.y] = origin[1] + rng.range(-1, 1) * spec.area[1] * k;
  d[o + F.z] = origin[2] + rng.range(-1, 1) * spec.area[2] * k;
  let [dx, dy, dz] = [1, 1, 1];
  while (dx * dx + dy * dy + dz * dz > 1) [dx, dy, dz] = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
  d[o + F.vx] = spec.velocity[0] + dx * spec.spread * k + add[0];
  d[o + F.vy] = spec.velocity[1] + dy * spec.spread * k + add[1];
  d[o + F.vz] = spec.velocity[2] + dz * spec.spread * k + add[2];
  const life = Math.max(0.01, spec.life[0] + (spec.life[1] - spec.life[0]) * rng.next());
  let age = 0;
  if (spec.prewarm > 0) {
    age = rng.next() * Math.min(spec.prewarm, life) * 0.95;
    d[o + F.x] += d[o + F.vx] * age;
    d[o + F.y] += d[o + F.vy] * age - 0.5 * spec.gravity * age * age;
    d[o + F.z] += d[o + F.vz] * age;
    d[o + F.vy] -= spec.gravity * age;
    d[o + F.y] = Math.max(d[o + F.y], floor);
  }
  d.set([age, life, spec.size[0] * k, spec.size[1] * k], o + F.age);
  d.set([spec.gravity, spec.drag, spec.turbulence, floor, spec.bounce], o + F.gravity);
  d.set(plan.c0, o + F.c0);
  d.set(plan.c1, o + F.c1);
  d[o + F.flags] = (spec.additive ? 1 : 0) + (spec.stretch ? 2 : 0);
}

/** The brightest channel of linear `rgba` (at least 1): what a replaced colour is multiplied by. */
function brightest(rgba: readonly number[]): number {
  return Math.max(1, rgba[0], rgba[1], rgba[2]);
}
