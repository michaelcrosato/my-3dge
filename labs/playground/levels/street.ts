/**
 * @file The site's paving (docs/PLAYGROUND.md §2.2, PLAN.md WP 13.18): levels of one storey on 0.5 m tiles that
 * labs/playground/levels/site.ts lays on the block, each drawn in its own surface (their entries' recipes):
 * - **The street** (`level:street`): 55 × 12 m, a road 8 m wide in asphalt, its dashed middle line in paint, between
 *   two sidewalks 2 m wide in concrete, 0.15 m up (`,`, the playground's sidewalk glyph: the curb a step).
 * - **The driveway** (`level:driveway`): 6 × 20 m of concrete from the garage's apron to the street.
 * - **The front path** (`level:path`): 2 × 20 m of flagstones from the porch to the sidewalk.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * STREET.road; // [2, 10]: the road's north and south edges in the street's own metres
 * @see labs/playground/scenes/site.test.ts
 */
import { defineGlyph, defineLevel } from '../../../engine/sim-api';
import { Plan } from './plan';

/** The paving's tile (m). */
export const PAVING_TILE = 0.5;

/** The street's size and its road's edges, north to south, in its own metres. */
export const STREET = { width: 55, depth: 12, road: [2, 10] } as const;

/** The sidewalk's height over the road (m): its curb a step. */
export const CURB = 0.15;

defineGlyph('glyph:playground-sidewalk', { char: ',', description: `A sidewalk, ${CURB} m over the road: its curb is a step.`, floor: CURB, top: CURB, collider: 'box', mesh: 'gallery' }); // prettier-ignore
defineGlyph('glyph:playground-roadLine', { char: '-', description: "A dash of the road's middle line: the road, painted.", mesh: 'roadLine' }); // prettier-ignore

/** A paving level's text: one storey of `map` on 0.5 m tiles. */
const paved = (description: string, plan: Plan) => `---\ndescription: ${description}\ntile: ${PAVING_TILE}\n---\n${plan.map}\n`; // prettier-ignore

/** The street (see the file comment). */
function street(): Plan {
  const [north, south] = STREET.road;
  const plan = new Plan(STREET.width, STREET.depth, PAVING_TILE, ',').fill([0, north, STREET.width, south], '.');
  const middle = (north + south) / 2;
  for (let x = 1; x + 2 <= STREET.width; x += 4) plan.fill([x, middle - 0.5, x + 2, middle], '-'); // 2 m dashes, 2 m apart
  return plan;
}

/** The street's level text (see the file comment). */
export const STREET_TEXT = paved('The street on 0.5 m tiles, 55 × 12 m: a road 8 m wide with its dashed middle line, between sidewalks 2 m wide, 0.15 m up.', street()); // prettier-ignore
/** The driveway's level text. */
export const DRIVEWAY_TEXT = paved('The driveway on 0.5 m tiles, 6 × 20 m of concrete from the garage to the street.', new Plan(6, 20, PAVING_TILE, '.')); // prettier-ignore
/** The front path's level text. */
export const PATH_TEXT = paved('The front path on 0.5 m tiles, 2 × 20 m of flagstones from the porch to the sidewalk.', new Plan(2, 20, PAVING_TILE, '.')); // prettier-ignore

/** A floor recipe in `material`. */
const floor = (material: string) => ({ shape: 'surface', materials: [material], castShadow: false, receiveShadow: true }) as const; // prettier-ignore

const FILE = 'labs/playground/levels/street.ts';
defineLevel('level:street', {
  text: STREET_TEXT,
  file: FILE,
  recipes: {
    floor: floor('material:asphalt'),
    roadLine: floor('material:paint'),
    gallery: { shape: 'slab', materials: ['material:concrete', 'material:concrete'], castShadow: false, receiveShadow: true }, // prettier-ignore
  },
});
defineLevel('level:driveway', { text: DRIVEWAY_TEXT, file: FILE, recipes: { floor: floor('material:concrete') } });
defineLevel('level:path', { text: PATH_TEXT, file: FILE, recipes: { floor: floor('material:flagstone') } });
