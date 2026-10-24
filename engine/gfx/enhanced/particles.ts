/**
 * @file GPU particles (PLAN.md WP 11.3, §5.8; ADR-0025 amendment 32): the technique `feature:gpuParticles`, a ring of
 * `GPU_RING.slots` particles the GPU moves and draws, decorative only, for the emitters that ask for it (`gpu`,
 * engine/gfx/fx/emitters.ts) while the feature is on; the CPU pool (engine/gfx/fx/particles.ts) takes them otherwise.
 * - **Births on the CPU,** as shardfall's are: a burst is written by the CPU pool's own writer (`planBurst`,
 *   `writeParticle`: the same floats, the same draws) into a births buffer, each particle given the ring's next slot,
 *   the oldest overwritten once the ring is full; at most `GPU_RING.births` between two steps, the rest dropped and
 *   counted. Only the CPU writes the births buffer and only the GPU the ring, so no upload can undo a step.
 * - **The step in compute** (`instancedArray`, `Fn().compute`), over the slots ever used: a slot born since the last
 *   step takes its birth, then each moves as the CPU pool moves its particles (age, gravity, drag, the swirl, the move,
 *   the bounce). `update(dt, time)` asks for it; the post chain runs it (`step`) before it draws, once a frame.
 * - **The drawing** (shardfall's particle_draw.wgsl, as engine/gfx/fx/sprites.ts draws the CPU's): camera-facing soft
 *   discs, a stretching particle a streak along its velocity as the camera sees it, premultiplied so adding and
 *   covering particles share one blend (One, OneMinusSrcAlpha); unlit, unfogged, never writing depth. The chain draws
 *   `scene` in a pass of its own over the scene's light (engine/gfx/post/chain.ts), never in the scene pass, so it
 *   writes no normal and no flag (r182 has no write mask a target) and stays out of the ID pass; there it is tested
 *   by hand against the scene pass's depth (`depth(texture, true)`), in a plain frame against the screen's own.
 * - **Counted on the CPU:** each slot's death (its birth plus what was left of its life) says which live, with no
 *   readback; `bounds()` estimates where they are from their births (no drag, swirl or bounce).
 *
 * Carried from `shardfall:crates/pav_render/src/fx.rs:425-658` (the ring, births on the CPU, one premultiplied blend,
 * no normal writes) and `shaders/particle_update.wgsl`, `particle_draw.wgsl` (the step and the drawing).
 *
 * Invariants: presentation only, never in the hash, nothing read back from the GPU; the ring and the births buffer are
 * made once at their full size; nothing but engine/gfx/features.ts hands it out.
 *
 * @example
 * import { Rng } from '../../core/rng';
 * import { getEmitter, particleSpec } from '../fx/emitters';
 * const ring = createGpuParticles({ slots: 1024 });
 * ring.burst(particleSpec(getEmitter('emitter:rain')), 100, [0, 10, 0], new Rng(1));
 * ring.update(1 / 60, 0); // the GPU moves them at the chain's next step
 * ring.stats().live; // 100
 * @see engine/gfx/enhanced/particles.test.ts
 * @see tests/e2e/enhanced-particles.spec.ts
 */
import { CustomBlending, DepthTexture, Mesh, MeshBasicNodeMaterial, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Scene, type ComputeNode, type Texture } from 'three/webgpu'; // prettier-ignore
import { cameraWorldMatrix, clamp, cos, depth, Discard, dot, float, Fn, If, instancedArray, instanceIndex, int, length, max, mix, positionGeometry, pow, renderGroup, Return, screenUV, select, sin, texture, uint, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'; // prettier-ignore
import { defineCodes } from '../../core/log';
import type { Rng } from '../../core/rng';
import type { ParticleSpec } from '../fx/emitters';
import { PARTICLE_FLOATS as F, PARTICLE_STRIDE, planBurst, writeParticle } from '../fx/particles';
import type { BurstOptions, ParticleStats } from '../fx/particles';
import { STREAK } from '../fx/sprites';

/** Its advice code, raised by the feature registry when it is off. */
export const PARTICLES_CODES = defineCodes('gfx', {
  GFX_NO_GPU_PARTICLES: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) while GPU particles are off: the emitters that ask for them burst into the CPU pool.',
  },
});

/**
 * The ring's numbers: its slots, the most births between two steps, the step's workgroup, the floor of none, and its
 * budget, the GPU milliseconds a frame a downpour may add (WP 11.2's `gpuMs`) on a desktop GPU, which the owner's
 * playtest checks (docs/PLAYGROUND.md §9.3): SwiftShader's GPU time is a CPU's, ranking nothing (ADR-0022).
 */
export const GPU_RING = { slots: 65_536, births: 16_384, workgroup: 64, noFloor: -1e9, budgetMs: 1 } as const;

/** Its feature entry (engine/gfx/features.ts registers it). */
export const PARTICLES_FEATURE = {
  id: 'feature:gpuParticles',
  description:
    'GPU particles: a ring of 65,536 the GPU moves in compute and draws in a pass of its own, for the emitters that ask for them, rain and dust (engine/gfx/enhanced/particles.ts).',
  limits: { maxStorageBufferBindingSize: 6_291_456 }, // the ring: 65,536 slots of 96 bytes
  advice: 'GFX_NO_GPU_PARTICLES',
  downgrade: 'the emitters that ask for GPU particles burst into the CPU pool, at most 4,096 at once, the rest dropped',
} as const;

/** What the ring did: the CPU pool's counts, with the live ones a newer birth overwrote. */
export interface GpuParticleStats extends ParticleStats {
  /** Live particles overwritten by newer ones: the ring was full. */
  recycled: number;
}

/** What runs the step: the renderer, as far as the ring uses it. */
export interface ParticleCompute {
  compute(node: ComputeNode, count?: number): unknown;
}

/** GPU particles (see the file comment). */
export interface GpuParticles {
  /** What the chain's particle pass draws: the ring's one mesh. */
  readonly scene: Scene;
  readonly mesh: Mesh;
  /** How many particles it holds at once. */
  readonly slots: number;
  /** Whether any particle may still live: the chain draws its pass only then. */
  readonly live: boolean;
  /** Bursts `count` particles of `spec` at `origin` (m), drawing from `rng` as the CPU pool does; returns those born. */
  burst(spec: ParticleSpec, count: number, origin: readonly number[], rng: Rng, options?: BurstOptions): number;
  /** Moves them `dt` seconds on at presentation time `time` (s), at the next `step`. */
  update(dt: number, time: number): void;
  /** Runs the step asked for since the last one (the births, then the move); the chain calls it before it draws. */
  step(renderer: ParticleCompute): void;
  /** The depth to test against by hand: the scene pass's (`test` true), or none (the target's own depth test). */
  depth(texture: Texture | null, test: boolean): void;
  /** Draws every slot used, live or not, at least one, while `on`: the warm frame builds its pipelines so. */
  warm(on: boolean): void;
  /** The births waiting for the next step, `PARTICLE_STRIDE` floats each: what the step copies into the ring. */
  waiting(): Float32Array;
  /** The box round every live particle, estimated from its birth; null when none lives. */
  bounds(): { min: [number, number, number]; max: [number, number, number] } | null;
  stats(): GpuParticleStats;
  /** Forgets every particle. */
  clear(): void;
  dispose(): void;
}

/** Floats a slot keeps: the CPU pool's stride, as six vec4. */
const VEC4S = PARTICLE_STRIDE / 4;
/** What the CPU keeps of each slot's birth for `bounds()`: x, y, z, vx, vy, vz, gravity, floor, and when (s). */
const KEPT = 9;

/** Makes the ring (see the file comment): `slots` particles, at most `births` born between two steps. */
export function createGpuParticles(options: { slots?: number; births?: number } = {}): GpuParticles {
  const slots = Math.max(1, Math.floor(options.slots ?? GPU_RING.slots));
  const most = Math.max(1, Math.min(slots, Math.floor(options.births ?? GPU_RING.births)));
  const ring = instancedArray(slots * VEC4S, 'vec4').setName('particleRing');
  const births = instancedArray(most * VEC4S, 'vec4').setName('particleBirths');
  const born = births.value.array as Float32Array;
  const kept = new Float64Array(slots * KEPT); // each slot's birth as bounds() reads it (`KEPT`)
  const deaths = new Float64Array(slots); // each slot's death, in the ring's time
  const u = {
    dt: uniform(0).setGroup(renderGroup),
    time: uniform(0).setGroup(renderGroup),
    used: uniform(0, 'uint').setGroup(renderGroup),
    head: uniform(0, 'uint').setGroup(renderGroup),
    born: uniform(0, 'uint').setGroup(renderGroup),
    test: uniform(0).setGroup(renderGroup),
  };
  let [head, used, pending, now, last] = [0, 0, 0, 0, -Infinity];
  let asked: { dt: number; time: number } | null = null;
  let [count, dropped, recycled, warming] = [0, 0, 0, false];

  const step = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(u.used), () => {
      Return();
    });
    const at = (k: number) => ring.element(i.mul(VEC4S).add(k));
    const rel = i.add(uint(slots)).sub(u.head).mod(uint(slots)); // its place among the births since the last step
    const [a, b] = [vec4().toVar(), vec4().toVar()];
    If(rel.lessThan(u.born), () => {
      const from = (k: number) => births.element(rel.mul(VEC4S).add(k));
      for (let k = 2; k < VEC4S; k++) at(k).assign(from(k));
      a.assign(from(0));
      b.assign(from(1));
    }).Else(() => {
      a.assign(at(0));
      b.assign(at(1));
    });
    If(b.z.greaterThanEqual(b.w), () => {
      Return(); // dead
    });
    const age = b.z.add(u.dt);
    If(age.greaterThanEqual(b.w), () => {
      at(1).assign(vec4(b.x, b.y, age, b.w)); // its life ends at this step, as the CPU pool removes it
      Return();
    });
    const c = at(2); // sizes at birth and death, gravity, drag
    const e = at(3); // turbulence, floor, bounce, the birth colour's red
    const v = vec3(a.w, b.x.sub(c.z.mul(u.dt)), b.y)
      .mul(max(float(1).sub(c.w.mul(u.dt)), 0))
      .toVar();
    const swirl = e.x.mul(u.dt);
    If(swirl.greaterThan(0), () => {
      const swirled = vec3(
        sin(a.y.mul(1.7).add(u.time.mul(1.3)).add(a.z.mul(0.7))),
        sin(a.z.mul(1.9).add(u.time.mul(1.1)).add(a.x.mul(0.8))).mul(0.5),
        cos(a.x.mul(1.5).add(u.time.mul(1.7)).add(a.y.mul(0.9))),
      );
      v.addAssign(swirled.mul(swirl));
    });
    const p = a.xyz.add(v.mul(u.dt)).toVar();
    If(p.y.lessThan(e.y), () => {
      p.assign(vec3(p.x, e.y, p.z));
      v.assign(vec3(v.x.mul(0.7), v.y.mul(e.z).negate(), v.z.mul(0.7)));
    });
    at(0).assign(vec4(p, v.x));
    at(1).assign(vec4(v.y, v.z, age, b.w));
  })()
    .compute(slots, [GPU_RING.workgroup])
    .setName('Move the particles');

  const sceneDepth = texture(new DepthTexture(1, 1));
  const material = particleMaterial(ring, sceneDepth, u.test);
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  Object.assign(mesh, { name: 'fx:gpuParticles', frustumCulled: false });
  mesh.count = 0;
  const scene = new Scene();
  scene.add(mesh);
  const draw = () => (mesh.count = warming ? Math.max(1, used) : last > now ? used : 0);

  return {
    scene,
    mesh,
    slots,
    get live() {
      return last > now || pending > 0;
    },
    burst(spec, n, origin, rng, burstOptions = {}) {
      const want = Math.max(0, Math.round(n));
      const room = Math.min(want, most - pending);
      dropped += want - room;
      const plan = planBurst(spec, origin, burstOptions);
      for (let i = 0; i < room; i++) {
        const o = (pending + i) * PARTICLE_STRIDE;
        writeParticle(born, o, spec, plan, rng);
        if (born[o + F.floor] === -Infinity) born[o + F.floor] = GPU_RING.noFloor;
        const slot = (head + pending + i) % slots;
        if (deaths[slot] > now) recycled++;
        deaths[slot] = now + born[o + F.life] - born[o + F.age];
        last = Math.max(last, deaths[slot]);
        for (const [to, from] of [F.x, F.y, F.z, F.vx, F.vy, F.vz, F.gravity, F.floor].entries()) kept[slot * KEPT + to] = born[o + from]; // prettier-ignore
        kept[slot * KEPT + 8] = now;
      }
      if (room > 0) {
        births.value.addUpdateRange(pending * PARTICLE_STRIDE, room * PARTICLE_STRIDE);
        births.value.needsUpdate = true;
      }
      pending += room;
      count += room;
      return room;
    },
    update(dt, time) {
      now += dt;
      asked = { dt: (asked?.dt ?? 0) + dt, time };
    },
    step(renderer) {
      if (!asked && !warming) return;
      used = Math.min(slots, used + pending);
      [u.dt.value, u.time.value, u.used.value, u.head.value, u.born.value] = [asked?.dt ?? 0, asked?.time ?? 0, used, head, pending]; // prettier-ignore
      if (used > 0 || warming) renderer.compute(step, Math.max(1, used));
      head = (head + pending) % slots;
      [pending, asked] = [0, null];
      draw();
    },
    depth(target, test) {
      if (target) sceneDepth.value = target;
      u.test.value = test ? 1 : 0;
    },
    warm(on) {
      warming = on;
      draw();
    },
    waiting: () => born.subarray(0, pending * PARTICLE_STRIDE),
    bounds() {
      if (!(last > now)) return null;
      const box = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] }; // prettier-ignore
      for (let slot = 0; slot < slots; slot++) {
        if (!(deaths[slot] > now)) continue;
        const k = slot * KEPT;
        const t = now - kept[k + 8]; // the seconds it has moved since its birth
        const y = Math.max(kept[k + 7], kept[k + 1] + kept[k + 4] * t - 0.5 * kept[k + 6] * t * t);
        [kept[k] + kept[k + 3] * t, y, kept[k + 2] + kept[k + 5] * t].forEach((value, axis) => {
          box.min[axis] = Math.min(box.min[axis], value);
          box.max[axis] = Math.max(box.max[axis], value);
        });
      }
      return box;
    },
    stats: () => ({ live: livesIn(deaths, now), capacity: slots, born: count, dropped, recycled }),
    clear() {
      deaths.fill(0);
      [now, last, pending, asked, head, used] = [0, -Infinity, 0, null, 0, 0];
      mesh.count = 0;
    },
    dispose() {
      step.dispose();
      mesh.geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

/** How many of `deaths` are after `now`. */
function livesIn(deaths: Float64Array, now: number): number {
  let live = 0;
  for (const death of deaths) if (death > now) live++;
  return live;
}

/**
 * The drawing's material (see the file comment): each instance one slot of `ring`, a disc or a streak round its
 * position, discarded behind the scene's depth while `test` is 1.
 */
function particleMaterial(
  ring: ReturnType<typeof instancedArray>,
  sceneDepth: ReturnType<typeof texture>,
  test: ReturnType<typeof uniform<number>>,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  Object.assign(material, {
    name: 'fx:gpuParticle',
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const at = (k: number) => ring.element(instanceIndex.mul(VEC4S).add(k));
  const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map(at);
  const age = clamp(b.z.div(max(b.w, 1e-4)), 0, 1);
  const size = mix(c.x, c.y, age);
  const [right, up] = [cameraWorldMatrix.element(int(0)).xyz, cameraWorldMatrix.element(int(1)).xyz];
  const seen = vec2(dot(vec3(a.w, b.x, b.y), right), dot(vec3(a.w, b.x, b.y), up)); // its velocity as the camera sees it
  const speed = length(seen);
  const streak = f.w.greaterThanEqual(1.5).and(speed.greaterThan(1e-3));
  const way = seen.div(max(speed, 1e-3));
  const along = right.mul(way.x).add(up.mul(way.y));
  const across = right.mul(way.y.negate()).add(up.mul(way.x));
  const ax = select(streak, along.mul(size.add(speed.mul(STREAK))), right.mul(size));
  const ay = select(streak, across.mul(size.mul(0.45)), up.mul(size));
  const corner = positionGeometry.xy;
  material.positionNode = select(b.z.lessThan(b.w), a.xyz.add(ax.mul(corner.x)).add(ay.mul(corner.y)), a.xyz);
  const colour = mix(vec4(d.w, e.x, e.y, e.z), vec4(e.w, f.x, f.y, f.z), age);
  const light = colour.rgb.mul(colour.a).toVarying('vParticleLight');
  const cover = select(f.w.mod(2).greaterThan(0.5), float(0), colour.a).toVarying('vParticleCover');
  const p = uv().mul(2).sub(1);
  const disc = pow(max(float(1).sub(dot(p, p)), 0), 1.5);
  material.colorNode = light.mul(disc);
  material.opacityNode = Fn(() => {
    If(test.greaterThan(0.5).and(depth.greaterThan(sceneDepth.sample(screenUV).r)), () => {
      Discard();
    });
    return cover.mul(disc);
  })();
  return material;
}
