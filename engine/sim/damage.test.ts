/**
 * @file Tests for damage (engine/sim/damage.ts): a scripted killing hit launches its body more than 1 m up (as high
 * as v²/2g says) into the corpse group, and a lighter launch leaves it standing; knockback is momentum the solver
 * carries into a neighbour; a dead or gone target takes no hit; the event's payload and the health it writes; a crowd
 * hit hands the frame clock one stop however many it strikes (the same stalled frames for 1 foe and for 12), and the
 * budget shortens the next; the longest stop asked waits for its host, outside the hash; a capture taken while a
 * corpse flies restores and continues exactly; bad arguments are refused, naming the field.
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createClock, createVirtualClock } from '../core/time';
import { CROWD_AGENT_FIELDS, updateCrowd, type CrowdAgent } from '../physics/crowd';
import { physicsOf } from '../physics/world';
import { SpatialHash } from '../world/spatial';
import type { WorldCapture } from './capture';
import {
  damage,
  HEALTH,
  HEALTH_FIELDS,
  requestHitStop,
  type DamageEvent,
  type DamageEvents,
  type Health,
  type HitSpec,
  takeHitStop,
} from './damage';
import { coneHits } from './hits';
import { defineScene, startScene } from './scene';
import { defineComponent } from './state';
import type { World } from './world';

defineComponent('foe', { description: 'A crowd agent the tests hit.', fields: CROWD_AGENT_FIELDS });
defineComponent('vitals', { description: 'A foe’s health.', fields: HEALTH_FIELDS });

type Components = { foe: CrowdAgent; vitals: Health };
type Yard = World<Components, DamageEvents>;

/** The yard: a 40 × 40 m floor and the crowd's readback; foes are spawned by the tests. */
defineScene('damageYard', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }],
    });
    w.systems.add(
      'crowd',
      (w) =>
        void updateCrowd(
          physicsOf(w),
          w.query('foe').map((e) => e.foe as unknown as CrowdAgent),
          w,
        ),
      {
        phase: 'readback',
      },
    );
  },
});

/** A yard with foes (walkers, or `make`) standing at `spots` (x, z), `hp` hit points each, after 30 steps. */
function yard(spots: readonly (readonly [number, number])[], hp = 10, make: Partial<CrowdAgent> = {}): Yard {
  const world = startScene('damageYard').world as unknown as Yard;
  for (const [x, z] of spots) world.spawn({ foe: { ...make, x, z }, vitals: { hp } });
  for (let i = 0; i < 30; i++) world.step({});
  return world;
}

/** A foe's target: its id, health and body. */
function target(w: Yard, id: number) {
  const e = w.get(id)!;
  return { id, health: e.vitals, agent: e.foe };
}

/** The prototype's big killing blow: pushed 3 m/s, launched at 4.375 m/s, the kill launch 10.625 m/s and ×1.3. */
const BIG: HitSpec = { amount: 20, from: [0, 0, 0], knockback: 3, launch: 4.375, kill: { launch: 10.625, carry: 1.3 } };

/** The walker's fall: gravity scale 3 under 9.81 m/s². */
const G = 3 * 9.81;

describe('damage', () => {
  it('a scripted killing hit launches its body more than 1 m up, into the corpse group', () => {
    const w = yard([[0, 1]]);
    const event = damage(w, target(w, 1), BIG);
    expect(event).toMatchObject({ target: 1, killed: true, hp: -10, amount: 20 });
    const foe = w.get(1)!.foe!;
    expect(foe.state).toBe('corpse');
    let top = 0;
    for (let i = 0; i < 90; i++) {
      w.step({});
      top = Math.max(top, foe.y);
    }
    expect(top).toBeGreaterThan(1);
    expect(top).toBeCloseTo((10.625 * 10.625) / (2 * G), 1); // 1.92 m
    expect(foe.y).toBeLessThan(0.01); // and it came down
  });

  it('a lighter launch throws a living foe as high as v²/2g says, and it stands again', () => {
    const w = yard([[0, 1]]);
    damage(w, target(w, 1), { ...BIG, amount: 1 });
    const foe = w.get(1)!.foe!;
    let top = 0;
    for (let i = 0; i < 60; i++) {
      w.step({});
      top = Math.max(top, foe.y);
    }
    expect([foe.state, foe.grounded]).toEqual(['alive', true]);
    expect(top).toBeCloseTo((4.375 * 4.375) / (2 * G), 1); // 0.33 m
  });

  it('pushes as momentum: the knocked foe slides on and shoves its neighbour', () => {
    const w = yard([
      [0, 1],
      [0, 2],
    ]);
    damage(w, target(w, 1), { amount: 1, from: [0, 0, 0], knockback: 4 });
    expect(w.get(1)!.foe!.vz).toBeCloseTo(4, 6);
    for (let i = 0; i < 30; i++) w.step({});
    expect(w.get(2)!.foe!.z).toBeGreaterThan(2.3); // carried on by the solver
    damage(w, target(w, 2), { amount: 1, from: [5, 0, 5], direction: [-1, 0.5, 0], knockback: 2 });
    expect(w.get(2)!.foe!.vx).toBeLessThan(-1.9); // along the given direction's ground part
  });

  it('a dead or gone target takes no hit, and nothing changes', () => {
    const w = yard([
      [0, 1],
      [3, 1],
    ]);
    damage(w, target(w, 1), BIG);
    const hash = w.hash();
    expect(damage(w, target(w, 1), BIG)).toBeNull(); // dead
    expect(damage(w, { id: 2, agent: w.get(1)!.foe! }, BIG)).toBeNull(); // a corpse's body
    expect(damage(w, { id: 2, health: { ...HEALTH, hp: 0 } }, BIG)).toBeNull();
    expect(w.hash()).toBe(hash);
  });

  it('writes the health and emits the event: where it struck and the push’s direction', () => {
    const w = yard([[3, 4]]);
    const heard: DamageEvent[] = [];
    w.events.on('damage', (e) => heard.push(e));
    const event = damage(w, target(w, 1), { amount: 2, from: [0, 1, 0], source: 9, stop: 0.05 })!;
    expect(heard).toEqual([event]);
    expect(event).toEqual({
      target: 1,
      source: 9,
      amount: 2,
      hp: 8,
      killed: false,
      at: [expect.closeTo(3, 6), expect.closeTo(0.8125, 2), expect.closeTo(4, 6)], // the walker's middle
      dir: [expect.closeTo(0.6, 6), 0, expect.closeTo(0.8, 6)],
      stop: 0.05,
    });
    expect(w.get(1)!.vitals!).toEqual({ hp: 8, hitAt: 30, hitBy: 9 });
    const ghost = damage(w, { id: 5 }, { amount: 1, from: [0, 0, 0], at: [0, 1, -2] })!;
    expect([ghost.hp, ghost.killed, ghost.at, ghost.dir]).toEqual([null, false, [0, 1, -2], [0, 0, -1]]);
  });

  it('refuses bad arguments, naming the field', () => {
    const w = yard([[0, 1]]);
    expect(() => damage(w, target(w, 1), { amount: -1, from: [0, 0, 0] })).toThrow(/SIM_BAD_ARGUMENT.*amount/);
    expect(() => damage(w, target(w, 1), { from: [0, Number.NaN, 0] })).toThrow(/SIM_BAD_ARGUMENT.*from/);
    expect(() => damage(w, target(w, 1), { from: [0, 0, 0], kill: { carry: -1 } })).toThrow(/kill: \{ carry/);
    expect(() => damage(w, { id: 1.5 }, { from: [0, 0, 0] })).toThrow(/SIM_BAD_ARGUMENT.*damage\(w, target\)/);
    expect(() => requestHitStop(w, -0.1)).toThrow(/SIM_BAD_ARGUMENT.*requestHitStop/);
  });

  it('a capture taken while a corpse flies restores and continues to the same hashes', () => {
    const run = () => {
      const w = yard([
        [0, 1],
        [1, 1],
      ]);
      damage(w, target(w, 1), BIG);
      for (let i = 0; i < 10; i++) w.step({});
      return w;
    };
    const straight = run();
    const hashes = [straight.hash()];
    for (let i = 0; i < 40; i++) straight.step({});
    hashes.push(straight.hash());
    const w = run();
    const capture = deserialize(serialize(w.capture() as unknown as Canonical)) as unknown as WorldCapture;
    damage(w, target(w, 2), BIG); // somewhere else
    for (let i = 0; i < 5; i++) w.step({});
    w.restore(capture);
    expect(w.hash()).toBe(hashes[0]);
    for (let i = 0; i < 40; i++) w.step({});
    expect(w.hash()).toBe(hashes[1]);
  });
});

describe('hit-stop', () => {
  /** A slash's cone: 1.1 m out, 1.2 rad either side, from 0.6 to 1.4 m up. */
  const SLASH = { range: 1.1, halfAngle: 1.2, yMin: 0.6, yMax: 1.4 };

  /** Critters small enough for 12 to stand apart in the cone: 0.12 m capsules, 0.8 m tall. */
  const CRITTER = { radius: 0.12, height: 0.56 };
  /** Where 12 stand: 3 arcs of 4, 0.5, 0.8 and 1.1 m ahead, from −0.9 to 0.9 rad. */
  const PACK = [0.5, 0.8, 1.1].flatMap((r) =>
    [-0.9, -0.3, 0.3, 0.9].map((a) => [r * Math.sin(a), r * Math.cos(a)] as const),
  );

  /**
   * `foes` critters ahead (1: 0.8 m straight ahead; 12: the pack), a swing at steps 31 and 36 striking every one in
   * its cone (1 hit point, a 0.06 s stop asked each), the sim driven by a frame clock at 60 Hz frames for 0.5 s, its
   * host handing the stop asked to the clock after each step, as a page's does. Returns the swings' hits, the stops
   * granted, the clock's debt after the first swing and the frames that ran no step after it.
   */
  function fight(foes: 1 | 12) {
    const w = yard(foes === 1 ? [[0, 0.8]] : PACK, 10, CRITTER);
    const time = createVirtualClock(0);
    const clock = createClock({ now: time.now });
    clock.advance();
    const granted: number[] = [];
    const hits: number[] = [];
    let debt = -1;
    const hash = new SpatialHash({ cell: 2 });
    w.systems.add(
      'swing',
      (w) => {
        if (w.tick !== 31 && w.tick !== 36) return;
        hash.clear();
        for (const { id, foe } of w.query('foe')) if (foe.state === 'alive') hash.add(id, foe.x, foe.z);
        const struck = coneHits({ hash, hurt: (id) => w.get(id)?.foe }, [0, 0, 0], 0, SLASH);
        for (const id of struck) damage(w, target(w, id), { amount: 1, from: [0, 0, 0], stop: 0.06 });
        hits.push(struck.length);
      },
      { phase: 'rules' },
    );
    let stalled = 0;
    for (let frame = 0; frame < 30; frame++) {
      time.tick(1000 / 60);
      const { steps } = clock.advance();
      if (steps === 0 && w.tick > 30) stalled++;
      for (let i = 0; i < steps; i++) {
        w.step({});
        const stop = takeHitStop(w);
        if (stop > 0) granted.push(clock.hitStop(stop));
        if (w.tick === 31) debt = clock.state().hitStop.debt;
      }
    }
    return { hits, granted, debt, stalled };
  }

  it('stops time once per crowd hit: 12 foes struck stall as many frames as 1', () => {
    const one = fight(1);
    const crowd = fight(12);
    expect([one.hits, crowd.hits]).toEqual([
      [1, 1],
      [12, 12],
    ]);
    expect([one.granted.length, crowd.granted.length]).toEqual([2, 2]); // one stop per swing, however many it struck
    expect([one.granted[0], crowd.granted[0]]).toEqual([0.06, 0.06]); // the first a full one
    expect([one.debt, crowd.debt]).toEqual([0.06, 0.06]); // the budget counts the swing once
    expect(crowd.stalled).toBe(one.stalled);
    expect(one.stalled).toBe(6); // 60 ms of stop: 4 frames; the second swing's shorter one: 2
  });

  it('shortens the next crowd hit’s stop (the budget)', () => {
    const { granted } = fight(12);
    expect(granted[1]).toBeLessThan(0.06 * 0.75); // 0.15 s of real time after a full stop: still in debt
    expect(granted[1]).toBeGreaterThan(0.06 * 0.18 - 1e-12); // never below the floor share
  });

  it('keeps the longest stop asked until taken, outside the hash', () => {
    const w = yard([[0, 1]]);
    const hash = w.hash();
    requestHitStop(w, 0.05);
    requestHitStop(w, 0.08);
    requestHitStop(w, 0.03);
    requestHitStop(w, 0); // nothing
    expect(w.hash()).toBe(hash);
    expect([takeHitStop(w), takeHitStop(w)]).toEqual([0.08, 0]);
    expect(takeHitStop(yard([[0, 1]]))).toBe(0); // per world
  });
});
