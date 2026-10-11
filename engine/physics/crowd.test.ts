/**
 * @file Tests for crowd bodies (engine/physics/crowd.ts): agents enter as capsules and balls of `CROWD_MATERIAL`, feet
 * where asked, rotations locked and sliding on everything; `setVelocity` changes a velocity by at most acceleration ×
 * dt, only on the feet, a flyer's up and down too, and leaves a sleeping agent asleep while it wants to stay still;
 * knockback is the same velocity for every mass and carries into a neighbour; a launch throws as high as v²/2g says;
 * corpses touch the world and props and not the crowd, brake to a stop, settle and are removed on schedule, the oldest
 * first beyond the cap; the queues add at most `spawnLimit` a step in list order and remove `leaving` agents; the
 * grounded test; a capture mid-blast restores and continues exactly. fixtures/scenes/crowd-1000/index.test.ts proves
 * the scene, its replay and the budget's run.
 */
import { describe, expect, it } from 'vitest';
import { rescueLost, type RescueLevel } from './bodies';
import { handleOf } from './capture';
import {
  addAgent,
  CROWD_AGENT,
  CROWD_GROUNDED,
  CROWD_LIMITS,
  CROWD_MATERIAL,
  killAgent,
  knockback,
  launch,
  removeAgent,
  setVelocity,
  updateCrowd,
  type CrowdAgent,
} from './crowd';
import { groupBits } from './groups';
import { createPhysics, rapierOf, type Physics } from './world';

const DT = 1 / 60;
const GRAVITY = 9.81;
/** The sim stand-in: the step length and the world's gravity. */
const SIM = { dt: DT, settings: { get: (path: string) => (path === 'physics.gravity' ? GRAVITY : undefined) } };

/** A physics world with a 40 × 40 m floor whose top is y 0 (x and z from −20 to 20). */
function withFloor(): Physics {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
  return p;
}

/** An agent of the default make (a walker's capsule) with `fields`, queued. */
const agent = (fields: Partial<CrowdAgent> = {}): CrowdAgent => ({ ...CROWD_AGENT, ...fields });

/** One sim step for a crowd: intents from `want` (per agent, or none), the physics step, the crowd's update. */
function step(p: Physics, agents: CrowdAgent[], want?: (a: CrowdAgent) => [number, number, number] | null) {
  if (want) for (const a of agents) if (want(a)) setVelocity(p, a, want(a)!, SIM);
  p.step(SIM);
  return updateCrowd(p, agents, SIM);
}

/** Adds the agents (through the queue) and lets them stand for `n` steps. */
function standing(p: Physics, agents: CrowdAgent[], n = 30): CrowdAgent[] {
  updateCrowd(p, agents, SIM);
  for (let i = 0; i < n; i++) step(p, agents);
  return agents;
}

describe('crowd agents', () => {
  it('enter as capsules and balls of CROWD_MATERIAL, feet where asked, rotations locked, in the group crowd', () => {
    const p = withFloor();
    const [walker, slime] = standing(p, [agent({ x: 0, z: 0 }), agent({ shape: 'ball', radius: 0.375, x: 2, z: 0 })]);
    const world = rapierOf(p);
    for (const a of [walker, slime]) {
      expect(a.state).toBe('alive');
      expect(a.grounded).toBe(true);
      expect(Math.abs(a.y)).toBeLessThan(0.002); // feet on the floor
      const b = world.bodies.get(handleOf(a.body))!;
      const c = b.collider(0);
      expect([c.friction(), c.frictionCombineRule(), c.restitution()]).toEqual([0, 1, 0]); // Min
      expect(c.collisionGroups()).toBe(groupBits('crowd'));
      expect(c.density()).toBe(CROWD_MATERIAL.density);
    }
    const capsule = Math.PI * 0.3125 * 0.3125 * (1 + (4 / 3) * 0.3125);
    expect(p.readBody(walker.body).mass).toBeCloseTo(capsule * 115, 1); // about 50 kg
    expect(p.readBody(walker.body).position.y).toBeCloseTo(0.8125, 2); // 1.625 m tall
    p.applyImpulse(walker.body, [0, 0, 40], [0, 1.5, 0]); // a shove high up would tip a free body
    for (let i = 0; i < 30; i++) step(p, [walker, slime]);
    const body = p.readBody(walker.body);
    expect(body.angularVelocity.length()).toBe(0);
    expect(body.rotation.w).toBe(1); // still upright
  });

  it('change velocity by at most acceleration × dt, only on their feet, and keep what gravity gives them', () => {
    const p = withFloor();
    const [a] = standing(p, [agent({ x: 0, z: 0 })]);
    const speeds: number[] = [];
    for (let i = 0; i < 12; i++) {
      step(p, [a], () => [3, 5, 0]); // the 5 m/s up is not a walker's to ask
      speeds.push(a.vx);
    }
    const most = CROWD_AGENT.acceleration * DT; // 0.52 m/s a step
    expect(speeds[0]).toBeCloseTo(most, 5);
    expect(speeds.slice(5)).toEqual(Array(7).fill(3)); // at full speed within 6 steps, and it holds: no friction
    expect(Math.abs(a.vy)).toBeLessThan(0.01);
    expect(setVelocity(p, a, [0, 0, 0], { dt: DT, acceleration: 6 })).toBe(true); // stunned: a slower stop
    expect(a.vx).toBeCloseTo(3 - 6 * DT, 5);
    launch(p, a, 6);
    expect(a.grounded).toBe(false);
    expect(setVelocity(p, a, [-3, 0, 0], SIM)).toBe(false); // thrown: it flies on
    let air = 0;
    for (; !a.grounded && air < 200; air++) step(p, [a], () => [-3, 0, 0]);
    const g = GRAVITY * CROWD_AGENT.gravityScale;
    expect(air * DT).toBeGreaterThan((2 * 6) / g - 0.05); // the whole throw, up and down
    expect(air * DT).toBeLessThan((2 * 6) / g + 0.1);
  });

  it('steer a flyer up and down too, without gravity, in the group flyer', () => {
    const p = withFloor();
    const [wisp] = standing(p, [agent({ shape: 'ball', flyer: true, acceleration: 12, x: 0, y: 1, z: 0 })]);
    expect(wisp.y).toBe(1); // it hangs where it entered
    expect(rapierOf(p).bodies.get(handleOf(wisp.body))!.collider(0).collisionGroups()).toBe(groupBits('flyer'));
    for (let i = 0; i < 60; i++) step(p, [wisp], (w) => [1, (1.25 - w.y) * 6, 0]);
    expect(wisp.grounded).toBe(true);
    expect(wisp.y).toBeCloseTo(1.25, 2);
    expect(wisp.vx).toBe(1);
  });

  it('let a sleeping agent sleep while it wants to stay still, and wake it when it wants to move', () => {
    const p = withFloor();
    const [a] = standing(p, [agent()], 0);
    let n = 0;
    for (; !p.readBody(a.body).sleeping && n < 600; n++) step(p, [a], () => [0, 0, 0]);
    expect(n * DT).toBeGreaterThan(0.3); // Rapier 0.21: about half a second at rest (measured)
    expect(n * DT).toBeLessThan(1);
    expect(setVelocity(p, a, [0.01, 0, 0], SIM)).toBe(false);
    expect(p.readBody(a.body).sleeping).toBe(true);
    expect(setVelocity(p, a, [2, 0, 0], SIM)).toBe(true);
    expect(p.readBody(a.body).sleeping).toBe(false);
  });

  it('take knockback as the same velocity for every mass, and carry it into a neighbour', () => {
    const p = withFloor();
    const [light, heavy, near] = standing(p, [
      agent({ x: -5, z: 0 }),
      agent({ x: 5, z: 0, density: 1000 }),
      agent({ x: -5, z: 1 }),
    ]);
    knockback(p, light, [0, 0, 4]);
    knockback(p, heavy, [0, 0, 4]);
    expect([light.vz, heavy.vz]).toEqual([4, 4]);
    for (let i = 0; i < 30; i++) step(p, [light, heavy, near]);
    expect(near.z).toBeGreaterThan(1.5); // shoved along: momentum, not separation code
    expect(near.vz).toBeGreaterThan(0.5);
  });

  it('throw an agent as high as up²/2g says, multiplying its speed across the ground by carry', () => {
    const p = withFloor();
    const [a] = standing(p, [agent()]);
    knockback(p, a, [2, 0, 0]);
    launch(p, a, 5, 1.3);
    expect([a.vx, a.vy]).toEqual([expect.closeTo(2.6, 5), 5]);
    let top = 0;
    for (let i = 0; i < 60; i++) top = Math.max(top, (step(p, [a]), a.y));
    expect(top).toBeCloseTo(25 / (2 * GRAVITY * CROWD_AGENT.gravityScale), 1); // 0.85 m
  });
});

describe('corpses', () => {
  it('touch the world, not the crowd: an agent walks through one', () => {
    const p = withFloor();
    const [dead, walker] = standing(p, [agent({ x: 0, z: 0 }), agent({ x: -3, z: 0 })]);
    expect(killAgent(p, dead)).toBe(true);
    expect(killAgent(p, dead)).toBe(false); // once
    const c = rapierOf(p).bodies.get(handleOf(dead.body))!.collider(0);
    expect([c.collisionGroups(), c.frictionCombineRule()]).toEqual([groupBits('corpse'), 0]); // Average
    expect(c.friction()).toBeCloseTo(CROWD_MATERIAL.corpseFriction, 6);
    for (let i = 0; i < 120; i++) step(p, [dead, walker], (a) => (a === walker ? [3, 0, 0] : null));
    expect(walker.x).toBeGreaterThan(2.5); // through the corpse, at full speed
    expect(Math.abs(dead.x)).toBeLessThan(0.01);
    expect(Math.abs(dead.y)).toBeLessThan(0.01); // still on the floor
  });

  it('settle, braking on the floor, and are removed corpseTime after their deaths', () => {
    const p = withFloor();
    const agents = standing(
      p,
      [0, 1, 2, 3].map((i) => agent({ x: i * 2, z: 0 })),
    );
    const due = Math.round(CROWD_AGENT.corpseTime / DT); // 96 steps
    killAgent(p, agents[0]);
    launch(p, agents[0], 5.9375, 1.3);
    knockback(p, agents[0], [0, 0, 5]);
    const log: [number, number[]][] = [];
    let settled = -1;
    for (let k = 1; k <= due + 20; k++) {
      if (k === 10) [1, 2, 3].forEach((i) => killAgent(p, agents[i]));
      p.step(SIM);
      const { removed } = updateCrowd(p, agents, SIM);
      if (removed.length) log.push([k, removed]);
      const a = agents[0];
      const still = a.state === 'corpse' && a.grounded && a.y < 0.01 && Math.sqrt(a.vx * a.vx + a.vz * a.vz) < 1e-6;
      if (settled < 0 && still) settled = k;
    }
    expect(log).toEqual([
      [due, [0]], // on schedule: 1.6 s after its death
      [due + 9, [1, 2, 3]], // killed nine updates later
    ]);
    expect(settled).toBeGreaterThan(24); // thrown for 2 · 5.94 / 29.4 s, landed, braked by friction and 18.75 m/s²…
    expect(settled).toBeLessThan(due); // …before it is removed
    expect([agents[0].state, agents[0].body, p.hasBody(agents[0].body)]).toEqual(['gone', -1, false]);
    expect(p.count).toBe(1); // the floor
  });

  it('beyond corpseCap, are removed the oldest first, then in list order', () => {
    const p = withFloor();
    const agents = standing(
      p,
      [0, 1, 2, 3].map((i) => agent({ x: i * 2, z: 0 })),
    );
    killAgent(p, agents[2]);
    for (let k = 0; k < 5; k++) step(p, agents);
    [0, 1, 3].forEach((i) => killAgent(p, agents[i]));
    p.step(SIM);
    expect(updateCrowd(p, agents, SIM, { corpseCap: 2 }).removed).toEqual([0, 2]);
    expect(agents.map((a) => a.state)).toEqual(['gone', 'corpse', 'gone', 'corpse']);
  });
});

describe('the queues', () => {
  it('add at most spawnLimit bodies a step in list order, and remove leaving agents at the next update', () => {
    const p = withFloor();
    const agents = Array.from({ length: 60 }, (_, i) => agent({ x: (i % 10) * 2 - 9, z: Math.floor(i / 10) * 2 - 5 }));
    expect(CROWD_LIMITS.spawnLimit).toBe(25);
    const first = updateCrowd(p, agents, SIM);
    expect(first.added).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(step(p, agents).added).toEqual(Array.from({ length: 25 }, (_, i) => 25 + i));
    expect(step(p, agents).added).toEqual(Array.from({ length: 10 }, (_, i) => 50 + i));
    expect(agents.map((a) => a.body)).toEqual([...agents.map((a) => a.body)].sort((x, y) => x - y)); // ids in order
    [7, 3].forEach((i) => (agents[i].state = 'leaving'));
    expect(step(p, agents)).toEqual({ added: [], removed: [3, 7] });
    expect(p.count).toBe(59);
    const late = [...agents.filter((a) => a.state === 'alive'), agent({ x: 15, z: 15 })];
    expect(updateCrowd(p, late, SIM, { spawnLimit: 0 }).added).toEqual([]);
    expect(updateCrowd(p, late, SIM).added).toEqual([58]);
  });

  it('leave agents not in the world alone, and name the mistakes', () => {
    const p = withFloor();
    const queued = agent();
    expect([setVelocity(p, queued, [1, 0, 0], SIM), knockback(p, queued, [1, 0, 0])]).toEqual([false, false]);
    expect([launch(p, queued, 3), killAgent(p, queued)]).toEqual([false, false]);
    addAgent(p, queued);
    expect(() => addAgent(p, queued)).toThrow(/PHYSICS_BAD_ARGUMENT.*'queued'/);
    removeAgent(p, queued);
    expect([queued.state, queued.body, p.count]).toEqual(['gone', -1, 1]);
    expect(knockback(p, queued, [1, 0, 0])).toBe(false);
    const lost = agent();
    addAgent(p, lost);
    p.removeBody(lost.body);
    expect(() => updateCrowd(p, [lost], SIM)).toThrow(/PHYSICS_NO_BODY.*removeAgent/);
    expect(() => addAgent(p, agent({ radius: 0 }))).toThrow(/PHYSICS_BAD_ARGUMENT.*radius/);
    expect(() => setVelocity(p, agent(), [1, 0, 0], { dt: 0 })).toThrow(/PHYSICS_BAD_ARGUMENT.*dt/);
    expect(() => updateCrowd(p, [], SIM, { spawnLimit: 1.5 })).toThrow(/PHYSICS_BAD_ARGUMENT.*spawnLimit/);
  });
});

describe('the readback', () => {
  it('says grounded on the floor, not in a fall or at the top of a throw; a floor makes landing count at once', () => {
    const p = withFloor();
    const [a, b] = [agent({ x: 0, y: 3 }), agent({ x: 3, y: 3 })];
    updateCrowd(p, [a, b], SIM);
    const floor = () => 0;
    const seen: boolean[][] = [];
    for (let k = 0; k < 60; k++) {
      p.step(SIM);
      updateCrowd(p, [a], SIM);
      updateCrowd(p, [b], SIM, { floor });
      seen.push([a.grounded, b.grounded]);
    }
    const landed = (j: number) => seen.findIndex((s) => s[j]);
    expect(seen.slice(0, 20).every(([x, y]) => !x && !y)).toBe(true); // falling 3 m takes 0.45 s
    expect(landed(1)).toBeLessThanOrEqual(landed(0));
    expect(seen.slice(40).every(([x, y]) => x && y)).toBe(true);
    expect(CROWD_GROUNDED).toEqual({ speed: 0.375, height: 0.125, settle: 0.0625 });
    launch(p, a, 4);
    let apex = false;
    for (let k = 0; k < 30; k++) {
      step(p, [a]);
      if (Math.abs(a.vy) < CROWD_GROUNDED.speed) apex ||= !a.grounded;
    }
    expect(apex).toBe(true); // barely moving up or down at the top, still in the air
  });

  it('leaves the lost-body rescue to rescueLost, which puts a sunk agent back on its tile', () => {
    const p = withFloor();
    const [a] = standing(p, [agent({ x: 0.5, z: 0.5 })]);
    p.setBody(a.body, { position: [0.5, -5, 0.5] });
    const level: RescueLevel = { tile: 1, cols: 4, rows: 4, walkable: Array(16).fill(true), floor: Array(16).fill(0) };
    expect(rescueLost(p, level)).toEqual([a.body]);
    for (let i = 0; i < 30; i++) step(p, [a]);
    expect([a.x, a.z]).toEqual([0.5, 0.5]);
    expect(Math.abs(a.y)).toBeLessThan(0.01);
    expect(a.grounded).toBe(true);
  });
});

describe('captures', () => {
  it('restore a crowd mid-blast, corpses in the air, and continue exactly', () => {
    const run = (roundtrip: boolean) => {
      const p = withFloor();
      const agents = Array.from({ length: 40 }, (_, i) =>
        agent({ shape: i % 4 === 3 ? 'ball' : 'capsule', x: (i % 8) - 4, z: Math.floor(i / 8) - 2 }),
      );
      updateCrowd(p, agents, SIM);
      const toward = (a: CrowdAgent): [number, number, number] => [-a.x, 0, -a.z];
      for (let k = 0; k < 120; k++) {
        if (k === 60) agents.slice(0, 10).forEach((a) => (killAgent(p, a), launch(p, a, 6, 1.3)));
        if (k === 70 && roundtrip) {
          const capture = p.capture();
          p.restore({ ...capture, snapshot: Array.from(capture.snapshot) });
        }
        step(p, agents, toward);
      }
      return { state: Array.from(p.state()), agents: JSON.stringify(agents) };
    };
    const plain = run(false);
    expect(run(true)).toEqual(plain);
    expect(run(false)).toEqual(plain);
  });
});
