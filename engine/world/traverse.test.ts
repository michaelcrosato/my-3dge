/**
 * @file Unit tests for traversal as world data (engine/world/traverse.ts): the specs parse with their defaults and
 * refuse what cannot be ridden (anchors closer than 2 m, a balloon's line off vertical, a ladder's normal not a unit
 * or its top below its foot, a launcher of no size), each problem named; a launcher's volume stands on its top; a
 * level's ladder glyphs stand one ladder on each run of tiles along a face, against the neighbour standing highest,
 * up to its top, a tenth of a metre off the face, and none where no neighbour rises.
 * @see engine/world/traverse.ts
 */
import { describe, expect, it } from 'vitest';
import { compileLevel } from './level/compile';
import { LADDER_DEPTH, launcherVolume, levelLadders, parseTraverse, traverseProblems } from './traverse';

/** A level of `rows` (a map), its tiles 0.5 m. */
const level = (...rows: string[]) =>
  compileLevel(`---\ndescription: Ladders.\ntile: 0.5\n---\n${rows.join('\n')}\n`, { file: 'ladders.txt' });

describe('traversal specs', () => {
  it('parse with their defaults', () => {
    const zipline = parseTraverse('zipline', { from: [0, 8, 0], to: [0, 2, 40] }, 'test');
    expect([zipline.balloon, zipline.poles]).toEqual([false, true]);
    const ladder = parseTraverse('ladder', { foot: [1, 0, 2], top: 3, normal: [0, -1] }, 'test');
    expect(ladder.width).toBe(0.6);
    const pad = parseTraverse('launcher', { at: [0, 0, 0], velocity: [0, 10, 0] }, 'test');
    expect([pad.size, pad.reach, pad.bounce, pad.keep, pad.mesh, pad.solid]).toEqual([[1.5, 1.5], 0.3, 0, true, 'pad', false]); // prettier-ignore
  });

  it('refuse what cannot be ridden, naming each problem', () => {
    expect(traverseProblems('zipline', { from: [0, 2, 0], to: [0, 2, 1] })).toEqual(['its anchors stand 1 m apart: at least 2 m']); // prettier-ignore
    expect(traverseProblems('zipline', { from: [0, 0, 0], to: [10, 5, 0], balloon: true })).toEqual(['a balloon’s line is vertical: put one anchor above the other']); // prettier-ignore
    expect(traverseProblems('ladder', { foot: [0, 0, 0], top: 0.2, normal: [0, 2] })).toEqual([
      'normal is a unit [x, z]: out of the wall',
      'its top 0.2 m stands less than 0.5 m over its foot at 0 m',
    ]);
    expect(traverseProblems('launcher', { at: [0, 0, 0], velocity: [0, 1, 0], size: [0, 1] })).toEqual(['size is [x, z], each above 0']); // prettier-ignore
    expect(() => parseTraverse('zipline', { from: [0, 2, 0], to: [0, 2, 1] }, 'addZipline(spec)')).toThrow(/CORE_BAD_SPEC.*addZipline\(spec\).*at least 2 m/); // prettier-ignore
    expect(() => parseTraverse('zipline', { from: [0, 2, 0] }, 'addZipline(spec)')).toThrow(/CORE_BAD_SPEC/);
  });

  it('stand a launcher’s volume on its top, reaching `reach` above it', () => {
    const pad = parseTraverse('launcher', { at: [2, 0.5, 3], size: [2, 1], reach: 0.6, velocity: [0, 9, 0] }, 'test');
    expect(launcherVolume(pad)).toEqual([
      [1, 0.45, 2.5],
      [3, 1.1, 3.5],
    ]);
  });
});

describe('levelLadders', () => {
  it('stands one ladder on each run of ladder tiles along a face, up to the neighbour standing highest', () => {
    const map = level('########', '#@.....#', '#.||...#', '#.ww...#', '#.....|#', '########');
    const [north, east] = levelLadders(map);
    // the run of two over the low walls (0.75 m, the highest neighbour: the floor's 0 elsewhere) and the 3 m wall's lone tile
    expect(north).toEqual({ foot: [1.5, 0, 1.5 - LADDER_DEPTH], top: 0.75, normal: [0, -1], width: 1 });
    expect(east).toEqual({ foot: [3.5 - LADDER_DEPTH, 0, 2.25], top: 3, normal: [-1, 0], width: 0.5 });
    expect(levelLadders(map)).toHaveLength(2);
  });

  it('stands none where no neighbour rises half a metre over its floor', () => {
    expect(levelLadders(level('#####', '#@|.#', '#...#', '#####'))).toEqual([
      { foot: [1.25, 0, 0.5 + LADDER_DEPTH], top: 3, normal: [0, 1], width: 0.5 }, // the north wall
    ]);
    expect(levelLadders(level('#######', '#@....#', '#..|..#', '#.....#', '#######'))).toEqual([]);
  });
});
