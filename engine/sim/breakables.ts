/**
 * @file Breakables (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1): props with health (a prop's `health` above 0: the
 * component `propHealth`) and the windows their panes make. `damageProp(w, id, amount, from)` takes hit points; at 0
 * `breakProp` breaks it: the event its look names goes out for the view's effects (its `breaks.shards`: `glass`,
 * `splinters`; `shatter` when it names none) with `{ id, prop, position, ground }` (`ground`: its base, where debris
 * lands), its pieces (its `breaks.into`, `breaks.pieces` of them) stand where it was, knocked away from `from`, and it
 * goes, body and all: a window's pane leaves its opening open, to vault or climb through.
 *
 * `addLevelWindows(w, level, place?)` stands panes (`prop:pane`, 0.5 m each) across each window opening of a level
 * written as storeys, from its sill, in the wall's middle (in a site's structure: `place`). The system `breakables`
 * (phase `ai`, added with the first pane) breaks a pane a prop flying at it would strike this step (faster than
 * `BREAK_SPEED`, its own shape cast along its move), before the physics step, so a thrown crate goes through.
 * A strike (engine/sim/interact.ts) takes a point; `strikeBody(w, body, from, force)` is a bolt's or a shot's on a
 * body: the prop or door it is (the body-to-entity lookup, `propOfBody`) is struck, a dynamic one knocked.
 *
 * Invariants: everything is in components and bodies; panes and props in id order; no random stream (pieces stand in
 * a fixed fan round the break).
 * @see engine/sim/breakables.test.ts
 */
import type { EventMap } from '../core/events';
import { physicsOf } from '../physics/binding';
import type { Shape } from '../physics/queries';
import type { CompiledLevel } from '../world/level/types';
import { getProp, propCentre } from '../world/props/prop';
import { toWorld, type QuarterTurns } from '../world/site';
import { defineStrikable, strikeEntity } from './interact';
import { hitProp, propOfBody, removeProp, spawnProp, type ScenePropComponents } from './props';
import type { World } from './world';

/** How fast a prop must fly to break a pane it strikes (m/s): a throw, never a nudge. */
export const BREAK_SPEED = 4;
/** A pane's width (m): `prop:pane`'s. */
const PANE = 0.5;
/** The most panes one flying prop breaks in a step: a chair across two of a window's. */
const PANES_A_STEP = 4;

type Entity = ScenePropComponents & { id: number };

/** Breaks the prop `id` (see the file comment), its pieces knocked away from `from`. */
export function breakProp<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  from: readonly [number, number, number],
): void {
  // prettier-ignore
  const w = world as unknown as World;
  const e = w.get(id) as unknown as Entity | undefined;
  if (!e?.sceneProp) return;
  const prop = getProp(e.sceneProp.prop);
  const { x, y, z } = e.sceneProp;
  w.emit(prop.breaks.shards || 'shatter', { id, prop: prop.id, position: [x, y, z], ground: y - propCentre(prop) });
  removeProp(w, id);
  for (let k = 0; k < prop.breaks.pieces && prop.breaks.into; k++) {
    const a = (k / prop.breaks.pieces) * 2 * Math.PI; // a fixed fan round the break
    const piece = spawnProp(w, { prop: prop.breaks.into, at: [x + 0.2 * Math.sin(a), y, z + 0.2 * Math.cos(a)], yaw: a }); // prettier-ignore
    hitProp(w, piece, [from[0], from[1], from[2]], { speed: 2, up: 1 });
  }
}

/** Takes `amount` hit points from the breakable prop `id` (none from one without health); breaks it at 0. */
export function damageProp<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  amount: number,
  from: readonly [number, number, number],
): void {
  // prettier-ignore
  const w = world as unknown as World;
  const health = (w.get(id) as unknown as Entity | undefined)?.propHealth;
  if (!health || health.hp <= 0) return;
  health.hp = Math.max(0, health.hp - amount);
  if (health.hp === 0) breakProp(w, id, from);
}

/** A bolt's or a shot's strike on `body` from `from`: the prop or door it is, struck; a dynamic one knocked. */
export function strikeBody<C extends object, E extends EventMap>(
  world: World<C, E>,
  body: number,
  from: readonly [number, number, number],
  force: 'shot' | 'blast' = 'shot',
): void {
  // prettier-ignore
  const id = propOfBody(world, body);
  if (id >= 0) strikeEntity(world, id, from, true, force);
}

/** A prop's body as a query shape (engine/physics/queries.ts), sized as its prop's. */
function shapeOf(id: string): Shape {
  const { shape, size, radius, height } = getProp(id).body;
  return shape === 'box' ? { type: 'box', size: [size[0], size[1], size[2]] } : shape === 'ball' ? { type: 'ball', radius } : { type: shape, radius, height }; // prettier-ignore
}

/**
 * The system `breakables`: every pane a prop flying faster than BREAK_SPEED would strike this step (its own shape cast
 * along the step's move, gravity's pull in it, again past each pane it breaks) breaks before the physics step, in id
 * order.
 */
function breakPanes(w: World): void {
  const physics = physicsOf(w);
  const gravity = w.settings.get('physics.gravity') as number;
  for (const e of w.query('sceneProp') as unknown as Entity[]) {
    if (e.sceneProp.body < 0 || e.propHealth) continue;
    const { position, rotation, velocity, type } = physics.readBody(e.sceneProp.body);
    if (type !== 'dynamic' || velocity.length() < BREAK_SPEED) continue;
    const move = velocity
      .clone()
      .setY(velocity.y - gravity * w.dt)
      .multiplyScalar(w.dt); // this step's, as the physics integrates it
    const far = move.length();
    const options = { groups: 'world', maxDistance: far, rotation, exclude: e.sceneProp.body } as const;
    const [shape, way] = [shapeOf(e.sceneProp.prop), move.divideScalar(far)];
    for (let k = 0; k < PANES_A_STEP; k++) {
      const hit = physics.shapeCast(shape, position, way, options);
      const pane = hit ? propOfBody(w, hit.body) : -1;
      if (pane < 0 || !(w.get(pane) as unknown as Entity).propHealth) break;
      damageProp(w, pane, 1, [position.x, position.y, position.z]);
      if (physics.hasBody(hit!.body)) break; // it held: the prop stops against it
    }
  }
}

/** Stands the panes of `level`'s window openings (see the file comment) and returns their entities. */
export function addLevelWindows<C extends object, E extends EventMap>(
  world: World<C, E>,
  level: CompiledLevel,
  place?: { at: readonly number[]; turn: QuarterTurns },
): number[] {
  // prettier-ignore
  const w = world as unknown as World;
  const ids: number[] = [];
  for (const opening of (level.openings ?? []).filter((o) => o.kind === 'window')) {
    const [cx, , cz] = opening.center;
    const along = opening.axis === 'x';
    const count = Math.max(1, Math.round(opening.width / PANE));
    for (let k = 0; k < count; k++) {
      const offset = (k + 0.5) * (opening.width / count) - opening.width / 2;
      const [lx, lz] = along ? [cx + offset, cz] : [cx, cz + offset];
      const [x, z] = place ? toWorld({ at: place.at as [number, number, number], turn: place.turn }, lx, lz) : [lx, lz];
      const yaw = (along ? 0 : -Math.PI / 2) + ((place?.turn ?? 0) * Math.PI) / 2;
      ids.push(spawnProp(w, { prop: 'prop:pane', at: [x, opening.bottom + (place?.at[1] ?? 0), z], yaw }));
    }
  }
  if (ids.length && !w.systems.has('breakables')) w.systems.add('breakables', breakPanes, { phase: 'ai' });
  return ids;
}

/** Adds the system `breakables` to `w` (once), for panes a scene stands itself. */
export function addBreakables<C extends object, E extends EventMap>(world: World<C, E>): void {
  const w = world as unknown as World;
  if (!w.systems.has('breakables')) w.systems.add('breakables', breakPanes, { phase: 'ai' });
}

defineStrikable('propHealth', (w, id, from) => damageProp(w, id, 1, from)); // a strike, a shot or a blast: a point
