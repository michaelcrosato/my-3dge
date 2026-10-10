/**
 * @file Settings from one schema (PLAN.md WP 1.2, I-37; doctrine: Agent-operable): `defineSettings` declares each
 * setting as an entry of the registry kind `setting` (a schema.ts field keyed by its dotted path, `hero.runSpeed`), and
 * `createSettings` makes a store with a validated `get` and `set`, URL parameters, JSON export (`toJSON`, a preset)
 * and import (`load`), a "differs from default" marker, and scoped overrides. `x set` (WP 2.7), URL parameters and
 * `__engine.set` all go through it, so every setting is reachable the same three ways.
 *
 * A preset is path → value JSON. A scene or variant overrides settings for its lifetime with `override(values)`;
 * `dispose()` undoes exactly that layer, in any order. `set` writes to the newest layer that holds the path (else to
 * the base), so a change made while a scene runs ends with it.
 *
 * Invariants: an unknown path is an error naming the closest: `CORE_UNKNOWN_SETTING` from `get`, `set` and `reset`,
 * and one of the problems of `CORE_BAD_SETTING` (a bad value) from presets, URL parameters and overrides, which apply
 * nothing when anything is wrong. Values are plain data, stored frozen all the way down, defaults included (each a
 * copy in its frozen `setting` entry, registry.ts), so no reader changes them for everyone. `view: true` settings
 * (looks, cameras, quality) are reachable like any other, but `values({ view: false })`, which the hash, captures and
 * replays use, leaves them out, and `sim.get`, the reader sim-side code gets, refuses them (`CORE_VIEW_SETTING`).
 * `when` says when a change takes effect; `set` reports it.
 *
 * Carried from `my-3d2dge:src/emberdeep/01-tune.js` (knobs with range, unit and docs; overrides; JSON export) and
 * shardfall's presets and scoped overrides (`shardfall:crates/pav_core/src/params.rs:63-259`).
 *
 * @example
 * import { createRegistry } from './registry';
 * const reg = createRegistry();
 * defineSettings({ crowd: { type: 'integer', default: 100, minimum: 0, maximum: 5000, description: 'Walkers.' } }, reg);
 * const settings = createSettings({ registry: reg });
 * settings.set('crowd', 400).when; // 'now'
 * settings.toJSON(); // { crowd: 400 }: only what differs from the default
 * const scene = settings.override({ crowd: 1000 });
 * settings.get('crowd'); // 1000
 * scene.dispose();
 * settings.fromUrl('?crowd=50');
 * settings.toUrl(); // 'crowd=50'
 * @see engine/core/settings.test.ts
 */
import { codeError, defineCodes, didYouMean } from './log';
import { registry as sharedRegistry, sameValue, type Entry, type Registry } from './registry';
import {
  FIELD_TYPES,
  checkField,
  checkValue,
  freezeValue,
  isPlainObject,
  listProblems,
  show,
  type Field,
  type Problem,
  type Schema,
  type When,
} from './schema';

/** The codes this module raises, with their fixes. */
export const SETTINGS_CODES = defineCodes('core', {
  CORE_UNKNOWN_SETTING: {
    template: 'there is no setting {path}{suggestion}',
    fix: 'use a declared setting (node x describe setting lists them), or declare it with defineSettings({ … })',
    doc: 'Raised by the settings store (engine/core/settings.ts) for an unknown path in `get`, `set`, `setText`, `reset` or `sim.get`. Presets, URL parameters and overrides report unknown paths through `CORE_BAD_SETTING`, with every other problem.',
  },
  CORE_BAD_SETTING: {
    template: '{problems}',
    fix: 'give each setting a value of its type inside its range and values (node x describe setting <path> shows them); in a URL or with x set, write numbers plainly, booleans as true or false, and arrays or objects as JSON',
    doc: 'Raised by `set`, `setText`, `load`, `fromUrl` and `override` (engine/core/settings.ts). A preset or a URL with any problem applies nothing, and every problem is listed at once.',
  },
  CORE_VIEW_SETTING: {
    template: 'sim-side code read the view setting {path}',
    fix: 'read view settings ({path} changes only how the game looks or performs) from presentation code, through the settings store itself; sim-side code reads only settings without view: true, so the hash and replays never depend on them',
  },
});

/** A setting's value: plain data. */
export type SettingValue = number | string | boolean | readonly unknown[] | Readonly<Record<string, unknown>>;

/** What `set` reports: the new and previous values, and when the change takes effect. */
export interface SettingChange {
  path: string;
  value: SettingValue;
  previous: SettingValue;
  when: When;
  view: boolean;
}

/** One setting as `describe` lists it. */
export interface SettingRow {
  path: string;
  value: SettingValue;
  default: SettingValue;
  /** The "differs from default" marker. */
  differs: boolean;
  type: Field['type'];
  description: string;
  unit?: string;
  when: When;
  view: boolean;
  minimum?: number;
  maximum?: number;
  enum?: readonly (string | number | boolean)[];
}

/** A settings store over the `setting` entries of a registry. */
export interface Settings {
  /** The current value. Throws `CORE_UNKNOWN_SETTING`. */
  get<T extends SettingValue = SettingValue>(path: string): T;
  /** Validates and sets a value; returns what changed and when it takes effect. */
  set(path: string, value: unknown): SettingChange;
  /** `set` from text, as a URL or `x set` gives it: numbers plainly, booleans `true`/`false`, arrays and objects as JSON. */
  setText(path: string, text: string): SettingChange;
  /** Back to the default: one setting, or every setting (overrides included) when no path is given. */
  reset(path?: string): void;
  /** Whether the current value differs from the default. */
  differs(path: string): boolean;
  /** Every current value by path, sorted; `{ view: false }` leaves view settings out (what the hash reads). */
  values(filter?: { view?: boolean }): Record<string, SettingValue>;
  /** The preset of what differs from the defaults, by path: JSON export, so `JSON.stringify(settings)` works. */
  toJSON(): Record<string, SettingValue>;
  /** Applies a preset (path → value), all or nothing; returns the changes. Throws `CORE_BAD_SETTING`. */
  load(preset: unknown): SettingChange[];
  /** Applies URL parameters (`?crowd=50&quality=low`), all or nothing; `reserved` names parameters that are not settings. */
  fromUrl(search: string, options?: { reserved?: readonly string[] }): SettingChange[];
  /** What differs from the defaults as URL parameters (`crowd=50&quality=low`), sorted by path. */
  toUrl(): string;
  /** Overrides settings until `dispose()` (a scene's or variant's lifetime). Throws like `load`. */
  override(values: Record<string, unknown>, label?: string): { readonly label: string; dispose(): void };
  /** Every setting with its value, default, marker and schema, sorted by path. */
  describe(): SettingRow[];
  /** The read-only view sim-side code gets: view settings and unknown paths throw. */
  readonly sim: SimSettings;
}

/** What sim-side code reads settings through (`w.settings` in a scene): no view settings, no writes. */
export interface SimSettings {
  /** The current value; throws `CORE_VIEW_SETTING` for a view setting and `CORE_UNKNOWN_SETTING` for an unknown path. */
  get<T extends SettingValue = SettingValue>(path: string): T;
  /** Every non-view value by path, sorted: what the hash, captures and replays hold. */
  values(): Record<string, SettingValue>;
}

/** The fields of a `setting` entry: a schema.ts field. */
const SETTING_FIELDS = {
  type: {
    type: 'string',
    enum: FIELD_TYPES.filter((t) => t !== 'function'),
    required: true,
    description: 'The value type.',
  },
  description: { type: 'string', required: true, description: 'What the setting changes, in plain sentences.' },
  default: { type: 'any', required: true, description: 'Its value until something changes it.' },
  minimum: { type: 'number', description: 'The smallest number allowed.' },
  maximum: { type: 'number', description: 'The largest number allowed.' },
  enum: { type: 'array', description: 'The only values allowed.' },
  unit: { type: 'string', description: 'The unit, in SI (m, s, m/s, rad, kg).' },
  items: { type: 'object', description: 'For an array: the field every item matches.' },
  properties: { type: 'object', description: 'For an object: its own fields.' },
  when: {
    type: 'string',
    enum: ['now', 'spawn', 'scene'],
    default: 'now',
    description: 'When a change takes effect: at once, for what spawns next, or when the scene next starts.',
  },
  view: {
    type: 'boolean',
    default: false,
    description:
      'True when it changes only how the game looks or performs: kept out of the hash, captures and replays.',
  },
} as const satisfies Schema;

/** Declares the kind `setting` on `registry` unless it has it. */
function settingKind(registry: Registry): void {
  if (registry.kinds().includes('setting')) return;
  registry.defineKind('setting', {
    description:
      "The engine's and the game's settings, by dotted path: one schema for x set, URL parameters and __engine.set.",
    fields: SETTING_FIELDS,
    defineWith: "defineSettings({ '<path>': { type, default, description } })",
    check: (entry) => {
      const { id: _id, kind: _kind, ...field } = entry;
      return checkField(field, entry.id).map((problem) => problem.message);
    },
  });
}
settingKind(sharedRegistry);

/** Declares settings, path → field, on `registry` (the shared one by default). Throws `CORE_BAD_SPEC` for a bad field. */
export function defineSettings(fields: Record<string, Field>, registry: Registry = sharedRegistry): Entry[] {
  settingKind(registry);
  return Object.entries(fields).map(([path, field]) => {
    if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(path)) {
      const problems = `the path ${show(path)} must be words joined by dots, such as hero.runSpeed`;
      throw codeError('CORE_BAD_SPEC', { where: 'defineSettings', problems });
    }
    return registry.def('setting', path, field as unknown as Record<string, unknown>);
  });
}

/** Text from a URL or the command line as a value of `field`'s type; undefined when it cannot be. */
function fromText(field: Field, text: string): unknown {
  switch (field.type) {
    case 'number':
    case 'integer':
      return text.trim() === '' ? undefined : Number(text);
    case 'boolean':
      return text === '' || text === 'true' || text === '1' ? true : text === 'false' || text === '0' ? false : text;
    case 'string':
      return text;
    default:
      try {
        return JSON.parse(text);
      } catch {
        return field.type === 'any' ? text : undefined;
      }
  }
}

/** How a store is made: the registry whose `setting` entries it serves (the shared one by default). */
export interface SettingsOptions {
  registry?: Registry;
}

/** Makes a settings store over `registry`'s settings, each at its default. */
export function createSettings(options: SettingsOptions = {}): Settings {
  const registry = options.registry ?? sharedRegistry;
  settingKind(registry);
  const base = new Map<string, SettingValue>();
  const layers: { label: string; values: Map<string, SettingValue> }[] = [];

  const fieldOf = (path: string): Field & Entry => {
    if (!registry.has('setting', path)) {
      const ids = registry.list('setting').map((entry) => entry.id);
      throw codeError('CORE_UNKNOWN_SETTING', { path: show(path), suggestion: didYouMean(path, ids) });
    }
    return registry.get('setting', path) as unknown as Field & Entry;
  };
  const current = (path: string, field = fieldOf(path)): SettingValue => {
    for (let i = layers.length - 1; i >= 0; i--) if (layers[i].values.has(path)) return layers[i].values.get(path)!;
    return base.has(path) ? base.get(path)! : (field.default as SettingValue);
  };
  /** Checks a batch of path → value pairs: the typed values and every problem (unknown paths named with the closest). */
  const check = (values: Record<string, unknown>, parsed = new Map<string, SettingValue>()) => {
    const problems: Problem[] = [];
    const ids = registry.list('setting').map((entry) => entry.id);
    for (const [path, value] of Object.entries(values)) {
      if (!registry.has('setting', path)) {
        problems.push({ path, message: `there is no setting ${show(path)}${didYouMean(path, ids)}` });
        continue;
      }
      const checked = checkValue(fieldOf(path), value, path, problems);
      parsed.set(path, freezeValue(checked) as SettingValue);
    }
    return { parsed, problems };
  };
  const apply = (values: Map<string, SettingValue>): SettingChange[] =>
    [...values].map(([path, value]) => {
      const field = fieldOf(path);
      const previous = current(path, field);
      const layer = [...layers].reverse().find((item) => item.values.has(path));
      (layer?.values ?? base).set(path, value);
      return { path, value, previous, when: field.when ?? 'now', view: field.view ?? false };
    });
  const applyAll = (values: Record<string, unknown>): SettingChange[] => {
    const { parsed, problems } = check(values);
    if (problems.length) throw codeError('CORE_BAD_SETTING', { problems: listProblems(problems) });
    return apply(parsed);
  };
  const paths = () => registry.list('setting').map((entry) => entry.id);

  const settings: Settings = {
    get: <T extends SettingValue>(path: string) => current(path) as T,
    set(path, value) {
      fieldOf(path);
      return applyAll({ [path]: value })[0];
    },
    setText(path, text) {
      const value = fromText(fieldOf(path), text);
      if (value === undefined) {
        const problems = `${path} is ${show(text)}, which does not read as a value of type ${fieldOf(path).type}`;
        throw codeError('CORE_BAD_SETTING', { problems });
      }
      return settings.set(path, value);
    },
    reset(path) {
      if (path === undefined) {
        base.clear();
        for (const layer of layers) layer.values.clear();
        return;
      }
      fieldOf(path);
      base.delete(path);
      for (const layer of layers) layer.values.delete(path);
    },
    differs: (path) => !sameValue(current(path), fieldOf(path).default),
    values(filter = {}) {
      const out: Record<string, SettingValue> = {};
      for (const path of paths()) {
        const field = fieldOf(path);
        if (filter.view === undefined || (field.view ?? false) === filter.view) out[path] = current(path, field);
      }
      return out;
    },
    toJSON() {
      const out: Record<string, SettingValue> = {};
      for (const path of paths()) if (settings.differs(path)) out[path] = current(path);
      return out;
    },
    load(preset) {
      if (!isPlainObject(preset)) {
        throw codeError('CORE_BAD_SETTING', { problems: `a preset is ${show(preset)}; it must be { "path": value }` });
      }
      return applyAll(preset);
    },
    fromUrl(search, options = {}) {
      const values: Record<string, unknown> = {};
      const problems: Problem[] = [];
      for (const [path, text] of new URLSearchParams(search)) {
        if (options.reserved?.includes(path)) continue;
        if (!registry.has('setting', path)) {
          values[path] = text; // reported by check, with the closest path
          continue;
        }
        const value = fromText(fieldOf(path), text);
        const type = fieldOf(path).type;
        if (value === undefined)
          problems.push({ path, message: `${path}=${text} does not read as a value of type ${type}` });
        else values[path] = value;
      }
      const checked = check(values);
      problems.push(...checked.problems);
      if (problems.length) throw codeError('CORE_BAD_SETTING', { problems: listProblems(problems) });
      return apply(checked.parsed);
    },
    toUrl() {
      const params = new URLSearchParams();
      for (const [path, value] of Object.entries(settings.toJSON())) {
        params.append(path, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      return params.toString();
    },
    override(values, label = 'override') {
      const { parsed, problems } = check(isPlainObject(values) ? values : {});
      if (!isPlainObject(values))
        problems.push({ path: '', message: `overrides are ${show(values)}; write { path: value }` });
      if (problems.length) throw codeError('CORE_BAD_SETTING', { problems: listProblems(problems) });
      const layer = { label, values: parsed };
      layers.push(layer);
      return {
        label,
        dispose() {
          const at = layers.indexOf(layer);
          if (at >= 0) layers.splice(at, 1);
        },
      };
    },
    describe() {
      return paths().map((path) => {
        const field = fieldOf(path);
        const row: SettingRow = {
          path,
          value: current(path, field),
          default: field.default as SettingValue,
          differs: settings.differs(path),
          type: field.type,
          description: field.description ?? '',
          when: field.when ?? 'now',
          view: field.view ?? false,
        };
        for (const key of ['unit', 'minimum', 'maximum', 'enum'] as const) {
          if (field[key] !== undefined) Object.assign(row, { [key]: field[key] });
        }
        return row;
      });
    },
    sim: {
      get<T extends SettingValue>(path: string): T {
        const field = fieldOf(path);
        if (field.view) throw codeError('CORE_VIEW_SETTING', { path: show(path) });
        return current(path, field) as T;
      },
      values: () => settings.values({ view: false }),
    },
  };
  return settings;
}
