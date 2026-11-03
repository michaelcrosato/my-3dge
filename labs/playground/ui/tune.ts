/**
 * @file The playground's Tune panel (docs/PLAYGROUND.md §8.4, PLAN.md WP 13.32): the look drawn now, tuned and combined
 * live, as an agent does it with `x set` and `__engine.look()`. It sits on the right of the game, so the picture
 * shows beside it, and holds:
 * - the strength (`post.strength`): how much of the whole look shows;
 * - the looks laid on (`post.combine`): a row each with its look, its amount and a button that takes it off, and a
 *   list that lays another on;
 * - every filter (`FILTER_FIELDS`, in the composite's order), a fold each, open while it is on: its scope, its amount
 *   and its numbers, each control made from its field's schema (a slider over its range, a list of its `enum`, a box
 *   for a switch, a colour picker for a colour), showing what the chain draws now (`now()`, the inspector's `look`); a
 *   change lays that field over the look (`post.filters`, the fields the panel changed);
 * - Copy as look: the filters drawn now as a `defineLook` to paste into a look's file (`lookText`), shown and put on
 *   the clipboard where the browser lets it; Reset clears the three settings; Back closes the panel.
 * Every change is a uniform write (ADR-0008 amendment 14): the panel builds nothing.
 *
 * Elements: `[data-ui=tune]`; `[data-ui=tune-strength]` (its `input`); a `[data-ui=tune-layer]` per layer (`data-id`
 * its index, its `select`, its `input`, its `[data-ui=item][data-id=remove]`) and the list `[data-ui=tune-add]`; a
 * `[data-ui=tune-filter]` per filter (`data-id` its name, `data-on` whether it is on), its controls
 * `[data-field=<key>]`; the buttons `[data-ui=item]` `copy`, `reset` and `back`; `[data-ui=tune-copy]`, the text.
 *
 * Invariants: presentation only: it reads the look through `now()` and writes only `post.strength`, `post.combine`
 * and `post.filters`, through `set`.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * lookText({ look: 'look:clean', combine: [], strength: 1, filters: { vignette: { scope: 'all', amount: 1, strength: 0.6 } } }); // "defineLook('look:my-look', …"
 * @see labs/playground/ui/tune.test.ts
 * @see tests/e2e/playground-ui.spec.ts
 */
import { FILTER_FIELDS, FILTER_NAMES, type FilterName, type FilterSpec } from '../../../engine';

/** The look drawn now, as the inspector's `look` gives it. */
export interface LookNow {
  look: string;
  combine: unknown;
  strength: number;
  filters: FilterSpec;
}

/** How the panel is made. */
export interface TuneOptions {
  /** The look drawn now (the inspector's `look`). */
  now(): LookNow;
  /** Every look the panel can lay on. */
  looks: readonly string[];
  /** A setting's value now. */
  get(path: string): unknown;
  /** Sets a setting (the inspector's `set`). */
  set(path: string, value: unknown): void;
  onBack(): void;
}

/** The Tune panel. */
export interface TunePanel {
  readonly el: HTMLElement;
  remove(): void;
}

/** A filter field's schema, as the panel reads it. */
interface FieldSchema {
  type: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: readonly string[];
  unit?: string;
  description?: string;
}

/** A filter's fields, by name. */
const fieldsOf = (name: FilterName) => FILTER_FIELDS[name].properties as unknown as Record<string, FieldSchema>;

/**
 * The filters drawn now as a `defineLook` to paste (see the file comment): each filter that is on with its scope and
 * the fields off their defaults, so the look draws the same picture.
 */
export function lookText(now: LookNow, id = 'look:my-look'): string {
  const filters: Record<string, Record<string, unknown>> = {};
  for (const [name, filter] of Object.entries(now.filters) as [FilterName, Record<string, unknown>][]) {
    const fields = fieldsOf(name);
    const kept = Object.entries(filter).filter(([key, value]) => key === 'scope' || value !== fields[key]?.default);
    filters[name] = Object.fromEntries(kept);
  }
  const spec = { description: `Tuned in the playground over ${now.look}.`, filters };
  return `defineLook('${id}', ${JSON.stringify(spec, null, 2)});\n`;
}

/** A colour as the colour picker takes it: `#rrggbb` (a short hex widened; anything else black). */
function pickerColour(value: unknown): string {
  const hex = String(value);
  if (/^#[\da-f]{6}$/i.test(hex)) return hex;
  return /^#[\da-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : '#000000';
}

/** The panel's stylesheet: on the right of the game, scrolling, compact rows. */
const STYLE = `
.pg-tune { right: 1%; top: 2%; bottom: 2%; width: min(400px, 46%); overflow-y: auto; font-size: 0.85em; }
.pg-tune .pg-row { display: grid; grid-template-columns: 1fr 1.4fr 3em; gap: 0.4em; align-items: center; margin: 0.15em 0; }
.pg-tune details { margin: 0.2em 0; } .pg-tune summary { cursor: pointer; }
.pg-tune h3 { margin: 0.6em 0 0.2em; font-size: 1em; } .pg-tune button, .pg-tune select { font: inherit; }
.pg-tune textarea { width: 100%; height: 9em; font: 0.85em monospace; }
`;

/** Makes the Tune panel in `parent` (see the file comment). */
export function createTune(parent: HTMLElement, options: TuneOptions): TunePanel {
  const doc = parent.ownerDocument;
  if (!doc.getElementById('pg-tune-style')) doc.head.append(Object.assign(doc.createElement('style'), { id: 'pg-tune-style', textContent: STYLE })); // prettier-ignore
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) =>
    Object.assign(doc.createElement(tag), props) as HTMLElementTagNameMap[K];
  const el = make('div', { className: 'ui-panel ui-box pg-tune' });
  el.dataset.ui = 'tune';
  const edits = structuredClone((options.get('post.filters') ?? {}) as Record<string, Record<string, unknown>>);
  let layers = structuredClone((options.get('post.combine') ?? []) as Record<string, unknown>[]);
  /** What each control shows, set again from the look drawn now after every change. */
  const shows: (() => void)[] = [];
  let now = options.now();
  const changed = () => {
    now = options.now();
    for (const show of shows) show();
  };

  el.append(make('h2', { textContent: 'Tune the look' }));
  const base = make('p');
  shows.push(() => void (base.textContent = `Drawing ${now.look}: every change shows at once.`));
  el.append(base);

  // the strength
  const setStrength = (v: number) => {
    options.set('post.strength', v);
    changed();
  };
  const strength = row(
    'Strength',
    slider(0, 1, 0.05, () => now.strength, setStrength),
  );
  strength.dataset.ui = 'tune-strength';
  el.append(strength);

  // the looks laid on
  el.append(make('h3', { textContent: 'Looks laid on' }));
  const layerList = make('div');
  const add = make('select');
  add.dataset.ui = 'tune-add';
  add.append(make('option', { value: '', textContent: 'Lay a look on…' }));
  for (const id of options.looks) add.append(make('option', { value: id, textContent: id.replace(/^look:/, '') }));
  add.addEventListener('change', () => {
    if (!add.value) return;
    layers = [...layers, { look: add.value, amount: 1 }];
    add.value = '';
    writeLayers();
  });
  el.append(layerList, add);
  drawLayers();

  // the filters
  el.append(make('h3', { textContent: 'Filters' }));
  for (const name of FILTER_NAMES) el.append(filterFold(name));

  // copy, reset, back
  const copied = make('textarea', { readOnly: true });
  copied.dataset.ui = 'tune-copy';
  const button = (id: string, text: string, click: () => void) => {
    const made = make('button', { type: 'button', textContent: text });
    made.dataset.ui = 'item';
    made.dataset.id = id;
    made.addEventListener('click', click);
    el.append(made, ' ');
  };
  button('copy', 'Copy as look', () => {
    copied.value = lookText(now);
    void navigator.clipboard?.writeText(copied.value).catch(() => {}); // the text shows either way
  });
  button('reset', 'Reset', () => {
    for (const key of Object.keys(edits)) delete edits[key];
    layers = [];
    options.set('post.filters', {});
    options.set('post.strength', 1);
    writeLayers();
  });
  button('back', 'Back', () => options.onBack());
  el.append(copied);
  parent.append(el);
  changed();

  /** A labelled row: its label, its control and the value it shows. */
  function row(label: string, control: [HTMLElement, HTMLElement]): HTMLElement {
    const line = make('label', { className: 'pg-row' });
    line.append(make('span', { textContent: label }), ...control);
    return line;
  }

  /** A slider over `min`–`max` showing `value()`, its changes to `write`. */
  function slider(
    min: number,
    max: number,
    step: number,
    value: () => number,
    write: (v: number) => void,
  ): [HTMLElement, HTMLElement] {
    // prettier-ignore
    const input = make('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = make('output');
    shows.push(() => {
      input.value = String(value());
      out.textContent = String(Math.round(value() * 100) / 100);
    });
    input.addEventListener('input', () => write(Number(input.value)));
    return [input, out];
  }

  /** Writes the layers to `post.combine` and draws their rows again. */
  function writeLayers(): void {
    options.set('post.combine', layers);
    drawLayers();
    changed();
  }

  /** A row per layer: its look, its amount, a button taking it off. */
  function drawLayers(): void {
    layerList.replaceChildren();
    layers.forEach((layer, i) => {
      const line = make('div', { className: 'pg-row' });
      line.dataset.ui = 'tune-layer';
      line.dataset.id = String(i);
      const pick = make('select');
      for (const id of options.looks) pick.append(make('option', { value: id, textContent: id.replace(/^look:/, '') }));
      pick.value = String(layer.look);
      pick.addEventListener('change', () => {
        layers = layers.map((one, j) => (j === i ? { ...one, look: pick.value } : one));
        writeLayers();
      });
      const amount = make('input', { type: 'range', min: '0', max: '1', step: '0.05' });
      amount.value = String(layer.amount ?? 1);
      amount.addEventListener('input', () => {
        layers = layers.map((one, j) => (j === i ? { ...one, amount: Number(amount.value) } : one));
        options.set('post.combine', layers);
        changed();
      });
      const remove = make('button', { type: 'button', textContent: '×', title: 'Take it off' });
      remove.dataset.ui = 'item';
      remove.dataset.id = 'remove';
      remove.addEventListener('click', () => {
        layers = layers.filter((_one, j) => j !== i);
        writeLayers();
      });
      line.append(pick, amount, remove);
      layerList.append(line);
    });
  }

  /** The value of filter `name`'s field `key` drawn now (its default while the filter is off). */
  function drawn(name: FilterName, key: string): unknown {
    const filter = now.filters[name] as Record<string, unknown> | undefined;
    return filter ? filter[key] : fieldsOf(name)[key]?.default;
  }

  /** Lays `value` on filter `name`'s field `key` (`post.filters`). */
  function write(name: FilterName, key: string, value: unknown): void {
    edits[name] = { ...edits[name], [key]: value };
    options.set('post.filters', edits);
    changed();
  }

  /** Filter `name`'s fold: a control per field (see the file comment). */
  function filterFold(name: FilterName): HTMLElement {
    const fold = make('details');
    fold.dataset.ui = 'tune-filter';
    fold.dataset.id = name;
    const summary = make('summary', { textContent: name, title: FILTER_FIELDS[name].description });
    fold.append(summary);
    shows.push(() => {
      const on = Boolean(now.filters[name]);
      if (fold.dataset.on !== String(on)) fold.open = on;
      fold.dataset.on = String(on);
    });
    for (const [key, field] of Object.entries(fieldsOf(name))) fold.append(fieldRow(name, key, field));
    return fold;
  }

  /** The row of filter `name`'s field `key`, its control from its schema. */
  function fieldRow(name: FilterName, key: string, field: FieldSchema): HTMLElement {
    const value = () => drawn(name, key);
    const tag = (control: HTMLElement) => ((control.dataset.field = key), control);
    let control: [HTMLElement, HTMLElement];
    if (field.enum) {
      const select = make('select');
      for (const choice of field.enum) select.append(make('option', { value: choice, textContent: choice }));
      shows.push(() => void (select.value = String(value())));
      select.addEventListener('change', () => write(name, key, select.value));
      control = [select, make('span')];
    } else if (field.type === 'boolean') {
      const box = make('input', { type: 'checkbox' });
      shows.push(() => void (box.checked = value() === true));
      box.addEventListener('change', () => write(name, key, box.checked));
      control = [box, make('span')];
    } else if (field.type === 'string') {
      const picker = make('input', { type: 'color' });
      shows.push(() => void (picker.value = pickerColour(value())));
      picker.addEventListener('input', () => write(name, key, picker.value));
      control = [picker, make('span')];
    } else {
      const [min, max] = [field.minimum ?? 0, field.maximum ?? 1];
      const step = field.type === 'integer' ? 1 : (max - min) / 100;
      control = slider(
        min,
        max,
        step,
        () => Number(value()),
        (v) => write(name, key, v),
      );
    }
    tag(control[0]);
    const line = row(field.unit && field.unit !== '#rrggbb' ? `${key} (${field.unit})` : key, control);
    line.title = field.description ?? '';
    return line;
  }

  return { el, remove: () => el.remove() };
}
