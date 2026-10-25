/**
 * @file Unit tests for secondary motion (engine/anim/secondary.ts, chain.ts), PLAN.md WP 6.2's Done when: chains are stable
 * at 60 and 120 Hz (they hang still, agree between the rates, survive violent anchors and settle again) and collide
 * with body capsules and the floor (a fixed capsule, a flat floor, a probed slope, and a hero's own capsules while
 * it runs, snaps round and spins). Also: the cape's width, flutter and back plane, the rest shape's stiffness, a
 * teleport, the squash's volume, and the layer as view state only, shown on a fixture hero (the box rule).
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { Animator } from './character';
import type { GroundHit } from './ik';
import type { MoveInput } from './moves-data';
import { bodyCapsules, BODY_CAPSULES, Secondary, SQUASH, squashScale } from './secondary';
import { Cape, CAPE, Chain, CHAIN, type BoneCapsule, type ChainOptions } from './chain';

const HAIR: ChainOptions = { n: 6, seg: 0.12, gravity: 12.5, drag: 3.66 };
const RATES = [60, 120] as const;
/** Whether `t` falls on a 60 Hz tick. */
const onTick = (t: number) => Math.abs(t * 60 - Math.round(t * 60)) < 1e-9;

/** Steps `chain` over `seconds` at `hz`, its anchor at `path(t)`; calls `each` after every step with the time. */
function run(chain: Chain, hz: number, seconds: number, path: (t: number) => Vector3, each?: (t: number) => void) {
  for (let k = 0; k <= Math.round(seconds * hz); k++) {
    chain.step(k === 0 ? 0 : 1 / hz, path(k / hz));
    each?.(k / hz);
  }
  return chain;
}

/** Each segment's length, metres. */
const lengths = (chain: Chain) => chain.points.slice(1).map((p, i) => p.distanceTo(chain.points[i]));

/** How deep `p` is inside `capsule` (below 0 outside), metres. */
function depth(p: Vector3, { a, b, radius }: BoneCapsule): number {
  const axis = b.clone().sub(a);
  const t = axis.lengthSq() > 0 ? Math.min(1, Math.max(0, p.clone().sub(a).dot(axis) / axis.lengthSq())) : 0;
  return radius - p.distanceTo(a.clone().addScaledVector(axis, t));
}

/** The tip of a `HAIR` chain on each 60 Hz tick over 3 s at `hz`, its anchor on `path`. */
function tips(hz: number, path: (t: number) => Vector3): Vector3[] {
  const chain = new Chain(HAIR);
  const out: Vector3[] = [];
  run(chain, hz, 3, path, (t) => onTick(t) && out.push(chain.points[5].clone()));
  return out;
}

const circle = (t: number) => new Vector3(Math.cos(2 * Math.min(t, 2)), 1.5, Math.sin(2 * Math.min(t, 2)));
const still = () => new Vector3(0, 2, 0);

describe('Chain: stable at 60 and 120 Hz', () => {
  it.each(RATES)('hangs straight down at rest, each segment within 1 %% of its length (%i Hz)', (hz) => {
    const chain = run(new Chain(HAIR), hz, 3, still);
    chain.points.forEach((p) => expect(Math.hypot(p.x, p.z)).toBeLessThan(1e-12));
    lengths(chain).forEach((length) => expect(Math.abs(length / HAIR.seg - 1)).toBeLessThan(0.01));
    const settled = chain.points.map((p) => p.clone());
    run(chain, hz, 1, still);
    chain.points.forEach((p, i) => expect(p.distanceTo(settled[i])).toBeLessThan(1e-9));
  });

  it('gives the same strand at 60 Hz as at 120 Hz: to rounding on a straight path, within 2 mm on a circle', () => {
    const line = (t: number) => new Vector3(Math.min(t, 1) * 3, 1.5, Math.min(t, 1) * -1);
    for (const [path, tolerance] of [
      [line, 1e-9],
      [circle, 0.002],
    ] as const) {
      const [a, b] = RATES.map((hz) => tips(hz, path));
      expect(a).toHaveLength(181);
      expect(Math.max(...a.map((p, i) => p.distanceTo(b[i])))).toBeLessThan(tolerance);
    }
  });

  it.each(RATES)('survives a violent anchor and settles again (%i Hz)', (hz) => {
    const rng = new Rng(3);
    const jolts = Array.from({ length: 120 }, () => new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)));
    const shake = (t: number) => (t < 2 ? jolts[Math.floor(t * 60)].clone().multiplyScalar(0.4).add(still()) : still());
    const chain = new Chain(HAIR);
    let longest = 0;
    run(chain, hz, 2, shake, () => {
      expect(chain.points.every((p) => Number.isFinite(p.x + p.y + p.z))).toBe(true);
      longest = Math.max(longest, ...lengths(chain));
    });
    expect(longest).toBeLessThanOrEqual(HAIR.seg * CHAIN.stretch + 1e-12);
    run(chain, hz, 2.5, still);
    expect(chain.points[5].distanceTo(new Vector3(0, 2 - 5 * HAIR.seg, 0))).toBeLessThan(0.01);
  });

  it('starts afresh on a teleport, a long gap or a clock going back', () => {
    const chain = run(new Chain(HAIR), 60, 1, circle);
    const far = new Vector3(9, 2, 0);
    for (const dt of [1 / 60, 1, -1 / 60]) {
      run(chain, 60, 0.5, circle);
      chain.step(dt, dt === 1 / 60 ? far : circle(0.5));
      const top = chain.points[0];
      chain.points.forEach((p, i) => expect(p.distanceTo(top.clone().setY(top.y - i * HAIR.seg))).toBeLessThan(1e-9));
      expect(chain.previous.every((p, i) => p.equals(chain.points[i]))).toBe(true);
    }
  });

  it('holds its rest shape by its stiffness, turning with the anchor; a rope hangs', () => {
    const rest = new Vector3(0, 0, -1);
    const frame = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // −Z turns to −X
    const stiff = new Chain({ n: 5, seg: 0.1, stiffness: 40, rest });
    const rope = new Chain({ n: 5, seg: 0.1, rest });
    for (let k = 0; k < 240; k++) [stiff, rope].forEach((c) => c.step(1 / 60, new Vector3(0, 1, 0), frame));
    expect(stiff.points[4].x).toBeLessThan(-0.3);
    expect(stiff.points[4].y).toBeGreaterThan(0.85);
    expect(rope.points[4].y).toBeCloseTo(0.6, 2);
  });

  it('throws ANIM_BAD_CHAIN for a chain that cannot hang', () => {
    expect(() => new Chain({ n: 1, seg: 0.1 })).toThrow(/ANIM_BAD_CHAIN.*n 1/);
    expect(() => new Chain({ n: 4, seg: 0 })).toThrow(/ANIM_BAD_CHAIN.*seg 0/);
    expect(() => new Chain({ n: 4, seg: 0.1, iterations: 0 })).toThrow(/ANIM_BAD_CHAIN.*iterations 0/);
  });
});

describe('Chain: collides with bone capsules and the floor', () => {
  it.each(RATES)('drapes over a capsule without entering it (%i Hz)', (hz) => {
    const bar: BoneCapsule = { a: new Vector3(-1, 1.6, 0), b: new Vector3(1, 1.6, 0), radius: 0.1 };
    const chain = new Chain(HAIR);
    chain.colliders = [bar];
    let worst = -Infinity;
    run(
      chain,
      hz,
      3,
      () => new Vector3(0, 1.8, 0.03),
      () => {
        for (const p of chain.points.slice(1)) worst = Math.max(worst, depth(p, bar));
      },
    );
    expect(worst).toBeLessThanOrEqual(-CHAIN.radius + 1e-9);
    expect(depth(chain.points[1], bar)).toBeGreaterThan(-CHAIN.radius - 0.01); // it rests on the bar…
    expect(chain.points[5].z).toBeGreaterThan(0.1); // …and hangs down its far side
  });

  it.each(RATES)('lies on a floor too close to hang free (%i Hz)', (hz) => {
    const chain = new Chain(HAIR);
    chain.floor = 0.2;
    run(
      chain,
      hz,
      3,
      (t) => new Vector3(Math.min(t, 1), 0.4, 0),
      () => {
        for (const p of chain.points.slice(1)) expect(p.y).toBeGreaterThanOrEqual(0.2 + CHAIN.radius - 1e-12);
      },
    );
    expect(chain.points[5].y).toBeCloseTo(0.2 + CHAIN.radius, 6);
  });

  it('lies on the ground a probe finds: a slope', () => {
    const slope = (x: number) => 0.3 * x;
    const normal = new Vector3(-0.3, 1, 0).normalize();
    const probe = (origin: Vector3, distance: number, hit: GroundHit) => {
      const ground = slope(origin.x);
      if (origin.y < ground || origin.y - distance > ground) return false;
      hit.point.set(origin.x, ground, origin.z);
      hit.normal.copy(normal);
      return true;
    };
    const chain = new Chain(HAIR);
    chain.floor = probe;
    run(
      chain,
      60,
      3,
      (t) => new Vector3(-Math.min(t, 1), 0.3, 0),
      () => {
        for (const p of chain.points.slice(1))
          expect((p.y - slope(p.x)) * normal.y).toBeGreaterThan(CHAIN.radius * 0.95);
      },
    );
  });
});

describe('Secondary: inspect', () => {
  it('shows the squash and each chain’s tip to 0.1 mm, and no cape where it has none', () => {
    const layer = new Secondary({ hair: 'long', cape: false, tail: true });
    const animator = new Animator({ build: 'build:heroic', clock: 0 }).use('secondary', layer);
    for (let k = 0; k < 12; k++) animator.update({ velocity: new Vector3(0, 0, 3) });
    const { tips } = layer.inspect() as { tips: Record<string, number[]> };
    expect(Object.keys(tips)).toEqual(['hair', 'tail']);
    for (const tip of Object.values(tips)) {
      expect(tip.some((x) => Math.abs(x) > 0.01)).toBe(true);
      expect(tip.every((x) => Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6)).toBe(true); // to 0.1 mm
    }
    const tip = layer.hair!.points[layer.hair!.n - 1].toArray();
    expect(tips.hair.every((x, i) => Math.abs(x - tip[i]) <= 5e-5)).toBe(true); // the tip's own place, rounded
  });
});

describe('Chain: one step as its parts', () => {
  it('steps as begin, its inner steps and as many constraint passes as its tuning says', () => {
    const [whole, parts] = [new Chain(HAIR), new Chain(HAIR)];
    for (let k = 0; k <= 30; k++) {
      const [dt, anchor] = [k ? 1 / 60 : 0, circle(k / 60)];
      whole.step(dt, anchor);
      const count = parts.begin(dt, anchor);
      for (let i = 1; i <= count; i++) {
        parts.integrate(dt / count, i / count, anchor, new Quaternion());
        for (let it = 0; it < parts.tuning.iterations; it++) parts.relax();
      }
    }
    expect(parts.points.map((p) => p.toArray())).toEqual(whole.points.map((p) => p.toArray()));
  });

  it('pushes a point that lies on a capsule’s axis straight up, out of it', () => {
    const chain = new Chain({ ...HAIR, gravity: 0 });
    chain.step(0, new Vector3(0, 2, 0)); // hanging straight down, at rest
    const on = chain.points[4].clone();
    const bar: BoneCapsule = {
      a: new Vector3(on.x - 1, on.y, on.z),
      b: new Vector3(on.x + 1, on.y, on.z),
      radius: 0.05,
    };
    chain.colliders = [bar];
    chain.step(1 / 60, new Vector3(0, 2, 0));
    expect(chain.points.every((p) => [p.x, p.y, p.z].every(Number.isFinite))).toBe(true);
    expect(chain.points[4].y).toBeGreaterThan(on.y); // up, not down through it
    expect(depth(chain.points[4], bar)).toBeLessThan(1e-9);
  });
});

describe('Cape', () => {
  const [left, right] = [new Vector3(0.15, 1.5, 0), new Vector3(-0.15, 1.5, 0)];

  it.each(RATES)('hangs its edges the width apart, wider toward the hem (%i Hz)', (hz) => {
    const cape = new Cape({ ...CAPE, flutter: 0 });
    for (let k = 0; k <= 3 * hz; k++) cape.step(k ? 1 / hz : 0, left, right);
    for (let i = 1; i < CAPE.n; i++) {
      const gap = cape.left.points[i].distanceTo(cape.right.points[i]);
      expect(gap).toBeCloseTo(CAPE.width * (1 + (CAPE.flare * i) / CAPE.n), 2);
    }
    lengths(cape.left).forEach((length) => expect(Math.abs(length / CAPE.seg - 1)).toBeLessThan(0.02));
  });

  it('flutters more at its hem than at its top', () => {
    const cape = new Cape(CAPE);
    const ys: number[][] = [];
    for (let k = 0; k <= 180; k++) {
      cape.step(k ? 1 / 60 : 0, left, right);
      if (k > 60) ys.push(cape.left.points.map((p) => p.y));
    }
    const swing = (i: number) => Math.max(...ys.map((y) => y[i])) - Math.min(...ys.map((y) => y[i]));
    expect(swing(5)).toBeGreaterThan(swing(1));
  });

  it('flutters its two edges out of step', () => {
    const cape = new Cape(CAPE);
    let most = 0;
    for (let k = 0; k <= 120; k++) {
      cape.step(k ? 1 / 60 : 0, left, right);
      most = Math.max(most, Math.abs(cape.left.points[5].y - cape.right.points[5].y));
    }
    expect(most).toBeGreaterThan(1e-4); // its mirror image would match it to rounding
  });
});

/** A hero's ground path: a circle of 2.5 m at 5 m/s for 2 s, a snap round, 0.5 s back, then standing still. */
function path(t: number): { position: Vector3; yaw: number; speed: number } {
  const turn = 2 * Math.min(t, 2);
  const position = new Vector3(2.5 * (1 - Math.cos(turn)), 0, 2.5 * Math.sin(turn));
  if (t <= 2) return { position, yaw: turn, speed: 5 };
  const yaw = 4 + Math.PI;
  const back = 5 * Math.min(t - 2, 0.5);
  return { position: position.add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(back)), yaw, speed: t < 2.5 ? 5 : 0 }; // prettier-ignore
}

/** A hero with hair, a cape and a tail at `hz` along `path` for 6 s, spinning at 2.5–3.2 s; `each` after each pose. */
function hero(hz: number, each: (animator: Animator, layer: Secondary, t: number) => void) {
  const animator = new Animator({ build: 'build:heroic', weapon: 'sword', rng: new Rng(5), dt: 1 / hz, clock: 0 });
  const layer = new Secondary({ hair: 'long', cape: true, tail: true });
  animator.use('secondary', layer);
  for (let k = 0; k <= 6 * hz; k++) {
    const t = k / hz;
    const { position, yaw, speed } = path(t);
    const velocity = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
    const spin: MoveInput | undefined = t > 2.5 && t < 3.2 ? { move: 'move:spin', phase: 'active', u: (t - 2.5) / 0.7 } : undefined; // prettier-ignore
    animator.update({ position, velocity, yaw, body: spin });
    each(animator, layer, t);
  }
}

describe('Secondary on a hero (the fixture)', () => {
  it.each(RATES)('keeps hair, cape and tail out of the body capsules and above the floor (%i Hz)', (hz) => {
    let worst = -Infinity;
    hero(hz, (animator, layer) => {
      for (const chain of [layer.hair, layer.cape?.left, layer.cape?.right, layer.tail]) {
        for (const p of chain?.points.slice(1) ?? []) {
          expect(p.y).toBeGreaterThanOrEqual(animator.body.position.y + CHAIN.radius - 1e-9);
          for (const capsule of layer.capsules) worst = Math.max(worst, depth(p, capsule));
        }
      }
    });
    expect(worst).toBeLessThan(0.005);
  });

  it('moves the same at 60 Hz as at 120 Hz: the tips within 3 cm running, and once settled', () => {
    const seen = RATES.map(() => [] as [number, Vector3][]);
    RATES.forEach((hz, r) =>
      hero(hz, (_, layer, t) => {
        if (!onTick(t) || (t > 2 && t < 5)) return; // a snap round and a spin fling them: chaos, either rate
        for (const chain of [layer.hair, layer.cape?.left, layer.cape?.right, layer.tail]) {
          if (chain) seen[r].push([t, chain.points[chain.n - 1].clone()]);
        }
      }),
    );
    const worst = Math.max(...seen[0].map(([, p], i) => p.distanceTo(seen[1][i][1])));
    expect(worst).toBeLessThan(0.03);
  });

  it('scales the root by the squash, keeping the volume; the spring springs back the same at 60 and 120 Hz', () => {
    const squash: number[][] = [[], []];
    RATES.forEach((hz, r) =>
      hero(hz, (animator, layer, t) => {
        if (Math.abs(t - 1) < 1e-9) layer.kick(20);
        const s = animator.body.pose.rootScale;
        expect(s.x * s.y * s.z).toBeCloseTo(1, 12);
        if (onTick(t)) squash[r].push(layer.squash);
      }),
    );
    expect(Math.max(...squash[0])).toBe(SQUASH.limit);
    squash[0].forEach((s, i) => expect(s).toBeCloseTo(squash[1][i], 2));
    expect(Math.abs(squash[0][120])).toBeLessThan(0.002);
    const s = squashScale(-0.2);
    expect([s.y, s.x * s.y * s.z]).toEqual([0.8, expect.closeTo(1, 12)]);
  });

  it('builds the capsules from the bones: trunk, shoulders, hips, limbs and the head', () => {
    const animator = new Animator({ build: 'build:bulky' }).update();
    const { build, world } = animator.body;
    const capsules = bodyCapsules(build, world);
    expect(capsules).toHaveLength(BODY_CAPSULES.length + 1);
    expect(capsules[0].radius).toBe(build.chestDepth / 2);
    expect(capsules.at(-1)?.radius).toBe(build.headRadius);
    expect(capsules.at(-1)?.a.y).toBeCloseTo(animator.socket('headTop').y - build.headRadius, 6);
  });

  it('is view state only: posing with it or without leaves the sim state as it is', () => {
    const states = (k: number) => ({ velocity: new Vector3(0, 0, k < 30 ? 4 : 0), yaw: k * 0.05 });
    const [plain, dressed] = [new Animator({ rng: new Rng(2) }), new Animator({ rng: new Rng(2) })];
    const layer = new Secondary({ hair: 'ponytail', cape: true });
    dressed.use('secondary', layer);
    for (let k = 0; k < 90; k++) {
      plain.step(states(k));
      dressed.step(states(k)).pose();
    }
    expect(JSON.stringify(dressed.body.state)).toBe(JSON.stringify(plain.body.state));
    expect(dressed.inspect().layers.at(-1)).toMatchObject({ slot: 'secondary', layers: [{ name: 'secondary' }] });
    expect(Object.keys(layer.inspect().tips as object)).toEqual(['hair', 'capeL', 'capeR']);
  });
});
