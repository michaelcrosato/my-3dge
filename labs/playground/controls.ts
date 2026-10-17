/**
 * @file The playground's controls (docs/PLAYGROUND.md §3.3, PLAN.md WP 13.3): the action map `actionMap:playground`,
 * Apex Legends' default movement keys where the browser allows them. W A S D or the arrows move, Space jumps, Left
 * Shift sprints (held, or a press that keeps the sprint while the player moves on), Left Alt walks (ours: Apex walks
 * only aiming down sights) and Left Ctrl crouches while held; a pad's left stick moves, A jumps, a click of the left
 * stick sprints and B crouches. The page binds it (labs/playground/main.ts) and the menu lists it
 * (labs/playground/menu.ts). WP 13.9 adds the rest of §3.3's table (use, melee, fire, aim, reload, holster, the
 * toggled crouch on C) and rebinding.
 *
 * Invariants: data only; its actions are the buttons the player's intents carry (`jump`, `sprint`, `walk`,
 * `crouch`), which the shooter model reads (engine/sim/actors.ts).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * import { getActionMap } from '../../engine';
 * getActionMap(PLAYGROUND_ACTION_MAP).actions.sprint; // ['ShiftLeft', 'PadLeftStick']
 * @see labs/playground/controls.test.ts
 */
import { defineActionMap } from '../../engine';

/** The action map the page's input binds. */
export const PLAYGROUND_ACTION_MAP = 'actionMap:playground';

/** The actions the player answers, with what each does, in the menu's order. */
export const PLAYGROUND_ACTIONS: Readonly<Record<string, string>> = {
  jump: 'Jump',
  sprint: 'Sprint: hold, or press once to keep it',
  walk: 'Walk',
  crouch: 'Crouch: hold',
};

defineActionMap(PLAYGROUND_ACTION_MAP, {
  description: 'The playground: Apex Legends’ default movement keys (docs/PLAYGROUND.md §3.3).',
  actions: {
    forward: ['KeyW', 'ArrowUp', 'PadUp', 'PadLeftStickUp'],
    back: ['KeyS', 'ArrowDown', 'PadDown', 'PadLeftStickDown'],
    left: ['KeyA', 'ArrowLeft', 'PadLeft', 'PadLeftStickLeft'],
    right: ['KeyD', 'ArrowRight', 'PadRight', 'PadLeftStickRight'],
    jump: ['Space', 'PadSouth'],
    sprint: ['ShiftLeft', 'PadLeftStick'],
    walk: ['AltLeft'],
    crouch: ['ControlLeft', 'PadEast'],
  },
});
