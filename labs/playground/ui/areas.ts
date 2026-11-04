/**
 * @file The block's areas as a player meets them (docs/PLAYGROUND.md §2; the owner's call of 2026-11-03: one map that
 * holds every demo, as shardfall's Pavilion and riftlight's Engine World hold theirs, each place saying what it
 * shows): `AREAS`, a card for each of the block's eight areas (what it is, what it shows of the engine, and what to
 * try there, the keys named by their actions so a rebound key reads right); `areaAt`, the area a point of the block is
 * in; `locationLine`, the HUD's top-left line (the area, and the room indoors); and `createAreaCard`, the card that
 * slides in for a few seconds when the player walks into another area, as a room's card does in riftlight.
 *
 * Where: a structure the point stands in names its area (`AREA_OF_STRUCTURE`: the house's garage and rooms are the
 * house, the shed and the tree house the backyard, the lookout the hill); outdoors, the block's map of §2 does
 * (`AREA_RECTS`, first match wins).
 *
 * Invariants: presentation only; pure but for the card's element; every area of labs/playground/levels/site.ts's
 * `SITE_AREAS` has a card, and every point of the block an area.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * areaAt(50, 70); // 'frontyard'
 * areaAt(52, 55, 'house'); // 'house'
 * locationLine('house', 'kitchen'); // 'House · kitchen'
 * @see labs/playground/ui/areas.test.ts
 */
import type { SiteArea } from '../levels/site';

/** An area's card: its name, what kind of place it is, what it shows, and what to try ({action} is that action's key). */
export interface AreaCard {
  readonly name: string;
  readonly kind: string;
  readonly text: string;
  readonly tries: readonly string[];
}

/** Each area's card (see the file comment). */
export const AREAS: Readonly<Record<SiteArea, AreaCard>> = Object.freeze({
  frontyard: {
    name: 'Front yard',
    kind: 'Outdoors',
    text: 'Lawn, the path to the porch, a picket fence, a hedge and the driveway: the clean look by day, and the dog.',
    tries: ['Vault the fence: run at it and jump ({jump})', 'Sprint ({sprint}) up the path, open the front door ({interact})'], // prettier-ignore
  },
  house: {
    name: 'House',
    kind: 'Indoors',
    text: 'Four storeys: basement, ground floor, upper floor and attic, with the garage. Doors, lights, windows and things to throw.', // prettier-ignore
    tries: ['Switch a light ({interact}), pick up a chair and throw it', 'Kick a door in ({melee})', 'Climb to the attic hatch, crawl the basement crawlspace ({crouch})'], // prettier-ignore
  },
  backyard: {
    name: 'Backyard',
    kind: 'Outdoors',
    text: 'The patio, the shed, the tree house with its zipline to the garage roof, the trampoline and the swing set.',
    tries: ['Ride the zipline from the tree house ({interact})', 'Bounce on the trampoline', 'Mantle onto the shed roof ({jump})'], // prettier-ignore
  },
  street: {
    name: 'Street',
    kind: 'Outdoors',
    text: 'Sidewalks, two lanes, streetlights that come on at dusk, a bus stop and the neighbours on their walk.',
    tries: ['Mantle onto the bus stop roof ({jump})', 'Wait for dusk: the streetlights come on'],
  },
  gym: {
    name: 'Gym',
    kind: 'Movement',
    text: "Every move's limit, measured: mantle walls, fences, climbs, slide ramps, gaps, a tower with a ladder and a zipline, and the crawl.", // prettier-ignore
    tries: ['Slide down a ramp: sprint ({sprint}), then crouch ({crouch})', 'Superglide off a mantle: jump ({jump}) as you top it', 'Ride the balloon up and skydive'], // prettier-ignore
  },
  hill: {
    name: 'Hill',
    kind: 'Terrain',
    text: 'The block rising to 10 m in slopes up to 30°, trees and rocks by seed, the lookout and its zipline down.',
    tries: ['Slide down a slope and gain speed ({crouch})', 'Ride the lookout zipline to the backyard ({interact})'], // prettier-ignore
  },
  range: {
    name: 'Range',
    kind: 'Weapons',
    text: 'Lanes with targets at 10, 25 and 50 m, pop-up and moving: the pistol and the rifle, from the hip and down the sights.', // prettier-ignore
    tries: ['Draw the pistol ({weapon1}) or the rifle ({weapon2})', 'Aim down the sights ({aim}), fire ({fire}), reload ({reload})'], // prettier-ignore
  },
  ring: {
    name: 'Ring',
    kind: 'Melee',
    text: 'Sparring dummies on springs, and two partners who flinch at a punch and go down as ragdolls.',
    tries: ['Punch ({melee}), kick from a jump, uppercut from a slide', 'Knock a partner down and watch him get up'],
  },
});

/** The area of the structures that name one (a structure's name is its level's). */
export const AREA_OF_STRUCTURE: Readonly<Record<string, SiteArea>> = Object.freeze({
  house: 'house',
  'gym-site': 'gym',
  street: 'street',
  driveway: 'frontyard',
  path: 'frontyard',
  shed: 'backyard',
  treehouse: 'backyard',
  lookout: 'hill',
  shelter: 'range',
  backstop: 'range',
  ring: 'ring',
});

/** The block's map outdoors (docs/PLAYGROUND.md §2), [area, x0, z0, x1, z1] in metres, the first match winning. */
export const AREA_RECTS: readonly (readonly [SiteArea, number, number, number, number])[] = [
  ['range', 0, 0, 60, 12],
  ['ring', 60, 0, 72, 13],
  ['hill', 72, 0, 96, 113],
  ['gym', 0, 12, 41, 113],
  ['backyard', 41, 12, 72, 46],
  ['street', 41, 83, 72, 113],
  ['frontyard', 41, 46, 72, 83],
];

/** The area the point (x, z) of the block is in, a structure there naming its own first (see the file comment). */
export function areaAt(x: number, z: number, structure?: string): SiteArea {
  const named = structure ? AREA_OF_STRUCTURE[structure] : undefined;
  if (named) return named;
  const found = AREA_RECTS.find(([, x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);
  return found ? found[0] : 'frontyard';
}

/** The HUD's location line: the area's name, and the room's when there is one. */
export function locationLine(area: SiteArea, room?: string | null): string {
  return room ? `${AREAS[area].name} · ${room}` : AREAS[area].name;
}

/** How long a card shows when the player walks into its area (s). */
export const CARD_SECONDS = 7;

/** The area card (see the file comment). */
export interface AreaCardView {
  /** One drawn frame: the area the player is in (null off the block), and whether the card must stay hidden. */
  update(area: SiteArea | null, dt: number, hidden: boolean): void;
  remove(): void;
}

/** Makes the area card in `parent`, its keys read through `key` (the input's prompt for an action). */
export function createAreaCard(parent: HTMLElement, key: (action: string) => string): AreaCardView {
  const doc = parent.ownerDocument;
  const el = Object.assign(doc.createElement('div'), { className: 'pg-card' });
  el.dataset.ui = 'area-card';
  parent.append(el);
  let shown: SiteArea | null = null;
  let left = 0;
  const fill = (area: SiteArea) => {
    const card = AREAS[area];
    const keyed = (text: string) => text.replace(/\{(\w+)\}/g, (_, action: string) => key(action));
    el.replaceChildren(
      Object.assign(doc.createElement('div'), { className: 'pg-card-kicker', textContent: card.kind }),
      Object.assign(doc.createElement('div'), { className: 'pg-card-title', textContent: card.name }),
      Object.assign(doc.createElement('div'), { className: 'pg-card-text', textContent: card.text }),
      doc.createElement('ul'),
    );
    const list = el.lastElementChild as HTMLUListElement;
    for (const line of card.tries) list.append(Object.assign(doc.createElement('li'), { textContent: keyed(line) }));
    el.dataset.id = area;
  };
  return {
    update(area, dt, hidden) {
      if (area !== shown) {
        shown = area;
        left = area ? CARD_SECONDS : 0;
        if (area) fill(area);
      } else left = Math.max(0, left - dt);
      el.dataset.value = !hidden && shown && left > 0 ? 'shown' : '';
    },
    remove: () => el.remove(),
  };
}
