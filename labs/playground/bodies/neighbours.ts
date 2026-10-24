/**
 * @file The neighbours' bodies, `body:neighbour0` to `body:neighbour3` (docs/PLAYGROUND.md §7.4, §3.1; PLAN.md WP
 * 13.21): the player's body (labs/playground/bodies/player.ts), its parts as they are, in other clothes: each
 * neighbour's slots drawn from the palettes below by a seed of its own (`Rng(NEIGHBOUR_SEED + k)`): a skin and a hair,
 * a jacket and trousers each with its darker tone, boots and their soles, a pack, and an accent of its own (never the
 * player's orange, so he stays the one marked from every camera); bare hands: the gloves its skin, the cuffs its
 * jacket's.
 *
 * Invariants: data, drawn once at load from fixed seeds, so every run and every page dresses them alike; each body
 * names exactly the player's slots. The page registers them with its bodies (labs/playground/main.ts); the sim names
 * them by id only (labs/playground/cast/neighbours.ts).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * import { PLAYER_BODY } from './player';
 * NEIGHBOUR_BODIES.length; // 4
 * NEIGHBOUR_BODIES[0].slots?.accent === PLAYER_BODY.slots?.accent; // false
 * @see labs/playground/bodies/neighbours.test.ts
 */
import { defineBody, Rng, type BodySpec } from '../../../engine';
import { PLAYER_BODY } from './player';

/** The first neighbour's seed; the k-th's is this plus k. */
export const NEIGHBOUR_SEED = 2113;

/** The palettes a neighbour is dressed from: single colours, or a garment's two tones. */
const PALETTES = {
  skin: ['#f1c9a5', '#e3b48f', '#d1a07a', '#c68642', '#a46b45', '#8d5524', '#5c3a21'],
  hair: ['#2b1d16', '#090806', '#71635a', '#b7a69e', '#a7856a', '#dcd0ba', '#8a3b1d'],
  jacket: [['#7a3b3b', '#4e2424'], ['#3b5a7a', '#24394e'], ['#6b6b3b', '#45452a'], ['#4a7a4a', '#2e4e2e'], ['#7a5a8a', '#4b3756'], ['#8a6a3b', '#584326'], ['#c8c4b8', '#8e8a80']], // prettier-ignore
  pants: [['#3a3f4d', '#24272f'], ['#5a4a3a', '#3a3026'], ['#2f4f6f', '#1d3245'], ['#6a6a6a', '#444444'], ['#2b2b2b', '#1a1a1a'], ['#4d5a3a', '#323b26']], // prettier-ignore
  boot: [
    ['#4d3424', '#1c1a19'],
    ['#2a2a2a', '#111111'],
    ['#6b4a2a', '#2a1d10'],
    ['#e0e0e0', '#9a9a9a'],
  ],
  pack: ['#5d6442', '#4a4a52', '#6b4f3a', '#38506b'],
  accent: ['#e8c547', '#d64545', '#45a5d6', '#9ad645', '#d645b0', '#45d6b8'],
} as const;

/** Neighbour `k`'s body: the player's, its slots drawn by its seed (see the file comment). */
export function neighbourBody(k: number): BodySpec {
  const rng = new Rng(NEIGHBOUR_SEED + k);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];
  const [skin, hair, [jacket, jacketDark], [pants, pantsDark], [boot, sole], pack, accent] = [pick(PALETTES.skin), pick(PALETTES.hair), pick(PALETTES.jacket), pick(PALETTES.pants), pick(PALETTES.boot), pick(PALETTES.pack), pick(PALETTES.accent)]; // prettier-ignore
  const slots = { ...PLAYER_BODY.slots, skin, hair, jacket, jacketDark, accent, pants, pantsDark, boot, sole, glove: skin, cuff: jacket, pack }; // prettier-ignore
  return { ...PLAYER_BODY, description: `A neighbour of the block (${k}): the player's body in clothes of its own.`, slots }; // prettier-ignore
}

/** The four neighbours' bodies, by their index. */
export const NEIGHBOUR_BODIES: readonly BodySpec[] = [0, 1, 2, 3].map(neighbourBody);

NEIGHBOUR_BODIES.forEach((body, k) => defineBody(`body:neighbour${k}`, body));
