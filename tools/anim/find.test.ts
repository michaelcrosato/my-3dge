/**
 * @file Tests searching the library (tools/anim/find.ts, WP 8.5) on the committed sets and ledger: `find punch` fits
 * in 20 lines with the verdict and the report path (Done when), names first, re-exports after their originals, a tag
 * filter, and CMU takes not yet in a set after the clips.
 */
import { describe, expect, it } from 'vitest';
import { catalogRows, findClips } from './find';

describe('x anim find', () => {
  it('prints the punches in 18 lines, so 20 with the verdict and the report path', () => {
    const found = findClips(['punch']);
    expect(found.lines.length).toBeLessThanOrEqual(18);
    expect(found.summary).toMatch(/^\d+ clips and \d+ CMU takes match/);
    expect(found.clips.length).toBeGreaterThan(10);
    expect(found.lines[0]).toMatch(/Punch/);
    expect(found.lines.some((line) => line.startsWith('cmu '))).toBe(true);
  });

  it('ranks a clip named for the words above one that only says them, and re-exports last', () => {
    const { clips } = findClips(['roll']);
    const named = clips.findIndex((hit) => /roll/i.test(hit.row.name));
    const said = clips.findIndex((hit) => !/roll/i.test(hit.row.name));
    if (said >= 0) expect(named).toBeLessThan(said);
    const alt = clips.findIndex((hit) => hit.row.tags.split(' ').includes('alt'));
    if (alt >= 0) expect(clips.slice(alt).every((hit) => hit.row.tags.split(' ').includes('alt'))).toBe(true);
  });

  it('keeps clips with a tag, and takes in that category', () => {
    const { clips, takes } = findClips([], { cat: 'sword' });
    expect(clips.length).toBeGreaterThan(5);
    for (const hit of clips) expect(hit.row.tags.split(' ')).toContain('sword');
    expect(takes).toEqual([]);
    expect(findClips([], { cat: 'acrobatics' }).takes.every((t) => t.category === 'acrobatics')).toBe(true);
  });

  it('reads every set’s catalog', () => {
    expect(new Set(catalogRows().map((r) => r.set)).size).toBe(10);
    expect(catalogRows()).toHaveLength(1218);
  });
});
