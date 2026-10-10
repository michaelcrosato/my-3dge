/**
 * @file The scripted gamepad (PLAN.md WP 3.3, §5.8; doctrine: Verifiable without a display): a stand-in for a real
 * pad that tests plug into any slot, driven by shardfall's script format, one line per stretch of frames:
 * `<frames> [left=x,y] [right=x,y] [lt=v] [rt=v] [hold=South,North] [tap=Up]`, `#` comments (engine/input/script.ts).
 * Sticks are as the Gamepad API reports them (y down, so `left=0,-1` pushes forward); `lt` and `rt` are the analog
 * triggers, 0 to 1; `hold` keeps buttons down for the whole line, `tap` for its first frame only.
 *
 * Buttons are named as the codes without `Pad` (`South`, `LeftShoulder`, `RightTrigger`, `Up`, `Start`…), or by the
 * Xbox labels and shardfall's names: `A B X Y`, `LB RB LT RT`, `DPadUp DPadDown DPadLeft DPadRight`, `Select`.
 * (Shardfall's gilrs calls the bumpers `LeftTrigger`; here that is the trigger, as in the W3C mapping.)
 *
 * Invariants: `gamepad` is one object whose fields `next()` rewrites, so a page's `navigator.getGamepads` can hand it
 * out as a real pad; after the last line it rests (no button, sticks centred) and stays connected until
 * `disconnect()`. A bad script throws `INPUT_BAD_SCRIPT` naming each line.
 *
 * Carried from `shardfall:crates/pav_app/src/input.rs:299-380` (`PadStep`, `PadScript`), ported.
 *
 * @example
 * const pad = createScriptedGamepad('2 left=0,-1 tap=South\n1 rt=0.7', { index: 2 });
 * pad.next(); // true: frame 1, South down, the left stick forward
 * pad.gamepad.buttons[0].pressed; // true
 * pad.next(); // true: frame 2, the tap is over
 * pad.gamepad.buttons[0].pressed; // false
 * pad.next(); // true: frame 3
 * pad.gamepad.buttons[7].value; // 0.7: the right trigger
 * pad.next(); // false: the script is over and the pad rests
 * @see engine/input/devices/devices.test.ts
 */
import { codeError } from '../../core/log';
import { PAD_BUTTONS } from '../codes';
import { names, numbers, parseScript, type ScriptLine } from '../script';
import type { GamepadLike } from './gamepad';

/** The other names a script may give a button: Xbox labels and shardfall's, → the code without `Pad`. */
const ALIASES: Readonly<Record<string, string>> = {
  A: 'South',
  B: 'East',
  X: 'West',
  Y: 'North',
  LB: 'LeftShoulder',
  RB: 'RightShoulder',
  LT: 'LeftTrigger',
  RT: 'RightTrigger',
  DPadUp: 'Up',
  DPadDown: 'Down',
  DPadLeft: 'Left',
  DPadRight: 'Right',
};

/** The keys a pad script takes. */
const KEYS = { left: numbers(2), right: numbers(2), lt: numbers(1), rt: numbers(1), hold: names, tap: names };

/** A pad that a script moves frame by frame. */
export interface ScriptedGamepad {
  /** The pad as the Gamepad API shows it; the same object every frame. */
  readonly gamepad: GamepadLike;
  /** Moves to the next frame's state; false once the script is over (the pad then rests). */
  next(): boolean;
  /** Marks the pad disconnected, as unplugging it does. */
  disconnect(): void;
}

/** The standard button index a script's name means, or -1. */
function buttonIndex(name: string): number {
  return PAD_BUTTONS.indexOf(`Pad${ALIASES[name] ?? name}` as (typeof PAD_BUTTONS)[number]);
}

/** Parses a pad script; throws `INPUT_BAD_SCRIPT` naming each problem. */
export function parsePadScript(text: string): ScriptLine[] {
  const lines = parseScript(text, KEYS, 'the pad script');
  const unknown = lines.flatMap((line) =>
    [...((line.values.hold as string[]) ?? []), ...((line.values.tap as string[]) ?? [])]
      .filter((name) => buttonIndex(name) < 0)
      .map((name) => `line ${line.line}: unknown button "${name}" (South, East, West, North, LB, RT, Up, Start…)`),
  );
  if (unknown.length) throw codeError('INPUT_BAD_SCRIPT', { where: 'the pad script', problems: unknown.join('; ') });
  return lines;
}

/** Makes a scripted pad in slot `index` (0); call `next()` once per frame, before the input samples. */
export function createScriptedGamepad(script: string, options: { index?: number; id?: string } = {}): ScriptedGamepad {
  const lines = parsePadScript(script);
  const buttons = PAD_BUTTONS.map(() => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: options.id ?? 'Scripted gamepad (STANDARD GAMEPAD Vendor: 045e Product: 02ea)',
    index: options.index ?? 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons,
  };
  let at = 0;
  let frame = 0;
  const show = (values: Record<string, unknown>, first: boolean) => {
    const left = (values.left as number[]) ?? [0, 0];
    const right = (values.right as number[]) ?? [0, 0];
    pad.axes = [...left, ...right];
    const down = new Set([...((values.hold as string[]) ?? []), ...(first ? ((values.tap as string[]) ?? []) : [])]);
    buttons.forEach((button, i) => {
      const trigger = i === 6 ? values.lt : i === 7 ? values.rt : undefined;
      const value = [...down].some((name) => buttonIndex(name) === i) ? 1 : ((trigger as number | undefined) ?? 0);
      Object.assign(button, { pressed: value > 0.1, touched: value > 0, value });
    });
    pad.timestamp++;
  };
  return {
    gamepad: pad,
    next() {
      const line = lines[at];
      if (!line) {
        show({}, false);
        return false;
      }
      show(line.values, frame === 0);
      if (++frame >= line.count) {
        at++;
        frame = 0;
      }
      return true;
    },
    disconnect() {
      pad.connected = false;
    },
  };
}
