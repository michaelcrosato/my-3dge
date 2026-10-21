/**
 * @file Rides in a running scene (PLAN.md WP 13.7, docs/PLAYGROUND.md §2.3): ziplines, ladders and launchers as
 * entities, each holding its spec (engine/world/traverse.ts) in the component `zipline`, `ladder` or `launcher`, so the
 * sim hashes, captures and restores them. `addZipline(w, spec)` places a zipline and the fixed poles under its
 * anchors (each down to its foot, the spec's `feet`), `addLadder` and `addLauncher` the others (a solid launcher's
 * box from the ground up), `addLevelLadders(w, level)` the ladders a level's ladder glyphs stand, and
 * `addSiteLadders(w, site)` each structure's, at its place and quarter turn (WP 13.15). `ridesOf(w)`
 * gives the shooter model and the launchers what the world holds (engine/physics/movement/ride.ts's `Rides`), which
 * engine/sim/actors.ts hands every character's tick; the stage draws the components (engine/gfx/stageRides.ts).
 *
 * The components declare no `x` and `z`, so the stage never draws them as stand-ins.
 *
 * Invariants: rides are data in components, never references; `ridesOf` reads the world as it is, in id order, so the
 * same world gives the same rides; a zipline's poles are fixed bodies of the group `world`, `ZIPLINE_POLE` thick.
 *
 * @example
 * import { defineScene } from './scene';
 * defineScene('rides:yard', {
 *   physics: true,
 *   setup(w) {
 *     addZipline(w, { from: [0, 8, 0], to: [0, 2, 40] }); // a pole under each anchor
 *     addLauncher(w, { at: [4, 0, 4], velocity: [0, 12, 0] }); // a jump pad: up 3.8 m under Apex's gravity
 *   },
 * });
 * @see engine/sim/rides.test.ts
 */
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { Schema } from '../core/schema';
import { physicsOf } from '../physics/binding';
import type { Rides } from '../physics/movement/ride';
import type { CompiledLevel } from '../world/level/types';
import { toWorld, turnVector, type Site } from '../world/site';
import { LADDER_FIELDS, LAUNCHER_FIELDS, launcherVolume, levelLadders, parseTraverse, ZIPLINE_FIELDS, type LadderSpec, type LauncherSpec, type ZiplineSpec } from '../world/traverse'; // prettier-ignore
import { defineComponent } from './state';
import type { World } from './world';

/** A zipline pole's radius (m). */
export const ZIPLINE_POLE = 0.06;

/** A blank of each type, for the fields a spec must give: a component always holds them, so each needs a default. */
const BLANK = { array: [], number: 0, boolean: false, string: '' } as const;

/** `fields` as a component holds them: each required field given its type's blank as a default. */
function held<S extends Schema>(fields: S): S {
  const entries = Object.entries(fields).map(([key, field]) => {
    if (!field.required) return [key, field];
    const { required: _required, ...rest } = field;
    return [key, { ...rest, default: BLANK[field.type as keyof typeof BLANK] }];
  });
  return Object.fromEntries(entries) as S;
}

/** Declares the components `zipline`, `ladder` and `launcher` on `registry`, once. */
export function defineRideKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'zipline')) return;
  defineComponent('zipline', { description: 'A zipline: a cable between two anchors, ridden either way (engine/world/traverse.ts).', fields: held(ZIPLINE_FIELDS) }, registry); // prettier-ignore
  defineComponent('ladder', { description: 'A ladder against a wall (engine/world/traverse.ts).', fields: held(LADDER_FIELDS) }, registry); // prettier-ignore
  defineComponent('launcher', { description: 'A jump pad or a trampoline (engine/world/traverse.ts).', fields: held(LAUNCHER_FIELDS) }, registry); // prettier-ignore
}
defineRideKinds();

/** Places a zipline and its poles (see the file comment); returns its entity. Throws `CORE_BAD_SPEC` naming each problem. */ // prettier-ignore
export function addZipline<C extends object>(world: World<C>, spec: Record<string, unknown>): number {
  const w = world as unknown as World;
  const zipline = parseTraverse('zipline', spec, 'addZipline(spec)');
  if (zipline.poles && !zipline.balloon) {
    [zipline.from, zipline.to].forEach(([x, y, z], k) => {
      const [foot, height] = [zipline.feet[k], y - zipline.feet[k]];
      const shape = { type: 'cylinder', radius: ZIPLINE_POLE, height } as const;
      if (height > 0.05) physicsOf(w).addBody({ type: 'fixed', position: [x, foot + height / 2, z], colliders: [{ shape }] }); // prettier-ignore
    });
  }
  return w.spawn({ zipline });
}

/** Places a ladder (see the file comment); returns its entity. Throws `CORE_BAD_SPEC` naming each problem. */
export function addLadder<C extends object>(world: World<C>, spec: Record<string, unknown>): number {
  return (world as unknown as World).spawn({ ladder: parseTraverse('ladder', spec, 'addLadder(spec)') });
}

/** Places a jump pad or a trampoline (see the file comment); returns its entity. Throws `CORE_BAD_SPEC` naming each problem. */ // prettier-ignore
export function addLauncher<C extends object>(world: World<C>, spec: Record<string, unknown>): number {
  const w = world as unknown as World;
  const launcher = parseTraverse('launcher', spec, 'addLauncher(spec)');
  if (launcher.solid && launcher.at[1] > 0.01) {
    const [x, y, z] = launcher.at;
    const size = [launcher.size[0], y, launcher.size[1]] as const;
    physicsOf(w).addBody({ type: 'fixed', position: [x, y / 2, z], colliders: [{ shape: { type: 'box', size } }] });
  }
  return w.spawn({ launcher });
}

/** Places the ladders `level`'s ladder glyphs stand (engine/world/traverse.ts's `levelLadders`); returns their entities. */ // prettier-ignore
export function addLevelLadders<C extends object>(world: World<C>, level: CompiledLevel): number[] {
  return levelLadders(level).map((ladder) => addLadder(world, ladder as unknown as Record<string, unknown>));
}

/** Places the ladders of every structure of `site` (engine/world/site.ts), in the world; returns their entities. */
export function addSiteLadders<C extends object>(world: World<C>, site: Site): number[] {
  return site.structures.flatMap((s) =>
    levelLadders(s.level).map((ladder) => {
      const [fx, fy, fz] = ladder.foot as readonly number[];
      const [x, z] = toWorld(s, fx, fz);
      const normal = turnVector(s.turn, ...(ladder.normal as unknown as [number, number]));
      return addLadder(world, { ...ladder, foot: [x, fy + s.at[1], z], top: (ladder.top as number) + s.at[1], normal });
    }),
  );
}

/** What `w` holds to ride (see the file comment); `undefined` when it holds none, so a tick asks nothing. */
export function ridesOf<C extends object>(world: World<C>): Rides | undefined {
  const w = world as unknown as World;
  const cables = (w.query('zipline') as unknown as { id: number; zipline: ZiplineSpec }[]).map(({ id, zipline }) => ({ id, from: zipline.from as [number, number, number], to: zipline.to as [number, number, number], balloon: zipline.balloon })); // prettier-ignore
  const ladders = (w.query('ladder') as unknown as { id: number; ladder: LadderSpec }[]).map(({ id, ladder }) => ({ id, foot: ladder.foot as [number, number, number], top: ladder.top, normal: ladder.normal as [number, number], width: ladder.width })); // prettier-ignore
  const launchers = (w.query('launcher') as unknown as { id: number; launcher: LauncherSpec }[]).map(
    ({ id, launcher }) => {
      const [min, max] = launcherVolume(launcher);
      return { id, min, max, top: launcher.at[1], velocity: launcher.velocity as [number, number, number], bounce: launcher.bounce, keep: launcher.keep }; // prettier-ignore
    },
  );
  return cables.length + ladders.length + launchers.length > 0 ? { cables, ladders, launchers } : undefined;
}
