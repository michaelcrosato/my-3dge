/**
 * @file The cutaway by storey (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): what the classic views (isometric and
 * top-down: the camera type `view`) leave out of a level written as storeys, so the player shows inside it: every
 * storey above the player's (`storeyBelow`, engine/world/level/heights.ts: a flight is its storey's to its top), the
 * roof while the player is indoors, in a room or under the roof's footprint (a shed with no room marked), and his own
 * storey's heads while he is under a low ceiling (a floor glyph's `head`, not an opening's: the crawlspace), its door
 * heads with it, since they are one mesh: `cutPlace(level, x, y, z)` says all three. What stands on a storey the cut
 * takes off goes with it (`aboveStorey`: the stage leaves those props out, engine/gfx/stageProps.ts `hide`). `planStoreys(pieces, storey, indoors)` says which pieces show (pure);
 * `createStoreyCut(meshes)` applies the plan to a level's meshes, the cutaway's twins with their parts (each
 * holds its part's `userData.storey`), by `visible` alone, so no frame builds a pipeline for it. A storey of −1 (the
 * player outside, or on a roof) shows everything, as any other camera does (`clear`).
 *
 * Invariants: presentation only, never read by the sim; pure decisions; `set` writes only when its plan or the
 * meshes under the level's root change, and says whether anything did.
 *
 * @example
 * planStoreys([{ storey: 0, roof: false }, { storey: 1, roof: false }, { storey: 1, roof: true }], 1, true); // [true, true, false]: the roof off over the player
 * planStoreys([{ storey: 0, roof: false }, { storey: 1, roof: false }], 0, true); // [true, false]: the storey above off
 * planStoreys([{ storey: 0, roof: false }, { storey: 0, roof: false, heads: true }], 0, true, true); // [true, false]: under a low ceiling
 * @see engine/gfx/storeyCut.test.ts
 */
import { roomAt, storeyBelow, tileAt } from '../world/level/heights';
import type { CompiledLevel } from '../world/level/types';
import type { LevelMeshes } from './level/meshes';

/** What the plan reads of a mesh: its storey (none in a level of one storey), whether it is a roof, or its heads. */
export interface StoreyPiece {
  readonly storey?: number;
  readonly roof: boolean;
  readonly heads?: boolean;
}

/** How far over the feet a floor still counts as theirs (m): a body's feet sink a hair into it, drawn between steps. */
const FOOT = 0.1;

/**
 * Where feet at (x, y, z) of `level`'s own frame stand for the cut: the storey (−1 outside or on a roof), indoors, and
 * `low`, under a low ceiling of that storey.
 */
export function cutPlace(
  level: CompiledLevel,
  x: number,
  y: number,
  z: number,
): { storey: number; indoors: boolean; low: boolean } {
  // prettier-ignore
  const storey = storeyBelow(level, x, y + FOOT, z);
  const under = (level.roofs ?? []).some(({ footprint: [x0, z0, x1, z1] }) => x > x0 && x < x1 && z > z0 && z < z1);
  return { storey, indoors: storey >= 0 && (under || roomAt(level, x, y + FOOT, z) !== null), low: lowCeiling(level, storey, x, y, z) }; // prettier-ignore
}

/** Whether feet at (x, y, z) on `storey` stand under a low ceiling: their tile's glyph has a head and opens nothing. */
function lowCeiling(level: CompiledLevel, storey: number, x: number, y: number, z: number): boolean {
  const at = tileAt(level, x, z);
  const own = level.storeys?.[storey];
  if (!at || !own) return false;
  const glyph = level.legend[own.tiles[at.row * level.cols + at.col]];
  return (
    glyph !== undefined && (glyph.head ?? 0) > 0 && (glyph.opening ?? 'none') === 'none' && y < own.base + glyph.head!
  );
}

/** Whether a thing at (x, y, z) of `level`'s frame stands on a storey above `storey` (≥ 0): the cut hides it too. */
export function aboveStorey(level: CompiledLevel, storey: number, x: number, y: number, z: number): boolean {
  return storey >= 0 && storeyBelow(level, x, y, z) > storey;
}

/**
 * Which of `pieces` show with the player on `storey` (−1 outside or on a roof), `indoors` or not, under a `low` ceiling
 * or not (see the file comment).
 */
export function planStoreys(pieces: readonly StoreyPiece[], storey: number, indoors: boolean, low = false): boolean[] {
  return pieces.map((piece) => {
    const own = piece.storey ?? 0;
    return storey < 0 || (own <= storey && !(indoors && piece.roof) && !(low && piece.heads && own === storey));
  });
}

/** A level's cutaway by storey (see the file comment). */
export interface StoreyCut {
  /** Shows what `planStoreys` says for the player on `storey`, `indoors` or not, under a `low` ceiling or not; whether any mesh changed. */ // prettier-ignore
  set(storey: number, indoors: boolean, low?: boolean): boolean;
  /** Shows every mesh again; whether any changed. */
  clear(): boolean;
}

/** The cutaway by storey over `meshes` (see the file comment). */
export function createStoreyCut(meshes: LevelMeshes): StoreyCut {
  const roofs = new Set<object>(meshes.parts.filter((part) => part.shape === 'roof').map((part) => part.mesh));
  const heads = new Set<object>(meshes.parts.filter((part) => part.recipe === 'heads').map((part) => part.mesh));
  let last = '';
  const set = (storey: number, indoors: boolean, low = false) => {
    const children = meshes.root.children;
    const key = `${storey < 0 ? -1 : storey}|${storey >= 0 && indoors}|${storey >= 0 && low}|${children.length}`;
    if (key === last) return false;
    last = key;
    const pieces = children.map((child) => ({ storey: child.userData.storey as number | undefined, roof: roofs.has(child), heads: heads.has(child) })); // prettier-ignore
    let changed = false;
    planStoreys(pieces, storey, indoors, low).forEach((shown, i) => {
      if (children[i].visible !== shown) [children[i].visible, changed] = [shown, true];
    });
    return changed;
  };
  return { set, clear: () => set(-1, false) };
}
