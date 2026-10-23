/**
 * @file The scene's props as navigation blocks (PLAN.md WP 13.18, WP 13.21): `propObstacles(w)` is every prop's body
 * where the world holds it now, as the box a site's navigation closes the tiles under (engine/world/siteNav.ts
 * `blocked`), so a walker's way goes round a table, a fence, a parked car; a hinged door's is nothing while it is shut
 * (it stands in its doorway, a way through it) and its leaf where it swings to while it opens. The bot walks by it
 * (engine/dev/bot.ts), and so do a game's people (labs/playground/cast/neighbours.ts).
 *
 * Invariants: pure: it reads the components `sceneProp` and `door` and returns new blocks; in the props' id order.
 * Split from engine/dev/botNav.ts, so game code reaches it through the public API.
 *
 * @example
 * // const nav = createSiteNav(site, { climb: 0.4, blocked: propObstacles(w) });
 * propObstacles({ query: () => [] }); // []: no props, nothing in the way
 * @see engine/dev/botNav.test.ts
 */
import { Quaternion, Vector3 as Vec3 } from '../core/math';
import { getProp } from '../world/props/prop';
import type { NavBlock } from '../world/siteNav';
import type { DoorComponent } from './doors';
import './props'; // the component `sceneProp`, which `propObstacles` reads
import type { ScenePropComponents } from './props';

/** A body's box (m): half its `size` round `centre`, turned by `q`, as the box it fills. */
function boxOf(centre: readonly number[], size: readonly number[], q: Quaternion): NavBlock {
  const half = [0, 0, 0];
  for (const axis of [new Vec3(size[0] / 2, 0, 0), new Vec3(0, size[1] / 2, 0), new Vec3(0, 0, size[2] / 2)]) {
    const turned = axis.applyQuaternion(q);
    [half[0], half[1], half[2]] = [half[0] + Math.abs(turned.x), half[1] + Math.abs(turned.y), half[2] + Math.abs(turned.z)]; // prettier-ignore
  }
  const [x, y, z] = centre;
  return { min: [x - half[0], y - half[1], z - half[2]], max: [x + half[0], y + half[1], z + half[2]] };
}

/** How much of an open door's leaf, from its hinge, a walker's way leaves open (m): more than its hull's half-width, so a leaf beside its jamb never closes the doorway itself. */ // prettier-ignore
const IN_WALL = 0.45;

/** A hinged door's leaf where it is going open, but its part in the doorway's wall (`IN_WALL`); null going shut. */
function openLeaf(door: DoorComponent, size: readonly number[]): NavBlock | null {
  if (door.target === 0) return null;
  const turn = door.yaw + door.target;
  const [dx, dz] = [Math.cos(turn), -Math.sin(turn)]; // the leaf's width, from its hinge, turned as doors.ts turns it
  const [x0, z0] = [door.hinge[0] + dx * IN_WALL, door.hinge[2] + dz * IN_WALL];
  const [x1, z1] = [door.hinge[0] + dx * size[0], door.hinge[2] + dz * size[0]];
  const t = size[2] / 2;
  const y = door.hinge[1];
  return { min: [Math.min(x0, x1) - t, y, Math.min(z0, z1) - t], max: [Math.max(x0, x1) + t, y + size[1], Math.max(z0, z1) + t] }; // prettier-ignore
}

/**
 * What a walker goes round on a site (WP 13.18, WP 13.21): every prop's body as the world holds it now, but a hinged
 * door's: shut, nothing (it stands in its doorway, which a walker opens: engine/dev/bot.ts), open, its leaf where it
 * swings to.
 */
export function propObstacles(world: { query(...names: string[]): readonly object[] }): NavBlock[] {
  const blocks: NavBlock[] = [];
  for (const e of world.query('sceneProp') as (ScenePropComponents & { door?: DoorComponent })[]) {
    const { prop, body, x, y, z, q } = e.sceneProp;
    const { body: spec } = getProp(prop);
    if (body < 0 || spec.type === 'none') continue;
    const size = spec.shape === 'box' ? spec.size : [2 * spec.radius, spec.shape === 'ball' ? 2 * spec.radius : spec.height + (spec.shape === 'capsule' ? 2 * spec.radius : 0), 2 * spec.radius]; // prettier-ignore
    const door = e.door;
    if (door && !door.tilt && !door.slide.some((v) => v !== 0)) {
      const leaf = door.broken ? null : openLeaf(door, size);
      if (leaf) blocks.push(leaf);
      continue;
    }
    blocks.push(boxOf([x, y, z], size, new Quaternion(...q)));
  }
  return blocks;
}
