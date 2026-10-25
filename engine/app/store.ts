/**
 * @file The store (PLAN.md WP 10.9, §9.1, ADR-0024): what a game keeps across sessions, outside the sim (high scores,
 * progress, its settings). `createStore({ prefix, version, mode, backend, migrate })` reads and writes plain data as
 * JSON under `prefix + key` in the page's `localStorage`, else in memory: in Node, where the page blocks storage
 * (advice `APP_STORE_BLOCKED`, once), and in the modes that must leave a player's saves alone, `demo` (a replay or an
 * attract loop), `sandbox` (a developer's throwaway play) and `gallery` (sheets and shots): their memory starts empty
 * and dies with the page, so what they play is never kept over what the player played.
 *
 * Every value is written in its envelope, `{ format: 'my3dge-store/1', version, data }`, and checked when read (shardfall
 * writes a version and never checks it): a value of another format or version is not handed back as it is. With
 * `migrate(data, version)` the store makes it the current version (and writes it back); without, the reader gets its
 * fallback, the value stays until `set` replaces it, and the advice `APP_STORE_VERSION` names the key once.
 *
 * Invariants: storage never throws here (a full or refused write returns false; a value that is not JSON reads as its
 * fallback); values go in and come out as copies (JSON), so a caller's object never aliases the store's; only keys
 * under the prefix are listed or cleared, so games and pages sharing an origin keep apart (pick a prefix of the game's
 * own, `my3dge-game:`). Sim-side code cannot import the app layer, so the sim never reads a store and nothing kept can
 * change a replay. Carried from `my-3d2dge:engine/my-3d2dge.js:196-200` (`store`: get with a fallback, set, remove,
 * never throwing), the fixed `my3d2dge:` prefix made the store's own.
 *
 * @example
 * import { createLog } from '../core/log';
 * const store = createStore({ prefix: 'demo-game:', backend: memoryBackend() });
 * store.set('best', { seconds: 12.5 }); // true
 * store.get('best', null); // { seconds: 12.5 }: a copy
 * const log = createLog({ console: { warn: () => {}, error: () => {} } }); // advice kept, not printed
 * const next = createStore({ prefix: 'demo-game:', version: 2, backend: store.backend, log });
 * next.get('best', null); // null: written at version 1, until migrate or set
 * log.advice[0].code; // 'APP_STORE_VERSION'
 * createStore({ mode: 'demo' }).persistent; // false: a replay's play is never kept
 * @see engine/app/store.test.ts
 */
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import { isPlainObject, show } from '../core/schema';

/** The codes this module raises, with their fixes. */
export const STORE_CODES = defineCodes('app', {
  APP_STORE_VERSION: {
    template: 'the store {prefix} holds {key} at {found}; this game reads version {version}',
    fix: 'give createStore a migrate(data, version) that turns the old value into the current one, or let the reader fall back to its default (the old value stays until set replaces it)',
    doc: 'Advice from the store (engine/app/store.ts), once per key: a kept value written in another format or version is not handed back as it is.',
  },
  APP_STORE_BLOCKED: {
    template:
      'the page refused its storage ({reason}), so the store {prefix} keeps its values in memory for this page only',
    fix: "allow the site's storage (a private window or a blocked cookie setting refuses it); the game still runs, and forgets on reload",
    doc: 'Advice from the store (engine/app/store.ts), once: `localStorage` threw when touched, so nothing is kept across sessions.',
  },
  APP_BAD_STORE: {
    template: '{where}: {problem}',
    fix: 'give a prefix and keys as non-empty strings, a version as a whole number from 1, a mode of play, demo, sandbox or gallery, and values that are plain data (JSON)',
    doc: 'Raised by the store (engine/app/store.ts) for a bad option, key or value; storage itself never makes it throw.',
  },
});

/** The envelope's format tag. */
export const STORE_FORMAT = 'my3dge-store/1';

/** Whose play a store keeps: `play` the player's; the others keep nothing past the page (see the file comment). */
export const STORE_MODES = ['play', 'demo', 'sandbox', 'gallery'] as const;

/** One of `STORE_MODES`: whose play a store keeps. */
export type StoreMode = (typeof STORE_MODES)[number];

/** Where a store writes: the Web Storage calls it uses (`localStorage` is one). */
export interface StoreBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** How a store is made (see the file comment). */
export interface StoreOptions {
  /** Put before every key (`my3dge:`): the game's own keeps games on one origin apart. */
  prefix?: string;
  /** The values' version (1); a value of another is migrated or falls back. */
  version?: number;
  /** Whose play it keeps (`play`). */
  mode?: StoreMode;
  /** Where it writes: the page's `localStorage` by default (memory without one). */
  backend?: StoreBackend;
  /** Turns a value kept at `version` into the current one. */
  migrate?(data: unknown, version: number): unknown;
  /** Where the advice goes (the shared log). */
  log?: Log;
}

/** A store (see the file comment). */
export interface Store {
  readonly prefix: string;
  readonly version: number;
  readonly mode: StoreMode;
  /** Whether values outlive the page (`play` on a working `localStorage`). */
  readonly persistent: boolean;
  /** Where it writes. */
  readonly backend: StoreBackend;
  /** The value kept under `key`, copied, or `fallback` (none kept, unreadable, or of another version unmigrated). */
  get<T>(key: string, fallback: T): T;
  /** Keeps `value` (plain data) under `key`; false when storage refused it. Throws `APP_BAD_STORE` for a bad value. */
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
  /** This store's keys, prefix off, sorted. */
  keys(): string[];
  /** Removes every key under the prefix. */
  clear(): void;
}

/** A backend in memory: what Node, refused storage and the isolated modes write to. */
export function memoryBackend(): StoreBackend {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

/**
 * The store as the two string calls of `localStorage` (`getItem`, `setItem`), for a module that saves text of its own:
 * the bindings (engine/input/bindings.ts), which the engine saves through the page's store (`createEngine({ store })`).
 * Each text is kept as its JSON value in the store's envelope, so the store's prefix and mode hold for it; text that is
 * not JSON is not kept, as a refused write.
 */
export function textStorage(store: Store): {
  getItem(key: string): string | null;
  setItem(key: string, text: string): void;
} {
  return {
    getItem: (key) => {
      const value = store.get<unknown>(key, null);
      return value === null ? null : JSON.stringify(value);
    },
    setItem: (key, text) => {
      try {
        store.set(key, JSON.parse(text));
      } catch {
        // not JSON: not kept
      }
    },
  };
}

/** The page's `localStorage`, or why it cannot be had. */
function pageStorage(): StoreBackend | string {
  try {
    const storage = (globalThis as { localStorage?: StoreBackend }).localStorage;
    if (!storage) return 'none in this runtime';
    const probe = '__my3dge_store_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

/** Makes a store (see the file comment). Throws `APP_BAD_STORE` for a bad option. */
export function createStore(options: StoreOptions = {}): Store {
  const { prefix = 'my3dge:', version = 1, mode = 'play' } = options;
  const log = options.log ?? sharedLog;
  const bad = (where: string, problem: string) => codeError('APP_BAD_STORE', { where, problem });
  if (typeof prefix !== 'string' || !prefix) throw bad('createStore({ prefix })', `${show(prefix)} is not a non-empty string`); // prettier-ignore
  if (!Number.isInteger(version) || version < 1) throw bad('createStore({ version })', `${show(version)} is not a whole number from 1`); // prettier-ignore
  if (!STORE_MODES.includes(mode)) throw bad('createStore({ mode })', `${show(mode)} is not one of ${STORE_MODES.join(', ')}`); // prettier-ignore
  let backend: StoreBackend;
  let persistent = false;
  if (mode !== 'play') backend = memoryBackend();
  else if (options.backend) [backend, persistent] = [options.backend, true];
  else {
    const page = pageStorage();
    if (typeof page === 'string') {
      if (page !== 'none in this runtime') log.warnOnce('APP_STORE_BLOCKED', { reason: page, prefix }, prefix);
      backend = memoryBackend();
    } else [backend, persistent] = [page, true];
  }
  const checkKey = (where: string, key: unknown) => {
    if (typeof key !== 'string' || !key) throw bad(where, `the key ${show(key)} is not a non-empty string`);
  };
  /** Writes `data` in its envelope; false when storage refused it. */
  const write = (key: string, data: unknown) => {
    try {
      backend.setItem(prefix + key, JSON.stringify({ format: STORE_FORMAT, version, data }));
      return true;
    } catch {
      return false;
    }
  };
  const own = () => {
    const out: string[] = [];
    try {
      for (let i = 0; i < backend.length; i++) {
        const key = backend.key(i);
        if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
    } catch {
      return [];
    }
    return out.sort();
  };
  return {
    prefix,
    version,
    mode,
    persistent,
    backend,
    get<T>(key: string, fallback: T): T {
      checkKey('store.get(key)', key);
      let kept: unknown;
      try {
        const text = backend.getItem(prefix + key);
        if (text === null) return fallback;
        kept = JSON.parse(text);
      } catch {
        return fallback;
      }
      const env = isPlainObject(kept) ? (kept as { format?: unknown; version?: unknown; data?: unknown }) : null;
      const at = env && env.format === STORE_FORMAT && Number.isInteger(env.version) ? (env.version as number) : null;
      if (at === version) return structuredClone(env!.data) as T;
      const found = at === null ? 'no envelope of my3dge-store/1' : `version ${at}`;
      if (options.migrate && at !== null) {
        const data = options.migrate(structuredClone(env!.data), at);
        write(key, data);
        return structuredClone(data) as T;
      }
      log.warnOnce('APP_STORE_VERSION', { prefix, key, found, version }, `${prefix}${key}`);
      return fallback;
    },
    set(key, value) {
      checkKey('store.set(key)', key);
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        text = undefined;
      }
      if (text === undefined) throw bad(`store.set(${show(key)})`, 'the value is not plain data (JSON)');
      return write(key, JSON.parse(text));
    },
    remove(key) {
      checkKey('store.remove(key)', key);
      try {
        backend.removeItem(prefix + key);
      } catch {
        // storage refused: nothing to remove
      }
    },
    keys: own,
    clear() {
      for (const key of own()) this.remove(key);
    },
  };
}
