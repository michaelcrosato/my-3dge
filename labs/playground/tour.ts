/**
 * @file The playground's tour (docs/PLAYGROUND.md §9.2, PLAN.md WP 13.26): one replay through every feature on the
 * block, made of the playground's own replays played in turn (`TOUR`): the street's neighbours and dog first, on the
 * street's own scene (`playground:site-street`, so the dog's story is its replay's), then the gym's run, its moves,
 * its mantles and climbs, its rides, the house's doors, lights, windows and garage, the ring's melee and the range's
 * guns. Each later segment starts with the block's dev action `place` where its own replay starts (its first `place`,
 * else its scene's spawn), a replay of the gym moved to where the gym stands on the block (`SITE_STRUCTURES.gym.at`:
 * every `place` it makes); every intent the segment before still holds is let go first. The range starts on a whole
 * number of its movers' rounds (`align`), so each slides where it did when its replay shot it.
 *
 * `buildTour(segments)` makes the replay, without goldens (`node x replay <file> --browser sim --update` records
 * them), from the segments' replays, read by the caller (labs/playground/tour.test.ts reads them from tests/replays/
 * and holds the committed tests/replays/playground-tour.replay.json to what this builds). The page plays it as
 * `?replay=playground-tour`, the attract mode behind the title screen (labs/playground/ui/frontEnd.ts).
 *
 * Invariants: pure: data in, data out; a segment's inputs are its replay's, moved and shifted, never edited, so what a
 * segment shows on its own scene it shows on the block, but for what the block adds (the dog beside the player, the
 * neighbours, the props).
 *
 * Game code, a page's or a test's: it imports only the playground's own files.
 *
 * @example
 * TOUR.map((segment) => segment.replay); // ['playground-gym', 'playground-moves', …, 'playground-range']
 * const one = { scene: 'playground:gym', settings: {}, seed: 1, hz: 60, steps: 2, inputs: [[0, { move: [0, 1] }]] };
 * buildTour({ 'playground-gym': one }, [TOUR[0]]).inputs[0][1].args; // { at: [20.25, 0, 15.25], yaw: 0, speed: 0 }
 * @see labs/playground/tour.test.ts
 */
import { SITE_AREAS, SITE_STRUCTURES } from './levels/site';
import { GYM_START } from './scenes/gym';
import { areaStart } from './scenes/site';
import { MOVER } from './weapons/range';

/** A replay as the tour reads and writes it (engine/sim/replay.ts's format, goldens aside). */
export interface TourReplay {
  format?: string;
  description?: string;
  scene: string;
  settings: Record<string, unknown>;
  seed: number;
  hz: number;
  steps: number;
  inputs: [number, Record<string, unknown>][];
}

/** A segment: the replay it plays, and where its player starts when the replay does not `place` him at step 0. */
export interface TourSegment {
  readonly replay: string;
  /** Whether its replay is of the gym's own scene, so its places move to where the gym stands on the block. */
  readonly gym: boolean;
  /** Where the player starts and faces when the replay does not say: its scene's spawn; none on the tour's scene. */
  readonly start?: { readonly at: readonly [number, number, number]; readonly yaw: number };
  /** Steps it starts on a whole number of (idle steps before it), for what moves on the clock from step 0. */
  readonly align?: number;
}

/** The range's movers' round, steps: there and back along the track at its speed, at 60 Hz. */
export const MOVER_ROUND = Math.round(((2 * Math.hypot(...MOVER.track)) / MOVER.speed) * 60);

/** Where the gym stands on the block: its scene's coordinates plus this. */
const GYM_AT = SITE_STRUCTURES.gym.at;

/** The gym's spawn on the block. */
const GYM_SPAWN_ON_SITE = [GYM_START[0] + GYM_AT[0], GYM_START[1] + GYM_AT[1], GYM_START[2] + GYM_AT[2]] as const;

/** The tour's segments, in order: the street's on its own scene, the gym's, empty-handed, then the block's, the guns last. */
export const TOUR: readonly TourSegment[] = [
  { replay: 'playground-street', gym: false },
  { replay: 'playground-gym', gym: true, start: { at: GYM_SPAWN_ON_SITE, yaw: 0 } },
  { replay: 'playground-moves', gym: true, start: { at: GYM_SPAWN_ON_SITE, yaw: 0 } },
  { replay: 'playground-climb', gym: true, start: { at: GYM_SPAWN_ON_SITE, yaw: 0 } },
  { replay: 'playground-rides', gym: true, start: { at: GYM_SPAWN_ON_SITE, yaw: 0 } },
  { replay: 'playground-site', gym: false, start: { at: areaStart('house'), yaw: SITE_AREAS.house.yaw } },
  { replay: 'playground-melee', gym: false, start: { at: areaStart('ring'), yaw: SITE_AREAS.ring.yaw } },
  { replay: 'playground-range', gym: false, start: { at: areaStart('range'), yaw: SITE_AREAS.range.yaw }, align: MOVER_ROUND }, // prettier-ignore
];

/** `change`'s `place` moved by the gym's place on the block. */
function moved(change: Record<string, unknown>): Record<string, unknown> {
  if (change.dev !== 'place') return change;
  const args = change.args as { at: [number, number, number] };
  const at = [args.at[0] + GYM_AT[0], args.at[1] + GYM_AT[1], args.at[2] + GYM_AT[2]];
  return { ...change, args: { ...args, at } };
}

/** The tour (see the file comment) from `replays`, by name, over `segments` (the whole tour by default). */
export function buildTour(
  replays: Readonly<Record<string, TourReplay>>,
  segments: readonly TourSegment[] = TOUR,
): TourReplay {
  const inputs: TourReplay['inputs'] = [];
  const held = new Set<string>(); // intent keys a segment set and has not let go
  let base = 0;
  const letGo = (keep: Record<string, unknown>) => Object.fromEntries([...held].filter((key) => !(key in keep)).map((key) => [key, null])); // prettier-ignore
  for (const segment of segments) {
    const replay = replays[segment.replay];
    if (!replay) throw new Error(`the tour has no replay ${segment.replay}: read it from tests/replays/`);
    const points = replay.inputs.map(([k, change]): [number, Record<string, unknown>] => [k, segment.gym ? moved(change) : change]); // prettier-ignore
    const first = points[0]?.[0] === 0 ? points.shift()![1] : {};
    if (segment.align && base % segment.align) {
      if (held.size) inputs.push([base, letGo({})]); // idle until the round comes round, holding nothing
      held.clear();
      base += segment.align - (base % segment.align);
    }
    const start = segment.start;
    const place = first.dev === 'place' || !start ? {} : { dev: 'place', args: { at: [...start.at], yaw: start.yaw, speed: 0 } }; // prettier-ignore
    inputs.push([base, { ...place, ...letGo(first), ...first }]);
    for (const [k, change] of points) inputs.push([base + k, change]);
    for (const [, change] of [[0, first] as const, ...points]) {
      for (const [key, value] of Object.entries(change)) {
        if (key === 'dev' || key === 'args' || key === 'p' || key === 'set') continue;
        if (value === null) held.delete(key);
        else held.add(key);
      }
    }
    base += replay.steps;
  }
  return {
    format: 'my3dge-replay/1',
    description: `The playground's tour (WP 13.26): ${segments.map((segment) => segment.replay.replace('playground-', '')).join(', ')}, played in turn on the block, each from where its own replay starts (labs/playground/tour.ts).`, // prettier-ignore
    scene: 'playground:site-street',
    settings: {},
    seed: 1,
    hz: 60,
    steps: base,
    inputs,
  };
}
