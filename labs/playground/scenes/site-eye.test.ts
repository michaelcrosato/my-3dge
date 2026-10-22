/**
 * @file The agent eye in the house (PLAN.md WP 12.3's trigger, gate G11): whether the player is in view from each of
 * the five cameras in every room, asked in Node (engine/dev/eye.ts: `__engine.eye`, headless with the view). The player
 * is put at each room's marker (`roomPlace`: ducked in the crawlspace), on the shed's floor and in the front yard (the
 * `place` action, as tests/e2e/playground-cameras.spec.ts puts him), and each camera is set and moved on by a second of
 * frames (`camera.advance`), as a page's frames would have placed it and run its cutaways: isometric and top-down see
 * him everywhere (the storeys above cut, a low ceiling lifted, a wall between them cut, the props on cut storeys gone),
 * the shooter and the platformer too once they have settled, and first person sees the room past his body.
 * @see engine/dev/eye.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine/app/headless';
import { toWorld } from '../../../engine/sim-api';
import '../bodies/player'; // the player's body, which the view draws him in
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { PLAYGROUND_CAMERAS } from '../views';
import { areaStart, roomPlace, SITE_SCENES } from './site';

/** The house on the block, and the shed. */
const [HOUSE, SHED] = (['house', 'shed'] as const).map((name) => SITE.structures[Object.keys(SITE_STRUCTURES).indexOf(name)]); // prettier-ignore

/** Where the player is put: each room of the house at its marker (ducked in the crawlspace), the shed's floor, the front yard's spawn. */ // prettier-ignore
const PLACES: readonly { name: string; at: readonly [number, number, number]; crouch: boolean }[] = [
  ...HOUSE.level.rooms!.map((room) => ({ name: room.name, ...roomPlace(HOUSE, room) })),
  { name: 'shed', at: [toWorld(SHED, 1.5, 2)[0], SHED.at[1], toWorld(SHED, 1.5, 2)[1]], crouch: false },
  { name: 'front yard', at: areaStart('frontyard'), crouch: false },
];

/** What the test asks of the headless engine. */
interface Eyed {
  step(n: number): number;
  actions: { run(name: string, args: object): unknown };
  camera: { set(code: string): unknown; advance(n: number): unknown };
  eye(): { visible: { key: string; player?: boolean }[] };
}

describe('the agent eye in the house', () => {
  it('sees the player from every camera in every room, and the room past him in first person', async () => {
    const engine = (await createHeadless({ scene: SITE_SCENES.frontyard.id, view: true })) as unknown as Eyed;
    engine.step(1);
    const lost: Record<string, string[]> = Object.fromEntries(PLAYGROUND_CAMERAS.map((mode) => [mode.name, []]));
    const level: string[] = [];
    for (const place of PLACES) {
      engine.actions.run('place', { at: place.at, crouch: place.crouch });
      engine.step(2);
      for (const mode of PLAYGROUND_CAMERAS) {
        engine.camera.set(mode.code);
        engine.camera.advance(60);
        const { visible } = engine.eye();
        if (!visible.some((thing) => thing.player === true)) lost[mode.name].push(place.name);
        if (mode.name === 'first' && visible[0]?.key === 'level') level.push(place.name);
      }
    }
    expect(PLACES.length).toBe(HOUSE.level.rooms!.length + 2);
    expect(lost).toEqual({ shooter: [], first: PLACES.map((place) => place.name), platformer: [], isometric: [], 'top-down': [] }); // prettier-ignore
    expect(level).toHaveLength(PLACES.length); // first person: the room, past his body, which his eye stands in
  }, 600_000);
});
