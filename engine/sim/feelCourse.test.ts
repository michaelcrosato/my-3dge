/**
 * @file Unit tests for the feel course's motion numbers (engine/sim/feelCourse.ts, PLAN.md WP 13.3's Done-when): under
 * `movement:apex` the feel meter's run, sprint, walk and crouch-walk speeds (armed and holstered), its acceleration,
 * sprint and stop times, the jump's height, a fatigued jump's, the air-strafe gain and the lurch match
 * docs/PLAYGROUND.md §3.2 within its tolerances (speeds ±2%, accelerations ±5%, times ±1 tick, heights ±2 cm); the
 * course runs holstered when asked; a platformer character's report has no motion part, and every number is the same
 * twice.
 * @see engine/sim/feelCourse.ts
 */
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../physics/character';
import { measureFeel } from './feelCourse';

const DT = 1 / 60;
const apex = measureFeel(createCharacter({ movement: 'movement:apex' }));
const motion = apex.motion!;

/** Expects `value` within `share` of `reference`. */
const within = (name: string, value: number, reference: number, share: number) =>
  expect(Math.abs(value - reference) / reference, `${name}: ${value} against ${reference}`).toBeLessThanOrEqual(share);

describe('the feel course under movement:apex', () => {
  it('runs, sprints, walks and crouch-walks at Apex’s speeds, armed and holstered (±2%)', () => {
    for (const [name, value, reference] of [
      ['run', motion.run, 4.41],
      ['sprint', motion.sprint, 6.6],
      ['walk', motion.walk, 2.2],
      ['crouch-walk', motion.crouch, 2.03],
      ['run holstered', motion.runHolstered, 5.07],
      ['sprint holstered', motion.sprintHolstered, 7.59],
      ['crouch-walk holstered', motion.crouchHolstered, 2.34],
    ] as const)
      within(name, value, reference, 0.02);
    expect(apex.topSpeed).toBeCloseTo(motion.run, 2);
    expect(measureFeel(createCharacter({ movement: 'movement:apex' }), { holstered: true }).topSpeed).toBeCloseTo(motion.runHolstered, 2); // prettier-ignore
  });

  it('takes the times the table’s accelerations give, within a tick: to the run, run to sprint, sprint to a stop', () => {
    const toRun = 3.048 / 63.5 + (0.9 * 4.4069 - 3.048) / 11.43; // 63.5 m/s² to 3.05 m/s, then 11.4 m/s²
    expect(Math.abs(motion.accelerationTime - toRun)).toBeLessThanOrEqual(DT);
    const pastRun = 3.175 + 7 * 11.43 * DT; // tick 10: the run's band overshoots the run, as R5Reloaded measured
    expect(Math.abs(motion.sprintTime - (6.604 - pastRun) / 2.54)).toBeLessThanOrEqual(DT); // 0.83 s
    expect(Math.abs(motion.stopTime - 6.604 / 31.75)).toBeLessThanOrEqual(DT); // about 0.21 s
  });

  it('jumps 1.42 m, 0.3 of that straight after landing from a jump (±2 cm)', () => {
    expect(Math.abs(apex.apex - 1.4224)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(motion.fatigueApex - 0.3 * 1.4224)).toBeLessThanOrEqual(0.02);
  });

  it('gains what Quake’s air acceleration gives strafing a sprint jump (±5%), and lurches 4.6 m/s (±2%)', () => {
    const ticks = Math.round(apex.airTime / DT) - 1;
    const sprint = motion.sprint;
    within('strafe gain', motion.strafeGain, Math.sqrt(sprint ** 2 + ticks * (12.7 * DT) ** 2) - sprint, 0.05);
    within('lurch', motion.lurch, 4.6, 0.02);
  });

  it('reports no motion for a platformer character, and the same numbers twice', () => {
    expect(measureFeel(createCharacter()).motion).toBeUndefined();
    expect(measureFeel(createCharacter({ movement: 'movement:apex' }))).toEqual(apex);
  });
});
