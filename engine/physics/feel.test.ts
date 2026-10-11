/**
 * @file Tests for the feel (engine/physics/feel.ts) and its course (`measureFeel`, engine/sim/actors.ts): the meter's
 * rules on made-up ticks (a run-up's top speed and acceleration, a stop, a turn, a jump from where it took off, hops
 * too short to count), `steer` counting coyote time and the buffer in ticks at any step rate, and WP 3.2's Done-when:
 * the meter reports every number for the box hero's settings, each where the settings put it.
 */
import { describe, expect, it } from 'vitest';
import { HERO } from '../../fixtures/scenes/steps';
import { measureFeel } from '../sim/actors';
import { createCharacter, createCharacterState } from './character';
import { createFeelMeter, steer, updateFeelMeter, type FeelReport, type FeelSample } from './feel';

/** A tick as the tests write it: plain lists for the vectors. */
type Loose = { wish?: number[]; velocity?: number[]; feet?: number[]; grounded?: boolean };

/** Feeds the meter one tick per sample; what a sample leaves out is still, on the ground, at the origin. */
function feed(meter: ReturnType<typeof createFeelMeter>, ticks: Loose[]) {
  let tick = 0;
  for (const sample of ticks) {
    updateFeelMeter(meter, {
      tick: ++tick,
      wish: [0, 0],
      velocity: [0, 0, 0],
      feet: [0, 0, 0],
      grounded: true,
      ...(sample as Partial<FeelSample>),
    });
  }
}

describe('the feel meter', () => {
  it('measures a run-up, a stop and a turn by its rules', () => {
    const meter = createFeelMeter(1 / 60);
    const run = Array.from({ length: 30 }, (_, i) => ({ wish: [1, 0], velocity: [Math.min(6, (i + 1) * 0.75), 0, 0] }));
    const stop = Array.from({ length: 12 }, (_, i) => ({
      velocity: [Math.max(0, 6 - (i + 1) * 0.6), 0, 0],
      feet: [i * 0.05, 0, 0],
    }));
    const turn = Array.from({ length: 20 }, (_, i) => ({ wish: [-1, 0], velocity: [6 - (i + 1) * 1.5, 0, 0] }));
    feed(meter, [...run, ...stop, ...run, ...turn]);
    expect(meter.report).toMatchObject({ responseTicks: 0, topSpeed: 6 });
    expect(meter.report.accelerationTime).toBeCloseTo(8 / 60, 9); // 0.75 m/s a tick: 90% of 6 on the 8th
    expect(meter.report.stopTime).toBeCloseTo(9 / 60, 9); // from the first tick let go (5.4 m/s) to 0 m/s, 9 ticks on
    expect(meter.report.stopDistance).toBeCloseTo(0.45, 9);
    expect(meter.report.turnTime).toBeCloseTo(6 / 60, 9); // 4.5 m/s on the first tick reversed, −4.05 six ticks on
  });

  it('measures a jump from where it took off, and lets hops shorter than 120 ms go', () => {
    const meter = createFeelMeter(1 / 60);
    const arc = Array.from({ length: 30 }, (_, i) => ({
      feet: [i * 0.1, 3 * Math.sin((Math.PI * (i + 1)) / 31), 0],
      grounded: false,
    }));
    feed(meter, [{ feet: [-0.1, 0, 0] }, ...arc, { feet: [3, 0, 0] }]);
    expect(meter.report.apex).toBeCloseTo(3 * Math.sin((Math.PI * 15) / 31), 9);
    expect(meter.report.airTime).toBeCloseTo(31 / 60, 9);
    expect(meter.report.jumpDistance).toBeCloseTo(3.1, 9);
    feed(meter, [{ feet: [0, 0.1, 0], grounded: false }, { feet: [0, 0.2, 0], grounded: false }, {}]);
    expect(meter.report.apex).toBeCloseTo(3 * Math.sin((Math.PI * 15) / 31), 9);
  });
});

describe('steer', () => {
  it('counts coyote time and the jump buffer in whole ticks at any step rate', () => {
    for (const hz of [30, 60, 120]) {
      const character = createCharacter();
      const coyote = Math.round(character.feel.coyote * hz);
      const jumps = (air: number) => {
        const state = { ...createCharacterState(), grounded: false, air };
        return steer(character, state, { jumpPressed: true, jump: true }, 1 / hz, 32).jumped;
      };
      expect(jumps(coyote), `${hz} Hz`).toBe(true);
      expect(jumps(coyote + 1), `${hz} Hz`).toBe(false);
      const buffer = Math.round(character.feel.buffer * hz);
      const state = { ...createCharacterState(), grounded: false, air: 100 };
      steer(character, state, { jumpPressed: true, jump: true }, 1 / hz, 32);
      for (let i = 0; i < buffer; i++) steer(character, state, { jump: true }, 1 / hz, 32);
      expect(state.jumpAge, `${hz} Hz`).toBe(buffer);
      steer(character, state, { jump: true }, 1 / hz, 32);
      expect(state.jumpAge, `${hz} Hz`).toBe(-1);
    }
  });
});

describe('measureFeel', () => {
  it('reports every number for the box hero’s settings, each where its settings put it', () => {
    const feel: FeelReport = measureFeel(HERO);
    for (const [name, value] of Object.entries(feel)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(name === 'responseTicks' ? 0 : 1e-3);
    }
    const g = HERO.characterGravity!;
    expect(feel.responseTicks).toBe(0);
    expect(feel.topSpeed).toBeCloseTo(HERO.speed, 9);
    expect(feel.accelerationTime).toBeCloseTo(Math.ceil((0.9 * HERO.speed) / (HERO.acceleration / 60)) / 60, 9);
    expect(Math.abs(feel.stopTime - HERO.speed / HERO.deceleration)).toBeLessThan(2 / 60);
    expect(Math.abs(feel.turnTime - (1.9 * HERO.speed) / HERO.skid)).toBeLessThan(2 / 60);
    expect(Math.abs(feel.apex - HERO.jumpSpeed ** 2 / (2 * g))).toBeLessThan(0.02);
    expect(Math.abs(feel.airTime - (2 * HERO.jumpSpeed) / g)).toBeLessThan(1.5 / 60);
    expect(Math.abs(feel.jumpDistance - HERO.speed * feel.airTime)).toBeLessThan(0.05);
    expect(feel.reach).toBeGreaterThan(feel.apex);
    expect(feel.reach).toBeLessThan(feel.apex + 0.2);
    expect(Math.abs(feel.dashDistance - HERO.feel.dash.speed * HERO.feel.dash.duration)).toBeLessThan(0.02);
  });

  it('follows the settings: a heavier gravity jumps lower, a character without a dash dashes nowhere', () => {
    const light = measureFeel(createCharacter(), { gravity: 32 });
    const heavy = measureFeel(createCharacter({ characterGravity: 64 }), { gravity: 32 });
    expect(heavy.apex).toBeCloseTo(light.apex / 2, 1);
    expect(measureFeel(createCharacter({ feel: { dash: { speed: 0 } } })).dashDistance).toBe(0);
    expect(measureFeel(createCharacter(), { hz: 120 }).apex).toBeCloseTo(light.apex, 2);
  });
});
