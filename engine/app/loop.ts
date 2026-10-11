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
 * Touch screens draw at most 60 frames a second (WP 3.12, built, not tested): while `cap()` says so, an animation
 * frame that arrives more than 2.5 ms before the next 16.667 ms slot is skipped whole, and the slot starts again from
 * a frame that falls behind (`shardfall:crates/pav_app/src/app.rs:799-808`).
 *
 * Invariants: the loop reads no clock of its own: time comes from the animation frame's timestamp, so under the
 * tools' virtual clock (tools/lib/browser.ts) a frame runs exactly when `__clock.tick()` says. An error thrown by a
 * frame stops the loop and goes to `onError` once, instead of repeating every frame.
 *
 * @example
 * // const loop = createLoop({ clock: () => run.clock, sample: (now) => input.sample(view.camera, now), step, draw, onError });
 * // loop.start();
 * // loop.frame(performance.now()); // one frame by hand: { steps: 1, alpha: 0.4, … }
 * @see engine/app/loop.test.ts
 */
import type { Clock, Frame } from '../core/time';

/** What the loop drives. */
export interface LoopOptions {
  /** The run's clock (read each frame: a restart makes a new one). */
  clock(): Clock;
  /** The devices' intents for the frame at timestamp `now` (`input.sample(camera, now)`); `{}` when there are none. */
  sample(now: number): Record<string, unknown>;
  /** Runs one sim step with these intents, through the session. */
  step(intents: Record<string, unknown>): void;
  /** Draws the view at the clock's `alpha`; `dt` is the real seconds since the last frame. */
  draw(frame: { alpha: number; dt: number }): void;
  /** True while frames must neither step nor draw (a replay plays). */
  hold?(): boolean;
  /** True while frames are capped at 60 a second (touch mode). */
  cap?(): boolean;
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

/** The capped frame rate's slot, in ms: 60 frames a second. */
export const FRAME_SLOT_MS = 16.667;
/** How early a capped frame may come before its slot and still run, in ms. */
export const FRAME_SLACK_MS = 2.5;

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
  let slot = -Infinity; // the next capped frame's time
  /** Whether a frame at `now` runs under the 60 fps cap (see the file comment); always without it. */
  const due = (now: number) => {
    if (!options.cap?.()) return true;
    if (now + FRAME_SLACK_MS < slot) return false;
    slot = now > slot + FRAME_SLOT_MS ? now + FRAME_SLOT_MS : slot + FRAME_SLOT_MS;
    return true;
  };
  const loop: Loop = {
    start() {
      if (id !== null) return;
      const tick = (now: number) => {
        id = request(tick);
        if (!due(now)) return;
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
      const sampled = options.sample(now);
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
