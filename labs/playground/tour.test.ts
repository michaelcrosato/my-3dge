/**
 * @file Unit tests for labs/playground/tour.ts (WP 13.26): the committed tests/replays/playground-tour.replay.json is
 * what `buildTour` makes of the playground's replays, so a segment re-recorded makes the tour stale until it is built
 * again; and its run, played as `playReplay` plays it, passes through every feature its segments show (`FEATURES`:
 * the moves, the rides, the house's doors, switches, windows and the chair, the dog's game and the neighbours,
 * melee, the guns and the range's targets), its goldens holding (`x replay` checks them in the page too).
 * @see labs/playground/tour.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIntents, NO_INTENTS, type IntentChanges } from '../../engine/input/intents';
import { createSession } from '../../engine/sim/session';
import { areaStart } from './scenes/site';
import { buildTour, MOVER_ROUND, TOUR, type TourReplay } from './tour';

/** A committed replay, by name. */
const read = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../tests/replays', `${name}.replay.json`), 'utf8')) as TourReplay & { hashes: Record<string, Record<string, string>> }; // prettier-ignore

/** What the tour must show, as `<event>` or `<event>:<what>`: each segment's features on its own scene. */
const FEATURES = [
  'jump',
  'land',
  'move:slide',
  'move:crouch',
  'move:mantle',
  'move:climb',
  'move:ladder',
  'move:zipline',
  'launch',
  'move:skydive', // prettier-ignore
  'door:',
  'use',
  'switch',
  'glass',
  'splinters',
  'pickup',
  'throw',
  'melee',
  'strike', // prettier-ignore
  'dog:sit',
  'dog:follow',
  'dog:chase',
  'dog:fetch',
  'dog:drop',
  'neighbour:look',
  'neighbour:sit',
  'neighbour:rise', // prettier-ignore
  'draw',
  'gunshot',
  'reload',
  'holster',
  'thingHit',
  'thingDown',
  'thingUp', // prettier-ignore
];

describe('the playground’s tour', () => {
  it('is what buildTour makes of the playground’s replays, the range on a whole round of its movers', () => {
    const tour = read('playground-tour');
    const built = buildTour(Object.fromEntries(TOUR.map((segment) => [segment.replay, read(segment.replay)])));
    expect({ scene: tour.scene, settings: tour.settings, seed: tour.seed, hz: tour.hz, steps: tour.steps, inputs: tour.inputs }, 'rebuild tests/replays/playground-tour.replay.json from buildTour, then record its goldens (x replay --update)').toEqual({ scene: built.scene, settings: built.settings, seed: built.seed, hz: built.hz, steps: built.steps, inputs: built.inputs }); // prettier-ignore
    const range = built.inputs.find(([, change]) => change.dev === 'place' && (change.args as { at: number[] }).at[0] === areaStart('range')[0])!; // prettier-ignore
    expect(range[0] % MOVER_ROUND).toBe(0);
  });

  it('passes through every feature its segments show, and keeps its goldens', () => {
    const tour = read('playground-tour');
    const session = createSession(tour.scene, { seed: tour.seed, settings: tour.settings });
    const shown = new Set<string>();
    const hashes: Record<string, string> = {};
    const goldens = tour.hashes['linux-x64'];
    let [at, intents, seen] = [0, NO_INTENTS, 0];
    for (let k = 0; k <= tour.steps; k++) {
      if (goldens[k]) hashes[k] = session.world.hash();
      if (k === tour.steps) break;
      let change: IntentChanges = {};
      for (; at < tour.inputs.length && tour.inputs[at][0] === k; at++) {
        const { set, dev, args, ...keys } = tour.inputs[at][1] as { set?: Record<string, unknown>; dev?: string; args?: unknown }; // prettier-ignore
        for (const [path, value] of Object.entries(set ?? {})) session.set(path, value);
        if (dev !== undefined) session.act(dev, args);
        change = { ...change, ...(keys as IntentChanges) };
      }
      intents = applyIntents(intents, change);
      session.step(intents);
      for (const record of session.world.events.trace()) {
        if (record.seq <= seen) continue; // the trace keeps the latest 256: read it every step
        seen = record.seq;
        const what = (record.payload as { what?: string } | undefined)?.what;
        shown.add(['move', 'dog', 'neighbour', 'door'].includes(record.type) ? `${record.type}:${what ?? ''}` : record.type); // prettier-ignore
      }
    }
    expect(
      FEATURES.filter((feature) => !shown.has(feature)),
      'features the tour never shows',
    ).toEqual([]);
    expect(hashes).toEqual(goldens);
  }, 600_000);
});
