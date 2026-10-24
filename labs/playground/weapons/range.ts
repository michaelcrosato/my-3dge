/**
 * @file The range's targets (docs/PLAYGROUND.md §2.2, §7.2; PLAN.md WP 13.20): things (WP 10.4, engine/world/things.ts)
 * standing as `prop:playground-target` down its three lanes (z 3, 6 and 9), facing the bench at x 4 (`RANGE_TARGETS`):
 * pop-up targets at 10 and 25 m (`thing:playground-popper`), and at 50 m moving ones sliding across their lane
 * (`thing:playground-mover`, 2 m to and fro at 1 m/s). A hit puts one down: it falls back on its base, away from the
 * bench, and pops up again `rise` seconds later, its point back. The component `popup` holds how far it has fallen and
 * how it was turned; the system `poppers` (phase `anim`, added with the first) tips each toward down or up at its
 * rate (`FALL`) and drives its body there about its base, on its track for a mover, so what the next shot meets is
 * where it is drawn. The shots' counts are the player's (engine/sim/weapons.ts: `shots`, and `hits` on a standing
 * target), which the page's HUD shows. `standRange(w)` stands them, in a scene's setup after the site's props.
 *
 * Invariants: everything a target is lives in its components; targets step in id order; no random stream.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // in a scene's setup: standRange(w); then a shot at the 10 m target of lane 2 (x 14, z 6) puts it down
 * RANGE_TARGETS.length; // 9: three lanes of three
 * @see labs/playground/weapons/range.test.ts
 */
import { defineComponent, defineThing, driveBody, getProp, getThing, physicsOf, propCentre, Quaternion, spawnThing, thingAt, Vector3, type Thing, type World } from '../../../engine/sim-api'; // prettier-ignore
import '../props/outdoors';

/** A target's fall: how far it lies back when down (rad), and how fast it falls and pops back up (rad/s). */
export const FALL = Object.freeze({ down: 1.45, fall: 7, rise: 4 });

/** The component `popup`'s fields: how far the target has fallen back, and its turn as it was stood. */
export const POPUP_FIELDS = {
  tilt: { type: 'number', default: 0, minimum: 0, unit: 'rad', description: 'How far it has fallen back from upright.' }, // prettier-ignore
  yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its turn about +Y, as it was stood.' },
} as const;

/** A target's fall (`POPUP_FIELDS`). */
export interface Popup {
  tilt: number;
  yaw: number;
}

defineComponent('popup', { description: 'A range target’s fall back and up again (WP 13.20).', fields: POPUP_FIELDS });

/** The pop-up targets: a hit puts one down, up again 2.5 s later. */
export const POPPER = defineThing('thing:playground-popper', { prop: 'prop:playground-target', hp: 1, rise: 2.5 });
/** The moving targets: as the pop-ups, sliding 2 m across their lane at 1 m/s while they stand. */
export const MOVER = defineThing('thing:playground-mover', { prop: 'prop:playground-target', hp: 1, rise: 2.5, track: [0, 0, 2], speed: 1 }); // prettier-ignore

/** Where the range's targets stand (m) and of which kind: down each lane, facing the bench (−X). */
export const RANGE_TARGETS: readonly { readonly kind: string; readonly at: readonly [number, number, number] }[] = [3, 6, 9].flatMap((z) => [
  { kind: POPPER.id, at: [14, 0, z] as const },
  { kind: POPPER.id, at: [29, 0, z] as const },
  { kind: MOVER.id, at: [54, 0, z - 1] as const },
]); // prettier-ignore

/** Their facing: the plate's +Z toward the bench. */
const FACING = -Math.PI / 2;

/** A target as this module reads it. */
type Target = { id: number; popup: Popup; thing: Thing; sceneProp: { prop: string; body: number } };

const [up, side, base, centre] = [new Vector3(0, 1, 0), new Vector3(), new Vector3(), new Vector3()];
const [turn, lean] = [new Quaternion(), new Quaternion()];

/** The system `poppers`: each target tipped toward down or up and its body driven there (see the file comment). */
function stepPoppers(w: World): void {
  for (const e of w.query('popup', 'thing', 'sceneProp') as unknown as Target[]) {
    const p = e.popup;
    const down = e.thing.state !== 'up';
    p.tilt = down ? Math.min(FALL.down, p.tilt + FALL.fall * w.dt) : Math.max(0, p.tilt - FALL.rise * w.dt);
    turn.setFromAxisAngle(up, p.yaw);
    side.set(1, 0, 0).applyQuaternion(turn); // its own +X: it falls back about it, its top away from its face
    const rotation = lean.setFromAxisAngle(side, -p.tilt).multiply(turn);
    const kind = getThing(e.thing.thing);
    const h = propCentre(getProp(e.sceneProp.prop));
    const [x, y, z] = thingAt(e.thing, kind); // its middle, on its track
    base.set(x, y - h, z);
    centre.set(0, h, 0).applyQuaternion(rotation).add(base);
    driveBody(physicsOf(w), e.sceneProp.body, centre, rotation, w.dt);
  }
}

/** Stands a range target of `kind` (its id) on its base at `at` (m), facing `yaw`: its entity. */
export function standTarget<C extends object>(
  w: World<C>,
  kind: string,
  at: readonly [number, number, number],
  yaw = FACING,
): number {
  // prettier-ignore
  const world = w as unknown as World;
  const id = spawnThing(w, kind, at, yaw, { popup: { tilt: 0, yaw } });
  if (!world.systems.has('poppers')) world.systems.add('poppers', stepPoppers, { phase: 'anim' });
  return id;
}

/** Stands the range's targets (`RANGE_TARGETS`): their entities, in order. */
export function standRange<C extends object>(w: World<C>): number[] {
  return RANGE_TARGETS.map(({ kind, at }) => standTarget(w, kind, at));
}
