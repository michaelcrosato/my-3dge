/**
 * @file The UI widgets page's module (tests/pages/ui.html), the browser half of tests/e2e/ui.spec.ts (PLAN.md WP 10.6):
 * the overlay (engine/ui/overlay.ts) over the page's canvas with a health bar and hearts in the top-left place, a quest
 * box in the top-right one, a dialog, a pause menu and a settings panel (`#panel`) the gamepad's cursor works
 * (engine/ui/{widgets,dialog,menu}.ts), all reading the page's real input (engine/input/input.ts) over its window, with
 * gamepads through a stubbed `navigator.getGamepads` whose slots the tests fill with scripted pads.
 *
 * The menu's `Pick` item has an id, so picking it sends it as input: `engine.actions.run('pick', { from: 'menu' })`
 * on the page's headless engine, whose scene's own dev action `pick` the session records, so its replay holds the pick.
 * Nothing runs on its own: a test calls `__ui.frame(dt)`, which moves the scripted pads a frame, samples the input,
 * runs the dialog, then the menu while no modal dialog is open, then the pad's cursor while the panel is open, places
 * the overlay and steps the engine once. `window.__engine` is the headless engine (its `ready` for the fixture).
 */
import '../../engine/dev/members';
import { PerspectiveCamera } from 'three/webgpu';
import { createHeadless } from '../../engine/app/headless';
import { createRegistry } from '../../engine/core/registry';
import type { GamepadLike } from '../../engine/input/devices/gamepad';
import { createScriptedGamepad, type ScriptedGamepad } from '../../engine/input/devices/padScript';
import { createInput } from '../../engine/input/input';
import { defineScene } from '../../engine/sim/scene';
import { createDialog, type SayOptions } from '../../engine/ui/dialog';
import { createMenu } from '../../engine/ui/menu';
import { createOverlay } from '../../engine/ui/overlay';
import { createBar, createBox, createHearts, createPadCursor, type UiCue } from '../../engine/ui/widgets';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const button = document.querySelector<HTMLButtonElement>('#panel-button')!;
button.addEventListener('click', () => button.toggleAttribute('data-pressed'));

/** The gamepad slots `navigator.getGamepads` hands out, and the scripts moving them. */
const slots: (GamepadLike | null)[] = [null, null, null, null];
const pads = new Map<number, ScriptedGamepad>();
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => slots });

const engine = await createHeadless({
  scene: defineScene('test:ui', { setup: () => {}, actions: { pick: () => {} } }, createRegistry()),
});
const input = createInput({ element: canvas });
const ui = createOverlay({ canvas });
const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
const cues: UiCue[] = [];
const sound = (cue: UiCue) => void cues.push(cue);
const sent: string[] = [];
const picks: number[] = [];

const hp = createBar(ui.root, { id: 'hp', value: 30, max: 40, label: 'HP' });
const hearts = createHearts(ui.root, { id: 'life', hp: 2.5, max: 3 });
const quest = createBox(ui.root, { id: 'quest', title: 'Quest', text: 'Find the key' });
ui.attach(hp.el, 'top-left');
ui.attach(hearts.el, 'top-left');
ui.attach(quest.el, 'top-right');
const dialog = createDialog(ui.root, { input, sound });
const menu = createMenu(ui.root, ['Resume', { label: 'Load', disabled: true }, { label: 'Pick', id: 'pick' }, 'Quit'], {
  input,
  sound,
  id: 'pause',
  title: 'Paused',
  send(id) {
    sent.push(id);
    (engine.actions as { run(name: string, args: unknown): unknown }).run(id, { from: 'menu' });
  },
  onPick: (i) => void picks.push(i),
});
const cursor = createPadCursor(ui.root, input);

/** What the UI spec drives. */
const page = {
  ui,
  input,
  dialog,
  menu,
  cursor,
  cues,
  sent,
  picks,
  choices: [] as number[],
  /** Opens the dialog with `text` (its choices recorded in `choices`). */
  say(text: string | string[], options: SayOptions = {}) {
    dialog.say(text, { ...options, onChoice: (i) => void page.choices.push(i) });
  },
  /** Opens or closes the settings panel the pad's cursor works. */
  panel(open: boolean) {
    panel.hidden = !open;
  },
  /** One frame of `dt` s (see the file comment); returns the id of what the pad's cursor clicked, if anything. */
  frame(dt = 1 / 60) {
    for (const pad of pads.values()) pad.next();
    input.sample();
    const talking = dialog.update(dt);
    if (!talking) menu.update(dt);
    const clicked = cursor.update(dt, !panel.hidden);
    ui.update(camera, dt);
    engine.step(1);
    return clicked?.id ?? null;
  },
  /** Plugs a scripted pad into slot `index`, as connecting one does. */
  plug(script: string, index = 0) {
    const pad = createScriptedGamepad(script, { index });
    pads.set(index, pad);
    slots[index] = pad.gamepad;
    window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad.gamepad }));
  },
};

Object.assign(window, { __ui: page, __engine: engine });
