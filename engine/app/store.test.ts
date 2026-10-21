/**
 * @file Unit tests for engine/app/store.ts (T1, PLAN.md WP 10.9's Done-when: "the store is unit-tested"): values kept
 * as copies in their envelope under the prefix; another version falls back with advice once, or migrates and is
 * written back; unreadable values fall back; a refused write returns false and refused storage reads as memory with
 * advice; the isolated modes keep nothing past the page; only the prefix's keys are listed and cleared; bad options,
 * keys and values are coded errors.
 * @see engine/app/store.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createStore, memoryBackend, STORE_FORMAT, type StoreBackend } from './store';

/** A log that keeps its records, printing nothing. */
const quiet = () => createLog({ console: { warn: () => {}, error: () => {} } });

describe('the store', () => {
  it('keeps plain data as copies, in its envelope, under its prefix', () => {
    const backend = memoryBackend();
    const store = createStore({ prefix: 'game:', backend });
    const best = { seconds: 12.5, seed: 3 };
    expect(store.set('best', best)).toBe(true);
    best.seconds = 1;
    const read = store.get('best', null) as { seconds: number } | null;
    expect(read).toEqual({ seconds: 12.5, seed: 3 });
    read!.seconds = 2;
    expect(store.get('best', null)).toEqual({ seconds: 12.5, seed: 3 });
    expect(JSON.parse(backend.getItem('game:best')!)).toEqual({ format: STORE_FORMAT, version: 1, data: { seconds: 12.5, seed: 3 } }); // prettier-ignore
    expect([store.get('missing', 'none'), store.persistent, store.mode]).toEqual(['none', true, 'play']);
  });

  it('falls back on another version with advice once, or migrates it and writes it back', () => {
    const backend = memoryBackend();
    createStore({ prefix: 'game:', backend }).set('best', 30);
    const log = quiet();
    const next = createStore({ prefix: 'game:', version: 2, backend, log });
    expect([next.get('best', null), next.get('best', null)]).toEqual([null, null]);
    expect(log.advice.map((record) => record.code)).toEqual(['APP_STORE_VERSION']);
    expect(log.advice[0].count).toBe(2);
    const migrating = createStore({ prefix: 'game:', version: 2, backend, migrate: (data) => ({ seconds: data }) });
    expect(migrating.get('best', null)).toEqual({ seconds: 30 });
    expect(JSON.parse(backend.getItem('game:best')!).version).toBe(2);
    backend.setItem('game:raw', 'not json');
    backend.setItem('game:bare', '7');
    expect([next.get('raw', 'fallback'), next.get('bare', 'fallback')]).toEqual(['fallback', 'fallback']);
  });

  it('never throws on storage: a refused write is false, refused storage is memory with advice', () => {
    const full: StoreBackend = { ...memoryBackend(), setItem: () => { throw new Error('QuotaExceededError'); } }; // prettier-ignore
    expect(createStore({ backend: full }).set('k', 1)).toBe(false);
    const log = quiet();
    const page = globalThis as { localStorage?: unknown };
    const before = page.localStorage;
    page.localStorage = { setItem: () => { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); } }; // prettier-ignore
    try {
      const store = createStore({ prefix: 'blocked:', log });
      expect([store.persistent, store.set('k', 1), store.get('k', 0)]).toEqual([false, true, 1]);
      expect(log.advice.map((record) => record.message)).toEqual([expect.stringContaining('SecurityError')]);
    } finally {
      page.localStorage = before;
    }
    expect(createStore().persistent).toBe(false); // Node: no localStorage, memory, no advice
  });

  it('keeps nothing past the page in the demo, sandbox and gallery modes', () => {
    const backend = memoryBackend();
    createStore({ prefix: 'game:', backend }).set('best', 9);
    for (const mode of ['demo', 'sandbox', 'gallery'] as const) {
      const store = createStore({ prefix: 'game:', backend, mode });
      expect([store.persistent, store.get('best', null)]).toEqual([false, null]); // starts empty
      store.set('best', 1);
    }
    expect(createStore({ prefix: 'game:', backend }).get('best', null)).toBe(9); // the player's own, untouched
  });

  it('lists and clears only its own keys, and refuses bad options, keys and values', () => {
    const backend = memoryBackend();
    backend.setItem('other:x', '1');
    const store = createStore({ prefix: 'game:', backend });
    store.set('b', 2);
    store.set('a', 1);
    expect(store.keys()).toEqual(['a', 'b']);
    store.remove('a');
    store.clear();
    expect([store.keys(), backend.getItem('other:x')]).toEqual([[], '1']);
    expect(() => createStore({ prefix: '' })).toThrow(/APP_BAD_STORE/);
    expect(() => createStore({ version: 0 })).toThrow(/whole number from 1/);
    expect(() => createStore({ mode: 'replay' as never })).toThrow(/play, demo, sandbox, gallery/);
    expect(() => store.get('', 0)).toThrow(/key/);
    expect(() => store.set('f', () => 1)).toThrow(/not plain data/);
  });
});
