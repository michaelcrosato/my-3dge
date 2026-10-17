/**
 * @file Walls and ledges (PLAN.md WP 13.6, docs/PLAYGROUND.md §3.2): what the shooter model mantles onto and climbs, by
 * casts of the character's hull and rays, after er-apex's `detect_ledge` (`umiiii/er-apex`,
 * `deps/er-apex-move/src/controller.rs` 1575-1668; MIT, engine/physics/movement/NOTICE). `findWall`: a wall steeper
 * than the character walks within `probe` of its hull ahead. `findLedge`: the wall's top, a walkable lip higher than a
 * step and no higher than `reach` above the feet; a walkable spot on it one radius and two skins in; and the mantle's
 * path clear for the hull, standing else crouched (`ledgePath`: to the wall, up until the feet clear the lip, across
 * to the spot, down onto it). Ours: er-apex rises the whole reach before crossing, so a roof over a low ledge refused
 * it and a top only the crouched hull fits was never found; this rises only as far as the lip needs. The shooter model
 * mantles along the path (engine/physics/movement/mantle.ts) and climbs the walls (climb.ts).
 *
 * Invariants: queries only, through the physics world's own casts and rays (engine/physics/queries.ts), never moving
 * anything; sensors, the character's own body and the groups it shoves never count (its controller's filter); points
 * are world metres, a normal the wall's across the ground, a unit `[x, z]` pointing out of the wall.
 *
 * @example
 * import { addCharacter, createCharacter } from './character';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [2, 1.5, 4] }, position: [1.5, 0.75, 0] }] });
 * const hero = createCharacter({ movement: 'movement:apex' });
 * const body = addCharacter(physics, hero, [0, 0, 0]);
 * physics.step({ dt: 1 / 60, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } });
 * const wall = findWall(physics, body, hero, [1, 0], 0.61);
 * wall && findLedge(physics, body, hero, wall, { reach: 2.03 })?.height; // ≈ 1.5: the block's top, ahead
 * @see engine/physics/ledge.test.ts
 */
import type { Character } from './character';
import { hullHeight } from './hull';
import { halfHeightOf, isWalkable, partsOf } from './move';
import type { Shape } from './queries';
import { rapierOf, type Physics } from './world';

/** A point, world metres. */
type Point = readonly [number, number, number];

/** A wall `findWall` found ahead. */
export interface Wall {
  /** Where the hull touches it (m). */
  point: [number, number, number];
  /** Its normal across the ground, out of the wall, a unit `[x, z]`. */
  normal: [number, number];
  /** Its normal's part straight up: 0 for a sheer wall. */
  up: number;
}

/** A ledge `findLedge` found (see the file comment). */
export interface Ledge {
  /** How far its lip stands above the feet (m). */
  height: number;
  /** Where the feet land on its top (m). */
  landing: [number, number, number];
  /** The lip's point, where the hands go (m). */
  edge: [number, number, number];
  /** The wall's normal across the ground, out of the wall, a unit `[x, z]`. */
  normal: [number, number];
  /** The column the feet rise up at the wall, `[x, z]` (m): the hull touching it. */
  rise: [number, number];
  /** How high the lip stands over the ground below that column (m): Infinity with none within 100 m. */
  drop: number;
  /** Only the crouched hull fits on its top. */
  crouched: boolean;
}

/** How `findLedge` looks: how high a lip it takes above the feet (m). */
export interface LedgeSearch {
  reach: number;
  /** The crouched hull's straight middle, for a top only it fits on (m); absent, a top must take the standing one. */
  crouched?: number;
}

/** The groups a ledge's casts meet, past the character's own body. */
const near = (body: number) => ({ exclude: body, groups: ['world', 'prop'] as const });

/** Where `character`'s body is now and its feet's height (m); `where` names the caller for an error. */
function bodyAt(physics: Physics, body: number, character: Character, where: string) {
  const { rigid, collider } = partsOf(rapierOf(physics), body, where);
  const at = rigid.translation();
  return { at, feet: at.y - halfHeightOf(collider, character) - character.capsule.radius - character.offset };
}

/** A wall ahead of `character` along `dir` (a unit `[x, z]`) within `probe` of its hull, steeper than it walks, or null. */ // prettier-ignore
export function findWall(physics: Physics, body: number, character: Character, dir: readonly [number, number], probe: number): Wall | null { // prettier-ignore
  const { at } = bodyAt(physics, body, character, 'findWall(body)');
  const hull: Shape = { type: 'capsule', radius: character.capsule.radius, height: hullHeight(physics, body, character) };
  const options = { ...near(body), margin: character.offset / 2, maxDistance: probe };
  const hit = physics.shapeCast(hull, at, [dir[0], 0, dir[1]], options);
  if (!hit || isWalkable(character, hit.normal)) return null;
  const across = Math.hypot(hit.normal.x, hit.normal.z);
  const normal: [number, number] = across > 1e-6 ? [hit.normal.x / across, hit.normal.z / across] : [-dir[0], -dir[1]];
  return { point: [hit.point.x, hit.point.y, hit.point.z], normal, up: hit.normal.y };
}

/**
 * The mantle's path for a ledge, the feet's (see the file comment): from `feet` across to the column `rise`, up it
 * until the feet stand two skins over the lip and the landing, across to over `landing`, then down onto it.
 */
export function ledgePath(
  character: Character,
  feet: Point,
  rise: readonly [number, number],
  edge: Point,
  landing: Point,
): Point[] {
  const top = Math.max(edge[1], landing[1]) + character.offset * 2;
  return [feet, [rise[0], feet[1], rise[1]], [rise[0], top, rise[1]], [landing[0], top, landing[2]], landing];
}

/** A ledge on top of `wall` that `character` can mantle onto, within `search.reach` above its feet, or null. */
export function findLedge(
  physics: Physics,
  body: number,
  character: Character,
  wall: Wall,
  search: LedgeSearch,
): Ledge | null {
  const { at, feet } = bodyAt(physics, body, character, 'findLedge(body)');
  const { radius } = character.capsule;
  const skin = character.offset;
  const [nx, nz] = wall.normal;
  const top = feet + search.reach + skin * 4;
  const down = [0, -1, 0] as const;
  const ray = (x: number, z: number) => physics.raycast([x, top, z], down, { ...near(body), maxDistance: top - feet });
  const lip = ray(wall.point[0] - nx * skin * 2, wall.point[2] - nz * skin * 2);
  if (!lip || !isWalkable(character, lip.normal)) return null;
  const height = lip.point.y - feet;
  if (height <= character.autostep.height || height > search.reach + skin) return null;
  const onto = radius + skin * 2;
  const ground = ray(wall.point[0] - nx * onto, wall.point[2] - nz * onto);
  if (!ground || !isWalkable(character, ground.normal) || ground.point.y - feet > search.reach + skin) return null;
  const landing: [number, number, number] = [wall.point[0] - nx * onto, ground.point.y, wall.point[2] - nz * onto];
  const edge: [number, number, number] = [lip.point.x, lip.point.y, lip.point.z];
  const rise: [number, number] = [wall.point[0] + nx * (radius + skin), wall.point[2] + nz * (radius + skin)];
  const path = ledgePath(character, [at.x, feet, at.z], rise, edge, landing);
  const below = physics.raycast([rise[0], feet + skin, rise[1]], down, { ...near(body), maxDistance: 100 });
  const drop = below ? lip.point.y - below.point.y : Infinity;
  for (const [middle, crouched] of [
    [character.capsule.height, false],
    [search.crouched, true],
  ] as const) {
    if (middle !== undefined && passes(physics, body, character, path, middle)) return { height, landing, edge, normal: wall.normal, rise, drop, crouched }; // prettier-ignore
  }
  return null;
}

/** Whether a hull of straight middle `middle` moves along `path` (the feet's) through nothing and fits at its end. */
function passes(physics: Physics, body: number, character: Character, path: Point[], middle: number): boolean {
  const { radius } = character.capsule;
  const lift = character.offset + 0.005 + radius + middle / 2;
  const shape: Shape = { type: 'capsule', radius, height: middle };
  const centre = (p: Point) => [p[0], p[1] + lift, p[2]] as const;
  if (physics.overlap(shape, centre(path[0]), near(body)).length) return false;
  for (let k = 1; k < path.length - 1; k++) {
    const [a, b] = [path[k - 1], path[k]];
    const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const length = Math.hypot(...along);
    if (length < 1e-6) continue;
    const dir = [along[0] / length, along[1] / length, along[2] / length] as const;
    if (physics.shapeCast(shape, centre(a), dir, { ...near(body), maxDistance: length })) return false;
  }
  const wider: Shape = { type: 'capsule', radius: radius + character.offset / 10, height: middle };
  return physics.overlap(wider, centre(path[path.length - 1]), near(body)).length === 0;
}
