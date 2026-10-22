/**
 * @file What the bot navigates by (PLAN.md WP 5.6, WP 13.15): a level's grid (`levelBotNav`, engine/world/nav.ts) or a
 * site's graph over its terrain and every structure's storeys (`siteBotNav`, engine/world/siteNav.ts), behind one face,
 * so the bot (engine/dev/bot.ts) walks a site's yard, doorways, stairs and ladders as it walks a level. `wayTo(goal)`
 * gives the walking distance to the goal and the way down to it from any point (a point's height tells a site's storeys
 * apart); `tour(start, n, rng)` draws `n` goals reachable from the start and back from it. On a site it walks round
 * the scene's props (`propObstacles`, WP 13.18), and `closedDoorAhead` says when the door in front is one to open.
 *
 * Invariants: pure in the level or site and the climb limit; the tour draws only from the stream it is given.
 *
 * @example
 * import { compileLevel } from '../world/level/compile';
 * const nav = levelBotNav(compileLevel('#######\n#.....#\n#.###.#\n#.#...#\n#######\n'), 0.5);
 * nav.wayTo({ x: 3.5, z: 3.5 })!.distanceAt({ x: 1.5, z: 1.5 }); // 8: east along the top and round the walls
 * @see engine/dev/botNav.test.ts
 */
import type { Vector3 } from '../core/math';
import { derive, Rng } from '../core/rng';
import type { CompiledLevel } from '../world/level/types';
import { NavGrid } from '../world/nav';
import { Quaternion, Vector3 as Vec3 } from '../core/math';
import type { DoorComponent } from '../sim/doors';
import '../sim/props'; // the component `sceneProp`, which `propObstacles` reads
import type { ScenePropComponents } from '../sim/props';
import { getProp } from '../world/props/prop';
import type { Site } from '../world/site';
import { createSiteNav, type NavBlock } from '../world/siteNav';

/** A point the bot reads: on the ground (x, z), its height where a site has storeys, and what the body does there (the shooter model's mode, `ladder`, `air`…, and stance, `stand` or `crouch`). */ // prettier-ignore
export type BotPoint = Readonly<{ x: number; y?: number; z: number; mode?: string; stance?: string }>;

/**
 * The way to one goal: the walking distance from a point (Infinity where none leads), the unit way to walk, and
 * whether to crouch there (under a low ceiling, or for one a little way along it: a site's attic, a crawlspace's door;
 * never on a level's grid).
 */
export interface BotWay {
  distanceAt(at: BotPoint): number;
  direction(at: BotPoint): Vector3 | null;
  crouch?(at: BotPoint): boolean;
  /** A site's: how far its next step's floor stands over the feet (m; below them, negative), and the feet over their own. */ // prettier-ignore
  rise?(at: BotPoint): number;
  over?(at: BotPoint): number;
}

/** What the bot navigates by (see the file comment). */
export interface BotNav {
  /** The way to `goal`, or null when no open place is near it. */
  wayTo(goal: BotPoint): BotWay | null;
  /** `n` goals reachable from `start` and back, drawn from `rng`. */
  tour(start: BotPoint, n: number, rng: Rng): BotPoint[];
}

/** A level's grid as the bot reads it, a step climbing at most `climb` metres. */
export function levelBotNav(level: CompiledLevel, climb: number): BotNav {
  const grid = new NavGrid(level, { climb });
  return {
    wayTo(goal) {
      const tile = grid.nearestOpen(goal.x, goal.z);
      if (tile < 0) return null;
      const field = grid.flowField(tile);
      return { distanceAt: (at) => field.distanceAt(at.x, at.z), direction: (at) => field.direction(at.x, at.z) };
    },
    tour(start, n, rng) {
      const from = grid.nearestOpen(start.x, start.z);
      if (from < 0 || n <= 0) return [];
      const home = grid.flowField(from).distance;
      const open = [...home.keys()].filter((tile) => tile !== from && home[tile] < Infinity);
      const out: BotPoint[] = [];
      for (let tries = 0; out.length < n && open.length && tries < 8 * n; tries++) {
        const [tile] = open.splice(rng.int(0, open.length - 1), 1);
        if (!(grid.flowField(tile).distance[from] < Infinity)) continue; // reachable from the start, not only back
        const centre = grid.center(tile);
        out.push({ x: centre.x, z: centre.z });
      }
      return out;
    },
  };
}

/** How far along its way (m) the bot crouches for a low ceiling: the shooter model's 0.4 s duck at the run, 4.41 m/s, and its hull's half-width. */ // prettier-ignore
const DUCK_AHEAD = 2.2;

/** A site's graph as the bot reads it (see the file comment), a step climbing at most `climb` metres, `blocked` closed. */
export function siteBotNav(site: Site, climb: number, blocked: readonly NavBlock[] = []): BotNav {
  const nav = createSiteNav(site, { climb, blocked });
  const node = (at: BotPoint) => nav.nodeAt(at.x, at.y ?? 0, at.z);
  return {
    wayTo(goal) {
      if (node(goal) < 0) return null;
      const field = nav.flowField([goal.x, goal.y ?? 0, goal.z]);
      return {
        distanceAt: (at) => (node(at) < 0 ? Infinity : field[node(at)]),
        direction: (at) => nav.direction(field, at.x, at.y ?? 0, at.z),
        crouch: (at) => nav.crouch(field, at.x, at.y ?? 0, at.z, DUCK_AHEAD),
        rise: (at) => nav.rise(field, at.x, at.y ?? 0, at.z),
        over: (at) => nav.over(at.x, at.y ?? 0, at.z),
      };
    },
    tour(start, n, rng) {
      const from = node(start);
      if (from < 0 || n <= 0) return [];
      const home = nav.flowField([start.x, start.y ?? 0, start.z]);
      const open = [...home.keys()].filter((v) => v !== from && home[v] < Infinity);
      const out: BotPoint[] = [];
      for (let tries = 0; out.length < n && open.length && tries < 8 * n; tries++) {
        const [v] = open.splice(rng.int(0, open.length - 1), 1);
        const centre = nav.center(v);
        if (!(nav.flowField([centre.x, centre.y, centre.z])[from] < Infinity)) continue;
        out.push({ x: centre.x, y: centre.y, z: centre.z });
      }
      return out;
    },
  };
}

/** The bot's own stream for a run's tour: `derive(seed, 'bot')`, never the world's. */
export const tourStream = (seed: number): Rng => new Rng(derive(seed, 'bot'));

/** The world as `closedDoorAhead` reads it: an entity's components by its id. */
type Entities = { get(id: number): object | undefined };

/** A door's state as `closedDoorAhead` reads it (engine/sim/doors.ts's component). */
type DoorState = { target: number; angle: number; locked: boolean; broken: boolean; slide: readonly number[]; tilt?: boolean }; // prettier-ignore

/**
 * Whether `actor`'s interactor (engine/sim/interact.ts) is on a closed door it can open: one shut, not locked, not
 * broken and on no switch (engine/sim/doors.ts). The use picks it as a player's does, in reach and in front, so a
 * door the bot's way runs into is the one it finds; the bot then presses use (engine/dev/bot.ts).
 */
export function closedDoorAhead(world: Entities, actor: number): boolean {
  const user = world.get(actor) as { interactor?: { target: number } } | undefined;
  const target = user?.interactor?.target ?? -1;
  const door = target < 0 ? undefined : (world.get(target) as { door?: DoorState } | undefined)?.door;
  if (!door || door.locked || door.broken || door.tilt || door.slide.some((v) => v !== 0)) return false;
  return door.target === 0 && door.angle === 0;
}

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

/** How much of an open door's leaf, from its hinge, the bot's way leaves open (m): more than its hull's half-width, so a leaf beside its jamb never closes the doorway itself. */ // prettier-ignore
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
 * What the bot walks round on a site (WP 13.18): every prop's body as the world holds it now, but a hinged door's: shut,
 * nothing (it stands in its doorway, which the bot opens: engine/dev/bot.ts), open, its leaf where it swings to.
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
