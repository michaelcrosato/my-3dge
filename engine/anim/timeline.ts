/**
 * @file Timelines (PLAN.md WP 6.1, §6.4; I-10): `Timeline` plays a list of phases, one fixed step at a time. Each
 * phase has a duration, optional content (a clip, a pose) and events at shares of the phase. Time left over when a
 * phase ends carries into the next, so one long step can cross several phases and fire every event between, in
 * order. Attacks and combos play moves on one (engine/anim/attack.ts); reactions (reactions.ts) and actions their
 * own.
 *
 * Invariants:
 * - Exact in ticks: a phase of d seconds ends on the first step whose time in it reaches d to within `TICK_EPSILON`,
 *   so 0.1 s ends after exactly 6 steps of 1/60 s (float sums would otherwise make it 7).
 * - Events fire in time order. A phase's name fires as it begins, then its own events as their share passes (one at
 *   share 0 as the phase begins, one at share 1 as it ends), and `end` after the last phase. Each event says how
 *   long before the end of the step it happened (`late`), so a reader can place it inside the step.
 * - All state is plain data (`save`, `load`): a timeline is two numbers, the phase index (−1 idle) and the seconds into
 *   the phase. Pure arithmetic: no clock, no random stream.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2467-2533` (`Attack`'s leftover carried across phases), generalised to
 * any phases and events.
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
