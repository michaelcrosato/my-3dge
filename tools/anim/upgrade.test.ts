/**
 * @file Tests for the re-import's swap and its sources (tools/anim/upgrade.ts, tools/anim/fetch.ts; WP 8.8): a clip is
 * swapped in when the two decodes lie within the fits' sum and the new one fits no worse; it is kept, with its reason,
 * when it fits worse or decodes as another motion; the set keeps its order and its kept clips and becomes format 2; a
 * re-import that measured a rest body differently is refused; a fetched file whose sha256 differs is refused, and
 * sets without sources say why.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { busy, clipOf, REST, standing } from '../../tests/unit/anim/clip-fixtures';
import type { Clip } from '../../engine/anim/clip/readable';
import type { ClipSet } from '../../engine/anim/clip/validate';
import { fetchMesh2Motion, MESH2MOTION, SET_SOURCES } from './fetch';
import { apartOf, judge, upgradedOf, upgradeSet } from './upgrade';

/** A set of `clips` on REST, each with its fit. */
function setOf(clips: Record<string, [Clip, [number, number]]>): ClipSet {
  return {
    set: 'TEST',
    format: 1,
    sources: { S: { rest: REST } },
    fit: Object.fromEntries(Object.entries(clips).map(([name, [, fit]]) => [name, fit])),
    clips: Object.fromEntries(Object.entries(clips).map(([name, [clip]]) => [name, { ...clip, src: 'S' }])),
  };
}
const walk = clipOf([standing(0), standing(1)], { dur: 1 });
const lean = clipOf([standing(0), { ...standing(1), body: [0, 1, 0] }], { dur: 1 });
const punch = clipOf([standing(0), busy(1)], { dur: 1 });

describe('judge', () => {
  it('swaps a clip in within the fits’ sum that fits no worse, and keeps one that fits worse or moves otherwise', () => {
    const held = setOf({ A: [walk, [5, 20]], B: [walk, [5, 20]], C: [walk, [5, 20]] });
    const fresh = setOf({ A: [{ ...lean, via: 'source' }, [3, 15]], B: [lean, [6, 15]], C: [punch, [3, 15]] });
    const apart = apartOf(walk, REST, lean, REST);
    expect(apart[1]).toBeGreaterThan(0);
    expect(apart[1]).toBeLessThan(35);
    expect(judge('A', held, fresh)).toMatchObject({ swapped: true, why: 'parity', was: [5, 20], now: [3, 15] });
    expect(judge('B', held, fresh)).toMatchObject({ swapped: false, why: expect.stringMatching(/fits its capture worse/) }); // prettier-ignore
    expect(judge('C', held, fresh)).toMatchObject({ swapped: false, why: expect.stringMatching(/another motion/) });
    expect(judge('A', held, setOf({}))).toMatchObject({ swapped: false, why: expect.stringMatching(/no clip/) });
  });
});

describe('upgradeSet', () => {
  it('keeps the order and the kept clips, takes the swapped ones and their fits, and becomes format 2', () => {
    const held = setOf({ B: [walk, [5, 20]], A: [walk, [5, 20]] });
    const fresh = setOf({ A: [{ ...lean, via: 'source' }, [3, 15]], B: [lean, [6, 15]] });
    const { set, verdicts } = upgradeSet(held, fresh);
    expect(Object.keys(set.clips)).toEqual(['B', 'A']);
    expect([set.format, set.clips.A.via, set.clips.B]).toEqual([2, 'source', held.clips.B]);
    expect(set.fit).toEqual({ B: [5, 20], A: [3, 15] });
    expect(upgradedOf(verdicts)).toEqual({
      swapped: 1,
      of: 2,
      kept: { B: expect.stringMatching(/fits its capture worse in format 2: 5\/20 → 6\/15/) },
    });
  });

  it('refuses a re-import that measured a source’s rest body differently', () => {
    const fresh = { ...setOf({ A: [walk, [5, 20]] }), sources: { S: { rest: { ...REST, H0: 900 } } } };
    expect(() => upgradeSet(setOf({ A: [walk, [5, 20]] }), fresh)).toThrow(/rest body differently/);
  });
});

describe('the sources', () => {
  it('fetches a file once and refuses one whose sha256 differs, naming the fix', () => {
    const root = mkdtempSync(join(tmpdir(), 'm2m-'));
    expect(() => fetchMesh2Motion(root, 'cache', () => new Uint8Array([1, 2, 3]))).toThrow(/sha256 .* check the commit/); // prettier-ignore
    expect(MESH2MOTION.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(MESH2MOTION.files)).toHaveLength(3);
    expect(() => readFileSync(join(root, 'cache', 'human-base-animations.glb'))).toThrow();
  });

  it('says which sets can be re-imported, and why the others cannot', () => {
    expect(Object.entries(SET_SOURCES).filter(([, s]) => s.status === 'available').map(([set]) => set)).toEqual(['mesh2motion', 'cmu']); // prettier-ignore
    expect(SET_SOURCES.quaternius).toEqual({ status: 'blocked', why: expect.stringMatching(/ESC-0003/) });
    expect(SET_SOURCES.style100_run.status).toBe('out');
  });
});
