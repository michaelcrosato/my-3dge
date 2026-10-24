/**
 * @file Unit tests for the block (labs/playground/scenes/site.ts, levels/site.ts, levels/house.ts; PLAN.md WP 13.18):
 * every level on it validates clean; each structure stands where the site puts it, the ground cut under every floor;
 * each area's scene stands the player at its spawn, on its floor; the house's things are there: a door in every door
 * opening it fits, two panes in every window, the garage's door on its switches, a lamp and a switch in every room;
 * and its replay (tests/replays/playground-site.replay.json) plays the story in its order, each step's prompt the
 * HUD's: the front door opens away from the player, the hall's light goes off and on at its switch, two door kicks
 * burst the living room's door open and break it, a chair is picked up and thrown through the dining room's window,
 * both its panes breaking, and the garage's switch raises its door.
 * @see labs/playground/scenes/site.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playReplay } from '../../../engine/sim/replay';
import { createSession } from '../../../engine/sim/session';
import { validateLevel } from '../../../engine/sim-api';
import { registry } from '../../../engine/core/registry';
import { HOUSE_LIGHTS } from '../furnish';
import { SITE, SITE_AREAS, SITE_STRUCTURES, type SiteArea } from '../levels/site';
import { SITE_SCENES, areaStart } from './site';

/** The house's replay. */
const REPLAY = JSON.parse(readFileSync(join(process.cwd(), 'tests/replays/playground-site.replay.json'), 'utf8'));

/** Every level on the block, by its structure's name. */
const LEVELS = Object.entries(SITE_STRUCTURES).map(([name, s]) => [name, registry.get('level', s.level) as unknown as { text: string; file: string }] as const); // prettier-ignore

describe('the block', () => {
  it('validates every level on it clean: doors the hull fits, headroom, flights within the slope, every room reachable', () => {
    for (const [name, level] of LEVELS) {
      const problems = validateLevel(level.text, { file: level.file }).map((p) => p.code);
      // The gym's gap lane: its eight platforms past the first are reached only by jumping, as the gym's own scene's are.
      expect(problems, name).toEqual(name === 'gym' ? Array(8).fill('LEVEL_UNREACHABLE_AREA') : []);
    }
  });

  it('stands each structure where the site puts it, and cuts the ground under every floor on it', () => {
    const at = Object.fromEntries(SITE.structures.map((s, i) => [Object.keys(SITE_STRUCTURES)[i], s.footprint]));
    expect([at.gym, at.house, at.street]).toEqual([
      [0, 12, 41, 113],
      [44, 44, 66, 63],
      [41, 83, 96, 95],
    ]);
    const { cols } = SITE.terrain!;
    const cut = (x: number, z: number) => SITE.cut![Math.floor(z) * cols + Math.floor(x)];
    expect([cut(20, 50), cut(50, 50), cut(60, 90), cut(56, 30), cut(80, 30)]).toEqual([1, 1, 1, 0, 0]); // gym, house, street; lawn, hill
  });

  for (const area of Object.keys(SITE_AREAS) as SiteArea[]) {
    it(`starts ${SITE_SCENES[area].id} with the player at ${area}'s spawn, standing there`, () => {
      const session = createSession(SITE_SCENES[area], { seed: 1 });
      for (let i = 0; i < 30; i++) session.step({});
      const player = session.world.get(1) as unknown as { actor: { x: number; y: number; z: number; grounded: boolean } }; // prettier-ignore
      const [x, y, z] = areaStart(area);
      expect(Math.hypot(player.actor.x - x, player.actor.z - z)).toBeLessThan(0.05); // on the hill's slope it creeps
      expect(Math.abs(player.actor.y - y)).toBeLessThan(0.05);
      expect(player.actor.grounded).toBe(true);
    });
  }

  it("hangs the house's doors, stands its panes, its garage door on two switches and a lamp and a switch in each room", () => {
    const session = createSession(SITE_SCENES.house, { seed: 1 });
    session.step({});
    const count = (component: string) => session.world.query(component).length;
    const doors = session.world.query('door') as unknown as { door: { tilt: boolean } }[];
    expect([doors.length, doors.filter((d) => d.door.tilt).length]).toEqual([17 + 1 + 1, 1]); // the house's, the shed's, the garage's
    const lamps = session.world.query('propLight').filter((e) => (e as unknown as { sceneProp: { prop: string } }).sceneProp.prop === 'prop:lamp'); // prettier-ignore
    expect([lamps.length, count('switch')]).toEqual([Object.values(HOUSE_LIGHTS).filter((l) => l.lamp).length, Object.keys(HOUSE_LIGHTS).length + 2]); // prettier-ignore
    const groups = lamps.map((e) => (e as unknown as { propLight: { group: string } }).propLight.group).sort();
    expect(groups).toEqual(
      Object.entries(HOUSE_LIGHTS)
        .filter(([, l]) => l.lamp)
        .map(([room]) => `room:${room}`)
        .sort(),
    ); // each its room's group // prettier-ignore
    const panes = session.world.query('sceneProp').filter((e) => (e as unknown as { sceneProp: { prop: string } }).sceneProp.prop === 'prop:pane'); // prettier-ignore
    expect(panes.length).toBe(56); // two in each of the house's and the shed's 28 windows
  });

  it("plays its replay's story in order, with the HUD's prompts", () => {
    const { world } = playReplay(REPLAY).session;
    const story = world.events
      .trace()
      .filter((e) => ['door', 'switch', 'strike', 'splinters', 'pickup', 'throw', 'glass'].includes(e.type))
      .map((e) => {
        const p = e.payload as { open?: boolean; on?: boolean; prop?: string; door?: number };
        if (e.type === 'door') return `door ${p.open ? 'open' : 'shut'}`;
        if (e.type === 'switch') return (p.door ?? -1) >= 0 ? 'garage switch' : `light ${p.on ? 'on' : 'off'}`;
        return `${e.type}${p.prop ? ` ${p.prop}` : ''}`;
      });
    expect(story).toEqual([
      'door open', // the front door, from the porch
      'light off', // the hall's, at its switch by the door
      'light on',
      'door open', // the living room's: the first door kick bursts it open
      'strike',
      'splinters prop:door', // the second breaks it
      'strike',
      'pickup', // a dining chair
      'throw',
      'glass prop:pane', // the north window's two panes
      'glass prop:pane',
      'door open', // the garage's, up and over
      'garage switch',
    ]);
    const prompts = [5, 20, 111, 113, 200, 282, 474, 477, 599].map((until) => {
      const at = playReplay(REPLAY, { until }).session.world;
      return (at.get(1) as unknown as { interactor: { prompt: string } }).interactor.prompt;
    });
    expect(prompts).toEqual([
      'Open',
      'Close',
      'Lights off',
      'Lights on',
      'Open',
      'Close',
      'Pick up',
      'Throw',
      'Switch',
    ]);
  }, 120_000);
});
