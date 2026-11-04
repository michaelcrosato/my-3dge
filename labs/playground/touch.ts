/**
 * @file The playground's touch layout (ADR-0021: built, not tested; WP 13.33): `touchlayout:playground`, the buttons a
 * phone or tablet shows over the playground (engine/ui/touch.ts draws them, engine/input/devices/touch.ts reads
 * them): jump as the main button, then use, crouch and strike, the actions every camera's map shares
 * (labs/playground/controls.ts), and the menu button, the only way to pause on a touch screen. The engine pauses the
 * run on its tap, then calls the page's `onMenu` (labs/playground/main.ts), which opens pause, or under a screen goes
 * back one as Escape does (photo mode has no other way out on touch), and a tap before the front end is up opens pause
 * once it is: a tap never strands a phone paused with nothing on screen. Under a screen or photo mode the other
 * buttons hide (ui/theme.ts), so they never take its taps. The floating stick walks the player wherever the other
 * thumb lands.
 *
 * Like the rest of the touch layer it has no test, by the owner's order (ADR-0021): only the owner's reports check it.
 * `node x set touch on` opens it on a desktop, for reading through DOM queries.
 */
import { defineTouchLayout } from '../../engine';

/** The playground's touch layout's id. */
export const PLAYGROUND_TOUCH = 'touchlayout:playground';

/** Its buttons, in slot order: the main one first (the controls sheet names them on touch, ui/help.ts). */
export const PLAYGROUND_TOUCH_BUTTONS = [
  { action: 'jump', label: 'Jump' },
  { action: 'interact', label: 'Use' },
  { action: 'crouch', label: 'Crouch' },
  { action: 'melee', label: 'Strike' },
] as const;

defineTouchLayout(PLAYGROUND_TOUCH, {
  description: 'The playground: jump as the main button, then use, crouch and strike, and the menu button (pause).',
  buttons: PLAYGROUND_TOUCH_BUTTONS,
  menu: true,
});
