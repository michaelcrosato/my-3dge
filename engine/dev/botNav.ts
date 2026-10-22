/**
 * @file What the bot navigates by (PLAN.md WP 5.6, WP 13.15): a level's grid (`levelBotNav`, engine/world/nav.ts) or a
 * site's graph over its terrain and every structure's storeys (`siteBotNav`, engine/world/siteNav.ts), behind one face,
 * so the bot (engine/dev/bot.ts) walks a site's yard, doorways, stairs and ladders as it walks a level. `wayTo(goal)`
 * gives the walking distance to the goal and the way down to it from any point (a point's height tells a site's storeys
 * apart); `tour(start, n, rng)` draws `n` goals reachable from the start and back from it. `closedDoorAhead` says
 * when the door in front is one to open (WP 13.18).
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
import type { Site } from '../world/site';
import { createSiteNav } from '../world/siteNav';

/** A point the bot reads: on the ground (x, z), its height where a site has storeys, and what the body does there (the shooter model's mode: `ladder`, `air`…). */ // prettier-ignore
export type BotPoint = Readonly<{ x: number; y?: number; z: number; mode?: string }>;

/**
 * The way to one goal: the walking distance from a point (Infinity where none leads), the unit way to walk, and
 * whether to crouch there (under a low ceiling, or for the next step: a site's attic; never on a level's grid).
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

/** A site's graph as the bot reads it (see the file comment), a step climbing at most `climb` metres. */
export function siteBotNav(site: Site, climb: number): BotNav {
  const nav = createSiteNav(site, { climb });
  const node = (at: BotPoint) => nav.nodeAt(at.x, at.y ?? 0, at.z);
  return {
    wayTo(goal) {
      if (node(goal) < 0) return null;
      const field = nav.flowField([goal.x, goal.y ?? 0, goal.z]);
      return {
        distanceAt: (at) => (node(at) < 0 ? Infinity : field[node(at)]),
        direction: (at) => nav.direction(field, at.x, at.y ?? 0, at.z),
        crouch: (at) => nav.crouch(field, at.x, at.y ?? 0, at.z),
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
