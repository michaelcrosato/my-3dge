/**
 * @file Unit tests for crowd bodies, sim-side (engine/sim/crowdBodies.ts, PLAN.md WP 5.7 core proposal): the first
 * step fills an empty state with the rig at rest; a humanoid's state is its animator's, stepped exactly as a lone
 * animator on the entity's stream steps it (its breathing phase drawn at the first step), in its build; a blob looks
 * along its velocity, is jolted by a kick and plays a move; a floater keeps its clock, turns to its travel and banks;
 * every step moves the body to its point; a capture taken mid-run restores and continues to the same hash; and bad
 * input throws naming the fix.
 * @see engine/sim/crowdBodies.ts
 */
import { describe, expect, it } from 'vitest';
import { Animator, type AnimatorData } from '../anim/character';
import { STEP } from '../anim/humanoid';
import { Vector3 } from '../core/math';
import { stepCrowdBody, type CrowdBody } from './crowdBodies';
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
    for (const rig of ['humanoid', 'blob', 'floater'] as const) {
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

  it('restores a capture taken mid-run and continues to the same hash', () => {
    const run = walking({ rig: 'humanoid' }, 3);
    for (let k = 0; k < 30; k++) run.w.step();
    const capture = run.w.capture();
    for (let k = 0; k < 30; k++) run.w.step();
    const hash = run.w.hash();
    run.w.restore(capture);
    for (let k = 0; k < 30; k++) run.w.step();
    expect(run.w.hash()).toBe(hash);
  });

  it('throws naming the fix for a point that is not three numbers, or an entity that does not live', () => {
    const { w, id, body } = walking({ rig: 'blob' });
    expect(() => w.run((world) => stepCrowdBody(world, id, body(), { at: [0, Number.NaN, 0] }))).toThrow(
      /CORE_BAD_SPEC.*input\.at/,
    );
    expect(() => w.run((world) => stepCrowdBody(world, 99, body(), { at: [0, 0, 0] }))).toThrow(/CORE_BAD_SPEC.*99/);
  });
});
