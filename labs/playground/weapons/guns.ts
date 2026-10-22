/**
 * @file The playground's firearms (docs/PLAYGROUND.md §7.2, PLAN.md WP 13.20): a pistol and a rifle, each a prop built
 * from parts (`prop:playground-pistol`, `prop:playground-rifle`: boxes and a barrel, in the weapon's frame, the grip
 * at the origin and +Z along the barrel, no body) and a weapon of the kind `weapon` (engine/world/weapons.ts) with
 * Apex Legends' season 3 numbers for its rate, damage, magazine and reloads; its cones, recoil, sights and draw are
 * ours, shaped like the game's (a pistol's single kick, a rifle's climb that drifts right, then left):
 * - **The pistol** (`weapon:playground-pistol`, the P2020's): semi-automatic at 7 shots a second, 18 points a shot,
 *   10 rounds, a 1.25 s reload either way, a tight cone from the hip, a little kick a shot, quick to draw;
 * - **The rifle** (`weapon:playground-rifle`, the R-301's): automatic at 13.5 shots a second, 14 points a shot, 18
 *   rounds, 2.4 s to reload, 3.2 s from empty, a wider cone from the hip, a burst climbing up and to the right, then
 *   left, its sights 55° at Apex's 70° lens (WP 13.8's rifles').
 * The player carries both, holstered (`PLAYGROUND_WEAPONS`, labs/playground/cast/player.ts): 1 and 2 draw them, 3 or
 * Y held holsters (labs/playground/controls.ts).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * // node x gallery prop: both guns on the sheet
 * PISTOL.magazine; // 10
 * RIFLE.auto; // true
 * @see labs/playground/weapons/range.test.ts
 */
import { defineProp, defineWeapon, type PropDefinition } from '../../../engine/sim-api';

const [IRON, PAINT] = ['material:iron', 'material:paint'];

/** A box part `name`, `size` (m) in `material`, its base's middle at `at` (m), in `tint`, turned `rotation` (rad). */
const box = (name: string, [width, height, depth]: readonly number[], material: string, at: readonly number[], tint?: string, rotation?: readonly number[]) => ({ name, geometry: 'geometry:box', params: { width, height, depth }, material, position: [...at], ...(tint ? { tint } : {}), ...(rotation ? { rotation: [...rotation] } : {}) }); // prettier-ignore

/** A barrel `length` long and `radius` round from `at` along +Z (an upright frustum turned onto +Z). */
const barrel = (name: string, radius: number, length: number, at: readonly number[]) => ({ name, geometry: 'geometry:frustum', params: { radiusBottom: radius, radiusTop: radius, height: length, radialSegments: 10, smooth: true }, material: IRON, position: [...at], rotation: [Math.PI / 2, 0, 0] }); // prettier-ignore

/** The guns' props (see the file comment): no body, drawn in a hand. */
export const GUN_PROPS: Readonly<Record<string, PropDefinition>> = {
  'prop:playground-pistol': {
    description: 'A pistol, 21 cm long: its grip under the origin, its slide along +Z above the hand. No body.',
    parts: [
      box('grip', [0.032, 0.105, 0.045], PAINT, [0, -0.085, -0.012], '#262626', [0.2, 0, 0]), // raked back below the hand
      box('frame', [0.03, 0.025, 0.17], PAINT, [0, 0.015, 0.06], '#262626'),
      box('slide', [0.028, 0.032, 0.19], IRON, [0, 0.04, 0.062]),
      box('sights', [0.022, 0.007, 0.012], IRON, [0, 0.072, -0.018]),
      box('guard', [0.008, 0.008, 0.05], PAINT, [0, -0.012, 0.04], '#262626'),
    ],
    body: { type: 'none' },
  },
  'prop:playground-rifle': {
    description: 'A rifle, 98 cm long: its grip under the origin, its stock behind, its handguard and barrel ahead. No body.', // prettier-ignore
    parts: [
      box('grip', [0.03, 0.1, 0.04], PAINT, [0, -0.09, -0.015], '#262626', [0.25, 0, 0]),
      box('receiver', [0.046, 0.07, 0.34], PAINT, [0, -0.005, 0.07], '#3b3d40'),
      box('stock', [0.036, 0.085, 0.25], PAINT, [0, -0.04, -0.225], '#262626'),
      box('handguard', [0.05, 0.055, 0.26], PAINT, [0, 0.003, 0.37], '#2e2f31'),
      barrel('barrel', 0.011, 0.14, [0, 0.03, 0.5]),
      box('magazine', [0.03, 0.13, 0.065], IRON, [0, -0.13, 0.12], undefined, [-0.22, 0, 0]), // its foot forward
      box('sight', [0.03, 0.028, 0.12], IRON, [0, 0.065, 0.03]),
    ],
    body: { type: 'none' },
  },
};

for (const [id, spec] of Object.entries(GUN_PROPS)) defineProp(id, spec);

/** The pistol (see the file comment). */
export const PISTOL = defineWeapon('weapon:playground-pistol', {
  rate: 7,
  damage: 18,
  range: 80,
  spread: { hip: 1.2, move: 0.8, ads: 0.1 },
  recoil: [[0.9, 0.1]],
  settle: 0.3,
  magazine: 10,
  reload: { tactical: 1.25, empty: 1.25 },
  zoom: 62,
  sights: 0.16,
  draw: 0.25,
  muzzle: [0, 0.056, 0.157],
  prop: 'prop:playground-pistol',
});

/** The rifle (see the file comment). */
export const RIFLE = defineWeapon('weapon:playground-rifle', {
  rate: 13.5,
  auto: true,
  damage: 14,
  range: 120,
  spread: { hip: 2.4, move: 1.4, ads: 0.15 },
  recoil: [[0.5, 0], [0.45, 0.05], [0.4, 0.1], [0.35, 0.15], [0.3, 0.1], [0.3, 0], [0.25, -0.1], [0.25, -0.15], [0.2, -0.05]], // prettier-ignore
  settle: 0.3,
  magazine: 18,
  reload: { tactical: 2.4, empty: 3.2 },
  zoom: 55,
  sights: 0.25,
  draw: 0.4,
  muzzle: [0, 0.03, 0.64],
  prop: 'prop:playground-rifle',
});

/** What the player carries, by slot: the pistol, then the rifle. */
export const PLAYGROUND_WEAPONS: readonly string[] = [PISTOL.id, RIFLE.id];
