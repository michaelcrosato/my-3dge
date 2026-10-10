/**
 * @file The virtual device (PLAN.md WP 3.3, §8.3; doctrine: Agent-operable): input made by code instead of hands, the
 * one `__engine.input` drives (engine/input/devices/inspector.ts). It works in actions and intents, not codes:
 * `press('jump')` taps an action for the next step, `hold('sprint')` keeps one down, `axis('move', [0, 1])` pushes a
 * virtual stick (`[right, forward]`, turned by the camera as keys are), and `axis('cam' | 'look' | 'aim' | 'game:…',
 * value)` sets that intent outright; `null` lets go.
 *
 * `play(script, step)` runs a script one sim step at a time, each line `<steps> [move=x,y] [look=yaw,pitch] [cam=ψ]
 * [aim=x,y,z] [hold=a,b] [tap=a] [game:key=n]`, `#` comments (engine/input/script.ts): a line holds its values for
 * its steps on top of what the device holds, and taps on its first step. A page's input (engine/input/input.ts)
 * merges the device into every sample, so the same calls drive a running page.
 *
 * Invariants: taps last one step (the next sample or step played), holds and axes until changed. Values are checked
 * when given (`INPUT_BAD_VIRTUAL`): names are non-empty strings, `move` and `look` two finite numbers, `aim` three,
 * `cam` one, a custom key plain data. Intents come out unnormalized; the session normalizes them.
 *
 * @example
 * const pad = createVirtualDevice();
 * pad.axis('move', [0, 1]);
 * pad.press('jump');
 * virtualIntents(pad.take(), Math.PI / 2); // { move: [1, 6.1e-17], b: [], p: ['jump'] }: forward is +X at ψ = π/2
 * const steps: unknown[] = [];
 * playScript(pad, '2 hold=sprint tap=dash\n1', (intents) => steps.push(intents));
 * steps.length; // 3: the second step holds sprint without the tap, the third holds nothing but the stick
 * @see engine/input/devices/virtual.test.ts
 */
import { codeError, defineCodes } from '../../core/log';
import { isPlainObject, show } from '../../core/schema';
import { fromCamera, type IntentValue } from '../intents';
import { names, numbers, parseScript, type ValueReader } from '../script';

/** The codes this module raises, with their fixes. */
export const VIRTUAL_CODES = defineCodes('input', {
  INPUT_BAD_VIRTUAL: {
    template: '{what}: {problem}',
    fix: "press(action) and hold(action) take an action's name; axis takes 'move' or 'look' [x, y], 'aim' [x, y, z], 'cam' (rad) or a 'game:key' with plain data, and null to let go",
    doc: 'Raised by the virtual device (engine/input/devices/virtual.ts) and `__engine.input` for an empty action name, an unknown axis, or a value of the wrong shape.',
  },
});

/** The axes the device can hold, and how many numbers each takes (0 for a custom key's plain data). */
const AXES: Readonly<Record<string, number>> = { move: 2, look: 2, aim: 3, cam: 1 };

/** A namespaced custom intent key. */
const CUSTOM = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9_.-]+$/;

/** What the device holds for one step: actions held and tapped, and its axes by name. */
export interface VirtualSample {
  held: string[];
  taps: string[];
  axes: Record<string, IntentValue>;
}

/** The virtual device. */
export interface VirtualDevice {
  /** Taps `action`: pressed in the next step, not held. */
  press(action: string): void;
  /** Holds `action` down (`down = false` lets go). */
  hold(action: string, down?: boolean): void;
  /** Sets an axis: `move` `[right, forward]`, `look`, `aim`, `cam` or a `game:key`; `null` lets go. */
  axis(name: string, value: unknown): void;
  /** What the device holds now, without using up its taps. */
  peek(): VirtualSample;
  /** What the device holds for the next step; its taps are used up. */
  take(): VirtualSample;
  /** Whether anything was pressed, held or moved since the last `take` (prompts follow the last device used). */
  readonly touched: boolean;
  /** Lets go of everything. */
  clear(): void;
}

/** Throws `INPUT_BAD_VIRTUAL` unless `name` is an action's name. */
function checkAction(name: unknown, what: string): string {
  if (typeof name !== 'string' || !name) throw codeError('INPUT_BAD_VIRTUAL', { what, problem: `${show(name)} is no action name` }); // prettier-ignore
  return name;
}

/** Makes a virtual device, holding nothing. */
export function createVirtualDevice(): VirtualDevice {
  const held = new Set<string>();
  let taps = new Set<string>();
  const axes: Record<string, IntentValue> = {};
  let touched = false;
  const peek = (): VirtualSample => ({ held: [...held].sort(), taps: [...taps].sort(), axes: { ...axes } });
  return {
    press(action) {
      taps.add(checkAction(action, 'press'));
      touched = true;
    },
    hold(action, down = true) {
      if (down) held.add(checkAction(action, 'hold'));
      else held.delete(checkAction(action, 'hold'));
      touched = true;
    },
    axis(name, value) {
      const n = AXES[name];
      if (n === undefined && !CUSTOM.test(name)) {
        throw codeError('INPUT_BAD_VIRTUAL', { what: `axis(${show(name)})`, problem: 'no such axis' });
      }
      if (value === null || value === undefined) delete axes[name];
      else axes[name] = checkAxis(name, value, n);
      touched = true;
    },
    peek,
    take() {
      const out = peek();
      taps = new Set();
      touched = false;
      return out;
    },
    get touched() {
      return touched;
    },
    clear() {
      held.clear();
      taps.clear();
      for (const key of Object.keys(axes)) delete axes[key];
    },
  };
}

/** A checked copy of an axis value, or `INPUT_BAD_VIRTUAL`. */
function checkAxis(name: string, value: unknown, n: number | undefined): IntentValue {
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (n === 1 && finite(value)) return value as number;
  if (n && n > 1 && Array.isArray(value) && value.length === n && value.every(finite)) return [...value] as number[];
  if (n === undefined && (finite(value) || typeof value === 'string' || typeof value === 'boolean' || isPlainObject(value) || Array.isArray(value))) {
    return structuredClone(value) as IntentValue; // the session checks it is plain data
  } // prettier-ignore
  const want = n === undefined ? 'plain data' : n === 1 ? 'a finite number' : `${n} finite numbers`;
  throw codeError('INPUT_BAD_VIRTUAL', { what: `axis(${show(name)})`, problem: `${show(value)} is not ${want}` });
}

/** One step's intents from a virtual sample: `move` turned by the heading `yaw` (the `cam` axis when it holds one). */
export function virtualIntents(sample: VirtualSample, yaw = 0): Record<string, unknown> {
  const { move, cam, ...rest } = sample.axes;
  const heading = typeof cam === 'number' ? cam : yaw;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(move) && (move[0] !== 0 || move[1] !== 0)) {
    out.move = fromCamera(heading, move as [number, number]);
  }
  if (typeof cam === 'number') out.cam = cam;
  out.b = sample.held;
  out.p = sample.taps;
  return out;
}

/** The keys a play script takes, besides `game:key=n`. */
const PLAY_KEYS: Readonly<Record<string, ValueReader>> = {
  move: numbers(2),
  look: numbers(2),
  aim: numbers(3),
  cam: numbers(1),
  hold: names,
  tap: names,
};

/**
 * Plays `script` through `device`, calling `step(intents)` once per sim step; returns how many steps ran. Throws
 * `INPUT_BAD_SCRIPT` naming each bad line before any step runs.
 */
export function playScript(device: VirtualDevice, script: string, step: (intents: unknown) => void, yaw = 0): number {
  const lines = parseScript(script, PLAY_KEYS, '__engine.input.play', { pattern: CUSTOM, read: numbers(1) });
  let steps = 0;
  for (const line of lines) {
    const { hold = [], tap = [], ...axes } = line.values as { hold?: string[]; tap?: string[] };
    for (let k = 0; k < line.count; k++) {
      const sample = device.take();
      const merged: VirtualSample = {
        held: [...new Set([...sample.held, ...hold])],
        taps: k === 0 ? [...new Set([...sample.taps, ...tap])] : sample.taps,
        axes: { ...sample.axes, ...(axes as Record<string, IntentValue>) },
      };
      step(virtualIntents(merged, yaw));
      steps++;
    }
  }
  return steps;
}
