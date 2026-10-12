/**
 * @file The `anim` QA family over the library in T1 (tools/qa/anim/clips.ts, PLAN.md §8.6, WP 8.6): every clip's data
 * checks, and the play checks of a sample with every set in it (each set's every 20th clip, and each clip the baseline
 * accepts a played metric for), pass against tests/baselines/qa-anim-library.json with no slack. The full sweep plays
 * every clip on every build in about 40 s, past the WP's 30 s for its Node tests, so it is a gate's long run (`node x
 * qa anim --only clip:,set:`, tools/lib/tiers.ts `LONG_RUNS`). Each data metric catches a seeded fault, and the family
 * reaches the clips through `node x qa anim`'s own path (`runQa`).
 *
 * @see tools/qa/anim/clips.ts
 */
import { describe, expect, it } from 'vitest';
import { loadClipLibrary } from '../../../../engine/anim/clip/library';
import type { ClipKey } from '../../../../engine/anim/clip/readable';
import type { ClipSet } from '../../../../engine/anim/clip/validate';
import { compareWithBaselines, readBaselines, runQa, type QaViolation } from '../../../../tools/cmd/qa';
import {
  CLIP_DATA_METRICS,
  CLIP_PLAY_METRICS,
  clipBuilds,
  clipDataFindings,
  clipPlayFindings,
  clipViolations,
  librarySets,
} from '../../../../tools/qa/anim/clips';
import { ROOT } from '../../../../tools/x';
import { REST, standing } from '../../anim/clip-fixtures';

/** One played clip in this many, from each set's first. */
const STRIDE = 20;
const LIBRARY = /^(clip|set):/;
const { entries } = readBaselines(ROOT, 'anim');
const accepted = entries.filter((entry) => LIBRARY.test(entry.id));
const sets = librarySets(ROOT);
/** The clips T1 plays: each set's every `STRIDE`th, and those the baseline accepts a played metric for. */
const SAMPLE = new Set([
  ...sets.flatMap((set) =>
    Object.keys(set.clips).flatMap((name, i) => (i % STRIDE ? [] : [`clip:${set.set}/${name}`])),
  ),
  ...accepted.filter((entry) => CLIP_PLAY_METRICS.has(entry.metric)).map((entry) => entry.id),
]);

/** A test set of one source on REST, its clips by name, its fits `[mean, worst]` by name. */
const testSet = (
  clips: Record<string, ClipKey[]>,
  fit: Record<string, [number, number]> = {},
  loop = false,
): ClipSet => ({
  set: 'TEST',
  sources: { A: { rest: REST } },
  fit,
  clips: Object.fromEntries(Object.entries(clips).map(([name, keys]) => [name, { src: 'A', dur: 1, loop, keys }])),
});
/** The data findings of `set`, as violations. */
function dataOf(set: ClipSet): Pick<QaViolation, 'id' | 'metric' | 'value'>[] {
  const found: Pick<QaViolation, 'id' | 'metric' | 'value'>[] = [];
  clipDataFindings(
    set,
    () => true,
    (id, metric, value) => value && found.push({ id, metric, value: value.value }),
  );
  return found;
}

describe('the anim QA family over the library', () => {
  it(`passes every clip's data, and ${SAMPLE.size} clips played on every build, against their baseline`, () => {
    const violations = clipViolations(
      ROOT,
      (id) => LIBRARY.test(id),
      (id) => SAMPLE.has(id),
    );
    const measured = accepted.filter((entry) => CLIP_DATA_METRICS.has(entry.metric) || SAMPLE.has(entry.id));
    const { failures, warnings } = compareWithBaselines('anim', violations, measured);
    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
    for (const entry of accepted) expect(CLIP_DATA_METRICS.has(entry.metric) || CLIP_PLAY_METRICS.has(entry.metric), entry.id).toBe(true); // prettier-ignore
  });

  it('plays a sample with every set in it, on HUMANOIDS’ four builds and the mannequin', () => {
    const sampled = new Set([...SAMPLE].map((id) => id.slice('clip:'.length, id.indexOf('/'))));
    expect([...sampled].sort()).toEqual(sets.map((set) => set.set).sort());
    expect(SAMPLE.size).toBeGreaterThan(60);
    expect(clipBuilds(sets)).toEqual(['build:heroic', 'build:chibi', 'build:bulky', 'build:skeleton', 'build:mannequin']); // prettier-ignore
  });

  it('is what `node x qa anim` runs: a clip through the family, against the same baseline', async () => {
    const result = await runQa(ROOT, 'anim', ['clip:QUATERNIUS/Swim_Idle_Loop']);
    expect(result).toMatchObject({ failures: [], warnings: [], violations: 1, accepted: 1 });
  });

  it('plays an elbow folded past 130° bending forward on every build (the baker’s fold, WP 8.6)', () => {
    const library = loadClipLibrary(sets.find((set) => set.set === 'CMU')!);
    const found: string[] = [];
    clipPlayFindings(library, 'Stretch_Yawn', clipBuilds(sets), (_, metric, value) => value && found.push(`${metric}: ${value.message}`)); // prettier-ignore
    expect(found).toEqual([]);
  });
});

describe('the data metrics catch a seeded fault', () => {
  it('a clip’s fit past 40 mm on average or 300 at worst, and a set’s past 20 mm on average', () => {
    const fit: Record<string, [number, number]> = { Good: [12, 80], Loose: [41, 120], Wild: [21, 301] };
    const set = testSet({ Good: [standing(0)], Loose: [standing(0)], Wild: [standing(0)] }, fit);
    expect(dataOf(set)).toEqual([
      { id: 'set:TEST', metric: 'fitMean', value: (12 + 41 + 21) / 3 },
      { id: 'clip:TEST/Loose', metric: 'fitMean', value: 41 },
      { id: 'clip:TEST/Wild', metric: 'fitWorst', value: 301 },
    ]);
  });

  it('the validator’s warnings, each valued by its worst key', () => {
    const sunk = { ...standing(0), hips: [0, 0, -10] as ClipKey['hips'] };
    const wound = { ...standing(1), body: [600, 0, 0] as ClipKey['body'] };
    const popped = [
      { ...standing(0), armL: [0, 0, -100, 150, 0] as ClipKey['armL'] },
      { ...standing(1), armL: [0, 0, -100, 150, 130] as ClipKey['armL'] },
    ];
    const flipped = [standing(0), { ...standing(1), legL: [0, 0, 100, 0, 0] as ClipKey['legL'] }];
    const kneeled = [{ ...standing(0), legR: [0, 0, -100, 170, 0] as ClipKey['legR'] }];
    const found = dataOf(testSet({ Sunk: [sunk], Wound: [wound], Popped: popped, Flipped: flipped, Kneeled: kneeled }));
    const value = (id: string, metric: string) => found.find((f) => f.id === `clip:TEST/${id}` && f.metric === metric)?.value; // prettier-ignore
    expect(value('Sunk', 'belowFloor')).toBeCloseTo((0.1 * REST.H0) / 1000, 9);
    expect(value('Wound', 'angleRange')).toBeCloseTo((600 * Math.PI) / 180, 9);
    expect(value('Popped', 'twistPop')).toBeCloseTo((130 * Math.PI) / 180, 9);
    expect(value('Flipped', 'limbCollapse')).toBeCloseTo((180 * Math.PI) / 180, 6);
    expect(value('Kneeled', 'kneeRange')).toBeCloseTo((5 * Math.PI) / 180, 9);
  });

  it('a loop whose last key is not its first: the jump at its seam', () => {
    const closed = testSet({ Walk: [standing(0), { ...standing(0.5), hips: [0, 0, 90] }, standing(1)] }, {}, true);
    expect(dataOf(closed)).toEqual([]);
    const open = testSet({ Walk: [standing(0), { ...standing(1), hips: [0, 0, 90] }] }, {}, true);
    expect(dataOf(open)).toEqual([{ id: 'clip:TEST/Walk', metric: 'loopClosure', value: expect.closeTo((0.1 * REST.H0) / 1000, 3) }]); // prettier-ignore
  });
});
