/**
 * @file Tests for the dev actions (engine/sim/devActions.ts, run by engine/sim/session.ts) and their members
 * (engine/dev/actions.ts) in a yard: a player with health, a walker its AI drives and a crowd agent. Each of the
 * engine's five does what it says and is recorded so that a replay makes it again to the same hash; a scene's own
 * action wins; arguments are checked before anything changes; a throw leaves nothing, settings included;
 * `__engine.actions` lists and runs them and `__engine.bot` plays the player, through the recorded step or a sweep,
 * on a site too.
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createHeadless, headlessHost } from '../app/headless';
import { createRegistry } from '../core/registry';
import { CROWD_AGENT, CROWD_AGENT_FIELDS, setVelocity, updateCrowd, type CrowdAgent } from '../physics/crowd';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { spawnActor, type ActorComponent } from '../sim/actors';
import { damage, HEALTH, HEALTH_FIELDS, type Health } from '../sim/damage';
import { defineDevAction, findDevAction } from '../sim/devActions';
import { addLevelBodies, addSiteBodies } from '../sim/levelBodies';
import { playReplay } from '../sim/replay';
import { defineScene } from '../sim/scene';
import { createSession } from '../sim/session';
import { defineComponent } from '../sim/state';
import type { World } from '../sim/world';
import { defineLevel, getLevel } from '../world/level/level';
import { siteFloorBelow } from '../world/siteQueries';
import type { ActionRow } from './actions';
import type { BotReport, BotRow } from './bot';

defineLevel('level:dev-yard', {
  text: ['############', ...Array.from({ length: 10 }, (_, i) => (i === 1 ? '#.@........#' : '#..........#')), '############', ''].join('\n'), // prettier-ignore
});
const YARD = getLevel('level:dev-yard');
const START = YARD.spawns.find((spawn) => spawn.name === 'hero')!.position;

defineComponent('yardHealth', { description: 'The yard player’s health.', fields: HEALTH_FIELDS });
defineComponent('yardAgent', { description: 'The yard’s crowd agent.', fields: CROWD_AGENT_FIELDS });
defineComponent('yardMind', { description: 'How often the yard’s AI ran.', fields: { runs: { type: 'integer', default: 0, description: 'Runs.' } } }); // prettier-ignore

type Yard = { actor: ActorComponent; yardHealth: Health; yardAgent: CrowdAgent; yardMind: { runs: number } };

/** The yard's AI (phase `ai`): the walker walks east, the agent wants east at 3 m/s, and it counts its runs. */
function think(w: World): void {
  for (const e of w.query('yardMind') as unknown as Yard[]) e.yardMind.runs++;
  for (const { actor } of w.query('actor') as unknown as Yard[]) if (!actor.player) actor.intents = { move: [1, 0] };
  for (const { yardAgent } of w.query('yardAgent') as unknown as Yard[]) {
    if (yardAgent.state === 'alive') setVelocity(physicsOf(w), yardAgent, [3, 0, 0], w);
  }
}

/** The yard: its walls, the player at the spawn (entity 1), the walker (2), the agent (3), the AI's counter (4). */
const yard = defineScene('dev-test:yard', {
  level: 'level:dev-yard',
  physics: true,
  setup(w) {
    const physics = physicsOf(w);
    addLevelBodies(physics, YARD);
    const character = createCharacter({ speed: 5 });
    spawnActor(w, { at: [START[0], START[1], START[2]], character, components: { yardHealth: { ...HEALTH, hp: 10 } } }); // prettier-ignore
    spawnActor(w, { at: [2.5, 0, 6.5], character, player: false });
    w.spawn({ yardAgent: { ...CROWD_AGENT, x: 2.5, y: 0, z: 9.5 } });
    w.spawn({ yardMind: {} });
    w.systems.add('yard.think', think, { phase: 'ai' });
    w.systems.add('yard.crowd', (w) => void updateCrowd(physics, (w.query('yardAgent') as unknown as Yard[]).map((e) => e.yardAgent), w), { phase: 'readback' }); // prettier-ignore
  },
  actions: {
    /** The scene's own `spawn`, which wins over the engine's. */
    spawn(w) {
      w.spawn({ yardMind: { runs: -1 } });
    },
  },
});

const get = <K extends keyof Yard>(w: World, id: number, name: K) => (w.get(id) as unknown as Yard)[name];

describe("the engine's dev actions", () => {
  it('god: the player takes no hit while it is on, and takes them again off', () => {
    const session = createSession(yard);
    const hit = () => damage(session.world, { id: 1, health: get(session.world, 1, 'yardHealth') }, { amount: 3, from: [0, 0, 0] }); // prettier-ignore
    session.act('god');
    expect([hit(), get(session.world, 1, 'yardHealth').hp]).toEqual([null, 10]);
    session.act('god', { on: false });
    expect(hit()?.hp).toBe(7);
    session.act('god', { id: 2 });
    expect(session.world.get(2)).toHaveProperty('invulnerable');
    expect(() => session.act('god', { id: 99 })).toThrow(/SIM_NO_ACTOR|no live entity/);
  });

  it('freeze: the step skips the phase ai, and the walker and the agent stand; off, the AI runs again', () => {
    const session = createSession(yard);
    for (let i = 0; i < 40; i++) session.step();
    const runs = () => get(session.world, 4, 'yardMind').runs;
    expect([runs(), get(session.world, 3, 'yardAgent').vx]).toEqual([40, expect.closeTo(3, 1)]);
    session.act('freeze');
    const walker = get(session.world, 2, 'actor');
    expect(walker.intents).toEqual({});
    for (let i = 0; i < 40; i++) session.step();
    expect(runs()).toBe(40);
    expect(Math.hypot(walker.vx, walker.vz)).toBeLessThan(0.01);
    expect(Math.abs(get(session.world, 3, 'yardAgent').vx)).toBeLessThan(0.01);
    session.act('freeze', { on: false });
    session.step();
    expect(runs()).toBe(41);
    expect(session.record().inputs).toEqual([
      [40, { set: { 'ai.frozen': true }, dev: 'freeze' }],
      [80, { set: { 'ai.frozen': false }, dev: 'freeze', args: { on: false } }],
    ]);
  });

  it('spawn: the scene’s own wins; the engine’s fans count props before the player, on the floor', () => {
    const own = createSession(yard);
    own.act('spawn', { prop: 'prop:crate' });
    expect(own.world.query('sceneProp')).toHaveLength(0);
    const plain = defineScene('dev-test:plain', { level: 'level:dev-yard', physics: true, setup: yard.setup });
    const session = createSession(plain);
    session.act('spawn', { prop: 'prop:crate', count: 3, distance: 2 });
    const props = session.world.query('sceneProp') as unknown as { sceneProp: { prop: string; x: number; y: number; z: number } }[]; // prettier-ignore
    const { x, z } = get(session.world, 1, 'actor');
    expect(props.map((e) => e.sceneProp.prop)).toEqual(['prop:crate', 'prop:crate', 'prop:crate']);
    const bearings = props.map(({ sceneProp: p }) => Math.atan2(p.x - x, p.z - z));
    expect(bearings.map((b) => +b.toFixed(3))).toEqual([-0.4, 0, 0.4]); // the player faces +Z
    for (const { sceneProp: p } of props) {
      expect(Math.hypot(p.x - x, p.z - z)).toBeCloseTo(2, 5);
      expect(p.y).toBeCloseTo(0.375, 2); // the crate's centre, on the floor
    }
    for (let i = 0; i < 30; i++) session.step(); // the crates settle
    const replay = session.record();
    expect(replay.inputs).toEqual([[0, { dev: 'spawn', args: { prop: 'prop:crate', count: 3, distance: 2 } }]]);
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(session.world.hash());
  });

  it('travel: puts the player at a point at rest, facing yaw; a bad point changes nothing', () => {
    const session = createSession(yard);
    for (let i = 0; i < 20; i++) session.step({ move: [1, 0] });
    session.act('travel', { at: [8.5, 0, 8.5], yaw: 1 });
    const actor = get(session.world, 1, 'actor');
    expect([actor.x, actor.z, actor.yaw, actor.vx, actor.vz]).toEqual([8.5, 8.5, 1, 0, 0]);
    const before = session.world.hash();
    expect(() => session.act('travel', { at: [1, 2] })).toThrow(/a point \[x, y, z\]/);
    expect(session.world.hash()).toBe(before);
  });

  it('timeScale: sets the frame clock’s speed, a view setting, never recorded', async () => {
    const engine = await createHeadless({ scene: yard });
    (engine.actions as { run(name: string, args: unknown): unknown }).run('timeScale', { scale: 0.25 });
    expect(engine.timeScale()).toBe(0.25);
    expect(headlessHost(engine).session.record().inputs).toEqual([]);
  });

  it('are recorded, so the replay makes the same changes to the same hash', () => {
    const session = createSession(yard);
    const steps = (n: number, move?: [number, number]) => {
      for (let i = 0; i < n; i++) session.step(move ? { move } : {});
    };
    steps(10, [1, 0]);
    session.act('god');
    session.act('travel', { at: [6.5, 0, 3.5] });
    steps(10, [0, 1]);
    session.act('freeze');
    steps(10);
    session.act('freeze', { on: false });
    steps(10);
    const replay = session.record();
    expect(replay.inputs.filter(([, change]) => change.dev).map(([at, change]) => [at, change.dev])).toEqual([
      [10, 'god'],
      [10, 'travel'],
      [20, 'freeze'],
      [30, 'freeze'],
    ]);
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(session.world.hash());
  });

  it('check their args before anything changes, and name the actions there are for an unknown one', () => {
    const session = createSession(yard);
    const before = session.world.hash();
    expect(() => session.act('travel', {})).toThrow(/CORE_BAD_SPEC|at/);
    expect(() => session.act('god', { on: 'yes' })).toThrow(/on/);
    expect(() => session.act('trvel')).toThrow(/did you mean "?travel/);
    expect([session.world.hash(), session.record().inputs]).toEqual([before, []]);
  });

  it('leave nothing when one throws, its recorded settings included', () => {
    defineDevAction('explode', {
      help: 'Freezes the AI, then throws.',
      settings: () => ({ 'ai.frozen': true }),
      run() {
        throw new Error('boom');
      },
    });
    const session = createSession(yard);
    expect(() => session.act('explode')).toThrow('boom');
    expect([session.world.settings.get('ai.frozen'), session.record().inputs]).toEqual([false, []]);
    expect(() => defineDevAction('idle', { help: 'Nothing.' })).toThrow(/changes nothing/);
    expect(() => defineDevAction('Bad-name', { help: 'Bad.', run() {} })).toThrow(/camelCase/);
    expect(findDevAction(createRegistry(), 'god')).toBeUndefined(); // a registry without the kind finds none
  });
});

describe('__engine.actions and __engine.bot', () => {
  it('list the scene’s own actions, then the engine’s, with what each changes', async () => {
    const engine = await createHeadless({ scene: yard });
    const rows = (engine.actions as { list(): ActionRow[] }).list();
    expect(rows.map((row) => [row.name, row.from, row.changes])).toEqual([
      ['spawn', 'scene', 'sim'],
      ['explode', 'engine', 'sim'],
      ['freeze', 'engine', 'sim'],
      ['god', 'engine', 'sim'],
      ['timeScale', 'engine', 'settings'],
      ['travel', 'engine', 'sim'],
    ]);
    expect(rows.find((row) => row.name === 'travel')).toMatchObject({ args: 'at, yaw?, id?', help: expect.stringMatching(/at rest/) }); // prettier-ignore
    expect(engine.help()).toMatch(/actions\.run\(name, args\?\)/);
    expect(engine.help()).toMatch(/bot\(plan = \{\}\)/);
  });

  it('run one through the session, recorded, and refuse a call without a name', async () => {
    const engine = await createHeadless({ scene: yard });
    const actions = engine.actions as { run(name?: string, args?: unknown): { name: string; tick: number } };
    engine.step(5);
    expect(actions.run('travel', { at: [4.5, 0, 4.5] })).toEqual({ name: 'travel', tick: 5 });
    engine.step(1); // a change-point waits for the step that follows it
    const record = (engine.input as { record(): { inputs: unknown[] } }).record();
    expect(record.inputs).toContainEqual([5, { dev: 'travel', args: { at: [4.5, 0, 4.5] } }]);
    expect(() => actions.run()).toThrow(/DEV_BAD_ARGS|name/);
  });

  it('play the player with the bot through recorded steps; with seeds, sweep fresh runs and leave the run alone', async () => {
    const engine = await createHeadless({ scene: yard });
    const bot = engine.bot as (plan?: unknown) => BotReport | BotRow;
    const report = bot({ to: [{ x: 9.5, z: 9.5 }], trace: 30 }) as BotReport;
    expect([report.status, report.reached]).toEqual(['arrived', 1]);
    expect(engine.info().tick).toBe(report.steps);
    const recorded = (engine.input as { record(): { inputs: unknown[] } }).record();
    expect(recorded.inputs.length).toBeGreaterThan(0);
    const tick = engine.info().tick;
    const row = bot({ to: [{ x: 9.5, z: 2.5 }], seeds: '1-2' }) as BotRow;
    expect([row.scene, row.seeds, row.arrived]).toEqual(['dev-test:yard', [1, 2], 2]);
    expect(engine.info().tick).toBe(tick);
  });

  it('play the player on a site: a goal named with its height, reached through the front door (WP 13.15)', async () => {
    const site = defineFixtureSite();
    const lot = defineScene('dev-test:lot', {
      site: 'site:fixture-lot',
      physics: true,
      setup(w) {
        addSiteBodies(physicsOf(w), site);
        spawnActor(w, { at: [6, siteFloorBelow(site, 6, 10, 20)!, 20], character: createCharacter({ speed: 5 }) });
      },
    });
    const engine = await createHeadless({ scene: lot });
    const bot = engine.bot as (plan?: unknown) => BotReport;
    const report = bot({ to: [{ x: 10.75, y: 0, z: 12.75 }], back: true, steps: 3600 }); // the hall's marker
    expect([report.status, report.reached]).toEqual(['arrived', 2]);
  });
});
