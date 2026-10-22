/**
 * @file Traversal as world data (PLAN.md WP 13.7, docs/PLAYGROUND.md §2.3 and §3.2): ziplines, ladders and launchers,
 * the specs a scene places them by (engine/sim/rides.ts's `addZipline`, `addLadder`, `addLauncher`), their checks, and
 * the ladders a level's ladder glyphs stand (`levelLadders`). The shooter model rides them
 * (engine/physics/movement/ride.ts and ladder.ts, through engine/sim/rides.ts's `ridesOf`), launchers set off any
 * character, and the stage draws them (engine/gfx/stageRides.ts).
 *
 * - A zipline is a cable between two anchors (`from`, `to`), ridden either way; a `balloon` is a vertical one whose
 *   upper anchor is a redeploy balloon, launching a skydive. Unless `poles` is false, a pole stands under each anchor
 *   down to its foot, `feet` (the ground at 0 by default; none under a balloon's line).
 * - A ladder stands against a wall: `foot` is the middle of its bottom rung's line (its face, `LADDER_DEPTH` off the
 *   wall), `top` the wall's top, `normal` out of the wall toward whoever climbs it, `width` across. A level's ladder
 *   glyph (`ladder: true`, the engine's `|`) stands one on each run of its tiles along a face, against the
 *   neighbouring tile that stands highest, up to that tile's top.
 * - A launcher is a jump pad or a trampoline (`mesh`): `at` the middle of its top, `size` across; its volume reaches
 *   `reach` above its top, and a character's feet in it, not rising, set it off at `velocity` (its part across added
 *   to the speed across it had when it `keep`s it), up at least `bounce` times the speed it fell in at. A `solid` one
 *   stands on a fixed box from the ground (y 0) up to its top.
 *
 * Invariants: data only, sim-side; specs are parsed against their fields (`parse`, engine/core/schema.ts) and checked
 * (`traverseProblems`); `levelLadders` depends only on the compiled level, its ladders in reading order.
 *
 * @example
 * import { compileLevel } from './level/compile';
 * const level = compileLevel('---\ndescription: A wall with a ladder.\n---\n#####\n#@|.#\n#####\n', { file: 'ladder.txt' });
 * levelLadders(level)[0].top; // 3: up the wall north of it, the engine's 3 m wall
 * traverseProblems('zipline', { from: [0, 2, 0], to: [0, 2, 1] }); // ['its anchors stand 1 m apart: at least 2 m']
 * @see engine/world/traverse.test.ts
 */
import { codeError } from '../core/log';
import { defineSchema, parse, type EntryOf } from '../core/schema';
import { storeyView } from './level/storeys';
import type { CompiledLevel } from './level/types';

/** How far a ladder's rungs stand off the wall it leans on (m). */
export const LADDER_DEPTH = 0.1;

/** A vector field of three numbers. */
const vec3 = (description: string, unit = 'm') =>
  ({ type: 'array', items: { type: 'number' }, required: true, unit, description }) as const;

/** A zipline's fields (see the file comment). */
export const ZIPLINE_FIELDS = defineSchema({
  from: vec3('Its first anchor, where the cable is tied (m).'),
  to: vec3('Its second anchor (m).'),
  balloon: { type: 'boolean', default: false, description: 'A redeploy balloon’s line: vertical, its upper anchor the balloon, which launches a skydive.' }, // prettier-ignore
  poles: { type: 'boolean', default: true, description: 'A pole stands under each anchor, down to its foot (none on a balloon’s line).' }, // prettier-ignore
  feet: { type: 'array', items: { type: 'number' }, default: [0, 0], unit: 'm', description: 'The heights the poles stand on, under `from` and under `to`: the ground, or what an anchor stands on.' }, // prettier-ignore
});

/** A ladder's fields (see the file comment). */
export const LADDER_FIELDS = defineSchema({
  foot: vec3('The middle of its bottom rung’s line, on its face (m).'),
  top: { type: 'number', required: true, unit: 'm', description: 'Its top’s height: where the wall it leans on ends.' }, // prettier-ignore
  normal: { type: 'array', items: { type: 'number' }, required: true, description: 'Out of the wall toward whoever climbs it, a unit [x, z].' }, // prettier-ignore
  width: { type: 'number', default: 0.6, minimum: 0.1, unit: 'm', description: 'Across its face.' },
});

/** A launcher's fields (see the file comment). */
export const LAUNCHER_FIELDS = defineSchema({
  at: vec3('The middle of its top, where the feet stand on it (m).'),
  size: { type: 'array', items: { type: 'number' }, default: [1.5, 1.5], unit: 'm', description: 'Its top across, along x and z.' }, // prettier-ignore
  reach: { type: 'number', default: 0.3, minimum: 0.05, unit: 'm', description: 'Its volume reaches this high above its top: a trampoline’s a tick’s fall.' }, // prettier-ignore
  velocity: vec3('The velocity it sets off at.', 'm/s'),
  bounce: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'Up at least this share of the speed it fell in at (a trampoline’s 0.9).' }, // prettier-ignore
  keep: { type: 'boolean', default: true, description: 'Its velocity across is added to the speed across it had; false: replaces it.' }, // prettier-ignore
  mesh: { type: 'string', enum: ['pad', 'trampoline'], default: 'pad', description: 'How the stage draws it.' },
  solid: { type: 'boolean', default: false, description: 'A fixed box stands under its top, from the ground (y 0): a trampoline’s frame.' }, // prettier-ignore
});

/** A zipline, parsed: every field of `ZIPLINE_FIELDS`, its defaults filled. */
export type ZiplineSpec = EntryOf<typeof ZIPLINE_FIELDS>;

/** A ladder, parsed: every field of `LADDER_FIELDS`, its defaults filled. */
export type LadderSpec = EntryOf<typeof LADDER_FIELDS>;

/** A jump pad or a trampoline, parsed: every field of `LAUNCHER_FIELDS`, its defaults filled. */
export type LauncherSpec = EntryOf<typeof LAUNCHER_FIELDS>;

/** The kinds of traversal, by their fields. */
export const TRAVERSE_FIELDS = { zipline: ZIPLINE_FIELDS, ladder: LADDER_FIELDS, launcher: LAUNCHER_FIELDS } as const;

/** Whether `v` is `n` finite numbers. */
const finite = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);

/** The problems of a spec of `kind` beyond its fields (its fields' own are `parse`'s): sizes, lengths, directions. */
export function traverseProblems(kind: keyof typeof TRAVERSE_FIELDS, spec: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const s = spec as Record<string, readonly number[] & number & boolean>;
  if (kind === 'zipline') {
    if (!finite(s.from, 3) || !finite(s.to, 3)) return ['from and to are [x, y, z] in metres'];
    const length = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]);
    if (length < 2) problems.push(`its anchors stand ${Math.round(length * 100) / 100} m apart: at least 2 m`);
    if (s.balloon && Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]) > 0.2 * length) problems.push('a balloon’s line is vertical: put one anchor above the other'); // prettier-ignore
    const feet = (s.feet as readonly number[] | undefined) ?? [0, 0];
    if (!finite(feet, 2)) problems.push('feet is [under from, under to] in metres');
  } else if (kind === 'ladder') {
    if (!finite(s.foot, 3) || !finite(s.normal, 2)) return ['foot is [x, y, z] and normal [x, z]'];
    if (Math.abs(Math.hypot(s.normal[0], s.normal[1]) - 1) > 1e-6) problems.push('normal is a unit [x, z]: out of the wall'); // prettier-ignore
    if (!(s.top > s.foot[1] + 0.5)) problems.push(`its top ${s.top} m stands less than 0.5 m over its foot at ${s.foot[1]} m`); // prettier-ignore
  } else {
    if (!finite(s.at, 3) || !finite(s.velocity, 3)) return ['at is [x, y, z] in metres and velocity [x, y, z] in m/s'];
    const size = (s.size as readonly number[] | undefined) ?? [1, 1];
    if (!finite(size, 2) || size.some((v) => v <= 0)) problems.push('size is [x, z], each above 0');
  }
  return problems;
}

/** `spec` parsed and checked as a `kind` (see `traverseProblems`); throws `CORE_BAD_SPEC` naming each problem. */
export function parseTraverse<K extends keyof typeof TRAVERSE_FIELDS>(
  kind: K,
  spec: Record<string, unknown>,
  where: string,
): EntryOf<(typeof TRAVERSE_FIELDS)[K]> {
  const parsed = parse(TRAVERSE_FIELDS[kind], spec, where) as EntryOf<(typeof TRAVERSE_FIELDS)[K]>;
  const problems = traverseProblems(kind, spec);
  if (problems.length > 0) throw codeError('CORE_BAD_SPEC', { where, problems: problems.join('; ') });
  return parsed;
}

/** A launcher's volume: from its top's corner a little below it to `reach` above, `[min, max]` (m). */
export function launcherVolume(spec: LauncherSpec): [[number, number, number], [number, number, number]] {
  const [x, y, z] = spec.at;
  const [w, d] = spec.size;
  return [
    [x - w / 2, y - 0.05, z - d / 2],
    [x + w / 2, y + spec.reach, z + d / 2],
  ];
}

/** The four sides of a tile: the step to its neighbour, in reading order of preference (north, east, south, west). */
const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * The ladders `level`'s ladder glyphs stand (see the file comment), in reading order; in a level written as storeys,
 * each storey's (bottom first), from its floor up to the top of the wall it leans on, the floor of the storey above.
 */
export function levelLadders(level: CompiledLevel): LadderSpec[] {
  return level.storeys ? level.storeys.flatMap((_, k) => storeyLadders(storeyView(level, k))) : storeyLadders(level);
}

/** The ladders of one storey (a format-1 level, or a storey's view), in reading order. */
function storeyLadders(level: CompiledLevel): LadderSpec[] {
  const { cols, rows, tile } = level;
  const ladderAt = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && level.legend[level.tiles[r * cols + c]]?.ladder === true; // prettier-ignore
  const wallOf = (c: number, r: number): [number, number] | null => {
    let best: [number, number] | null = null;
    for (let k = 0; k < 4; k++) {
      const [dc, dr] = SIDES[k];
      const [nc, nr] = [c + dc, r + dr];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const top = level.top[nr * cols + nc];
      if (top > level.floor[r * cols + c] + 0.5 && (!best || top > best[1])) best = [k, top];
    }
    return best;
  };
  const used = new Set<number>();
  const ladders: LadderSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (used.has(r * cols + c) || !ladderAt(c, r)) continue;
      const wall = wallOf(c, r);
      if (!wall) continue;
      const [side, top] = wall;
      const [dc, dr] = SIDES[side];
      const [ac, ar] = dr === 0 ? [0, 1] : [1, 0]; // along the face
      let n = 0;
      for (; ladderAt(c + ac * n, r + ar * n); n++) {
        const next = wallOf(c + ac * n, r + ar * n);
        if (!next || next[0] !== side || next[1] !== top || used.has((r + ar * n) * cols + c + ac * n)) break;
        used.add((r + ar * n) * cols + c + ac * n);
      }
      const [mc, mr] = [c + 0.5 + (ac * n) / 2 - ac / 2, r + 0.5 + (ar * n) / 2 - ar / 2]; // the run's middle tile, centre
      const normal: [number, number] = [-dc || 0, -dr || 0]; // never -0
      const face = [(mc + dc * 0.5) * tile, (mr + dr * 0.5) * tile];
      const foot = [face[0] + normal[0] * LADDER_DEPTH, level.floor[r * cols + c], face[1] + normal[1] * LADDER_DEPTH];
      ladders.push(parse(LADDER_FIELDS, { foot, top, normal, width: n * tile }, 'levelLadders'));
    }
  }
  return ladders;
}
