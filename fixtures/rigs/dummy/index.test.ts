/**
 * @file The training dummy takes hits (PLAN.md WP 6.1; the box rule, §9.3): a hero plays moves at it through the public
 * API and they connect as they should. Each strike whose measured hit shape reaches the dummy hits it exactly once per
 * swing, inside the hit window, its weapon sweep crossing the dummy's capsule; one out of reach is never hit; a
 * three-hit combo lands three hits, the knockback rocking the dummy away from the hero; and the fixture's own geometry.
 */
import { describe, expect, it } from 'vitest';
import {
  Attack,
  Combo,
  inHitShape,
  knockback,
  measureMove,
  MoveRig,
  moveAt,
  strikePart,
  strikeSegment,
  Vector3,
  type Sweep,
} from '../../../engine/sim-api';
import { createDummy, dummyAxis, hitDummy, segmentDistance, stepDummy, sweepTouches, type Dummy } from './index';

/** The hero's make: heroic, with a sword. */
const HERO = { build: 'build:heroic', weapon: 'sword' } as const;
const DT = 1 / 60;

/** What a swing at a dummy showed: the ticks it hit on, the ticks its sweep crossed the capsule, the window. */
interface Swing {
  hits: number[];
  touches: number[];
  window: number[];
}

/**
 * The hero, at the origin facing +Z, plays `attack` (or a combo) to its end at `dummy`: each tick it poses, publishes
 * the strike's sweep, and connects with the dummy when the sweep crosses its capsule or the dummy is in the hit shape.
 */
function swingAt(dummy: Dummy, attack: Attack | Combo, press: (tick: number) => boolean = (t) => t === 0): Swing {
  const rig = new MoveRig({ ...HERO, clock: 0 });
  const out: Swing = { hits: [], touches: [], window: [] };
  const [base, tip] = [new Vector3(), new Vector3()];
  const hero = new Vector3();
  for (let tick = 0; tick < 240; tick++) {
    if (press(tick) && attack instanceof Combo) attack.press();
    else if (press(tick)) attack.start();
    attack.update(DT);
    rig.update({ move: attack.body });
    stepDummy(dummy, DT);
    const current = attack instanceof Combo ? attack.current : attack;
    if (!current.hitOpen) continue;
    out.window.push(tick);
    strikeSegment(rig.body, strikePart(current.move, true), base, tip);
    const sweep: Sweep | null = current.sweep(base, tip);
    const touches = sweep !== null && sweepTouches(dummy, sweep);
    if (touches) out.touches.push(tick);
    const shape = measureMove(current.move, HERO);
    const inShape = inHitShape(hero, 0, shape, dummy.position.clone().setY(1), dummy.radius + 1);
    current.hits(
      [dummy],
      () => touches || (inShape && dummy.position.distanceTo(hero) <= shape.range + dummy.radius),
      (d) => hitDummy(d, { move: current.move.id, tick, push: knockback(hero, d.position, 4, 1) }),
      () => 1,
    );
    if (dummy.hits.at(-1)?.tick === tick) out.hits.push(tick);
  }
  return out;
}

/**
 * Where a dummy stands in the strike's path: on the ground under the strike point at the middle of the hit window,
 * 0.8 of its distance out (a slash's window opens with the blade already past the centre, so straight ahead the
 * cone reaches the dummy but the blade does not).
 */
function onThePath(name: string): Vector3 {
  const attack = new Attack(name);
  const rig = new MoveRig({ ...HERO, clock: 0, dt: 1 });
  rig.update({ move: moveAt(name, (1 + attack.move.hitAt) / 2, 'active') });
  const [base, tip] = [new Vector3(), new Vector3()];
  strikeSegment(rig.body, strikePart(attack.move, true), base, tip);
  return tip.setY(0).multiplyScalar(0.8);
}

describe('a training dummy takes hits', () => {
  for (const name of ['slash', 'backslash', 'thrust', 'overhead', 'jab', 'cross', 'hook', 'kick', 'roundhouse']) {
    it(`${name}: hits once per swing, inside the window, the sweep crossing the dummy`, () => {
      const dummy = createDummy(onThePath(name));
      const swing = swingAt(dummy, new Attack(name));
      expect(swing.hits, JSON.stringify(swing)).toHaveLength(1);
      expect(swing.window).toContain(swing.hits[0]);
      expect(dummy.hits[0].move).toBe(`move:${name}`);
      expect(swing.touches.length, JSON.stringify(swing)).toBeGreaterThan(0);
    });
  }

  it('is never hit from out of reach', () => {
    for (const name of ['slash', 'thrust', 'kick']) {
      const dummy = createDummy(new Vector3(0, 0, measureMove(name, HERO).range * 1.6 + 0.3));
      const swing = swingAt(dummy, new Attack(name));
      expect([swing.hits, swing.touches], name).toEqual([[], []]);
      expect(swing.window.length, name).toBeGreaterThan(0);
    }
  });

  it('takes three hits from a three-hit combo, rocking away from the hero and settling', () => {
    const dummy = createDummy(new Vector3(0, 0, 0.6));
    const combo = new Combo(['jab', 'cross', 'hook']);
    const presses = new Set([0, 14, 30]);
    const swing = swingAt(dummy, combo, (tick) => presses.has(tick));
    expect(dummy.hits.map((h) => h.move)).toEqual(['move:jab', 'move:cross', 'move:hook']);
    expect(swing.hits).toHaveLength(3);
    for (const hit of dummy.hits) expect(hit.push.z).toBeGreaterThan(0);
    expect(dummy.lean.length()).toBeLessThan(0.01); // settled by the end
  });
});

describe('the fixture', () => {
  it('rocks away from a push and settles back upright', () => {
    const dummy = createDummy(new Vector3());
    hitDummy(dummy, { move: 'move:jab', tick: 0, push: new Vector3(0, 0, 3) });
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepDummy(dummy, DT);
      peak = Math.max(peak, dummy.lean.z);
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(dummy.lean.length()).toBeLessThan(1e-3);
    expect(dummyAxis(dummy)[1].y).toBeCloseTo(1.45, 9);
  });

  it('measures the distance between segments, and sweeps against its capsule', () => {
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, -1), v(0.5, 1, 1))).toBeCloseTo(1, 12);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0))).toBeCloseTo(1, 12);
    expect(segmentDistance(v(0, 0, 0), v(0, 0, 0), v(0, 2, 0), v(0, 2, 0))).toBeCloseTo(2, 12);
    const dummy = createDummy(v(0, 0, 1));
    const across = { base0: v(-1, 1, 0.5), tip0: v(-1, 1, 1.5), base1: v(1, 1, 0.5), tip1: v(1, 1, 1.5) };
    expect(sweepTouches(dummy, across)).toBe(true);
    const high = { base0: v(-1, 3, 0.5), tip0: v(-1, 3, 1.5), base1: v(1, 3, 0.5), tip1: v(1, 3, 1.5) };
    expect(sweepTouches(dummy, high)).toBe(false);
  });
});
