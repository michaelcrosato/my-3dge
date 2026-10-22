/**
 * @file The site's small buildings (docs/PLAYGROUND.md §2.2, PLAN.md WP 13.18), each a level written as storeys on
 * 0.5 m tiles (labs/playground/levels/plan.ts), which labs/playground/levels/site.ts stands on the block:
 * - **The shed** (`level:shed`): 3 × 4 m and 2.5 m high under a flat roof bodies stand on, a door and a window.
 * - **The tree house** (`level:treehouse`): a 4 × 4 m deck 4 m up on four posts, railed but where its ladder comes up;
 *   the zipline to the garage's deck leaves from it. **The lookout** (`level:lookout`) is the same deck 3 m up on the
 *   hilltop, its zipline down to the backyard.
 * - **The range's shelter** (`level:shelter`): a covered bench at the range's west end, 4 × 10 m and 2.5 m high on
 *   four posts under a flat roof, its counter along the lanes' side.
 * - **The ring** (`level:ring`): a canvas 6 × 6 m and 1 m up (the engine's gallery glyph) with steps up its south side
 *   and a post at each corner, on a pad 8 × 9 m; the ropes are props (labs/playground/furnish.ts).
 * - **The backstop** (`level:backstop`): a wall 3 m high across the range's east end.
 * The playground's post glyph (`(`, one tile, up to the storey above) holds up the decks and roofs.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * DECK_HEIGHT.treehouse; // 4: the tree house's deck, over the ground
 * @see labs/playground/scenes/site.test.ts
 */
import { defineGlyph, defineLevel } from '../../../engine/sim-api';
import './house'; // the counter's glyph, which the shelter's counter is
import { levelText, Plan } from './plan';

/** The yard's tile (m). */
export const YARD_TILE = 0.5;

/** How high each deck stands over the ground it is on (m). */
export const DECK_HEIGHT = { treehouse: 4, lookout: 3 } as const;

/** A post: one tile, solid, up to the storey above, drawn as the engine's pillar. */
const POST = '(';
/** A ring post: a block 2.2 m high at a corner of the canvas. */
const RING_POST = ']';

defineGlyph('glyph:playground-post', { char: POST, description: 'A post, half a metre square, up to the storey above: what holds a deck or a roof.', top: 3, solid: true, collider: 'box', mesh: 'pillar', full: true, nav: { walkable: false } }); // prettier-ignore
defineGlyph('glyph:playground-ringPost', { char: RING_POST, description: "A corner post of the ring, 2.2 m from the ground: 1.2 m over its canvas.", top: 2.2, solid: true, collider: 'box', mesh: 'pillar', nav: { walkable: false } }); // prettier-ignore

/** A one-storey building's text: its map under a flat roof, `height` m clear. */
const flatRoofed = (description: string, plan: Plan, height: number) =>
  levelText({ description, tile: YARD_TILE }, [{ keys: { storey: 'ground', base: 0, height, roof: 'flat' }, plan }]);

/** The shed (see the file comment). */
export const SHED_TEXT = flatRoofed(
  "The backyard's shed on 0.5 m tiles, 3 × 4 m and 2.5 m high under a flat roof bodies stand on, a door and a window.",
  new Plan(3, 4, YARD_TILE).box([0, 0, 3, 4], '#', '.').line([1, 3.5, 2, 4], '+').line([2.5, 1, 3, 2], ':'),
  2.5,
);

/** A deck `height` m up on four posts, 4 × 4 m, railed but at its ladder, which comes up its north edge. */
function deckText(description: string, height: number): string {
  const posts = new Plan(5, 4.5, YARD_TILE); // the ground: void but the posts and the ladder
  for (const [x, z] of [[0.5, 0.5], [4, 0.5], [0.5, 4], [4, 4], [2, 0.5]] as const) posts.fill([x, z, x + YARD_TILE, z + YARD_TILE], POST); // prettier-ignore
  posts.fill([2, 0, 2.5, 0.5], '|'); // against the middle post of the north edge, up to the deck
  const deck = new Plan(5, 4.5, YARD_TILE).box([0.5, 0.5, 4.5, 4.5], '!', '.').fill([2, 0.5, 2.5, 1], '.');
  return levelText({ description, tile: YARD_TILE }, [
    { keys: { storey: 'posts', base: 0, height: height - 0.3 }, plan: posts },
    { keys: { storey: 'deck', base: height, height: 2.5 }, plan: deck },
  ]);
}

/** The tree house's level text (see the file comment). */
export const TREEHOUSE_TEXT = deckText("The backyard's tree house: a 4 × 4 m deck 4 m up on four posts, railed, its ladder up its north edge.", DECK_HEIGHT.treehouse); // prettier-ignore
/** The lookout's level text: the tree house's deck, lower, on the hilltop. */
export const LOOKOUT_TEXT = deckText("The hill's lookout: a 4 × 4 m deck 3 m up on four posts, railed, its ladder up its north edge.", DECK_HEIGHT.lookout); // prettier-ignore

/** The range's shelter (see the file comment). */
export const SHELTER_TEXT = flatRoofed(
  "The range's covered bench on 0.5 m tiles: 4 × 10 m and 2.5 m high on four posts under a flat roof, its counter facing the lanes, east.", // prettier-ignore
  new Plan(4, 10, YARD_TILE)
    .fill([0, 0, 4, 10], '.')
    .fill([3.5, 1, 4, 9], '[') // the counter (the house's glyph, 0.9 m) along its east edge, facing the lanes
    .fill([0, 0, 0.5, 0.5], POST)
    .fill([3.5, 0, 4, 0.5], POST)
    .fill([0, 9.5, 0.5, 10], POST)
    .fill([3.5, 9.5, 4, 10], POST),
  2.5,
);

/** The ring (see the file comment): format 1, its heights the engine's gallery (1 m) and stairs. */
export const RING_TEXT = `---
description: The ring on 0.5 m tiles, on a pad 8 × 9 m: a canvas 6 × 6 m and 1 m up, steps up its south side, a post 2.2 m high at each corner.
tile: ${YARD_TILE}
---
${
  new Plan(8, 9, YARD_TILE, '.')
    .fill([1, 1, 7, 7], '=')
    .fill([3, 7, 5, 9], '^')
    .fill([1, 1, 1.5, 1.5], RING_POST)
    .fill([6.5, 1, 7, 1.5], RING_POST)
    .fill([1, 6.5, 1.5, 7], RING_POST)
    .fill([6.5, 6.5, 7, 7], RING_POST).map
}
`;

/** The backstop (see the file comment): format 1, the engine's 3 m wall, 2 m thick. */
export const BACKSTOP_TEXT = `---
description: The range's backstop on 0.5 m tiles, a wall 2 × 12 m and 3 m high across its east end.
tile: ${YARD_TILE}
---
${new Plan(2, 12, YARD_TILE, '#').map}
`;

const FILE = 'labs/playground/levels/yard.ts';
/** Weathered wood for the decks and the shed, stone for the backstop: their recipes (presentation only). */
const looks = {
  wall: { shape: 'block', materials: ['material:siding', 'material:wood'], castShadow: true, receiveShadow: true, cut: { height: 0.4375, when: 'facing' } }, // prettier-ignore
  pillar: { shape: 'pillar', materials: ['material:wood', 'material:wood'], castShadow: true, receiveShadow: true },
  floor: { shape: 'surface', materials: ['material:wood'], castShadow: false, receiveShadow: true },
  ceiling: { shape: 'ceiling', materials: ['material:wood'], castShadow: true, receiveShadow: true },
  roof: { shape: 'roof', materials: ['material:asphalt', 'material:wood'], castShadow: true, receiveShadow: true },
  lowWall: { shape: 'block', materials: ['material:wood', 'material:wood'], castShadow: true, receiveShadow: true },
} as const;
defineLevel('level:shed', { text: SHED_TEXT, file: FILE, recipes: looks });
defineLevel('level:treehouse', { text: TREEHOUSE_TEXT, file: FILE, recipes: looks });
defineLevel('level:lookout', { text: LOOKOUT_TEXT, file: FILE, recipes: looks });
defineLevel('level:shelter', { text: SHELTER_TEXT, file: FILE, recipes: { ...looks, floor: { ...looks.floor, materials: ['material:concrete'] } } }); // prettier-ignore
defineLevel('level:ring', { text: RING_TEXT, file: FILE, recipes: { floor: { ...looks.floor, materials: ['material:concrete'] }, gallery: { shape: 'slab', materials: ['material:paint', 'material:cloth'], castShadow: true, receiveShadow: true }, pillar: { ...looks.pillar, materials: ['material:paint', 'material:paint'] } } }); // prettier-ignore
defineLevel('level:backstop', { text: BACKSTOP_TEXT, file: FILE });
