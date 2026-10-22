/**
 * @file The block's outdoor props (docs/PLAYGROUND.md §2.2, PLAN.md WP 13.18), the playground's own, built as the
 * house's are (labs/playground/props/house.ts): the patio's grill; the backyard's swing set (no body: walk through it)
 * and the dog's kennel; the front yard's picket fence (a 2 m section, 0.9 m: vault it), hedge (a 4 m run, 1.2 m) and
 * mailbox; trees and rocks for the hill and the yards; the street's lamp (always on: no light group yet, WP 13.23
 * gives the street's its group to switch at dusk), its hydrant, and its bus stop's roof (a slab 2.4 m up to mantle onto), posts and back;
 * the range's targets; the ring's ropes. labs/playground/furnish.ts says where each stands.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * OUTDOOR_PROPS['prop:playground-fence'].body.size; // [2, 0.9, 0.08]: a picket fence to vault
 * @see labs/playground/scenes/site.test.ts
 */
import { defineProp, type PropDefinition } from '../../../engine/sim-api';
import { fixed, part } from './house';

const [WOOD, CLOTH, PAINT, IRON, GLOW, STONE] = ['material:wood', 'material:cloth', 'material:paint', 'material:iron', 'material:glow', 'material:stone']; // prettier-ignore

/** An upright frustum part: a trunk, a post, a hydrant's body. */
const upright = (name: string, radius: number, height: number, material: string, at: readonly number[] = [0, 0, 0], tint?: string) => ({ name, geometry: 'geometry:frustum', params: { radiusBottom: radius, radiusTop: radius, height, radialSegments: 10, smooth: true }, material, position: [...at], ...(tint ? { tint } : {}) }); // prettier-ignore

/** The outdoor props, by id (see the file comment). */
export const OUTDOOR_PROPS = {
  'prop:playground-grill': {
    description: 'A grill on its legs, 0.6 × 0.5 m and 1 m high, its lid shut: fixed.',
    parts: [part('legs', [0.5, 0.65, 0.4], IRON, [0, 0, 0]), part('bowl', [0.6, 0.25, 0.5], IRON, [0, 0.65, 0], '#2b2b2b'), part('lid', [0.6, 0.1, 0.5], IRON, [0, 0.9, 0], '#2b2b2b')], // prettier-ignore
    body: fixed([0.6, 1, 0.5]),
  },
  'prop:playground-swingset': {
    description: 'A swing set, 3 m long and 2.2 m high, its two seats hanging from the bar; no body: walk under it.',
    parts: [part('bar', [3.2, 0.08, 0.08], IRON, [0, 2.15, 0], '#3a6a8a'), ...[[-1.55, -0.6], [-1.55, 0.6], [1.55, -0.6], [1.55, 0.6]].map(([x, z], i) => part(`leg${i + 1}`, [0.07, 2.2, 0.07], IRON, [x, 0, z], '#3a6a8a')), ...[-0.6, 0.6].flatMap((x, i) => [part(`seat${i + 1}`, [0.45, 0.04, 0.2], WOOD, [x, 0.45, 0]), part(`ropeWest${i + 1}`, [0.02, 1.66, 0.02], CLOTH, [x - 0.2, 0.49, 0], '#c9b88a'), part(`ropeEast${i + 1}`, [0.02, 1.66, 0.02], CLOTH, [x + 0.2, 0.49, 0], '#c9b88a')])], // prettier-ignore
  },
  'prop:playground-kennel': {
    description: "The dog's kennel, 1 × 1.2 m and 0.9 m high, its door to the south: fixed.",
    parts: [part('box', [1, 0.65, 1.2], WOOD, [0, 0, 0], '#8b6240'), part('roof', [1.15, 0.12, 1.3], WOOD, [0, 0.65, 0], '#6b3a2a'), part('ridge', [0.6, 0.13, 1.3], WOOD, [0, 0.77, 0], '#6b3a2a'), part('door', [0.4, 0.45, 0.01], PAINT, [0, 0.05, 0.6], '#1a1a1a')], // prettier-ignore
    body: fixed([1, 0.9, 1.2]),
  },
  'prop:playground-fence': {
    description: 'A section of picket fence, 2 m long, 0.9 m high and 8 cm thick: vault it. Fixed.',
    parts: [part('rails', [2, 0.08, 0.04], WOOD, [0, 0.25, 0], '#f2f0ea'), part('top', [2, 0.08, 0.04], WOOD, [0, 0.65, 0], '#f2f0ea'), ...Array.from({ length: 8 }, (_, k) => part(`picket${k + 1}`, [0.09, 0.9, 0.02], WOOD, [-0.875 + k * 0.25, 0, 0.03], '#f7f5ef'))], // prettier-ignore
    body: fixed([2, 0.9, 0.08]),
  },
  'prop:playground-hedge': {
    description: 'A run of hedge, 4 m long, 0.8 m thick and 1.2 m high: fixed.',
    parts: [{ name: 'leaves', geometry: 'geometry:roundedBox', params: { width: 4, height: 1.2, depth: 0.8, radius: 0.2 }, material: CLOTH, tint: '#3f6b35' }], // prettier-ignore
    body: fixed([4, 1.2, 0.8]),
  },
  'prop:playground-mailbox': {
    description: 'The mailbox on its post, 1.2 m high: fixed.',
    parts: [part('post', [0.08, 1, 0.08], WOOD, [0, 0, 0], '#6b4a30'), part('box', [0.22, 0.22, 0.45], PAINT, [0, 1, 0], '#2f4f7a'), part('flag', [0.02, 0.15, 0.05], PAINT, [0.12, 1.12, 0.1], '#c0392b')], // prettier-ignore
    body: fixed([0.25, 1.22, 0.45]),
  },
  'prop:playground-tree': {
    description: 'A tree, its trunk 0.35 m across and its crown 3.2 m wide, 5.5 m high; the trunk blocks. Fixed.',
    parts: [upright('trunk', 0.18, 2.4, WOOD, [0, 0, 0], '#5a3b22'), { name: 'crown', geometry: 'geometry:limb', params: { length: 1.2, radiusStart: 1.6, radiusEnd: 1.2, radialSegments: 12, capSegments: 4 }, material: CLOTH, tint: '#4a7a3a', position: [0, 2.2, 0] }], // prettier-ignore
    body: { type: 'fixed', shape: 'cylinder', radius: 0.18, height: 2.4 },
  },
  'prop:playground-rock': {
    description: 'A rock, 1.4 m across and 0.8 m high: fixed.',
    parts: [{ name: 'rock', geometry: 'geometry:roundedBox', params: { width: 1.4, height: 0.8, depth: 1.1, radius: 0.3 }, material: STONE, tint: '#8a8a84' }], // prettier-ignore
    body: fixed([1.4, 0.8, 1.1]),
  },
  'prop:playground-streetlight': {
    description:
      'A street lamp, its pole 4.5 m high and its head over the road, always lit (no light group yet: WP 13.23). Fixed.',
    parts: [upright('pole', 0.07, 4.5, IRON, [0, 0, 0], '#3a3f45'), part('arm', [0.08, 0.08, 1.2], IRON, [0, 4.42, 0.6], '#3a3f45'), { ...part('head', [0.35, 0.12, 0.5], GLOW, [0, 4.32, 1.1], '#fff3c8'), shadow: false, lit: true }], // prettier-ignore
    body: { type: 'fixed', shape: 'cylinder', radius: 0.08, height: 4.5 },
    light: { tag: 'streetlight', color: '#ffe8b0', intensity: 10, distance: 14, decay: 1, position: [0, 4.2, 1.1] },
  },
  'prop:playground-hydrant': {
    description: 'A fire hydrant, 0.3 m across and 0.8 m high: fixed.',
    parts: [upright('body', 0.13, 0.65, PAINT, [0, 0, 0], '#c0392b'), { name: 'cap', geometry: 'geometry:limb', params: { length: 0.02, radiusStart: 0.13, radiusEnd: 0.13, radialSegments: 10, capSegments: 3 }, material: PAINT, tint: '#c0392b', position: [0, 0.65, 0] }, part('nozzles', [0.36, 0.08, 0.08], PAINT, [0, 0.42, 0], '#a83228')], // prettier-ignore
    body: { type: 'fixed', shape: 'cylinder', radius: 0.15, height: 0.8 },
  },
  'prop:playground-busstopRoof': {
    description: "The bus stop's roof, a slab 3 × 1.6 m and 0.1 m thick, its base where the posts stand it (2.4 m up): mantle onto it. Fixed.", // prettier-ignore
    parts: [part('slab', [3, 0.1, 1.6], PAINT, [0, 0, 0], '#4a5560')],
    body: fixed([3, 0.1, 1.6]),
  },
  'prop:playground-busstopPost': {
    description: 'A post of the bus stop, 2.4 m high: fixed.',
    parts: [part('post', [0.1, 2.4, 0.1], IRON, [0, 0, 0], '#4a5560')],
    body: fixed([0.1, 2.4, 0.1]),
  },
  'prop:playground-busstopBack': {
    description: "The bus stop's glass back, 2.8 m long and 2 m high, on its frame: fixed.",
    parts: [part('frame', [2.8, 0.08, 0.06], IRON, [0, 0, 0], '#4a5560'), part('glass', [2.8, 1.92, 0.02], 'material:glass', [0, 0.08, 0])], // prettier-ignore
    body: fixed([2.8, 2, 0.06]),
  },
  'prop:playground-target': {
    description: 'A target for the range: a plate 0.6 m across, ringed, on its stand, its middle 1.3 m up. Fixed.',
    parts: [part('stand', [0.08, 1, 0.08], IRON, [0, 0, 0]), { name: 'plate', geometry: 'geometry:ring', params: { innerRadius: 0, outerRadius: 0.3, height: 0.03, radialSegments: 20 }, material: PAINT, tint: '#f2f0ea', position: [0, 1.3, 0], rotation: [Math.PI / 2, 0, 0] }, { name: 'bull', geometry: 'geometry:ring', params: { innerRadius: 0, outerRadius: 0.1, height: 0.034, radialSegments: 16 }, material: PAINT, tint: '#c0392b', position: [0, 1.3, 0.002], rotation: [Math.PI / 2, 0, 0] }], // prettier-ignore
    body: fixed([0.6, 1.6, 0.1]),
  },
  'prop:playground-rope': {
    description: 'A rope of the ring, 6 m long, along +X from its middle: fixed, so it holds a body in.',
    parts: [part('rope', [6, 0.04, 0.04], CLOTH, [0, 0, 0], '#c0392b')],
    body: fixed([6, 0.04, 0.04]),
  },
} as const satisfies Record<string, PropDefinition>;

for (const [id, spec] of Object.entries(OUTDOOR_PROPS)) defineProp(id, spec as PropDefinition);
