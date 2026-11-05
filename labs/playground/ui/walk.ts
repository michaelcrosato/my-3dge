/**
 * @file Working a panel with the menus' keys (docs/PLAYGROUND.md §8.3): the settings screen, Tune and the controls
 * sheet are forms a pointer works (sliders, lists, boxes, folds and buttons); `walkPanel(panel, input)`, run once a
 * frame while one is open (labs/playground/ui/frontEnd.ts), lets a pad work them too, as it works the engine's menus,
 * and the keyboard press and step what Tab reaches. On a pad, up and down (`uiUp`, `uiDown`: the d-pad and the left
 * stick) move the focus over the panel's controls that show and are enabled (`walkable`), round at both ends, the first
 * press focusing the first control while the focus is outside the panel; on either, accept (`uiAccept`: the pad's A,
 * Enter, Space) presses the focused button, box or fold, and left and right (`uiLeft`, `uiRight`) step the focused
 * slider by its step, or the focused list by one choice it may take, firing the events a hand's change fires (`input`
 * and `change`, bubbling). A panel with one control or none to walk to (the controls sheet, its Back alone) that is
 * taller than shows scrolls instead, `SCROLL_STEP` of what shows a press, focusing its Back (a pad had no way to read
 * the rest of a sheet taller than the window).
 *
 * Invariants: presentation only: it acts on the controls as a hand would, so what a control reports goes the way a
 * click or a drag sends it. Each press acts once: the keyboard device keeps a bound key's default from the page
 * (engine/input/devices/keyboard.ts), so the browser never also steps a focused slider or presses a focused button on
 * these keys, and keys typed into a list reach the list, not the game. That is why the keyboard walks with Tab, the
 * browser's own: a list it reached by the arrows would take the next arrow itself, changing its choice. Text fields
 * are never walked into (keys typed there are the page's, so a pad's walk could not tell).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // each frame while the settings screen is open:
 * // walkPanel(body, engine.input); // the pad's d-pad down: the next control focused
 * @see labs/playground/ui/walk.test.ts
 */
import type { Input } from '../../../engine';

/** What the walk reads of the input: the menus' keys this frame, and the device used last. */
export type WalkInput = Pick<Input, 'pressed' | 'lastDevice'>;

/** The controls the walk visits, by selector: buttons, lists, folds' summaries, sliders and boxes. */
const WALKED = 'button, select, summary, input[type=range], input[type=checkbox]';

/** The controls of `panel` the walk visits, in the page's order: those that show and are enabled. */
export function walkable(panel: HTMLElement): HTMLElement[] {
  const all = [...panel.querySelectorAll<HTMLElement>(WALKED)];
  return all.filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
}

/** Fires `type` at `el` as a hand's change does (bubbling). */
const fire = (el: HTMLElement, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

/** What a control is, by its tag and type: a list, a slider, or one pressed (a button, a box, a fold). */
const kindOf = (el: HTMLElement) =>
  el.tagName.toUpperCase() === 'SELECT' ? 'list' : (el as HTMLInputElement).type === 'range' ? 'slider' : 'pressed';

/** Steps `el`, a slider or a list, by `by` (±1): a slider's step, a list's next choice it may take, if any. */
function nudge(el: HTMLElement, by: number): void {
  if (kindOf(el) === 'list') {
    const list = el as HTMLSelectElement;
    let at = list.selectedIndex + by;
    while (at >= 0 && at < list.options.length && list.options[at].disabled) at += by;
    if (at < 0 || at >= list.options.length) return;
    list.selectedIndex = at;
    fire(el, 'change');
  } else if (kindOf(el) === 'slider') {
    const slider = el as HTMLInputElement;
    const was = slider.value;
    if (by > 0) slider.stepUp();
    else slider.stepDown();
    if (slider.value === was) return; // at its end
    fire(el, 'input');
    fire(el, 'change');
  }
}

/** How far a pad's up or down scrolls a panel with nothing to walk to: a share of what shows of it. */
export const SCROLL_STEP = 0.6;

/** What scrolls `panel`'s content: the first of it, its own panels and its screen that has more than shows, or none. */
function scroller(panel: HTMLElement): HTMLElement | null {
  const boxes = [
    panel,
    ...panel.querySelectorAll<HTMLElement>('.ui-panel'),
    panel.closest?.<HTMLElement>('.pg-screen'),
  ];
  return boxes.find((box): box is HTMLElement => !!box && box.scrollHeight > box.clientHeight + 1) ?? null;
}

/** Runs one frame of the menus' keys over `panel` (see the file comment). */
export function walkPanel(panel: HTMLElement, input: WalkInput): void {
  const pad = input.lastDevice === 'gamepad';
  const step = pad ? Number(input.pressed('uiDown')) - Number(input.pressed('uiUp')) : 0;
  const turn = Number(input.pressed('uiRight')) - Number(input.pressed('uiLeft'));
  const accept = input.pressed('uiAccept');
  if (!step && !turn && !accept) return;
  const controls = walkable(panel);
  const at = controls.indexOf(panel.ownerDocument.activeElement as HTMLElement);
  const scrolls = step && controls.length <= 1 ? scroller(panel) : null; // a sheet to read with its Back alone
  if (scrolls) {
    scrolls.scrollTop += step * scrolls.clientHeight * SCROLL_STEP;
    return void (at < 0 && controls[0]?.focus({ preventScroll: true }));
  }
  if (at < 0) return void (pad && controls[0]?.focus());
  if (step) return void controls[(at + step + controls.length) % controls.length].focus();
  if (turn) nudge(controls[at], turn);
  else if (kindOf(controls[at]) === 'pressed') controls[at].click();
}
