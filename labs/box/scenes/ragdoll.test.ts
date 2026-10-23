/**
 * @file The tests of the box scene `box:ragdoll` (labs/box/scenes/ragdoll.ts, PLAN.md WP 10.2): 600 steps give the same
 * hash three times and the run's recording replays to the same hashes; in its first cycle each partner falls to its
 * blow as a ragdoll and gets up the way it lies (the first from its back, the second from its face), the dead one only
 * when the cycle stands it up, and at the next cycle's start every partner stands on its spot again; the hero's attack
 * knocks down the partner in front of him; with `box.ragdoll.handOff` off they fall through their reactions'
 * timelines instead, and `box.ragdoll.push` changes the run.
 *
 * Its replays (tests/replays/ragdoll-*.replay.json, tests/replays/README.md) keep its goldens in Node and Chromium.
 * @see labs/box/scenes/ragdoll.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { placeActor, type RagdollState } from '../../../engine/sim-api';
import { startScene } from '../../../engine/sim/scene';
import { RAGDOLL_DEMO, ragdoll } from './ragdoll';

type Partner = { id: number; actor: { x: number; z: number }; boxPartner: { x: number; z: number }; ragdoll?: RagdollState; reactions: { playing: string } }; // prettier-ignore

/** The scene started with `settings`, its partners, and its story of `ragdoll` and `getUp` events so far. */
function started(settings: Record<string, unknown> = {}) {
  const { world } = startScene(ragdoll, { settings } as never);
  const partners = () => world.query('boxPartner', 'actor') as unknown as Partner[];
  const story = () =>
    world.events
      .trace()
      .filter((e) => e.type === 'ragdoll' || e.type === 'getUp')
      .map((e) => `${e.type}#${(e.payload as { id: number }).id}${(e.payload as { lying?: string }).lying ? `:${(e.payload as { lying: string }).lying}` : ''}`); // prettier-ignore
  return { world, partners, story };
}

describe('box:ragdoll', () => {
  it('gives the same hash three times, and its recording replays to the same hashes', async () => {
    const live = async () => {
      const engine = await createHeadless({ scene: ragdoll });
      const hashes: Record<string, string> = { 0: engine.hash() };
      for (let k = 60; k <= 600; k += 60) hashes[k] = (engine.step(60), engine.hash());
      return { engine, hashes };
    };
    const runs = [await live(), await live(), await live()];
    expect(runs[1].hashes).toEqual(runs[0].hashes);
    expect(runs[2].hashes).toEqual(runs[0].hashes);
    const recorded = (runs[0].engine.input as { record(): object }).record();
    const replay = JSON.stringify({ ...recorded, hashes: { [`${process.platform}-${process.arch}`]: runs[0].hashes } });
    const again = await createHeadless({ scene: ragdoll });
    const played = await (again.replay as (text: string) => Promise<{ hashes: object }>)(replay);
    expect(played.hashes).toEqual(runs[0].hashes);
  }, 120_000);

  it('falls each partner to its blow and gets it up the way it lies, the dead one when the cycle stands it', () => {
    const { world, partners, story } = started();
    const cycle = Math.round(RAGDOLL_DEMO.cycle * 60);
    for (let k = 0; k < Math.round(RAGDOLL_DEMO.stand * 60) - 1; k++) world.step({});
    const before = story();
    expect(before.filter((s) => s.startsWith('ragdoll'))).toEqual(['ragdoll#2', 'ragdoll#3', 'ragdoll#4', 'ragdoll#5']);
    expect(before).toContain('getUp#2:up'); // from the front: onto its back
    expect(before).toContain('getUp#3:down'); // from behind: onto its face
    expect(before.some((s) => s.startsWith('getUp#5'))).toBe(false); // dead: it lies
    expect(partners()[3].ragdoll?.dead).toBe(true);
    while (world.tick < cycle) world.step({});
    expect(story().some((s) => s.startsWith('getUp#5'))).toBe(true); // stood up by the cycle
    world.step({});
    for (const p of partners()) {
      expect([p.ragdoll, p.actor.x, p.actor.z]).toEqual([undefined, p.boxPartner.x, p.boxPartner.z]); // on its spot
    }
  }, 120_000);

  it('knocks down the partner in front of the hero when he attacks', () => {
    const { world, story } = started();
    placeActor(world, 1, [2.5, 0, 5.8], 0); // 1.7 m north of the first partner, facing it
    world.step({ b: ['attack'], p: ['attack'] }); // pressed this step, as a session marks it
    expect(story()).toEqual(['ragdoll#2']);
  }, 120_000);

  it('falls through the reactions’ timelines with box.ragdoll.handOff off, and box.ragdoll.push changes the run', async () => {
    const { world, partners, story } = started({ 'box.ragdoll.handOff': false });
    for (let k = 0; k < 40; k++) world.step({});
    expect([story(), partners()[0].reactions.playing, partners()[0].ragdoll]).toEqual([[], 'down', undefined]);
    const [soft, hard] = [await createHeadless({ scene: ragdoll }), await createHeadless({ scene: ragdoll, settings: { 'box.ragdoll.push': 6 } })]; // prettier-ignore
    soft.step(60);
    hard.step(60);
    expect(hard.hash()).not.toBe(soft.hash());
  }, 120_000);
});
