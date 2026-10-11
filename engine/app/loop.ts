/**
 * @file The frame loop (PLAN.md §6.4, WP 2.7; doctrine: Reproducible): fixed sim steps plus interpolation, once per
 * animation frame. `createLoop` calls `frame(now)` from `requestAnimationFrame`: it samples the devices into intents,
 * asks the clock (engine/core/time.ts) how many fixed 1/60 s steps the real time since the last frame holds (at most
 * `time.maxSteps`, a time scale and pause applied), runs them, then has the view drawn at the clock's alpha, the
 * fraction of a step real time is past the last one (the view blends the last two states by it).
 *
 * Inputs across steps (§6.4): the frame's sample goes to its first step and its later steps get it without `p`
 * (held state repeats, edges apply once). A press sampled in a frame that runs no step (a display faster than 60 Hz,
 * a pause) waits for the next step, so a tap shorter than a step is never lost. While `hold()` says so (a replay is
 * playing through the same session), frames step nothing and draw nothing, and the time they cover is dropped.
 *
 * Invariants: the loop reads no clock of its own: time comes from the animation frame's timestamp, so under the
 * tools' virtual clock (tools/lib/browser.ts) a frame runs exactly when `__clock.tick()` says. An error thrown by a
 * frame stops the loop and goes to `onError` once, instead of repeating every frame.
 *
 * @example
 * // const loop = createLoop({ clock: () => run.clock, sample: () => input.sample(view.camera), step, draw, onError });
 * // loop.start();
 * // loop.frame(performance.now()); // one frame by hand: { steps: 1, alpha: 0.4, … }
 * @see engine/app/loop.test.ts
 */
import type { Clock, Frame } from '../core/time';

/** What the loop drives. */
export interface LoopOptions {
  /** The run's clock (read each frame: a restart makes a new one). */
  clock(): Clock;
  /** The devices' intents for this frame (`input.sample(camera)`); `{}` when there are none. */
  sample(): Record<string, unknown>;
  /** Runs one sim step with these intents, through the session. */
  step(intents: Record<string, unknown>): void;
  /** Draws the view at the clock's `alpha`; `dt` is the real seconds since the last frame. */
  draw(frame: { alpha: number; dt: number }): void;
  /** True while frames must neither step nor draw (a replay plays). */
  hold?(): boolean;
  /** Gets a frame's error, once; the loop has stopped. */
  onError(error: unknown): void;
  /** `requestAnimationFrame` and `cancelAnimationFrame` (the window's). */
  request?: (callback: (now: number) => void) => number;
  cancel?: (id: number) => void;
}

/** A running frame loop. */
export interface Loop {
  /** Starts calling `frame` on every animation frame. */
  start(): void;
  /** Stops it. */
  stop(): void;
  /** Runs one frame at timestamp `now` (ms): sample, step, draw; returns what the clock handed out. */
  frame(now: number): Frame;
  /** Frames run, and sim steps run by them. */
  readonly frames: number;
  readonly steps: number;
  readonly running: boolean;
}

/** The sorted union of two press lists. */
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();

/** Makes a frame loop (see the file comment). */
export function createLoop(options: LoopOptions): Loop {
  const request = options.request ?? ((callback) => requestAnimationFrame(callback));
  const cancel = options.cancel ?? ((id) => cancelAnimationFrame(id));
  let id: number | null = null;
  let frames = 0;
  let steps = 0;
  let waiting: string[] = []; // presses sampled in frames that ran no step
  const loop: Loop = {
    start() {
      if (id !== null) return;
      const tick = (now: number) => {
        id = request(tick);
        try {
          loop.frame(now);
        } catch (error) {
          loop.stop();
          options.onError(error);
        }
      };
      id = request(tick);
    },
    stop() {
      if (id !== null) cancel(id);
      id = null;
    },
    frame(now) {
      const clock = options.clock();
      if (options.hold?.()) return clock.advance(now);
      const sampled = options.sample();
      const pressed = union(waiting, Array.isArray(sampled.p) ? (sampled.p as string[]) : []);
      const frame = clock.advance(now);
      if (frame.steps === 0) waiting = pressed;
      else {
        waiting = [];
        const first = pressed.length ? { ...sampled, p: pressed } : { ...sampled, p: undefined };
        const later = { ...sampled, p: undefined };
        for (let k = 0; k < frame.steps; k++) options.step(k === 0 ? first : later);
        steps += frame.steps;
      }
      options.draw({ alpha: frame.alpha, dt: frame.elapsed });
      frames++;
      return frame;
    },
    get frames() {
      return frames;
    },
    get steps() {
      return steps;
    },
    get running() {
      return id !== null;
    },
  };
  return loop;
}
