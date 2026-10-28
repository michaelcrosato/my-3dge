/**
 * @file Unit tests for engine/anim/bodyPlants.ts: the three plants attached in order under their prefix, a hold made
 * again following the one before; and `layPlants`: the foot plant weighed by the traversal's share and a clip's hold
 * of the legs, locked as the movement lets it, on the ground given, the traversal and the look handed on. That the
 * page and the feel kit pose alike through it is the courses' evidence (`node x feel labs/playground`, unchanged).
 * @see engine/anim/bodyPlants.ts
 */
import { describe, expect, it } from 'vitest';
import { attachPlants, layPlants } from './bodyPlants';
import { Animator } from './character';
import { MovementPose } from './locomotion/motion';
import { LookPose } from './traversal/hold';
import { TraversalPose } from './traversal/pose';

/** A body at rest, as the view keeps it: on the ground, nothing traversed, no look. */
const resting = () => ({ shown: new MovementPose(), traversal: new TraversalPose(), look: new LookPose() });

describe('a body’s plants', () => {
  it('attaches the foot plant, the traversal plant and the hold, in that order, a new hold following the last', () => {
    const hero = new Animator({ build: 'build:adult' });
    const plants = attachPlants(hero, 'view');
    expect([plants.plant.name, plants.traversal.name, plants.hold.name]).toEqual(['view:footPlant', 'view:traversal', 'view:hold']); // prettier-ignore
    expect([hero.layer('view:footPlant'), hero.layer('view:traversal'), hero.layer('view:hold')]).toEqual([plants.plant, plants.traversal, plants.hold]); // prettier-ignore
    plants.hold.drawn = 0.75;
    const again = attachPlants(new Animator({ build: 'build:adult' }), 'feel', plants.hold);
    expect(again.hold.drawn).toBe(0.75); // a new weapon's draw starts where the last stood
  });

  it('weighs the foot plant by the traversal and a clip, locks it as the movement lets it, and hands on the rest', () => {
    const hero = new Animator({ build: 'build:adult' });
    const plants = attachPlants(hero, 'view');
    const body = resting();
    const ground = () => false;
    layPlants(hero, plants, body, ground);
    expect([plants.plant.weight, plants.plant.locks, plants.plant.ground]).toEqual([1, true, ground]);
    expect([plants.traversal.pose, plants.hold.look, plants.hold.busy]).toEqual([body.traversal, null, 0]);
    layPlants(hero, plants, { ...body, motion: { mode: 'slide' } as never }, null, 0.25);
    expect([plants.plant.weight, plants.plant.locks, plants.plant.ground]).toEqual([0.75, false, null]); // a clip holds a quarter of the legs; no lock in a slide
  });
});
