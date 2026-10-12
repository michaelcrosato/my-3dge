/**
 * @file The box's touch layout (PLAN.md WP 3.10, WP 3.12, WP 6.7; ADR-0021: built, not tested): `touchlayout:box`,
 * the buttons a phone or tablet shows over the box page (engine/ui/touch.ts draws them, engine/input/devices/touch.ts
 * reads them). Attack is the main button, the big one in the corner, since Box 5's fight; jump, dash and the bolt
 * (the action `skill`) sit beside it on the inner ring. Each acts from the moment the thumb lands and stays held
 * while it stays, so a held jump climbs higher than a tapped one, as on the keyboard; in the scenes without a fight,
 * attack is the hall's shove (labs/box/scenes/hall-props.ts) or nothing. No menu button: the box has no menu to open,
 * and a pause with nothing to resume it would strand a phone. The page names the layout for every scene
 * (labs/box/main.ts); the floating stick walks the hero wherever the other thumb lands.
 *
 * Like the rest of the touch layer it has no test, by the owner's order (ADR-0021): only the owner's reports check it.
 * `node x set touch on` opens it on a desktop, for reading through DOM queries.
 */
import { defineTouchLayout } from '../../engine';

/** The box page's touch layout's id. */
export const BOX_TOUCH = 'touchlayout:box';

defineTouchLayout(BOX_TOUCH, {
  description: 'The Stress Box: attack as the main button, then jump, dash and the bolt.',
  buttons: [
    { action: 'attack', label: 'Attack' },
    { action: 'jump', label: 'Jump' },
    { action: 'dash', label: 'Dash' },
    { action: 'skill', label: 'Bolt' },
  ],
  menu: false,
});
