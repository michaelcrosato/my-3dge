/**
 * @file Crowd AI helpers (PLAN.md WP 5.2; doctrines: Common ground, Reproducible): attack tokens, so a few agents
 * attack at once and each new attack starts a moment after the last (every hit has a readable author), and simple
 * awareness: whether an agent sees a target, by distance and a sight line over the level's grid.
 *
 * - **Attack tokens.** A scene keeps an `AttackTokens` (`ATTACK_TOKENS_FIELDS`) in a component of what is attacked,
 *   the hero. An agent asks `takeToken(tokens, id, w.time, w.rng('ai'))` before it winds up, holds the token while it
 *   attacks, and gives it back with `releaseToken` when the attack ends or is broken off; each step, `keepTokens`
 *   drops holders that died or left. A grant waits for `cap` (a free token) and `next` (the gap after the last grant,
 *   drawn between `gapMin` and `gapMax`).
 * - **Awareness.** `canSee(level, from, to)`: within `range` metres on the ground, and either within `near` (it senses
 *   what is that close) or in a clear sight line from its eye to the target's chest. `clearSight` walks the line's
 *   tiles on the grid: walls and pillars block it; low walls, braziers and floors below it do not.
 *
 * Invariants: the tokens are plain data in a component, so the hash and captures cover them and a restore continues
 * exactly. After every call, at most `cap` agents hold a token, each once, oldest grant first; lowering `cap` takes
 * the newest grants back at the next call (`holdsToken` says so at once). A grant draws one number from the stream
 * given, nothing else draws. Sight is a pure function of the level and the points. Ids are the caller's (entity ids).
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:236-241` (`takeTurn`: at most 3 attackers, the next turn
 * 0.25 s × 0.8–1.4 later) and `src/emberdeep/30-monsters-core.js:145-163, 261` (the token manager: `maxAttackers`,
 * `takeTurn`, the count of holders each step, `m.tok`; `aware`: within 150 units, and within 60 or in a clear line),
 * mechanisms only, in metres and seconds; the sight line over the grid's tops is new.
 *
 * @example
 * import { Rng } from '../core/rng';
 * import { compileLevel } from './level/compile';
 * const tokens = { ...ATTACK_TOKENS, holders: [] };
 * const rng = new Rng(1);
 * [takeToken(tokens, 7, 0, rng), takeToken(tokens, 8, 0, rng), takeToken(tokens, 8, 1, rng)]; // [true, false, true]
 * releaseToken(tokens, 7); // true: 7 gives its token back
 * tokens.holders; // [8]
 * const level = compileLevel('###########\n#....#....#\n#....w....#\n###########\n');
 * const at = (x: number, z: number) => ({ x, y: 0, z });
 * canSee(level, at(1.5, 1.5), at(8.5, 1.5)); // false: a wall between
 * canSee(level, at(1.5, 2.5), at(8.5, 2.5)); // true: over the low wall
 * canSee(level, at(1.5, 1.5), at(3.5, 1.5), { range: 1 }); // false: too far
 * @see engine/world/ai.test.ts
 */
import { codeError } from '../core/log';
import type { Rng } from '../core/rng';
import { copyValue, defineSchema, freezeValue } from '../core/schema';
import type { CompiledLevel } from './level/types';
import type { SteerPoint } from './steer';

/** The attack tokens' fields, for a scene's component: `defineComponent('tokens', { description, fields: … })`. */
export const ATTACK_TOKENS_FIELDS = defineSchema({
  cap: {
    type: 'integer',
    default: 3,
    minimum: 0,
    description: 'The most agents that hold a token at once (the prototype’s 3).',
  },
  gapMin: { type: 'number', default: 0.2, minimum: 0, unit: 's', description: 'The shortest wait between grants.' },
  gapMax: {
    type: 'number',
    default: 0.35,
    minimum: 0,
    unit: 's',
    description: 'The longest wait between grants: each wait is drawn between gapMin and this.',
  },
  next: { type: 'number', default: 0, unit: 's', description: 'The sim time from which the next grant may come.' },
  holders: {
    type: 'array',
    items: { type: 'integer' },
    default: [],
    description: 'The ids holding a token, oldest grant first.',
  },
});

/** Attack tokens: who holds one and when the next may be granted (`ATTACK_TOKENS_FIELDS` says what each means). */
export interface AttackTokens {
  cap: number;
  gapMin: number;
  gapMax: number;
  next: number;
  holders: number[];
}

/** Attack tokens with every field at its default: 3 tokens, none held. Copy it (and its `holders`) to use it. */
export const ATTACK_TOKENS: Readonly<AttackTokens> = freezeValue(
  Object.fromEntries(
    Object.entries(ATTACK_TOKENS_FIELDS).map(([key, field]) => [key, copyValue(field.default)]),
  ) as unknown as AttackTokens,
);

/** Takes back the newest grants beyond `cap`. */
function trim(tokens: AttackTokens): void {
  const cap = Math.max(0, tokens.cap);
  if (tokens.holders.length > cap) tokens.holders.length = cap;
}

/** Whether `id` holds a token: one of the oldest `cap` grants. */
export function holdsToken(tokens: Readonly<AttackTokens>, id: number): boolean {
  const at = tokens.holders.indexOf(id);
  return at >= 0 && at < tokens.cap;
}

/**
 * Asks for a token for `id` at sim time `time` (s): true when it holds one now. A holder keeps its own; otherwise a
 * token is granted when fewer than `cap` are held and `time` has reached `next`, and the next grant then waits a gap
 * drawn from `rng` between `gapMin` and `gapMax`.
 */
export function takeToken(tokens: AttackTokens, id: number, time: number, rng: Pick<Rng, 'next'>): boolean {
  trim(tokens);
  if (tokens.holders.includes(id)) return true;
  if (tokens.holders.length >= tokens.cap || time < tokens.next) return false;
  tokens.holders.push(id);
  tokens.next = time + tokens.gapMin + (tokens.gapMax - tokens.gapMin) * rng.next();
  return true;
}

/** Gives `id`'s token back (its attack ended, or was broken off): true when it held one. */
export function releaseToken(tokens: AttackTokens, id: number): boolean {
  trim(tokens);
  const at = tokens.holders.indexOf(id);
  if (at >= 0) tokens.holders.splice(at, 1);
  return at >= 0;
}

/** Keeps the tokens of the holders `keep` approves (alive, still attacking), freeing the rest: how many are held. */
export function keepTokens(tokens: AttackTokens, keep: (id: number) => boolean): number {
  trim(tokens);
  const holders = tokens.holders.filter((id) => keep(id));
  tokens.holders.length = 0;
  tokens.holders.push(...holders);
  return holders.length;
}

/** How `canSee` looks. */
export interface SightOptions {
  /** The farthest it sees (m, on the ground). */
  range?: number;
  /** Closer than this (m, on the ground), it senses the target without a clear line. */
  near?: number;
  /** Its eye over its feet (m). */
  eye?: number;
  /** The height over the target's feet it looks at (m). */
  aim?: number;
}

/** `canSee`'s defaults: emberdeep's 150 units of sight and 60 of sense, an eye at 1.5 m on a chest at 1 m. */
export const SIGHT: Readonly<Required<SightOptions>> = Object.freeze({ range: 9.375, near: 3.75, eye: 1.5, aim: 1 });

/**
 * Whether an agent with its feet at `from` is aware of a target with its feet at `to`: within `range` metres on the
 * ground, and either within `near` metres or in a clear sight line from its eye to the target's `aim`.
 */
export function canSee(level: CompiledLevel, from: SteerPoint, to: SteerPoint, options: SightOptions = SIGHT): boolean {
  const range = options.range ?? SIGHT.range;
  const near = options.near ?? SIGHT.near;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = dx * dx + dz * dz;
  if (!(distance <= range * range)) return false;
  if (distance < near * near) return true;
  const eye = from.y + (options.eye ?? SIGHT.eye);
  const aim = to.y + (options.aim ?? SIGHT.aim);
  return clearSight(level, from.x, eye, from.z, to.x, aim, to.z);
}

/**
 * Whether the straight line from (ax, ay, az) to (bx, by, bz) metres passes over every tile it crosses (walked in
 * order, as Amanatides and Woo's grid traversal does): no tile's top (`level.top`) stands above the line's lowest
 * point over that tile, and no point of it lies off the map. A line through a corner where four tiles meet passes
 * only when both tiles beside it let it. So an agent on the floor sees a hero on a gallery over its edge.
 */
export function clearSight(
  level: CompiledLevel,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  if (!Number.isFinite(ax + ay + az + bx + by + bz)) {
    throw codeError('CORE_BAD_SPEC', { where: 'clearSight(level, …)', problems: 'give finite coordinates in metres' });
  }
  const { tile, cols, rows, top } = level;
  // In tiles: the line is (x0, z0) + t·(dx, dz) for t in [0, 1], its height ay + t·(by − ay).
  const [x0, z0, dx, dz, dy] = [ax / tile, az / tile, (bx - ax) / tile, (bz - az) / tile, by - ay];
  let [col, row] = [Math.floor(x0), Math.floor(z0)];
  const [stepCol, stepRow] = [Math.sign(dx), Math.sign(dz)];
  // The t at which the line crosses its next column and row edge, and the t between two such crossings.
  let [nextCol, nextRow] = [edge(x0, dx, col), edge(z0, dz, row)];
  const [perCol, perRow] = [stepCol ? Math.abs(1 / dx) : Infinity, stepRow ? Math.abs(1 / dz) : Infinity];
  // Whether tile (c, r) lets the line pass while t runs from `from` to `to`: on the map, its top below the line's
  // lowest point there (the line is straight, so that is at one end).
  const passes = (c: number, r: number, from: number, to: number) =>
    c >= 0 && r >= 0 && c < cols && r < rows && top[r * cols + c] <= ay + Math.min(dy * from, dy * Math.min(to, 1));
  let crossings = Math.abs(Math.floor(bx / tile) - col) + Math.abs(Math.floor(bz / tile) - row);
  let enter = 0;
  for (; crossings > 0; crossings--) {
    const leave = Math.min(nextCol, nextRow);
    if (!passes(col, row, enter, leave)) return false;
    if (nextCol === nextRow) {
      // Through a corner: both tiles beside it must let the line pass, then on diagonally.
      if (!passes(col + stepCol, row, leave, leave) || !passes(col, row + stepRow, leave, leave)) return false;
      [col, row, nextCol, nextRow] = [col + stepCol, row + stepRow, nextCol + perCol, nextRow + perRow];
      crossings--;
    } else if (nextCol < nextRow) {
      [col, nextCol] = [col + stepCol, nextCol + perCol];
    } else {
      [row, nextRow] = [row + stepRow, nextRow + perRow];
    }
    enter = leave;
  }
  return passes(col, row, enter, 1);
}

/** The t at which a line from `start` (tiles) moving `delta` per unit t leaves cell `cell`: Infinity when it never does. */
function edge(start: number, delta: number, cell: number): number {
  if (delta > 0) return (cell + 1 - start) / delta;
  if (delta < 0) return (cell - start) / delta;
  return Infinity;
}
