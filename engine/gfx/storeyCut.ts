/**
 * @file The cutaway by storey (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): what the classic views (isometric and
 * top-down: the camera type `view`) leave out of a level written as storeys, so the player shows inside it: every
 * storey above the player's (`storeyBelow`, engine/world/level/heights.ts: a flight is its storey's to its top), and
 * the roof while the player is indoors, in a room or under the roof's footprint (a shed with no room marked):
 * `cutPlace(level, x, y, z)` says both. `planStoreys(pieces, storey, indoors)` says which pieces show (pure);
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
 * @see engine/gfx/storeyCut.test.ts
 */
import { roomAt, storeyBelow } from '../world/level/heights';
import type { CompiledLevel } from '../world/level/types';
import type { LevelMeshes } from './level/meshes';

/** What the plan reads of a mesh: its storey (none in a level of one storey) and whether it is a roof. */
export interface StoreyPiece {
  readonly storey?: number;
  readonly roof: boolean;
}

/** How far over the feet a floor still counts as theirs (m): a body's feet sink a hair into it, drawn between steps. */
const FOOT = 0.1;

/** Where feet at (x, y, z) of `level`'s own frame stand for the cut: the storey (−1 outside or on a roof), and indoors. */
export function cutPlace(level: CompiledLevel, x: number, y: number, z: number): { storey: number; indoors: boolean } {
  const storey = storeyBelow(level, x, y + FOOT, z);
  const under = (level.roofs ?? []).some(({ footprint: [x0, z0, x1, z1] }) => x > x0 && x < x1 && z > z0 && z < z1);
  return { storey, indoors: storey >= 0 && (under || roomAt(level, x, y + FOOT, z) !== null) };
}

/** Which of `pieces` show with the player on `storey` (−1 outside or on a roof), `indoors` or not (see the file comment). */ // prettier-ignore
export function planStoreys(pieces: readonly StoreyPiece[], storey: number, indoors: boolean): boolean[] {
  return pieces.map((piece) => storey < 0 || ((piece.storey ?? 0) <= storey && !(indoors && piece.roof)));
}

/** A level's cutaway by storey (see the file comment). */
export interface StoreyCut {
  /** Shows what `planStoreys` says for the player on `storey`, `indoors` or not; whether any mesh changed. */
  set(storey: number, indoors: boolean): boolean;
  /** Shows every mesh again; whether any changed. */
  clear(): boolean;
}

/** The cutaway by storey over `meshes` (see the file comment). */
export function createStoreyCut(meshes: LevelMeshes): StoreyCut {
  const roofs = new Set<object>(meshes.parts.filter((part) => part.shape === 'roof').map((part) => part.mesh));
  let last = '';
  const set = (storey: number, indoors: boolean) => {
    const children = meshes.root.children;
    const key = `${storey < 0 ? -1 : storey}|${storey >= 0 && indoors}|${children.length}`;
    if (key === last) return false;
    last = key;
    const pieces = children.map((child) => ({ storey: child.userData.storey as number | undefined, roof: roofs.has(child) })); // prettier-ignore
    let changed = false;
    planStoreys(pieces, storey, indoors).forEach((shown, i) => {
      if (children[i].visible !== shown) [children[i].visible, changed] = [shown, true];
    });
    return changed;
  };
  return { set, clear: () => set(-1, false) };
}
