/**
 * @file Bindings (PLAN.md WP 3.3, I-24; doctrine: Agent-operable): an action map (engine/input/actionMaps.ts) with the
 * player's changes on top, as engine data. `rebind` puts a code on an action, refusing reserved codes and codes
 * another action holds (a conflict, named, as the prototype's controls screen reported it); `unbind` and `reset` take
 * changes back; every change is saved through `storage` (the page's `localStorage`) and loaded at creation; `label`
 * says what a prompt shows for an action on a device.
 *
 * Rebinding replaces codes of one device family: keyboard and mouse together, or the gamepad. `rebind('jump', 'KeyG')`
 * makes G the jump key and keeps the pad's button; with `{ replace: 'Space' }` it swaps only that code, so other keys
 * stay. Changes are stored per action as its whole code list, so a saved file reads on its own: `{ "format":
 * "my3dge-bindings/1", "map": "actionMap:thirdPerson", "actions": { "jump": ["PadSouth", "KeyG"] } }`.
 *
 * Invariants: an action never holds a reserved code (`RESERVED_CODES`, the map's `reserved`) or one another action of
 * the map holds, through `rebind` or a loaded file; the system layer is never changed. A saved entry that breaks
 * this (an unknown action, a bad, reserved or taken code) is skipped with the advice `INPUT_BAD_BINDINGS`, naming
 * each problem, and the rest still loads. `version` counts the changes, so a device rebuilds its code table only then.
 *
 * Carried from `my-3d2dge:src/emberdeep/61-controls.js:27-131, 205-243` (stored bindings, reserved keys, conflicts,
 * per-device replacement, `actionLabel`).
 *
 * @example
 * const memory = new Map<string, string>();
 * const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
 * const bindings = createBindings('actionMap:thirdPerson', { storage });
 * bindings.rebind('jump', 'KeyG'); // { ok: true, codes: ['PadSouth', 'KeyG'] }: the pad's button stays
 * bindings.rebind('jump', 'KeyW'); // { ok: false, reason: 'conflict', action: 'forward', message: … }
 * bindings.rebind('jump', 'Escape').ok; // false: reserved for pause
 * bindings.label('jump', 'gamepad'); // 'A'
 * createBindings('actionMap:thirdPerson', { storage }).codes('jump'); // ['PadSouth', 'KeyG']: saved and loaded
 * @see engine/input/bindings.test.ts
 */
import { defineCodes, didYouMean, log as sharedLog, type Log } from '../core/log';
import type { Registry } from '../core/registry';
import { isPlainObject, show } from '../core/schema';
import { getActionMap, RESERVED_CODES, type ActionMap } from './actionMaps';
import { codeLabel, deviceOf, isCode, type DeviceKind, type LabelOptions } from './codes';

/** The codes this module raises, with their fixes. */
export const BINDINGS_CODES = defineCodes('input', {
  INPUT_BAD_BINDINGS: {
    template: 'saved bindings {key}: {problems}',
    fix: 'the rest loaded; rebind those actions, or reset() them to the map, which saves a clean file',
    doc: 'Advice from `createBindings` (engine/input/bindings.ts) when saved bindings name an unknown action, a bad, reserved or taken code, or are not a bindings file: those entries are skipped, the others load.',
  },
});

/** The format tag of a saved bindings file. */
export const BINDINGS_FORMAT = 'my3dge-bindings/1';

/** Where bindings are saved: the `localStorage` shape. */
export interface BindingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A saved bindings file. */
export interface BindingsFile {
  format: typeof BINDINGS_FORMAT;
  map: string;
  actions: Record<string, string[]>;
}

/** What `rebind` did: the action's codes now, or why it refused and which action holds the code. */
export type RebindResult =
  | { ok: true; codes: readonly string[] }
  | { ok: false; reason: 'unknown-action' | 'bad-code' | 'reserved' | 'conflict'; action?: string; message: string };

/** How bindings are made. */
export interface BindingsOptions {
  /** Where they are saved and loaded (the page's `localStorage`); none keeps them in memory. */
  storage?: BindingsStorage;
  /** The storage key (`my3dge:bindings:<map id>`). */
  key?: string;
  /** Where the map is registered (the shared registry). */
  registry?: Registry;
  /** Where advice goes (the shared log). */
  log?: Log;
}

/** An action map with the player's changes. */
export interface Bindings {
  /** The action map underneath. */
  readonly map: ActionMap;
  /** Counts the changes since creation. */
  readonly version: number;
  /** The map's actions, in its order. */
  actions(): string[];
  /** The codes bound to `action` now. */
  codes(action: string): readonly string[];
  /** Puts `code` on `action`, replacing the action's codes of that device family, or only `replace`. */
  rebind(action: string, code: string, options?: { replace?: string }): RebindResult;
  /** Takes `code` off `action`, or every code of `device`'s family. */
  unbind(action: string, which: string): void;
  /** Gives `action` (or every action) the map's codes again. */
  reset(action?: string): void;
  /** What a prompt shows for `action` on `device`: its first code of that device, labelled; `—` when unbound. */
  label(action: string, device: DeviceKind, options?: LabelOptions): string;
  /** The changes as a bindings file. */
  toJSON(): BindingsFile;
}

/**
 * What a prompt shows for an action bound to `codes` on `device`: its first code of that device, labelled (the
 * gamepad's only; the mouse's, then the keyboard's; the keyboard's, then the mouse's), or `—` when none is bound.
 */
export function pickLabel(codes: readonly string[], device: DeviceKind, options?: LabelOptions): string {
  const order: DeviceKind[] = device === 'gamepad' ? ['gamepad'] : device === 'mouse' ? ['mouse', 'keyboard'] : ['keyboard', 'mouse']; // prettier-ignore
  for (const want of order) {
    const code = codes.find((c) => deviceOf(c) === want);
    if (code) return codeLabel(code, options);
  }
  return '—';
}

/** The family a device rebinds with: keyboard and mouse share one. */
const family = (device: DeviceKind) => (device === 'gamepad' ? 'gamepad' : 'keyboard');

/** Makes the bindings of the action map `map` (an id or an entry), loading saved changes from `options.storage`. */
export function createBindings(map: string | ActionMap, options: BindingsOptions = {}): Bindings {
  const entry = typeof map === 'string' ? getActionMap(map, options.registry) : map;
  const key = options.key ?? `my3dge:bindings:${entry.id}`;
  const names = Object.keys(entry.actions);
  const reserved = new Set([...RESERVED_CODES, ...entry.reserved]);
  const changed = new Map<string, readonly string[]>();
  let version = 0;
  const codes = (action: string) => changed.get(action) ?? entry.actions[action] ?? [];
  const holder = (code: string, except: string) => names.find((name) => name !== except && codes(name).includes(code));
  const save = () => {
    version++;
    options.storage?.setItem(key, JSON.stringify(bindings.toJSON()));
  };
  const refuse = (reason: 'unknown-action' | 'bad-code' | 'reserved' | 'conflict', message: string, action?: string) =>
    ({ ok: false, reason, message, ...(action === undefined ? {} : { action }) }) as RebindResult;

  const bindings: Bindings = {
    map: entry,
    get version() {
      return version;
    },
    actions: () => [...names],
    codes: (action) => Object.freeze([...codes(action)]),
    rebind(action, code, { replace } = {}) {
      if (!names.includes(action)) {
        return refuse('unknown-action', `${show(action)} is no action of ${entry.id}${didYouMean(action, names)}`);
      }
      if (!isCode(code)) return refuse('bad-code', `${show(code)} is not a code (KeyW, MouseLeft, PadSouth)`);
      if (reserved.has(code)) return refuse('reserved', `${code} is reserved: choose another`);
      const other = holder(code, action);
      if (other !== undefined) {
        return refuse('conflict', `${code} is bound to ${other}: unbind it there first, or choose another`, other);
      }
      const side = family(deviceOf(code));
      const keep = codes(action).filter((c) => (replace === undefined ? family(deviceOf(c)) !== side : c !== replace));
      const next = replace !== undefined && codes(action).includes(replace) ? codes(action).map((c) => (c === replace ? code : c)) : [...keep, code]; // prettier-ignore
      changed.set(action, Object.freeze([...new Set(next)]));
      save();
      return { ok: true, codes: bindings.codes(action) };
    },
    unbind(action, which) {
      if (!names.includes(action)) return;
      const device = which === 'gamepad' || which === 'keyboard' || which === 'mouse' ? family(which) : undefined;
      const keep = codes(action).filter((c) => (device ? family(deviceOf(c)) !== device : c !== which));
      changed.set(action, Object.freeze(keep));
      save();
    },
    reset(action) {
      if (action === undefined) changed.clear();
      else changed.delete(action);
      save();
    },
    label: (action, device, labels) => pickLabel(codes(action), device, labels),
    toJSON() {
      const actions: Record<string, string[]> = {};
      for (const name of names) if (changed.has(name)) actions[name] = [...codes(name)];
      return { format: BINDINGS_FORMAT, map: entry.id, actions };
    },
  };

  const [loaded, problems] = load(options.storage?.getItem(key) ?? null, entry);
  for (const [action, list] of loaded) changed.set(action, list);
  for (;;) {
    const action = [...changed.keys()].find((name) => codes(name).some((code) => holder(code, name) !== undefined));
    if (action === undefined) break;
    const code = codes(action).find((c) => holder(c, action) !== undefined) as string;
    problems.push(`${action}: ${code} is bound to ${holder(code, action)}`);
    changed.delete(action); // back to the map's codes, until no saved change clashes
  }
  if (problems.length) {
    (options.log ?? sharedLog).warnOnce('INPUT_BAD_BINDINGS', { key, problems: problems.join('; ') }, key);
  }
  return bindings;
}

/** Reads a saved file: the well-formed changes by action, and a problem for each entry skipped. */
function load(text: string | null, map: ActionMap): [Map<string, readonly string[]>, string[]] {
  const changes = new Map<string, readonly string[]>();
  if (text === null) return [changes, []];
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return [changes, ['not JSON']];
  }
  if (!isPlainObject(file) || file.format !== BINDINGS_FORMAT || !isPlainObject(file.actions)) {
    return [changes, [`not a ${BINDINGS_FORMAT} file`]];
  }
  const reserved = new Set([...RESERVED_CODES, ...map.reserved]);
  const problems: string[] = [];
  for (const [action, list] of Object.entries(file.actions)) {
    if (!Object.hasOwn(map.actions, action)) {
      problems.push(`${show(action)} is no action of ${map.id}${didYouMean(action, Object.keys(map.actions))}`);
    } else if (!Array.isArray(list) || list.length > 16 || !list.every(isCode)) {
      problems.push(`${action}: ${show(list)} is not a list of codes`);
    } else if (list.some((code) => reserved.has(code))) {
      problems.push(`${action}: ${list.find((code) => reserved.has(code))} is reserved`);
    } else changes.set(action, Object.freeze([...new Set(list as string[])]));
  }
  return [changes, problems];
}
