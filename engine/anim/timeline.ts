/**
 * @file Timelines and the moves played on them (PLAN.md WP 6.1, §6.4; I-10): `Timeline` plays a list of phases, one
 * fixed step at a time. Each phase has a duration, optional content (a clip, a pose) and events at shares of the
 * phase. Time left over when a phase ends carries into the next, so one long step can cross several phases and fire
 * every event between, in order. `Attack` plays a move on one (wind, active, recover; the hit window from `hitAt` to
 * the end of the strike; its root motion and weapon sweeps), and `Combo` chains attacks; reactions (WP 6.2) are next.
 *
 * Invariants:
 * - Exact in ticks: a phase of d seconds ends on the first step whose time in it reaches d to within `TICK_EPSILON`,
 *   so 0.1 s ends after exactly 6 steps of 1/60 s (float sums would otherwise make it 7). A combo's window is counted
 *   from the moment its hit ended inside the step, so a press chains on exactly the steps within the window.
 * - Events fire in time order. A phase's name fires as it begins, then its own events as their share passes (one at
 *   share 0 as the phase begins, one at share 1 as it ends), and `end` after the last phase. Each event says how
 *   long before the end of the step it happened (`late`), so a reader can place it inside the step.
 * - All state is plain data (`save`, `load`): a timeline is two numbers, the phase index (−1 idle) and the seconds into
 *   the phase; an attack adds the ids it hit this swing and its last segment. Pure arithmetic: no clock, no random
 *   stream. A hit window open for only part of a step (a strike shorter than a tick) still counts as open for it.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2467-2533` (`Attack`: the leftover carried across phases, `hitAt`,
 * one hit per target per swing; `Combo`: the chaining window), generalised to any phases and events.
 *
 * @example
 * const swing = new Timeline([
 *   { name: 'wind', duration: 0.1 },
 *   { name: 'active', duration: 0.1, events: [{ type: 'hitOpen', at: 0.35 }, { type: 'hitClose', at: 1 }] },
 * ]);
 * swing.start().map((e) => e.type); // ['wind']
 * swing.advance(0.12).map((e) => e.type); // ['active']: 0.02 s into the strike, before the hit window (0.035 s)
 * swing.advance(0.1).map((e) => e.type); // ['hitOpen', 'hitClose', 'end']
 * @see engine/anim/timeline.test.ts
 */

import { Vector3 } from '../core/math';
import { strikePart } from './moves';
import { resolveMove, rootTravel, type Move, type MoveInput, type MovePhase, type MoveSpec } from './moves-data';
import type { TrailName } from './states';

/** Seconds within which a phase counts as finished: far below a tick, far above a float sum's error. */
export const TICK_EPSILON = 1e-9;

/** An event placed in a phase: its type and the share of the phase where it fires (0 to 1). */
export interface TimelineMark {
  readonly type: string;
  readonly at: number;
}

/** One phase of a timeline. */
export interface TimelinePhase<C = unknown> {
  /** Its name, fired as an event as it begins. */
  readonly name: string;
  /** Seconds; 0 passes at the next step. */
  readonly duration: number;
  /** What plays during it (a move's arm path, a clip): the timeline only carries it. */
  readonly content?: C;
  /** Events at shares of the phase. */
  readonly events?: readonly TimelineMark[];
}

/** An event a timeline fired. */
export interface TimelineEvent {
  /** The phase's name as it begins, a mark's type, or `end`. */
  readonly type: string;
  /** The phase it fired in (the last phase's name for `end`). */
  readonly phase: string;
  /** Seconds before the end of the step at which it happened. */
  readonly late: number;
}

/** A timeline's state: the phase index (−1 when idle) and the seconds into that phase. */
export type TimelineState = [index: number, t: number];

/** Phases played in order, one fixed step at a time. See the file comment. */
export class Timeline<C = unknown> {
  /** The phases, each with its marks sorted by share. */
  readonly phases: readonly TimelinePhase<C>[];
  /** The phase playing: an index into `phases`, −1 when idle. */
  index = -1;
  /** Seconds into the phase playing. */
  t = 0;

  /** A timeline over `phases`, idle. Marks are sorted by share; durations below 0 count as 0. */
  constructor(phases: readonly TimelinePhase<C>[]) {
    this.phases = phases.map((p) => ({
      ...p,
      duration: Math.max(0, p.duration),
      events: [...(p.events ?? [])].sort((a, b) => a.at - b.at),
    }));
  }

  /** Whether a phase is playing. */
  get playing(): boolean {
    return this.index >= 0;
  }

  /** The phase playing, if any. */
  get current(): TimelinePhase<C> | undefined {
    return this.index >= 0 ? this.phases[this.index] : undefined;
  }

  /** Progress through the phase playing, 0 to 1 (0 when idle; 1 for a phase of no length). */
  get u(): number {
    const phase = this.current;
    if (!phase) return 0;
    return phase.duration > 0 ? Math.min(1, this.t / phase.duration) : 1;
  }

  /** Seconds since the first phase began (0 when idle). */
  get elapsed(): number {
    let sum = this.t;
    for (let i = 0; i < this.index; i++) sum += this.phases[i].duration;
    return this.index >= 0 ? sum : 0;
  }

  /** Total seconds of all phases. */
  get duration(): number {
    return this.phases.reduce((sum, p) => sum + p.duration, 0);
  }

  /** Begins the first phase (again, if playing): fires its name and its marks at share 0. */
  start(): TimelineEvent[] {
    const out: TimelineEvent[] = [];
    this.index = -1;
    if (this.phases.length) this.#begin(0, 0, out);
    return out;
  }

  /** Stops, idle; fires nothing. */
  stop(): void {
    [this.index, this.t] = [-1, 0];
  }

  /** Moves `dt` seconds on, carrying leftover time into the next phases; returns the events fired, in order. */
  advance(dt: number): TimelineEvent[] {
    const out: TimelineEvent[] = [];
    let left = Math.max(0, dt);
    while (this.index >= 0) {
      const phase = this.phases[this.index];
      const [from, to] = [this.t, this.t + left];
      for (const mark of phase.events ?? []) {
        const at = mark.at * phase.duration;
        if (at > from + TICK_EPSILON && at <= to + TICK_EPSILON) {
          out.push({ type: mark.type, phase: phase.name, late: Math.max(0, to - at) });
        }
      }
      if (to + TICK_EPSILON < phase.duration) {
        this.t = to;
        break;
      }
      left = Math.max(0, to - phase.duration);
      if (this.index + 1 < this.phases.length) this.#begin(this.index + 1, left, out);
      else {
        this.stop();
        out.push({ type: 'end', phase: phase.name, late: left });
      }
    }
    return out;
  }

  /** The state as plain numbers. */
  save(): TimelineState {
    return [this.index, this.t];
  }

  /** Reads a state `save` wrote; an index out of range leaves it idle. */
  load([index, t]: Readonly<TimelineState>): this {
    const valid = Number.isInteger(index) && index >= 0 && index < this.phases.length;
    [this.index, this.t] = valid ? [index, Math.max(0, t)] : [-1, 0];
    return this;
  }

  /** Enters phase `index` with no time in it yet: fires its name and its marks at share 0. */
  #begin(index: number, late: number, out: TimelineEvent[]): void {
    [this.index, this.t] = [index, 0];
    const phase = this.phases[index];
    out.push({ type: phase.name, phase: phase.name, late });
    for (const mark of phase.events ?? []) {
      if (mark.at * phase.duration <= TICK_EPSILON) out.push({ type: mark.type, phase: phase.name, late });
    }
  }
}

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
  /** The events of the last `start` or `update`. */
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

  /** One fixed step of `dt` seconds: returns the events fired, in order (also kept in `events`). */
  update(dt: number): TimelineEvent[] {
    if (!this.busy) {
      [this.rootDelta, this.events.length, this.#open] = [0, 0, false];
      return this.events;
    }
    const before = rootTravel(this.move, this.phase, this.u);
    this.#record(this.timeline.advance(dt));
    const ended = this.events.some((e) => e.type === 'end');
    this.rootDelta = (ended ? rootTravel(this.move, 'recover', 1) : rootTravel(this.move, this.phase, this.u)) - before;
    return this.events;
  }

  /** The part that leaves a trail now (the animator's `trail`): while striking and just after, as my-3d2dge drew it. */
  trail(armed: boolean): TrailName | undefined {
    const swinging = this.phase === 'active' || (this.phase === 'recover' && this.u < TRAIL_AFTER);
    const m = this.move;
    if (!swinging || !(m.trail || m.limb === 'footR' || !armed || m.hand === 'L')) return undefined;
    return strikePart(m, armed);
  }

  /**
   * While the hit window is open, calls `fn` once per swing for each target that passes `test`, keyed by `id` (its
   * `id` field by default). Returns how many it hit this call.
   */
  hits<T>(
    targets: Iterable<T>,
    test: (target: T) => boolean,
    fn: (target: T) => void,
    id: (target: T) => number = (t) => (t as { id: number }).id,
  ): number {
    if (!this.#open) return 0;
    let n = 0;
    for (const target of targets) {
      const key = id(target);
      if (this.#hit.has(key) || !test(target)) continue;
      this.#hit.add(key);
      n++;
      fn(target);
    }
    return n;
  }

  /**
   * Records the striking part's segment this step (`strikeSegment`) and, while the hit window is open, returns the
   * sweep from the last step's segment (from this one on the window's first step); null otherwise.
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

  /** A chain of `moves` (ids, moves, specs or attacks); `options.window` is 0.3 s by default. */
  constructor(moves: readonly (string | Move | MoveSpec | Attack)[], options: { window?: number } = {}) {
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

  /** One fixed step of the hit playing: returns its events. */
  update(dt: number): TimelineEvent[] {
    if (this.step < 0) return [];
    const cur = this.current;
    const wasBusy = cur.busy;
    const events = cur.update(dt);
    if (!cur.busy) this.idle = wasBusy ? (events.find((e) => e.type === 'end')?.late ?? 0) : this.idle + dt;
    return events;
  }

  /** The current hit's `hits`. */
  hits<T>(targets: Iterable<T>, test: (t: T) => boolean, fn: (t: T) => void, id?: (t: T) => number): number {
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

  /** Reads a state `save` wrote; the other hits are idle. */
  load(state: Readonly<ComboState>): this {
    for (const attack of this.attacks) attack.cancel();
    [this.step, this.idle] = [state.step, state.idle];
    this.current.load(state.attack);
    return this;
  }
}
