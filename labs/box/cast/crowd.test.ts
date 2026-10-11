/**
 * @file Unit tests for the box's crowd cast (labs/box/cast/{walker,slime,wisp}.ts, PLAN.md WP 5.7), on the hall's crowd
 * grid: the walker waits on its ring round the hero when level with him (in from beyond it at its own speed, out from
 * inside it, round it on it with its sway), follows the flow field up the stairs when he is on a gallery, and turns
 * toward where it goes; the slime rests, crouches and leaps, up at 9.375 m/s, landing on the floor about 0.64 s
 * later (its own gravity); the wisp closes in from afar, backs off from near, circles him its own way and hovers over
 * the floor below it. Each member draws its make from the stream it is given.
 * @see labs/box/cast/walker.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless, floorHeight } from '../../../engine';
import { CROWD_AGENT, Rng, Vector3, followFlow, hover, type CrowdAgent } from '../../../engine/sim-api';
import { CROWD_GRID } from '../scenes/crowd-1000';
import { crowd100 } from '../scenes/crowd-100';
import { HALL_LEVEL } from '../scenes/hall';
import { makeSlime } from './slime';
import { WALKER, makeWalker, steerWalker, type Chase } from './walker';
import { WISP, makeWisp, steerWisp } from './wisp';

const DT = 1 / 60;
const floor = (x: number, z: number) => floorHeight(HALL_LEVEL, x, z);

/** A chase after the hero standing at (x, y, z), on the crowd grid. */
function chaseAt(x: number, y: number, z: number, time = 0): Chase {
  const field = CROWD_GRID.flowField(CROWD_GRID.cellAt(x, z));
  return { hero: { x, y, z }, field, floor, time, dt: DT, gravity: 9.81, rng: new Rng(3) };
}

/** A living crowd agent of `make` with its feet at (x, z) on the floor. */
const agentAt = (make: Partial<CrowdAgent>, x: number, z: number): CrowdAgent => ({
  ...CROWD_AGENT,
  ...make,
  state: 'alive',
  grounded: true,
  x,
  y: floor(x, z),
  z,
});

describe('the walker', () => {
  it('draws its speed (1.75 to 2.5 m/s) and sway from its stream', () => {
    const rng = new Rng(9);
    const speeds = Array.from({ length: 200 }, () => makeWalker(rng).speed);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(1.75);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(2.5);
    expect(makeWalker(new Rng(4))).toEqual(makeWalker(new Rng(4)));
  });

  it('level with the hero, comes in to its ring, backs off inside it and drifts round it on it', () => {
    const chase = chaseAt(18.5, 0, 13.5, Math.PI / 2 / WALKER.sway); // open floor between the pillars
    const walker = { speed: 2, yaw: 0, sway: 0 };
    const out = new Vector3();
    const far = steerWalker(agentAt(WALKER.agent, 24.5, 13.5), walker, chase, out).clone();
    expect(far.toArray().map((v) => +v.toFixed(6))).toEqual([-2, 0, 0]); // straight in, at its speed
    const inside = steerWalker(agentAt(WALKER.agent, 19, 13.5), walker, chase, out).clone();
    expect(inside.x).toBeCloseTo(1, 6); // out, east, at half its speed
    const on = steerWalker(agentAt(WALKER.agent, 20, 13.5), walker, chase, out).clone();
    expect(on.x).toBeCloseTo(0, 6);
    expect(Math.abs(on.z)).toBeCloseTo(0.8, 6); // round at 0.4 of its speed, the sway at its peak
  });

  it('follows the flow field up the stairs when the hero stands on a gallery, facing where it goes', () => {
    const chase = chaseAt(7.5, 1, 2.5); // on the west gallery
    const agent = agentAt(WALKER.agent, 9.5, 8.5); // on the floor under the gallery's face, west of the stairs
    const walker = { speed: 2, yaw: Math.PI, sway: 0 };
    const out = steerWalker(agent, walker, chase, new Vector3());
    const way = followFlow(chase.field, agent, chase.hero, new Vector3()).multiplyScalar(2);
    expect(out.toArray()).toEqual(way.toArray());
    expect(out.z).toBeGreaterThanOrEqual(0); // never north into the gallery's face
    for (let i = 0; i < 60; i++) steerWalker(agent, walker, chase, out);
    expect(walker.yaw).toBeCloseTo(Math.atan2(out.x, out.z), 6);
  });
});

describe('the slime', () => {
  it('rests, crouches, then leaps up at 9.375 m/s and lands on the floor some 0.64 s later', async () => {
    const engine = await createHeadless({ scene: crowd100, settings: { 'box.crowd.mix': 'slimes' } });
    engine.step(10);
    const id = engine.entities('crowdSlime')[0].id;
    const seen = new Set<string>();
    let [took, landedAt, leapAt] = [0, 0, 0];
    for (let k = 0; k < 240 && !landedAt; k++) {
      engine.step(1);
      const { crowdSlime: slime, crowdMember: a } = engine.get(id) as unknown as {
        crowdSlime: { hop: string };
        crowdMember: CrowdAgent;
      };
      seen.add(slime.hop);
      if (slime.hop === 'air' && !leapAt) leapAt = k;
      if (leapAt && slime.hop === 'rest') [landedAt, took] = [k, a.y];
    }
    expect([...seen]).toEqual(expect.arrayContaining(['rest', 'crouch', 'air']));
    expect((landedAt - leapAt) * DT).toBeGreaterThan(0.5); // about 2 × 9.375 / 29.43 s in the air
    expect((landedAt - leapAt) * DT).toBeLessThan(0.8);
    expect(took).toBeCloseTo(0, 1);
    expect(makeSlime(new Rng(2))).toEqual(makeSlime(new Rng(2)));
    expect(makeSlime(new Rng(2)).hop).toBe('rest');
  });
});

describe('the wisp', () => {
  it('closes in from afar, backs off from near, circles its own way and hovers over the floor', () => {
    const chase = chaseAt(18.5, 0, 13.5);
    const out = new Vector3();
    const wisp = { orbit: 1, clock: 0 };
    const at = (x: number, y = HOVER_Y) => ({ ...agentAt(WISP.agent, x, 13.5), y });
    const near = steerWisp(at(21.5), wisp, chase, out).clone();
    expect(near.x).toBeCloseTo(WISP.speed, 6); // out, east
    expect(near.z).toBeCloseTo(-WISP.circle, 6); // round: anticlockwise seen from above, north from the east
    const between = steerWisp(at(23.5), wisp, chase, out).clone();
    expect(between.x).toBeCloseTo(0, 6); // neither in nor out between 4.375 and 6.25 m
    expect(between.z).toBeCloseTo(-WISP.circle, 6);
    const far = steerWisp(at(28.5), { orbit: -1, clock: 0 }, chase, out).clone();
    expect(far.x).toBeLessThan(-1); // in, west
    expect(far.z).toBeCloseTo(WISP.circle, 6); // the other way round
    expect(steerWisp(at(28.5, 0.25), { orbit: 1, clock: 0 }, chase, out).y).toBeCloseTo(hover(0.25, 0, DT), 9);
    const draws = makeWisp(new Rng(5));
    expect([Math.abs(draws.orbit), draws.clock >= 0 && draws.clock < 9]).toEqual([1, true]);
  });
});

/** A wisp's feet at its hover height over the hall's floor (m). */
const HOVER_Y = 1.25;
