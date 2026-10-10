/**
 * @file The `level` QA family (PLAN.md §8.6, WP 2.2, I-29): `node x qa level` validates every level file, the box's
 * (`labs/box/levels/*.txt`, ids `level:<name>`) and the fixtures' (`fixtures/levels/*.txt`, ids
 * `level:fixtures/<name>`; the seeded errors under `fixtures/levels/broken/` are the unit tests' business and are
 * skipped), and runs in T1 through `runQa` (tools/qa/level.test.ts).
 *
 * Metrics, one violation per level and problem code, each valued by its count (larger is worse): `badHeader`,
 * `empty`, `raggedRow`, `unknownGlyph`, `badBlock`, `unreachableSpawn`, `unreachableArea` (engine/world/level/
 * validate.ts finds them, each at its line and column), and `unstableHash`, 1 when compiling the same text twice, or
 * once under the sim's fdlibm swap, gives another hash. A violation names the first problem's line, its fix, and how
 * many more there are. Accepted exceptions go in `tests/baselines/qa-level.json`, each with its reason.
 *
 * Invariants: files are read in name order, so violations come in a fixed order; the legend is the shared
 * registry's (the v1 glyphs; a game's glyphs need their module imported first, which WP 4.2 adds for the box).
 *
 * @example
 * import { ROOT } from '../x';
 * levelFiles(ROOT).map((level) => level.id).includes('level:fixtures/room'); // true
 * @see tools/qa/level.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashValue, type Canonical } from '../../engine/core/hash';
import { withSimMath } from '../../engine/core/simMath';
import { compileLevel } from '../../engine/world/level/compile';
import type { LevelProblem } from '../../engine/world/level/problems';
import { validateLevel } from '../../engine/world/level/validate';
import type { QaFamily, QaViolation } from '../cmd/qa';

/** Where level files live, and the id prefix of each place's levels. */
export const LEVEL_DIRS = [
  { dir: 'labs/box/levels', prefix: 'level:' },
  { dir: 'fixtures/levels', prefix: 'level:fixtures/' },
] as const;

/** One level file: its QA id and its path from the repository root. */
export interface LevelFile {
  id: string;
  file: string;
}

/** Every level file under `root`, in `LEVEL_DIRS` order, then by name. */
export function levelFiles(root: string): LevelFile[] {
  return LEVEL_DIRS.flatMap(({ dir, prefix }) => {
    const path = join(root, dir);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((name) => name.endsWith('.txt'))
      .sort()
      .map((name) => ({ id: `${prefix}${name.slice(0, -4)}`, file: `${dir}/${name}` }));
  });
}

/** `LEVEL_UNKNOWN_GLYPH` → `unknownGlyph`. */
const metricOf = (code: string) =>
  code
    .replace(/^LEVEL_/, '')
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** One violation per problem code of a level, valued by the count, naming the first problem. */
function violationsOf(level: LevelFile, problems: readonly LevelProblem[]): QaViolation[] {
  const byCode = new Map<string, LevelProblem[]>();
  for (const problem of problems) byCode.set(problem.code, [...(byCode.get(problem.code) ?? []), problem]);
  return [...byCode].map(([code, list]) => ({
    id: level.id,
    metric: metricOf(code),
    value: list.length,
    message: list[0].message + (list.length > 1 ? ` (and ${list.length - 1} more of ${code})` : ''),
    file: level.file,
    line: list[0].line,
  }));
}

/** Whether compiling `text` twice, once under the fdlibm swap, gives one hash. */
function stableHash(text: string, file: string): boolean {
  const hash = () => hashValue(compileLevel(text, { file }) as unknown as Canonical);
  const first = hash();
  return hash() === first && withSimMath(hash) === first;
}

/** The family: every level file's problems, and whether it compiles reproducibly. */
const family: QaFamily = {
  run({ root, only }) {
    const violations: QaViolation[] = [];
    for (const level of levelFiles(root)) {
      if (only.length && !only.some((prefix) => level.id.startsWith(prefix))) continue;
      const text = readFileSync(join(root, level.file), 'utf8');
      const problems = validateLevel(text, { file: level.file });
      violations.push(...violationsOf(level, problems));
      const structural = problems.some((problem) => !problem.code.startsWith('LEVEL_UNREACHABLE_'));
      if (!structural && !stableHash(text, level.file)) {
        const message = `compiling ${level.file} twice, or under the sim's fdlibm swap, gave different hashes: look for Math.random, iteration over unordered data, or module state in engine/world/level/`;
        violations.push({ id: level.id, metric: 'unstableHash', value: 1, message, file: level.file });
      }
    }
    return violations;
  },
};

export default family;
