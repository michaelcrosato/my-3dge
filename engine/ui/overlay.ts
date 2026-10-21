/**
 * @file The game's HTML/CSS overlay (PLAN.md §6.7, WP 6.5; doctrine: WebGPU only): what a game shows over the canvas
 * as page elements, never drawn on the GPU. `createOverlay({ canvas })` puts a root over the canvas, sized to it each
 * frame, holding world-anchored labels and damage numbers (engine/ui/labels.ts), HUD lines in six places and a
 * crosshair. Call `update(camera, dt)` once per frame after drawing, with the camera the frame was drawn with; tests
 * and agents read it all through `state()` (engine/ui/state.ts) or DOM queries on `[data-ui]`.
 *
 * Elements: `[data-ui=label]` (`data-id`), `[data-ui=damage]` (`data-value`), `[data-ui=hud]` (`data-id`, and
 * `data-keyboard` for a key hint), `[data-ui=crosshair]` while it shows; WP 10.6's widgets (engine/ui/widgets.ts,
 * dialog.ts, menu.ts) in the HUD's places (`attach`) or over the root. Text uses the system font. The overlay's
 * stylesheet is one `<style id="ui-overlay-style">` it adds to the page (no engine module imports a `.css` file: tsx,
 * which runs every `x` command, cannot load one). Damage numbers animate with CSS keyframes, paused and driven by the
 * overlay's clock (`--ui-age`, a negative `animation-delay`), so a frame shows the same look for the same age in
 * every run.
 *
 * Touch screens (WP 3.12's rules; built, not tested, ADR-0021): in touch mode (the `touch` class engine/ui/chrome.ts
 * puts on the page), text scales with `--touch-k` (the overlay scales its own root, so its lines carry no
 * `data-hud`), key hints (`data-keyboard`) are hidden, the HUD's bottom and top-right places move clear of the
 * buttons' corner and the menu button, and a label or number whose centre falls on a button of the touch layer
 * (engine/ui/touch.ts's slots at `touchScale`) is hidden.
 *
 * Invariants: presentation only: the overlay reads the camera and the page and never the sim, so it cannot change
 * the hash (tests/e2e/overlay.spec.ts plays a replay with it); it takes no pointer events; `dispose()` removes it.
 *
 * Carried from `my-3d2dge:src/stress-world/35-effects.js:133-149` (`drawOverlay`: numbers, the note line at the top,
 * a crosshair while the mouse steers), as behaviour, in HTML/CSS instead of a pixel-font canvas.
 *
 * @example
 * // browser: the overlay needs a page
 * // const ui = createOverlay({ canvas });
 * // ui.label('Hero', { at: () => hero.position });
 * // ui.damage(12, { at: [2, 1.8, 0] });
 * // ui.hud('hint', 'Space: jump', { at: 'bottom', keys: true });
 * // ui.update(camera, dt); // each frame, after drawing
 * // ui.state().elements; // [{ kind: 'label', id: 'label:1', text: 'Hero', at: [412.5, 230], box: […], visible: true }, …]
 * @see engine/ui/overlay.test.ts
 * @see tests/e2e/overlay.spec.ts
 */
import { codeError, defineCodes } from '../core/log';
import {
  createWorldLayer,
  type DamageOptions,
  type Label,
  type LabelOptions,
  type OverlayCamera,
  type WorldFrame,
} from './labels';
import { uiState, type UiState } from './state';
import { TOUCH_SLOTS, touchScale } from './touch';

/** The error codes of the overlay. */
export const OVERLAY_CODES = defineCodes('ui', {
  UI_BAD_PLACE: {
    template: 'hud "{id}" asks for the place {got}',
    fix: 'use one of top-left, top, top-right, bottom-left, bottom, bottom-right',
  },
  UI_BAD_DT: {
    template: 'update(camera, dt) got dt {dt}',
    fix: "pass the seconds since the last frame, 0 or more (the frame loop's dt)",
  },
});

/** Where a HUD line goes: a corner, or the middle of the top or bottom edge. */
export type HudPlace = 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right';

/** Every HUD place, in the order the overlay adds them. */
export const HUD_PLACES: readonly HudPlace[] = [
  'top-left',
  'top',
  'top-right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

/** How a HUD line is shown. */
export interface HudOptions {
  /** Its place (`top-left`); lines in one place stack in the order they were first set. */
  at?: HudPlace;
  /** A key hint (false): marked `data-keyboard`, so touch screens hide it. */
  keys?: boolean;
  /** Its text colour (CSS). */
  color?: string;
}

/** How an overlay is made. */
export interface OverlayOptions {
  /** The canvas the game draws on: the overlay covers it, and follows its size and place each frame. */
  canvas: HTMLCanvasElement;
}

/** The overlay over one canvas (see the file comment). */
export interface Overlay {
  /** The root element (`.ui-overlay`), over the canvas. */
  readonly root: HTMLElement;
  /** Adds a label that follows a point in the world. */
  label(text: string, options: LabelOptions): Label;
  /** Shows a damage number, rising from `options.at` and stacking with the last (see engine/ui/labels.ts). */
  damage(value: number | string, options: DamageOptions): void;
  /** Sets the HUD line `id` to `text`; null or '' removes it. */
  hud(id: string, text: string | null, options?: HudOptions): void;
  /** Puts a widget's element (engine/ui/widgets.ts: a bar, hearts, a box) in the HUD place `at`, after what is there. */
  attach(element: HTMLElement, at?: HudPlace): void;
  /** Shows or hides the crosshair at the canvas's centre. */
  crosshair(on: boolean): void;
  /** Places everything for this frame: `camera` as drawn, `dt` seconds since the last frame. */
  update(camera: OverlayCamera, dt: number): void;
  /** The overlay's elements as text, places, boxes and visibility (engine/ui/state.ts). */
  state(): UiState;
  /** Removes the overlay (and its stylesheet, with the page's last overlay). */
  dispose(): void;
}

/** The stylesheet's element id. */
const STYLE_ID = 'ui-overlay-style';

/** The touch buttons' slop past their rim and a label's half-height beyond that, in k CSS px (touch.rs:114). */
const TOUCH_SLOP = 8;
const TOUCH_CLEAR = 12;

/** No touch controls: off touch screens. */
const NO_CIRCLES = { buttons: [] as number[][], menu: null };

/** The overlay's stylesheet (see the file comment). */
const STYLE = `
.ui-overlay { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; contain: strict;
  pointer-events: none;
  font: 600 16px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #f0e3c6;
  -webkit-user-select: none; user-select: none; }
.touch .ui-overlay { font-size: calc(var(--touch-k, 1) * 16px); }
.ui-overlay [hidden] { display: none !important; }
.touch .ui-overlay [data-keyboard] { display: none !important; }
.ui-layer { position: absolute; inset: 0; }
.ui-at { position: absolute; left: 0; top: 0; white-space: nowrap;
  transform: translate(-50%, -50%) translate(calc(var(--ui-x, 0) * 1px), calc(var(--ui-y, 0) * 1px)); }
.ui-label { padding: 0.1em 0.4em; border-radius: 0.3em; background: rgba(11, 8, 20, 0.55); font-size: 0.8125em;
  text-shadow: 0 1px 1px #0b0814; }
.ui-damage { transform: translate(-50%, calc(-50% - var(--ui-slot, 0) * 100%))
  translate(calc(var(--ui-x, 0) * 1px), calc(var(--ui-y, 0) * 1px));
  font-size: calc(var(--ui-scale, 1) * 1.25em); font-weight: 800; line-height: 1; color: #fff2c4;
  font-variant-numeric: tabular-nums; text-shadow: -1px -1px 0 #0b0814, 1px -1px 0 #0b0814, -1px 1px 0 #0b0814,
  1px 1px 0 #0b0814, 0 2px 0 #0b0814; }
.ui-damage > span { display: inline-block; animation-name: ui-damage-pop, ui-damage-blink;
  animation-duration: calc(var(--ui-life, 0.8) * 1s); animation-timing-function: ease-out, step-end;
  animation-delay: calc(var(--ui-age, 0) * -1s); animation-fill-mode: both; animation-play-state: paused; }
@keyframes ui-damage-pop { 0% { transform: scale(1.45); } 18%, 100% { transform: scale(1); } }
@keyframes ui-damage-blink { 0% { opacity: 1; } 75% { opacity: 0; } 81.25% { opacity: 1; } 87.5% { opacity: 0; }
  93.75%, 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ui-damage > span { animation-name: none; } }
.ui-hud-block { position: absolute; display: flex; flex-direction: column; gap: 0.15em; max-width: 45%;
  text-shadow: 0 1px 2px #0b0814; }
.ui-hud { white-space: pre-wrap; }
.ui-hud-block[data-at='top-left'] { left: 0.75em; top: 0.5em; align-items: flex-start; }
.ui-hud-block[data-at='top'] { left: 50%; top: 0.5em; transform: translateX(-50%); align-items: center;
  text-align: center; }
.ui-hud-block[data-at='top-right'] { right: 0.75em; top: calc(0.5em + var(--ui-menu, 0px)); align-items: flex-end;
  text-align: right; }
.ui-hud-block[data-at='bottom-left'] { left: 0.75em; bottom: 0.5em; align-items: flex-start; }
.ui-hud-block[data-at='bottom'] { left: 50%; bottom: calc(0.5em + var(--ui-corner, 0px)); transform: translateX(-50%);
  align-items: center; text-align: center; }
.ui-hud-block[data-at='bottom-right'] { right: 0.75em; bottom: calc(0.5em + var(--ui-corner, 0px));
  align-items: flex-end; text-align: right; }
.ui-crosshair { width: 18px; height: 18px; filter: drop-shadow(0 0 1px #0b0814) drop-shadow(0 0 1px #0b0814); }
.ui-crosshair::before, .ui-crosshair::after { content: ''; position: absolute; background: #f0e3c6; }
.ui-crosshair::before { left: 0; top: 8px; width: 18px; height: 2px; }
.ui-crosshair::after { left: 8px; top: 0; width: 2px; height: 18px; }
`;

/** A `div` with `className`, made by `doc`. */
function div(doc: Document, className: string): HTMLElement {
  const el = doc.createElement('div');
  el.className = className;
  return el;
}

/**
 * The circles the touch layer's controls cover, with room for a label's half-height (viewport CSS px: x, y, radius):
 * its buttons, in engine/ui/touch.ts's slots, and its menu button, 38k across, 14k in from the top right corner.
 */
function touchCircles(doc: Document, width: number, height: number): { buttons: number[][]; menu: number[] | null } {
  const k = touchScale(width, height);
  const count = doc.querySelectorAll('.touch-layer .touch-button').length;
  const buttons = TOUCH_SLOTS.slice(0, count).map((slot) => [
    width - slot.right * k,
    height - slot.bottom * k,
    (slot.size / 2 + TOUCH_SLOP + TOUCH_CLEAR) * k,
  ]);
  const centre = (14 + 38 / 2) * k;
  const menu = doc.querySelector('.touch-layer .touch-menu')
    ? [width - centre, centre, (38 / 2 + TOUCH_SLOP + TOUCH_CLEAR) * k]
    : null;
  return { buttons, menu };
}

/** Builds the overlay over `options.canvas` (see the file comment). */
export function createOverlay(options: OverlayOptions): Overlay {
  const { canvas } = options;
  const doc = canvas.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.append(style);
  }
  const root = div(doc, 'ui-overlay');
  const labels = div(doc, 'ui-layer ui-labels');
  const numbers = div(doc, 'ui-layer ui-numbers');
  const hudLayer = div(doc, 'ui-layer ui-huds');
  const cross = div(doc, 'ui-crosshair ui-at');
  cross.hidden = true;
  root.append(labels, numbers, hudLayer, cross);
  if (canvas.parentNode) canvas.after(root);
  else doc.body.append(root);

  const world = createWorldLayer(labels, numbers);
  const blocks = new Map<HudPlace, HTMLElement>();
  const lines = new Map<string, { el: HTMLElement; color: string }>();
  const box = { left: NaN, top: NaN, width: NaN, height: NaN };
  const centre = ['', ''];
  let corner = '';
  let menu = '';

  /** The block of `place`, made on first use, kept in HUD_PLACES order. */
  const block = (place: HudPlace) => {
    let el = blocks.get(place);
    if (!el) {
      el = div(doc, 'ui-hud-block');
      el.dataset.at = place;
      blocks.set(place, el);
      const after = HUD_PLACES.slice(HUD_PLACES.indexOf(place) + 1).find((later) => blocks.has(later));
      hudLayer.insertBefore(el, after ? blocks.get(after)! : null);
    }
    return el;
  };
  /** Follows the canvas's size and place; returns its client rect. */
  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      if (box[key] !== rect[key]) root.style[key] = `${(box[key] = rect[key])}px`;
    }
    return rect;
  };
  /** In touch mode: clears the HUD off the buttons and returns the test for world elements under them. */
  const touchFrame = (rect: DOMRect): WorldFrame['blocked'] => {
    const view = doc.defaultView;
    const on = view !== null && doc.documentElement.classList.contains('touch');
    const { buttons, menu: menuButton } = on ? touchCircles(doc, view.innerWidth, view.innerHeight) : NO_CIRCLES;
    const fanTop = Math.min(...buttons.map(([, y, r]) => y - r));
    const clearBottom = buttons.length > 0 ? `${Math.max(0, rect.bottom - fanTop)}px` : '';
    const clearTop = menuButton ? `${Math.max(0, menuButton[1] + menuButton[2] - rect.top)}px` : '';
    if (clearBottom !== corner) root.style.setProperty('--ui-corner', (corner = clearBottom));
    if (clearTop !== menu) root.style.setProperty('--ui-menu', (menu = clearTop));
    const circles = menuButton ? [...buttons, menuButton] : buttons;
    if (circles.length === 0) return null;
    return (x, y) => circles.some(([cx, cy, r]) => Math.hypot(x + rect.left - cx, y + rect.top - cy) < r);
  };

  return {
    root,
    label: (text, labelOptions) => world.label(text, labelOptions),
    damage: (value, damageOptions) => world.damage(value, damageOptions),
    hud(id, text, hudOptions = {}) {
      const place = hudOptions.at ?? 'top-left';
      if (!HUD_PLACES.includes(place)) throw codeError('UI_BAD_PLACE', { id, got: JSON.stringify(place) });
      let line = lines.get(id);
      if (text === null || text === '') {
        line?.el.remove();
        lines.delete(id);
        return;
      }
      if (!line) {
        line = { el: div(doc, 'ui-hud'), color: '' };
        line.el.dataset.ui = 'hud';
        line.el.dataset.id = id;
        lines.set(id, line);
      }
      const { el } = line;
      const into = block(place);
      if (el.parentNode !== into) into.append(el);
      if (el.textContent !== text) el.textContent = text;
      el.toggleAttribute('data-keyboard', hudOptions.keys === true);
      const color = hudOptions.color ?? '';
      if (line.color !== color) el.style.color = line.color = color;
    },
    attach(element, at = 'top-left') {
      if (!HUD_PLACES.includes(at)) throw codeError('UI_BAD_PLACE', { id: element.dataset.id ?? '', got: JSON.stringify(at) }); // prettier-ignore
      block(at).append(element);
    },
    crosshair(on) {
      cross.hidden = !on;
      if (on) cross.dataset.ui = 'crosshair';
      else delete cross.dataset.ui;
    },
    update(camera, dt) {
      if (!(dt >= 0 && Number.isFinite(dt))) throw codeError('UI_BAD_DT', { dt });
      if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld?.();
      const rect = fit();
      const [x, y] = [rect.width, rect.height].map((v) => String(Math.round(v * 50) / 100));
      if (x !== centre[0]) cross.style.setProperty('--ui-x', (centre[0] = x));
      if (y !== centre[1]) cross.style.setProperty('--ui-y', (centre[1] = y));
      world.place({ camera, width: rect.width, height: rect.height, dt, blocked: touchFrame(rect) });
    },
    state: () => uiState(root),
    dispose() {
      root.remove();
      if (!doc.querySelector('.ui-overlay')) doc.getElementById(STYLE_ID)?.remove();
    },
  };
}
