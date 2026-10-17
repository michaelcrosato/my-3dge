/**
 * @file Ledges (PLAN.md WP 13.6, docs/PLAYGROUND.md §3.2): `findLedge` looks for a ledge a character can mantle onto
 * ahead of it, by casts of its hull and rays, after er-apex's `detect_ledge` (`umiiii/er-apex`,
 * `deps/er-apex-move/src/controller.rs` 1575-1668; MIT, engine/physics/movement/NOTICE): a wall steeper than the
 * character walks within `probe` of its hull ahead; the wall's top, a walkable lip no lower than a step and no higher
 * than `reach` above the feet; a walkable spot on it one radius and two skins in; and a path for the hull, standing
 * else crouched: up until its feet clear the lip, across to the spot, and room there. Ours: er-apex rises the whole
 * reach before crossing, so a roof over a low ledge refused it and a top only the crouched hull fits was never found;
 * this rises only as far as the lip needs. The shooter model mantles onto what it finds
 * (engine/physics/movement/mantle.ts).
 *
 * Invariants: queries only, through the physics world's own casts and rays (engine/physics/queries.ts), never moving
 * anything; sensors, the character's own body and the groups it shoves never count (its controller's filter); a
 * ledge's points are world metres, its normal the wall's across the ground, a unit `[x, z]` pointing out of the wall.
 *
 * @example
 * import { addCharacter, createCharacter } from './character';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [2, 1.5, 4] }, position: [2, 0.75, 0] }] });
 * const hero = createCharacter({ movement: 'movement:apex' });
 * const body = addCharacter(physics, hero, [0, 0, 0]);
 * physics.step({ dt: 1 / 60, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } });
 * findLedge(physics, body, hero, [1, 0], { reach: 2.03, probe: 0.61 })?.height; // ≈ 1.5: the block's top, ahead
 * @see engine/physics/ledge.test.ts
 */
import type { Character } from './character';
import { hullHeight } from './hull';
import { halfHeightOf, isWalkable, partsOf } from './move';
import type { Shape } from './queries';
import { rapierOf, type Physics } from './world';

/** A ledge `findLedge` found (see the file comment). */
export interface Ledge {
  /** How far its edge stands above the feet (m). */
  height: number;
  /** Where the feet land on its top (m). */
  landing: [number, number, number];
  /** The edge's point, where the hands go (m). */
  edge: [number, number, number];
  /** The wall's normal across the ground, out of the wall, a unit `[x, z]`. */
  normal: [number, number];
  /** Only the crouched hull fits on its top. */
  crouched: boolean;
}

/** How `findLedge` looks: how high a ledge it takes and how far ahead of the hull it looks for one (m). */
export interface LedgeSearch {
  reach: number;
  probe: number;
  /** The crouched hull's straight middle, for a top only it fits on (m); absent, a top must take the standing one. */
  crouched?: number;
}

/** A ledge ahead of `character` along `dir` (a unit `[x, z]`), or null (see the file comment). */
export function findLedge(
  physics: Physics,
  body: number,
  character: Character,
  dir: readonly [number, number],
  search: LedgeSearch,
): Ledge | null {
  const { rigid, collider } = partsOf(rapierOf(physics), body, 'findLedge(body)');
  const { radius } = character.capsule;
  const skin = character.offset;
  const half = halfHeightOf(collider, character);
  const at = rigid.translation();
  const feet = at.y - half - radius - skin;
  const near = { exclude: body, groups: ['world', 'prop'] as const };
  const hull: Shape = { type: 'capsule', radius, height: hullHeight(physics, body, character) };
  const wall = physics.shapeCast(hull, at, [dir[0], 0, dir[1]], {
    ...near,
    margin: skin / 2,
    maxDistance: search.probe,
  });
  if (!wall || isWalkable(character, wall.normal)) return null;
  const across = Math.hypot(wall.normal.x, wall.normal.z);
  const normal: [number, number] =
    across > 1e-6 ? [wall.normal.x / across, wall.normal.z / across] : [-dir[0], -dir[1]];
  const top = feet + search.reach + skin * 4;
  const inset = [wall.point.x - normal[0] * skin * 2, wall.point.z - normal[1] * skin * 2];
  const lip = physics.raycast([inset[0], top, inset[1]], [0, -1, 0], { ...near, maxDistance: top - feet });
  if (!lip || !isWalkable(character, lip.normal)) return null;
  const height = lip.point.y - feet;
  if (height <= character.autostep.height || height > search.reach + skin) return null;
  const onto = radius + skin * 2;
  const spot: [number, number] = [wall.point.x - normal[0] * onto, wall.point.z - normal[1] * onto];
  const ground = physics.raycast([spot[0], top, spot[1]], [0, -1, 0], { ...near, maxDistance: top - feet });
  if (!ground || !isWalkable(character, ground.normal) || ground.point.y - feet > search.reach + skin) return null;
  const landing: [number, number, number] = [spot[0], ground.point.y, spot[1]];
  const edge: [number, number, number] = [lip.point.x, lip.point.y, lip.point.z];
  const rise = Math.max(lip.point.y, ground.point.y) - feet + skin * 2;
  for (const [middle, crouched] of [
    [character.capsule.height, false],
    [search.crouched, true],
  ] as const) {
    if (middle === undefined) continue;
    if (passes(physics, body, character, [at.x, feet, at.z], rise, landing, middle)) return { height, landing, edge, normal, crouched }; // prettier-ignore
  }
  return null;
}

/** Whether a hull of straight middle `middle`, its feet at `feet`, rises by `rise`, crosses over to `landing` and fits there. */ // prettier-ignore
function passes(physics: Physics, body: number, character: Character, feet: readonly number[], rise: number, landing: readonly number[], middle: number): boolean { // prettier-ignore
  const { radius } = character.capsule;
  const lift = character.offset + 0.005 + radius + middle / 2;
  const shape: Shape = { type: 'capsule', radius, height: middle };
  const near = { exclude: body, groups: ['world', 'prop'] as const };
  const from = [feet[0], feet[1] + lift, feet[2]] as const;
  if (physics.overlap(shape, from, near).length || physics.shapeCast(shape, from, [0, 1, 0], { ...near, maxDistance: rise })) return false; // prettier-ignore
  const risen = [from[0], from[1] + rise, from[2]] as const;
  const [dx, dz] = [landing[0] - feet[0], landing[2] - feet[2]];
  const far = Math.hypot(dx, dz);
  if (far > 1e-6 && physics.shapeCast(shape, risen, [dx / far, 0, dz / far], { ...near, maxDistance: far })) return false; // prettier-ignore
  const wider: Shape = { type: 'capsule', radius: radius + character.offset / 10, height: middle };
  return physics.overlap(wider, [landing[0], landing[1] + lift, landing[2]], near).length === 0;
}
