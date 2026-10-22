/**
 * @file Unit tests for the ring (labs/playground/scenes/site.ts's `playground:site-ring`, cast/dummies.ts; PLAN.md WP
 * 13.19): its three sparring dummies stand upright on the canvas, and its replay (tests/replays/
 * playground-melee.replay.json) plays melee's story in order: the shed's door kicked open, then off its hinges, each
 * kick landing 0.83 s after its press; the middle dummy punched twice and the west one once, the east one kicked from a
 * jump and the middle one uppercut from a slide, each blow 0.35 s after its press, rocking its dummy away from the
 * player; every dummy upright again at the end. In first person (the view, headless) the kicking leg shows while the
 * door kick plays, and not before.
 * @see labs/playground/scenes/site.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine/app/headless';
import { playReplay } from '../../../engine/sim/replay';
import type { MeleeState } from '../../../engine/sim/melee';
import { createSession } from '../../../engine/sim/session';
import '../bodies/player'; // the player's body, which the view draws him in
import { RING_DUMMIES, type Sparring } from '../cast/dummies';
import { SITE_SCENES } from './site';

const REPLAY = JSON.parse(readFileSync(join(process.cwd(), 'tests/replays/playground-melee.replay.json'), 'utf8'));

type Dummy = { id: number; sparring: Sparring; thing: { hits: number; x0: number; y0: number; z0: number } };

describe('the ring', () => {
  it('stands its three sparring dummies upright on the canvas', () => {
    const session = createSession(SITE_SCENES.ring, { seed: 1 });
    session.step({});
    const dummies = session.world.query('sparring') as unknown as Dummy[];
    expect(dummies.map((d) => [d.thing.x0, d.thing.z0])).toEqual(RING_DUMMIES.map((d) => [d.at[0], d.at[2]]));
    for (const d of dummies) expect([d.thing.y0 > 1.5, d.sparring.x, d.sparring.z]).toEqual([true, 0, 0]); // its middle over the canvas, 1 m up
  });

  it("plays its replay's story in order: the shed's door kicked open and off, every dummy struck and upright again", () => {
    const { world } = playReplay(REPLAY).session;
    const [west, middle, east] = (world.query('sparring') as unknown as Dummy[]).map((d) => d.id);
    const named = (id: number) => ({ [west]: 'west', [middle]: 'middle', [east]: 'east' })[id] ?? 'door';
    const story = world.events
      .trace()
      .filter((e) => ['melee', 'door', 'splinters', 'strike'].includes(e.type))
      .map((e) => {
        const p = e.payload as { move?: string; target?: number };
        return e.type === 'strike' ? `${p.move} ${named(p.target!)}` : e.type === 'melee' ? `swing ${p.move}` : e.type;
      });
    expect(story).toEqual([
      'swing move:breach', // the door kick at the shed's door
      'door', // the first bursts it open
      'move:breach door',
      'swing move:breach',
      'splinters', // the second breaks it off its hinges
      'move:breach door',
      'swing move:cross', // on the canvas: the punch
      'move:cross middle',
      'swing move:cross',
      'move:cross middle',
      'swing move:cross',
      'move:cross west',
      'swing move:kick', // from a jump
      'move:kick east',
      'swing move:uppercut', // from a slide
      'move:uppercut middle',
    ]);
    const swing = (until: number) => (playReplay(REPLAY, { until }).session.world.get(1) as unknown as { melee: MeleeState }).melee; // prettier-ignore
    const [kick, punch] = [swing(100), swing(280)]; // the first door kick over, the first punch landed
    expect([kick.hitAt - kick.began, punch.hitAt - punch.began]).toEqual([49, 20]); // 0.83 s and 0.35 s after the press
    const dummies = world.query('sparring') as unknown as Dummy[];
    expect(dummies.map((d) => d.thing.hits)).toEqual([1, 3, 1]);
    for (const d of dummies) expect(Math.hypot(d.sparring.x, d.sparring.z)).toBeLessThan(0.02); // upright again
  }, 120_000);

  it('shows the kicking leg in first person while the door kick plays', async () => {
    type Viewed = { step(n: number, intents?: object): void; actions: { run(name: string, args: object): void }; camera: { get(): { arms?: string[] }; advance(n: number): unknown } }; // prettier-ignore
    const engine = (await createHeadless({ scene: SITE_SCENES.ring.id, view: true, cam: 'cam3=first' })) as unknown as Viewed; // prettier-ignore
    const north = { look: [Math.PI, 0], cam: Math.PI };
    engine.actions.run('place', { at: [67.5, 0, 20.1], yaw: Math.PI }); // before the shed's door
    engine.step(5, north);
    engine.camera.advance(1); // a frame drawn, as a page's: the arms posed from the body
    const leg = ['thighR', 'shinR', 'footR'];
    expect(engine.camera.get().arms).not.toEqual(expect.arrayContaining(leg));
    engine.step(1, { ...north, b: ['melee'] }); // the door kick
    engine.step(30, north);
    engine.camera.advance(1);
    expect(engine.camera.get().arms).toEqual(expect.arrayContaining(leg));
  }, 120_000);
});
