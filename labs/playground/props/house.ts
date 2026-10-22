/**
 * @file The house's furniture (docs/PLAYGROUND.md §2.1, PLAN.md WP 13.18), the playground's own props, each built of
 * the geometry kit's boxes, frustums and limbs in the engine's materials (a part's `tint` multiplies its material's
 * colour: paint's and cloth's white show it as it is, iron's dark grey and glow's amber darken and warm it), most of
 * them fixed in place; labs/playground/furnish.ts says where each stands. The living room's sofa, television,
 * fireplace (its fire flickering) and rug; the kitchen's fridge and stove; the bathrooms' bath, toilet and basin; the
 * bedrooms' beds and the bunk bed (a body 1.7 m high to mantle onto); the study's desk and bookshelf; the basement's
 * workbench, shelves, washer and boiler; the garage's car; and boxes to carry and throw (3 kg). The tables, chairs,
 * benches, crates and barrels are the engine's (engine/world/props/).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * HOUSE_PROPS['prop:playground-bunkbed'].body.size; // [2, 1.7, 1]: its top to mantle onto
 * @see labs/playground/scenes/site.test.ts
 */
import { defineProp, type PropDefinition } from '../../../engine/sim-api';

/** A box part `name`, `size` (m) in `material`, its base's middle at `at` (m), in `tint`. */
export function part(
  name: string,
  [width, height, depth]: readonly number[],
  material: string,
  at: readonly number[] = [0, 0, 0],
  tint?: string,
) {
  // prettier-ignore
  return { name, geometry: 'geometry:box', params: { width, height, depth }, material, position: [...at], ...(tint ? { tint } : {}) }; // prettier-ignore
}

/** A fixed box body of `size` (m). */
export const fixed = (size: readonly number[]) => ({ type: 'fixed' as const, shape: 'box' as const, size: [...size] });

const [WOOD, CLOTH, PAINT, IRON, GLOW, STONE] = ['material:wood', 'material:cloth', 'material:paint', 'material:iron', 'material:glow', 'material:stone']; // prettier-ignore

/** The furniture, by id (see the file comment). */
export const HOUSE_PROPS = {
  'prop:playground-sofa': {
    description: 'A sofa, 2 m long and 0.85 m deep, its back 0.8 m high and its arms 0.6 m: fixed.',
    parts: [part('seat', [1.8, 0.42, 0.75], CLOTH, [0, 0, 0.05], '#56708f'), part('back', [2, 0.8, 0.2], CLOTH, [0, 0, -0.325], '#4c6584'), part('armWest', [0.1, 0.6, 0.85], CLOTH, [-0.95, 0, 0], '#4c6584'), part('armEast', [0.1, 0.6, 0.85], CLOTH, [0.95, 0, 0], '#4c6584')], // prettier-ignore
    body: fixed([2, 0.8, 0.85]),
  },
  'prop:playground-tv': {
    description: 'A television, its screen 1.1 m wide, on a low stand 1.2 m long: fixed.',
    parts: [part('stand', [1.2, 0.5, 0.4], WOOD, [0, 0, 0], '#6b4a30'), part('screen', [1.1, 0.65, 0.05], PAINT, [0, 0.5, 0], '#1d2126'), part('picture', [1.02, 0.57, 0.01], PAINT, [0, 0.54, 0.028], '#5d7d9e')], // prettier-ignore
    body: fixed([1.2, 1.2, 0.4]),
  },
  'prop:playground-fireplace': {
    description: 'A stone fireplace, 1.6 m wide and 1.2 m high, its fire burning in its hearth: fixed.',
    parts: [part('hearth', [1.6, 0.15, 0.6], STONE), part('back', [1.6, 1.2, 0.2], STONE, [0, 0, -0.2]), part('sideWest', [0.3, 1, 0.4], STONE, [-0.65, 0.15, 0]), part('sideEast', [0.3, 1, 0.4], STONE, [0.65, 0.15, 0]), part('mantel', [1.7, 0.1, 0.5], WOOD, [0, 1.1, -0.05], '#5a3b22'), part('coals', [0.8, 0.06, 0.3], GLOW, [0, 0.15, 0], '#ff7a2a')], // prettier-ignore
    body: fixed([1.6, 1.2, 0.6]),
    light: {
      tag: 'fire',
      color: '#ff9a4a',
      intensity: 4,
      distance: 6,
      decay: 1,
      position: [0, 0.4, 0.1],
      flicker: true,
    },
  },
  'prop:playground-rug': {
    description: 'A rug, 2.4 × 1.6 m, flat on the floor: no body.',
    parts: [{ ...part('rug', [2.4, 0.01, 1.6], CLOTH, [0, 0, 0], '#8a3d36'), shadow: false }],
  },
  'prop:playground-fridge': {
    description: 'A fridge, 0.7 × 0.7 m and 1.8 m high: fixed.',
    parts: [part('body', [0.7, 1.8, 0.66], PAINT, [0, 0, -0.02], '#e8e6e0'), part('handle', [0.04, 0.5, 0.04], IRON, [0.28, 0.9, 0.33])], // prettier-ignore
    body: fixed([0.7, 1.8, 0.7]),
  },
  'prop:playground-stove': {
    description: 'A stove, 0.7 × 0.6 m and 0.9 m high, four rings on its top: fixed.',
    parts: [part('body', [0.7, 0.88, 0.6], PAINT, [0, 0, 0], '#d9d6cf'), part('top', [0.7, 0.02, 0.6], IRON, [0, 0.88, 0]), ...[[-0.17, -0.14], [0.17, -0.14], [-0.17, 0.14], [0.17, 0.14]].map(([x, z], i) => ({ name: `ring${i + 1}`, geometry: 'geometry:ring', params: { innerRadius: 0.05, outerRadius: 0.09, height: 0.01, radialSegments: 16 }, material: PAINT, tint: '#2b2b2b', position: [x, 0.9, z] }))], // prettier-ignore
    body: fixed([0.7, 0.9, 0.6]),
  },
  'prop:playground-bath': {
    description: 'A bath, 1.7 × 0.75 m and 0.55 m high: fixed.',
    parts: [part('tub', [1.7, 0.5, 0.75], PAINT, [0, 0, 0], '#f2f1ec'), ...[-1, 1].flatMap((k) => [part(`rim${k}z`, [1.7, 0.05, 0.075], PAINT, [0, 0.5, k * 0.3375], '#f2f1ec'), part(`rim${k}x`, [0.075, 0.05, 0.6], PAINT, [k * 0.8125, 0.5, 0], '#f2f1ec')]), part('water', [1.55, 0.01, 0.6], PAINT, [0, 0.5, 0], '#7fa8c0')], // prettier-ignore
    body: fixed([1.7, 0.55, 0.75]),
  },
  'prop:playground-toilet': {
    description: 'A toilet, 0.4 × 0.65 m, its cistern 0.75 m high: fixed.',
    parts: [part('bowl', [0.4, 0.42, 0.45], PAINT, [0, 0, 0.1], '#f2f1ec'), part('cistern', [0.4, 0.75, 0.18], PAINT, [0, 0, -0.235], '#f2f1ec')], // prettier-ignore
    body: fixed([0.4, 0.75, 0.65]),
  },
  'prop:playground-basin': {
    description: 'A basin on its stand, 0.6 × 0.45 m and 0.85 m high: fixed.',
    parts: [part('stand', [0.2, 0.7, 0.2], PAINT, [0, 0, -0.1], '#f2f1ec'), part('bowl', [0.6, 0.15, 0.45], PAINT, [0, 0.7, 0], '#f2f1ec')], // prettier-ignore
    body: fixed([0.6, 0.85, 0.45]),
  },
  'prop:playground-bed': {
    description: 'A double bed, 2 × 1.4 m, its mattress 0.55 m up and its headboard 1 m: fixed.',
    parts: [part('frame', [1.4, 0.35, 2], WOOD, [0, 0, 0], '#7a5434'), part('mattress', [1.35, 0.2, 1.9], CLOTH, [0, 0.35, 0.03], '#e9e4d8'), part('pillow', [1.1, 0.1, 0.35], CLOTH, [0, 0.55, -0.7], '#fafafa'), part('headboard', [1.4, 1, 0.06], WOOD, [0, 0, -0.97], '#6b4a30')], // prettier-ignore
    body: fixed([1.4, 1, 2]),
  },
  'prop:playground-bunkbed': {
    description: 'A bunk bed, 2 × 1 m and 1.7 m high: a mattress at 0.4 m and one at 1.45 m, its top a ledge to mantle onto. Fixed.', // prettier-ignore
    parts: [part('lower', [1, 0.15, 2], WOOD, [0, 0.25, 0], '#7a5434'), part('lowerMattress', [0.95, 0.15, 1.9], CLOTH, [0, 0.4, 0], '#5c86a8'), part('upper', [1, 0.15, 2], WOOD, [0, 1.3, 0], '#7a5434'), part('upperMattress', [0.95, 0.15, 1.9], CLOTH, [0, 1.45, 0], '#a85c5c'), part('rail', [0.06, 0.1, 1.9], WOOD, [0.47, 1.6, 0], '#7a5434'), ...[[-0.47, -0.97], [0.47, -0.97], [-0.47, 0.97], [0.47, 0.97]].map(([x, z], i) => part(`post${i + 1}`, [0.06, 1.7, 0.06], WOOD, [x, 0, z], '#6b4a30'))], // prettier-ignore
    body: fixed([1, 1.7, 2]),
  },
  'prop:playground-desk': {
    description: 'A desk, 1.2 × 0.6 m and 0.75 m high, on a drawer stand and a side panel: fixed.',
    parts: [part('top', [1.2, 0.04, 0.6], WOOD, [0, 0.71, 0], '#8b6240'), part('drawers', [0.4, 0.71, 0.55], WOOD, [-0.38, 0, 0], '#7a5434'), part('leg', [0.05, 0.71, 0.55], WOOD, [0.55, 0, 0], '#7a5434')], // prettier-ignore
    body: fixed([1.2, 0.75, 0.6]),
  },
  'prop:playground-bookshelf': {
    description: 'A bookshelf, 1 × 0.35 m and 1.9 m high, its books in rows: fixed.',
    parts: [part('case', [1, 1.9, 0.35], WOOD, [0, 0, 0], '#6b4a30'), ...[0.35, 0.8, 1.25].map((y, i) => part(`books${i + 1}`, [0.9, 0.28, 0.02], CLOTH, [0, y, 0.17], ['#8a3d36', '#3d6a8a', '#5a7a3d'][i]))], // prettier-ignore
    body: fixed([1, 1.9, 0.35]),
  },
  'prop:playground-workbench': {
    description: 'A workbench, 2 × 0.7 m and 0.9 m high, a thick wooden top on iron legs: fixed.',
    parts: [part('top', [2, 0.08, 0.7], WOOD, [0, 0.82, 0], '#9a7046'), ...[[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]].map(([x, z], i) => part(`leg${i + 1}`, [0.06, 0.82, 0.06], IRON, [x, 0, z])), part('shelf', [1.9, 0.03, 0.6], WOOD, [0, 0.2, 0], '#8b6240')], // prettier-ignore
    body: fixed([2, 0.9, 0.7]),
  },
  'prop:playground-shelves': {
    description: 'Iron shelves, 1.8 × 0.45 m and 2 m high, four boards: fixed.',
    parts: [...[0.05, 0.65, 1.25, 1.85].map((y, i) => part(`board${i + 1}`, [1.8, 0.04, 0.45], WOOD, [0, y, 0], '#9a7046')), ...[[-0.88, -0.2], [0.88, -0.2], [-0.88, 0.2], [0.88, 0.2]].map(([x, z], i) => part(`upright${i + 1}`, [0.04, 2, 0.04], IRON, [x, 0, z]))], // prettier-ignore
    body: fixed([1.8, 2, 0.45]),
  },
  'prop:playground-washer': {
    description: 'A washing machine, 0.6 m square and 0.85 m high, its round door in front: fixed.',
    parts: [part('body', [0.6, 0.85, 0.6], PAINT, [0, 0, 0], '#ecebe6'), { name: 'door', geometry: 'geometry:ring', params: { innerRadius: 0.12, outerRadius: 0.2, height: 0.02, radialSegments: 16 }, material: IRON, position: [0, 0.42, 0.3], rotation: [Math.PI / 2, 0, 0] }], // prettier-ignore
    body: fixed([0.6, 0.85, 0.6]),
  },
  'prop:playground-boiler': {
    description: 'The boiler, a drum painted grey, 0.8 m across and 1.8 m high: fixed.',
    parts: [{ name: 'drum', geometry: 'geometry:frustum', params: { radiusBottom: 0.4, radiusTop: 0.4, height: 1.8, radialSegments: 16, smooth: true }, material: PAINT, tint: '#9aa0a8' }], // prettier-ignore
    body: { type: 'fixed', shape: 'cylinder', radius: 0.4, height: 1.8 },
  },
  'prop:playground-car': {
    description: 'A car, 4.2 × 1.8 m and 1.45 m high, until vehicles arrive (docs/PLAYGROUND.md §11): fixed.',
    parts: [part('body', [1.8, 0.7, 4.2], PAINT, [0, 0.25, 0], '#a83a32'), part('cabin', [1.6, 0.5, 2.2], PAINT, [0, 0.95, -0.2], '#a83a32'), part('glass', [1.62, 0.36, 2], PAINT, [0, 1.02, -0.2], '#9fb7c7'), ...[[-0.8, -1.35], [0.8, -1.35], [-0.8, 1.35], [0.8, 1.35]].map(([x, z], i) => ({ name: `wheel${i + 1}`, geometry: 'geometry:frustum', params: { radiusBottom: 0.32, radiusTop: 0.32, height: 0.22, radialSegments: 14, smooth: true }, material: IRON, tint: '#2a2a2a', position: [x - Math.sign(x) * 0.11, 0.32, z], rotation: [0, 0, -Math.sign(x) * (Math.PI / 2)] }))], // prettier-ignore
    body: fixed([1.8, 1.45, 4.2]),
  },
  'prop:playground-box': {
    description: 'A cardboard box, 0.4 × 0.35 m and 0.35 m high, 3 kg: carry it and throw it.',
    parts: [part('box', [0.4, 0.35, 0.35], PAINT, [0, 0, 0], '#b58b5a'), part('tape', [0.06, 0.005, 0.35], PAINT, [0, 0.35, 0], '#d9c08a')], // prettier-ignore
    body: { type: 'dynamic', shape: 'box', size: [0.4, 0.35, 0.35], density: 61 },
  },
} as const satisfies Record<string, PropDefinition>;

for (const [id, spec] of Object.entries(HOUSE_PROPS)) defineProp(id, spec as PropDefinition);
