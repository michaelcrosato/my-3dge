/**
 * @file Tests for reactions and secondary motion as components (engine/sim/reactions.ts, WP 7.8): the components
 * start at rest (`Reactions.save()`'s state, no hair, cape or tail); `reactTo` adds them at rest and saves what it
 * did; `stepReactions` walks a knockdown through its fall, its lie and the get-up its lying chooses, and leaves a body
 * at rest alone; an actor's reactions are stepped by `actors.anim`, which lays what they tell the body over its
 * states; a capture taken mid-knockdown restores and continues to the same hashes; a dead id is refused.
 */
import { describe, expect, it } from 'vitest';
import { REACTION, Reactions } from '../anim/reactions';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { Vector3 } from '../core/math';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { spawnActor, type ActorComponents } from './actors';
import type { WorldCapture } from './capture';
import { REACTION_FIELDS, SECONDARY_FIELDS, reactTo, stepReactions, type ReactionComponents } from './reactions';
import { defineScene, startScene } from './scene';
import { createWorld } from './world';

/** A floor and an animated actor at (1, 0, 2), facing +Z. */
const yard = defineScene('test:reactions-yard', {
  physics: true,
  setup(w) {
    const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
    physicsOf(w).addBody({ type: 'fixed', colliders: [floor] });
    spawnActor(w, { at: [1, 0, 2], character: createCharacter(), anim: { build: 'build:heroic' } });
  },
});

type Body = ActorComponents & Partial<ReactionComponents> & { id: number };
const FRONT = new Vector3(0, 0, -1); // a blow from the front of a body facing +Z: it falls onto its back

describe('reactions and secondary motion as components', () => {
  it('starts both at rest', () => {
    const rest = new Reactions().save();
    const defaults = Object.fromEntries(Object.entries(REACTION_FIELDS).map(([key, field]) => [key, field.default]));
    expect(defaults).toEqual(rest);
    expect(SECONDARY_FIELDS.cape.default).toBe(false);
    const w = createWorld({ seed: 1 });
    const id = w.spawn({ secondary: {} });
    expect(w.get(id)!.secondary).toEqual({ hair: '', cape: false, tail: false, color: '#7a2430' });
  });

  it('adds the reactions at rest on the first reactTo, and saves what it did', () => {
    const w = createWorld({ seed: 1 });
    const id = w.spawn({});
    const state = reactTo(w, id, (r) => r.hit(new Vector3(1, 0, 0), 0));
    expect(w.get(id)!.reactions).toBe(state);
    expect(state.flinch[2]).toBeLessThan(0); // a blow travelling +X leans a body facing +Z to its left
    expect(state.playing).toBe('');
    expect(() => reactTo(w, 99, () => {})).toThrow(/SIM_BAD_ARGUMENT|a live id/);
  });

  it('steps a knockdown through its fall and lie to the get-up its lying chooses, and leaves a body at rest alone', () => {
    const w = createWorld({ seed: 1 });
    const id = w.spawn({});
    const state = reactTo(w, id, (r) => r.knockDown(FRONT, 0));
    expect([state.playing, state.lying]).toEqual(['down', 'up']);
    const told: string[] = [];
    for (let k = 0; k < 120; k++) {
      const body = JSON.stringify(stepReactions(state, w.dt));
      if (told.at(-1) !== body) told.push(body);
    }
    expect(told).toEqual([
      '{"down":1}',
      '{"down":0.5,"pose":"crouch"}', // getUpBack's sit-up, after REACTION.fall + REACTION.lie
      '{"down":0,"pose":"kneel"}',
      '{}',
    ]);
    expect(state.playing).toBe('');
    expect(REACTION.fall + REACTION.lie).toBeLessThan(120 * w.dt);
    const resting = JSON.stringify(new Reactions().save());
    const still = new Reactions().save();
    expect(stepReactions(still, w.dt)).toEqual({});
    expect(JSON.stringify(still)).toBe(resting);
  });

  it('lets actors.anim step an actor’s reactions and tell his body what they play', () => {
    const { world } = startScene(yard);
    world.step({});
    reactTo(world, 1, (r) => r.knockDown(FRONT, 0));
    for (let k = 0; k < 20; k++) world.step({});
    const hero = world.get(1) as unknown as Body;
    expect(hero.reactions!.playing).toBe('down');
    expect(hero.animator.state.weights.down).toBeGreaterThan(0.9); // the humanoid lies down: { down: 1 } reached it
    for (let k = 0; k < 120; k++) world.step({});
    expect(hero.reactions!.playing).toBe('');
    expect(hero.animator.state.weights.down).toBeLessThan(0.1);
  });

  it('restores a capture taken mid-knockdown and continues to the same hashes', () => {
    const { world: w } = startScene(yard);
    w.step({});
    reactTo(w, 1, (r) => r.hit(FRONT, 0, 2).knockDown(FRONT, 0));
    for (let k = 0; k < 30; k++) w.step({});
    const capture = deserialize(serialize(w.capture() as unknown as Canonical)) as unknown as WorldCapture;
    const hashes: string[] = [];
    for (let k = 0; k < 60; k++) w.step({});
    hashes.push(w.hash());
    w.restore(capture);
    for (let k = 0; k < 60; k++) w.step({});
    hashes.push(w.hash());
    expect(hashes[1]).toBe(hashes[0]);
  });
});
