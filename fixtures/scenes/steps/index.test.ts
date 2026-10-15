/**
 * @file Tests for the steps fixture (PLAN.md WP 3.2; the box rule's fixture test for the character controller): the
 * scene runs in a recorded session with the box hero driven by intents across the one-box floor (it runs, jumps,
 * lands and dashes, each an event), gives the same hashes on every run and when its recording is played back, its
 * recording is tests/replays/steps.replay.json and gives that replay's goldens (`node x replay
 * tests/replays/steps.replay.json --browser sim` is Chromium's half), and it turns its shuttle round every 2 s; the
 * course is built in a fixed order, so its bodies keep their ids.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { physicsOf } from '../../../engine/physics/binding';
import { checkReplay, playReplay } from '../../../engine/sim/replay';
import { createSession } from '../../../engine/sim/session';
import type { ActorComponents } from '../../../engine/sim/actors';
import { createPhysics } from '../../../engine/physics/world';
import { buildCourse, HERO } from './index';

const REPLAY = checkReplay(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../tests/replays/steps.replay.json'), 'utf8')),
);
const PLATFORM = `${process.platform}-${process.arch}`;

/** Steps the scene: stand, run east, jump (held), run on, dash, stand. */
function play(seed = 1) {
  const session = createSession('steps', { seed });
  const script = [
    ...Array.from({ length: 10 }, () => ({})),
    ...Array.from({ length: 60 }, () => ({ move: [1, 0] })),
    ...Array.from({ length: 40 }, () => ({ move: [1, 0], b: ['jump'] })),
    ...Array.from({ length: 20 }, () => ({ move: [1, 0] })),
    { b: ['dash'] },
    ...Array.from({ length: 50 }, () => ({})),
  ];
  const hashes = script.map((intents) => {
    session.step(intents);
    return session.world.hash();
  });
  return { session, hashes };
}

describe('the steps fixture', () => {
  it('runs the box hero by intents: it runs, jumps, lands and dashes, each an event', () => {
    const { session } = play();
    const types = session.world.events.trace().map((record) => record.type);
    expect(types.filter((type) => type === 'jump')).toHaveLength(1);
    expect(types.filter((type) => type === 'land')).toHaveLength(1);
    expect(types.filter((type) => type === 'dash')).toHaveLength(1);
    const [hero] = session.world.query('actor') as unknown as ActorComponents[];
    expect(hero.actor.character).toEqual(HERO);
    expect(hero.actor.x).toBeGreaterThan(2 + 10 + 3);
    expect(hero.actor.grounded).toBe(true);
  });

  it('gives the same hashes on every run and when its recording is played back', () => {
    const first = play();
    expect(play().hashes).toEqual(first.hashes);
    const replay = first.session.record();
    const played = playReplay(replay, { checkpoints: 'every' }).hashes;
    expect(played[String(first.hashes.length)]).toBe(first.hashes.at(-1));
    expect(played['70']).toBe(first.hashes[69]);
  });

  it('records the steps replay, which gives its goldens three times', () => {
    const { session } = play();
    expect(session.record().inputs).toEqual(REPLAY.inputs);
    const golden = REPLAY.hashes[PLATFORM];
    expect(golden, `goldens for ${PLATFORM}`).toBeDefined();
    for (let run = 0; run < 3; run++) expect(playReplay(REPLAY).hashes).toEqual(golden);
  });

  it('turns its shuttle round every 2 s, and builds its course with the same ids every time', () => {
    const session = createSession('steps');
    const x = () => physicsOf(session.world).readBody(5).position.x;
    for (let i = 0; i < 120; i++) session.step({});
    expect(x()).toBeCloseTo(8, 3);
    for (let i = 0; i < 120; i++) session.step({});
    expect(x()).toBeCloseTo(4, 3);
    const physics = createPhysics();
    const course = buildCourse(physics);
    expect([course.oneWay.body, course.crate.body, course.platform.body]).toEqual([3, 4, 5]);
    expect(physics.count).toBe(6);
    physics.dispose();
  });
});
