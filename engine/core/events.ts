/**
 * @file Events (PLAN.md WP 1.2): a typed emitter in mitt's and Node's shape, `on`, `once`, `off` and `emit`, plus
 * scoped listeners that leave together (`scope.dispose()`), each listener isolated so its failure is recorded, and
 * a trace ring of the latest emits for `trace()` and debugging.
 *
 * Invariants: listeners run synchronously, in the order they were added; one added during an emit waits for the next
 * emit, one removed during an emit does not run. A listener that throws is recorded in the log's `errors` as
 * `CORE_LISTENER_FAILED` (with the event type and the thrown error) and the others still run. Each emit is traced,
 * listened to or not: `{ seq, type, payload, listeners, failed }`, the latest `traceSize` (256) kept. A disposed
 * scope removes every listener added through it and through its child scopes, and refuses new ones. Nothing here
 * reads a clock, so an emitter is as reproducible as the code that emits.
 *
 * Snapshots: `snapshot()` copies the registrations and scopes as they are (functions included, so a snapshot lives in
 * memory only), and `restore(snapshot)` puts them back on the same emitter: a used-up `once` or a removed listener
 * returns in its place, one added since leaves, a scope disposed since reopens with its listeners and children, and a
 * scope made since is disposed. The trace ring is history, not state: it is never restored. The sim world keeps one
 * snapshot per capture (engine/sim/capture.ts), so listeners rewind with the rest of the world.
 *
 * Carried from `my-3d2dge:src/emberdeep/00-core.js:90-102` (`BUS`, its scopes and its per-listener `try`), rebuilt
 * with types, disposable scopes and the trace.
 *
 * @example
 * type GameEvents = { hit: { target: number; damage: number }; levelEnd: { level: string } };
 * const events = createEvents<GameEvents>();
 * const level = events.scope('level');
 * let taken = 0;
 * level.on('hit', (hit) => (taken += hit.damage));
 * events.emit('hit', { target: 7, damage: 12 });
 * level.dispose(); // the level's listeners leave together
 * events.emit('hit', { target: 7, damage: 5 });
 * taken; // 12
 * events.trace().map((record) => record.listeners); // [1, 0]
 * @see engine/core/events.test.ts
 */
import { codeError, defineCodes, log as sharedLog, type Log } from './log';

/** The codes this module raises, with their fixes. */
export const EVENT_CODES = defineCodes('core', {
  CORE_LISTENER_FAILED: {
    template: 'a listener of {type} threw: {error}',
    fix: 'fix the listener (the stack is in the error record); the other listeners of {type} still ran',
    doc: "Recorded by `emit` (engine/core/events.ts) in the log's errors (`__engine.errors`), with the thrown error as its cause. Each listener runs isolated, so one failing system never stops the others.",
  },
  CORE_BAD_SNAPSHOT: {
    template: 'restore() got {what}, not a snapshot of this emitter',
    fix: 'pass restore() what snapshot() of the same emitter returned: listeners are functions, which never move between emitters',
  },
  CORE_SCOPE_DISPOSED: {
    template: 'the scope {label} is disposed; it takes no new listeners',
    fix: "make a new scope (events.scope('…')) for what starts next, instead of reusing one whose lifetime ended",
  },
});

/** A listener of one event type. */
export type Listener<T> = (payload: T) => void;

/** Event type → payload type. */
export type EventMap = Record<string, unknown>;

/** One traced emit. */
export interface TraceRecord {
  /** The emit's number, counting from 1 since the emitter was made. */
  seq: number;
  type: string;
  payload: unknown;
  /** How many listeners ran. */
  listeners: number;
  /** How many of them threw. */
  failed: number;
}

/** Listeners that leave together: `dispose()` removes every one added through this scope or its children. */
export interface Scope<M extends EventMap = EventMap> {
  readonly label: string;
  readonly disposed: boolean;
  /** Adds a listener for this scope's lifetime; returns a function that removes it sooner. */
  on<K extends keyof M & string>(type: K, listener: Listener<M[K]>): () => void;
  /** Adds a listener that runs at most once, within this scope's lifetime. */
  once<K extends keyof M & string>(type: K, listener: Listener<M[K]>): () => void;
  /** A child scope, disposed with this one. */
  scope(label?: string): Scope<M>;
  /** Removes every listener of this scope and its children; later calls do nothing. */
  dispose(): void;
}

/** One registration as a snapshot lists it: its event type, whether it runs once, and its scope's label. */
export interface RegistrationInfo {
  readonly type: string;
  readonly once: boolean;
  readonly scope?: string;
}

/** The listeners and scopes of an emitter at one moment: `restore` puts them back (see the file comment). */
export interface EventsSnapshot {
  /** The registrations, types in code-unit order, each type's in the order they run. */
  readonly registrations: readonly RegistrationInfo[];
}

/** A typed emitter: `on`, `once`, `off`, `emit`, scopes and the trace. */
export interface Events<M extends EventMap = EventMap> {
  /** Adds a listener; returns a function that removes it. */
  on<K extends keyof M & string>(type: K, listener: Listener<M[K]>): () => void;
  /** Adds a listener that runs at most once. */
  once<K extends keyof M & string>(type: K, listener: Listener<M[K]>): () => void;
  /** Removes a listener added with `on` (every registration of it for that type). */
  off<K extends keyof M & string>(type: K, listener: Listener<M[K]>): void;
  /** Calls every listener of `type` with `payload`, each isolated; returns how many ran. */
  emit<K extends keyof M & string>(type: K, payload: M[K]): number;
  /** A scope whose listeners leave together. */
  scope(label?: string): Scope<M>;
  /** The latest emits, oldest first. */
  trace(): TraceRecord[];
  /** The registrations and scopes as they are now. */
  snapshot(): EventsSnapshot;
  /** Puts back a snapshot of this emitter. Throws `CORE_BAD_SNAPSHOT` for anything else. */
  restore(snapshot: EventsSnapshot): void;
}

/** How an emitter is made: the log its failures go to (the shared one) and how many emits it traces (256). */
export interface EventsOptions {
  log?: Log;
  traceSize?: number;
}

/** A scope's state, kept apart so a restore can put it back. */
interface ScopeState {
  readonly label: string;
  /** Removes each listener and child scope added through it. */
  removers: Set<() => void>;
  disposed: boolean;
  readonly parent?: ScopeState;
  readonly dispose: () => void;
}

/** One registration. */
interface Registration {
  listener: Listener<never>;
  once: boolean;
  active: boolean;
  scope?: ScopeState;
}

/** What a snapshot holds besides its public list: the lists by type and each open scope's removers. */
interface Held {
  owner: object;
  lists: [string, Registration[]][];
  scopes: [ScopeState, Set<() => void>][];
}

/** Each snapshot's contents, out of reach of the code that holds it. */
const held = new WeakMap<object, Held>();

/** Makes an emitter. */
export function createEvents<M extends EventMap = EventMap>(options: EventsOptions = {}): Events<M> {
  const log = options.log ?? sharedLog;
  const traceSize = Math.max(0, options.traceSize ?? 256);
  const listeners = new Map<string, Registration[]>();
  const ring: TraceRecord[] = [];
  let seq = 0;

  /** Scopes not disposed: what a snapshot records. */
  const open = new Set<ScopeState>();

  /** Keeps the registrations of `type` that pass `keep`. Lists are replaced, never changed, so an emit can walk one. */
  const drop = (type: string, keep: (item: Registration) => boolean) => {
    const list = listeners.get(type);
    if (list) listeners.set(type, list.filter(keep));
  };
  const add = (type: string, listener: Listener<never>, once: boolean, scope?: ScopeState): (() => void) => {
    const registration: Registration = { listener, once, active: true, scope };
    listeners.set(type, [...(listeners.get(type) ?? []), registration]);
    return () => {
      registration.active = false;
      drop(type, (item) => item !== registration);
    };
  };

  const makeScope = (label: string, parent?: ScopeState): Scope<M> => {
    const guard = () => {
      if (state.disposed) throw codeError('CORE_SCOPE_DISPOSED', { label: JSON.stringify(label) });
    };
    const track = (remove: () => void) => {
      const once = () => {
        state.removers.delete(once);
        remove();
      };
      state.removers.add(once);
      return once;
    };
    const state: ScopeState = {
      label,
      removers: new Set(),
      disposed: false,
      parent,
      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        open.delete(state);
        for (const remove of [...state.removers]) remove();
        state.parent?.removers.delete(state.dispose);
      },
    };
    const scope: Scope<M> = {
      label,
      get disposed() {
        return state.disposed;
      },
      on: (type, listener) => (guard(), track(add(type, listener as Listener<never>, false, state))),
      once: (type, listener) => (guard(), track(add(type, listener as Listener<never>, true, state))),
      scope: (childLabel = `${label}/child`) => {
        guard();
        return makeScope(childLabel, state);
      },
      dispose: state.dispose,
    };
    parent?.removers.add(state.dispose);
    open.add(state);
    return scope;
  };

  const owner = {};
  const snapshot = (): EventsSnapshot => {
    const types = [...listeners.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const lists = types.map((type): [string, Registration[]] => [type, listeners.get(type)!.filter((r) => r.active)]);
    const registrations = lists.flatMap(([type, list]) =>
      list.map((item): RegistrationInfo => ({ type, once: item.once, scope: item.scope?.label })),
    );
    const out: EventsSnapshot = Object.freeze({ registrations: Object.freeze(registrations) });
    held.set(out, { owner, lists, scopes: [...open].map((scope) => [scope, new Set(scope.removers)]) });
    return out;
  };
  const restore = (from: EventsSnapshot): void => {
    const data = held.get(from);
    if (data?.owner !== owner)
      throw codeError('CORE_BAD_SNAPSHOT', { what: data ? "another emitter's snapshot" : 'a value' });
    for (const list of listeners.values()) for (const item of list) item.active = false;
    listeners.clear();
    for (const [type, list] of data.lists) {
      for (const item of list) item.active = true;
      listeners.set(type, list);
    }
    const kept = new Map(data.scopes);
    for (const scope of open) if (!kept.has(scope)) scope.disposed = true;
    open.clear();
    for (const [scope, removers] of kept) {
      scope.disposed = false;
      scope.removers = new Set(removers);
      open.add(scope);
    }
  };

  return {
    on: (type, listener) => add(type, listener as Listener<never>, false),
    once: (type, listener) => add(type, listener as Listener<never>, true),
    off(type, listener) {
      for (const item of listeners.get(type) ?? []) if (item.listener === listener) item.active = false;
      drop(type, (item) => item.active);
    },
    emit(type, payload) {
      const list = listeners.get(type) ?? [];
      let ran = 0;
      let failed = 0;
      for (const registration of list) {
        if (!registration.active) continue;
        if (registration.once) {
          registration.active = false;
          drop(type, (item) => item !== registration);
        }
        ran++;
        try {
          (registration.listener as Listener<M[typeof type]>)(payload);
        } catch (error) {
          failed++;
          const text = error instanceof Error ? error.message : String(error);
          log.error('CORE_LISTENER_FAILED', { type, error: text }, error);
        }
      }
      if (traceSize > 0) {
        ring.push({ seq: ++seq, type, payload, listeners: ran, failed });
        if (ring.length > traceSize) ring.shift();
      } else seq++;
      return ran;
    },
    scope: (label = 'scope') => makeScope(label),
    trace: () => ring.slice(),
    snapshot,
    restore,
  };
}
