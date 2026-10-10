/**
 * @file Action maps and presets (PLAN.md WP 3.3, I-24; doctrine: Common ground): the registry kind `actionMap`, a set
 * of named actions with the physical codes bound to each (engine/input/codes.ts), as Unity's action maps and Godot's
 * InputMap hold them; the presets; and the system layer, which no player rebinds.
 *
 * An action is a button the sim reads: held actions arrive as the intents' `b`, pressed ones as `p`
 * (engine/input/intents.ts). The four actions a map names in `move` (forward, back, left, right) are not buttons:
 * their strengths make the move axes `[right − left, forward − back]`, so keys walk at full speed and a half-pushed
 * stick at half, and `fromCamera` turns the axes into a world direction. `values` writes an action's analog strength
 * (a trigger) as a custom intent. `look: true` (first person) adds the camera's view direction as `look`.
 *
 * The system layer (`SYSTEM_ACTIONS`): pause, and the menu's accept, cancel and directions. It is always active
 * beside the map, never rebound, and never part of the intents: the app and the UI read it (`input.pressed('pause')`),
 * so remapping movement never breaks a menu (the lesson of `my-3d2dge:docs/CONTROLS-AUDIT.md`). `RESERVED_CODES` (the
 * pause buttons, and keys the browser or system keeps) and a map's own `reserved` codes are refused by rebinding.
 *
 * Invariants (`CORE_BAD_SPEC` when broken): every code is valid (`isCode`), action names are lower-case words
 * (`jump`, `skill2`) and none is a system action, `move` names four actions of the map, `values` keys are namespaced
 * custom intents naming actions of the map, and no action binds a reserved code. The presets are registered on the
 * shared registry when this module loads.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:670-693` (`Input.DEFAULT`, `PLATFORMER`, `SHMUP`, `MENU_KEYS`) with 3D
 * movement, and shardfall's layer that is never rebound (`shardfall:crates/pav_app/src/input.rs:131-161`).
 *
 * @example
 * const map = getActionMap('actionMap:thirdPerson');
 * map.actions.jump; // ['Space', 'PadSouth']
 * map.move; // ['forward', 'back', 'left', 'right']
 * SYSTEM_ACTIONS.pause; // ['Escape', 'PadStart']
 * listActionMaps().map((entry) => entry.id); // ['actionMap:firstPerson', 'actionMap:platformer', …]
 * @see engine/input/bindings.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { show, type Schema } from '../core/schema';
import { isCode } from './codes';

/** The system layer: action → codes. Always active, never rebound, never in the intents. */
export const SYSTEM_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pause: ['Escape', 'PadStart'],
  uiAccept: ['Enter', 'NumpadEnter', 'Space', 'PadSouth'],
  uiCancel: ['Escape', 'Backspace', 'PadEast'],
  uiUp: ['ArrowUp', 'PadUp', 'PadLeftStickUp'],
  uiDown: ['ArrowDown', 'PadDown', 'PadLeftStickDown'],
  uiLeft: ['ArrowLeft', 'PadLeft', 'PadLeftStickLeft'],
  uiRight: ['ArrowRight', 'PadRight', 'PadLeftStickRight'],
});

/** Codes no action map binds: the pause buttons, and keys the browser or the system keeps. */
export const RESERVED_CODES: readonly string[] = Object.freeze([
  'Escape',
  'PadStart',
  'PadHome',
  'F5',
  'F11',
  'F12',
  'MetaLeft',
  'MetaRight',
]);

/** The fields of an `actionMap` entry. */
const ACTION_MAP_FIELDS = {
  description: { type: 'string', default: '', description: 'What the map is for, in plain words.' },
  actions: {
    type: 'object',
    required: true,
    description:
      'Action name → the codes bound to it (KeyboardEvent.code, MouseLeft…, PadSouth…, PadLeftStickUp…): held actions are the intents b, pressed ones p.',
  },
  move: {
    type: 'array',
    items: { type: 'string' },
    default: ['forward', 'back', 'left', 'right'],
    description: 'The four actions that walk, as forward, back, left, right: their strengths make the move axes.',
  },
  values: {
    type: 'object',
    default: {},
    description:
      'Custom intent key ("game:throttle") → action: its analog strength (0 to 1, a trigger) is that intent.',
  },
  look: {
    type: 'boolean',
    default: false,
    description: "True for first person: the intents carry look = [the camera's yaw, its pitch].",
  },
  reserved: {
    type: 'array',
    items: { type: 'string' },
    default: [],
    description: 'Codes the game keeps for its own hotkeys: rebinding refuses them, as it refuses RESERVED_CODES.',
  },
} as const satisfies Schema;

/** An action map entry. */
export type ActionMap = Entry & {
  readonly description: string;
  readonly actions: Readonly<Record<string, readonly string[]>>;
  readonly move: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly look: boolean;
  readonly reserved: readonly string[];
};

/** An action name: a lower-case word, letters and digits. */
const ACTION = /^[a-z][A-Za-z0-9]*$/;

/** The problems of a map beyond its fields (the file comment lists them). */
function mapProblems(map: ActionMap): string[] {
  const problems: string[] = [];
  const reserved = new Set([...RESERVED_CODES, ...map.reserved]);
  for (const [action, codes] of Object.entries(map.actions)) {
    if (!ACTION.test(action)) problems.push(`the action ${show(action)} must be a lower-case word (jump, skill2)`);
    if (Object.hasOwn(SYSTEM_ACTIONS, action)) problems.push(`${action} is a system action, never rebound: rename it`);
    if (!Array.isArray(codes)) {
      problems.push(`actions.${action} is ${show(codes)}; it must be a list of codes`);
      continue;
    }
    for (const code of codes) {
      if (!isCode(code)) problems.push(`actions.${action} holds ${show(code)}, not a code (KeyW, MouseLeft, PadSouth)`);
      else if (reserved.has(code)) problems.push(`actions.${action} binds the reserved code ${code}`);
    }
  }
  if (map.move.length !== 4) problems.push(`move names ${map.move.length} actions: give forward, back, left, right`);
  for (const action of map.move) {
    if (!Object.hasOwn(map.actions, action)) problems.push(`move names ${show(action)}, which actions lacks`);
  }
  for (const [key, action] of Object.entries(map.values)) {
    if (!/^[a-z][A-Za-z0-9]*:[A-Za-z0-9_.-]+$/.test(key)) problems.push(`values key ${show(key)} must be "game:name"`);
    if (typeof action !== 'string' || !Object.hasOwn(map.actions, action)) {
      problems.push(`values.${key} names ${show(action)}, which actions lacks`);
    }
  }
  for (const code of map.reserved) if (!isCode(code)) problems.push(`reserved holds ${show(code)}, not a code`);
  return problems;
}

/** Declares the kind `actionMap` on `registry` unless it has it. */
export function actionMapKind(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('actionMap')) return;
  registry.defineKind('actionMap', {
    description:
      'Named actions and the physical codes bound to each (keys by KeyboardEvent.code, mouse, pad by position): what the input devices turn into intents.',
    fields: ACTION_MAP_FIELDS,
    defineWith: "defineActionMap('actionMap:<name>', { actions: { jump: ['Space', 'PadSouth'] } })",
    check: (entry) => mapProblems(entry as ActionMap),
  });
}

/** How an action map is written. */
export interface ActionMapSpec {
  description?: string;
  actions: Readonly<Record<string, readonly string[]>>;
  move?: readonly [string, string, string, string];
  values?: Readonly<Record<string, string>>;
  look?: boolean;
  reserved?: readonly string[];
}

/** Registers an action map (on the shared registry by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineActionMap(id: string, spec: ActionMapSpec, registry: Registry = sharedRegistry): ActionMap {
  actionMapKind(registry);
  return registry.def('actionMap', id, spec as unknown as Record<string, unknown>) as ActionMap;
}

/** The action map `id`. Throws `CORE_NO_ENTRY` naming the closest ids. */
export function getActionMap(id: string, registry: Registry = sharedRegistry): ActionMap {
  actionMapKind(registry);
  return registry.get('actionMap', id) as ActionMap;
}

/** Every action map, sorted by id. */
export function listActionMaps(registry: Registry = sharedRegistry): ActionMap[] {
  actionMapKind(registry);
  return registry.list('actionMap') as ActionMap[];
}

/** Walking on WASD, the arrows, the d-pad and the left stick: every preset's `move` actions. */
const WALK = {
  forward: ['KeyW', 'ArrowUp', 'PadUp', 'PadLeftStickUp'],
  back: ['KeyS', 'ArrowDown', 'PadDown', 'PadLeftStickDown'],
  left: ['KeyA', 'ArrowLeft', 'PadLeft', 'PadLeftStickLeft'],
  right: ['KeyD', 'ArrowRight', 'PadRight', 'PadLeftStickRight'],
};

/** The presets, by id. */
export const PRESETS: Readonly<Record<string, ActionMapSpec>> = {
  'actionMap:thirdPerson': {
    description: 'A third-person or top-down action game (the default): Space jumps, Shift dashes, the mouse fights.',
    actions: {
      ...WALK,
      jump: ['Space', 'PadSouth'],
      dash: ['ShiftLeft', 'ShiftRight', 'KeyK', 'PadEast', 'PadLeftTrigger'],
      attack: ['MouseLeft', 'KeyJ', 'PadWest', 'PadRightTrigger'],
      skill: ['MouseRight', 'KeyL', 'PadNorth', 'PadRightShoulder'],
      interact: ['KeyE', 'PadLeftShoulder'],
    },
  },
  'actionMap:firstPerson': {
    description: 'A first-person game: the mouse looks (pointer lock), the left button fires, C crouches.',
    actions: {
      ...WALK,
      jump: ['Space', 'PadSouth'],
      crouch: ['KeyC', 'ControlLeft', 'PadEast'],
      sprint: ['ShiftLeft', 'PadLeftStick'],
      fire: ['MouseLeft', 'PadRightTrigger'],
      aim: ['MouseRight', 'PadLeftTrigger'],
      reload: ['KeyR', 'PadWest'],
      interact: ['KeyE', 'PadNorth'],
    },
    look: true,
  },
  'actionMap:platformer': {
    description: 'Side-scrollers: Space, Z or K jump, X or J attack, Shift or C dash.',
    actions: {
      ...WALK,
      jump: ['Space', 'KeyZ', 'KeyK', 'PadSouth'],
      attack: ['KeyX', 'KeyJ', 'MouseLeft', 'PadWest'],
      dash: ['ShiftLeft', 'ShiftRight', 'KeyC', 'KeyL', 'PadEast', 'PadRightShoulder'],
      skill: ['KeyE', 'KeyV', 'MouseRight', 'PadNorth'],
    },
  },
  'actionMap:shmup': {
    description: "Shoot-'em-ups: Space, Z or J fire (hold for autofire), X or K bomb.",
    actions: {
      ...WALK,
      fire: ['Space', 'KeyZ', 'KeyJ', 'MouseLeft', 'PadSouth', 'PadRightTrigger'],
      bomb: ['KeyX', 'KeyK', 'MouseRight', 'PadEast', 'PadLeftTrigger'],
    },
  },
};

for (const [id, spec] of Object.entries(PRESETS)) {
  if (!sharedRegistry.kinds().includes('actionMap') || !sharedRegistry.has('actionMap', id)) {
    defineActionMap(id, spec);
  }
}
