/**
 * @file Unit tests for crowd bodies, sim-side (engine/sim/crowdBodies.ts, PLAN.md WP 5.7 core proposal): the first
 * step fills an empty state with the rig at rest; a humanoid's state is its animator's, stepped exactly as a lone
 * animator on the entity's stream steps it (its breathing phase drawn at the first step), in its build; a blob looks
 * along its velocity, is jolted by a kick and plays a move; a floater keeps its clock, turns to its travel and banks;
 * a quadruped's feet stand on the physics world's ground (up a curb), and it sits and wags when told; every step moves
 * the body to its point; a capture taken mid-run restores and continues to the same hash; and bad
 * input throws naming the fix.
 * @see engine/sim/crowdBodies.ts
 */
import { describe, expect, it } from 'vitest';
import { Animator, type AnimatorData } from '../anim/character';
import { STEP } from '../anim/humanoidRates';
import { GAIT_FOOT } from '../anim/proc/gait';
import type { QuadrupedState } from '../anim/quadruped';
import { Vector3 } from '../core/math';
import { physicsOf } from '../physics/binding';
import { stepCrowdBody, type CrowdBody } from './crowdBodies';
import { defineScene, startScene } from './scene';
import { createWorld, type World } from './world';

/** A world with one crowd body of `values`, and a system that steps it walking east at 2 m/s. */
function walking(values: Partial<CrowdBody>, seed = 1) {
  const w = createWorld({ seed }) as World<{ crowdBody: CrowdBody }>;
  const id = w.run((world) => world.spawn({ crowdBody: values as CrowdBody }));
  w.systems.add(
    'walk',
    (world) => {
      const body = world.get(id)!.crowdBody!;
      stepCrowdBody(world, id, body, {
        at: [body.x + 2 * world.dt, body.y, body.z],
        velocity: [2, 0, 0],
        yaw: Math.PI / 2,
      });
    },
    { phase: 'anim' },
  );
  return { w, id, body: () => w.get(id)!.crowdBody! };
}

describe('crowd bodies', () => {
  it('fills an empty state with the rig at rest on the first step, and moves the body to its point', () => {
    for (const rig of ['humanoid', 'blob', 'floater', 'quadruped'] as const) {
      const { w, body } = walking({ rig, x: 1, z: 2 });
      expect(body().state).toEqual({});
      w.step();
      expect(Object.keys(body().state).length, rig).toBeGreaterThan(5);
      expect([body().x, body().y, body().z]).toEqual([1 + 2 / 60, 0, 2]);
    }
    const { w, body } = walking({ rig: 'humanoid', look: 'build:heroic' });
    w.step();
    expect((body().state as unknown as AnimatorData).build).toBe('build:heroic');
    const plain = walking({ rig: 'humanoid' });
    plain.w.step();
    expect((plain.body().state as unknown as AnimatorData).build).toBe('build:chibi');
  });

  it('steps a humanoid as a lone animator on the entity’s stream steps it', () => {
    const { w, id, body } = walking({ rig: 'humanoid' }, 5);
    const twin = createWorld({ seed: 5 });
    const twinId = twin.run((world) => world.spawn({}));
    expect(twinId).toBe(id);
    const rng = twin.rng.entity(id, 'anim');
    const lone = new Animator({ rng, dt: twin.dt, clock: rng.next() * STEP.clockSpread });
    const velocity = new Vector3(2, 0, 0);
    for (let k = 0; k < 90; k++) {
      w.step();
      lone.step({ velocity, yaw: Math.PI / 2, air: false });
    }
    const data = body().state as unknown as AnimatorData;
    expect(data.started).toBe(true);
    expect(data.state).toEqual(JSON.parse(JSON.stringify(lone.body.state)));
    expect(data.state.weights.speed).toBeGreaterThan(0.3); // walking
    expect(body().yaw).toBe(Math.PI / 2);
  });

  it('turns a blob to look along its velocity, jolts it with a kick and plays a move', () => {
    const w = createWorld({ seed: 2 }) as World<{ crowdBody: CrowdBody }>;
    const id = w.run((world) => world.spawn({ crowdBody: { rig: 'blob', size: 0.375 } as CrowdBody }));
    const body = () => w.get(id)!.crowdBody!;
    w.run((world) => {
      for (let k = 0; k < 60; k++) stepCrowdBody(world, id, body(), { at: [0, 0, 0], velocity: [3, 0, 0] });
    });
    expect(body().yaw).toBeCloseTo(Math.PI / 2, 2); // looking east
    w.run((world) => stepCrowdBody(world, id, body(), { at: [0, 0, 0], blob: { kick: 6 } }));
    expect(body().state.squash).toBeGreaterThan(0.05); // stretched by the jolt
    w.run((world) => stepCrowdBody(world, id, body(), { at: [0, 0, 0], blob: { move: { name: 'leap', time: 0.13 } } }));
    expect(body().state.lift).toBeGreaterThan(0); // the leap lifts the body
  });

  it('keeps a floater’s clock, turns it to its travel and banks it into a turn', () => {
    const { w, body } = walking({ rig: 'floater' });
    w.step();
    const clock = body().state.clock as number;
    expect(clock).toBeGreaterThan(0);
    for (let k = 0; k < 60; k++) w.step();
    expect(body().state.clock).toBeCloseTo(clock + 1, 9);
    expect(body().yaw).toBeCloseTo(Math.PI / 2, 3); // told to face east, turning to it
    const turning = walking({ rig: 'floater' });
    turning.w.systems.remove('walk');
    turning.w.systems.add(
      'circle',
      (world) => {
        const t = world.time;
        const b = turning.body();
        stepCrowdBody(world, turning.id, b, {
          at: [0, 1.25, 0],
          velocity: [2 * Math.cos(t * 2), 0, -2 * Math.sin(t * 2)],
        });
      },
      { phase: 'anim' },
    );
    for (let k = 0; k < 120; k++) turning.w.step();
    expect(Math.abs(turning.body().state.bank as number)).toBeGreaterThan(0.1);
  });

  it('stands a quadruped’s feet on the physics world’s ground, up a curb, and sits and wags it when told', () => {
    const curb = (x: number) => (x >= 1.2 ? 0.15 : 0);
    const scene = defineScene(`test:crowd-quadruped-${Math.random()}`, {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }, { shape: { type: 'box', size: [10, 0.15, 20] }, position: [6.2, 0.075, 0] }] }); // prettier-ignore
        const id = w.spawn({ crowdBody: { rig: 'quadruped', yaw: Math.PI / 2 } });
        w.systems.add('dog', (world) => {
          const body = world.get(id)!.crowdBody as unknown as CrowdBody;
          const [x, still] = [Math.min(2.5, body.x + 2 * world.dt), world.time > 1.5];
          stepCrowdBody(world, id, body, { at: [x, curb(x), 0], velocity: [still ? 0 : 2, 0, 0], quadruped: { sit: world.time > 2, wag: 1 } }); // prettier-ignore
        }, { phase: 'anim' }); // prettier-ignore
      },
    });
    const w = startScene(scene).world as World<{ crowdBody: CrowdBody }>;
    const dog = () => w.query('crowdBody')[0].crowdBody!;
    for (let k = 0; k < 120; k++) w.step(); // walked up onto the curb, then stood
    const state = dog().state as unknown as QuadrupedState;
    for (let i = 0; i < 4; i++) {
      expect(state.gait.feet[i * GAIT_FOOT + 1]).toBeCloseTo(0.15, 6); // each paw on the curb
      expect(state.gait.feet[i * GAIT_FOOT + 12]).toBe(-1); // planted
    }
    expect(dog().yaw).toBeCloseTo(Math.PI / 2, 6);
    for (let k = 0; k < 60; k++) w.step();
    expect(state.sit).toBeGreaterThan(0.99);
    expect(state.wag).toBeGreaterThan(0.99);
  });

  it('restores a capture taken mid-run and continues to the same hash', () => {
    const run = walking({ rig: 'humanoid' }, 3);
    for (let k = 0; k < 30; k++) run.w.step();
    const capture = run.w.capture();
    for (let k = 0; k < 30; k++) run.w.step();
    const hash = run.w.hash();
    run.w.restore(capture);
    for (let k = 0; k < 30; k++) run.w.step();
    expect(run.w.hash()).toBe(hash);
    const dog = walking({ rig: 'quadruped' }, 3);
    for (let k = 0; k < 30; k++) dog.w.step();
    const mid = dog.w.capture();
    for (let k = 0; k < 30; k++) dog.w.step();
    const end = dog.w.hash();
    dog.w.restore(mid);
    for (let k = 0; k < 30; k++) dog.w.step();
    expect(dog.w.hash()).toBe(end);
  });

  it('throws naming the fix for a point that is not three numbers, or an entity that does not live', () => {
    const { w, id, body } = walking({ rig: 'blob' });
    expect(() => w.run((world) => stepCrowdBody(world, id, body(), { at: [0, Number.NaN, 0] }))).toThrow(
      /CORE_BAD_SPEC.*input\.at/,
    );
    expect(() => w.run((world) => stepCrowdBody(world, 99, body(), { at: [0, 0, 0] }))).toThrow(/CORE_BAD_SPEC.*99/);
  });
});
