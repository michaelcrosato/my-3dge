/**
 * @file The touch controls' layer (PLAN.md WP 3.12, ADR-0021: built, not tested): HTML over the canvas that shows
 * the floating stick while a thumb holds it, a fan of round buttons in the bottom right corner, and the menu button
 * in the top right, as shardfall lays them out. It draws only: the touch device (engine/input/devices/touch.ts) reads
 * the fingers, and the app (engine/app/engine.ts) passes what it reads to `update` each frame.
 *
 * A page names its buttons with a `touchlayout` entry, `{ buttons: [{ action, label?, hold? }], menu: true }`
 * (`defineTouchLayout`), and `createEngine({ touchLayout: 'touchlayout:<name>' })`; scenes are sim-side and name
 * none. Without a layout only the stick shows. Each button carries `data-action` (and `data-hold` for one that acts
 * while held), the menu button `data-tap="menu"`, which is how the device knows them.
 *
 * Slots fill in order (`TOUCH_SLOTS`, in units of k CSS px, the angles in screen space with y down as shardfall's
 * `Fan`): the main button, 68k across, centred 40k in from the right and bottom margins; an inner ring of 48k
 * buttons 92k from its centre at 180°, 225° and 270° (180° is straight left, 270° straight up); an outer ring at
 * 158k, at 205° and 245°. The menu button is 38k across. `k = clamp(min(width, height) / 390, 0.8, 1.25)` is the CSS
 * variable `--touch-k`; margins are 14k. engine/ui/touch.css styles it all: pressed buttons shrink to 94% and darken,
 * and buttons hide under open panels (`covered`), the menu button never.
 *
 * Invariants: the layer and its stick never take a touch (`pointer-events: none`); only the buttons do, up to 8 px
 * outside their rim. No `@example` runs here: it would be a touch test, which the owner ruled out (ADR-0021).
 *
 * Carried from `shardfall:crates/pav_app/src/touch.rs:385-475, 576-607` (the corner buttons, the stick's ring and
 * knob, the fan, `round_button`).
 *
 * @example
 * // defineTouchLayout('touchlayout:box', { buttons: [{ action: 'jump' }, { action: 'dash' }], menu: true });
 * // const layer = createTouchLayer(document, getTouchLayout('touchlayout:box'));
 * // layer.update({ on: true, stick: touch.stickView(), down: touch.down(), covered: false, width: 844, height: 390 });
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { show, type Schema } from '../core/schema';

/** One button of a touch layout. */
export interface TouchButtonSpec {
  /** The action it presses (a name of the page's action map). */
  action: string;
  /** What it shows; the action's name by default. */
  label?: string;
  /** It acts while held, as shardfall's skills: a tap presses once, a hold holds; without it, it acts on touch. */
  hold?: boolean;
}

/** How a touch layout is written. */
export interface TouchLayoutSpec {
  description?: string;
  /** The buttons, in slot order (`TOUCH_SLOTS`): the main one first. */
  buttons?: readonly TouchButtonSpec[];
  /** Whether the menu button shows (it pauses, then calls `createEngine`'s `onMenu`). */
  menu?: boolean;
}

/** A touch layout entry. */
export type TouchLayout = Entry & {
  readonly description: string;
  readonly buttons: readonly Readonly<Required<TouchButtonSpec>>[];
  readonly menu: boolean;
};

/** Where a button sits: its centre's distance from the right and bottom edges, and its diameter, in k CSS px. */
export interface TouchSlot {
  right: number;
  bottom: number;
  size: number;
}

/** The main button's centre from the right and bottom edges, in k: a 14k margin, then 40k in. */
const CORNER = 14 + 40;

/** A slot `radius` k from the main button's centre at `degrees` (screen space, y down), `size` k across. */
function fan(radius: number, degrees: number, size: number): TouchSlot {
  const a = (degrees * Math.PI) / 180;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { right: round(CORNER - Math.cos(a) * radius), bottom: round(CORNER - Math.sin(a) * radius), size };
}

/** The button slots, in fill order (see the file comment). */
export const TOUCH_SLOTS: readonly TouchSlot[] = Object.freeze([
  { right: CORNER, bottom: CORNER, size: 68 },
  fan(92, 180, 48),
  fan(92, 225, 48),
  fan(92, 270, 48),
  fan(158, 205, 48),
  fan(158, 245, 48),
]);

/** The scale of the touch controls for a screen `width` × `height` CSS px: `--touch-k`. */
export function touchScale(width: number, height: number): number {
  return Math.min(1.25, Math.max(0.8, Math.min(width, height) / 390));
}

/** The fields of a `touchlayout` entry. */
const TOUCH_LAYOUT_FIELDS = {
  description: { type: 'string', default: '', description: 'What the layout is for, in plain words.' },
  buttons: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        action: { type: 'string', required: true, description: 'The action the button presses.' },
        label: { type: 'string', default: '', description: "What the button shows; the action's name when empty." },
        hold: { type: 'boolean', default: false, description: 'It acts while held: a tap presses once, a hold holds.' },
      },
    },
    description: 'The buttons in slot order, the main one first: at most six (the fan has six slots).',
  },
  menu: {
    type: 'boolean',
    default: false,
    description: 'Whether the menu button shows: it pauses, then calls onMenu.',
  },
} as const satisfies Schema;

/** The problems of a layout beyond its fields. */
function layoutProblems(layout: TouchLayout): string[] {
  const problems: string[] = [];
  if (layout.buttons.length > TOUCH_SLOTS.length) {
    problems.push(`buttons holds ${layout.buttons.length}; the fan has ${TOUCH_SLOTS.length} slots`);
  }
  layout.buttons.forEach((button, i) => {
    if (!/^[a-z][A-Za-z0-9]*$/.test(button.action)) {
      problems.push(`buttons[${i}].action is ${show(button.action)}; name an action (a lower-case word: jump)`);
    }
    if (layout.buttons.findIndex((other) => other.action === button.action) !== i) {
      problems.push(`buttons[${i}] repeats the action ${button.action}`);
    }
  });
  return problems;
}

/** Declares the kind `touchlayout` on `registry` unless it has it. */
export function touchLayoutKind(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('touchlayout')) return;
  registry.defineKind('touchlayout', {
    description:
      "A page's touch controls: the buttons in the corner fan, each pressing an action, and whether the menu button shows.",
    fields: TOUCH_LAYOUT_FIELDS,
    defineWith: "defineTouchLayout('touchlayout:<name>', { buttons: [{ action: 'jump' }], menu: true })",
    check: (entry) => layoutProblems(entry as TouchLayout),
  });
}

/** Registers a touch layout (on the shared registry by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineTouchLayout(id: string, spec: TouchLayoutSpec, registry: Registry = sharedRegistry): TouchLayout {
  touchLayoutKind(registry);
  return registry.def('touchlayout', id, spec as unknown as Record<string, unknown>) as TouchLayout;
}

/** The touch layout `id`. Throws `CORE_NO_ENTRY` naming the closest ids. */
export function getTouchLayout(id: string, registry: Registry = sharedRegistry): TouchLayout {
  touchLayoutKind(registry);
  return registry.get('touchlayout', id) as TouchLayout;
}

/** What the layer shows this frame. */
export interface TouchLayerState {
  /** Whether touch mode is on: the layer shows only then. */
  on: boolean;
  /** The stick's centre and knob in client CSS px, or null without a thumb on it. */
  stick: { anchor: readonly number[]; knob: readonly number[] } | null;
  /** The controls under a finger, by name (`data-action` or `data-tap`): they look pressed. */
  down: readonly string[];
  /** An open panel covers the game: the buttons and the stick hide, the menu button stays. */
  covered: boolean;
  /** The screen's CSS size, for `--touch-k`. */
  width: number;
  height: number;
}

/** The touch controls' layer in a page. */
export interface TouchLayer {
  /** The layer's root element (`.touch-layer`). */
  readonly root: HTMLElement;
  /** Shows `state`. Call once per frame. */
  update(state: TouchLayerState): void;
  /** Removes the layer. */
  dispose(): void;
}

/** Builds the layer for `layout` (null: only the stick) and appends it to `document.body`. */
export function createTouchLayer(document: Document, layout: TouchLayout | null): TouchLayer {
  const root = document.createElement('div');
  root.className = 'touch-layer';
  root.hidden = true;
  const stick = document.createElement('div');
  stick.className = 'touch-stick';
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  stick.hidden = true;
  knob.hidden = true;
  root.append(stick, knob);
  const controls: HTMLElement[] = [];
  const control = (className: string, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = `touch-control ${className}`;
    button.textContent = label;
    controls.push(button);
    root.append(button);
    return button;
  };
  (layout?.buttons ?? []).forEach((spec, i) => {
    const slot = TOUCH_SLOTS[i];
    const button = control('touch-button', spec.label || spec.action);
    button.dataset.action = spec.action;
    if (spec.hold) button.dataset.hold = '';
    button.style.setProperty('--right', String(slot.right));
    button.style.setProperty('--bottom', String(slot.bottom));
    button.style.setProperty('--size', String(slot.size));
  });
  if (layout?.menu) {
    const menu = control('touch-menu', '');
    menu.dataset.tap = 'menu';
    menu.setAttribute('aria-label', 'Menu');
  }
  document.body.append(root);
  let k = '';
  const place = (element: HTMLElement, at: readonly number[] | undefined) => {
    element.hidden = !at;
    if (at) element.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, -50%)`;
  };
  return {
    root,
    update(state) {
      if (root.hidden === state.on) root.hidden = !state.on;
      if (!state.on) return;
      const scale = String(Math.round(touchScale(state.width, state.height) * 1000) / 1000);
      if (scale !== k) document.documentElement.style.setProperty('--touch-k', (k = scale));
      root.classList.toggle('covered', state.covered);
      place(stick, state.stick?.anchor);
      place(knob, state.stick?.knob);
      const down = new Set(state.down);
      for (const element of controls) {
        element.classList.toggle('pressed', down.has(element.dataset.action ?? element.dataset.tap ?? ''));
      }
    },
    dispose: () => root.remove(),
  };
}
