/**
 * @file Unit tests for labs/playground/ui/runs.ts (WP 13.38): Tools' recorded runs stand for every replay of the
 * playground but the tour (the start menu's Watch the tour), each by a plain name and one line, no file name or path
 * shown; every run plays on the block (a replay the engine checks, on a scene whose site is the block): the block's
 * own as recorded, the gym's moved onto the gym on the block as the tour moves its segment; and the gym's rides, played
 * that way, ride the ladder, the zipline, the jump pad and the balloon where they stand on the block.
 * @see labs/playground/ui/runs.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIntents, NO_INTENTS, type IntentChanges } from '../../../engine/input/intents';
import { checkReplay } from '../../../engine/sim/replay';
import { createSession } from '../../../engine/sim/session';
import { SITE_SCENES } from '../scenes/site';
import { buildTour, TOUR, type TourReplay } from '../tour';
import { TOUR_REPLAY } from './attract';
import { RECORDED_RUNS, runReplays } from './runs';

/** The committed replays of the playground, by name, as the page loads them (text, on demand). */
const DIR = join(import.meta.dirname, '../../../tests/replays');
const FILES = readdirSync(DIR).filter((file) => /^playground-.*\.replay\.json$/.test(file));
const LOADERS = Object.fromEntries(FILES.map((file) => [file.replace(/\.replay\.json$/, ''), async () => readFileSync(join(DIR, file), 'utf8')])); // prettier-ignore

/** The block's scenes, by id. */
const BLOCK = new Set(Object.values(SITE_SCENES).filter((scene) => scene.site === 'site:block').map((scene) => scene.id)); // prettier-ignore

describe('the recorded runs Tools lists', () => {
  it('stands for every replay of the playground but the tour, each by a plain name and a line, no file shown', () => {
    expect(RECORDED_RUNS.map((run) => run.replay).sort()).toEqual(Object.keys(LOADERS).filter((name) => name !== TOUR_REPLAY).sort()); // prettier-ignore
    expect(new Set(RECORDED_RUNS.map((run) => run.id)).size).toBe(RECORDED_RUNS.length);
    for (const { id, label, about } of RECORDED_RUNS) {
      expect(label, id).toMatch(/^[A-Z][^/.]*$/); // a name a player reads
      expect(about, id).toMatch(/^[A-Z].*\.$/);
      expect(`${label} ${about}`, id).not.toMatch(/tests\/|\.json|playground-|replay/);
    }
  });

  it('plays every run on the block: the block’s as recorded, the gym’s moved there as the tour moves it', async () => {
    const menu = runReplays(LOADERS);
    expect(Object.keys(menu).sort()).toEqual(RECORDED_RUNS.map((run) => run.id).sort());
    for (const run of RECORDED_RUNS) {
      const text = await menu[run.id]();
      const replay = checkReplay(JSON.parse(text), run.id);
      expect(BLOCK.has(replay.scene), `${run.id} plays on ${replay.scene}`).toBe(true);
      const own = JSON.parse(await LOADERS[run.replay]()) as TourReplay;
      if (BLOCK.has(own.scene)) expect(text, run.id).toBe(await LOADERS[run.replay]());
      else {
        const moved = buildTour(
          { [run.replay]: own },
          TOUR.filter((segment) => segment.replay === run.replay),
        );
        expect({ ...replay, description: '' }, run.id).toEqual({ ...moved, description: '', hashes: {} });
      }
    }
  });

  it('rides the gym’s ladder, zipline, jump pad and balloon on the block', async () => {
    const replay = JSON.parse(await runReplays(LOADERS)[RECORDED_RUNS.find((run) => run.replay === 'playground-rides')!.id]()) as TourReplay; // prettier-ignore
    const session = createSession(replay.scene, { seed: replay.seed, settings: replay.settings });
    const shown = new Set<string>();
    let [at, intents, seen] = [0, NO_INTENTS, 0];
    for (let k = 0; k < replay.steps; k++) {
      let change: IntentChanges = {};
      for (; at < replay.inputs.length && replay.inputs[at][0] === k; at++) {
        const { dev, args, ...keys } = replay.inputs[at][1] as { dev?: string; args?: unknown };
        if (dev !== undefined) session.act(dev, args);
        change = { ...change, ...(keys as IntentChanges) };
      }
      intents = applyIntents(intents, change);
      session.step(intents);
      for (const record of session.world.events.trace()) {
        if (record.seq <= seen) continue; // the trace keeps the latest 256: read it every step
        seen = record.seq;
        shown.add(record.type === 'move' ? `move:${(record.payload as { what?: string }).what}` : record.type);
      }
    }
    expect(['move:ladder', 'move:zipline', 'launch', 'move:skydive'].filter((what) => !shown.has(what))).toEqual([]);
  }, 300_000);
});
