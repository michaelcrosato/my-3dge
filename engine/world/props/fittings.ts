/**
 * @file The house's fittings (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1): the props doors, windows and switches are
 * made of, as plain `prop` specs the kind registers beside the catalog's and the library's (engine/world/props/
 * prop.ts). What they do is the sim's: engine/sim/doors.ts swings and slides them, engine/sim/breakables.ts breaks
 * them, engine/sim/switches.ts turns lamps on and off.
 *
 * - **The pane**: a glass pane for a window, 0.5 × 1.2 m, its collider 2 cm thick; health 1, so any hit, shot or
 *   thrown prop breaks it into glass (`shards: 'glass'`), and the window is open. One a half metre of a window.
 * - **The switch**: a light switch's plate and rocker for a wall, its plate's foot the origin, facing +Z; no body.
 * - **The lamp**: a ceiling lamp hanging from its origin, a cord and a glowing shade, lit while its switch is on (the
 *   shade's part `lit`, so its state shows from above, where the isometric and top-down cameras look from), its light
 *   tagged `lamp`; no body.
 * - **The garage door**: a roll-up door of steel panels, 2.6 × 2.2 m; kinematic, it slides up on its switch.
 *
 * Invariants: plain data (the kind's fields only), ids `prop:<name>`; sizes in metres; the pane's and the garage
 * door's bodies stand on their bases, the switch's and the lamp's parts at their mounts.
 *
 * @example
 * FITTING_PROPS['prop:pane'].health; // 1: a hit breaks it
 * FITTING_PROPS['prop:lamp'].light.tag; // 'lamp'
 * @see engine/world/props/fittings.test.ts
 */
import type { PropDefinition } from './prop';

/** The house's fittings, by id. */
export const FITTING_PROPS = {
  'prop:pane': {
    description: 'A glass pane for a window, 0.5 × 1.2 m: a hit, a shot or a thrown prop breaks it into glass.',
    parts: [{ name: 'glass', geometry: 'geometry:box', params: { width: 0.5, height: 1.2, depth: 0.01 }, material: 'material:pane' }], // prettier-ignore
    body: { type: 'fixed', shape: 'box', size: [0.5, 1.2, 0.02] },
    health: 1,
    breaks: { shards: 'glass' },
  },
  'prop:switch': {
    description: 'A light switch for a wall: a painted plate and its rocker, the plate’s foot its origin, facing +Z.',
    parts: [
      { name: 'plate', geometry: 'geometry:box', params: { width: 0.08, height: 0.12, depth: 0.012 }, material: 'material:paint', position: [0, 0, 0.006] }, // prettier-ignore
      { name: 'rocker', geometry: 'geometry:box', params: { width: 0.025, height: 0.045, depth: 0.012 }, material: 'material:paint', tint: '#d8d2c4', position: [0, 0.0375, 0.018] }, // prettier-ignore
    ],
  },
  'prop:lamp': {
    description: 'A ceiling lamp hanging from its origin: a cord and a glowing shade, lit while its switch is on.',
    parts: [
      { name: 'cord', geometry: 'geometry:box', params: { width: 0.012, height: 0.4, depth: 0.012 }, material: 'material:iron', position: [0, -0.4, 0] }, // prettier-ignore
      { name: 'shade', geometry: 'geometry:frustum', params: { radiusBottom: 0.2, radiusTop: 0.06, height: 0.16, radialSegments: 12, smooth: true }, material: 'material:glow', tint: '#ffe7c2', position: [0, -0.56, 0], shadow: false, lit: true }, // prettier-ignore
    ],
    light: { tag: 'lamp', color: '#ffe2b0', intensity: 8, distance: 7, decay: 1, position: [0, -0.55, 0] },
  },
  'prop:garageDoor': {
    description: 'A roll-up garage door of steel panels, 2.6 × 2.2 m and 6 cm thick: it slides up on its switch.',
    parts: [
      { name: 'panels', geometry: 'geometry:box', params: { width: 2.6, height: 2.2, depth: 0.06 }, material: 'material:paint', tint: '#c9cdd2' }, // prettier-ignore
      ...[0.55, 1.1, 1.65].map((y, i) => ({ name: `seam${i + 1}`, geometry: 'geometry:box', params: { width: 2.6, height: 0.02, depth: 0.01 }, material: 'material:iron', position: [0, y, 0.035] })), // prettier-ignore
    ],
    body: { type: 'kinematic', shape: 'box', size: [2.6, 2.2, 0.06] },
  },
} as const satisfies Record<string, PropDefinition>;
