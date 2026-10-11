/**
 * @file Unit tests for moves as data (engine/anim/moves-data.ts), PLAN.md WP 6.1: Appendix C's table converts each of
 * my-3d2dge's 24 `E.MOVES` (tests/baselines/port/moves.json `specs`) into the engine's entries; every old field has
 * a row; the kind validates, falls back to `move:slash` with one warning, and takes overrides; root travel.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createRegistry } from '../core/registry';
import { parse } from '../core/schema';
import {
  defineMove,
  ENGINE_MOVES,
  fromLegacy,
  getMove,
  LEGACY_FIELDS,
  MOVE_FIELDS,
  resolveMove,
  rootTravel,
  type LegacyMove,
} from './moves-data';

const SPECS = (JSON.parse(readFileSync('tests/baselines/port/moves.json', 'utf8')) as { specs: object })
  .specs as Record<string, LegacyMove & { name: string }>;

/** `value` with every object's keys sorted, so equal data compares equal whatever the key order. */
const sorted = (value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
      )
    : value;

describe("Appendix C's conversion of E.MOVES", () => {
  it('turns each of the 24 old moves into its engine entry', () => {
    expect(Object.keys(SPECS)).toHaveLength(24);
    expect(Object.keys(ENGINE_MOVES)).toEqual(Object.keys(SPECS).map((name) => `move:${name}`));
    for (const [name, old] of Object.entries(SPECS)) {
      const { id: _id, kind: _kind, ...entry } = getMove(`move:${name}`);
      expect(sorted(parse(MOVE_FIELDS, fromLegacy(old))), name).toEqual(sorted(entry));
    }
  });

  it('has a row for every field the old moves use, and converts lengths by 1/16', () => {
    const used = new Set(Object.values(SPECS).flatMap((spec) => Object.keys(spec)));
    used.delete('name'); // the id
    for (const field of used) expect(LEGACY_FIELDS, field).toHaveProperty(field);
    expect(fromLegacy({ reach: 8, lunge: 2, hop: 4, z0: -8 })).toMatchObject({
      reach: [0.5, 0.5],
      height: [-0.5, -0.5],
      body: { lunge: 0.125, hop: 0.25 },
    });
    expect(fromLegacy({ kick: true, z0: 0.5 })).toMatchObject({ limb: 'footR', kickHeight: [0.5, 0.5] });
    expect(fromLegacy({ plane: 'side', spin: true, blade: 0, hold: 0.5 })).toMatchObject({
      plane: 'vertical',
      spin: 1,
      trail: false,
      time: { hold: 0.5 },
    });
  });

  it('keeps where an extending strike winds from: ¾ of the old reach, 7.5 units when it had none', () => {
    expect(getMove('move:thrust').windReach).toBe((0.75 * 7.5) / 16);
    expect(getMove('move:slash').windReach).toBeUndefined();
  });

  it('gives every move the same hit window share, 0.35 by default (I-10)', () => {
    for (const id of Object.keys(ENGINE_MOVES)) expect(getMove(id).hitAt).toBe(0.35);
  });
});

describe('the kind move', () => {
  it('fills defaults, takes time and body field by field, and checks pairs', () => {
    const reg = createRegistry();
    const poke = defineMove('move:poke', { arc: [0, 0], reach: [0.2, 0.6], body: { lunge: 0.1 } }, reg);
    expect(poke).toMatchObject({ hitAt: 0.35, plane: 'ground', time: { wind: 0.06, hold: 0.3 } });
    expect(poke.body).toEqual({ lean: 0.3, lunge: 0.1, hop: 0, crouch: 0.15, twist: 1 });
    expect(() => defineMove('move:bad', { arc: [1] }, reg)).toThrow(/arc has 1 numbers/);
    expect(() => defineMove('move:slow', { time: { wind: 0, active: 0, recover: 0 } }, reg)).toThrow(/never play/);
    expect(() => defineMove('move:far', { body: { hop: 2 } }, reg)).toThrow(/above its maximum/);
  });

  it('warns once for a missing id, naming the closest, and gives move:slash', () => {
    const quiet = createLog({ console: { warn: () => {}, error: () => {} } });
    const reg = createRegistry({ log: quiet });
    expect(getMove('move:slsh', reg).id).toBe('move:slash');
    getMove('move:slsh', reg);
    expect(quiet.advice).toHaveLength(1);
    expect(quiet.advice[0].message).toContain('move:slash');
  });

  it('resolves ids, bare names, entries and specs, and lays overrides on them', () => {
    expect(resolveMove('thrust')).toBe(getMove('move:thrust'));
    expect(resolveMove(getMove('move:jab'))).toBe(getMove('move:jab'));
    const spec = { arc: [0.5, -0.5] as [number, number] };
    expect(resolveMove(spec)).toBe(resolveMove(spec));
    expect(resolveMove(spec).id).toBe('move:custom');
    const longer = resolveMove('slash', { time: { recover: 0.4 }, body: { lean: 0.6 } });
    expect(longer).toMatchObject({ id: 'move:slash', time: { wind: 0.08, recover: 0.4 }, body: { lean: 0.6 } });
    expect(Object.isFrozen(longer.body)).toBe(true);
  });
});

describe('root travel', () => {
  it('travels the lunge over the strike and holds it, only for rootMotion apply', () => {
    const apply = resolveMove('thrust', { rootMotion: 'apply' });
    expect(rootTravel(apply, 'wind', 1)).toBe(0);
    expect(rootTravel(apply, 'active', 0.5)).toBeCloseTo(0.1875 * 0.875, 12);
    expect(rootTravel(apply, 'recover', 0)).toBe(0.1875);
    expect(rootTravel(getMove('move:thrust'), 'active', 1)).toBe(0);
  });
});
