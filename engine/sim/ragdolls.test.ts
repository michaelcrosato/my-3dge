/**
 * @file Unit tests for ragdolls in the sim (engine/sim/ragdolls.ts, PLAN.md WP 10.2's Done when): an actor handed off
 * falls the way it is pushed, onto its face pushed from behind and onto its back pushed from the front, its capsule
 * under its pelvis while it falls; its trunk lies still half a second, well before the longest fall, and it gets up
 * the way it lies (getUpFront or getUpBack), standing where it lay, facing as the humanoid lying so would (as it stood:
 * it fell straight), the ragdoll faded out and gone after `RAGDOLL_SIM.rise`, and it moves again; a push while it falls adds to every part, a killing one keeps it down; a dead one lies until removed,
 * and removing the actor takes its parts; the same hashes every run, and a capture mid-fall or mid-get-up restores
 * into a world that steps on exactly; a world without the system is refused.
 * @see engine/sim/ragdolls.ts
 */
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { joints } from '../physics/joints';
import { removeActor, spawnActor } from './actors';
import { addRagdolls, handOff, RAGDOLL_SIM, type RagdollState } from './ragdolls';
import type { ReactionState } from '../anim/reactions';
import { defineScene, startScene } from './scene';

/** A floor 40 m square and an adult at the origin facing +Z. */
const scene = defineScene('test:ragdolls', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult' } });
    addRagdolls(w);
  },
});

type Doll = {
  id: number;
  actor: { x: number; z: number; yaw: number };
  ragdoll?: RagdollState;
  reactions: ReactionState;
};

/** The scene, stepped once, its actor, and a step. */
function started() {
  const { world } = startScene(scene);
  world.step({});
  const doll = () => world.get(1) as unknown as Doll;
  const step = (intents = {}) => world.step(intents);
  return { world, doll, step };
}

/** Steps until the actor's ragdoll is gone (up and faded) or `limit` steps; returns how many it took. */
function untilUp(step: () => void, doll: () => Doll, limit = 600): number {
  for (let k = 1; k <= limit; k++) {
    step();
    if (!doll().ragdoll) return k;
  }
  return -1;
}

describe('ragdolls in the sim', () => {
  it('falls the way it is pushed and gets up the way it lies, standing where it lay', () => {
    for (const [push, lying, getUp] of [
      [[0, 1, 4], 'down', 'getUpFront'], // from behind, along its facing: onto its face
      [[0, 1, -4], 'up', 'getUpBack'], // from the front: onto its back
    ] as const) {
      const { world, doll, step } = started();
      const ragdoll = handOff(world, 1, { push });
      expect([ragdoll.bodies.length, ragdoll.joints.length, ragdoll.rise]).toEqual([11, 10, -1]);
      expect(doll().reactions.playing).toBe('down');
      let gotUp = -1;
      for (let k = 0; k < 400 && gotUp < 0; k++) {
        step();
        const r = doll().ragdoll!;
        if (r.rise >= 0) gotUp = k;
        else expect(Math.hypot(doll().actor.x - r.poses[0], doll().actor.z - r.poses[2])).toBeLessThan(1e-6); // under its pelvis
      }
      expect(gotUp).toBeGreaterThan(30); // it fell, then lay still half a second
      expect(gotUp).toBeLessThan(Math.round(RAGDOLL_SIM.longest * 60) - 1); // as its trunk came to rest, not at the last
      const r = doll().ragdoll!;
      expect(r.still).toBe(Math.round(RAGDOLL_SIM.settle * 60)); // its trunk lay still half a second
      expect([r.lying, r.bodies, doll().reactions.playing]).toEqual([lying, [], getUp]);
      expect(Math.sign(r.poses[2])).toBe(Math.sign(push[2])); // it fell the way it was pushed
      expect(Math.hypot(doll().actor.x - r.poses[0], doll().actor.z - r.poses[2])).toBeLessThan(0.5); // up where it lay
      expect(Math.abs(Math.atan2(Math.sin(doll().actor.yaw), Math.cos(doll().actor.yaw)))).toBeLessThan(0.6); // as it stood: it fell straight
      expect(untilUp(step, doll)).toBe(Math.round(RAGDOLL_SIM.rise * 60)); // faded out, then gone
      expect(joints(physicsOf(world))).toEqual([]);
      const at = doll().actor.x;
      for (let k = 0; k < 60; k++) step({ move: [1, 0] }); // its own again
      expect(doll().actor.x).toBeGreaterThan(at + 0.5);
    }
  }, 120_000);

  it('adds a second push to every part as it falls, and a killing one keeps it down until it is removed', () => {
    const { world, doll, step } = started();
    handOff(world, 1, { push: [0, 0.5, 2] });
    for (let k = 0; k < 5; k++) step();
    const physics = physicsOf(world);
    const before = doll().ragdoll!.bodies.map((id) => physics.readBody(id).velocity.x);
    handOff(world, 1, { push: [3, 0, 0], dead: true });
    doll().ragdoll!.bodies.forEach((id, i) => expect(physics.readBody(id).velocity.x).toBeCloseTo(before[i] + 3, 5));
    expect([doll().ragdoll!.dead, doll().reactions.playing]).toEqual([true, 'die']);
    for (let k = 0; k < 6 * 60; k++) step();
    expect(doll().ragdoll!.rise).toBe(-1); // still down, 6 s on
    const count = physics.count;
    removeActor(world, 1);
    expect([physics.count, joints(physics)]).toEqual([count - 12, []]); // its capsule and its 11 parts
  }, 120_000);

  it('refuses a world without the system ragdolls', () => {
    const bare = defineScene('test:ragdolls-bare', {
      physics: true,
      setup: (w) => void spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim: { build: 'build:adult' } }),
    });
    const { world } = startScene(bare);
    expect(() => handOff(world, 1)).toThrow(/addRagdolls/);
  });

  it('gives the same hashes every run, and goes on exactly from a capture mid-fall or mid-get-up', () => {
    const run = (n: number) => {
      const { world, step } = started();
      handOff(world, 1, { push: [1, 1.5, 3] });
      const hashes: string[] = [];
      for (let k = 0; k < n; k++) hashes.push((step(), world.hash()));
      return { world, hashes };
    };
    const a = run(200).hashes;
    expect(run(200).hashes).toEqual(a);
    for (const at of [20, 120]) {
      const half = run(at);
      const { world: fresh } = startScene(scene);
      fresh.restore(half.world.capture());
      for (let k = at; k < 200; k++) expect((fresh.step({}), fresh.hash())).toBe(a[k]);
    }
  }, 120_000);
});
