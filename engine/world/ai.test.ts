/**
 * @file Unit tests for engine/world/ai.ts (T1; PLAN.md WP 5.2's Done-when): attack tokens never exceed the cap, under
 * random play and in a world where a crowd takes turns, which captures and restores exactly; a grant waits its gap and
 * draws once; tokens are given back, kept and taken back when the cap drops. Awareness: range, sense and sight lines
 * in the hall (walls and pillars block, low walls and the floor below a gallery do not), the sight line checked
 * against an exact oracle and both ways along hundreds of random lines.
 * @see engine/world/ai.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { defineComponent } from '../sim/state';
import { createWorld } from '../sim/world';
import {
  ATTACK_TOKENS,
  ATTACK_TOKENS_FIELDS,
  canSee,
  clearSight,
  holdsToken,
  keepTokens,
  releaseToken,
  SIGHT,
  takeToken,
  type AttackTokens,
} from './ai';
import { compileLevel } from './level/compile';
import type { CompiledLevel } from './level/types';

const HALL = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
  file: 'hall.txt',
});
const fresh = (fields: Partial<AttackTokens> = {}): AttackTokens => ({ ...ATTACK_TOKENS, holders: [], ...fields });
const at = (x: number, z: number, y = 0) => ({ x, y, z });

describe('attack tokens', () => {
  it('starts with the prototype’s 3 tokens, none held, frozen', () => {
    expect(ATTACK_TOKENS).toEqual({ cap: 3, gapMin: 0.2, gapMax: 0.35, next: 0, holders: [] });
    expect(Object.isFrozen(ATTACK_TOKENS) && Object.isFrozen(ATTACK_TOKENS.holders)).toBe(true);
    expect(Object.keys(ATTACK_TOKENS_FIELDS)).toEqual(Object.keys(ATTACK_TOKENS));
  });

  it('grants up to the cap, one gap after another, drawing once a grant', () => {
    const tokens = fresh();
    const [rng, twin] = [new Rng(5), new Rng(5)];
    expect(takeToken(tokens, 1, 0, rng)).toBe(true);
    const gap = 0.2 + 0.15 * twin.next();
    expect(tokens.next).toBe(gap);
    expect(takeToken(tokens, 2, gap - 1e-9, rng)).toBe(false); // too soon
    expect(takeToken(tokens, 1, gap - 1e-9, rng)).toBe(true); // a holder keeps its own, drawing nothing
    expect(rng.state).toBe(twin.state);
    expect(takeToken(tokens, 2, gap, rng)).toBe(true);
    expect(takeToken(tokens, 3, 10, rng)).toBe(true);
    expect(takeToken(tokens, 4, 20, rng)).toBe(false); // all 3 held
    expect(tokens.holders).toEqual([1, 2, 3]);
    twin.next();
    twin.next();
    expect(rng.state).toBe(twin.state);
  });

  it('draws each gap between gapMin and gapMax', () => {
    const tokens = fresh({ cap: 1, gapMin: 0.5, gapMax: 1.5 });
    const rng = new Rng(9);
    const gaps: number[] = [];
    for (let i = 0, time = 0; i < 500; i++, time = tokens.next) {
      takeToken(tokens, i, time, rng);
      releaseToken(tokens, i);
      gaps.push(tokens.next - time);
    }
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...gaps)).toBeLessThan(1.5);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.9);
  });

  it('gives tokens back, keeps the approved, and takes the newest back when the cap drops', () => {
    const tokens = fresh({ cap: 4, gapMin: 0, gapMax: 0 });
    const rng = new Rng(1);
    for (const id of [5, 6, 7, 8]) takeToken(tokens, id, 0, rng);
    expect([releaseToken(tokens, 6), releaseToken(tokens, 6), tokens.holders]).toEqual([true, false, [5, 7, 8]]);
    expect(keepTokens(tokens, (id) => id !== 7)).toBe(2);
    expect(tokens.holders).toEqual([5, 8]);
    takeToken(tokens, 9, 0, rng);
    tokens.cap = 2;
    expect([holdsToken(tokens, 5), holdsToken(tokens, 8), holdsToken(tokens, 9)]).toEqual([true, true, false]);
    expect(takeToken(tokens, 9, 1, rng)).toBe(false); // the next call takes 9's back: 2 are held
    expect(tokens.holders).toEqual([5, 8]);
    tokens.cap = 0;
    expect([keepTokens(tokens, () => true), takeToken(tokens, 1, 9, rng)]).toEqual([0, false]);
  });

  it('never exceeds the cap under random play: 200 seeds of 600 calls, the cap changing', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const play = new Rng(seed);
      const tokens = fresh({ cap: play.int(0, 5), gapMin: play.range(0, 0.3), gapMax: play.range(0.3, 0.6) });
      const rng = new Rng(seed * 7);
      let [time, last] = [0, -Infinity];
      for (let call = 0; call < 600; call++) {
        time += play.range(0, 0.1);
        const roll = play.next();
        const id = play.int(1, 12);
        if (roll < 0.55) {
          const held = tokens.holders.length;
          if (takeToken(tokens, id, time, rng) && tokens.holders.length > held) {
            if (time - last < tokens.gapMin) problems.push(`seed ${seed}: a grant ${time - last} s after the last`);
            last = time;
          }
        } else if (roll < 0.8) releaseToken(tokens, id);
        else if (roll < 0.95) keepTokens(tokens, (holder) => holder % 3 !== call % 3);
        else tokens.cap = play.int(0, 5);
        const { holders, cap } = tokens;
        if (holders.length > cap && roll < 0.95) problems.push(`seed ${seed}: ${holders.length} held, cap ${cap}`);
        if (new Set(holders).size !== holders.length) problems.push(`seed ${seed}: a holder twice`);
        if (holders.some((holder, k) => holdsToken(tokens, holder) !== k < cap)) problems.push(`seed ${seed}: holds`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('in a world, keeps a crowd’s attackers within the cap, and captures and restores exactly', () => {
    type Parts = { tokens: AttackTokens; foe: { attack: number } };
    const registry = createRegistry();
    defineComponent('tokens', { description: 'The hero’s attack tokens.', fields: ATTACK_TOKENS_FIELDS }, registry);
    defineComponent(
      'foe',
      { description: 'A foe.', fields: { attack: { type: 'integer', default: 0, description: 'Ticks left.' } } },
      registry,
    );
    const w = createWorld<Parts>({ seed: 4, registry });
    let most = 0;
    w.systems.add('attack', (w) => {
      const hero = w.query('tokens')[0].tokens;
      keepTokens(hero, (id) => w.has(id) && w.get(id)!.foe!.attack > 0);
      for (const e of w.query('foe')) {
        if (e.foe.attack > 0 && --e.foe.attack === 0) releaseToken(hero, e.id);
        else if (e.foe.attack === 0 && w.rng('think').chance(0.1) && takeToken(hero, e.id, w.time, w.rng('ai'))) {
          e.foe.attack = 30 + w.rng('think').int(0, 30);
        }
      }
      most = Math.max(most, hero.holders.length);
    });
    w.run(() => {
      w.spawn({ tokens: { cap: 4 } });
      for (let i = 0; i < 40; i++) w.spawn({ foe: {} });
    });
    for (let i = 0; i < 120; i++) w.step({});
    const capture = w.capture();
    for (let i = 0; i < 240; i++) w.step({});
    const [hash, holders] = [w.hash(), [...w.query('tokens')[0].tokens.holders]];
    w.restore(capture);
    for (let i = 0; i < 240; i++) w.step({});
    expect([w.hash(), w.query('tokens')[0].tokens.holders]).toEqual([hash, holders]);
    expect(most).toBe(4);
  });
});

/** The exact oracle: every tile the line's open interval crosses (slab test), its top at most the line's lowest there. */
function oracle(level: CompiledLevel, a: [number, number, number], b: [number, number, number]): boolean {
  const { tile, cols, rows, top } = level;
  const [c0, c1] = [Math.floor(Math.min(a[0], b[0]) / tile), Math.floor(Math.max(a[0], b[0]) / tile)];
  const [r0, r1] = [Math.floor(Math.min(a[2], b[2]) / tile), Math.floor(Math.max(a[2], b[2]) / tile)];
  const slab = (p: number, d: number, lo: number, hi: number): [number, number] => {
    if (d === 0) return p >= lo && p < hi ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const [s, t] = [(lo - p) / d, (hi - p) / d];
    return s < t ? [s, t] : [t, s];
  };
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const [x0, x1] = slab(a[0], b[0] - a[0], c * tile, (c + 1) * tile);
      const [z0, z1] = slab(a[2], b[2] - a[2], r * tile, (r + 1) * tile);
      const [t0, t1] = [Math.max(x0, z0, 0), Math.min(x1, z1, 1)];
      if (!(t1 > t0)) continue;
      if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
      const low = Math.min(a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1);
      if (top[r * cols + c] > low) return false;
    }
  }
  return true;
}

describe('awareness', () => {
  it('sees within range: senses what is near through anything, and needs a clear line beyond', () => {
    const level = compileLevel('###########\n#....#....#\n#....w....#\n###########\n');
    expect(canSee(level, at(1.5, 1.5), at(8.5, 1.5))).toBe(false); // the wall
    expect(canSee(level, at(1.5, 2.5), at(8.5, 2.5))).toBe(true); // over the low wall
    expect(canSee(level, at(3.5, 1.5), at(6.5, 1.5))).toBe(true); // 3 m: sensed through the wall
    expect(canSee(level, at(3.5, 1.5), at(6.5, 1.5), { near: 2 })).toBe(false);
    expect(canSee(level, at(1.5, 2.5), at(8.5, 2.5), { range: 6.9 })).toBe(false);
    expect(canSee(level, at(1.5, 2.5), at(8.5, 2.5), { eye: 0.5, aim: 0.5 })).toBe(false); // below the low wall's top
    expect(SIGHT).toEqual({ range: 9.375, near: 3.75, eye: 1.5, aim: 1 });
  });

  it('in the hall: pillars block, the floor sees a hero on a gallery, and nothing is seen off the map', () => {
    const far = { range: 100 };
    expect(canSee(HALL, at(4.5, 7.5), at(10.5, 7.5), far)).toBe(false); // the pillar at columns 7 and 8
    expect(canSee(HALL, at(4.5, 9.5), at(10.5, 9.5), far)).toBe(true); // the row below it is open
    expect(canSee(HALL, at(54.5, 12.5), at(50.5, 2.5, 1), far)).toBe(true); // up onto the east gallery, over the stairs
    expect(canSee(HALL, at(44.5, 13.5), at(50.5, 2.5, 1), far)).toBe(false); // the pillar at columns 47 and 48
    expect(canSee(HALL, at(50.5, 5.5), at(50.5, 2.5, 1), { near: 0 })).toBe(true); // over its edge, from below
    expect(canSee(HALL, at(-2, 5), at(4.5, 5.5), far)).toBe(false);
    expect(() => clearSight(HALL, Number.NaN, 0, 0, 1, 1, 1)).toThrow(/CORE_BAD_SPEC|finite/);
  });

  it('agrees with an exact oracle and both ways along 2,000 random lines across the hall', () => {
    const rng = new Rng(11);
    const [w, d] = [HALL.cols * HALL.tile, HALL.rows * HALL.tile];
    const mismatches: string[] = [];
    let clear = 0;
    for (let i = 0; i < 2000; i++) {
      const a: [number, number, number] = [rng.range(0, w), rng.range(0, 4), rng.range(0, d)];
      const b: [number, number, number] = [rng.range(0, w), rng.range(0, 4), rng.range(0, d)];
      const there = clearSight(HALL, ...a, ...b);
      const back = clearSight(HALL, ...b, ...a);
      if (there !== oracle(HALL, a, b) || there !== back) mismatches.push(`${a} → ${b}: ${there}, back ${back}`);
      if (there) clear++;
    }
    expect(mismatches).toEqual([]);
    expect(clear).toBeGreaterThan(200); // both answers are well represented
    expect(clear).toBeLessThan(1800);
  });

  it('lets a line through a corner only when both tiles beside it do', () => {
    // From tile (1, 2) to tile (2, 1), exactly through the corner (2, 2) m between them.
    const corner = (map: string) => clearSight(compileLevel(map), 1.5, 1, 2.5, 2.5, 1, 1.5);
    expect(corner('#####\n#...#\n#...#\n#####\n')).toBe(true);
    expect(corner('#####\n#...#\n#.#.#\n#####\n')).toBe(false); // (2, 2) is a wall
    expect(corner('#####\n##..#\n#...#\n#####\n')).toBe(false); // (1, 1) is a wall
    expect(corner('#####\n#...#\n#.w.#\n#####\n')).toBe(true); // a low wall, below the line
  });
});
