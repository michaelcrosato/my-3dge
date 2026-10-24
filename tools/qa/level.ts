/**
 * @file The `level` QA family (PLAN.md §8.6, WP 2.2, WP 13.13, I-29): `node x qa level` validates every level file,
 * the box's (`labs/box/levels/*.txt`, ids `level:<name>`), the fixtures' (`fixtures/levels/*.txt`, ids
 * `level:fixtures/<name>`; the seeded errors under `fixtures/levels/broken/` are the unit tests' business and are
 * skipped) and the storey fixtures' (`fixtures/levels/storeys/*.txt`, ids `level:fixtures/storeys/<name>`, read with
 * their room markers), and runs in T1 through `runQa` (tools/qa/level.test.ts).
 *
 * Metrics, one violation per level and problem code, each valued by its count (larger is worse): each level code's
 * name in camel case (`badHeader`, `empty`, `raggedRow`, `unknownGlyph`, `badBlock`, `badStorey`, `needsStorey`,
 * `badFlight`, `badOpening`, `badRoom`, `badRoof`, `unreachableSpawn`, `unreachableArea`, `unreachableRoom`,
 * `narrowDoor`, `lowHeadroom`, `steepFlight`: engine/world/level/validate.ts finds them, each at its line and column),
 * and `unstableHash`, 1 when compiling the same text twice, or once under the sim's fdlibm swap, gives another hash. A
 * violation names the first problem's line, its fix, and how many more there are. Accepted exceptions go in
 * `tests/baselines/qa-level.json`, each with its reason.
 *
 * Invariants: files are read in name order, so violations come in a fixed order; the legend is the shared
 * registry's (the engine's glyphs; a game's glyphs need their module imported first), or for a place that names its
 * glyphs, a fresh registry with them, from the module beside its levels, imported at run time where the place is: a
 * game gets tools/ but never the engine's fixtures/, so no file here imports them.
 *
 * @example
 * import { ROOT } from '../x';
 * (await levelFiles(ROOT)).map((level) => level.id).includes('level:fixtures/room'); // true
 * @see tools/qa/level.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashValue, type Canonical } from '../../engine/core/hash';
import { createRegistry, type Registry } from '../../engine/core/registry';
import { withSimMath } from '../../engine/core/simMath';
import { compileLevel } from '../../engine/world/level/compile';
import { LEVEL_CONTENT_CODES, type LevelProblem } from '../../engine/world/level/problems';
import { validateLevel } from '../../engine/world/level/validate';
import type { QaFamily, QaViolation } from '../cmd/qa';

/** The module beside a place's levels that names the glyphs they need beyond the engine's, and its function. */
export interface PlaceGlyphs {
  /** Its file in the place's folder. */
  file: string;
  /** The function it exports that defines the glyphs on the registry it is given. */
  define: string;
}

/** Where level files live, the id prefix of each place's levels, and the glyphs they need beyond the engine's. */
export const LEVEL_DIRS: readonly { dir: string; prefix: string; glyphs?: PlaceGlyphs }[] = [
  { dir: 'labs/box/levels', prefix: 'level:' },
  { dir: 'fixtures/levels', prefix: 'level:fixtures/' },
  {
    dir: 'fixtures/levels/storeys',
    prefix: 'level:fixtures/storeys/',
    glyphs: { file: 'glyphs.ts', define: 'defineStoreyFixtureGlyphs' },
  },
];

/** One level file: its QA id, its path from the repository root, and the registry holding its legend. */
export interface LevelFile {
  id: string;
  file: string;
  /** A fresh registry with the place's own glyphs; absent: the shared one. */
  registry?: Registry;
}

/** A fresh registry holding a place's glyphs, from the module `glyphs` names in the place's folder `path`. */
async function placeRegistry(path: string, glyphs: PlaceGlyphs): Promise<Registry> {
  const registry = createRegistry();
  const module = (await import(pathToFileURL(join(path, glyphs.file)).href)) as Record<string, unknown>;
  const define = module[glyphs.define];
  if (typeof define !== 'function') {
    throw new Error(`${join(path, glyphs.file)} exports no function ${glyphs.define}: tools/qa/level.ts's LEVEL_DIRS names it to define the place's glyphs`); // prettier-ignore
  }
  (define as (registry: Registry) => void)(registry);
  return registry;
}

/** Every level file under `root`, in `LEVEL_DIRS` order, then by name. */
export async function levelFiles(root: string): Promise<LevelFile[]> {
  const places = LEVEL_DIRS.map(async ({ dir, prefix, glyphs }): Promise<LevelFile[]> => {
    const path = join(root, dir);
    if (!existsSync(path)) return [];
    const names = readdirSync(path).filter((name) => name.endsWith('.txt'));
    if (!names.length) return [];
    const registry = glyphs ? await placeRegistry(path, glyphs) : undefined;
    return names.sort().map((name) => ({ id: `${prefix}${name.slice(0, -4)}`, file: `${dir}/${name}`, registry }));
  });
  return (await Promise.all(places)).flat();
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
function stableHash(text: string, file: string, registry?: Registry): boolean {
  const hash = () => hashValue(compileLevel(text, { file, registry }) as unknown as Canonical);
  const first = hash();
  return hash() === first && withSimMath(hash) === first;
}

/** The family: every level file's problems, and whether it compiles reproducibly. */
const family: QaFamily = {
  async run({ root, only, keep }) {
    const violations: QaViolation[] = [];
    for (const level of await levelFiles(root)) {
      if (!(keep ? keep(level.id) : !only.length || only.some((prefix) => level.id.startsWith(prefix)))) continue;
      const text = readFileSync(join(root, level.file), 'utf8');
      const problems = validateLevel(text, { file: level.file, registry: level.registry });
      violations.push(...violationsOf(level, problems));
      const structural = problems.some((problem) => !LEVEL_CONTENT_CODES.includes(problem.code));
      if (!structural && !stableHash(text, level.file, level.registry)) {
        const message = `compiling ${level.file} twice, or under the sim's fdlibm swap, gave different hashes: look for Math.random, iteration over unordered data, or module state in engine/world/level/`;
        violations.push({ id: level.id, metric: 'unstableHash', value: 1, message, file: level.file });
      }
    }
    return violations;
  },
};

export default family;
