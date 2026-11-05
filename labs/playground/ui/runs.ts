/**
 * @file The recorded runs Tools lists (labs/playground/ui/frontEnd.ts's `replays` screen, docs/PLAYGROUND.md §8.3):
 * `RECORDED_RUNS`, each by a plain name and one line on what it shows, in the tour's order, every one played on the
 * block. The block's own replays (the street, the house, the ring, the range) play as recorded. The gym's four (its
 * course, the moves, the mantles and climbs, the rides) were recorded on the gym's own scene, a walled map apart from
 * the block, so the list plays each moved onto the gym on the block as the tour moves its segment
 * (labs/playground/tour.ts `buildTour`, that segment alone, on `playground:site-street`, the player placed at the gym
 * on step 0), under a name of its own (`block-gym`); the committed replays and their goldens stay as they are. The
 * tour itself is the start menu's Watch the tour, so the list leaves it out.
 *
 * `runReplays(replays)` gives the page the list's runs by id, from its replays by name (each text, loaded when asked
 * for); main.ts offers them to `?replay=<id>` beside the committed ones. A moved run has no goldens (`hashes: {}`):
 * the page plays it and never checks it, as it plays the tour.
 *
 * Invariants: presentation only; a moved run's inputs are its replay's, as the tour moves them, never edited;
 * labs/playground/ui/runs.test.ts holds the list to tests/replays/playground-*.replay.json (every one but the tour) and
 * every run to a scene of the block.
 *
 * Game code, a page's: it imports only the playground's own files.
 *
 * @example
 * RECORDED_RUNS.map((run) => run.label); // ['The street', 'The gym’s course', 'Moves', …, 'The range']
 * // main.ts: createEngine({ replays: { ...replays, ...runReplays(replays) }, … }); `?replay=block-rides` plays one
 * @see labs/playground/ui/runs.test.ts
 */
import { buildTour, TOUR, type TourReplay } from '../tour';

/** One run of the list: its id (`?replay=<id>`), the committed replay it plays, its name and what it shows. */
export interface RecordedRun {
  readonly id: string;
  readonly replay: string;
  readonly label: string;
  readonly about: string;
}

/** The runs, in the tour's order: the gym's four under ids of their own, played on the block (see the file comment). */
export const RECORDED_RUNS: readonly RecordedRun[] = [
  { id: 'playground-street', replay: 'playground-street', label: 'The street', about: 'The dog fetches its ball along the sidewalk, and a neighbour walks by.' }, // prettier-ignore
  { id: 'block-gym', replay: 'playground-gym', label: 'The gym’s course', about: 'A lap of the gym: over the mantle wall, between the fences and round the climb walls.' }, // prettier-ignore
  { id: 'block-moves', replay: 'playground-moves', label: 'Moves', about: 'Sprints, hops, a walk and a crouch-walk, air-strafes and a bunny hop, then a slide and a slide-jump.' }, // prettier-ignore
  { id: 'block-climb', replay: 'playground-climb', label: 'Mantles and climbs', about: 'A superglide off the 1.5 m wall, the tall walls climbed, and a hang from the 3 m wall’s lip.' }, // prettier-ignore
  { id: 'block-rides', replay: 'playground-rides', label: 'Ladder, zipline, pad and balloon', about: 'Up the tower’s ladder, down the zipline, off the jump pad, then up the balloon’s line and a skydive.' }, // prettier-ignore
  { id: 'playground-site', replay: 'playground-site', label: 'The house', about: 'The front door, the hall’s light, a door kicked in, a chair through a window and the garage door.' }, // prettier-ignore
  { id: 'playground-melee', replay: 'playground-melee', label: 'The ring', about: 'The shed’s door kicked in, then the dummies punched, kicked from a jump and uppercut from a slide.' }, // prettier-ignore
  { id: 'playground-range', replay: 'playground-range', label: 'The range', about: 'The pistol down the sights and from the hip, then the rifle’s bursts at the pop-ups and the movers.' }, // prettier-ignore
];

/** A replay's text, loaded when asked for. */
type Load = () => Promise<string>;

/** The list's runs by id, from the page's `replays` by name (see the file comment); a run whose replay is missing is left out. */ // prettier-ignore
export function runReplays(replays: Readonly<Record<string, Load>>): Record<string, Load> {
  const out: Record<string, Load> = {};
  for (const run of RECORDED_RUNS) {
    const load = replays[run.replay];
    const segment = TOUR.find((one) => one.replay === run.replay);
    if (!load || !segment) continue;
    out[run.id] = !segment.gym
      ? load
      : async () => {
          const own = JSON.parse(await load()) as TourReplay;
          const moved = buildTour({ [run.replay]: own }, [segment]);
          const description = `${own.description ?? run.about} Played on the block, at the gym's place there (labs/playground/ui/runs.ts).`; // prettier-ignore
          return JSON.stringify({ ...moved, description, hashes: {} });
        };
  }
  return out;
}
