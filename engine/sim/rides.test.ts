/**
 * @file Tests for rides in a running scene (engine/sim/rides.ts): a scene with none rides nothing (`ridesOf` is
 * undefined); a zipline stands a fixed pole under each anchor down to the floor (none under a balloon's line), a solid
 * launcher a box under its top, a level's ladder glyphs their ladders, each an entity whose component holds its spec;
 * `ridesOf` gives them in id order with each launcher's volume and top; a player on the shooter model uses the
 * zipline by the step's intents (`interact`) and rides it, the same hash on every run, and a capture taken mid-ride
 * restores (from text too) and rides on with the uninterrupted run's hashes; a launcher sets it off with the event
 * `launch`; a site's ladders stand where its structures do, turned with them.
 * @see engine/sim/rides.ts
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createRegistry } from '../core/registry';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { compileLevel } from '../world/level/compile';
import { defineLevel } from '../world/level/level';
import { defineSite, getSite } from '../world/site';
import { defineActorKinds, spawnActor, type ActorComponents } from './actors';
import type { WorldCapture } from './capture';
import { addLadder, addLauncher, addLevelLadders, addSiteLadders, addZipline, ridesOf } from './rides';
import { defineScene, startScene } from './scene';

/** A level with a ladder up its north wall. */
const YARD = '---\ndescription: A yard with a ladder.\ntile: 0.5\n---\n#####\n#@|.#\n#...#\n#####\n';
const LEVEL = compileLevel(YARD, { file: 'yard.txt' });

/** A registry with a scene `yard`: a 60 × 60 m floor, a player on `movement:apex` under a zipline, a balloon, a pad. */
function yard(rides = true) {
  const registry = createRegistry();
  defineActorKinds(registry);
  defineScene(
    'yard',
    {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [60, 1, 60] }, position: [0, -0.5, 0] }] }); // prettier-ignore
        spawnActor(w, { at: [0.5, 0, 2], character: createCharacter({ movement: 'movement:apex' }) });
        if (!rides) return;
        addZipline(w, { from: [0, 3.5, 1], to: [0, 2.5, 21] });
        addZipline(w, { from: [10, 0, 0], to: [10, 30, 0], balloon: true });
        addLauncher(w, { at: [-5, 0.5, 5], size: [2, 2], reach: 0.6, velocity: [0, 8, 0], mesh: 'trampoline', solid: true }); // prettier-ignore
        addLevelLadders(w, LEVEL);
      },
    },
    registry,
  );
  return registry;
}

/** The player of a world. */
const player = (w: { query(name: string): unknown[] }) => (w.query('actor') as (ActorComponents & { id: number })[])[0]; // prettier-ignore

describe('rides', () => {
  it('none in a scene without them', () => {
    const { world } = startScene('yard', { registry: yard(false) });
    expect(ridesOf(world)).toBeUndefined();
    expect(() => addLadder(world, { top: 'high' })).toThrow(/CORE_BAD_SPEC.*addLadder\(spec\)/); // named in its refusal
  });

  it('stand their poles, solid launchers and level ladders, and give them in id order', () => {
    const { world } = startScene('yard', { registry: yard() });
    world.step({}); // queries see the bodies from the first step on
    const physics = physicsOf(world);
    expect(physics.raycast([-1, 1, 1], [1, 0, 0], { maxDistance: 2 })?.distance).toBeCloseTo(1 - 0.06, 3); // the pole
    expect(physics.raycast([-5, 2, 5], [0, -1, 0], { maxDistance: 3 })?.point.y).toBeCloseTo(0.5, 4); // the mat's box
    expect(physics.raycast([9, 1, 0], [1, 0, 0], { maxDistance: 2 })).toBeNull(); // no pole on a balloon's line
    const rides = ridesOf(world)!;
    expect(rides.cables.map((c) => [c.from, c.balloon])).toEqual([
      [[0, 3.5, 1], false],
      [[10, 0, 0], true],
    ]);
    expect(rides.launchers).toEqual([
      { id: expect.any(Number), min: [-6, 0.45, 4], max: [-4, 1.1, 6], top: 0.5, velocity: [0, 8, 0], bounce: 0, keep: true }, // prettier-ignore
    ]);
    expect(rides.ladders.map((l) => [l.top, l.normal])).toEqual([[3, [0, 1]]]);
    const ids = [...rides.cables, ...rides.launchers, ...rides.ladders].map((ride) => ride.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(world.get(rides.cables[0].id)).toMatchObject({ zipline: { feet: [0, 0], poles: true } }); // its poles on the ground
  });

  it('stand a site’s ladders where its structures stand, turned with them (WP 13.15)', () => {
    const registry = createRegistry();
    defineActorKinds(registry);
    defineLevel('level:yard', { text: YARD, file: 'yard.txt' }, registry);
    defineSite('site:yard', { structures: [{ level: 'level:yard', at: [10, 2, 4], turn: 1 }] }, registry);
    defineScene('yard-site', { physics: true, setup: (w) => void addSiteLadders(w, getSite('site:yard', registry)) }, registry); // prettier-ignore
    const { world } = startScene('yard-site', { registry });
    // In its own frame (1.25, 0, 0.6), off the north wall and facing south; a quarter turned, off the west wall, east.
    const [ladder] = ridesOf(world)!.ladders;
    expect([ladder.foot, ladder.top, ladder.normal, ladder.width]).toEqual([[10.6, 2, 2.75], 5, [1, 0], 0.5]);
  });

  it('are ridden by a player through the step’s intents, the same hash every run, and on after a restore', () => {
    const run = (stop?: number) => {
      const { world } = startScene('yard', { registry: yard() });
      const hashes: string[] = [];
      for (let k = 0; k < 90; k++) {
        if (k === stop) return world;
        world.step({ look: [-Math.PI / 2, 0], ...(k === 5 ? { b: ['interact'], p: ['interact'] } : {}) });
        hashes.push(world.hash());
      }
      return hashes;
    };
    const hashes = run() as string[];
    expect(run()).toEqual(hashes);
    const world = run(40) as ReturnType<typeof startScene>['world'];
    expect(player(world).motion?.mode).toBe('zipline');
    const capture = world.capture();
    const text = serialize(capture as unknown as Canonical);
    for (const restore of [capture, deserialize(text) as unknown as WorldCapture]) {
      world.restore(restore);
      const after: string[] = [];
      for (let k = 40; k < 90; k++) {
        world.step({ look: [-Math.PI / 2, 0] });
        after.push(world.hash());
      }
      expect(after).toEqual(hashes.slice(40));
    }
  });

  it('set a player off a launcher, with the event launch', () => {
    const { world } = startScene('yard', { registry: yard() });
    for (let k = 0; k < 10; k++) world.step({});
    const me = player(world);
    for (let k = 0; k < 120 && !world.events.trace().some((r) => r.type === 'launch'); k++) world.step({ move: [-0.7, 0.4] }); // prettier-ignore
    const launch = world.events.trace().find((r) => r.type === 'launch')?.payload as { id: number; at: number[] };
    expect(launch).toEqual({ id: me.id, at: [expect.any(Number), expect.any(Number), expect.any(Number)] }); // its feet
  });
});
