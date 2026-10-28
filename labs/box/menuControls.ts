/**
 * @file The controls the box page's menu lists (labs/box/menu.ts): a row for each action of an action map, what it
 * does in the box (`Move`, `Jump`, `Attack (shove)`…), its keys and mouse buttons labelled by the engine's `codeLabel`
 * in the reader's keyboard layout (arrows and clicks in words), and its pad buttons, the move row naming the pad and
 * the stick once. Split from menu.ts at its line cap.
 *
 * Invariants: moving first, then each other action in the map's order; a label shows once a row; an action the box
 * gives no words shows its name.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the box's files.
 *
 * @example
 * import { getActionMap } from '../../engine';
 * controlRows(getActionMap('actionMap:thirdPerson'))[0]; // { action: 'move', words: 'Move', keys: 'W A S D / ↑ ← ↓ →', pad: 'D-pad / L Stick' }
 * @see labs/box/menuControls.test.ts
 */
import { codeLabel, type ActionMap } from '../../engine';

/** What each action does in the box; an action missing here shows its name. */
const ACTION_WORDS: Readonly<Record<string, string>> = {
  jump: 'Jump',
  dash: 'Dash',
  attack: 'Attack (shove)',
  skill: 'Bolt',
  interact: 'Interact (unused)',
};

/** A pad label's direction (`D-pad Up`, `L Stick Left`): the move row names the pad and the stick once. */
const DIRECTION = / (Up|Down|Left|Right)$/;

/** Codes shown in words or arrows rather than as `codeLabel` names them. */
const WORDS: Readonly<Record<string, string>> = {
  MouseLeft: 'Left click',
  MouseRight: 'Right click',
  MouseMiddle: 'Middle click',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** One row of the controls: what it does, then the keys and mouse buttons, then the pad's buttons. */
export interface ControlRow {
  action: string;
  words: string;
  keys: string;
  pad: string;
}

/** The rows of the controls for `map`: moving first, then each other action in the map's order. */
export function controlRows(map: ActionMap, layout?: ReadonlyMap<string, string>): ControlRow[] {
  const label = (code: string) => WORDS[code] ?? codeLabel(code, { layout }).replace(/^[LR] (?=Shift|Ctrl|Alt)/, '');
  const unique = (labels: string[]) => [...new Set(labels)];
  const keys = (codes: readonly string[]) => unique(codes.filter((code) => !/^(Pad|touch:)/.test(code)).map(label));
  const pad = (codes: readonly string[]) =>
    unique(codes.filter((code) => code.startsWith('Pad')).map((c) => codeLabel(c)));
  const [forward, back, left, right] = map.move.map((action) => map.actions[action] ?? []);
  const ways = [forward, left, back, right].map(keys);
  const rows = Array.from({ length: Math.max(...ways.map((way) => way.length)) }, (_, i) => ways.map((way) => way[i]));
  const moving: ControlRow = {
    action: 'move',
    words: 'Move',
    keys: rows.map((row) => row.filter(Boolean).join(' ')).join(' / '),
    pad: unique(pad([...forward, ...back, ...left, ...right]).map((name) => name.replace(DIRECTION, ''))).join(' / '),
  };
  const others = Object.entries(map.actions)
    .filter(([action]) => !map.move.includes(action))
    .map(([action, codes]) => ({
      action,
      words: ACTION_WORDS[action] ?? action,
      keys: keys(codes).join(' / '),
      pad: pad(codes).join(' / '),
    }));
  return [moving, ...others];
}
