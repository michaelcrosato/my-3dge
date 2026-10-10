/**
 * @file Unit tests for engine/sim/systems.ts (T1): systems run by phase, then in the order added; `list()` is a
 * snapshot; bad names, runs, phases and removals throw `SIM_BAD_SYSTEM`; `STEP_ORDER` holds every phase in order.
 * @see engine/sim/systems.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { createSystems, PHASES, phaseIndex, STEP_ORDER, type Phase } from './systems';

/** The code of the EngineError `fn` throws. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  throw new Error('expected an EngineError');
}

describe('the schedule', () => {
  it('orders systems by phase, then by the order they were added', () => {
    const systems = createSystems<string[]>();
    const add = (name: string, phase?: Phase) => systems.add(name, (log) => log.push(name), { phase });
    add('score');
    add('steer', 'ai');
    add('read', 'intents');
    add('think', 'ai');
    add('settle', 'readback');
    add('hit');
    const log: string[] = [];
    for (const system of systems.list()) system.run(log, {});
    expect(log).toEqual(['read', 'steer', 'think', 'settle', 'score', 'hit']);
    expect(systems.list().map((system) => system.phase)).toEqual(['intents', 'ai', 'ai', 'readback', 'rules', 'rules']);
  });

  it('hands out snapshots, so a change during a step waits for the next', () => {
    const systems = createSystems<null>();
    systems.add('a', () => {});
    const before = systems.list();
    systems.add('b', () => {});
    systems.remove('a');
    expect(before.map((system) => system.name)).toEqual(['a']);
    expect(systems.list().map((system) => system.name)).toEqual(['b']);
    expect(systems.has('a')).toBe(false);
    expect(Object.isFrozen(systems.list()[0])).toBe(true);
  });

  it('refuses empty and duplicate names, non-functions, unknown phases and unknown removals', () => {
    const systems = createSystems<null>();
    systems.add('move', () => {});
    expect(codeOf(() => systems.add('', () => {}))).toBe('SIM_BAD_SYSTEM');
    expect(codeOf(() => systems.add('move', () => {}))).toBe('SIM_BAD_SYSTEM');
    expect(codeOf(() => systems.add('jump', 3 as never))).toBe('SIM_BAD_SYSTEM');
    expect(() => systems.add('jump', () => {}, { phase: 'rule' as Phase })).toThrow(/did you mean "rules"/);
    expect(() => systems.remove('mvoe')).toThrow(/did you mean "move"/);
  });

  it('lists every phase in STEP_ORDER, in order, with the timers just before rules', () => {
    const at = PHASES.map((phase) => STEP_ORDER.indexOf(phase));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(STEP_ORDER.indexOf('timers')).toBe(STEP_ORDER.indexOf('rules') - 1);
    expect(STEP_ORDER.slice(-3)).toEqual(['spawns', 'despawns', 'events']);
    expect(PHASES.map(phaseIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
