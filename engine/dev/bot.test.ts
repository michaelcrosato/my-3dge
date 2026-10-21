/**
 * @file Tests for the bot (engine/dev/bot.ts) in a maze fixture: it reaches the target tile round the maze's walls,
 * reports "stuck" when a body navigation does not know blocks the corridor (held, sidestepping, jumping, then given
 * up) and at once when no route leads to the goal; it plays the same steps twice, and its recording replays to the
 * same hash; a tour from its own stream comes back; the stop condition, the trace, the sweep's row and the seeds.
 */
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { spawnActor } from '../sim/actors';
import { addLevelBodies } from '../sim/levelBodies';
import { playReplay } from '../sim/replay';
import { defineScene } from '../sim/scene';
import { createSession } from '../sim/session';
import { compileLevel } from '../world/level/compile';
import { Bot, parseSeeds, runBot, sweepBot, type BotReport } from './bot';

/** The maze: one-metre corridors from the spawn `@` (north-west) to the far corner, round four walls. */
const MAZE_TEXT = `
#########
#@..#...#
###.#.#.#
#...#.#.#
#.###.#.#
#.....#.#
#########
`.trimStart();

const MAZE = compileLevel(MAZE_TEXT, { name: 'maze' });
const START = MAZE.spawns.find((spawn) => spawn.name === 'hero')!.position;
/** The target tile's centre: the south-east corner, 22 m of corridor from the spawn. */
const GOAL = { x: 7.5, z: 5.5 };

/** A maze scene: its walls, a player actor at the spawn, and a tall fixed box at `block` when given. */
function maze(id: string, block?: [number, number]) {
  return defineScene(id, {
    physics: true,
    setup(w) {
      const physics = physicsOf(w);
      addLevelBodies(physics, MAZE);
      if (block) {
        const box = { shape: { type: 'box', size: [1, 3, 1] }, position: [block[0], 1.5, block[1]] } as const;
        physics.addBody({ type: 'fixed', colliders: [box] });
      }
      spawnActor(w, { at: [START[0], START[1], START[2]], character: createCharacter({ speed: 5 }) });
    },
  });
}

const OPEN = maze('bot-test:maze');
/** The corridor down the middle (x 5.5) closed by a box the level does not hold. */
const BLOCKED = maze('bot-test:blocked', [5.5, 3.5]);

/** A run of `scene` with the bot (seed 1 unless given). */
function play(scene: typeof OPEN, plan: Parameters<typeof runBot>[2], seed = 1) {
  const session = createSession(scene, { seed });
  return { session, report: runBot(session, MAZE, plan) };
}

const near = (report: BotReport, x: number, z: number) => Math.hypot(report.at[0] - x, report.at[2] - z);

describe('the bot in a maze', () => {
  it('reaches the target tile round the walls, along the corridors', () => {
    const { report } = play(OPEN, { to: GOAL, trace: 10 });
    expect([report.status, report.reached, report.goals, report.reason]).toEqual(['arrived', 1, 1, null]);
    expect(near(report, GOAL.x, GOAL.z)).toBeLessThan(0.4);
    expect(report.steps).toBeGreaterThan(200); // some 20 m of corridor at 5 m/s, against 7.2 m as the crow flies
    expect(report.steps).toBeLessThan(900);
    // It went the long way: down the west side and up the middle corridor, never through a wall.
    const at = report.trace!.map((sample) => sample.at);
    expect(at.some(([x, , z]) => x < 2 && z > 4.5)).toBe(true);
    expect(at.some(([x, , z]) => Math.abs(x - 5.5) < 0.5 && z < 2)).toBe(true);
    for (const [x, , z] of at) expect(MAZE.solid[Math.floor(z) * MAZE.cols + Math.floor(x)], `${x}, ${z}`).toBe(false);
  });

  it('reports stuck when a body navigation does not know blocks the corridor', () => {
    const { report } = play(BLOCKED, { to: GOAL, trace: 6 });
    expect(report.status).toBe('stuck');
    expect(['held', 'no progress']).toContain(report.reason);
    expect(report.reached).toBe(0);
    // Pressed against the box from below (z > 4), it sidestepped and jumped before giving up, well inside the budget.
    expect(report.at[2]).toBeGreaterThan(3.9);
    expect(report.events.jump ?? 0).toBeGreaterThan(0);
    expect(report.steps).toBeLessThan(3600);
  });

  it('reports stuck at once when no route leads to the goal', () => {
    const pocket = compileLevel('#######\n#@.#..#\n#..#..#\n#######\n', { name: 'pocket' });
    const scene = defineScene('bot-test:pocket', {
      physics: true,
      setup(w) {
        addLevelBodies(physicsOf(w), pocket);
        spawnActor(w, { at: [1.5, 0, 1.5], character: createCharacter({ speed: 5 }) });
      },
    });
    const report = runBot(createSession(scene), pocket, { to: { x: 4.5, z: 1.5 } });
    expect([report.status, report.reason, report.steps]).toEqual(['stuck', 'no route', 0]);
  });

  it('plays the same steps twice, and its recording replays to the same hash', () => {
    const one = play(OPEN, { to: GOAL });
    const two = play(OPEN, { to: GOAL });
    expect(two.report).toEqual(one.report);
    const replay = one.session.record();
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(one.report.hash);
    expect(replay.inputs.length).toBe(15); // 16 headings: its intents change seldom
  });

  it('tours open tiles drawn from its own stream and comes back; another seed draws others', () => {
    const { report, session } = play(OPEN, { tour: 3, back: true, steps: 6000 });
    expect([report.status, report.reached, report.goals]).toEqual(['arrived', 4, 4]);
    expect(near(report, START[0], START[2])).toBeLessThan(0.4);
    expect(session.world.state().rng).toEqual({}); // the world's streams untouched
    const other = play(OPEN, { tour: 3, back: true, steps: 6000 }, 2).report;
    expect(other.status).toBe('arrived');
    expect(other.steps).not.toBe(report.steps);
  });

  it('stops at the stop condition or the budget, and samples its trace every n steps', () => {
    const stopped = play(OPEN, { to: GOAL, until: (world) => world.tick >= 30, trace: 10 }).report;
    expect([stopped.status, stopped.steps]).toEqual(['stopped', 30]);
    expect(stopped.trace!.map((sample) => sample.t)).toEqual([0, 10, 20]);
    expect(stopped.trace![1].move).toEqual([1, 0]); // east along the top
    const out = play(OPEN, { to: GOAL, steps: 50 }).report;
    expect([out.status, out.steps, out.trace]).toEqual(['timeout', 50, undefined]);
    expect(() => play(OPEN, { to: GOAL, until: 'actor' })).toThrow(/component\.field/);
    const none = play(OPEN, { to: GOAL, until: 'actor.player' }).report; // true on the player at once
    expect([none.status, none.steps]).toEqual(['stopped', 0]);
  });

  it('sweeps seeds from fresh sessions: one row for the scene, a run per seed', () => {
    const row = sweepBot(OPEN, '1-3', { to: GOAL }, { level: MAZE });
    expect([row.scene, row.seeds, row.arrived, row.stuck, row.runs.length]).toEqual(['bot-test:maze', [1, 2, 3], 3, 0, 3]); // prettier-ignore
    expect(row.worst).toBe(Math.max(...row.runs.map((run) => run.steps)));
    expect(() => sweepBot(OPEN, '1-3', { to: GOAL })).toThrow(/level/);
  });
});

describe('the bot itself', () => {
  it('heads down the flow field as one of 16 headings, straight at the goal near it, and says when it is there', () => {
    const bot = new Bot(MAZE).goTo(GOAL);
    expect(bot.next({ x: 1.5, z: 1.5 }, 1 / 60)).toEqual({ move: [1, 0] });
    expect(bot.next({ x: 7.5, z: 4.8 }, 1 / 60)).toEqual({ move: [0, 1] }); // within a metre: straight at it
    expect(bot.next({ x: 7.4, z: 5.4 }, 1 / 60)).toEqual({});
    expect([bot.status, bot.reason]).toEqual(['arrived', null]);
    expect(new Bot(MAZE).next({ x: 1.5, z: 1.5 }, 1 / 60)).toEqual({}); // idle: no goal
  });

  it('sidesteps when held along the way it wants, then jumps and tries the other side', () => {
    const bot = new Bot(MAZE, { headings: 0, stuck: 60, patience: 60 }).goTo(GOAL);
    const at = { x: 1.5, z: 1.5 };
    const moves = Array.from({ length: 140 }, () => bot.next(at, 1 / 60)); // never moving
    const angle = (i: number) => Math.atan2(moves[i].move![0], moves[i].move![1]);
    expect(angle(10)).toBeCloseTo(Math.PI / 2, 1); // east, not yet held long
    expect(angle(35)).toBeCloseTo(Math.PI / 2 + 1.3, 1); // held 0.45 s: a sidestep
    expect(angle(60)).toBeCloseTo(Math.PI / 2 + 2.2 - 2 * Math.PI, 1); // held 0.9 s: wider
    expect([moves[90].b, moves[91].b, moves[102].b, moves[103].b]).toEqual([undefined, ['jump'], ['jump'], undefined]); // held 1.5 s: a jump of 12 steps
    expect(angle(130)).toBeCloseTo(Math.PI / 2 - 1.3, 1); // held again: the other side
  });

  it('gives up a goal the watchdog sees no gain on, and one held too long', () => {
    const lazy = new Bot(MAZE, { patience: 1 }).goTo(GOAL);
    for (let i = 0; i < 70; i++) lazy.next({ x: 1.5, z: 1.5 }, 1 / 60);
    expect([lazy.status, lazy.reason]).toEqual(['stuck', 'no progress']);
    const held = new Bot(MAZE, { stuck: 1, patience: 60 }).goTo(GOAL);
    for (let i = 0; i < 70; i++) held.next({ x: 1.5, z: 1.5 }, 1 / 60);
    expect([held.status, held.reason]).toEqual(['stuck', 'held']);
  });
});

describe('parseSeeds', () => {
  it('reads ranges, counts and lists, and refuses the rest', () => {
    expect([parseSeeds('1-4'), parseSeeds('3'), parseSeeds('3,7,9'), parseSeeds(2), parseSeeds([5, 0])]).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3],
      [3, 7, 9],
      [1, 2],
      [5, 0],
    ]);
    for (const bad of ['', '4-1', 'a', '1-600', [1.5], 0, null]) expect(() => parseSeeds(bad), String(bad)).toThrow(/seeds like/); // prettier-ignore
  });
});
