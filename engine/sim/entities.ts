/**
 * @file The shape of an entity's data (PLAN.md §6.5 items 4, 6 and 7, WP 1.4; doctrine: Reproducible): the rules
 * the hash (engine/sim/state.ts), captures and restores (engine/sim/capture.ts) and the world (engine/sim/world.ts)
 * share, so a restored entity is the live one, field for field and in the same order (ADR-0006 amendment 3).
 *
 * The rules: an entity is `{ id, …components }`, its components in name order (code-unit order), each a plain object
 * holding every field its kind declares, in declared order, each defined; and every value is plain data: null,
 * booleans, numbers, strings, arrays and plain objects all the way down, never a class instance (a three.js
 * `Vector3`, a `Map`), a typed array, a function or `undefined` (`SIM_NOT_DATA`). A capture copies data and text
 * restores it, so anything else would come back changed: a `Float32Array` as an array, a `Vector3` as `[x, y, z]`,
 * and keys in another order. Spawn and `add` build entities this way (`placeComponent` keeps the name order); the
 * hash checks it as it reads (`componentNames`, `eachField`: `SIM_BAD_COMPONENT` for a field missing, undefined or
 * out of order, or a component out of name order because it was assigned rather than added); a capture copies it
 * (`capturable`), refusing an object held in two places (`SIM_SHARED_DATA`), which a capture would bring back as two.
 * The keys inside a field's object value are a dictionary: the hash reads them sorted and text restores them sorted.
 *
 * Invariants: nothing here changes an entity except `placeComponent`; every refusal names the entity, component and
 * field; paths are built only for a refusal, so the checks cost little on the hash's hot path.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { componentTable, defineComponent } from './state';
 * const reg = createRegistry();
 * defineComponent('aim', { description: 'Where it points.', fields: { dir: { type: 'any', default: [0, 0, 1], description: 'A unit vector.' } } }, reg);
 * const table = componentTable(reg);
 * const entity = makeEntity(1, { aim: { dir: [1, 0, 0] } });
 * componentNames(entity, table); // ['aim']
 * notData({ v: [1, new Float32Array(2)] }); // { path: '.v[1]', what: 'a Float32Array' }
 * capturable([entity], table)[0].aim; // { dir: [1, 0, 0] }, a copy
 * @see engine/sim/state.test.ts, engine/sim/restore.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { MAX_DEPTH } from '../core/hash';
import { isPlainObject, show } from '../core/schema';
import type { ComponentData, ComponentTable, EntityData } from './state';

/** The codes this module raises, with their fixes. */
export const ENTITY_CODES = defineCodes('sim', {
  SIM_NOT_DATA: {
    template: '{path} is {what}; component fields hold plain data',
    fix: 'store numbers, strings, booleans, null, arrays or plain objects (a direction as x, y, z numbers or an [x, y, z] list) and build the Vector3 or typed array inside the system that uses it; hold another entity by its id, never the object',
    doc: 'Raised by `spawn`, `add`, the hash, `capture` and `restore` (engine/sim/entities.ts, engine/sim/state.ts, engine/sim/capture.ts) for a component field holding a class instance (a three.js `Vector3`, a `Map`), a typed array, a function, `undefined` or a cycle: captures copy plain data and text restores it, so such a value would come back changed or shared (ADR-0006 amendment 3). `defineComponent` refuses such a default as `CORE_BAD_SPEC`.',
  },
  SIM_BAD_COMPONENT: {
    template: 'entity {id}{problem}',
    fix: "give components with spawn() or w.add(id, '<name>', values), which keep them in name order with every declared field in declared order, then write fields one by one (e.mods.z = 1); never delete a field or assign undefined, and take a component away with w.remove: a restore rebuilds entities in that order, so code iterating one sees the same order",
  },
  SIM_SHARED_DATA: {
    template: '{path} is the same object as {other}',
    fix: 'give each place its own data: copy it ({ ...values }, [...list]) or hold the other entity by its id and read it through w.get(id); a capture copies each place separately, so a shared object would come back as two',
  },
});

/** A live entity: its id fixed, its components writable. */
export type LiveEntity = { readonly id: number; [name: string]: unknown };

/** A live entity with `id` (read-only) and the components of `data` (all but its id), in `data`'s order. */
export function makeEntity(id: number, data: Readonly<Record<string, unknown>>): LiveEntity {
  const entity = Object.defineProperty({}, 'id', { value: id, enumerable: true }) as LiveEntity;
  for (const name in data) if (name !== 'id') entity[name] = data[name];
  return entity;
}

/** Puts `component` on a live `entity` as `name`, keeping components in name order (later ones are put back after). */
export function placeComponent(entity: LiveEntity, name: string, component: ComponentData): void {
  if (Object.hasOwn(entity, name)) {
    entity[name] = component;
    return;
  }
  const later = Object.keys(entity).filter((key) => key !== 'id' && key > name);
  const moved = later.map((key) => entity[key]);
  for (const key of later) delete entity[key];
  entity[name] = component;
  later.forEach((key, i) => (entity[key] = moved[i]));
}

/** Where a value stops being plain data, and what is there; undefined when it is all plain data. */
export interface NotData {
  /** The way in from the value (`[2].at`), empty for the value itself. */
  path: string;
  /** What is there: `a Vector3`, `undefined`. */
  what: string;
}

/**
 * Checks that `value` is plain data (null, booleans, numbers, strings, arrays and plain objects all the way down) and
 * says where it is not; the path is built only for a refusal.
 */
export function notData(value: unknown, depth = 0): NotData | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value !== 'object') return { path: '', what: value === undefined ? 'undefined' : `a ${typeof value}` };
  if (depth >= MAX_DEPTH) return { path: '', what: `nested deeper than ${MAX_DEPTH} levels (a cycle?)` };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = notData(value[i], depth + 1);
      if (bad) return { path: `[${i}]${bad.path}`, what: bad.what };
    }
    return;
  }
  if (!isPlainObject(value)) return { path: '', what: whatOf(value) };
  for (const key in value) {
    const bad = notData(value[key], depth + 1);
    if (bad) return { path: `.${key}${bad.path}`, what: bad.what };
  }
}

/**
 * The component names of an entity, in name order, after checking each is a declared kind (`SIM_UNKNOWN_COMPONENT`)
 * holding a plain object (`SIM_NOT_DATA`). A `live` entity (the world's own) must also hold them defined and in name
 * order, the order spawn, `add` and restores keep (`SIM_BAD_COMPONENT`); a stored one (text, a copy) is sorted.
 */
export function componentNames(entity: EntityData, table: ComponentTable, live = true): string[] {
  const names: string[] = [];
  let previous = '';
  for (const key in entity) {
    if (!live && key !== 'id' && entity[key] === undefined) continue;
    if (key === 'id') continue;
    table.fields(key);
    const component = entity[key];
    if (component === undefined) {
      throw codeError('SIM_BAD_COMPONENT', {
        id: entity.id,
        problem: `'s ${key} is undefined: take it away with w.remove`,
      });
    }
    if (!isPlainObject(component)) {
      const what = typeof component === 'object' && component !== null ? whatOf(component) : `a ${typeof component}`;
      throw codeError('SIM_NOT_DATA', { path: `entity ${entity.id}'s ${key}`, what });
    }
    if (key < previous && live) {
      const problem = ` holds ${key} out of name order (after ${previous}): it was assigned (e.${key} = …), not added`;
      throw codeError('SIM_BAD_COMPONENT', { id: entity.id, problem });
    }
    previous = key;
    names.push(key);
  }
  return live ? names : names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Calls `visit(key, value)` for each field of the entity's component `name`, in declared order, after checking it
 * holds exactly the declared `fields`, each defined (`SIM_UNDECLARED_FIELD`, `SIM_BAD_COMPONENT`); a `live`
 * component must also hold them in declared order, while a stored one is read in that order whatever its key order.
 */
export function eachField(
  entity: EntityData,
  name: string,
  fields: readonly string[],
  visit: (key: string, value: unknown) => void,
  live = true,
): void {
  const component = entity[name] as ComponentData;
  if (!live) {
    for (const key of fields) {
      if (component[key] === undefined) throw fieldError(entity.id, name, component, fields, fields.indexOf(key));
      visit(key, component[key]);
    }
    let count = 0;
    for (const key in component) if (component[key] !== undefined) count++;
    if (count !== fields.length) {
      const extra = Object.keys(component).find((key) => component[key] !== undefined && !fields.includes(key));
      throw fieldError(entity.id, name, component, fields, 0, extra);
    }
    return;
  }
  let at = 0;
  for (const key in component) {
    const value = component[key];
    if (key !== fields[at] || value === undefined) throw fieldError(entity.id, name, component, fields, at, key);
    at++;
    visit(key, value);
  }
  if (at !== fields.length) throw fieldError(entity.id, name, component, fields, at);
}

/** The error for a component whose fields break the rule at declared position `at` (where `key` came instead). */
function fieldError(
  id: number,
  name: string,
  component: ComponentData,
  fields: readonly string[],
  at: number,
  key?: string,
) {
  if (key !== undefined && !fields.includes(key)) {
    return codeError('SIM_UNDECLARED_FIELD', { id, name, field: key, suggestion: didYouMean(key, fields) });
  }
  if (key !== undefined && key === fields[at])
    return codeError('SIM_BAD_COMPONENT', { id, problem: `'s ${name}.${key} is undefined` });
  const wanted = fields[at];
  const problem =
    component[wanted] === undefined
      ? `'s ${name} lacks its field ${wanted} (deleted, undefined or never written)`
      : `'s ${name} holds ${wanted} after ${key}: its fields go in declared order (${fields.join(', ')})`;
  return codeError('SIM_BAD_COMPONENT', { id, problem });
}

/** What an object that is not plain data is, for a refusal: its constructor's name. */
function whatOf(value: object): string {
  return `a ${value.constructor?.name ?? 'object without a prototype'}`;
}

/** What `copyData` met that a capture cannot hold: a value that is not plain data, or an object seen before. */
class Refusal {
  /** The value, or the object met a second time. */
  readonly value: unknown;
  /** True when the object was met before (shared), false when the value is not plain data. */
  readonly shared: boolean;

  constructor(value: unknown, shared: boolean) {
    this.value = value;
    this.shared = shared;
  }
}

/** A deep copy of plain data, every object added to `seen`; throws a `Refusal` (named by `capturable`). */
function copyData(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') throw new Refusal(value, false);
  if (seen.has(value)) throw new Refusal(value, true);
  seen.add(value);
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = copyData(value[i], seen);
    return out;
  }
  if (!isPlainObject(value)) throw new Refusal(value, false);
  const out: Record<string, unknown> = {};
  for (const key in value) out[key] = copyData(value[key], seen);
  return out;
}

/** A live entity copied for a capture, checked as the hash checks it (state.ts); `seen` spans the whole capture. */
function copyEntity(entity: EntityData, table: ComponentTable, seen: Set<object>): EntityData {
  const out: Record<string, unknown> = { id: entity.id };
  for (const name of componentNames(entity, table)) {
    const component: Record<string, unknown> = {};
    if (seen.has(entity[name] as object)) throw new Refusal(entity[name], true);
    seen.add(entity[name] as object);
    eachField(entity, name, table.fields(name), (key, value) => (component[key] = copyData(value, seen)));
    out[name] = component;
  }
  return out as EntityData;
}

/** The first two places among `entities` where `target` sits (`entity 2's pos.v`), each object walked once. */
function placesOf(entities: readonly EntityData[], target: unknown): string[] {
  const found: string[] = [];
  const walked = new Set<object>();
  const visit = (value: unknown, path: string): void => {
    if (found.length >= 2) return;
    if (value === target) found.push(path);
    if (typeof value !== 'object' || value === null || walked.has(value)) return;
    walked.add(value);
    if (!Array.isArray(value) && !isPlainObject(value)) return;
    for (const [key, item] of Object.entries(value))
      visit(item, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`);
  };
  for (const entity of entities) {
    for (const [name, component] of Object.entries(entity))
      if (name !== 'id') visit(component, `entity ${entity.id}'s ${name}`);
  }
  return found;
}

/**
 * The entities copied for a capture: plain data only (`SIM_NOT_DATA`) and no object in two places
 * (`SIM_SHARED_DATA`): a capture copies each place separately, so a shared object would come back as two.
 */
export function capturable(entities: readonly EntityData[], table: ComponentTable): EntityData[] {
  const seen = new Set<object>();
  try {
    return entities.map((entity) => copyEntity(entity, table, seen));
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    const [first, second] = placesOf(entities, error.value);
    if (error.shared) throw codeError('SIM_SHARED_DATA', { path: second ?? first, other: first });
    const bad = notData(error.value);
    throw codeError('SIM_NOT_DATA', { path: first ?? 'a field', what: bad?.what ?? show(error.value) });
  }
}
