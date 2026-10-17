/**
 * @file Tests for actors (engine/sim/actors.ts): a player actor walks, jumps and dashes by the step's intents and
 * emits `jump`, `land` and `dash`; an AI actor by the intents written into its component, presses taken from the edges
 * of `b`; the systems run in their phases (`anim` before `physics`, then `readback`); the same run gives the same hash;
 * a capture taken mid-jump restores (from text too) and continues with the uninterrupted run's hashes, Rapier's
 * controller rebuilt; `oneWay` entities make one-way platforms; `removeActor` removes body and entity; `measureFeel`
 * is the same number for number on every run and `__engine.feel()` reports it.
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../app/headless';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createRegistry } from '../core/registry';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { defineActorKinds, removeActor, spawnActor, type ActorComponents } from './actors';
import { measureFeel } from './feelCourse';
import { defineScene, startScene } from './scene';
import type { WorldCapture } from './capture';

/** A registry with the actor kinds and a scene `yard`: a 60 × 60 m floor, a player at the origin, an AI at x 5. */
function yard() {
  const registry = createRegistry();
  defineActorKinds(registry);
  defineScene(
    'yard',
    {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({
          type: 'fixed',
          colliders: [{ shape: { type: 'box', size: [60, 1, 60] }, position: [0, -0.5, 0] }],
        });
        physicsOf(w).addBody({
          type: 'fixed',
          colliders: [{ shape: { type: 'box', size: [4, 0.2, 4] }, position: [0, 1.1, 10] }],
        });
        spawnActor(w, { at: [0, 0, 0], character: createCharacter() });
        spawnActor(w, { at: [5, 0, 0], character: createCharacter(), player: false });
        w.spawn({ oneWay: { body: 1 } });
      },
    },
    registry,
  );
  return registry;
}

/** The actors of a world, by id. */
const actors = (w: { query(name: string): unknown[] }) => w.query('actor') as (ActorComponents & { id: number })[];

describe('actors', () => {
  it('move by the step’s intents (player) or their own (AI), in the phases anim and readback, with events', () => {
    const { world } = startScene('yard', { registry: yard() });
    expect(world.systems.list().map((s) => `${s.phase}:${s.name}`)).toEqual([
      'intents:scene',
      'anim:actors',
      'physics:physics',
      'readback:actors.readback',
    ]);
    const [player, ai] = actors(world);
    for (let i = 0; i < 10; i++) world.step({});
    for (let i = 0; i < 60; i++) world.step({ move: [1, 0] });
    expect(player.actor.x).toBeGreaterThan(5);
    expect(ai.actor.x).toBeCloseTo(5, 3);
    ai.actor.intents = { move: [0, 1], b: ['jump'] };
    world.step({ b: ['jump'], p: ['jump', 'dash'] }); // a bare world: presses are given (a session adds the edges)
    const types = world.events.trace().map((record) => record.type);
    expect(types.filter((type) => type === 'jump')).toHaveLength(2);
    expect(types).toContain('dash');
    expect(ai.actor.held).toEqual(['jump']);
    world.step({});
    expect(ai.actor.jumpAge).toBe(-1); // held, not pressed again: no second buffered press
    for (let i = 0; i < 60; i++) world.step({});
    expect(world.events.trace().filter((record) => record.type === 'land')).toHaveLength(2);
    expect(ai.actor.z).toBeGreaterThan(1);
  });

  it('give the same hash on every run, and continue exactly after a restore taken mid-jump, from text too', () => {
    const registry = yard();
    const script = (k: number) =>
      k < 40
        ? { move: [1, 0.5] }
        : k < 50
          ? { b: ['jump'], p: k === 40 ? ['jump'] : [] }
          : { move: [-1, 0], p: ['dash'] };
    const run = () => {
      const { world } = startScene('yard', { registry, seed: 4 });
      const hashes: string[] = [];
      for (let k = 0; k < 120; k++) {
        world.step(script(k) as never);
        hashes.push(world.hash());
      }
      return hashes;
    };
    const golden = run();
    expect(run()).toEqual(golden);
    const { world } = startScene('yard', { registry, seed: 4 });
    for (let k = 0; k < 45; k++) world.step(script(k) as never);
    expect(actors(world)[0].actor.grounded).toBe(false);
    const capture = world.capture();
    const text = serialize(capture as unknown as Canonical);
    for (let k = 45; k < 90; k++) world.step(script(k) as never);
    for (const restore of [capture, deserialize(text) as unknown as WorldCapture]) {
      world.restore(restore);
      for (let k = 45; k < 120; k++) {
        world.step(script(k) as never);
        expect(world.hash(), `step ${k + 1}`).toBe(golden[k]);
      }
    }
  });

  it('make a body a one-way platform with the component oneWay, and remove body and entity together', () => {
    const { world } = startScene('yard', { registry: yard() });
    const [player] = actors(world);
    const body = player.actor.body;
    for (let i = 0; i < 200 && player.actor.z < 7; i++) world.step({ move: [0, 1] });
    world.step({ move: [0, 1], b: ['jump'], p: ['jump'] });
    for (let i = 0; i < 30; i++) world.step({ move: [0, 1], b: ['jump'] });
    for (let i = 0; i < 30; i++) world.step({});
    expect(player.actor.y).toBeCloseTo(1.2, 2); // up through the platform's edge at z 8, then on it
    removeActor(world, player.id);
    world.step({});
    expect(world.has(player.id)).toBe(false);
    expect(physicsOf(world).hasBody(body)).toBe(false);
    expect(() => removeActor(world, player.id)).toThrow(/SIM_BAD_ARGUMENT/);
  });
});

describe('the feel', () => {
  it('is measured the same on every run, and __engine.feel() reports it', async () => {
    const character = createCharacter({ speed: 5 });
    const feel = measureFeel(character, { gravity: 32 });
    expect(measureFeel(character, { gravity: 32 })).toEqual(feel);
    const engine = await createHeadless({ scene: 'yard', registry: yard() });
    const report = (engine as unknown as { feel(id?: number): unknown }).feel();
    expect(report).toEqual(measureFeel(createCharacter(), { gravity: 32 }));
    expect(() => (engine as unknown as { feel(id?: number): unknown }).feel(9)).toThrow(/SIM_BAD_ARGUMENT.*1, 2/);
  });
});
