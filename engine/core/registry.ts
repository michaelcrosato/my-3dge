/**
 * @file Data-first registries (PLAN.md §6.6, WP 1.2): `defineKind` declares a kind of content with its schema,
 * `def` validates and stores one entry, `get`, `has` and `list` read them, and `describe` lists kinds, fields and
 * ids for `x describe` and `__engine.describe()`. Materials, props, levels, moves, settings, scenes and inspector
 * members are all kinds.
 *
 * Ask the entry, never the id: shared code reads an entry's fields and hooks, each with a default on the kind's
 * schema, and never compares ids (ESLint's `local/ask-the-entry`), so new content works without editing the code that
 * uses it. Ids are strings namespaced by convention (`move:slash`, `prop:crate`; PLAN.md §6.3).
 *
 * Invariants: an entry is the parsed spec (defaults filled, schema.ts) plus `id` and `kind`, a copy frozen all the way
 * down, so neither the spec, the schema's defaults nor a reader can change it. An id is defined once per kind, and
 * stored only once the kind's check passes. A missing id is an error unless the kind names a `fallback` entry: then
 * `get` warns once per id (`CORE_UNKNOWN_ID`, naming the closest ids) and returns the fallback. Both messages name
 * the kind's `defineWith` (`def('<kind>', id, { … })` by default). `list` and `describe` sort by id, so
 * order never depends on import order. A kind's optional `check` adds whole-entry rules beyond its fields.
 * `registry` is the engine's one shared registry (what `x describe` lists); tests make their own with
 * `createRegistry`.
 *
 * Carried from `my-3d2dge:src/emberdeep/00-core.js:76-87` (`REG`, `def`, `reg`), with schemas, fallbacks and codes.
 *
 * @example
 * const reg = createRegistry();
 * const props = reg.defineKind('prop', {
 *   description: 'A movable object in a level.',
 *   fields: { mass: { type: 'number', default: 10, minimum: 0, unit: 'kg', description: 'Its mass.' } },
 *   fallback: 'prop:crate',
 * });
 * props.def('prop:crate', {});
 * reg.def('prop', 'prop:barrel', { mass: 40 });
 * reg.get('prop', 'prop:barrel').mass; // 40
 * props.list().map((prop) => prop.id); // ['prop:barrel', 'prop:crate']
 * reg.describe('prop').ids; // ['prop:barrel', 'prop:crate']
 * @see engine/core/registry.test.ts
 */
import { codeError, defineCodes, didYouMean, log as sharedLog, type Log } from './log';
import {
  defineSchema,
  describeSchema,
  freezeValue,
  isPlainObject,
  listProblems,
  parse,
  show,
  type EntryOf,
  type FieldRow,
  type Schema,
  type SpecOf,
} from './schema';

/** The codes this module raises, with their fixes. */
export const REGISTRY_CODES = defineCodes('core', {
  CORE_BAD_KIND: {
    template: 'kind {kind}: {problem}',
    fix: "declare each kind once, as defineKind('<kind>', { description, fields, fallback?, check?, defineWith? }), the name a lower-case word (camelCase allowed)",
    doc: 'Raised by `defineKind` (engine/core/registry.ts) for a malformed name, a kind declared twice, a missing description, or a key the declaration does not take. Problems inside `fields` raise `CORE_BAD_SCHEMA`.',
  },
  CORE_UNKNOWN_KIND: {
    template: 'there is no kind {kind}{suggestion}',
    fix: 'name a declared kind (node x describe lists them), or import the module that declares it before using it',
  },
  CORE_DUPLICATE_ID: {
    template: '{kind} {id} is already defined',
    fix: 'give the new entry another id, or remove one of the two def calls for it',
    doc: 'Raised by `def` (engine/core/registry.ts). The last definition never silently wins: two entries with one id usually mean a copied file whose id was not changed.',
  },
  CORE_UNKNOWN_ID: {
    template: 'there is no {kind} {id}{suggestion}; {kind} {fallback} stands in for it',
    fix: 'fix the id (node x describe {kind} lists the defined ones), or define it with {define}',
    doc: 'Advice from `get` (engine/core/registry.ts), printed once per missing id, when the kind has a fallback: play goes on with the fallback entry, so a typo shows as the fallback (a crate, a default material) instead of a crash.',
  },
  CORE_NO_ENTRY: {
    template: 'there is no {kind} {id}{suggestion}',
    fix: 'fix the id (node x describe {kind} lists the defined ones), or define it with {define}; a kind declared with a fallback returns that entry instead',
    doc: 'Raised by `get` and `describe` (engine/core/registry.ts) for an id the kind lacks when there is nothing to stand in: the kind has no fallback, or its fallback is not defined either.',
  },
});

/** A registry entry: the parsed spec plus its `id` and `kind`. */
export type Entry<S extends Schema = Schema> = EntryOf<S> & { readonly id: string; readonly kind: string };

/** How a kind is declared. */
export interface KindSpec<S extends Schema = Schema> {
  /** What the kind is for, in plain sentences. */
  description: string;
  /** Its fields (schema.ts). `id` and `kind` are added to every entry and cannot be fields. */
  fields: S;
  /** The id of the entry `get` returns, after a warning, for a missing id; without it a missing id throws. */
  fallback?: string;
  /** Whole-entry rules beyond the fields: the problems of a parsed entry, as plain sentences ([] when fine). */
  check?: (entry: Entry<S>) => string[];
  /** How a new entry is written, for the missing-id messages: `def('<kind>', '<id>', { … })` when absent. */
  defineWith?: string;
}

/** A declared kind, bound: the same as the registry's functions with the kind filled in, typed by its schema. */
export interface Kind<S extends Schema = Schema> {
  readonly name: string;
  def(id: string, spec: SpecOf<S>): Entry<S>;
  get(id: string): Entry<S>;
  has(id: string): boolean;
  list(): Entry<S>[];
}

/** What `describe()` returns: every kind, with its entry count. */
export interface KindsDescription {
  kinds: { kind: string; description: string; count: number; fallback?: string }[];
}

/** What `describe(kind)` returns: the kind's fields and ids. */
export interface KindDescription {
  kind: string;
  description: string;
  fallback?: string;
  fields: FieldRow[];
  ids: string[];
}

/** What `describe(kind, id)` returns: each field's value, marked where it differs from the default. */
export interface EntryDescription {
  kind: string;
  id: string;
  fields: { key: string; value: unknown; differs: boolean }[];
}

/** A set of kinds and their entries. */
export interface Registry {
  /** Declares a kind; returns it bound, typed by its fields. Throws `CORE_BAD_KIND` or `CORE_BAD_SCHEMA`. */
  defineKind<const S extends Schema>(kind: string, spec: KindSpec<S>): Kind<S>;
  /** Validates `spec` against the kind's schema and stores the entry. Throws `CORE_BAD_SPEC`, `CORE_DUPLICATE_ID`. */
  def(kind: string, id: string, spec: Record<string, unknown>): Entry;
  /** The entry; a missing id warns once and returns the kind's fallback, or throws `CORE_NO_ENTRY` without one. */
  get(kind: string, id: string): Entry;
  /** Whether the kind has the id (no warning). */
  has(kind: string, id: string): boolean;
  /** The kind's entries, sorted by id. */
  list(kind: string): Entry[];
  /** The declared kinds, sorted. */
  kinds(): string[];
  /** Every kind; one kind's fields and ids; or one entry's values. */
  describe(): KindsDescription;
  describe(kind: string): KindDescription;
  describe(kind: string, id: string): EntryDescription;
}

/** A declared kind's state. */
interface KindState {
  spec: KindSpec;
  entries: Map<string, Entry>;
}

/** Code-unit order, so sorting never depends on the locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The keys `defineKind` takes. */
const KIND_KEYS = ['description', 'fields', 'fallback', 'check', 'defineWith'];

/** Makes an empty registry; `registry` is the engine's shared one. Missing-id advice goes to `options.log`. */
export function createRegistry(options: { log?: Log } = {}): Registry {
  const log = options.log ?? sharedLog;
  const kinds = new Map<string, KindState>();
  /** The advice values of each missing id read so far, so a typo read every frame computes its suggestion once. */
  const standIns = new Map<string, Record<string, string>>();

  const kindOf = (kind: string): KindState => {
    const state = kinds.get(kind);
    if (!state) throw codeError('CORE_UNKNOWN_KIND', { kind: show(kind), suggestion: didYouMean(kind, kinds.keys()) });
    return state;
  };
  const missing = (kind: string, id: string, state: KindState) => ({
    kind,
    id: show(id),
    suggestion: didYouMean(id, state.entries.keys()),
    define: state.spec.defineWith ?? `def('${kind}', ${show(id)}, { … })`,
  });

  function describe(): KindsDescription;
  function describe(kind: string): KindDescription;
  function describe(kind: string, id: string): EntryDescription;
  function describe(kind?: string, id?: string): KindsDescription | KindDescription | EntryDescription {
    if (kind === undefined) {
      const rows = [...kinds.keys()].sort(byText).map((name) => {
        const { spec, entries } = kinds.get(name) as KindState;
        const row = { kind: name, description: spec.description, count: entries.size };
        return spec.fallback === undefined ? row : { ...row, fallback: spec.fallback };
      });
      return { kinds: rows };
    }
    const state = kindOf(kind);
    const { spec } = state;
    if (id === undefined) {
      const ids = [...state.entries.keys()].sort(byText);
      const out: KindDescription = { kind, description: spec.description, fields: describeSchema(spec.fields), ids };
      if (spec.fallback !== undefined) out.fallback = spec.fallback;
      return out;
    }
    const entry = state.entries.get(id);
    if (!entry) throw codeError('CORE_NO_ENTRY', missing(kind, id, state));
    const fields = Object.entries(spec.fields).map(([key, field]) => {
      const value = entry[key];
      if (typeof value === 'function') {
        const differs = value !== field.default;
        return { key, value: differs ? 'function' : 'function (default)', differs };
      }
      return { key, value, differs: !sameValue(value, field.default) };
    });
    return { kind, id, fields };
  }

  const registry: Registry = {
    defineKind<const S extends Schema>(kind: string, spec: KindSpec<S>): Kind<S> {
      const bad = (problem: string) => codeError('CORE_BAD_KIND', { kind: show(kind), problem });
      if (typeof kind !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(kind)) {
        throw bad('the name must be a lower-case word (camelCase allowed)');
      }
      if (kinds.has(kind)) throw bad('it is already declared; declare each kind once');
      if (!isPlainObject(spec))
        throw bad('the declaration must be { description, fields, fallback?, check?, defineWith? }');
      for (const key of Object.keys(spec)) {
        if (!KIND_KEYS.includes(key)) throw bad(`unknown key ${show(key)}${didYouMean(key, KIND_KEYS)}`);
      }
      if (typeof spec.description !== 'string' || !spec.description.trim()) throw bad('it needs a description');
      if (spec.fallback !== undefined && typeof spec.fallback !== 'string') throw bad('fallback must be an id');
      if (spec.check !== undefined && typeof spec.check !== 'function') throw bad('check must be a function');
      if (spec.defineWith !== undefined && (typeof spec.defineWith !== 'string' || !spec.defineWith.trim())) {
        throw bad("defineWith must be a sentence, such as 'defineSettings({ … })'");
      }
      defineSchema(spec.fields, `kind ${show(kind)}`);
      for (const reserved of ['id', 'kind']) {
        if (Object.hasOwn(spec.fields, reserved)) throw bad(`"${reserved}" is added to every entry; rename that field`);
      }
      kinds.set(kind, { spec: spec as KindSpec, entries: new Map() });
      return {
        name: kind,
        def: (id, entrySpec) => registry.def(kind, id, entrySpec as Record<string, unknown>) as Entry<S>,
        get: (id) => registry.get(kind, id) as Entry<S>,
        has: (id) => registry.has(kind, id),
        list: () => registry.list(kind) as Entry<S>[],
      };
    },

    def(kind, id, spec) {
      const state = kindOf(kind);
      const where = `${kind} ${show(id)}`;
      if (typeof id !== 'string' || !id) {
        throw codeError('CORE_BAD_SPEC', { where: kind, problems: `the id ${show(id)} must be a non-empty string` });
      }
      if (state.entries.has(id)) throw codeError('CORE_DUPLICATE_ID', { kind, id: show(id) });
      const entry = freezeValue({ id, kind, ...parse(state.spec.fields, spec, where) }) as Entry;
      const problems = state.spec.check?.(entry) ?? [];
      if (problems.length) {
        throw codeError('CORE_BAD_SPEC', {
          where,
          problems: listProblems(problems.map((message) => ({ path: '', message }))),
        });
      }
      state.entries.set(id, entry);
      return entry;
    },

    get(kind, id) {
      const state = kindOf(kind);
      const entry = state.entries.get(id);
      if (entry) return entry;
      const fallback = state.spec.fallback;
      const standIn = fallback === undefined ? undefined : state.entries.get(fallback);
      if (!standIn) throw codeError('CORE_NO_ENTRY', missing(kind, id, state));
      const subject = `${kind} ${id}`;
      let values = standIns.get(subject);
      if (!values) standIns.set(subject, (values = { ...missing(kind, id, state), fallback: show(fallback) }));
      log.warnOnce('CORE_UNKNOWN_ID', values, subject);
      return standIn;
    },

    has(kind, id) {
      return kindOf(kind).entries.has(id);
    },

    list(kind) {
      const { entries } = kindOf(kind);
      return [...entries.keys()].sort(byText).map((id) => entries.get(id) as Entry);
    },

    kinds() {
      return [...kinds.keys()].sort(byText);
    },

    describe,
  };
  return registry;
}

/** Deep equality of plain data (arrays, plain objects, numbers by `Object.is`). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    );
  }
  return false;
}

/** The engine's shared registry: what `x describe` and `__engine.describe()` list. */
export const registry: Registry = createRegistry();

/** Declares a kind on the shared registry (`Registry.defineKind`). */
export function defineKind<const S extends Schema>(kind: string, spec: KindSpec<S>): Kind<S> {
  return registry.defineKind(kind, spec);
}

/** Defines an entry on the shared registry (`Registry.def`). */
export function def(kind: string, id: string, spec: Record<string, unknown>): Entry {
  return registry.def(kind, id, spec);
}

/** Reads an entry from the shared registry (`Registry.get`). */
export function get(kind: string, id: string): Entry {
  return registry.get(kind, id);
}

/** Whether the shared registry's kind has the id (`Registry.has`). */
export function has(kind: string, id: string): boolean {
  return registry.has(kind, id);
}

/** The shared registry's entries of a kind, sorted by id (`Registry.list`). */
export function list(kind: string): Entry[] {
  return registry.list(kind);
}
