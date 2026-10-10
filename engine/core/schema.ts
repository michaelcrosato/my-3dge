/**
 * @file The schema mini-language (PLAN.md WP 1.2, §6.6): one plain object per field, saying its type, default,
 * range, unit, docs, allowed values and whether it is required, so registries, settings and inspector arguments are
 * validated, filled and described from one table.
 *
 * Why this shape: a schema is data in JSON Schema's own vocabulary (`type`, `description`, `default`, `minimum`,
 * `maximum`, `enum`, `items`, `properties`), with per-field `required: true` as Mongoose and Vue props write it, the
 * forms agents already know from OpenAPI, tool calling and MCP (doctrine: Common ground). So `x describe` prints it as
 * it is, and WP 7.6's MCP schemas are a projection of it, with no builder library to learn or pin. Its own keywords:
 * `unit` (SI, PLAN.md §6.3), `when` (`now | spawn | scene`: when a change takes effect), `view: true` (a setting
 * that changes only how the game looks or performs, kept out of the hash, captures and replays, WP 1.2), and two
 * types JSON Schema lacks: `function` (a hook: shared code calls `entry.hook(…)` and never compares ids, PLAN.md
 * §6.6) and `any`.
 *
 * Invariants: unknown keys are errors, in schemas and in specs, each naming the closest valid key. A field has a
 * description; a hook has a default unless it is required; a default passes its own field's checks. `parse` returns a
 * new object holding every given key plus the defaults of absent ones (arrays and plain objects copied), never
 * changing its input. Numbers are finite; `integer` is a whole number. Problems are plain sentences naming the key.
 *
 * @example
 * const fields = defineSchema({
 *   roughness: { type: 'number', default: 1, minimum: 0, maximum: 1, description: 'Microfacet roughness.' },
 *   side: { type: 'string', enum: ['front', 'back', 'double'], default: 'front', description: 'Faces drawn.' },
 *   onHit: { type: 'function', default: () => 0, description: 'Called when hit; returns extra damage.' },
 * });
 * parse(fields, { roughness: 0.4 }, 'material "material:stone"'); // { roughness: 0.4, side: 'front', onHit: … }
 * validate(fields, { rougness: 2 }).problems[0].message; // 'unknown key "rougness" (did you mean "roughness"?)'
 * @see engine/core/schema.test.ts
 */
import { codeError, defineCodes, didYouMean } from './log';

/** The codes this module raises, with their fixes. */
export const SCHEMA_CODES = defineCodes('core', {
  CORE_BAD_SCHEMA: {
    template: '{where}: {problems}',
    fix: 'write each field as { type, description, default?, required?, minimum?, maximum?, enum?, unit?, items?, properties?, when?, view? } (engine/core/schema.ts), with a default that passes its own checks, and a default for every hook that is not required',
    doc: 'Raised by `defineSchema` and `defineKind` (engine/core/schema.ts, engine/core/registry.ts) when a field is malformed: an unknown keyword (named with the closest one), an unknown type, a missing description, a default outside its own range or values, a minimum above the maximum, an empty enum, or a hook with neither a default nor `required: true`. `defineSettings` reports the same problems in a setting as `CORE_BAD_SPEC`.',
  },
  CORE_BAD_SPEC: {
    template: '{where}: {problems}',
    fix: 'give each field a value of its type inside its range and values, every required field, and no key the schema lacks (node x describe <kind> lists the fields)',
    doc: 'Raised by `parse` and `def` (engine/core/schema.ts, engine/core/registry.ts) when a spec does not match its schema. Every problem is listed at once, each naming its key, and an unknown key names the closest valid one: nothing is dropped or clamped silently.',
  },
});

/** The value types: JSON's, plus `integer`, `function` (a hook) and `any`. */
export type FieldType = 'number' | 'integer' | 'boolean' | 'string' | 'array' | 'object' | 'function' | 'any';

/** Every `FieldType`, in documentation order. */
export const FIELD_TYPES: readonly FieldType[] = [
  'number',
  'integer',
  'boolean',
  'string',
  'array',
  'object',
  'function',
  'any',
];

/** When a change takes effect: at once, for what spawns next, or when the scene next starts. */
export type When = 'now' | 'spawn' | 'scene';

/** One field: what its values are, documented. Keys follow JSON Schema where it has one (see the file comment). */
export interface Field {
  type: FieldType;
  /** What the field means, one or more plain sentences. Required except inside `items`. */
  description?: string;
  /** The value an absent field takes; a hook's default is a function. */
  default?: unknown;
  /** True when a spec must give the field. */
  required?: boolean;
  /** The smallest number allowed. */
  minimum?: number;
  /** The largest number allowed. */
  maximum?: number;
  /** The only values allowed. */
  enum?: readonly (string | number | boolean)[];
  /** The unit, in SI: `m`, `s`, `m/s`, `rad`, `kg`… */
  unit?: string;
  /** For an array: the field every item matches. */
  items?: Field;
  /** For an object: its own fields (unknown keys are errors). Without it, any plain object. */
  properties?: Schema;
  /** When a change takes effect (settings); `now` when absent. */
  when?: When;
  /** True for a setting that changes only how the game looks or performs (kept out of the hash and replays). */
  view?: boolean;
}

/** A schema: field name → field. */
export type Schema = Readonly<Record<string, Field>>;

/** One thing wrong with a spec or a schema: where (`roughness`, `layers[2].color`) and a plain sentence. */
export interface Problem {
  path: string;
  message: string;
}

/** The TypeScript type of a field's values. */
export type ValueOf<F> = F extends { enum: readonly (infer E)[] }
  ? E
  : F extends { type: 'number' | 'integer' }
    ? number
    : F extends { type: 'boolean' }
      ? boolean
      : F extends { type: 'string' }
        ? string
        : F extends { type: 'array'; items: infer I }
          ? ValueOf<I>[]
          : F extends { type: 'array' }
            ? unknown[]
            : F extends { type: 'object'; properties: infer P extends Schema }
              ? EntryOf<P>
              : F extends { type: 'object' }
                ? Record<string, unknown>
                : F extends { type: 'function'; default: infer D }
                  ? D
                  : F extends { type: 'function' }
                    ? (...args: never[]) => unknown
                    : unknown;

/** Whether field `F` is always present after `parse`: required, or with a default. */
type Present<F> = F extends { required: true } ? true : F extends { default: unknown } ? true : false;

/** What `parse` and `def` accept for schema `S`: the required fields, and any of the others. */
export type SpecOf<S extends Schema> = {
  [K in keyof S as S[K] extends { required: true } ? K : never]: ValueOf<S[K]>;
} & { [K in keyof S as S[K] extends { required: true } ? never : K]?: ValueOf<S[K]> };

/** What `parse` returns for schema `S`: required fields and fields with a default are always present. */
export type EntryOf<S extends Schema> = {
  readonly [K in keyof S as Present<S[K]> extends true ? K : never]: ValueOf<S[K]>;
} & { readonly [K in keyof S as Present<S[K]> extends true ? never : K]?: ValueOf<S[K]> };

/** The keywords a field may use. */
const KEYWORDS = Object.keys({
  type: 1,
  description: 1,
  default: 1,
  required: 1,
  minimum: 1,
  maximum: 1,
  enum: 1,
  unit: 1,
  items: 1,
  properties: 1,
  when: 1,
  view: 1,
} satisfies Record<keyof Field, 1>);

/** Words agents reach for that the language spells differently. */
const SPELLED: Record<string, string> = {
  min: 'minimum',
  max: 'maximum',
  range: 'minimum and maximum',
  doc: 'description',
  docs: 'description',
  help: 'description',
  values: 'enum',
  options: 'enum',
  optional: 'required',
  hook: "type: 'function'",
};

/** ` (write minimum)` for a word the language spells differently, else the closest of `keys`, else `''`. */
export function suggestKey(key: string, keys: readonly string[]): string {
  const spelled = SPELLED[key];
  if (spelled && keys.includes(spelled.split(' ')[0].replace(/:$/, ''))) return ` (write ${spelled})`;
  return didYouMean(key, keys);
}

/** True for `{}` literals and `Object.create(null)`. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** How a value reads in a message: strings quoted, other values as JSON would write them. */
export function show(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** What kind of value `value` is, for a type error. */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'object') return isPlainObject(value) ? 'an object' : `a ${value.constructor?.name ?? 'value'}`;
  return `a ${typeof value}`;
}

/** Whether `value` has type `type`. */
function hasType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'function':
      return typeof value === 'function';
    case 'any':
      return value !== undefined;
  }
}

/** A copy of arrays and plain objects (functions and other values as they are), so defaults are never shared. */
export function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyValue) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)])) as T;
  }
  return value;
}

/** Joins a path and a key: `a` + `b` → `a.b`; an index is written `[2]`. */
const join = (path: string, key: string | number) =>
  typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;

/**
 * Checks one value against its field, pushing each problem onto `problems`; returns the value with the defaults of
 * nested objects filled (a copy when it is an array or object).
 */
export function checkValue(field: Field, value: unknown, path: string, problems: Problem[] = []): unknown {
  const name = path || 'the value';
  if (!hasType(field.type, value)) {
    const want = field.type === 'integer' ? 'a whole number' : field.type === 'any' ? 'a value' : `a ${field.type}`;
    problems.push({ path, message: `${name} is ${kindOf(value)}; it must be ${want}` });
    return value;
  }
  if (field.enum && !field.enum.some((allowed) => Object.is(allowed, value))) {
    problems.push({ path, message: `${name} is ${show(value)}, not one of ${field.enum.map(show).join(', ')}` });
  }
  if (typeof value === 'number') {
    if (field.minimum !== undefined && value < field.minimum) {
      problems.push({ path, message: `${name} is ${show(value)}, below its minimum ${field.minimum}` });
    }
    if (field.maximum !== undefined && value > field.maximum) {
      problems.push({ path, message: `${name} is ${show(value)}, above its maximum ${field.maximum}` });
    }
  }
  if (Array.isArray(value)) {
    const items = field.items;
    return items ? value.map((item, i) => checkValue(items, item, join(path, i), problems)) : copyValue(value);
  }
  if (field.type === 'object' && isPlainObject(value)) {
    return field.properties ? fillObject(field.properties, value, path, problems) : copyValue(value);
  }
  return value;
}

/** Checks a plain object against `schema` and returns it with defaults filled; the core of `validate`. */
function fillObject(schema: Schema, input: Record<string, unknown>, path: string, problems: Problem[]) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(schema, key)) {
      const message = `unknown key ${show(key)}${suggestKey(key, Object.keys(schema))}`;
      problems.push({ path: join(path, key), message: path ? `${path} has an ${message}` : message });
    }
  }
  for (const [key, field] of Object.entries(schema)) {
    const at = join(path, key);
    if (input[key] !== undefined) out[key] = checkValue(field, input[key], at, problems);
    else if (field.required)
      problems.push({ path: at, message: `${at} is required (${field.description ?? field.type})` });
    else if (field.default !== undefined) out[key] = copyValue(field.default);
  }
  return out;
}

/** Checks `input` against `schema`: the filled value (every given key plus absent defaults) and every problem found. */
export function validate<S extends Schema>(schema: S, input: unknown): { value: EntryOf<S>; problems: Problem[] } {
  const problems: Problem[] = [];
  if (!isPlainObject(input)) {
    problems.push({ path: '', message: `the spec is ${kindOf(input)}; it must be a plain object { … }` });
    return { value: {} as EntryOf<S>, problems };
  }
  return { value: fillObject(schema, input, '', problems) as EntryOf<S>, problems };
}

/** Joins problems into one sentence list for an error message. */
export function listProblems(problems: readonly Problem[]): string {
  return problems.map((problem) => problem.message).join('; ');
}

/** `validate`, throwing `CORE_BAD_SPEC` with every problem when there is one; `where` names the spec in the message. */
export function parse<S extends Schema>(schema: S, input: unknown, where = 'the spec'): EntryOf<S> {
  const { value, problems } = validate(schema, input);
  if (problems.length) throw codeError('CORE_BAD_SPEC', { where, problems: listProblems(problems) });
  return value;
}

/** The problems of one field definition (not of a value): the checks `defineSchema` runs on each field. */
export function checkField(field: unknown, path: string, nested = false): Problem[] {
  const problems: Problem[] = [];
  const fail = (message: string) => problems.push({ path, message: `${path}: ${message}` });
  if (!isPlainObject(field)) return [{ path, message: `${path} is ${kindOf(field)}; a field is { type, … }` }];
  for (const key of Object.keys(field)) {
    if (KEYWORDS.includes(key)) continue;
    fail(`unknown keyword ${show(key)}${suggestKey(key, KEYWORDS)}`);
  }
  const f = field as unknown as Field;
  if (!FIELD_TYPES.includes(f.type)) fail(`type ${show(f.type)} is not one of ${FIELD_TYPES.join(', ')}`);
  if (!nested && (typeof f.description !== 'string' || !f.description.trim())) fail('it needs a description');
  if (f.required !== undefined && typeof f.required !== 'boolean') fail('required must be true or false');
  if (f.view !== undefined && typeof f.view !== 'boolean') fail('view must be true or false');
  if (f.unit !== undefined && typeof f.unit !== 'string') fail('unit must be a string such as "m/s"');
  if (f.when !== undefined && !['now', 'spawn', 'scene'].includes(f.when)) fail('when must be now, spawn or scene');
  for (const bound of ['minimum', 'maximum'] as const) {
    if (f[bound] !== undefined && !(typeof f[bound] === 'number' && Number.isFinite(f[bound]))) {
      fail(`${bound} must be a finite number`);
    }
  }
  if (typeof f.minimum === 'number' && typeof f.maximum === 'number' && f.minimum > f.maximum) {
    fail(`its minimum ${f.minimum} is above its maximum ${f.maximum}`);
  }
  if (f.enum !== undefined && (!Array.isArray(f.enum) || f.enum.length === 0)) fail('enum must list some values');
  if (f.items !== undefined) {
    if (f.type !== 'array') fail('only an array field takes items');
    problems.push(...checkField(f.items, `${path}[]`, true));
  }
  if (f.properties !== undefined) {
    if (f.type !== 'object') fail('only an object field takes properties');
    if (!isPlainObject(f.properties)) fail('properties must be a schema { key: field }');
    else for (const [key, sub] of Object.entries(f.properties)) problems.push(...checkField(sub, join(path, key)));
  }
  if (f.type === 'function' && f.default === undefined && !f.required) {
    fail('a hook needs a default (the behaviour of entries that do not set it), or required: true');
  }
  if (problems.length === 0 && f.default !== undefined) {
    const own: Problem[] = [];
    checkValue(f, f.default, `${path}'s default`, own);
    problems.push(...own);
  }
  return problems;
}

/** Checks a schema's fields and returns it unchanged; throws `CORE_BAD_SCHEMA` naming every problem. */
export function defineSchema<const S extends Schema>(schema: S, where = 'the schema'): S {
  if (!isPlainObject(schema)) throw codeError('CORE_BAD_SCHEMA', { where, problems: 'a schema is { key: field }' });
  const problems = Object.entries(schema).flatMap(([key, field]) => checkField(field, key));
  if (problems.length) throw codeError('CORE_BAD_SCHEMA', { where, problems: listProblems(problems) });
  return schema;
}

/** One field as `describe` lists it: its keywords, with a function default shown as `'function'`. */
export type FieldRow = { key: string } & Omit<Field, 'items' | 'properties' | 'default'> & {
    default?: unknown;
    items?: FieldRow;
    properties?: FieldRow[];
  };

/** A schema as plain, JSON-ready rows, in its own key order (for `x describe` and `__engine.describe`). */
export function describeSchema(schema: Schema): FieldRow[] {
  const row = (key: string, field: Field): FieldRow => {
    const { items, properties, default: fallback, ...rest } = field;
    const out: FieldRow = { key, ...rest };
    if (fallback !== undefined) out.default = typeof fallback === 'function' ? 'function' : fallback;
    if (items) out.items = row('[]', items);
    if (properties) out.properties = describeSchema(properties);
    return out;
  };
  return Object.entries(schema).map(([key, field]) => row(key, field));
}
