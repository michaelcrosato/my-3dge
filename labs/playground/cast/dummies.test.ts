/**
 * @file Tests for the ring's sparring dummies (labs/playground/cast/dummies.ts) on a floor, the player before one: a
 * punch counts on it and rocks it away from the blow, leaning about its base, its points back, and it springs upright
 * again; a blast puts it down for its rise; the ring's three stand on its canvas in the site's ring scene.
 * @see labs/playground/cast/dummies.ts
 */
import { describe, expect, it } from 'vitest';
import { createSession } from '../../../engine/sim/session';
import { addInteraction, addMelee, defineScene, physicsOf, strikeEntity, type World } from '../../../engine/sim-api';
import { RING_DUMMIES, SPRING, standDummy, type Sparring } from './dummies';
import { spawnPlayer } from './player';

type Dummy = { sparring: Sparring; thing: { hits: number; hp: number; state: string; z0: number }; sceneProp: { body: number } }; // prettier-ignore

const ring = defineScene('dummies-test:ring', {
  physics: true,
  setup(w: World) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnPlayer(w, [0, 0, 0], 0); // 1, facing +Z
    standDummy(w, [0, 0, 1.3]); // 2
    addInteraction(w);
    addMelee(w);
  },
});

const steps = (session: ReturnType<typeof createSession>, n: number, intents = {}) => {
  for (let i = 0; i < n; i++) session.step(intents);
};

describe('the sparring dummies', () => {
  it('take a punch, rock away from it about their base with their points back, and spring upright again', () => {
    const session = createSession(ring, { seed: 1 });
    steps(session, 10);
    session.step({ b: ['melee'] });
    steps(session, 20); // the punch lands 0.35 s after the press
    const dummy = () => session.world.get(2) as unknown as Dummy;
    expect([dummy().thing.hits, dummy().thing.hp, dummy().thing.state]).toEqual([1, 2, 'up']);
    expect(dummy().sparring.vz).toBeGreaterThan(SPRING.kick * 0.9); // away from the blow, south
    steps(session, 10);
    const leaning = physicsOf(session.world).readBody(dummy().sceneProp.body);
    expect(dummy().sparring.z).toBeGreaterThan(0.1);
    expect(leaning.position.z).toBeGreaterThan(dummy().thing.z0 + 0.05); // its middle swung over its base
    expect(Math.abs(dummy().sparring.x)).toBeLessThan(1e-6);
    steps(session, 240);
    expect(Math.hypot(dummy().sparring.x, dummy().sparring.z)).toBeLessThan(0.01); // upright again
  });

  it('go down for their rise under a blast, then stand again', () => {
    const session = createSession(ring, { seed: 1 });
    steps(session, 2);
    strikeEntity(session.world, 2, [0, 1, 0], true, 'blast');
    const dummy = () => session.world.get(2) as unknown as Dummy;
    expect(dummy().thing.state).toBe('down');
    steps(session, 181);
    expect([dummy().thing.state, dummy().thing.hp]).toEqual(['up', 2]);
  });

  it('stand three on the ring’s canvas, toward its steps', () => {
    expect(RING_DUMMIES.map((d) => d.at[1])).toEqual([1, 1, 1]); // the canvas, 1 m up
    for (const { at } of RING_DUMMIES)
      expect(at[0] >= 63.5 && at[0] <= 68.5 && at[2] >= 3.5 && at[2] <= 8.5).toBe(true);
  });
});
