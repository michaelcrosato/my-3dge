/**
 * @file Unit tests for the FNV-1a hash: the published test vectors, strings hashed as UTF-8, and continuation.
 */
import { describe, expect, it } from 'vitest';
import { fnv1a, fnv1aHex } from './hash';

describe('fnv1a', () => {
  it('matches the published 32-bit FNV-1a vectors', () => {
    expect(fnv1aHex('')).toBe('811c9dc5');
    expect(fnv1aHex('a')).toBe('e40c292c');
    expect(fnv1aHex('foobar')).toBe('bf9cf968');
    expect(fnv1aHex('hello')).toBe('4f9f2cab');
  });

  it('hashes a string as its UTF-8 bytes', () => {
    expect(fnv1a('héllo')).toBe(fnv1a(new TextEncoder().encode('héllo')));
    expect(fnv1a('héllo')).not.toBe(fnv1a('hello'));
  });

  it('continues from a seed, so a hash can be built in pieces', () => {
    expect(fnv1a('bar', fnv1a('foo'))).toBe(fnv1a('foobar'));
  });

  it('returns unsigned 32-bit integers', () => {
    for (const text of ['', 'x', 'spawn', 'ai', 'a much longer string with spaces']) {
      const hash = fnv1a(text);
      expect(Number.isInteger(hash) && hash >= 0 && hash < 2 ** 32).toBe(true);
    }
  });
});
