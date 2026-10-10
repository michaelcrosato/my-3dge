/**
 * @file Unit tests for engine/core/events.ts (T1): listeners in order, `off`, `once` and the remover, changes during an
 * emit, a throwing listener isolated and recorded in the log's errors, scopes and child scopes disposed together, and
 * the trace ring.
 * @see engine/core/events.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvents } from './events';
import { createLog, log, type LogConsole } from './log';

type Demo = { hit: { damage: number }; end: string };

/** A log that records instead of printing. */
function quietLog() {
  const printed: unknown[][] = [];
  const out: LogConsole = { warn: () => {}, error: (...args) => printed.push(args) };
  return { log: createLog({ console: out }), printed };
}

afterEach(() => vi.restoreAllMocks());

describe('on, once, off and emit', () => {
  it('calls listeners in the order they were added, with the payload, and returns how many ran', () => {
    const events = createEvents<Demo>();
    const seen: string[] = [];
    events.on('hit', (hit) => seen.push(`a${hit.damage}`));
    events.on('hit', (hit) => seen.push(`b${hit.damage}`));
    expect(events.emit('hit', { damage: 3 })).toBe(2);
    expect(events.emit('end', 'done')).toBe(0);
    expect(seen).toEqual(['a3', 'b3']);
  });

  it('removes listeners with off and with the returned remover; once runs a single time', () => {
    const events = createEvents<Demo>();
    const seen: number[] = [];
    const a = (hit: { damage: number }) => seen.push(hit.damage);
    events.on('hit', a);
    const removeB = events.on('hit', (hit) => seen.push(hit.damage * 10));
    events.once('hit', (hit) => seen.push(hit.damage * 100));
    events.emit('hit', { damage: 1 });
    events.off('hit', a);
    removeB();
    events.emit('hit', { damage: 2 });
    events.off('end', a as never);
    expect(seen).toEqual([1, 10, 100]);
  });

  it('removes every registration of a listener added twice with one off', () => {
    const events = createEvents<Demo>();
    const seen: number[] = [];
    const a = (hit: { damage: number }) => seen.push(hit.damage);
    events.on('hit', a);
    events.on('hit', a);
    events.emit('hit', { damage: 1 });
    events.off('hit', a);
    expect(events.emit('hit', { damage: 2 })).toBe(0);
    expect(seen).toEqual([1, 1]);
  });

  it('runs a listener added during an emit from the next emit, and skips one removed during it', () => {
    const events = createEvents<Demo>();
    const seen: string[] = [];
    let removeLate = () => {};
    events.on('hit', () => {
      seen.push('first');
      events.on('hit', () => seen.push('added'));
      removeLate();
    });
    removeLate = events.on('hit', () => seen.push('late'));
    events.emit('hit', { damage: 0 });
    expect(seen).toEqual(['first']);
    events.emit('hit', { damage: 0 });
    expect(seen).toEqual(['first', 'first', 'added']);
  });
});

describe('isolation', () => {
  it("records a throwing listener in the log's errors and still runs the others", () => {
    const { log: quiet, printed } = quietLog();
    const events = createEvents<Demo>({ log: quiet });
    const seen: string[] = [];
    const boom = new Error('no target');
    events.on('hit', () => seen.push('before'));
    events.on('hit', () => {
      throw boom;
    });
    events.on('hit', () => seen.push('after'));
    expect(events.emit('hit', { damage: 1 })).toBe(3);
    events.emit('hit', { damage: 1 });
    expect(seen).toEqual(['before', 'after', 'before', 'after']);
    expect(quiet.errors).toEqual([
      expect.objectContaining({
        code: 'CORE_LISTENER_FAILED',
        message: 'a listener of hit threw: no target',
        values: { type: 'hit', error: 'no target' },
        count: 2,
        cause: expect.objectContaining({ name: 'Error', message: 'no target' }),
      }),
    ]);
    expect(printed).toEqual([[expect.stringMatching(/^\[CORE_LISTENER_FAILED\] a listener of hit threw/), boom]]);
    expect(events.trace().map((record) => record.failed)).toEqual([1, 1]);
  });

  it('records into the shared log by default', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = createEvents();
    events.on('tick', () => {
      throw 'a string';
    });
    events.emit('tick', null);
    expect(log.errors.at(-1)).toMatchObject({
      code: 'CORE_LISTENER_FAILED',
      message: 'a listener of tick threw: a string',
    });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('scopes', () => {
  it('removes every listener of a scope and of its children together', () => {
    const events = createEvents<Demo>();
    const seen: string[] = [];
    events.on('hit', () => seen.push('global'));
    const level = events.scope('level');
    level.on('hit', () => seen.push('level'));
    level.once('end', () => seen.push('level end'));
    const room = level.scope('room');
    room.on('hit', () => seen.push('room'));
    events.emit('hit', { damage: 0 });
    level.dispose();
    events.emit('hit', { damage: 0 });
    events.emit('end', 'x');
    expect(seen).toEqual(['global', 'level', 'room', 'global']);
    expect([level.disposed, room.disposed, level.label, room.label]).toEqual([true, true, 'level', 'room']);
    level.dispose();
  });

  it('disposes a child alone, keeps the remover working, and refuses listeners after disposal', () => {
    const events = createEvents<Demo>();
    const seen: string[] = [];
    const level = events.scope('level');
    const removeA = level.on('hit', () => seen.push('a'));
    level.on('hit', () => seen.push('b'));
    const room = level.scope('room');
    room.on('hit', () => seen.push('room'));
    room.dispose();
    removeA();
    events.emit('hit', { damage: 0 });
    expect(seen).toEqual(['b']);
    expect(() => room.on('hit', () => {})).toThrow(
      /\[CORE_SCOPE_DISPOSED\] the scope "room" is disposed; it takes no new listeners/,
    );
    level.dispose();
    expect(() => level.scope()).toThrow(/CORE_SCOPE_DISPOSED/);
  });
});

describe('trace', () => {
  it('keeps the latest emits, oldest first, with their payloads and counts', () => {
    const events = createEvents<Demo>({ traceSize: 2 });
    events.on('hit', () => {});
    events.emit('hit', { damage: 1 });
    events.emit('end', 'a');
    events.emit('hit', { damage: 2 });
    expect(events.trace()).toEqual([
      { seq: 2, type: 'end', payload: 'a', listeners: 0, failed: 0 },
      { seq: 3, type: 'hit', payload: { damage: 2 }, listeners: 1, failed: 0 },
    ]);
    const silent = createEvents({ traceSize: 0 });
    silent.emit('x', 1);
    expect(silent.trace()).toEqual([]);
  });
});
