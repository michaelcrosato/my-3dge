/**
 * @file Replays one step at a time (PLAN.md §6.5 item 9, §6.7's CPU-only contract, WP 2.7): what lets a page render
 * between the steps of a replay, so `x replay --browser page` and tests/e2e/parity.spec.ts prove that rendering never
 * changes play, and `?replay=<name>` plays one in real time. `createPlayback(replay)` applies a replay's change-points
 * to a session exactly as engine/sim/replay.ts's `playReplay` does (its `set` values, then its dev action, then its
 * intent keys, all before the step they precede), but hands over after every step instead of running them all.
 *
 * `playInto(target, text, options)` plays a replay's text from step 0 in a running engine: it starts the replay's run
 * (`target.begin`), steps it, and after each step lets the target draw (`target.draw`, a page's frame; nothing
 * headless); drawing every n-th step (`draw` above 1), it moves the view on by a frame at each step between
 * (`target.carry`), so the camera follows, blends and shoots as live play's would. It returns the hashes at the
 * replay's checkpoints (every step with `every: true`), as `playReplay` does,
 * and with `until` stops there with the state and trace. `views` switches the camera or changes view settings at
 * the steps it names, which never changes play (a non-view setting there is `APP_PLAY_SETTING`), and shoots the view
 * there when one says `shot` (the result's `shots`: a replay's film, WP 13.26).
 *
 * Invariants: the step loop is `playReplay`'s, so both give the same hashes for the same replay (engine/app/
 * playback.test.ts compares them every step); playback steps only through the session, so the run records itself.
 *
 * @example
 * // const run = await playInto(host, readFileSync('tests/replays/box-1-room.replay.json', 'utf8'), { every: true });
 * // run.hashes['600'] === replay.hashes['linux-x64']['600'];
 * @see engine/app/playback.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import type { Registry } from '../core/registry';
import type { SettingValue } from '../core/settings';
import { applyIntents, NO_INTENTS, type IntentChanges, type Intents } from '../input/intents';
import { checkpointsOf, checkReplay, type Replay } from '../sim/replay';
import type { Session } from '../sim/session';
import type { WorldState, WorldTrace } from '../sim/state';

/** The codes this module raises, with their fixes. */
export const PLAYBACK_CODES = defineCodes('app', {
  APP_PLAY_SETTING: {
    template: 'views at step {step} sets {path}, which is not a view setting, so it would change play',
    fix: "change only settings marked view during a replay (gfx.resolution, time.scale…); a setting that changes play belongs in the replay's own inputs",
  },
});

/** Whether the setting `path` is marked view (an unknown path is `CORE_NO_ENTRY`, naming the closest). */
const isView = (registry: Registry, path: string) => registry.get('setting', path).view === true;

/** A replay being played into a session, one step at a time. */
export interface Playback {
  readonly replay: Replay;
  /** Steps played so far. */
  readonly tick: number;
  /** Whether every step has been played. */
  readonly done: boolean;
  /** Applies the change-points due now, then steps the session once. */
  step(session: Session): void;
}

/** Plays `value` (a replay, checked first: `SIM_BAD_REPLAY`) into a session, one `step` at a time. */
export function createPlayback(value: unknown): Playback {
  const replay = checkReplay(value);
  let at = 0;
  let tick = 0;
  let intents: Intents = NO_INTENTS;
  return {
    replay,
    get tick() {
      return tick;
    },
    get done() {
      return tick >= replay.steps;
    },
    step(session) {
      let change: IntentChanges = {};
      for (; at < replay.inputs.length && replay.inputs[at][0] === tick; at++) {
        const { set, dev, args, ...keys } = replay.inputs[at][1];
        for (const [path, setting] of Object.entries(set ?? {})) session.set(path, setting);
        if (dev !== undefined) session.act(dev, args);
        change = { ...change, ...keys };
      }
      intents = applyIntents(intents, change, `the replay's inputs at step ${tick}`);
      session.step(intents);
      tick++;
    },
  };
}

/** A view change during a replay: a camera code (blended into, with `blend`, as a page's live switch), and view settings by path. */ // prettier-ignore
export interface ViewChange {
  cam?: string;
  blend?: boolean;
  set?: Record<string, SettingValue>;
  /** Shoots the view there, after the change, with these `shot` options (`true`: the defaults), where it can draw. */
  shot?: true | Record<string, unknown>;
}

/** How `playInto` plays. */
export interface PlayIntoOptions {
  /** Hash every step instead of the replay's checkpoints. */
  every?: boolean;
  /** Stop after this many steps (the replay's `steps` by default), returning the state and trace there. */
  until?: number;
  /** Draw a frame after every n-th step (1: every step; 0: never, the camera left where it is). */
  draw?: number;
  /** View changes, `[step, change]`: applied after that many steps, before the next. */
  views?: readonly (readonly [number, ViewChange])[];
}

/** What a played replay gave. */
export interface PlayResult {
  scene: string;
  steps: number;
  /** The hashes by step: the checkpoints, or every step. */
  hashes: Record<string, string>;
  /** The hash after the last step played. */
  hash: string;
  /** Frames drawn while playing. */
  frames: number;
  /** With `until`: the state and trace there. */
  state?: WorldState;
  trace?: WorldTrace;
  /** The shots `views` asked for, each at its step, where the target shoots. */
  shots?: { step: number; shot: unknown }[];
}

/** What a replay plays into: an engine that can start a run, step it, and draw it. */
export interface PlayTarget {
  readonly registry: Registry;
  /** Starts the replay's run: its scene, seed and settings. */
  begin(replay: Replay): Session;
  /** Called after each step, before drawing: the view reads the entities. */
  stepped(): void;
  /** Draws a frame of the run now (a page); absent headless. */
  draw?(): Promise<void>;
  /** Moves the view on by a frame without drawing one: a step `draw` passes over (a page's view; absent headless). */
  carry?(): void;
  /** Switches the camera to `code` (a view change), blending with `blend`. */
  camera?(code: string, blend?: boolean): void;
  /** Sets a view setting. */
  setView(path: string, value: SettingValue): void;
  /** Shoots the view now (a page's `shot`); absent headless. */
  shoot?(options: Record<string, unknown>): Promise<unknown>;
}

/** Plays a replay's text from step 0 in `target` (see the file comment). */
export async function playInto(target: PlayTarget, text: string, options: PlayIntoOptions = {}): Promise<PlayResult> {
  const playback = createPlayback(JSON.parse(text));
  const { replay } = playback;
  const until = Math.min(options.until ?? replay.steps, replay.steps);
  const draw = options.draw ?? 1;
  for (const [step, change] of options.views ?? []) {
    for (const path of Object.keys(change.set ?? {})) {
      if (!isView(target.registry, path)) throw codeError('APP_PLAY_SETTING', { step, path });
    }
  }
  const views = [...Object.keys(replay.settings), ...replay.inputs.flatMap(([, c]) => Object.keys(c.set ?? {}))];
  const marked = views.filter((path) => target.registry.has('setting', path) && isView(target.registry, path));
  if (marked.length) {
    const problem = `${marked.join(', ')} ${marked.length > 1 ? 'are' : 'is'} marked view, which never changes play`;
    throw codeError('SIM_BAD_REPLAY', { where: `the replay of ${replay.scene}`, problem });
  }
  const session = target.begin(replay);
  if (session.world.hz !== replay.hz) {
    const problem = `it was recorded at ${replay.hz} Hz; the world steps at ${session.world.hz} Hz (time.hz)`;
    throw codeError('SIM_BAD_REPLAY', { where: `the replay of ${replay.scene}`, problem });
  }
  const marks = options.every ? undefined : new Set(checkpointsOf(replay));
  const hashes: Record<string, string> = {};
  const shots: { step: number; shot: unknown }[] = [];
  let frames = 0;
  for (let k = 0; k <= until; k++) {
    if (!marks || marks.has(k)) hashes[k] = session.world.hash();
    if (k === until) break;
    for (const [, change] of (options.views ?? []).filter(([step]) => step === k)) {
      if (change.cam !== undefined) target.camera?.(change.cam, change.blend === true);
      for (const [path, value] of Object.entries(change.set ?? {})) target.setView(path, value);
      if (change.shot && target.shoot) shots.push({ step: k, shot: await target.shoot(change.shot === true ? {} : change.shot) }); // prettier-ignore
    }
    playback.step(session);
    target.stepped();
    if (target.draw && draw > 0 && (k + 1) % draw === 0) {
      await target.draw();
      frames++;
    } else if (draw > 1) target.carry?.();
  }
  const result: PlayResult = { scene: replay.scene, steps: until, hashes, hash: session.world.hash(), frames };
  if (shots.length) result.shots = shots;
  if (options.until !== undefined)
    Object.assign(result, { state: session.world.state(), trace: session.world.trace() });
  return result;
}
