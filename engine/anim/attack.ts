/**
 * @file Attacks and combos (PLAN.md WP 6.1, §6.4; I-10): moves played on a timeline (engine/anim/timeline.ts).
 * `Attack` plays a move (wind, active, recover: `movePhases`; the hit window from `hitAt` to the end of the strike;
 * its root motion and weapon sweeps), and `Combo` chains attacks.
 *
 * Invariants:
 * - Exact in ticks, as the timeline: a combo's window is counted from the moment its hit ended inside the step, so a
 *   press chains on exactly the steps within the window.
 * - All state is plain data (`save`, `load`): an attack is its timeline, the keys it hit this swing (numbers: the type
 *   system asks for a target's `id` or a keying function) and its last segment. Pure arithmetic: no clock, no random
 *   stream. A hit window open for only part of a step (a strike shorter than a tick) still counts as open for it.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2467-2533` (`Attack`: the leftover carried across phases, `hitAt`, one
 * hit per target per swing; `Combo`: the chaining window). Split from timeline.ts to keep each under 400 lines
 * (ADR-0014 amendment 16).
 *
 * @example
 * const jab = new Attack('jab');
 * jab.start(); // true: a swing begins
 * const events: string[] = [];
 * for (let i = 0; i < 60 && jab.busy; i++) events.push(...jab.update(1 / 60).map((e) => e.type));
 * events.includes('hitOpen'); // true: the window opened and closed, then 'end'
 * new Combo(['slash', 'backslash']).press(); // true: the first hit starts
 * @see engine/anim/timeline.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { Vector3 } from '../core/math';
import { show } from '../core/schema';
import { strikePart } from './moves';
import { resolveMove, rootTravel, type Move, type MoveInput, type MovePhase, type MoveSpec } from './moves-data';
import type { TrailName } from './states';
import { TICK_EPSILON, Timeline, type TimelineEvent, type TimelinePhase, type TimelineState } from './timeline';

/** The codes this module raises, with their fixes. */
export const ATTACK_CODES = defineCodes('anim', {
  ANIM_BAD_HIT_KEY: {
    template: 'hits keyed a target by {key}, not a finite number, so it could not tell the targets apart',
    fix: 'give each target a numeric id field, or pass hits a fourth argument that returns one: (t) => t.entity',
    doc: 'Thrown by `Attack.hits` and `Combo.hits` (engine/anim/attack.ts), which hit each target once per swing by its key: its `id` field, or what the keying function given returns. Targets without one would all share the key `undefined`, so only the first would ever be hit.',
  },
  ANIM_EMPTY_COMBO: {
    template: 'a Combo was made from no moves, so it has no hit to play',
    fix: 'pass Combo at least one move (an id such as "jab", a Move, a spec or an Attack); check a list read from data before making the combo',
    doc: 'Thrown by `new Combo(moves)` (engine/anim/attack.ts) when `moves` is empty: `press`, `current`, `save` and `load` all play or read one of its hits.',
  },
});

/** A move's timeline: wind, active (the hit window from `hitAt` to its end), recover. */
export function movePhases(move: Move): TimelinePhase[] {
  const window = [
    { type: 'hitOpen', at: move.hitAt },
    { type: 'hitClose', at: 1 },
  ];
  return [
    { name: 'wind', duration: move.time.wind },
    { name: 'active', duration: move.time.active, events: window },
    { name: 'recover', duration: move.time.recover },
  ];
}

/** A sweep: the striking part's segment at the last step and at this one, world metres: the quad it swept. */
export interface Sweep {
  readonly base0: Vector3;
  readonly tip0: Vector3;
  readonly base1: Vector3;
  readonly tip1: Vector3;
}

/** A target's own `id` field: the key `hits` uses unless given another (it checks the key is a number). */
const ownId = (target: unknown): number => (target as { id?: number } | null | undefined)?.id as number;

/** An attack as plain data: its timeline, the targets it hit this swing, its last segment, its window. */
export interface AttackState {
  timeline: TimelineState;
  hit: number[];
  segment: number[];
  open: boolean;
}

/**
 * One move played on a timeline: `start` a swing, `update` it one fixed step (its events: `wind`, `active`,
 * `hitOpen`, `hitClose`, `recover`, `end`), tell the body `body`, connect with `hits` once per target per swing while
 * the hit window is open, and read the strike's `sweep` there. A move with `rootMotion: 'apply'` moves its character
 * forward by `rootDelta` each step (metres before the build's size).
 */
export class Attack {
  /** The move it plays. */
  readonly move: Move;
  /** Its timeline. */
  readonly timeline: Timeline;
  /** The events of the last `start` or `update`, refilled by the next one (`update`'s own array is never refilled). */
  readonly events: TimelineEvent[] = [];
  /** How far the root moved forward in the last step, metres before the build's size (`rootMotion: 'apply'`). */
  rootDelta = 0;
  readonly #hit = new Set<number>();
  readonly #segment: number[] = [];
  #open = false;

  /** An attack playing `move` (an id, a `Move` or a spec) with `over` laid on it (moves-data.ts `resolveMove`). */
  constructor(move: string | Move | MoveSpec, over?: MoveSpec) {
    this.move = resolveMove(move, over);
    this.timeline = new Timeline(movePhases(this.move));
  }

  /** Whether a swing is playing. */
  get busy(): boolean {
    return this.timeline.playing;
  }

  /** The phase playing, if any. */
  get phase(): MovePhase | undefined {
    return this.timeline.current?.name as MovePhase | undefined;
  }

  /** Whether it is striking (the active phase). */
  get active(): boolean {
    return this.phase === 'active';
  }

  /** Progress through the phase playing, 0 to 1. */
  get u(): number {
    return this.timeline.u;
  }

  /** What the body is told while it plays (a humanoid's or an animator's `body`), or undefined when idle. */
  get body(): MoveInput | undefined {
    const phase = this.phase;
    return phase ? { move: this.move, phase, u: this.u } : undefined;
  }

  /** Whether the hit window was open during the last step (even for part of it). */
  get hitOpen(): boolean {
    return this.#open;
  }

  /** Begins a swing if idle (or recovering, with `canCancel`): fires `wind`. Returns whether it began. */
  start(canCancel = false): boolean {
    if (this.busy && !(canCancel && this.phase === 'recover')) return false;
    this.#hit.clear();
    this.#segment.length = 0;
    this.rootDelta = 0;
    this.#record(this.timeline.start());
    return true;
  }

  /**
   * One fixed step of `dt` seconds: returns the events fired, in order, in a new array that a later `start` or
   * `update` leaves as it is (they are also copied into `events`).
   */
  update(dt: number): TimelineEvent[] {
    if (!this.busy) {
      [this.rootDelta, this.events.length, this.#open] = [0, 0, false];
      return [];
    }
    const before = rootTravel(this.move, this.phase, this.u);
    const events = this.timeline.advance(dt);
    this.#record(events);
    const ended = events.some((e) => e.type === 'end');
    this.rootDelta = (ended ? rootTravel(this.move, 'recover', 1) : rootTravel(this.move, this.phase, this.u)) - before;
    return events;
  }

  /** The part that leaves a trail now (the animator's `trail`): while striking and just after, as my-3d2dge drew it. */
  trail(armed: boolean): TrailName | undefined {
    const swinging = this.phase === 'active' || (this.phase === 'recover' && this.u < TRAIL_AFTER);
    const m = this.move;
    if (!swinging || !(m.trail || m.limb === 'footR' || !armed || m.hand === 'L')) return undefined;
    return strikePart(m, armed);
  }

  /**
   * While the hit window is open, calls `fn` once per swing for each target that passes `test`, keyed by its `id`
   * field, or by `id` for targets without one. Returns how many it hit this call. Throws `ANIM_BAD_HIT_KEY` for a
   * key that is not a finite number.
   */
  hits<T extends { readonly id: number }>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void): number;
  hits<T>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void, id: (t: T) => number): number;
  hits<T>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void, id: (t: T) => number = ownId): number {
    if (!this.#open) return 0;
    let n = 0;
    for (const target of targets) {
      const key = id(target);
      if (!Number.isFinite(key)) throw codeError('ANIM_BAD_HIT_KEY', { key: show(key) });
      if (this.#hit.has(key) || !test(target)) continue;
      this.#hit.add(key);
      n++;
      fn(target);
    }
    return n;
  }

  /**
   * Records the striking part's segment this step (`strikeSegment`) and, while the hit window is open, returns the
   * sweep from the last step's segment (from this one on the window's first step); null otherwise. Sim code reads the
   * segment only from a pose the sim made: `strikeSegment` of the `Animator` itself with `preciseHits` (it throws
   * without), or of a spare `Humanoid` the sim updates. An animator's `body` is otherwise the view's pose (none
   * headless), and the hits would depend on what was drawn.
   */
  sweep(base: Vector3, tip: Vector3): Sweep | null {
    const had = this.#segment.length === 6;
    const out = this.#open
      ? {
          base0: had ? new Vector3().fromArray(this.#segment, 0) : base.clone(),
          tip0: had ? new Vector3().fromArray(this.#segment, 3) : tip.clone(),
          base1: base.clone(),
          tip1: tip.clone(),
        }
      : null;
    this.#segment.length = 0;
    this.#segment.push(...base.toArray(), ...tip.toArray());
    return out;
  }

  /** Stops the swing at once. */
  cancel(): void {
    this.timeline.stop();
    [this.rootDelta, this.#open] = [0, false];
  }

  /** The state as plain data. */
  save(): AttackState {
    return { timeline: this.timeline.save(), hit: [...this.#hit], segment: [...this.#segment], open: this.#open };
  }

  /** Reads a state `save` wrote, copying it. */
  load(state: Readonly<AttackState>): this {
    this.timeline.load(state.timeline);
    this.#hit.clear();
    for (const id of state.hit) this.#hit.add(id);
    this.#segment.length = 0;
    this.#segment.push(...state.segment);
    this.#open = state.open;
    return this;
  }

  /** Keeps the step's events and whether the hit window was open during it. */
  #record(events: TimelineEvent[]): void {
    this.events.length = 0;
    this.events.push(...events);
    const { phase, timeline: tl } = this;
    const inWindow = phase === 'active' && tl.t + TICK_EPSILON >= this.move.hitAt * (tl.current?.duration ?? 0);
    this.#open = inWindow || events.some((e) => e.type === 'hitOpen' || e.type === 'hitClose');
  }
}

/** The share of the recover a strike still trails through (my-3d2dge's 0.12). */
const TRAIL_AFTER = 0.12;

/** How long ago a combo's last hit ended when nothing has played yet, seconds: far past any window. */
const LONG_AGO = 1e9;

/** A combo as plain data: the hit playing (−1 none), seconds since the last hit ended, the hit's own state. */
export interface ComboState {
  step: number;
  idle: number;
  attack: AttackState;
}

/**
 * A chain of attacks (a 3-hit punch string, a sword combo): `press` during one hit's recover, or within `window`
 * seconds after it ends, flows into the next; otherwise the chain starts over. Exact in ticks: a press `n` steps
 * after the first chains while n · dt is within the hit's length plus `window` (to `TICK_EPSILON`).
 */
export class Combo {
  /** The attacks, in order. */
  readonly attacks: readonly Attack[];
  /** Seconds after a hit ends that a press still chains. */
  readonly window: number;
  /** The hit playing or last played; −1 before the first. */
  step = -1;
  /** Seconds since the current hit ended (0 while it plays). */
  idle = LONG_AGO;

  /**
   * A chain of `moves` (ids, moves, specs or attacks; at least one, else `ANIM_EMPTY_COMBO`); `options.window` is
   * 0.3 s by default.
   */
  constructor(moves: readonly (string | Move | MoveSpec | Attack)[], options: { window?: number } = {}) {
    if (moves.length === 0) throw codeError('ANIM_EMPTY_COMBO');
    this.attacks = moves.map((m) => (m instanceof Attack ? m : new Attack(m)));
    this.window = options.window ?? 0.3;
  }

  /** The hit playing or last played (the first before any). */
  get current(): Attack {
    return this.attacks[Math.max(0, this.step)];
  }

  /** Whether a hit is playing. */
  get busy(): boolean {
    return this.step >= 0 && this.current.busy;
  }

  /** What the body is told while a hit plays. */
  get body(): MoveInput | undefined {
    return this.busy ? this.current.body : undefined;
  }

  /** Starts the chain, or continues it during a recover or within the window. Returns whether a hit began. */
  press(): boolean {
    const cur = this.step >= 0 ? this.current : undefined;
    if (cur?.busy && cur.phase !== 'recover') return false;
    const chains = cur !== undefined && (cur.busy || this.idle <= this.window + TICK_EPSILON);
    const next = chains && this.step + 1 < this.attacks.length ? this.step + 1 : 0;
    if (cur?.busy) cur.cancel();
    [this.step, this.idle] = [next, 0];
    return this.attacks[next].start();
  }

  /** One fixed step of the hit playing: returns its events, in a new array a later `press` leaves as it is. */
  update(dt: number): TimelineEvent[] {
    if (this.step < 0) return [];
    const cur = this.current;
    const wasBusy = cur.busy;
    const events = cur.update(dt);
    if (!cur.busy) this.idle = wasBusy ? (events.find((e) => e.type === 'end')?.late ?? 0) : this.idle + dt;
    return events;
  }

  /** The current hit's `hits`: targets keyed by their `id` field, or by `id` for targets without one. */
  hits<T extends { readonly id: number }>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void): number;
  hits<T>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void, id: (t: T) => number): number;
  hits<T>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void, id: (t: T) => number = ownId): number {
    return this.step >= 0 ? this.current.hits(targets, test, fn, id) : 0;
  }

  /** Stops the chain; the next press starts it over. */
  cancel(): void {
    if (this.step >= 0) this.current.cancel();
    [this.step, this.idle] = [-1, LONG_AGO];
  }

  /** The state as plain data. */
  save(): ComboState {
    return { step: this.step, idle: this.idle, attack: this.current.save() };
  }

  /**
   * Reads a state `save` wrote; the other hits are idle. A step outside the attacks (a save from a longer combo)
   * leaves the chain idle, as `cancel` does.
   */
  load(state: Readonly<ComboState>): this {
    for (const attack of this.attacks) attack.cancel();
    const { step } = state;
    if (!Number.isInteger(step) || step < -1 || step >= this.attacks.length) {
      this.cancel();
      return this;
    }
    [this.step, this.idle] = [step, state.idle];
    this.current.load(state.attack);
    return this;
  }
}
