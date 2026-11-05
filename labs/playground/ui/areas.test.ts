/**
 * @file The block's areas (labs/playground/ui/areas.ts): every area's spawn lies in its own area, by its structure or
 * the block's map; every area has a card whose keys are actions; the location line names the room indoors, as a
 * player reads it; the street reads as the street across its whole width, sidewalks and bus stop too, the house over
 * its walls at any height and over its map above the ground floor (the roof to its eaves, the porch roof, the deck),
 * and the patio, the porch and the apron, on the house's map but outside it, as the yards; the area card slides in
 * on entering an area and again on the card key (I, a second press putting it away), never while a screen is up, and
 * none off the block.
 */
import { describe, expect, it } from 'vitest';
import { getSite, siteStructureAt } from '../../../engine/sim-api';
import { HOUSE_RECTS } from '../levels/house';
import { SITE_AREAS, SITE_STRUCTURES, type SiteArea } from '../levels/site';
import { AREA_OF_STRUCTURE, AREAS, areaAt, CARD_SECONDS, createAreaCard, HOUSE_WALLS, locationLine } from './areas';

const site = getSite('site:block');

describe('the block’s areas', () => {
  it('puts each area’s spawn in its own area', () => {
    for (const [area, { at }] of Object.entries(SITE_AREAS)) {
      const structure = siteStructureAt(site, at[0], at[1] + 0.1, at[2])?.structure.name;
      const room = siteStructureAt(site, at[0], at[1] + 0.1, at[2])?.room?.name;
      expect(areaAt(at[0], at[2], structure, room), `${area} (${structure ?? 'outdoors'})`).toBe(area);
    }
  });

  it('gives every area a card, and names an area for every structure that names one', () => {
    expect(Object.keys(AREAS).sort()).toEqual(Object.keys(SITE_AREAS).sort());
    for (const card of Object.values(AREAS)) {
      expect(card.tries.length).toBeGreaterThan(0);
      for (const [, action] of card.tries.join(' ').matchAll(/\{(\w+)\}/g)) expect(action).toMatch(/^[a-z]+\d?$/);
    }
    const names = site.structures.map((structure) => structure.name);
    for (const name of Object.keys(AREA_OF_STRUCTURE)) expect(names, name).toContain(name);
  });

  it('reads the location as the area, and the room indoors', () => {
    expect(locationLine('house', 'kitchen')).toBe('House · kitchen');
    expect(locationLine('house', 'master')).toBe('House · master bedroom');
    expect(locationLine('frontyard')).toBe('Front yard');
    expect(areaAt(90, 50)).toBe<SiteArea>('hill');
    expect(areaAt(20, 60)).toBe<SiteArea>('gym');
  });

  it('reads the street across its width, the house over its walls, and its patio and porch as the yards', () => {
    const at = (x: number, y: number, z: number) => {
      const found = siteStructureAt(site, x, y + 0.1, z);
      return areaAt(x, z, found?.structure.name, found?.room?.name, found?.storey);
    };
    const street = [at(82, 0.15, 94.3), at(85, 0.15, 84), at(85, 0.5, 89)]; // the bus stop, a sidewalk, a jump on the road
    const house = [at(56.75, 11, 54.1), at(52, 0, 54), at(52, -2, 46)]; // the chimney's top, the hall, the crawlspace
    const yards = [at(52, 0, 46.5), at(52, 0, 61.5), at(62, 0, 59.5)]; // the patio, the porch, the garage's apron
    const up = [
      at(50, 5.79, 47.7),
      at(50, 5.79, 60.3),
      at(43.7, 7.4, 58),
      at(60.2, 6.7, 49),
      at(50, 3, 61.5),
      at(62, 3, 54),
    ]; // the roof's eaves, north, south, west and east; the porch roof; the garage's deck
    expect([street, house, yards, up]).toEqual([['street', 'street', 'street'], ['house', 'house', 'house'], ['backyard', 'frontyard', 'frontyard'], Array(6).fill('house')]); // prettier-ignore
    const [hx, , hz] = SITE_STRUCTURES.house.at;
    const walls = [HOUSE_RECTS.house, HOUSE_RECTS.garage].map(([x0, z0, x1, z1]) => [
      x0 + hx,
      z0 + hz,
      x1 + hx,
      z1 + hz,
    ]);
    expect(HOUSE_WALLS).toEqual(walls); // the level's own, at the house's place
  });

  it('slides the card in on entering an area, and again on the card key, never over a screen', () => {
    const card = createAreaCard(fakeParent(), (action) => action.toUpperCase());
    const shown = () => card.el.dataset.value === 'shown';
    card.update('gym', 0.1, false);
    expect([shown(), card.el.dataset.id]).toEqual([true, 'gym']); // walked in
    card.update('gym', CARD_SECONDS, false);
    expect(shown()).toBe(false); // its seconds spent
    card.show();
    card.update('gym', 0.1, false);
    expect(shown()).toBe(true); // the card key: the area's card again
    card.show();
    card.update('gym', 0.1, false);
    expect(shown()).toBe(false); // again: put away
    card.show();
    card.update('gym', 0.1, true);
    expect(shown()).toBe(false); // a screen is up: it waits
    card.update('gym', 0.1, false);
    expect(shown()).toBe(true);
    card.update(null, 0.1, false);
    card.show();
    card.update(null, 0.1, false);
    expect(shown()).toBe(false); // off the block: no area, no card
  });
});

/** An element as the card uses one: its data, its children and its text. */
interface FakeElement {
  dataset: Record<string, string>;
  children: FakeElement[];
  className?: string;
  textContent?: string;
  readonly lastElementChild: FakeElement | undefined;
  append(...children: FakeElement[]): void;
  replaceChildren(...children: FakeElement[]): void;
  remove(): void;
}

/** A parent in a stand-in for the few DOM calls the card makes. */
function fakeParent(): HTMLElement {
  const element = (): FakeElement => ({
    dataset: {},
    children: [],
    get lastElementChild() {
      return this.children.at(-1);
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    remove() {},
  });
  return Object.assign(element(), { ownerDocument: { createElement: element } }) as unknown as HTMLElement;
}
