/**
 * @file Unit tests for engine/world/steer.ts (T1; PLAN.md WP 5.2's Done-when): seek points the way and slows to arrive;
 * followFlow goes straight when near and clear, round walls and by the stairs otherwise, never up a gallery's face;
 * approachRing closes in, backs off and drifts round; hover holds a height; airTime and hop land a jumper where aimed.
 * The fixtures: in the hall (labs/box/levels/hall.txt), agents following the field from all over the floor reach a
 * tile on the east gallery, moved by hand and as crowd bodies under Rapier; crowd bodies wait on a ring round a target.
 * @see engine/world/steer.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setVelocity, updateCrowd, CROWD_AGENT, type CrowdAgent } from '../physics/crowd';
import { createPhysics } from '../physics/world';
import { addLevelBodies } from '../sim/levelBodies';
import { Vector3 } from '../core/math';
import { compileLevel } from './level/compile';
import { floorHeight } from './level/heights';
import { NavGrid } from './nav';
import { airTime, approachRing, FOLLOW, followFlow, hop, HOP, hover, HOVER, APPROACH_RING, seek } from './steer';

const HALL = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
  file: 'hall.txt',
});
const DT = 1 / 60;
const GRAVITY = 9.81;
/** The sim stand-in for physics: the step length and the world's gravity. */
const SIM = { dt: DT, settings: { get: (path: string) => (path === 'physics.gravity' ? GRAVITY : undefined) } };
/** A small level: a wall in the middle of a room. */
const ROOM = compileLevel('#######\n#.....#\n#.###.#\n#.....#\n#######\n');
const at = (x: number, z: number) => ({ x, y: 0, z });
/** The most a crowd body climbs, with a margin (m): see the hall fixture. */
const BODY_CLIMB = 0.06;
const length = (v: Vector3) => Math.sqrt(v.x * v.x + v.z * v.z);
/** A vector's components, −0 read as 0. */
const xyz = (v: Vector3) => v.toArray().map((n) => n + 0);

describe('seek', () => {
  it('points the way on the ground, a unit vector, zero within a millimetre', () => {
    expect(seek(at(0, 0), at(3, 4)).toArray()).toEqual([0.6, 0, 0.8]);
    expect(seek(at(1, 1), at(1.0005, 1)).toArray()).toEqual([0, 0, 0]);
    const out = new Vector3(9, 9, 9);
    expect(seek(at(0, 0), at(-2, 0), out)).toBe(out);
    expect(out.toArray()).toEqual([-1, 0, 0]);
  });

  it('slows in proportion inside the slowing distance, and arrives without overshooting', () => {
    expect(length(seek(at(0, 0), at(0.5, 0), undefined, 2))).toBeCloseTo(0.25, 12);
    expect(length(seek(at(0, 0), at(5, 0), undefined, 2))).toBe(1);
    let x = 0;
    for (let i = 0; i < 600; i++) x += seek(at(x, 0), at(3, 0), undefined, 1).x * 3 * DT;
    expect(x).toBeLessThanOrEqual(3);
    expect(x).toBeGreaterThan(3 - 1.001e-3); // it stops within the millimetre that counts as there
  });
});

describe('followFlow', () => {
  const grid = new NavGrid(ROOM);
  const target = at(3.3, 3.4); // off its tile's centre, so straight and the field differ
  const field = grid.flowField(grid.cellAt(target.x, target.z));

  it('goes straight at the target when near and in a clear line, by the field otherwise', () => {
    const way = followFlow(field, at(1.5, 3.6), target);
    expect(way.x).toBeCloseTo(1.8 / Math.sqrt(1.8 * 1.8 + 0.04), 12);
    expect(way.z).toBeCloseTo(-0.2 / Math.sqrt(1.8 * 1.8 + 0.04), 12);
    const byField = followFlow(field, at(1.5, 3.6), target, undefined, { near: 1 }); // to the goal tile's centre
    expect(byField.x).toBeCloseTo(2 / Math.sqrt(4 + 0.01), 12);
    expect(byField.z).toBeCloseTo(-0.1 / Math.sqrt(4 + 0.01), 12);
  });

  it('follows the field round a wall, and slows into the target when asked', () => {
    expect(xyz(followFlow(field, at(4.5, 1.5), target))).toEqual([1, 0, 0]); // east: the short way round
    expect(length(followFlow(field, at(2.7, 3.4), target, undefined, { slowing: 1 }))).toBeCloseTo(0.6, 12);
    expect(FOLLOW).toEqual({ near: 4, slowing: 0 });
  });

  it('heads straight at the target where the field has no way', () => {
    const short = grid.flowField(grid.cellAt(target.x, target.z), { reach: 2 });
    expect(followFlow(short, at(5.5, 1.5), target, undefined, { near: 0 }).toArray()).toEqual(
      seek(at(5.5, 1.5), target).toArray(),
    );
  });

  it('in the hall, takes the stairs to a gallery from the floor under its face', () => {
    const hall = new NavGrid(HALL);
    const goal = at(50.5, 2.5);
    const toGallery = hall.flowField(hall.cellAt(goal.x, goal.z));
    const way = followFlow(toGallery, at(50.5, 5.5), goal);
    expect(way.z).toBeGreaterThan(0.5); // south, to the foot of the stairs, not north into the gallery's face
  });
});

describe('approachRing', () => {
  const target = at(10, 10);
  const ring = { radius: 2 };

  it('closes in beyond the ring, by the field or straight', () => {
    expect(approachRing(null, at(10, 0), target, ring).toArray()).toEqual([0, 0, 1]);
    const grid = new NavGrid(ROOM);
    const field = grid.flowField(grid.cellAt(3.5, 3.5));
    expect(approachRing(field, at(4.5, 1.5), at(3.5, 3.5), { radius: 0.5 }).toArray()).toEqual([1, 0, 0]);
  });

  it('backs off inside the ring at the backoff share, straight out', () => {
    expect(xyz(approachRing(null, at(10, 9), target, ring))).toEqual([0, 0, -APPROACH_RING.backoff]);
    expect(xyz(approachRing(null, at(9, 10), target, { radius: 2, backoff: 0.25 }))).toEqual([-0.25, 0, 0]);
    expect(xyz(approachRing(null, at(10, 10), target, ring))).toEqual([0, 0, 0]);
  });

  it('drifts round on the ring, anticlockwise seen from above for a positive sway', () => {
    const from = at(10 - 2 * Math.SQRT1_2, 10 - 2 * Math.SQRT1_2);
    const way = approachRing(null, from, target, ring, 1);
    expect(length(way)).toBeCloseTo(APPROACH_RING.circle, 12);
    const [rx, rz] = [from.x - target.x, from.z - target.z];
    expect(rx * way.x + rz * way.z).toBeCloseTo(0, 12); // along the ring
    expect(rz * way.x - rx * way.z).toBeGreaterThan(0); // (r × v).y > 0: a positive turn about +Y
    expect(xyz(approachRing(null, from, target, ring, -0.5))).toEqual(xyz(way.clone().multiplyScalar(-0.5)));
    const edge = at(10, 10 - 2 - APPROACH_RING.band); // on the band's edge: still on the ring
    expect(xyz(approachRing(null, edge, target, ring, 0))).toEqual([0, 0, 0]);
  });
});

describe('hover', () => {
  it('climbs at climb × the gap to height over the floor, bobbing', () => {
    expect(hover(1, 0, 0)).toBeCloseTo((HOVER.height - 1) * HOVER.climb, 12);
    expect(hover(1 + HOVER.height, 1, 0)).toBe(0);
    const t = Math.PI / 4; // sin(2t) = 1: at the top of its bob
    expect(hover(0.5, 0.5, t)).toBeCloseTo((HOVER.height + HOVER.bob) * HOVER.climb, 12);
    expect(hover(3, 0, 0, { height: 2, climb: 2, bob: 0 })).toBe(-2);
  });

  it('holds a flyer at its height, integrated at 60 Hz', () => {
    let y = 0;
    for (let i = 0; i < 120; i++) y += hover(y, 0.5, 0, { bob: 0 }) * DT;
    expect(y).toBeCloseTo(0.5 + HOVER.height, 4);
  });
});

describe('airTime and hop', () => {
  it('gives the flight time to come down at a height, Infinity where it never does', () => {
    expect(airTime(6, 30)).toBeCloseTo(0.4, 12);
    expect(airTime(HOP.up, 30)).toBeCloseTo(0.625, 12); // the prototype's 2·150/480 s
    expect(airTime(6, 30, 0.6)).toBeCloseTo(0.2, 12); // the apex
    expect(airTime(6, 30, 0.7)).toBe(Infinity);
    expect(airTime(0, 10, -0.05)).toBeCloseTo(0.1, 12); // a drop
    expect(airTime(-1, 10, 0.5)).toBe(Infinity);
    expect(() => airTime(6, 0)).toThrow(/CORE_BAD_SPEC|gravity/);
  });

  it('lands a ballistic body exactly where it is aimed, up and down', () => {
    const from = { x: 1, y: 0.5, z: -2 };
    for (const to of [
      { x: 3, y: 0.5, z: 1 },
      { x: -1, y: 1.25, z: -2.5 }, // onto a crate
      { x: 2, y: -1, z: -2 }, // off a ledge
    ]) {
      const v = hop(from, to, HOP.up, 29.43)!;
      const time = airTime(HOP.up, 29.43, to.y - from.y);
      const land = [from.x + v.x * time, from.y + v.y * time - (29.43 * time * time) / 2, from.z + v.z * time];
      land.forEach((value, k) => expect(value).toBeCloseTo([to.x, to.y, to.z][k], 9));
      expect(v.y).toBe(HOP.up);
    }
  });

  it('refuses a point higher than the jump lifts it, and leaps in place', () => {
    expect(hop(at(0, 0), { x: 1, y: 3, z: 0 }, 6, 30)).toBeNull();
    expect(hop(at(0, 0), at(0, 0), 0, 30)?.toArray()).toEqual([0, 0, 0]);
    expect(hop(at(0, 0), at(1, 0), 0, 30)).toBeNull();
  });
});

/** The tile under a point, and the start points of the hall fixtures: every `every`th open tile with a way to `goal`. */
function starts(grid: NavGrid, goal: number, every: number): number[] {
  const field = grid.flowField(goal);
  const open = [...grid.open.keys()].filter((i) => grid.open[i] && i !== goal && field.distance[i] < Infinity);
  return open.filter((_, k) => k % every === 0);
}

describe('the hall fixture: agents following the field reach the target tile', () => {
  const grid = new NavGrid(HALL);
  const goal = at(50.5, 2.5); // on the east gallery, 1 m up: from the floor, only by the stairs
  const target = grid.cellAt(goal.x, goal.z);
  const field = grid.flowField(target);

  it('moved by hand at 3 m/s from every fifth open tile, each within its walking distance + 25 %', () => {
    const speed = 3;
    const begin = starts(grid, target, 5);
    expect(begin.length).toBeGreaterThan(350);
    const out = new Vector3();
    const [missed, offGrid]: number[][] = [[], []];
    let worst = 0;
    for (const start of begin) {
      const p = grid.center(start);
      const limit = Math.ceil(((field.distance[start] * 1.25) / speed + 1) / DT);
      let steps = 0;
      for (; steps < limit && grid.cellAt(p.x, p.z) !== target; steps++) {
        followFlow(field, p, goal, out);
        const [x, z] = [p.x + out.x * speed * DT, p.z + out.z * speed * DT];
        if (!grid.canStep(grid.cellAt(p.x, p.z), grid.cellAt(x, z))) offGrid.push(start);
        p.set(x, 0, z);
      }
      if (grid.cellAt(p.x, p.z) !== target) missed.push(start);
      worst = Math.max(worst, (steps * DT * speed) / Math.max(field.distance[start], 1));
    }
    expect([missed, offGrid]).toEqual([[], []]); // each arrived, never stepping where the grid has no step
    expect(worst).toBeLessThan(1.25);
  });

  it('as crowd bodies under Rapier, from all over the floor, each leaving once it stands on the target tile', () => {
    // A crowd body steps up 7 cm at most (measured on Rapier 0.21: capsules 7 cm, balls 8.5 cm, pushed at 3 m/s), not
    // NAV_CLIMB's 0.219 m: under that limit the grid would send it onto the stairs from their sides, 0.1 m up.
    const bodies = new NavGrid(HALL, { climb: BODY_CLIMB });
    const field = bodies.flowField(target);
    const physics = createPhysics();
    addLevelBodies(physics, HALL);
    const begin = starts(bodies, target, 47).filter((i) => HALL.floor[i] === 0);
    expect(begin.length).toBeGreaterThan(20);
    const agents: CrowdAgent[] = begin.map((i) => {
      const c = grid.center(i);
      return { ...CROWD_AGENT, x: c.x, y: floorHeight(HALL, c.x, c.z), z: c.z };
    });
    updateCrowd(physics, agents, SIM);
    const arrived = new Map<number, number>();
    const out = new Vector3();
    for (let step = 1; step <= 60 * 60 && arrived.size < agents.length; step++) {
      agents.forEach((a, k) => {
        if (a.state !== 'alive') return;
        if (grid.cellAt(a.x, a.z) === target) {
          arrived.set(k, step);
          a.state = 'leaving';
          return;
        }
        followFlow(field, a, goal, out);
        setVelocity(physics, a, [out.x * 3, 0, out.z * 3], SIM);
      });
      physics.step(SIM);
      updateCrowd(physics, agents, SIM);
    }
    expect(agents.map((_, k) => arrived.has(k))).toEqual(agents.map(() => true));
    // Each within its walking distance at 3 m/s + 25 %, and a second to start (measured: + 12 % at worst, 22 s for 66 m).
    const late = begin.filter((i, k) => arrived.get(k)! * DT > (field.distance[i] / 3) * 1.25 + 1);
    expect(late).toEqual([]);
  });
});

describe('a ring fixture: crowd bodies wait round a target', () => {
  it('closes in from 6 to 9 m and holds the ring, drifting round it', () => {
    const physics = createPhysics();
    addLevelBodies(physics, HALL);
    const grid = new NavGrid(HALL);
    const target = at(18.5, 13.5); // open floor between two rows of pillars
    const field = grid.flowField(grid.cellAt(target.x, target.z));
    const agents: CrowdAgent[] = Array.from({ length: 12 }, (_, k) => {
      const [angle, distance] = [(2 * Math.PI * k) / 12, 6 + (k % 4)];
      const [x, z] = [target.x + distance * Math.cos(angle), target.z + distance * Math.sin(angle) * 0.6];
      return { ...CROWD_AGENT, x, y: floorHeight(HALL, x, z), z };
    });
    updateCrowd(physics, agents, SIM);
    const out = new Vector3();
    const ring = { radius: 2.5 };
    for (let step = 1; step <= 600; step++) {
      agents.forEach((a, k) => {
        approachRing(field, a, target, ring, Math.sin(step * DT * 0.9 + k), out);
        setVelocity(physics, a, [out.x * 3, 0, out.z * 3], SIM);
      });
      physics.step(SIM);
      updateCrowd(physics, agents, SIM);
    }
    const distances = agents.map((a) => Math.sqrt((a.x - target.x) ** 2 + (a.z - target.z) ** 2));
    for (const d of distances) expect(Math.abs(d - ring.radius)).toBeLessThan(0.5);
  });
});
