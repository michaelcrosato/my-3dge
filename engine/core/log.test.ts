/**
 * @file Unit tests for engine/core/log.ts (T1): codes registered by `defineCodes` (and refused when malformed or
 * registered again with other text), templates filled, `EngineError`'s `[CODE] message: fix` form, the closest-name
 * suggestions, warn-once advice in the advice trap's format, and structured error records.
 * @see engine/core/log.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADVICE_CODE } from '../../tests/setup/adviceTrap';
import {
  closest,
  codeError,
  codeInfo,
  createLog,
  defineCodes,
  didYouMean,
  EngineError,
  fill,
  listCodes,
  log,
  type LogConsole,
} from './log';

const CODES = defineCodes('test', {
  TEST_SLOW: { template: '{what} took {ms} ms', fix: 'cache {what}', doc: 'A fixture code.' },
  TEST_GONE: { template: 'the {thing} is gone', fix: 'make another {thing}' },
});

/** A console that records what it was given. */
function recorder(): LogConsole & { warned: string[]; errored: unknown[][] } {
  const warned: string[] = [];
  const errored: unknown[][] = [];
  return { warned, errored, warn: (line) => warned.push(line), error: (...args) => errored.push(args) };
}

afterEach(() => vi.restoreAllMocks());

describe('defineCodes', () => {
  it('returns the table as given and registers each code with its area', () => {
    expect(CODES.TEST_SLOW.fix).toBe('cache {what}');
    expect(codeInfo('TEST_GONE')).toEqual({
      code: 'TEST_GONE',
      area: 'test',
      template: 'the {thing} is gone',
      fix: 'make another {thing}',
    });
    const names = listCodes().map((info) => info.code);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(['TEST_SLOW', 'CORE_BAD_CODE', 'CORE_UNKNOWN_CODE']));
  });

  it('accepts the same text twice (a module evaluated again) and refuses other text', () => {
    expect(() =>
      defineCodes('test', { TEST_GONE: { template: 'the {thing} is gone', fix: 'make another {thing}' } }),
    ).not.toThrow();
    expect(() => defineCodes('test', { TEST_GONE: { template: 'changed', fix: 'make another {thing}' } })).toThrow(
      /\[CORE_BAD_CODE\] the code TEST_GONE is already registered with other text/,
    );
  });

  it('refuses a malformed area, a code outside its area, and a missing template or fix', () => {
    expect(() => defineCodes('Test', {})).toThrow(/CORE_BAD_CODE.*one lower-case word/);
    expect(() => defineCodes('test', { CORE_X: { template: 't', fix: 'f' } })).toThrow(/starting with TEST_/);
    expect(() => defineCodes('test', { TEST_EMPTY: { template: 't', fix: ' ' } })).toThrow(
      /needs a template and a fix/,
    );
    expect(codeInfo('TEST_EMPTY')).toBeUndefined();
  });
});

describe('fill and EngineError', () => {
  it('fills {name} markers and leaves a marker without a value', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('throws "[CODE] message: fix" with the code, area, fix, values and cause', () => {
    const cause = new Error('disk full');
    const error = codeError('TEST_SLOW', { what: 'the bake', ms: 40 }, cause);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.message).toBe('[TEST_SLOW] the bake took 40 ms: cache the bake');
    expect(ADVICE_CODE.exec(error.message)?.[1]).toBe('TEST_SLOW');
    expect(error).toMatchObject({ code: 'TEST_SLOW', area: 'test', fix: 'cache the bake', values: { ms: 40 } });
    expect(error.cause).toBe(cause);
  });

  it('refuses a code nobody registered, naming the closest', () => {
    expect(() => codeError('TEST_SLWO')).toThrow(
      /\[CORE_UNKNOWN_CODE\] no module registered the code TEST_SLWO \(did you mean "TEST_SLOW"\?\)/,
    );
  });
});

describe('closest and didYouMean', () => {
  it('ranks an exact match, then prefixes and dotted suffixes, then near spellings', () => {
    expect(closest('Crowd', ['crowd', 'cloud', 'crows'])).toEqual(['crowd', 'crows']);
    expect(closest('runSpeed', ['hero.runSpeed', 'gravity'])).toEqual(['hero.runSpeed']);
    expect(closest('min', ['minimum', 'maximum'])).toEqual(['minimum']);
    expect(closest('prop:crat', ['prop:crate', 'prop:barrel'])).toEqual(['prop:crate']);
    expect(closest('zzz', ['crowd'])).toEqual([]);
  });

  it('writes the suggestion clause, or nothing when no name is close', () => {
    expect(didYouMean('crwd', ['crowd'])).toBe(' (did you mean "crowd"?)');
    expect(didYouMean('ab', ['abc', 'abd', 'abe'])).toBe(' (did you mean "abc", "abd" or "abe"?)');
    expect(didYouMean('zzz', ['crowd'])).toBe('');
  });
});

describe('createLog', () => {
  it('prints advice once per distinct message, in the trap format, and counts the repeats', () => {
    const out = recorder();
    const quiet = createLog({ console: out });
    expect(quiet.warnOnce('TEST_SLOW', { what: 'a', ms: 1 })).toBe(true);
    expect(quiet.warnOnce('TEST_SLOW', { what: 'a', ms: 1 })).toBe(false);
    expect(quiet.warnOnce('TEST_SLOW', { what: 'b', ms: 1 })).toBe(true);
    expect(out.warned).toEqual(['[TEST_SLOW] a took 1 ms: cache a', '[TEST_SLOW] b took 1 ms: cache b']);
    expect(out.warned.map((line) => ADVICE_CODE.exec(line)?.[1])).toEqual(['TEST_SLOW', 'TEST_SLOW']);
    expect(quiet.advice).toEqual([
      { code: 'TEST_SLOW', message: 'a took 1 ms', fix: 'cache a', count: 2 },
      { code: 'TEST_SLOW', message: 'b took 1 ms', fix: 'cache b', count: 1 },
    ]);
    quiet.clear();
    expect(quiet.advice).toEqual([]);
    expect(quiet.warnOnce('TEST_SLOW', { what: 'a', ms: 1 })).toBe(true);
  });

  it('records every error, prints each distinct one once, keeps its cause, and caps the records', () => {
    const out = recorder();
    const quiet = createLog({ console: out, maxErrors: 2 });
    const thrown = new TypeError('bad');
    const first = quiet.error('TEST_GONE', { thing: 'door' }, thrown);
    quiet.error('TEST_GONE', { thing: 'door' });
    expect(first).toMatchObject({ code: 'TEST_GONE', message: 'the door is gone', fix: 'make another door', count: 2 });
    expect(first.cause).toMatchObject({ name: 'TypeError', message: 'bad' });
    expect(out.errored).toEqual([['[TEST_GONE] the door is gone: make another door', thrown]]);
    quiet.error('TEST_GONE', { thing: 'key' });
    quiet.error('TEST_GONE', { thing: 'map' });
    expect(quiet.errors.map((record) => record.message)).toEqual(['the key is gone', 'the map is gone']);
    expect(quiet.error('TEST_GONE', {}, 'a string').cause).toEqual({ name: 'string', message: 'a string' });
  });

  it('refuses an unregistered code', () => {
    expect(() => createLog({ console: recorder() }).warnOnce('TEST_NOPE')).toThrow(/CORE_UNKNOWN_CODE/);
  });

  it('prints through console.warn by default (the shared log)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warnOnce('TEST_SLOW', { what: 'the shared log', ms: 2 });
    expect(warn).toHaveBeenCalledWith('[TEST_SLOW] the shared log took 2 ms: cache the shared log');
    expect(log.advice.at(-1)?.code).toBe('TEST_SLOW');
  });
});
