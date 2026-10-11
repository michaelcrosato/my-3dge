/**
 * @file The engine's props (PLAN.md WP 4.5): the crate, the barrel, the brazier's fire and the pillar, as plain
 * `prop` specs (engine/world/props/prop.ts declares the kind and registers these with it). Their materials and the
 * crate's texture are gfx's (engine/gfx/props.ts); their geometry is the kit's (engine/gfx/geometry/builtins.ts).
 *
 * - **The crate**: a 0.75 m box, a hollow wooden crate's 24 kg, placed on spawn points named `crate`.
 * - **The barrel**: a twelve-sided cylinder 0.375 m in radius and 0.875 m high, staves round its side and plain
 *   lids, placed on spawn points named `barrel`.
 * - **The brazier**: the fire a brazier holds, three flame tongues and its torch light, flickering; it has no body
 *   and stands on the brazier stand the level draws (the glyph `t`: engine/gfx/level/brazier.ts, its cylinder
 *   collider engine/sim/levelBodies.ts), placed under every light spot tagged `torch`. Its base is the stand's top
 *   (0.75 m); its tongues rise from the coals, 1/12 of the stand lower, and its light shines from 1 m.
 * - **The pillar**: a free-standing column of dressed stone 1 m across and 3 m high, plinth and capital, fixed,
 *   placed on spawn points named `pillar`.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:293-329` (`PROP_MESH`: the crate's 12-unit box and the
 * barrel's 6-unit radius, 14 units high, 12 sides, its lids `#7a5030`) and `src/stress-world/10-hall.js:409-433`,
 * `:436-442` (`BRAZ`'s flames: three cones 2.2 units in radius, orange `#ff7a2a` round yellow `#ffd36a` cores, 1.6
 * units from the centre, 7 units high on the coals 11 units up; the torch `#ffc8a0`, reach 170 units, decay 0.5,
 * intensity 30, 16 units up, `FLICKER`), in metres (16 units to the metre). The pillar is the 2D catalog's, drawn
 * with the hall's proportions (engine/gfx/geometry/pillar.ts).
 *
 * Invariants: plain data (the kind's fields only), ids `prop:<name>`; each body's shape stands on its base, so its
 * centre is half its height up.
 *
 * @example
 * BUILT_IN_PROPS['prop:barrel'].body.radius; // 0.375
 * @see engine/world/props/prop.test.ts
 */
import type { PropDefinition } from './prop';

/** The crate's side (m): the prototype's 12 units. */
const CRATE = 0.75;

/** The engine's props, by id. */
export const BUILT_IN_PROPS = {
  'prop:crate': {
    description: 'A wooden crate, 0.75 m: framed planks with a brace and nails. It slides, tumbles and stacks.',
    parts: [
      {
        geometry: 'geometry:box',
        params: { width: CRATE, height: CRATE, depth: CRATE },
        material: 'material:crate',
      },
    ],
    body: { type: 'dynamic', shape: 'box', size: [CRATE, CRATE, CRATE] },
    place: { spawn: 'crate' },
  },
  'prop:barrel': {
    description: 'A wooden barrel, 0.875 m high: twelve staves, two iron hoops and plain lids. It rolls when knocked.',
    parts: [
      {
        geometry: 'geometry:frustum',
        params: { radiusBottom: 0.375, radiusTop: 0.375, height: 0.875, radialSegments: 12, smooth: true },
        material: 'material:barrelStaves',
        top: 'material:barrelLid',
      },
    ],
    body: { type: 'dynamic', shape: 'cylinder', radius: 0.375, height: 0.875 },
    place: { spawn: 'barrel' },
  },
  'prop:brazier': {
    description:
      "A brazier's fire: three flame tongues dancing on the coals and its flickering torch light. It stands on the stand the level's brazier glyph draws, under each light spot tagged torch.",
    parts: [
      {
        name: 'flames',
        geometry: 'geometry:frustum',
        params: { radiusBottom: 0.1375, radiusTop: 0, height: 1, radialSegments: 5 },
        material: 'material:flame',
        tint: '#ff7a2a',
        position: [0, -0.0625, 0],
        shadow: false,
        flame: { tongues: 3, ring: 0.1, height: 0.4375, sway: 0.0875, core: '#ffd36a' },
      },
    ],
    light: {
      tag: 'torch',
      color: '#ffc8a0',
      intensity: 30,
      distance: 10.625,
      decay: 0.5,
      position: [0, 0.25, 0],
      flicker: true,
    },
    place: { light: 'torch' },
  },
  'prop:pillar': {
    description: 'A free-standing stone pillar, 1 m across and 3 m high, with a plinth and a capital. It never moves.',
    parts: [{ geometry: 'geometry:pillar', params: { width: 1, height: 3 }, material: 'material:stone' }],
    body: { type: 'fixed', shape: 'box', size: [1, 3, 1] },
    place: { spawn: 'pillar' },
  },
} as const satisfies Record<string, PropDefinition>;
