/**
 * @file The overlay's widgets (PLAN.md §6.7, WP 10.6, I-50; doctrine: Verifiable without a display): bars, hearts and
 * boxes as HTML/CSS elements, each marked `data-ui` so `ui.state()` (engine/ui/state.ts) and DOM queries read it as
 * text, a value and a box, never as pixels; and what the dialog and the menu share (engine/ui/{dialog,menu}.ts).
 *
 * - `createBar(parent, { id, value, max, label, color })`: a filled bar (a health, magic or boss bar): `data-ui=bar`,
 *   `data-value` its fill from 0 to 1, its text the label and the value (`HP 30/40`).
 * - `createHearts(parent, { id, hp, max })`: a row of `max` hearts (rounded up), each full, half or empty by `hp`
 *   (halves count): `data-ui=hearts`, `data-value` `hp/max`, a heart per `data-fill`.
 * - `createBox(parent, { id, title, text })`: a window frame, Final Fantasy's soft gradient in a light rim, a title and
 *   a body (`data-ui=box`); the dialog and the menu draw theirs alike.
 * Each returns its element, `set(…)` (the new numbers or text, changing the page only where they differ) and
 * `remove()`. Put a HUD widget in a HUD place with `overlay.attach(widget.el, at)` (engine/ui/overlay.ts).
 *
 * Shared: `UiInput`, what a menu reads of a page's input (engine/input/input.ts: `held`, `pressed`, `strength` and
 * `lastDevice`, over the system layer's `uiAccept`, `uiCancel` and `uiUp`/`uiDown`/`uiLeft`/`uiRight`, which never enter
 * the intents); `UiSound`, a cue it asks for (`move`, `pick`, `cancel`, `type`), played by the page's audio;
 * `createRepeat()`, a held direction moving again after 0.35 s and every 0.1 s after; and `createPadCursor(root,
 * input)`: with a gamepad used last and a panel open, the left stick moves a cursor over the page (260 px/s, up to
 * 1,160 at a full push: shardfall's) and the pad's accept clicks what it is over, so a gamepad works any DOM panel.
 *
 * Invariants: presentation only: widgets read what they are given and the page, never the sim; one stylesheet
 * (`<style id="ui-widgets-style">`, added once and kept), no `.css` import (tsx runs the `x` commands). Carried from `my-3d2dge:engine/my-3d2dge.js:4146-4192` (`ui.box`, `bar`,
 * `hearts`) as behaviour, and `shardfall:crates/pav_app/src/app.rs:438-530` (the pad's cursor), in HTML/CSS.
 *
 * @example
 * // browser: widgets need a page
 * // const hp = createBar(ui.root, { id: 'hp', value: 30, max: 40, label: 'HP' });
 * // ui.attach(hp.el, 'top-left');
 * // hp.set(25); // data-value '0.625', text 'HP 25/40'
 * // createHearts(ui.root, { id: 'life', hp: 2.5, max: 3 }).el.dataset.value; // '2.5/3'
 * @see engine/ui/widgets.test.ts
 * @see tests/e2e/ui.spec.ts
 */

/** What a widget reads of a page's input (engine/input/input.ts's `Input` is one): the system layer's actions. */
export interface UiInput {
  held(action: string): boolean;
  pressed(action: string): boolean;
  strength(action: string): number;
  /** The device used last: the pad's cursor shows only for `gamepad`. */
  readonly lastDevice: string;
}

/** A cue a widget asks the page to play. */
export type UiCue = 'move' | 'pick' | 'cancel' | 'type';

/** Plays a cue (the page's audio); widgets without one stay silent. */
export type UiSound = (cue: UiCue) => void;

/** A widget made by this module: its element, an update and its removal. */
export interface Widget<T> {
  readonly el: HTMLElement;
  set(value: T): void;
  remove(): void;
}

/** The stylesheet's element id. */
const STYLE_ID = 'ui-widgets-style';

/** The widgets' stylesheet: the bar, the hearts, the box, the dialog, the menu and the pad's cursor. */
const STYLE = `
.ui-bar { position: relative; width: 12em; height: 1em; border: 1px solid #140b12; border-radius: 2px;
  background: #3a1a26; box-shadow: 0 1px 2px #0b0814; overflow: hidden; }
.ui-bar-fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--ui-fill, 0));
  background: linear-gradient(rgba(255, 255, 255, 0.35), transparent 40%), var(--ui-color, #e0463c); }
.ui-bar-text { position: absolute; inset: 0; font-size: 0.7em; line-height: 1.45; text-align: center;
  text-shadow: 0 1px 1px #0b0814; }
.ui-hearts { display: flex; gap: 0.1em; font-size: 1.15em; line-height: 1; text-shadow: 0 1px 1px #0b0814; }
.ui-heart { color: #3a1826; }
.ui-heart[data-fill='full'] { color: #e8384a; }
.ui-heart[data-fill='half'] { color: transparent; background: linear-gradient(90deg, #e8384a 50%, #3a1826 50%);
  -webkit-background-clip: text; background-clip: text; }
.ui-box, .ui-dialog, .ui-menu, .ui-dialog-choices { background: linear-gradient(#2a3266, #10143a);
  border: 2px solid #e8e4ff; border-radius: 6px; box-shadow: 3px 3px 0 #05040a; color: #ffffff; }
.ui-box { padding: 0.45em 0.7em; }
.ui-box-title, .ui-menu-title, .ui-dialog-name { color: #ffd36a; }
.ui-box-title { font-size: 0.85em; margin-bottom: 0.25em; }
.ui-panel { position: absolute; pointer-events: auto; white-space: normal; }
.ui-panel[data-place='bottom'] { left: 50%; bottom: 1em; transform: translateX(-50%); }
.ui-panel[data-place='middle'], .ui-panel[data-place='center'] { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.ui-panel[data-place='top'] { left: 50%; top: 1.5em; transform: translateX(-50%); }
.ui-dialog { width: min(36em, 90%); min-height: 4.4em; padding: 0.7em 1em; box-sizing: border-box; }
.ui-dialog-name { position: absolute; left: 0.8em; top: -1.1em; padding: 0.1em 0.6em; border: 2px solid #e8e4ff;
  border-radius: 4px; background: #10143a; font-size: 0.85em; }
.ui-dialog-text { white-space: pre-wrap; }
.ui-dialog[data-value='shown']::after { content: '▾'; position: absolute; right: 0.6em; bottom: 0.2em;
  color: #ffd36a; }
.ui-dialog-choices { position: absolute; right: 0.4em; bottom: calc(100% + 0.6em); padding: 0.3em 0.4em; }
.ui-menu { min-width: 10em; padding: 0.4em; }
.ui-menu-title { text-align: center; padding: 0.2em 0.6em 0.4em; }
.ui-choice, .ui-menu-item { padding: 0.15em 0.6em 0.15em 1.4em; border-radius: 3px; cursor: pointer; }
.ui-choice[data-value='selected'], .ui-menu-item[data-value='selected'] { color: #ffd36a;
  background: rgba(255, 255, 255, 0.12); }
.ui-choice[data-value='selected']::before, .ui-menu-item[data-value='selected']::before { content: '▸';
  position: absolute; margin-left: -1em; }
.ui-menu-item[data-value='disabled'] { color: #6a6488; cursor: default; }
.ui-cursor { width: 14px; height: 14px; border: 2px solid #ffd36a; border-radius: 50%; box-shadow: 0 0 2px #0b0814;
  pointer-events: none; z-index: 10; }
`;

/** Adds the widgets' stylesheet to `doc` once. */
export function widgetStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}

/** An element `tag` of `className` in `parent`'s document, marked `data-ui=kind` (and `data-id`) when given. */
export function uiElement(
  parent: HTMLElement,
  className: string,
  kind?: string,
  id?: string,
  tag = 'div',
): HTMLElement {
  const el = parent.ownerDocument.createElement(tag);
  el.className = className;
  if (kind) el.dataset.ui = kind;
  if (id !== undefined) el.dataset.id = id;
  return el;
}

/** Sets `el`'s text when it differs. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** A number as a widget writes it: up to two decimals, no trailing zeros. */
const num = (value: number) => String(Math.round(value * 100) / 100);

/** How `createBar` makes a bar. */
export interface BarOptions {
  id: string;
  value: number;
  /** Its full value (1). */
  max?: number;
  /** Its text before the numbers (`HP`); none: the bar shows no text. */
  label?: string;
  /** Its fill (CSS; a red by default). */
  color?: string;
}

/** A filled bar in `parent` (see the file comment); `set(value)` moves its fill. */
export function createBar(parent: HTMLElement, options: BarOptions): Widget<number> {
  widgetStyle(parent.ownerDocument);
  const max = options.max ?? 1;
  const el = uiElement(parent, 'ui-bar', 'bar', options.id);
  const fill = uiElement(el, 'ui-bar-fill');
  const text = uiElement(el, 'ui-bar-text');
  el.append(fill, text);
  if (options.color) el.style.setProperty('--ui-color', options.color);
  parent.append(el);
  const set = (value: number) => {
    const share = num(Math.min(1, Math.max(0, max > 0 ? value / max : 0)));
    if (el.dataset.value !== share) {
      el.dataset.value = share;
      el.style.setProperty('--ui-fill', share);
    }
    setText(text, options.label === undefined ? '' : `${options.label} ${num(value)}/${num(max)}`);
  };
  set(options.value);
  return { el, set, remove: () => el.remove() };
}

/** How `createHearts` makes a row of hearts. */
export interface HeartsOptions {
  id: string;
  /** Hearts left (halves count). */
  hp: number;
  /** Hearts in all. */
  max: number;
}

/** A row of hearts in `parent` (see the file comment); `set([hp, max])` changes them. */
export function createHearts(parent: HTMLElement, options: HeartsOptions): Widget<readonly [number, number]> {
  widgetStyle(parent.ownerDocument);
  const el = uiElement(parent, 'ui-hearts', 'hearts', options.id);
  parent.append(el);
  const set = ([hp, max]: readonly [number, number]) => {
    const value = `${num(hp)}/${num(max)}`;
    if (el.dataset.value === value) return;
    el.dataset.value = value;
    const count = Math.max(0, Math.ceil(max));
    while (el.children.length > count) el.children[el.children.length - 1].remove();
    while (el.children.length < count) el.append(Object.assign(uiElement(el, 'ui-heart'), { textContent: '♥' }));
    Array.from(el.children as HTMLCollectionOf<HTMLElement>).forEach((heart, i) => {
      const left = hp - i;
      heart.dataset.fill = left >= 1 ? 'full' : left >= 0.5 ? 'half' : 'empty';
    });
  };
  set([options.hp, options.max]);
  return { el, set, remove: () => el.remove() };
}

/** How `createBox` makes a window frame. */
export interface UiBoxOptions {
  id: string;
  title?: string;
  text?: string;
}

/** A window frame in `parent` (see the file comment); `set(text)` changes its body. */
export function createBox(parent: HTMLElement, options: UiBoxOptions): Widget<string> & { readonly body: HTMLElement } {
  widgetStyle(parent.ownerDocument);
  const el = uiElement(parent, 'ui-box', 'box', options.id);
  if (options.title) el.append(Object.assign(uiElement(el, 'ui-box-title'), { textContent: options.title }));
  const body = uiElement(el, 'ui-box-body');
  el.append(body);
  parent.append(el);
  const set = (text: string) => setText(body, text);
  set(options.text ?? '');
  return { el, body, set, remove: () => el.remove() };
}

/** How long a held direction waits before it repeats, then between repeats (s). */
export const REPEAT = Object.freeze({ delay: 0.35, every: 0.1 });

/** A held direction's repeat: `(input, action, dt)` is true on the press and on each repeat while held. */
export function createRepeat(): (input: UiInput, action: string, dt: number) => boolean {
  const held = new Map<string, number>();
  const count = (t: number) => (t < REPEAT.delay ? 0 : 1 + Math.floor((t - REPEAT.delay) / REPEAT.every + 1e-9));
  return (input, action, dt) => {
    if (input.pressed(action)) return (held.set(action, 0), true);
    if (!input.held(action)) return (held.delete(action), false);
    const before = held.get(action) ?? 0;
    held.set(action, before + dt);
    return count(before + dt) > count(before);
  };
}

/** A gamepad's cursor over a page (see the file comment). */
export interface PadCursor {
  readonly el: HTMLElement;
  /** Where it is (CSS px from the root's top left), or null while it does not show. */
  readonly at: readonly [number, number] | null;
  /** Moves it for a frame of `dt` s while `open` (a panel is open); returns what its accept clicked, or null. */
  update(dt: number, open: boolean): Element | null;
  remove(): void;
}

/** The pad's cursor over `root` (see the file comment), from `input`. */
export function createPadCursor(root: HTMLElement, input: UiInput): PadCursor {
  widgetStyle(root.ownerDocument);
  const el = uiElement(root, 'ui-cursor ui-at', 'cursor');
  el.hidden = true;
  root.append(el);
  let at: [number, number] | null = null;
  return {
    el,
    get at() {
      return at;
    },
    update(dt, open) {
      if (!open || input.lastDevice !== 'gamepad') {
        [at, el.hidden] = [null, true];
        return null;
      }
      const rect = root.getBoundingClientRect();
      const stick = [input.strength('uiRight') - input.strength('uiLeft'), input.strength('uiDown') - input.strength('uiUp')]; // prettier-ignore
      const speed = 260 + 900 * (stick[0] * stick[0] + stick[1] * stick[1]);
      const [x, y] = at ?? [rect.width / 2, rect.height / 2];
      at = [Math.min(rect.width - 2, Math.max(0, x + stick[0] * speed * dt)), Math.min(rect.height - 2, Math.max(0, y + stick[1] * speed * dt))]; // prettier-ignore
      el.hidden = false;
      el.style.setProperty('--ui-x', num(at[0]));
      el.style.setProperty('--ui-y', num(at[1]));
      if (!input.pressed('uiAccept')) return null;
      const target = root.ownerDocument.elementFromPoint(rect.left + at[0], rect.top + at[1]) as HTMLElement | null;
      target?.click();
      return target;
    },
    remove: () => el.remove(),
  };
}
