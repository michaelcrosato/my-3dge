/**
 * @file Unit tests for engine/world/level/parse.ts (T1): the front matter (defaults, quotes, YAML-style comments,
 * `\r\n` line ends), maps with and without it, the blank lines skipped, rows as code points, the map's width taken
 * from most rows, and the line and column of each problem.
 * @see engine/world/level/parse.ts
 */
import { describe, expect, it } from 'vitest';
import { parseLevel } from './parse';

describe('parseLevel', () => {
  it('reads front matter, then the map with the line its first row is on', () => {
    const text = [
      '---',
      '# a comment line',
      "description: 'A room # with a hash' # and a trailing comment",
      'tile: 0.5   # half-metre tiles',
      '---',
      '',
      '###',
      '#.#',
      '###',
      '',
      '',
    ].join('\n');
    const parsed = parseLevel(text, { file: 'room.txt' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.header).toEqual({ description: 'A room # with a hash', tile: 0.5 });
    expect(parsed.rows.map((row) => row.join(''))).toEqual(['###', '#.#', '###']);
    expect([parsed.firstLine, parsed.width, parsed.file]).toEqual([7, 3, 'room.txt']);
  });

  it('takes a map without front matter, with defaults, and \\r\\n line ends', () => {
    const parsed = parseLevel('##\r\n#.\r\n');
    expect(parsed.header).toEqual({ description: '', tile: 1 });
    expect(parsed.rows).toEqual([
      ['#', '#'],
      ['#', '.'],
    ]);
    expect([parsed.firstLine, parsed.file, parsed.problems]).toEqual([1, 'level', []]);
  });

  it('reads double-quoted values with escapes and single-quoted ones with doubled quotes', () => {
    const header = (value: string) => parseLevel(`---\ndescription: ${value}\n---\n#\n`).header.description;
    expect(header('"say \\"hi\\""')).toBe('say "hi"');
    expect(header("'it''s'")).toBe("it's");
    expect(header('plain words#not-a-comment')).toBe('plain words#not-a-comment');
  });

  it('counts columns in characters, not UTF-16 units', () => {
    const parsed = parseLevel('#😀#\n###\n');
    expect(parsed.rows[0]).toEqual(['#', '😀', '#']);
    expect(parsed.problems).toEqual([]);
  });

  it('takes the width most rows share, the first row winning a tie', () => {
    expect(parseLevel('##\n###\n###\n').width).toBe(3);
    expect(parseLevel('##\n###\n').width).toBe(2);
    const parsed = parseLevel('####\n#..#\n\n####\n');
    expect(parsed.problems.map((p) => [p.code, p.line, p.column])).toEqual([['LEVEL_RAGGED_ROW', 3, 1]]);
    expect(parsed.problems[0].message).toBe(
      '[LEVEL_RAGGED_ROW] level:3:1: the map is 4 characters wide, but this row is 0: add 4 characters to it so every row is 4 characters wide: the map is a rectangle (close its edges with walls, #)',
    );
  });

  it('names header problems at their line and column', () => {
    const parsed = parseLevel('---\n  tile: "2\n  tile: two\n---\n#\n', { file: 'x.txt' });
    expect(parsed.problems.map((p) => [p.code, p.line, p.column])).toEqual([
      ['LEVEL_BAD_HEADER', 2, 9],
      ['LEVEL_BAD_HEADER', 3, 3],
      ['LEVEL_BAD_HEADER', 3, 9],
    ]);
    expect(parsed.problems[0].message).toContain('x.txt:2:9: the value "2 has no closing "');
    expect(parsed.problems[2].message).toContain('x.txt:3:9: tile is "two"; it must be a number of metres above 0');
    expect(parseLevel('---\ntile: 1 extra "quoted"\n---\n#\n').problems[0].message).toContain('tile is "1 extra');
    expect(parseLevel('---\ndescription: "x" y\n---\n#\n').problems[0].message).toContain(
      'y follows the quoted value; put it inside the quotes',
    );
  });

  it('reports a map that is missing at the line after the front matter', () => {
    expect(parseLevel('---\ntile: 1\n---\n\n\n').problems.map((p) => [p.code, p.line, p.column])).toEqual([
      ['LEVEL_EMPTY', 4, 1],
    ]);
    expect(parseLevel('').problems.map((p) => [p.code, p.line])).toEqual([['LEVEL_EMPTY', 1]]);
  });
});
