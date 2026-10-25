/**
 * @file Unit tests for labs/playground/ui/spawns.ts (WP 13.25): the spawn picker lists the block's 8 areas, each at its
 * spawn, and the house's 17 rooms, the crawlspace ducked; and a pick is the block's recorded dev action `place`: the
 * player stands in the room picked, and the run's replay holds the pick and plays back to the same hash.
 * @see labs/playground/ui/spawns.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless, siteStructureAt } from '../../../engine';
import { playReplay } from '../../../engine/sim/replay';
import '../bodies/player';
import { SITE, SITE_AREAS } from '../levels/site';
import { areaStart, SITE_SCENES } from '../scenes/site';
import { spawnPlace, spawnPlaces } from './spawns';

describe('the spawn picker’s places', () => {
  it('lists each area at its spawn, then each of the house’s rooms, the crawlspace ducked', () => {
    const places = spawnPlaces();
    expect(places.map((place) => place.group).filter((group) => group === 'area')).toHaveLength(Object.keys(SITE_AREAS).length); // prettier-ignore
    expect(places).toHaveLength(25);
    expect(new Set(places.map((place) => place.id)).size).toBe(places.length);
    expect(spawnPlace('area:backyard')?.args).toEqual({ at: areaStart('backyard'), yaw: SITE_AREAS.backyard.yaw, crouch: false }); // prettier-ignore
    expect(spawnPlace('room:house/crawlspace')?.args.crouch).toBe(true);
    expect(spawnPlace('room:house/nowhere')).toBeUndefined();
  });

  it('puts the player in the room picked, through the recorded place action, which the replay plays back', async () => {
    const live = await createHeadless({ scene: SITE_SCENES.frontyard });
    live.step(5);
    const kitchen = spawnPlace('room:house/kitchen')!;
    (live.actions as { run(name: string, args: unknown): unknown }).run('place', kitchen.args);
    live.step(30);
    const [player] = (live.state('actor').entities as unknown as { actor: { player: boolean; x: number; y: number; z: number } }[]).filter((e) => e.actor.player); // prettier-ignore
    expect(siteStructureAt(SITE, player.actor.x, player.actor.y + 0.1, player.actor.z)?.room?.name).toBe('kitchen');
    const replay = (live.input as { record(): { inputs: [number, { dev?: unknown }][] } }).record();
    expect(replay.inputs.some(([, change]) => JSON.stringify(change.dev ?? '').includes('place'))).toBe(true);
    expect(playReplay(replay).session.world.hash()).toBe(live.hash());
  }, 120_000);
});
