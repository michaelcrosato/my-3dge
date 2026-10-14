/**
 * @file Tests for the physics-40 fixture (PLAN.md WP 3.1's Done-when, Node's half; `node x replay
 * tests/replays/physics-40.replay.json --browser sim` is Chromium's): the replay gives its goldens three times; they
 * are the uninterrupted run's, so the in-place restore at step 200 continues exactly; at step 200 bodies rest on
 * bodies; a whole-sim capture taken mid-run restores and continues with the replay's hashes; the push and the mid-run
 * gravity change both reach the bodies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReplay, playReplay, type Replay } from '../../../engine/sim/replay';
import { physicsOf } from '../../../engine/physics/binding';
import './index';

const REPLAY = checkReplay(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../tests/replays/physics-40.replay.json'), 'utf8')),
);
const PLATFORM = `${process.platform}-${process.arch}`;
const GOLDEN = REPLAY.hashes[PLATFORM];

/** The replay without the change-points `drop` names. */
const without = (drop: (change: Replay['inputs'][number][1]) => boolean): Replay => ({
  ...REPLAY,
  inputs: REPLAY.inputs.filter(([, change]) => !drop(change)),
});

describe('the physics-40 fixture', () => {
  it('gives its replay’s goldens three times', () => {
    expect(GOLDEN, `goldens for ${PLATFORM}`).toBeDefined();
    for (let run = 0; run < 3; run++) expect(playReplay(REPLAY).hashes).toEqual(GOLDEN);
  });

  it('continues exactly after the in-place restore at step 200: its goldens are the uninterrupted run’s', () => {
    expect(REPLAY.inputs.some(([at, change]) => at === 200 && change.dev === 'roundtrip')).toBe(true);
    expect(playReplay(without((change) => change.dev === 'roundtrip')).hashes).toEqual(GOLDEN);
  });

  it('has bodies resting on bodies at step 200', () => {
    const { world } = playReplay(REPLAY, { until: 200, checkpoints: [] }).session;
    const physics = physicsOf(world);
    const resting = world.query('piece').filter((e) => {
      const body = physics.readBody(e.piece.body as number);
      return body.position.y > 0.8 && body.velocity.length() < 0.05; // still, above the floor's layer: on a body
    });
    expect(resting.length).toBeGreaterThanOrEqual(10);
    expect(world.count).toBe(40);
  });

  it('restores a whole-sim capture taken mid-run, and continues with the replay’s hashes', () => {
    const { session } = playReplay(REPLAY, { until: 300, checkpoints: [] });
    const capture = session.capture();
    for (let k = 300; k < 450; k++) session.step({});
    session.restore(capture);
    expect(session.world.hash()).toBe(GOLDEN[300]);
    const hashes: Record<string, string> = {};
    for (let k = 300; k < REPLAY.steps; k++) {
      const set = REPLAY.inputs.find(([at, change]) => at === k && change.set)?.[1].set;
      for (const [path, value] of Object.entries(set ?? {})) session.set(path, value);
      session.step({});
      hashes[k + 1] = session.world.hash();
    }
    for (const k of [360, 420, 480, 540, 600]) expect(hashes[k], `step ${k}`).toBe(GOLDEN[k]);
  });

  it('lets the push and the gravity change reach the bodies', () => {
    const quiet = playReplay(without((change) => change.b !== undefined)).hashes;
    expect(quiet[240]).toBe(GOLDEN[240]);
    expect(quiet[300]).not.toBe(GOLDEN[300]);
    const flat = playReplay(without((change) => change.set !== undefined)).hashes;
    expect(flat[420]).toBe(GOLDEN[420]);
    expect(flat[480]).not.toBe(GOLDEN[480]);
  });
});
