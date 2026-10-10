/**
 * @file The `level` QA family in T1 (tools/qa/level.ts, PLAN.md §8.6): the repository's level files pass against
 * tests/baselines/qa-level.json, and on a temporary repository a broken level gives one violation per problem code,
 * valued by its count, at its file and line, the box's levels and the fixtures' told apart by id, `broken/` skipped,
 * `--only` honoured, and a baseline entry accepting a known problem.
 * @see tools/qa/level.ts
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runQa } from '../cmd/qa';
import { ROOT } from '../x';
import family, { levelFiles } from './level';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository holding `files`. */
function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-level-')));
  temporary.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('the level QA family', () => {
  it("passes the repository's levels against their baseline", async () => {
    const result = await runQa(ROOT, 'level');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(levelFiles(ROOT).map((level) => level.id)).toEqual(
      expect.arrayContaining(['level:fixtures/hall-v1', 'level:fixtures/heights', 'level:fixtures/room']),
    );
  });

  it('reports each problem code of each level once, valued by its count, at its file and line', async () => {
    const root = repository({
      'labs/box/levels/room.txt': '#####\n#X.Y#\n#.X#\n#####\n',
      'labs/box/levels/cell.txt': '#######\n#@#...#\n#######\n',
      'fixtures/levels/room.txt': '###\n#.#\n###\n',
      'fixtures/levels/broken/seeded.txt': '#Q#\n',
      'fixtures/levels/notes.md': 'not a level',
    });
    const violations = await family.run({ root, only: [] });
    expect(violations.map((v) => [v.id, v.metric, v.value, v.file, v.line])).toEqual([
      ['level:cell', 'unreachableSpawn', 1, 'labs/box/levels/cell.txt', 2],
      ['level:room', 'raggedRow', 1, 'labs/box/levels/room.txt', 3],
      ['level:room', 'unknownGlyph', 2, 'labs/box/levels/room.txt', 2],
    ]);
    expect(violations[2].message).toMatch(
      /^\[LEVEL_UNKNOWN_GLYPH\] labs\/box\/levels\/room\.txt:2:2: "X" is not.* \(and 1 more of LEVEL_UNKNOWN_GLYPH\)$/,
    );
    expect((await family.run({ root, only: ['level:fixtures/'] })).length).toBe(0);
    expect((await family.run({ root, only: ['level:cell'] })).map((v) => v.id)).toEqual(['level:cell']);
  });

  it('fails new problems and passes ones the baseline accepts with a reason', async () => {
    const root = repository({ 'labs/box/levels/cell.txt': '#######\n#@#...#\n#######\n' });
    const failing = await runQa(root, 'level', [], async () => family);
    expect(failing.failures.map((f) => [f.id, f.file, f.line])).toEqual([['QA_LEVEL', 'labs/box/levels/cell.txt', 2]]);
    mkdirSync(join(root, 'tests', 'baselines'), { recursive: true });
    const accepted = [
      { id: 'level:cell', metric: 'unreachableSpawn', value: 1, reason: 'a test: the hero starts caged' },
    ];
    writeFileSync(join(root, 'tests', 'baselines', 'qa-level.json'), JSON.stringify(accepted));
    const passing = await runQa(root, 'level', [], async () => family);
    expect([passing.failures, passing.accepted]).toEqual([[], 1]);
  });
});
