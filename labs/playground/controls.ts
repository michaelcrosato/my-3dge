/**
 * @file The playground's controls (docs/PLAYGROUND.md §3.3, PLAN.md WP 13.3, WP 13.9): an action map per camera mode,
 * Apex Legends' default bindings where the browser allows them. W A S D or the arrows move, Space jumps, Left Shift
 * sprints (a press keeps the sprint while the player moves on; the setting `input.sprint` makes it hold only), Left Alt
 * walks (ours: Apex walks only aiming down sights), C crouches (held; `input.crouch` toggles it), not Apex's Left
 * Ctrl, since Ctrl with W closes the browser's tab and no page can stop it; E uses (a door, a switch, a chair to carry
 * and throw, a zipline, a ladder), V strikes (Apex's melee, WP 13.19: a punch with a lunge, the door kick at a door),
 * the left and right buttons fire and raise the sights, 1 and 2 draw the pistol and the rifle, R reloads and 3
 * holsters (WP 13.20); T switches the camera mode, X swaps the shooter's shoulder, and in isometric Q and E turn the
 * view, so there G uses. A pad's left stick moves, its right stick looks, A jumps, B crouches, X uses and held
 * reloads, Y swaps the weapons and held holsters (Apex's, on held bindings: engine/input/codes.ts `holdCode`), a
 * click of the left stick sprints and of the right one kicks, the triggers fire and aim, View switches the camera,
 * the d-pad's left swaps the shoulder and its right turns isometric.
 *
 * Each mode's map (`PLAYGROUND_MAPS`, picked by the camera in use: `playgroundMap(code)`): first person and the shooter
 * send the view (`look`, so the sprint keeps within 45° of it) and aim with the screen's centre, the mouse looking
 * under pointer lock; the platformer moves relative to the camera, the mouse turning it, and faces its move;
 * isometric and top-down move relative to the screen and aim with the free pointer onto the player's floor (the right
 * stick on a pad). The camera keys are view actions (`view`): rebound like the others, never in the intents, and the
 * page hears them (`onView`, labs/playground/main.ts). The page keeps P, F and M for itself (`reserved`).
 *
 * Invariants: data only; the buttons the intents carry are the actions the shooter model reads (`jump`, `sprint`,
 * `walk`, `crouch`, `interact`, engine/sim/actors.ts; `melee`, the strike, engine/sim/melee.ts), and the firearms'
 * (`fire`, `aim`, which raises the sights and the camera's zoom, `reload`, `holster`, `weapon1`, `weapon2` and
 * `swap`, engine/sim/weapons.ts).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's files.
 *
 * @example
 * import { getActionMap } from '../../engine';
 * playgroundMap('cam=iso,90,1'); // 'actionMap:playground-isometric'
 * getActionMap(PLAYGROUND_MAPS.isometric).actions.interact; // ['KeyG', 'PadWest']: Q and E turn the view there
 * @see labs/playground/controls.test.ts
 */
import { defineActionMap, type ActionMapSpec, type Input } from '../../engine';
import { cameraMode } from './views';

/** The action maps, by camera mode (labs/playground/views.ts `PLAYGROUND_CAMERAS`' names). */
export const PLAYGROUND_MAPS = {
  shooter: 'actionMap:playground-shooter',
  first: 'actionMap:playground-first',
  platformer: 'actionMap:playground-platformer',
  isometric: 'actionMap:playground-isometric',
  'top-down': 'actionMap:playground-top-down',
} as const;

/** The actions the player answers, with what each does, in the menu's order; the rest are bound for later WPs. */
export const PLAYGROUND_ACTIONS: Readonly<Record<string, string>> = {
  jump: 'Jump',
  sprint: 'Sprint: hold, or press once to keep it',
  walk: 'Walk',
  crouch: 'Crouch: hold',
  interact: 'Use: a door, a switch, a chair to carry and throw, a zipline, a ladder',
  melee: 'Strike: a punch with a lunge, a kick in the air, an uppercut from a slide; a door takes a kick, then breaks',
  fire: 'Fire (draws the weapon if holstered)',
  aim: 'Aim down sights',
  reload: 'Reload',
  weapon1: 'Draw the pistol',
  weapon2: 'Draw the rifle',
  swap: 'Swap weapons',
  holster: 'Holster, or draw again',
};

/** The keys the page keeps for itself: the look (P), the feel panel (F) and the menu (M). */
const PAGE_KEYS = ['KeyP', 'KeyF', 'KeyM'];

/** Every mode's bindings (see the file comment). */
const ACTIONS: Readonly<Record<string, readonly string[]>> = {
  forward: ['KeyW', 'ArrowUp', 'PadLeftStickUp'],
  back: ['KeyS', 'ArrowDown', 'PadLeftStickDown'],
  left: ['KeyA', 'ArrowLeft', 'PadLeftStickLeft'],
  right: ['KeyD', 'ArrowRight', 'PadLeftStickRight'],
  jump: ['Space', 'PadSouth'],
  sprint: ['ShiftLeft', 'PadLeftStick'],
  walk: ['AltLeft'],
  crouch: ['KeyC', 'PadEast'],
  interact: ['KeyE', 'PadWest'],
  melee: ['KeyV', 'PadRightStick'],
  fire: ['MouseLeft', 'PadRightTrigger'],
  aim: ['MouseRight', 'PadLeftTrigger'],
  reload: ['KeyR', 'Hold:PadWest'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  swap: ['PadNorth'],
  holster: ['Digit3', 'Hold:PadNorth'],
  camera: ['KeyT', 'PadSelect'],
};

/** Each mode's map, written once here and registered below. */
const SPECS: Readonly<Record<keyof typeof PLAYGROUND_MAPS, ActionMapSpec>> = {
  shooter: {
    description: 'The playground’s shooter camera: the view sent, aimed at the screen’s centre, X swaps the shoulder.',
    actions: { ...ACTIONS, shoulder: ['KeyX', 'PadLeft'] },
    view: ['camera', 'shoulder'],
    look: true,
    aimWith: 'centre',
    lock: true,
  },
  first: {
    description: 'The playground’s first person: the view sent, aimed at the screen’s centre.',
    actions: ACTIONS,
    view: ['camera'],
    look: true,
    aimWith: 'centre',
    lock: true,
  },
  platformer: {
    description: 'The playground’s platformer camera: moving relative to it, the mouse turning it, facing the move.',
    actions: ACTIONS,
    view: ['camera'],
    lock: true,
  },
  isometric: {
    description: 'The playground’s isometric view: aimed with the pointer, Q and E turning the view, so G uses.',
    actions: { ...ACTIONS, interact: ['KeyG', 'PadWest'], turnLeft: ['KeyQ'], turnRight: ['KeyE', 'PadRight'] },
    view: ['camera', 'turnLeft', 'turnRight'],
    aimWith: 'pointer',
  },
  'top-down': {
    description: 'The playground’s top-down view: aimed with the pointer.',
    actions: ACTIONS,
    view: ['camera'],
    aimWith: 'pointer',
  },
};

for (const [mode, spec] of Object.entries(SPECS)) {
  defineActionMap(PLAYGROUND_MAPS[mode as keyof typeof PLAYGROUND_MAPS], { ...spec, reserved: PAGE_KEYS });
}

/** The action map for the camera `code` (`cam3=first,…`): its mode's, the shooter's for a camera no mode opens. */
export function playgroundMap(code: string): string {
  const mode = cameraMode(code)?.name as keyof typeof PLAYGROUND_MAPS | undefined;
  return PLAYGROUND_MAPS[mode ?? 'shooter'];
}

/** The HUD's keys: the map in use's, as its prompts label them (rebound, or on a pad), then the page's own. */
export function keysLine(input: Pick<Input, 'prompt' | 'bindings' | 'lastDevice'>): string {
  const key = (action: string) => input.prompt(action);
  const { lock, view } = input.bindings.map;
  const pad = input.lastDevice === 'gamepad';
  const move = pad ? 'L Stick' : ['forward', 'left', 'back', 'right'].map(key).join('');
  const lines = [`${move}: move`, ...['jump', 'sprint', 'walk', 'crouch'].map((action) => `${key(action)}: ${action}`)];
  lines.push(`${key('interact')}: use`, `${key('melee')}: strike`);
  lines.push(pad ? `${key('swap')}: swap · ${key('reload')}: reload` : `${key('weapon1')} ${key('weapon2')}: guns · ${key('reload')}: reload`); // prettier-ignore
  lines.push(pad ? 'R Stick: look' : lock ? 'Click: mouse look' : 'Mouse: aim');
  lines.push(`${key('camera')}: camera`);
  if (view.includes('shoulder')) lines.push(`${key('shoulder')}: shoulder`);
  if (view.includes('turnLeft')) lines.push(`${key('turnLeft')} ${key('turnRight')}: turn`);
  return [...lines, 'P: look', 'F: feel', 'M: menu'].join(' · ');
}
