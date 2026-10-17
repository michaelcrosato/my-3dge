/**
 * @file The owner's feel panel (PLAN.md WP 13.4, docs/PLAYGROUND.md §3.4): a page's sliders over the settings whose
 * paths start with `movement.` (the shooter model's numbers, engine/physics/movement/settings.ts) or `cam.` (the
 * cameras', WP 13.8), live through the inspector, so each change is a recorded `set` that replays; and two buttons
 * that bring a playtest back as data: Copy as profile (`__engine.tune.profile()`: a `defineMovement` call holding
 * every number off Apex's, and the camera settings that differ as a preset) and Save the replay (the run so far,
 * `__engine.input.record()`, as a `.replay.json` file for tests/replays/). It reads its rows from
 * `__engine.tune.settings()` (engine/app/feelMember.ts). `sliderRange` is its arithmetic, pure.
 *
 * Built by `createFeelPanel(document, inspector)` as one `[data-ui=feel]` element (each row `[data-path]`, its range
 * `input`, its value `output`; the buttons `[data-feel=copy]`, `[data-feel=save]`, `[data-feel=reset]`; the copied
 * text in `[data-feel=profile]`), hidden until `show()`.
 *
 * Invariants: it writes the run only through the inspector's `set`; what it shows is what `tune.settings()` read, so a
 * replay's or a restart's values show when it is opened again.
 *
 * @example
 * sliderRange({ value: 4.41, default: 4.4069, minimum: 0, maximum: 100 }); // [0, 13.25, 0.05]: to three times the default
 * // const panel = createFeelPanel(document, engine.inspector); panel.show();
 * @see engine/dev/feel/panel.test.ts
 */

/** A row of the panel: a setting's path, value and declared range, as `__engine.tune.settings()` reads it. */
export interface FeelRow {
  path: string;
  value: number;
  default: number;
  minimum?: number;
  maximum?: number;
  unit?: string;
  description?: string;
}

/** What the panel calls on the inspector (`window.__engine`). */
export interface FeelInspector {
  set(path: string, value: unknown): unknown;
  tune: { settings(): FeelRow[]; profile(): string };
  input: { record(): unknown };
  info(): { scene: string; tick: number };
}

/** A nice step for a range of `span`: 1, 2 or 5 times a power of ten, about a three-hundredth of it. */
function niceStep(span: number): number {
  if (!(span > 0)) return 0.001;
  const raw = span / 300;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const k = raw / power;
  return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * power;
}

/**
 * A slider's `[low, high, step]` for `row`: the declared range, cut to three times the default (or 1, or the value)
 * either side of 0.
 */
export function sliderRange(row: Pick<FeelRow, 'value' | 'default' | 'minimum' | 'maximum'>): [number, number, number] {
  const top = Math.max(Math.abs(row.default) * 3, Math.abs(row.value), 1);
  const low = Math.min(Math.max(row.minimum ?? 0, -top), row.value);
  const high = Math.max(Math.min(row.maximum ?? top, top), row.value);
  const step = niceStep(high - low);
  const round = (x: number) => Number((Math.ceil(x / step) * step).toPrecision(12));
  return [low, round(high), step];
}

/** A value for reading: four significant digits at most. */
const shown = (value: number) => String(Number(value.toPrecision(4)));

/** The panel's look, added once as `<style id="feel-panel-style">`. */
const STYLE = `
.feel-panel { position: fixed; right: 8px; top: 40px; bottom: 40px; width: 340px; overflow-y: auto; z-index: 30;
  background: rgba(16, 18, 24, 0.92); color: #e8e8e8; font: 12px/1.4 system-ui, sans-serif; padding: 8px;
  border-radius: 6px; box-sizing: border-box; }
.feel-panel[hidden] { display: none; }
.feel-panel header { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.feel-panel button { font: inherit; padding: 2px 6px; }
.feel-panel summary { cursor: pointer; font-weight: 600; margin-top: 4px; }
.feel-panel label { display: grid; grid-template-columns: 96px 1fr 64px; gap: 4px; align-items: center; }
.feel-panel output { text-align: right; font-variant-numeric: tabular-nums; }
.feel-panel textarea { width: 100%; height: 160px; font: 11px/1.3 monospace; }
`;

/** The group a path's row sits in: its second segment (`gaits` of `movement.gaits.run`), else its first. */
const groupOf = (path: string) => path.split('.')[1] ?? path;

/** Builds the feel panel on `document` over `inspector` (see the file comment). Hidden until `show()`. */
export function createFeelPanel(document: Document, inspector: FeelInspector) {
  if (!document.getElementById('feel-panel-style')) {
    const style = document.createElement('style');
    style.id = 'feel-panel-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.className = 'feel-panel';
  root.dataset.ui = 'feel';
  root.hidden = true;
  const button = (name: string, text: string) => {
    const b = document.createElement('button');
    [b.dataset.feel, b.textContent, b.type] = [name, text, 'button'];
    return b;
  };
  const header = document.createElement('header');
  const [copy, save, reset] = [button('copy', 'Copy as profile'), button('save', 'Save the replay'), button('reset', 'Reset')]; // prettier-ignore
  header.append(copy, save, reset);
  const rows = document.createElement('div');
  const profile = document.createElement('textarea');
  [profile.dataset.feel, profile.readOnly, profile.hidden] = ['profile', true, true];
  root.append(header, rows, profile);
  document.body.append(root);

  /** One row: its label, its range input and its value. */
  const rowOf = (row: FeelRow) => {
    const label = document.createElement('label');
    label.dataset.path = row.path;
    label.title = row.description ?? row.path;
    const name = document.createElement('span');
    name.textContent = row.path.split('.').at(-1)!;
    const input = document.createElement('input');
    const [low, high, step] = sliderRange(row);
    Object.assign(input, { type: 'range', min: String(low), max: String(high), step: String(step), value: String(row.value) }); // prettier-ignore
    const output = document.createElement('output');
    output.textContent = `${shown(row.value)}${row.unit ? ` ${row.unit}` : ''}`;
    input.addEventListener('input', () => {
      const value = Number(input.value);
      inspector.set(row.path, value);
      output.textContent = `${shown(value)}${row.unit ? ` ${row.unit}` : ''}`;
    });
    label.append(name, input, output);
    return label;
  };
  /** Reads the rows again and draws them, grouped. */
  const draw = () => {
    rows.replaceChildren();
    const groups = new Map<string, FeelRow[]>();
    for (const row of inspector.tune.settings()) groups.set(groupOf(row.path), [...(groups.get(groupOf(row.path)) ?? []), row]); // prettier-ignore
    for (const [group, members] of groups) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = group;
      details.append(summary, ...members.map(rowOf));
      rows.append(details);
    }
  };

  copy.addEventListener('click', () => {
    const text = inspector.tune.profile();
    [profile.value, profile.hidden] = [text, false];
    void navigator.clipboard?.writeText(text).catch(() => undefined); // refused: the text stays shown
  });
  save.addEventListener('click', () => {
    const { scene, tick } = inspector.info();
    const blob = new Blob([`${JSON.stringify(inspector.input.record(), null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    [link.href, link.download] = [URL.createObjectURL(blob), `${scene.replace(/[^\w-]+/g, '-')}-${tick}.replay.json`];
    link.click();
    URL.revokeObjectURL(link.href);
  });
  reset.addEventListener('click', () => {
    for (const row of inspector.tune.settings()) if (row.value !== row.default) inspector.set(row.path, row.default);
    draw();
  });

  return {
    root,
    /** Shows the panel, its rows read again. */
    show(): void {
      draw();
      root.hidden = false;
    },
    hide(): void {
      root.hidden = true;
    },
    /** Shows or hides it; returns whether it shows. */
    toggle(): boolean {
      if (root.hidden) this.show();
      else this.hide();
      return !root.hidden;
    },
  };
}

/** The feel panel: what `createFeelPanel` returns. */
export type FeelPanel = ReturnType<typeof createFeelPanel>;
