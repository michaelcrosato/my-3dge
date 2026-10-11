/**
 * @file Unit tests for timelines, attacks and combos (engine/anim/timeline.ts), PLAN.md WP 6.1's Done when: combo
 * chaining windows are exact in ticks. Also: phases end on exact ticks, leftover time carries across phases and fires
 * every event in order, the hit window connects once per target per swing (also when shorter than a tick), sweeps,
 * root motion, trails, and save/load continuing exactly.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import { resolveMove } from './moves-data';
import { Attack, Combo, Timeline, type TimelineEvent } from './timeline';

const types = (events: readonly TimelineEvent[]) => events.map((e) => e.type);

/** Plays `attack` for `steps` ticks; returns the tick each event fired on (the start is tick 0). */
function ticksOf(attack: Attack, steps: number): Record<string, number> {
  const at: Record<string, number> = {};
  for (const e of attack.events) at[e.type] = 0;
  for (let tick = 1; tick <= steps; tick++) for (const e of attack.update(SIM_DT)) at[e.type] ??= tick;
  return at;
}

/** The tick on which `seconds` have passed: the first n with n · dt ≥ seconds (to a hair). */
const tickAt = (seconds: number) => Math.ceil(seconds * 60 - 1e-6);

describe('Timeline', () => {
  it('ends a phase on the exact tick: 0.1 s after 6 steps of 1/60 s', () => {
    const tl = new Timeline([
      { name: 'a', duration: 0.1 },
      { name: 'b', duration: 1 },
    ]);
    tl.start();
    for (let i = 1; i <= 5; i++) expect(types(tl.advance(SIM_DT)), `step ${i}`).toEqual([]);
    expect(types(tl.advance(SIM_DT))).toEqual(['b']);
    expect(tl.t).toBeLessThan(1e-9);
  });

  it('carries leftover time across phases and fires every event in order, saying how late', () => {
    const tl = new Timeline([
      { name: 'wind', duration: 0.1 },
      {
        name: 'active',
        duration: 0.1,
        events: [
          { type: 'hitClose', at: 1 },
          { type: 'hitOpen', at: 0.5 },
        ],
      },
      { name: 'recover', duration: 0.2, events: [{ type: 'start', at: 0 }] },
    ]);
    expect(types(tl.start())).toEqual(['wind']);
    const events = tl.advance(0.35);
    expect(types(events)).toEqual(['active', 'hitOpen', 'hitClose', 'recover', 'start']);
    expect(events.map((e) => +e.late.toFixed(9))).toEqual([0.25, 0.2, 0.15, 0.15, 0.15]);
    expect([tl.current?.name, +tl.t.toFixed(9), +tl.u.toFixed(9), +tl.elapsed.toFixed(9)]).toEqual([
      'recover',
      0.15,
      0.75,
      0.35,
    ]);
    expect(types(tl.advance(1))).toEqual(['end']);
    expect([tl.playing, tl.index, tl.u, tl.elapsed]).toEqual([false, -1, 0, 0]);
    expect(tl.duration).toBeCloseTo(0.4, 12);
  });

  it('saves as two numbers and continues exactly after a load', () => {
    const make = () =>
      new Timeline([
        { name: 'a', duration: 0.13 },
        { name: 'b', duration: 0.07 },
      ]);
    const [a, b] = [make(), make()];
    a.start();
    for (let i = 0; i < 9; i++) a.advance(SIM_DT);
    b.load(a.save());
    for (let i = 0; i < 4; i++) expect(b.advance(SIM_DT)).toEqual(a.advance(SIM_DT));
    expect(b.save()).toEqual(a.save());
    expect(make().load([7, 1]).playing).toBe(false);
  });
});

describe('Attack', () => {
  it('fires wind, active, hitOpen, hitClose, recover and end on the exact ticks', () => {
    const slash = new Attack('move:slash'); // wind 0.08, active 0.1 (hit at 0.35), recover 0.22
    expect(slash.start()).toBe(true);
    const at = ticksOf(slash, 40);
    expect(at).toEqual({
      wind: 0,
      active: tickAt(0.08),
      hitOpen: tickAt(0.08 + 0.035),
      hitClose: tickAt(0.18),
      recover: tickAt(0.18),
      end: tickAt(0.4),
    });
    expect(slash.busy).toBe(false);
  });

  it('connects once per target per swing, only while the hit window is open', () => {
    const jab = new Attack('jab');
    const targets = [{ id: 3 }, { id: 5 }, { id: 8 }];
    const hit: number[] = [];
    const swing = () => {
      jab.start();
      while (jab.busy) {
        jab.update(SIM_DT);
        const n = jab.hits(
          targets,
          (t) => t.id !== 8,
          (t) => hit.push(t.id),
        );
        if (n) expect(jab.active || jab.phase === 'recover').toBe(true);
        if (jab.phase === 'wind') expect(jab.hitOpen).toBe(false);
      }
    };
    swing();
    expect(hit).toEqual([3, 5]);
    swing();
    expect(hit).toEqual([3, 5, 3, 5]);
  });

  it('keys targets without an id by the function given, and throws for a key that is no number (ANIM_BAD_HIT_KEY)', () => {
    const [a, b] = [
      { name: 'a', at: new Vector3(1, 0, 0) },
      { name: 'b', at: new Vector3(-1, 0, 0) },
    ];
    const key = (t: typeof a) => (t === a ? 1 : 2);
    const hit: string[] = [];
    const record = (t: typeof a) => hit.push(t.name);
    const slash = new Attack('slash');
    slash.start();
    while (slash.busy) {
      slash.update(SIM_DT);
      slash.hits([a, b], () => true, record, key);
    }
    const combo = new Combo(['slash']);
    combo.press();
    while (combo.busy) {
      combo.update(SIM_DT);
      combo.hits([b, a], () => true, record, key);
    }
    expect(hit).toEqual(['a', 'b', 'b', 'a']);

    slash.start();
    while (!slash.hitOpen) slash.update(SIM_DT);
    // @ts-expect-error: targets without an id field need a keying function
    expect(() => slash.hits([a, b], () => true, record)).toThrow(
      '[ANIM_BAD_HIT_KEY] hits keyed a target by undefined, not a finite number',
    );
    expect(() =>
      slash.hits(
        [a],
        () => true,
        record,
        () => Number.NaN,
      ),
    ).toThrow('by NaN, not a finite number');
    combo.press();
    while (!combo.current.hitOpen) combo.update(SIM_DT);
    // @ts-expect-error: the same for a combo
    expect(() => combo.hits([a], () => true, record)).toThrow('[ANIM_BAD_HIT_KEY]');
    expect(hit).toEqual(['a', 'b', 'b', 'a']);
  });

  it('opens the window for the step even when the strike is shorter than a tick', () => {
    const flick = new Attack({ arc: [0, 0], time: { wind: 0.02, active: 0.004, recover: 0.05 } });
    flick.start();
    const hit: number[] = [];
    for (let i = 0; i < 6; i++) {
      flick.update(SIM_DT);
      flick.hits(
        [{ id: 1 }],
        () => true,
        (t) => hit.push(t.id),
      );
    }
    expect(hit).toEqual([1]);
  });

  it('publishes sweeps from the last step’s segment while the window is open', () => {
    const slash = new Attack('slash');
    slash.start();
    const sweeps = [];
    for (let i = 0; slash.busy; i++) {
      slash.update(SIM_DT);
      const sweep = slash.sweep(new Vector3(i, 0, 0), new Vector3(i, 1, 0));
      if (sweep) sweeps.push([sweep.base0.x, sweep.base1.x]);
    }
    const open = tickAt(0.115);
    expect(sweeps).toEqual(Array.from({ length: tickAt(0.18) - open + 1 }, (_, k) => [open - 2 + k, open - 1 + k]));
  });

  it('moves the root by the lunge with rootMotion apply, and not at all with visual', () => {
    const lunge = (attack: Attack) => {
      attack.start();
      let sum = 0;
      while (attack.busy) sum += (attack.update(SIM_DT), attack.rootDelta);
      return sum;
    };
    expect(lunge(new Attack('thrust', { rootMotion: 'apply' }))).toBeCloseTo(0.1875, 12);
    expect(lunge(new Attack('thrust'))).toBe(0);
  });

  it('names the part that trails, as my-3d2dge drew it', () => {
    const trailAt = (name: string, armed: boolean) => {
      const a = new Attack(name);
      a.start();
      while (a.phase !== 'active') a.update(SIM_DT);
      return a.trail(armed);
    };
    expect(trailAt('slash', true)).toBe('blade');
    expect(trailAt('slash', false)).toBe('fistR');
    expect(trailAt('jab', true)).toBe('fistL');
    expect(trailAt('cross', true)).toBeUndefined(); // a punch thrown with a sword in hand leaves no ribbon
    expect(trailAt('cross', false)).toBe('fistR');
    expect(trailAt('roundhouse', true)).toBe('kick');
    expect(new Attack('slash').trail(true)).toBeUndefined();
  });

  it('refuses a new swing while busy, unless recovering and allowed to cancel', () => {
    const a = new Attack('slash');
    a.start();
    expect(a.start(true)).toBe(false);
    while (a.phase !== 'recover') a.update(SIM_DT);
    expect(a.start()).toBe(false);
    expect(a.start(true)).toBe(true);
    expect(a.phase).toBe('wind');
  });

  it('continues exactly after save and load, the targets hit included', () => {
    const a = new Attack('spin');
    a.start();
    for (let i = 0; i < 12; i++) a.update(SIM_DT);
    a.hits(
      [{ id: 4 }],
      () => true,
      () => {},
    );
    const b = new Attack('spin').load(structuredClone(a.save()));
    for (let i = 0; i < 30; i++) {
      expect(b.update(SIM_DT)).toEqual(a.update(SIM_DT));
      expect(
        b.hits(
          [{ id: 4 }, { id: 6 }],
          () => true,
          () => {},
        ),
      ).toBe(
        a.hits(
          [{ id: 4 }, { id: 6 }],
          () => true,
          () => {},
        ),
      );
    }
    expect(b.save()).toEqual(a.save());
  });

  it('tells the body the move, phase and share while it plays', () => {
    const a = new Attack('overhead');
    expect(a.body).toBeUndefined();
    a.start();
    a.update(SIM_DT);
    expect(a.body).toEqual({ move: resolveMove('overhead'), phase: 'wind', u: SIM_DT / 0.16 });
  });
});

describe('Combo: chaining windows exact in ticks (WP 6.1 Done when)', () => {
  /** A hit of whole ticks: wind 6, active 6, recover 12; 24 ticks in all. */
  const even = { arc: [0, 0] as [number, number], time: { wind: 0.1, active: 0.1, recover: 0.2 } };

  /** After `n` steps of the first hit, presses again: returns the hit that plays (−1 refused). */
  function pressAfter(moves: readonly (string | typeof even)[], n: number, window = 0.3): number {
    const combo = new Combo(moves, { window });
    expect(combo.press()).toBe(true);
    for (let i = 0; i < n; i++) combo.update(SIM_DT);
    return combo.press() ? combo.step : -1;
  }

  it('refuses during the wind and the strike, chains in the recover and through the window, then starts over', () => {
    const moves = [even, even, even];
    for (let n = 0; n <= 50; n++) {
      const want = n < 12 ? -1 : n <= 24 + 18 ? 1 : 0;
      expect(pressAfter(moves, n), `press after ${n} steps`).toBe(want);
    }
  });

  it('counts the window from the moment the hit ended inside its step', () => {
    // the jab lasts 0.035 + 0.06 + 0.13 = 0.225 s, 13.5 ticks: a press chains while n / 60 ≤ 0.225 + 0.3
    const jab = 'jab';
    expect(pressAfter([jab, 'cross'], 31)).toBe(1);
    expect(pressAfter([jab, 'cross'], 32)).toBe(0);
    expect(pressAfter([jab, 'cross'], 31, 0)).toBe(0);
    expect(pressAfter([jab, 'cross'], 13, 0)).toBe(1); // still recovering
  });

  it('starts over after the last hit, and after a cancel', () => {
    const combo = new Combo(['jab', 'cross']);
    combo.press();
    for (let i = 0; i < 10; i++) combo.update(SIM_DT);
    expect([combo.press(), combo.step]).toEqual([true, 1]);
    for (let i = 0; i < 12; i++) combo.update(SIM_DT);
    expect([combo.press(), combo.step]).toEqual([true, 0]);
    combo.cancel();
    expect([combo.busy, combo.body, combo.press(), combo.step]).toEqual([false, undefined, true, 0]);
  });

  it('continues exactly after save and load', () => {
    const make = () => new Combo(['jab', 'cross', 'hook']);
    const a = make();
    a.press();
    for (let i = 0; i < 10; i++) a.update(SIM_DT);
    a.press();
    for (let i = 0; i < 3; i++) a.update(SIM_DT);
    const b = make().load(structuredClone(a.save()));
    for (let i = 0; i < 40; i++) {
      expect(b.update(SIM_DT)).toEqual(a.update(SIM_DT));
      if (i === 15) expect(b.press()).toBe(a.press());
    }
    expect(b.save()).toEqual(a.save());
  });
});
