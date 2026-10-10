/**
 * @file The canonical state and its hash (PLAN.md §6.5 items 4 and 6, WP 1.4, I-05; doctrine: Reproducible):
 * component kinds declared with their field lists (registry kind `component`), the plain-data form of the sim that
 * `state()` returns, the one 64-bit FNV-1a hash over everything a capture holds (`hash()`), per-entity digests
 * (`trace()`), and `diffStates`, which names the fields where two states part.
 *
 * What the hash covers, after the format tag (`STATE_FORMAT`), in this order, each part tagged: the seed and the next
 * entity id; every entity in id order, its components sorted by name, each component's fields in the order its kind
 * declares them (an absent field feeds its own marker); the timers' tick count and timers (engine/core/timers.ts
 * `state()`); the settings except `view` ones (`settings.values({ view: false })`); the state of every sim RNG stream
 * (`rng()`, `rng.entity()`); and the physics hook's state (WP 3.1: every body's translation, rotation and velocities
 * in handle order, never Rapier's snapshot bytes). Visual streams (`fxRng`), event listeners, systems and view
 * settings are never hashed.
 *
 * Invariants: the hash reads no `Map` or `Set` iteration order; entities, components, settings and RNG keys come in
 * sorted order, and fields in declared order. Nothing is skipped silently: a component nobody declared
 * (`SIM_UNKNOWN_COMPONENT`), a field its kind does not declare (`SIM_UNDECLARED_FIELD`) or a value the canonical form
 * cannot hold (`CORE_NOT_CANONICAL`, naming the entity and field) throws. A component kind's name is the entity's
 * property (`e.position`), a lower-case word; its fields are schema.ts fields holding data, never hooks.
 * `hashState(w.state())` equals `w.hash()`.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * defineComponent('health', { description: 'Hit points.', fields: { hp: { type: 'number', default: 10, description: 'Left.' } } }, reg);
 * const table = componentTable(reg);
 * table.make('health', { hp: 7 }, 'a test'); // { hp: 7 }
 * const view = { seed: 1, nextId: 2, entities: [{ id: 1, health: { hp: 7 } }], timers: { ticks: 0, nextId: 1, timers: [] }, settings: {}, rng: {} };
 * hashState(view, table) === hashState(structuredClone(view), table); // true
 * diffStates(view, { ...view, nextId: 3 }); // [{ path: 'nextId', a: 2, b: 3 }]
 * @see engine/sim/state.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { Fnv64, type Canonical } from '../core/hash';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { checkField, isPlainObject, parse, show, type EntryOf, type Schema } from '../core/schema';
import type { SettingValue } from '../core/settings';
import type { TimersState } from '../core/timers';

/** The codes this module raises, with their fixes. */
export const STATE_CODES = defineCodes('sim', {
  SIM_UNKNOWN_COMPONENT: {
    template: '{name} is not a component kind{suggestion}',
    fix: "declare it with defineComponent('{name}', { description, fields }) before an entity holds it (node x describe component lists the declared kinds)",
    doc: 'Raised by the world (engine/sim/world.ts) and the hash (engine/sim/state.ts) for an entity property, a `spawn`, `add`, `remove` or `query` name, or a captured component that no `defineComponent` declared: the hash covers declared components only, so an undeclared one is refused rather than skipped.',
  },
  SIM_UNDECLARED_FIELD: {
    template: 'entity {id} has {name}.{field}, a field the component kind {name} does not declare{suggestion}',
    fix: 'declare the field in defineComponent({name}, { fields }) or stop writing it: the hash and captures read the declared fields only, so an undeclared one would let two different states match',
  },
});

/** One component's data: its fields by name, plain data (numbers, strings, booleans, arrays, plain objects). */
export type ComponentData = Record<string, unknown>;

/** An entity as plain data: its id and its components by kind name. */
export interface EntityData {
  readonly id: number;
  readonly [name: string]: unknown;
}

/** The components of an untyped world: any declared kind, by name. */
export type AnyComponents = Record<string, ComponentData>;

/** An entity: its id and the components it holds, by kind name (`e.position`). */
export type Entity<C extends object = AnyComponents> = { readonly id: number } & {
  [K in Exclude<keyof C, 'id'>]?: C[K];
};

/** An entity known to hold the components `K` (what `query` returns). */
export type With<C extends object, K extends keyof C> = Entity<C> & { [P in K]: C[P] };

/** What `spawn` takes: components by kind name, each with any of its fields (the rest take their defaults). */
export type SpawnSpec<C extends object> = { [K in Exclude<keyof C, 'id'>]?: Partial<C[K]> };

/** The physics part of the world's state, hashed and captured with the rest (WP 3.1 plugs Rapier in; §6.5 items 5–7). */
export interface PhysicsHook {
  /** What the hash covers: every body's translation, rotation and velocities in handle order (a Float64Array). */
  state(): Canonical;
  /** The physics part of a capture: Rapier's snapshot bytes and what else restoring needs. Never hashed. */
  capture(): unknown;
  /** Puts back what `capture()` returned, so the next step continues exactly. */
  restore(data: unknown): void;
}

/** A component kind as `defineComponent` stores it in the registry. */
export interface ComponentKind<S extends Schema = Schema> {
  readonly id: string;
  readonly kind: 'component';
  readonly description: string;
  readonly fields: S;
}

/** The data type of a component of kind fields `S`, as `make` returns it: writable, defaults filled. */
export type ComponentOf<S extends Schema> = { -readonly [K in keyof EntryOf<S>]: EntryOf<S>[K] };

/**
 * What the hash reads, live or stored: the ids, entities (in id order), timers, settings, RNG states and the physics
 * hook's state. `state()` returns one; the world hashes its live parts the same way.
 */
export interface StateView {
  readonly seed: number;
  readonly nextId: number;
  readonly entities: readonly EntityData[];
  readonly timers: TimersState;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly rng: Readonly<Record<string, number>>;
  readonly physics?: Canonical;
}

/** The sim as plain data: what `world.state()` returns and the hash covers. */
export interface WorldState extends StateView {
  readonly entities: EntityData[];
}

/** Per-part and per-entity digests, so a mismatch names the part and the entity (PLAN.md §6.5 item 6). */
export interface WorldTrace {
  /** Steps taken. */
  tick: number;
  /** The same digest as `hash()`. */
  hash: string;
  /** One digest per part: `world` (seed and next id), `entities`, `timers`, `settings`, `rng`, `physics`. */
  parts: Record<string, string>;
  /** One digest per entity, by id. */
  entities: Record<number, string>;
}

/** Where two states part: the path (`entities.7.position.x`) and each side's value (undefined when absent). */
export interface StateDifference {
  path: string;
  a: unknown;
  b: unknown;
}

/** The hash format; changing what the hash reads changes this tag, and with it every golden. */
export const STATE_FORMAT = 'my3dge-state/1';
/** The byte fed for a declared field an entity's component leaves absent (the canonical tags are 0–6). */
const ABSENT = 0xff;
/** Code-unit order, so sorting never depends on the locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A component kind's name: the entity property that holds it. */
const NAME = /^[a-z][A-Za-z0-9]*$/;

/** The problems of a component kind's declaration, as plain sentences. */
function kindProblems(name: string, fields: unknown): string[] {
  const problems: string[] = [];
  if (!NAME.test(name) || name === 'id') {
    problems.push(
      `the name ${show(name)} must be a lower-case word other than "id" (camelCase allowed): it is the entity's property, e.position`,
    );
  }
  if (!isPlainObject(fields)) return [...problems, 'fields must be a schema { name: field }'];
  const hooks = (field: unknown, path: string): void => {
    if (!isPlainObject(field)) return;
    if (field.type === 'function')
      problems.push(`${path} is a hook; component fields hold data the hash and captures read`);
    if (field.items) hooks(field.items, `${path}[]`);
    if (isPlainObject(field.properties))
      for (const [key, sub] of Object.entries(field.properties)) hooks(sub, `${path}.${key}`);
  };
  for (const [key, field] of Object.entries(fields)) {
    problems.push(...checkField(field, key).map((problem) => problem.message));
    hooks(field, key);
  }
  return problems;
}

/** Declares the kind `component` on `registry` unless it has it. */
function componentKind(registry: Registry): void {
  if (registry.kinds().includes('component')) return;
  registry.defineKind('component', {
    description:
      "Component kinds: the plain-object data entities hold (e.position), with their fields. The canonical state and the hash read every component's declared fields, in order.",
    fields: {
      description: { type: 'string', required: true, description: 'What the component is for, in plain sentences.' },
      fields: {
        type: 'object',
        required: true,
        description: 'Its fields, name → schema field (engine/core/schema.ts), in the order the hash reads them.',
      },
    },
    check: (entry) => kindProblems(entry.id, entry.fields),
  });
}
componentKind(sharedRegistry);

/**
 * Declares a component kind on `registry` (the shared one by default): `name` is the entity property that holds it,
 * `fields` its schema. Throws `CORE_BAD_SPEC` for a bad name or field, `CORE_DUPLICATE_ID` when declared twice.
 */
export function defineComponent<const S extends Schema>(
  name: string,
  spec: { description: string; fields: S },
  registry: Registry = sharedRegistry,
): ComponentKind<S> {
  componentKind(registry);
  return registry.def('component', name, spec as unknown as Record<string, unknown>) as unknown as ComponentKind<S>;
}

/** A registry's component kinds, read once each: their field lists and validated new values. */
export interface ComponentTable {
  /** The declared field names of a kind, in order; throws `SIM_UNKNOWN_COMPONENT`. */
  fields(name: string): readonly string[];
  /** A new component: `values` checked against the kind's schema, defaults filled; throws `CORE_BAD_SPEC`. */
  make(name: string, values: unknown, where: string): ComponentData;
}

/** The component table of `registry` (the shared one by default). Kinds never change once declared, so it caches. */
export function componentTable(registry: Registry = sharedRegistry): ComponentTable {
  componentKind(registry);
  const known = new Map<string, { schema: Schema; names: readonly string[] }>();
  const kindOf = (name: string) => {
    let kind = known.get(name);
    if (kind) return kind;
    if (typeof name !== 'string' || !registry.has('component', name)) {
      const ids = registry.list('component').map((entry) => entry.id);
      throw codeError('SIM_UNKNOWN_COMPONENT', { name: show(name), suggestion: didYouMean(String(name), ids) });
    }
    const schema = (registry.get('component', name) as unknown as ComponentKind).fields;
    kind = { schema, names: Object.keys(schema) };
    known.set(name, kind);
    return kind;
  };
  return {
    fields: (name) => kindOf(name).names,
    make: (name, values, where) => parse(kindOf(name).schema, values, `${where}: component ${show(name)}`),
  };
}

/** What a value is, for a refusal: its constructor's name, or its type. */
function whatOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return `a ${typeof value}`;
  if (Array.isArray(value) || isPlainObject(value)) return 'data holding a value the canonical form cannot hold';
  return `a ${(value as object).constructor?.name ?? 'object without a prototype'}`;
}

/** The canonical tag `Fnv64.value` feeds before a number (engine/core/hash.ts), for the number fast path. */
const NUMBER_TAG = 3;
/** Each component name as the bytes `Fnv64.value(name)` feeds (tag 4, UTF-8 length, UTF-8), made once per name. */
const nameBytes = new Map<string, Uint8Array>();

/** Feeds `name` exactly as `h.value(name)` would, from its recorded bytes. */
function feedName(h: Fnv64, name: string): void {
  let record = nameBytes.get(name);
  if (!record) {
    const utf8 = new TextEncoder().encode(name);
    record = new Uint8Array(5 + utf8.length);
    record[0] = 4;
    new DataView(record.buffer).setUint32(1, utf8.length, true);
    record.set(utf8, 5);
    nameBytes.set(name, record);
  }
  h.bytes(record);
}

/** Feeds one entity: its id, then its components sorted by name, each with its declared fields in order. */
function feedEntity(h: Fnv64, entity: EntityData, table: ComponentTable): void {
  const names: string[] = [];
  for (const key in entity) if (key !== 'id' && entity[key] !== undefined) names.push(key);
  names.sort(byText);
  h.number(entity.id).uint32(names.length);
  for (const name of names) {
    const fields = table.fields(name);
    const component = entity[name];
    if (!isPlainObject(component)) {
      throw codeError('CORE_NOT_CANONICAL', { path: `entity ${entity.id}'s ${name}`, what: whatOf(component) });
    }
    feedName(h, name);
    let present = 0;
    for (const field of fields) {
      const value = component[field];
      if (value === undefined) {
        h.byte(ABSENT);
        continue;
      }
      present++;
      if (typeof value === 'number') {
        h.byte(NUMBER_TAG).number(value); // the bytes h.value(value) feeds, without its walk
        continue;
      }
      try {
        h.value(value as Canonical);
      } catch (error) {
        throw codeError(
          'CORE_NOT_CANONICAL',
          { path: `entity ${entity.id}'s ${name}.${field}`, what: whatOf(value) },
          error,
        );
      }
    }
    let held = 0;
    for (const key in component) if (component[key] !== undefined) held++;
    if (held !== present) {
      const field = Object.keys(component).find((key) => component[key] !== undefined && !fields.includes(key)) ?? '';
      throw codeError('SIM_UNDECLARED_FIELD', { id: entity.id, name, field, suggestion: didYouMean(field, fields) });
    }
  }
}

/** Feeds each part of `view`, tagged, into `h` (or into one hasher per part through `part`). */
function feedParts(view: StateView, table: ComponentTable, part: (name: string) => Fnv64): void {
  part('world').value('world').number(view.seed).number(view.nextId);
  const entities = part('entities').value('entities').uint32(view.entities.length);
  for (const entity of view.entities) feedEntity(entities, entity, table);
  part('timers')
    .value('timers')
    .value(view.timers as unknown as Canonical);
  part('settings')
    .value('settings')
    .value(view.settings as Canonical);
  part('rng').value('rng').value(view.rng);
  if (view.physics !== undefined) part('physics').value('physics').value(view.physics);
}

/** The digest of a state, live or stored, as 16 hex digits: what `world.hash()` returns. */
export function hashState(view: StateView, table: ComponentTable = componentTable()): string {
  const h = new Fnv64().value(STATE_FORMAT);
  feedParts(view, table, () => h);
  return h.hex();
}

/** The per-part and per-entity digests of a state (the `hash` field is `hashState`'s). */
export function traceState(view: StateView, tick: number, table: ComponentTable = componentTable()): WorldTrace {
  const parts: Record<string, Fnv64> = {};
  feedParts(view, table, (name) => (parts[name] ??= new Fnv64()));
  const entities: Record<number, string> = {};
  for (const entity of view.entities) {
    const h = new Fnv64();
    feedEntity(h, entity, table);
    entities[entity.id] = h.hex();
  }
  const digests = Object.fromEntries(Object.entries(parts).map(([name, h]) => [name, h.hex()]));
  return { tick, hash: hashState(view, table), parts: digests, entities };
}

/** `path` joined with a key: `.name`, `[2]`, or `["time.hz"]` for a key that is not a plain name. */
function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

/** Pushes the differences between `a` and `b` under `path` onto `out`, until it holds `limit`. */
function diffValues(a: unknown, b: unknown, path: string, out: StateDifference[], limit: number): void {
  if (out.length >= limit || Object.is(a, b)) return;
  const listA = Array.isArray(a) || ArrayBuffer.isView(a) ? (a as ArrayLike<unknown>) : undefined;
  const listB = Array.isArray(b) || ArrayBuffer.isView(b) ? (b as ArrayLike<unknown>) : undefined;
  if (listA && listB) {
    for (let i = 0; i < Math.max(listA.length, listB.length); i++)
      diffValues(listA[i], listB[i], join(path, i), out, limit);
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byText);
    for (const key of keys) diffValues(a[key], b[key], join(path, key), out, limit);
    return;
  }
  const toArray = (v: unknown) => (v as { toArray?: () => unknown[] } | null)?.toArray?.();
  if (toArray(a) && toArray(b)) return diffValues(toArray(a), toArray(b), path, out, limit);
  out.push({ path, a, b });
}

/**
 * Where two states part, field by field, at most `limit` differences: entities are matched by id (`entities.7`
 * for an entity on one side only, `entities.7.position.x` for a field), the rest by key and index.
 */
export function diffStates(a: StateView, b: StateView, limit = 10): StateDifference[] {
  const out: StateDifference[] = [];
  for (const key of ['seed', 'nextId'] as const) diffValues(a[key], b[key], key, out, limit);
  const byId = (list: readonly EntityData[]) => new Map(list.map((entity) => [entity.id, entity]));
  const left = byId(a.entities);
  const right = byId(b.entities);
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort((x, y) => x - y);
  for (const id of ids) diffValues(left.get(id), right.get(id), `entities.${id}`, out, limit);
  for (const key of ['timers', 'settings', 'rng', 'physics'] as const) diffValues(a[key], b[key], key, out, limit);
  return out;
}
