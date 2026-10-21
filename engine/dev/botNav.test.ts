/**
 * @file Tests for the bot on a site (engine/dev/botNav.ts, engine/dev/bot.ts; WP 13.15) on the fixture site
 * (fixtures/levels/storeys/site.ts): a site's way to a room leads from the yard, crouches under the attic's roof and
 * says how far its next step rises; a tour draws reachable places from the bot's own stream, with their heights; a goal
 * a storey above is not reached from under it; on a ladder whose way goes down the bot lets go, falling it pushes
 * nowhere, and climbing counts as getting on.
 * @see engine/dev/botNav.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { toWorld } from '../world/site';
import { Bot } from './bot';
import { siteBotNav, tourStream } from './botNav';

const site = defineFixtureSite(createRegistry());
const [house] = site.structures;
const nav = siteBotNav(site, 0.5);
const room = (name: string) => {
  const found = house.level.rooms!.find((each) => each.name === name)!;
  const [x, z] = toWorld(house, found.position[0], found.position[2]);
  return { x, y: found.position[1], z };
};
const YARD = { x: 6, y: 0.2, z: 20 };

describe('a site’s way for the bot', () => {
  it('leads from the yard to a room, crouched under the attic’s roof, and says how its next step rises', () => {
    const attic = nav.wayTo(room('attic'))!;
    expect(attic.distanceAt(YARD)).toBeGreaterThan(20);
    expect(attic.distanceAt(YARD)).toBeLessThan(Infinity);
    expect(attic.direction(YARD)!.length()).toBeCloseTo(1, 9);
    expect([attic.crouch!(room('attic')), nav.wayTo(room('hall'))!.crouch!(room('hall'))]).toEqual([true, false]);
    const cellar = nav.wayTo(room('cellar'))!;
    const [x, z] = toWorld(house, 6.75, 3.25); // on the cellar's flight, halfway down
    expect(cellar.rise!({ x, y: -1.5, z })).toBeCloseTo(-3 / 7, 9);
    expect(cellar.over!({ x, y: -1, z })).toBeCloseTo(0.5, 9);
  });

  it('tours places reachable from the start and back, drawn from the bot’s own stream, with their heights', () => {
    const tour = nav.tour(YARD, 6, tourStream(7));
    expect(tour).toHaveLength(6);
    expect(tour.every((at) => typeof at.y === 'number' && nav.wayTo(at)!.distanceAt(YARD) < Infinity)).toBe(true);
    expect(nav.tour(YARD, 6, tourStream(7))).toEqual(tour);
  });
});

describe('the bot on a site', () => {
  it('reaches no goal a storey above from under it', () => {
    const bot = new Bot(site, { climb: 0.5 }).goTo(room('bedroom'));
    bot.next({ ...room('hall'), x: room('bedroom').x, z: room('bedroom').z }, 1 / 60); // right under the bedroom's marker
    expect(bot.status).toBe('going');
  });

  it('lets go of a ladder whose way goes down, pushes nowhere while it falls, and counts a climb as getting on', () => {
    const [x, z] = toWorld(house, 4.25, 3.25); // the ladder's tile, up through the hatch
    const down = new Bot(site, { climb: 0.5 }).goTo(YARD);
    expect(down.next({ x, y: 4.5, z, mode: 'ladder' }, 1 / 60)).toEqual({ b: ['crouch'] });
    expect(down.next({ x, y: 4.4, z, mode: 'air' }, 1 / 60)).toEqual({});
    const up = new Bot(site, { climb: 0.5 }).goTo(room('attic'));
    for (let i = 0; i < 90; i++) up.next({ x, y: 3 + i * (2.2 / 60), z, mode: 'ladder' }, 1 / 60); // 1.5 s up its rungs
    expect([up.status, up.reason]).toEqual(['going', null]);
  });
});
