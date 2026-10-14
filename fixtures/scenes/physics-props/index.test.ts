/**
 * @file Tests for the physics-props fixture (PLAN.md WP 4.1's Done-when, Node's half; `node x replay
 * tests/replays/physics-props.replay.json --browser sim` is Chromium's): the replay gives its goldens three times, and
 * they are the uninterrupted run's, so the in-place restore at step 90 (mid-ride, crates in the air) continues
 * exactly; the platform carries the hero, and whole-sim captures taken mid-ride and while the crates fall restore and
 * continue with the replay's hashes; the swing topples both stacks the same way every run; the zones report who
 * entered and left; the rescue puts the sunk barrel back on its walkable tile.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { physicsOf } from '../../../engine/physics/binding';
import { checkReplay, playReplay, type Replay } from '../../../engine/sim/replay';
import type { Session } from '../../../engine/sim/session';
import { tileAt } from '../../../engine/world/level/heights';
import { BARREL, CRATE, ROOM, STACKS } from './index';

const REPLAY = checkReplay(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../tests/replays/physics-props.replay.json'), 'utf8')),
);
const PLATFORM = `${process.platform}-${process.arch}`;
const GOLDEN = REPLAY.hashes[PLATFORM];

/** The replay without the change-points `drop` names. */
const without = (drop: (change: Replay['inputs'][number][1]) => boolean): Replay => ({
  ...REPLAY,
  inputs: REPLAY.inputs.filter(([, change]) => !drop(change)),
});

/** A session of the replay's scene at step 0, logging its events as `<tick> <type> <zone> <body>`. */
function start() {
  const { session } = playReplay(REPLAY, { until: 0, checkpoints: [] });
  const events: string[] = [];
  for (const type of ['enter', 'leave', 'rescued']) {
    session.world.events.on(type, (e) => {
      const { zone = '-', body } = e as { zone?: string; body: number };
      events.push(`${session.world.tick} ${type} ${zone} ${body}`);
    });
  }
  return { session, events };
}

/** Plays the replay's inputs on `session` up to step `to` (the swing at 60, the round trip at 90, the sink at 300). */
function drive(session: Session, to: number, options: { knock?: boolean } = {}): Record<number, string> {
  const hashes: Record<number, string> = {};
  for (let k = session.world.tick; k < to; k++) {
    if (k === 90) session.act('roundtrip');
    if (k === 300) session.act('sink');
    session.step(k === 60 && options.knock !== false ? { b: ['knock'] } : {});
    if ((k + 1) % 60 === 0) hashes[k + 1] = session.world.hash();
  }
  return hashes;
}

/** Every prop of a session: its component and its body's state. */
function props(session: Session) {
  const physics = physicsOf(session.world);
  return session.world.query('prop').map((e) => {
    const prop = e.prop as { body: number; kind: string; stack: number; level: number };
    return { ...prop, ...physics.readBody(prop.body) };
  });
}

/** The golden hashes after step `after`. */
const goldenAfter = (after: number) =>
  Object.fromEntries(Object.entries(GOLDEN).filter(([k]) => +k > after && +k % 60 === 0));

describe('the physics-props fixture', () => {
  it('gives its replay’s goldens three times, and they are the run without the in-place restore at step 90', () => {
    expect(GOLDEN, `goldens for ${PLATFORM}`).toBeDefined();
    for (let run = 0; run < 3; run++) expect(playReplay(REPLAY).hashes).toEqual(GOLDEN);
    expect(REPLAY.inputs.some(([at, change]) => at === 90 && change.dev === 'roundtrip')).toBe(true);
    expect(playReplay(without((change) => change.dev === 'roundtrip')).hashes).toEqual(GOLDEN);
    expect(drive(start().session, 600)).toEqual(goldenAfter(0)); // drive() is the replay
  });

  it('carries the hero on the platform 6 m east and back, its feet within 1 cm of the platform’s top all the way', () => {
    const { session } = start();
    const w = session.world;
    const physics = physicsOf(w);
    const platform = (w.query('platform')[0].platform as { body: number }).body;
    let [worst, east, air] = [0, 0, 0];
    for (let k = 0; k < 600; k++) {
      drive(session, k + 1);
      const hero = w.query('actor')[0].actor as { x: number; y: number; z: number; grounded: boolean };
      const top = physics.readBody(platform).position.add({ x: 0, y: 0.2, z: 0 });
      worst = Math.max(worst, Math.hypot(hero.x - top.x, hero.y - top.y, hero.z - top.z));
      east = Math.max(east, hero.x - 3);
      if (!hero.grounded) air++;
    }
    expect(worst).toBeLessThan(0.01);
    expect(east).toBeCloseTo(6, 2);
    expect(air).toBeLessThanOrEqual(1); // the first step, before it first stands
  });

  it('restores whole-sim captures taken mid-ride and while the crates fall, and continues with the replay’s hashes', () => {
    for (const at of [75, 90, 150]) {
      const { session } = start();
      drive(session, at);
      const hero = (session.world.query('actor')[0].actor as { x: number }).x;
      expect(hero - 3, `riding at step ${at}`).toBeGreaterThan(0.1);
      const falling = props(session).filter((p) => p.kind === 'crate' && p.velocity.length() > 0.5);
      if (at < 150) expect(falling.length, `crates falling at step ${at}`).toBeGreaterThanOrEqual(3);
      const capture = session.capture();
      drive(session, 400);
      session.restore(capture);
      expect(session.world.tick).toBe(at);
      expect(drive(session, 600)).toEqual(goldenAfter(at));
    }
  });

  it('topples both stacks with the swing, the same way every run; without it they stand, asleep', () => {
    const standing = (session: Session) => props(session).filter((p) => p.kind === 'crate');
    const at60 = start().session;
    drive(at60, 60);
    for (const crate of standing(at60)) {
      const { x, z } = STACKS[crate.stack];
      expect(crate.position.distanceTo({ x, y: CRATE * (crate.level + 0.5), z })).toBeLessThan(0.01);
      expect(crate.sleeping).toBe(true);
    }
    const runs = [0, 1].map(() => {
      const { session } = start();
      drive(session, 240);
      return standing(session);
    });
    expect(runs[1].map((p) => p.position.toArray())).toEqual(runs[0].map((p) => p.position.toArray()));
    const stood = (p: (typeof runs)[0][number]) => ({ ...STACKS[p.stack], y: CRATE * (p.level + 0.5) });
    const moved = runs[0].filter((p) => p.position.distanceTo(stood(p)) > 0.5);
    const fallen = runs[0].filter((p) => p.position.y < stood(p).y - 0.3);
    expect(moved.length).toBe(6); // all but the bottom crate of the stack the swing struck
    expect(fallen.length).toBeGreaterThanOrEqual(4);
    expect(new Set(fallen.map((p) => p.stack))).toEqual(new Set([0, 1]));
    expect(runs[0].every((p) => p.sleeping)).toBe(true); // at rest again by step 240
    const quiet = start().session;
    drive(quiet, 240, { knock: false });
    expect(standing(quiet).map((p) => p.position.toArray())).toEqual(standing(at60).map((p) => p.position.toArray()));
  });

  it('reports who entered and left the zones, and rescues the sunk barrel onto its walkable tile', () => {
    const { session, events } = start();
    const ids = Object.fromEntries(props(session).map((p) => [`${p.kind}${p.stack}${p.level}`, p.body]));
    const hero = (session.world.query('actor')[0].actor as { body: number }).body;
    const platform = (session.world.query('platform')[0].platform as { body: number }).body;
    drive(session, 330);
    const barrel = props(session).find((p) => p.kind === 'barrel')!;
    expect(barrel.position.y, 'falling through the floor').toBeLessThan(-3);
    drive(session, 400);
    const pit = events.filter((line) => line.includes(' pit '));
    expect(pit.every((line) => line.includes('enter'))).toBe(true);
    expect(new Set(pit.map((line) => +line.split(' ')[3]))).toEqual(
      new Set(
        Object.entries(ids)
          .filter(([name]) => name.startsWith('crate'))
          .map(([, id]) => id)
          .filter((id) => id !== ids.crate00),
      ),
    );
    expect(events.filter((line) => line.includes(' gate '))).toEqual([
      expect.stringMatching(new RegExp(`^\\d+ enter gate ${platform}$`)),
      expect.stringMatching(new RegExp(`^\\d+ enter gate ${hero}$`)),
      expect.stringMatching(new RegExp(`^\\d+ leave gate ${hero}$`)),
      expect.stringMatching(new RegExp(`^\\d+ leave gate ${platform}$`)),
    ]);
    const rescued = events.filter((line) => line.includes('rescued'));
    expect(rescued).toEqual([expect.stringMatching(new RegExp(`^3\\d\\d rescued - ${ids['barrel-10']}$`))]);
    const back = props(session).find((p) => p.kind === 'barrel')!;
    const tile = tileAt(ROOM, back.position.x, back.position.z)!;
    expect(ROOM.walkable[tile.row * ROOM.cols + tile.col]).toBe(true);
    expect(back.position.x).toBeCloseTo(BARREL[0], 2); // its own tile's centre
    expect(back.position.z).toBeCloseTo(BARREL[1], 2);
    expect(back.position.y).toBeCloseTo(0.4375, 2); // standing on the floor
    expect(back.velocity.length()).toBeLessThan(0.01);
  });
});
