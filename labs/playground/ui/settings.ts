/**
 * @file The playground's settings screen (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25): a panel over the game, in the
 * look of the engine's menus (engine/ui/widgets.ts's box), with a row for each thing the player sets (`SETTING_ROWS`):
 * the camera mode, the field of view, the mouse's sensitivity and its inversion, the movement profile, the block's
 * time of day and the minutes a day lasts (labs/playground/scenes/site.ts), the rain and the dust (weather.ts), the
 * look, the quality and whether the frame rate may move it (the governor, engine/dev/governor.ts), and the four audio
 * levels; then the controls: each action the player answers with its key, a button to rebind it, and one to reset
 * them all.
 *
 * A setting's row takes its control from the setting's own schema (`describe('setting', path)`): a slider over its
 * minimum and maximum, a box for a boolean, a list of its `enum`; the camera and the look list the playground's modes
 * and looks (labs/playground/views.ts). A change calls `onChange(row, value)`, which the front end applies and keeps
 * (labs/playground/ui/frontEnd.ts); a row that acts on the run (`release`: the clock's) reports its slider once let
 * go, not at each step of a drag. Time of day and Day length set the block's clock live (`clockAfter`: the `daytime`
 * dev action's hour and rate), the rain and the dust are view settings that show at once. A rebind waits for the next key (`input.listen`) and puts it on that action in
 * every camera mode's map (`input.bindingsFor`, so each mode keeps its own map and the player's keys hold in all of
 * them); a key another action holds, or one the page keeps, is refused, the row naming why.
 *
 * Elements: `[data-ui=settings]`, a `[data-ui=setting]` per row (`data-id` its id, `data-value` its value, its control
 * an `input` or a `select` inside), a `[data-ui=binding]` per action (`data-id` the action, `data-value` its keys, its
 * button `[data-ui=item][data-id=rebind:<action>]`, its note `[data-ui=binding-note]`), and the buttons
 * `[data-ui=item]` `reset-controls` and `back`.
 *
 * Invariants: presentation only: it shows values and reports changes; it changes nothing itself but the bindings.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // browser: the panel needs a page
 * // const panel = createSettings(ui.root, { values, schema, input, onChange: (row, value) => …, onBack: () => … });
 * // document.querySelector('[data-ui=setting][data-id="cam.fov"] input').value; // '90'
 * @see tests/e2e/playground.spec.ts
 */
import type { Input } from '../../../engine';
import { PLAYGROUND_ACTIONS, PLAYGROUND_MAPS } from '../controls';
import { dayRate } from '../scenes/site';
import { PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from '../views';
import { PREF_BUSES } from './prefs';

/** What a row sets: a setting by path, the camera mode, or a bus's level. */
export interface SettingRow {
  readonly id: string;
  readonly label: string;
  readonly kind: 'setting' | 'camera' | 'look' | 'volume';
  /** Whether its slider reports once let go (a change that acts on the run), not at each step of a drag. */
  readonly release?: boolean;
}

/** The rows, in the screen's order (see the file comment). */
export const SETTING_ROWS: readonly SettingRow[] = [
  { id: 'camera', label: 'Camera', kind: 'camera' },
  { id: 'cam.fov', label: 'Field of view', kind: 'setting' },
  { id: 'input.sensitivity', label: 'Mouse sensitivity', kind: 'setting' },
  { id: 'input.invert', label: 'Invert the mouse', kind: 'setting' },
  { id: 'playground.movement', label: 'Movement (starts the scene again)', kind: 'setting' },
  { id: 'playground.hour', label: 'Time of day (the hour: 12 noon, 22 night)', kind: 'setting', release: true },
  { id: 'playground.day', label: 'Minutes a day lasts (0 holds the hour)', kind: 'setting', release: true },
  { id: 'playground.rain', label: 'Rain', kind: 'setting' },
  { id: 'playground.dust', label: 'Dust indoors', kind: 'setting' },
  { id: 'post.look', label: 'Look', kind: 'look' },
  { id: 'quality', label: 'Quality', kind: 'setting' },
  { id: 'gfx.governor', label: 'Quality follows the frame rate (auto)', kind: 'setting' },
  ...PREF_BUSES.map((bus): SettingRow => ({ id: `volume:${bus}`, label: `Volume: ${bus}`, kind: 'volume' })),
];

/** The actions the controls list, with their names: the four moves, then those the player answers (controls.ts). */
export const CONTROL_ACTIONS: Readonly<Record<string, string>> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  ...Object.fromEntries(Object.entries(PLAYGROUND_ACTIONS).map(([action, what]) => [action, what.split(/[:(]/)[0].trim()])), // prettier-ignore
};

/**
 * The block's clock once Time of day or Day length (`id`) changed to `value`, the other read through `setting`: the
 * `daytime` dev action's `{ hour, rate }` (labs/playground/scenes/site.ts), as the scene's start reads them; null for
 * another row.
 */
export function clockAfter(
  id: string,
  value: unknown,
  setting: (path: string) => unknown,
): { hour: number; rate: number } | null {
  // prettier-ignore
  if (id !== 'playground.hour' && id !== 'playground.day') return null;
  const [hour, day] =
    id === 'playground.hour' ? [value, setting('playground.day')] : [setting('playground.hour'), value];
  return { hour: Number(hour), rate: dayRate(Number(day)) };
}

/** A setting's schema as the screen reads it: its type, range and choices. */
export interface RowSchema {
  readonly type: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
}

/** How the screen is made. */
export interface SettingsOptions {
  /** Each row's value now, by its id. */
  values: Readonly<Record<string, string | number | boolean>>;
  /** A setting's schema, by path (the inspector's `describe`). */
  schema(path: string): RowSchema;
  /** The page's input: the keys' labels, listening for a key, and every mode's bindings. */
  input: Pick<Input, 'listen' | 'bindingsFor' | 'bindings'>;
  onChange(row: SettingRow, value: string | number | boolean): void;
  onBack(): void;
}

/** The settings screen. */
export interface SettingsScreen {
  readonly el: HTMLElement;
  /** Shows `value` as `row`'s, as when it changed elsewhere (a key switching the look). */
  show(id: string, value: string | number | boolean): void;
  remove(): void;
}

/** Makes the settings screen in `parent` (see the file comment). */
export function createSettings(parent: HTMLElement, options: SettingsOptions): SettingsScreen {
  const doc = parent.ownerDocument;
  const el = Object.assign(doc.createElement('div'), { className: 'ui-panel ui-box pg-settings' });
  el.dataset.ui = 'settings';
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) =>
    Object.assign(doc.createElement(tag), props) as HTMLElementTagNameMap[K];
  el.append(make('h2', { textContent: 'Settings' }));
  const rows = new Map<string, HTMLElement>();
  for (const row of SETTING_ROWS) {
    const line = make('label', { className: 'pg-row' });
    line.dataset.ui = 'setting';
    line.dataset.id = row.id;
    line.append(make('span', { textContent: row.label }), control(row, line));
    el.append(line);
    rows.set(row.id, line);
  }
  el.append(make('h3', { textContent: 'Controls' }));
  const bindingRows = Object.entries(CONTROL_ACTIONS).map(([action, name]) => {
    const line = make('div', { className: 'pg-row' });
    line.dataset.ui = 'binding';
    line.dataset.id = action;
    const button = make('button', { type: 'button' });
    button.dataset.ui = 'item';
    button.dataset.id = `rebind:${action}`;
    const note = make('span');
    note.dataset.ui = 'binding-note';
    button.addEventListener('click', () => void rebind(action, button, note));
    line.append(make('span', { textContent: name }), button, note);
    el.append(line);
    return { action, line, button };
  });
  const button = (id: string, text: string, click: () => void) => {
    const made = make('button', { type: 'button', textContent: text });
    made.dataset.ui = 'item';
    made.dataset.id = id;
    made.addEventListener('click', click);
    el.append(made);
  };
  button('reset-controls', 'Reset the controls', () => {
    for (const map of Object.values(PLAYGROUND_MAPS)) options.input.bindingsFor(map).reset();
    drawBindings();
  });
  button('back', 'Back', () => options.onBack());
  parent.append(el);
  drawBindings();

  /** The control for `row`: a slider, a box or a list, its value written back to `line`. */
  function control(row: SettingRow, line: HTMLElement): HTMLElement {
    const value = options.values[row.id];
    line.dataset.value = String(value);
    const report = (next: string | number | boolean) => {
      line.dataset.value = String(next);
      options.onChange(row, next);
    };
    const choices =
      row.kind === 'camera'
        ? PLAYGROUND_CAMERAS.map((mode) => mode.name)
        : row.kind === 'look'
          ? PLAYGROUND_LOOKS
          : row.kind === 'setting'
            ? options.schema(row.id).enum
            : undefined;
    if (choices) {
      const select = make('select');
      for (const choice of choices) select.append(make('option', { value: choice, textContent: choice.replace(/^look:playground-|^movement:/, '') })); // prettier-ignore
      select.value = String(value);
      select.addEventListener('change', () => report(select.value));
      return select;
    }
    const schema: RowSchema =
      row.kind === 'volume' ? { type: 'number', minimum: 0, maximum: 1 } : options.schema(row.id);
    if (schema.type === 'boolean') {
      const box = make('input', { type: 'checkbox', checked: value === true });
      box.addEventListener('change', () => report(box.checked));
      return box;
    }
    const [min, max] = [schema.minimum ?? 0, schema.maximum ?? 1];
    const step = max - min > 10 ? 1 : (max - min) / 20;
    const slider = make('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    slider.value = String(value);
    slider.addEventListener(row.release ? 'change' : 'input', () => report(Number(slider.value)));
    return slider;
  }

  /** Each action's keyboard key on the map in use, and its keys as the row's value. */
  function drawBindings(): void {
    for (const { action, line, button: key } of bindingRows) {
      key.textContent = options.input.bindings.label(action, 'keyboard');
      line.dataset.value = options.input.bindings.codes(action).join(' ');
    }
  }

  /**
   * Waits for a key and puts it on `action` in every mode's map that has the action, or in none: a key another action
   * holds in any mode is refused before anything changes, and a key no map may take (one the page keeps) is refused
   * by the first map; the note says why.
   */
  async function rebind(action: string, key: HTMLButtonElement, note: HTMLElement): Promise<void> {
    key.textContent = 'Press a key… (Esc: keep)';
    note.textContent = '';
    const code = await options.input.listen('keyboard');
    if (code) {
      const modes = Object.entries(PLAYGROUND_MAPS).map(([mode, map]) => ({ mode, bindings: options.input.bindingsFor(map) })); // prettier-ignore
      const taking = modes.filter(({ bindings }) => action in bindings.map.actions);
      const holder = taking.flatMap(({ mode, bindings }) => bindings.actions().filter((other) => other !== action && bindings.codes(other).includes(code)).map((other) => ({ mode, other }))); // prettier-ignore
      if (holder.length)
        note.textContent = `${code} is ${holder[0].other}'s in the ${holder[0].mode} camera: rebind that first`; // prettier-ignore
      else {
        for (const { bindings } of taking) {
          const result = bindings.rebind(action, code);
          if (!result.ok) {
            note.textContent = result.message;
            break;
          }
        }
      }
    }
    drawBindings();
  }

  return {
    el,
    show(id, value) {
      const line = rows.get(id);
      if (!line) return;
      line.dataset.value = String(value);
      const field = line.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
      if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true;
      else if (field) field.value = String(value);
    },
    remove: () => el.remove(),
  };
}
