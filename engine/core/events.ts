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
}

/** How an emitter is made: the log its failures go to (the shared one) and how many emits it traces (256). */
export interface EventsOptions {
  log?: Log;
  traceSize?: number;
}

/** One registration. */
interface Registration {
  listener: Listener<never>;
  once: boolean;
  active: boolean;
}

/** Makes an emitter. */
export function createEvents<M extends EventMap = EventMap>(options: EventsOptions = {}): Events<M> {
  const log = options.log ?? sharedLog;
  const traceSize = Math.max(0, options.traceSize ?? 256);
  const listeners = new Map<string, Registration[]>();
  const ring: TraceRecord[] = [];
  let seq = 0;

  /** Keeps the registrations of `type` that pass `keep`. Lists are replaced, never changed, so an emit can walk one. */
  const drop = (type: string, keep: (item: Registration) => boolean) => {
    const list = listeners.get(type);
    if (list) listeners.set(type, list.filter(keep));
  };
  const add = (type: string, listener: Listener<never>, once: boolean): (() => void) => {
    const registration: Registration = { listener, once, active: true };
    listeners.set(type, [...(listeners.get(type) ?? []), registration]);
    return () => {
      registration.active = false;
      drop(type, (item) => item !== registration);
    };
  };

  const makeScope = (label: string, parent?: Set<() => void>): Scope<M> => {
    const removers = new Set<() => void>();
    let disposed = false;
    const guard = () => {
      if (disposed) throw codeError('CORE_SCOPE_DISPOSED', { label: JSON.stringify(label) });
    };
    const track = (remove: () => void) => {
      const once = () => {
        removers.delete(once);
        remove();
      };
      removers.add(once);
      return once;
    };
    const scope: Scope<M> = {
      label,
      get disposed() {
        return disposed;
      },
      on: (type, listener) => (guard(), track(add(type, listener as Listener<never>, false))),
      once: (type, listener) => (guard(), track(add(type, listener as Listener<never>, true))),
      scope: (childLabel = `${label}/child`) => {
        guard();
        const child = makeScope(childLabel, removers);
        return child;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const remove of [...removers]) remove();
        parent?.delete(scope.dispose);
      },
    };
    parent?.add(scope.dispose);
    return scope;
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
  };
}
