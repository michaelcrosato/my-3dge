/**
 * @file The props library (PLAN.md WP 10.3; fired by the playground, ADR-0025): nine props beyond the catalog's
 * crate, barrel, fire and pillar (engine/world/props/catalog.ts), as plain `prop` specs the kind registers with them
 * (engine/world/props/prop.ts). Each is built from the geometry kit's shapes (engine/gfx/geometry/builtins.ts) in the
 * engine's materials and the props' own (`material:iron`, `material:cloth`: engine/gfx/props.ts).
 *
 * - **The sconce**: an iron torch sconce for a wall, its plate's foot the origin and its torch leaning out to +Z, a
 *   burning torch and its flickering light (the tag `sconce`); no body. A scene places it on a wall's face.
 * - **The banner**: a red cloth on a crossbar, a 2.6 m oak pole on a stone foot; fixed.
 * - **The chest**: planks bound in iron, a rounded lid and a lock plate, 0.9 m wide, 40 kg: it slides when knocked.
 * - **The door**: a plank door, 0.9 × 2.05 m and 4.5 cm thick, iron straps and a ring pull on its +Z face; kinematic,
 *   it stands where it is placed until engine/sim/doors.ts swings it on its hinge (WP 13.16), and breaks into splinters.
 * - **The table**: a trestle table, 1.6 × 0.9 m and 0.75 m high, 30 kg: it slides and tips.
 * - **The bench**: a plank bench, 1.4 m long and 0.45 m high, on two slab legs, 15 kg.
 * - **The statue**: a robed stone figure, 2.2 m high on its plinth; fixed.
 * - **The lantern**: an iron lantern with glowing panes, a cap and a carrying ring, 2 kg, its light flickering inside
 *   (the tag `lantern`).
 * - **The chair**: a plank chair, its seat on two slab sides and a back, 6 kg: what a player picks up and throws
 *   (WP 13.16).
 *
 * Each with a body stands on spawn points of its name (`chest`, `table`, …: `levelProps`, engine/world/props/place.ts).
 * The hooks are the kind's: a hit knocks the dynamic ones (the chest, the table, the bench, the lantern, the chair) and
 * leaves the rest; using one does nothing: the sim gives doors their use (engine/sim/doors.ts, WP 13.16), and a player
 * carries the light ones (engine/sim/interact.ts).
 *
 * Invariants: plain data (the kind's fields only), ids `prop:<name>`; every part of a prop with a body stands on its
 * base or above it, its lowest point the base (`x qa geo` checks it); sizes in metres, masses through `density`.
 *
 * @example
 * LIBRARY_PROPS['prop:table'].body.size; // [1.6, 0.75, 0.9]
 * Object.keys(LIBRARY_PROPS).length; // 9
 * @see engine/world/props/library.test.ts
 */
import type { PropDefinition } from './prop';

/** A quarter turn (rad): a ring stood up to face +Z, a limb hung down. */
const QUARTER = Math.PI / 2;

/** The props library's props, by id. */
export const LIBRARY_PROPS = {
  'prop:sconce': {
    description:
      'An iron torch sconce for a wall: a plate, a bracket and a cup holding a burning torch, its light flickering. No body; its origin is the plate’s foot on the wall, the torch out toward +Z.',
    parts: [
      { name: 'plate', geometry: 'geometry:box', params: { width: 0.12, height: 0.3, depth: 0.025 }, material: 'material:iron', position: [0, 0, 0.0125] }, // prettier-ignore
      { name: 'arm', geometry: 'geometry:box', params: { width: 0.035, height: 0.035, depth: 0.2 }, material: 'material:iron', position: [0, 0.1, 0.125] }, // prettier-ignore
      { name: 'cup', geometry: 'geometry:frustum', params: { radiusBottom: 0.025, radiusTop: 0.055, height: 0.08, radialSegments: 6 }, material: 'material:iron', position: [0, 0.1, 0.225] }, // prettier-ignore
      { name: 'torch', geometry: 'geometry:frustum', params: { radiusBottom: 0.018, radiusTop: 0.024, height: 0.3, radialSegments: 6 }, material: 'material:planks', position: [0, 0.06, 0.225] }, // prettier-ignore
      {
        name: 'flames',
        geometry: 'geometry:frustum',
        params: { radiusBottom: 0.05, radiusTop: 0, height: 1, radialSegments: 5 },
        material: 'material:flame',
        tint: '#ff7a2a',
        position: [0, 0.36, 0.225],
        shadow: false,
        flame: { tongues: 3, ring: 0.025, height: 0.22, sway: 0.03, core: '#ffd36a' },
      },
    ],
    light: { tag: 'sconce', color: '#ffc8a0', intensity: 12, distance: 8, decay: 1, position: [0, 0.5, 0.225], flicker: true }, // prettier-ignore
  },
  'prop:banner': {
    description:
      'A banner: a red cloth with a gold hem on a crossbar, a 2.6 m oak pole on a stone foot. It never moves.',
    parts: [
      { name: 'foot', geometry: 'geometry:frustum', params: { radiusBottom: 0.25, radiusTop: 0.2, height: 0.12 }, material: 'material:stone' }, // prettier-ignore
      { name: 'pole', geometry: 'geometry:frustum', params: { radiusBottom: 0.035, radiusTop: 0.03, height: 2.5, smooth: true }, material: 'material:planks', position: [0, 0.12, 0] }, // prettier-ignore
      { name: 'bar', geometry: 'geometry:box', params: { width: 0.9, height: 0.05, depth: 0.05 }, material: 'material:planks', position: [0, 2.42, 0.06] }, // prettier-ignore
      { name: 'cloth', geometry: 'geometry:box', params: { width: 0.8, height: 1.45, depth: 0.015 }, material: 'material:cloth', tint: '#a32424', position: [0, 0.97, 0.06] }, // prettier-ignore
      { name: 'hem', geometry: 'geometry:box', params: { width: 0.8, height: 0.06, depth: 0.02 }, material: 'material:cloth', tint: '#d8b04a', position: [0, 0.97, 0.06] }, // prettier-ignore
    ],
    body: { type: 'fixed', shape: 'cylinder', radius: 0.25, height: 2.62 },
    place: { spawn: 'banner' },
  },
  'prop:chest': {
    description: 'A wooden chest bound in iron, 0.9 m wide: planks, a rounded lid, two bands and a lock plate. 40 kg.',
    parts: [
      { name: 'box', geometry: 'geometry:box', params: { width: 0.9, height: 0.4, depth: 0.55 }, material: 'material:planks' }, // prettier-ignore
      { name: 'lid', geometry: 'geometry:roundedBox', params: { width: 0.92, height: 0.16, depth: 0.57, radius: 0.05 }, material: 'material:planks', position: [0, 0.4, 0] }, // prettier-ignore
      { name: 'bandWest', geometry: 'geometry:box', params: { width: 0.05, height: 0.57, depth: 0.58 }, material: 'material:iron', position: [-0.3, 0, 0] }, // prettier-ignore
      { name: 'bandEast', geometry: 'geometry:box', params: { width: 0.05, height: 0.57, depth: 0.58 }, material: 'material:iron', position: [0.3, 0, 0] }, // prettier-ignore
      { name: 'lock', geometry: 'geometry:box', params: { width: 0.1, height: 0.12, depth: 0.02 }, material: 'material:iron', position: [0, 0.3, 0.285] }, // prettier-ignore
    ],
    body: { type: 'dynamic', shape: 'box', size: [0.9, 0.56, 0.55], density: 144 },
    place: { spawn: 'chest' },
  },
  'prop:door': {
    description:
      'A plank door, 0.9 × 2.05 m and 4.5 cm thick, three iron straps and a ring pull on its +Z face. It stands fixed where it is placed.',
    parts: [
      { name: 'leaf', geometry: 'geometry:box', params: { width: 0.9, height: 2.05, depth: 0.045 }, material: 'material:planks' }, // prettier-ignore
      ...[0.25, 0.95, 1.7].map((y, i) => ({ name: `strap${i + 1}`, geometry: 'geometry:box', params: { width: 0.84, height: 0.06, depth: 0.01 }, material: 'material:iron', position: [0, y, 0.0275] })), // prettier-ignore
      { name: 'pull', geometry: 'geometry:ring', params: { innerRadius: 0.035, outerRadius: 0.05, height: 0.012, radialSegments: 12 }, material: 'material:iron', position: [0.34, 1, 0.0225], rotation: [QUARTER, 0, 0] }, // prettier-ignore
    ],
    body: { type: 'kinematic', shape: 'box', size: [0.9, 2.05, 0.045] },
    breaks: { shards: 'splinters' },
  },
  'prop:table': {
    description: 'A trestle table of planks, 1.6 × 0.9 m and 0.75 m high, its top on two slab legs. 30 kg.',
    parts: [
      { name: 'top', geometry: 'geometry:box', params: { width: 1.6, height: 0.05, depth: 0.9 }, material: 'material:planks', position: [0, 0.7, 0] }, // prettier-ignore
      { name: 'legWest', geometry: 'geometry:box', params: { width: 0.06, height: 0.7, depth: 0.8 }, material: 'material:planks', position: [-0.7, 0, 0] }, // prettier-ignore
      { name: 'legEast', geometry: 'geometry:box', params: { width: 0.06, height: 0.7, depth: 0.8 }, material: 'material:planks', position: [0.7, 0, 0] }, // prettier-ignore
    ],
    body: { type: 'dynamic', shape: 'box', size: [1.6, 0.75, 0.9], density: 28 },
    place: { spawn: 'table' },
  },
  'prop:bench': {
    description: 'A plank bench, 1.4 m long, 0.35 m deep and 0.45 m high, its seat on two slab legs. 15 kg.',
    parts: [
      { name: 'seat', geometry: 'geometry:box', params: { width: 1.4, height: 0.05, depth: 0.35 }, material: 'material:planks', position: [0, 0.4, 0] }, // prettier-ignore
      { name: 'legWest', geometry: 'geometry:box', params: { width: 0.05, height: 0.4, depth: 0.3 }, material: 'material:planks', position: [-0.55, 0, 0] }, // prettier-ignore
      { name: 'legEast', geometry: 'geometry:box', params: { width: 0.05, height: 0.4, depth: 0.3 }, material: 'material:planks', position: [0.55, 0, 0] }, // prettier-ignore
    ],
    body: { type: 'dynamic', shape: 'box', size: [1.4, 0.45, 0.35], density: 68 },
    place: { spawn: 'bench' },
  },
  'prop:statue': {
    description: 'A stone statue of a robed figure, its arms at its sides, 2.2 m high on its plinth. It never moves.',
    parts: [
      { name: 'plinth', geometry: 'geometry:box', params: { width: 0.8, height: 0.5, depth: 0.8 }, material: 'material:stone' }, // prettier-ignore
      { name: 'robe', geometry: 'geometry:frustum', params: { radiusBottom: 0.3, radiusTop: 0.18, height: 1, radialSegments: 10, smooth: true }, material: 'material:stone', position: [0, 0.5, 0] }, // prettier-ignore
      { name: 'torso', geometry: 'geometry:limb', params: { length: 0.3, radiusStart: 0.19, radiusEnd: 0.16, radialSegments: 10, capSegments: 3 }, material: 'material:stone', position: [0, 1.5, 0] }, // prettier-ignore
      { name: 'head', geometry: 'geometry:limb', params: { length: 0.08, radiusStart: 0.1, radiusEnd: 0.095, radialSegments: 10, capSegments: 3 }, material: 'material:stone', position: [0, 2.01, 0] }, // prettier-ignore
      { name: 'armWest', geometry: 'geometry:limb', params: { length: 0.55, radiusStart: 0.06, radiusEnd: 0.05, radialSegments: 8, capSegments: 2 }, material: 'material:stone', position: [-0.2, 1.85, 0], rotation: [0, 0, 2 * QUARTER - 0.15] }, // prettier-ignore
      { name: 'armEast', geometry: 'geometry:limb', params: { length: 0.55, radiusStart: 0.06, radiusEnd: 0.05, radialSegments: 8, capSegments: 2 }, material: 'material:stone', position: [0.2, 1.85, 0], rotation: [0, 0, 2 * QUARTER + 0.15] }, // prettier-ignore
    ],
    body: { type: 'fixed', shape: 'box', size: [0.8, 2.2, 0.8] },
    place: { spawn: 'statue' },
  },
  'prop:lantern': {
    description: 'An iron lantern, 0.4 m high to its ring: a base, glowing panes, a top and a cap. 2 kg; its light flickers inside.', // prettier-ignore
    parts: [
      { name: 'base', geometry: 'geometry:box', params: { width: 0.2, height: 0.04, depth: 0.2 }, material: 'material:iron' }, // prettier-ignore
      { name: 'panes', geometry: 'geometry:box', params: { width: 0.18, height: 0.18, depth: 0.18 }, material: 'material:glow', tint: '#ffd9a0', position: [0, 0.04, 0], shadow: false }, // prettier-ignore
      { name: 'top', geometry: 'geometry:box', params: { width: 0.2, height: 0.03, depth: 0.2 }, material: 'material:iron', position: [0, 0.22, 0] }, // prettier-ignore
      { name: 'cap', geometry: 'geometry:frustum', params: { radiusBottom: 0.14, radiusTop: 0.02, height: 0.08, radialSegments: 4 }, material: 'material:iron', position: [0, 0.25, 0], rotation: [0, QUARTER / 2, 0] }, // prettier-ignore
      { name: 'ring', geometry: 'geometry:ring', params: { innerRadius: 0.025, outerRadius: 0.035, height: 0.01, radialSegments: 12 }, material: 'material:iron', position: [0, 0.365, -0.005], rotation: [QUARTER, 0, 0] }, // prettier-ignore
    ],
    body: { type: 'dynamic', shape: 'box', size: [0.2, 0.4, 0.2], density: 125 },
    light: { tag: 'lantern', color: '#ffd9a0', intensity: 3, distance: 6, decay: 1, position: [0, 0.13, 0], flicker: true }, // prettier-ignore
    place: { spawn: 'lantern' },
  },
  'prop:chair': {
    description: 'A plank chair, 0.44 m wide and 0.9 m high at its back, its seat 0.45 m up on two slab sides. 6 kg.',
    parts: [
      { name: 'seat', geometry: 'geometry:box', params: { width: 0.44, height: 0.04, depth: 0.42 }, material: 'material:planks', position: [0, 0.41, 0] }, // prettier-ignore
      { name: 'sideWest', geometry: 'geometry:box', params: { width: 0.04, height: 0.41, depth: 0.38 }, material: 'material:planks', position: [-0.18, 0, 0] }, // prettier-ignore
      { name: 'sideEast', geometry: 'geometry:box', params: { width: 0.04, height: 0.41, depth: 0.38 }, material: 'material:planks', position: [0.18, 0, 0] }, // prettier-ignore
      { name: 'back', geometry: 'geometry:box', params: { width: 0.44, height: 0.45, depth: 0.04 }, material: 'material:planks', position: [0, 0.45, -0.19] }, // prettier-ignore
    ],
    body: { type: 'dynamic', shape: 'box', size: [0.44, 0.9, 0.44], density: 34 },
    place: { spawn: 'chair' },
  },
} as const satisfies Record<string, PropDefinition>;
