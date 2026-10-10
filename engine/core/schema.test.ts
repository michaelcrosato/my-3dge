/**
 * @file Unit tests for engine/core/schema.ts (T1): schemas checked (unknown keywords named with the right spelling,
 * defaults that fail their own field, hooks without defaults, every problem at once), specs validated and filled
 * (types, ranges, values, required fields, unknown keys with the closest, nested objects and arrays, copies of
 * defaults and of plain objects given to `any`, inputs left unchanged), deep freezing, the rows `describe` prints,
 * and the TypeScript types of parsed entries.
 * @see engine/core/schema.ts
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  checkField,
  copyValue,
  defineSchema,
  describeSchema,
  freezeValue,
  parse,
  show,
  suggestKey,
  validate,
  type Field,
  type SpecOf,
} from './schema';

const MATERIAL = defineSchema({
  color: { type: 'string', default: '#ffffff', description: 'Base colour, hex.' },
  roughness: { type: 'number', default: 1, minimum: 0, maximum: 1, description: 'Microfacet roughness.' },
  side: { type: 'string', enum: ['front', 'back', 'double'], default: 'front', description: 'Faces drawn.' },
  layers: {
    type: 'array',
    default: [],
    items: { type: 'object', properties: { scale: { type: 'number', minimum: 0, description: 'Its scale.' } } },
    description: 'Detail layers.',
  },
  count: { type: 'integer', minimum: 1, description: 'How many.' },
  name: { type: 'string', required: true, description: 'Its name.' },
  onHit: { type: 'function', default: (damage: number) => damage, description: 'Returns the damage taken.' },
});

describe('defineSchema', () => {
  it('returns a good schema unchanged', () => {
    const fields = { speed: { type: 'number', default: 2, unit: 'm/s', description: 'Speed.' } } as const;
    expect(defineSchema(fields)).toBe(fields);
  });

  it('lists every problem of a schema at once, naming the spelling the language uses', () => {
    const bad = {
      a: { type: 'number', min: 0, doc: 'x', description: 'A.' },
      b: { type: 'float', description: 'B.' },
      c: { type: 'number' },
      d: { type: 'number', default: 5, maximum: 1, description: 'D.' },
      e: { type: 'number', minimum: 2, maximum: 1, description: 'E.' },
      f: { type: 'string', enum: [], description: 'F.' },
      g: { type: 'function', description: 'G.' },
      h: { type: 'string', items: { type: 'number' }, description: 'H.' },
      i: {
        type: 'object',
        properties: { j: { type: 'boolean', default: 'yes', description: 'J.' } },
        description: 'I.',
      },
      k: { type: 'string', enum: ['x'], default: 'y', descriptoin: 'K.' },
    } as unknown as Record<string, Field>;
    let message = '';
    try {
      defineSchema(bad, 'kind "demo"');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^\[CORE_BAD_SCHEMA\] kind "demo": /);
    for (const part of [
      'a: unknown keyword "min" (write minimum)',
      'a: unknown keyword "doc" (write description)',
      'b: type "float" is not one of number, integer, boolean, string, array, object, function, any',
      'c: it needs a description',
      "d's default is 5, above its maximum 1",
      'e: its minimum 2 is above its maximum 1',
      'f: enum must list some values',
      'g: a hook needs a default',
      'h: only an array field takes items',
      "i.j's default is a string; it must be a boolean",
      'k: unknown keyword "descriptoin" (did you mean "description"?)',
      'k: it needs a description',
    ]) {
      expect(message).toContain(part);
    }
  });

  it('accepts a required hook without a default, and nested fields without descriptions inside items', () => {
    expect(checkField({ type: 'function', required: true, description: 'Must be given.' }, 'impl')).toEqual([]);
    expect(checkField({ type: 'array', items: { type: 'number', minimum: 0 }, description: 'Ok.' }, 'xs')).toEqual([]);
    expect(checkField('number', 'x')[0].message).toBe('x is a string; a field is { type, … }');
  });
});

describe('validate and parse', () => {
  it('fills defaults, keeps given values, and copies default arrays so entries never share them', () => {
    const first = parse(MATERIAL, { name: 'stone', roughness: 0.4 });
    const second = parse(MATERIAL, { name: 'moss' });
    expect(first).toMatchObject({ name: 'stone', color: '#ffffff', roughness: 0.4, side: 'front', layers: [] });
    expect('count' in first).toBe(false);
    expect(first.onHit(3)).toBe(3);
    expect(first.layers).not.toBe(second.layers);
    expect(first.layers).not.toBe(MATERIAL.layers.default);
  });

  it('names every problem: types, ranges, values, required fields, unknown keys with the closest', () => {
    const { problems } = validate(MATERIAL, {
      roughnes: 0.5,
      roughness: 2,
      side: 'both',
      count: 1.5,
      color: 3,
      layers: [{ scale: -1 }, { scal: 1 }],
    });
    expect(problems.map((problem) => problem.message)).toEqual([
      'unknown key "roughnes" (did you mean "roughness"?)',
      'color is a number; it must be a string',
      'roughness is 2, above its maximum 1',
      'side is "both", not one of "front", "back", "double"',
      'layers[0].scale is -1, below its minimum 0',
      'layers[1] has an unknown key "scal" (did you mean "scale"?)',
      'count is a number; it must be a whole number',
      'name is required (Its name.)',
    ]);
    expect(problems.map((problem) => problem.path)).toContain('layers[1].scal');
  });

  it('refuses non-finite numbers and a spec that is not a plain object', () => {
    expect(validate(MATERIAL, { name: 'x', roughness: Number.NaN }).problems[0].message).toBe(
      'roughness is NaN; it must be a number',
    );
    expect(validate(MATERIAL, [1]).problems[0].message).toBe('the spec is an array; it must be a plain object { … }');
    expect(validate(MATERIAL, new Map()).problems[0].message).toBe(
      'the spec is a Map; it must be a plain object { … }',
    );
  });

  it('throws CORE_BAD_SPEC with every problem and where, never changing its input', () => {
    const input = { name: 'x', roughness: 3, side: 'up' };
    expect(() => parse(MATERIAL, input, 'material "material:x"')).toThrow(
      '[CORE_BAD_SPEC] material "material:x": roughness is 3, above its maximum 1; side is "up", not one of',
    );
    expect(input).toEqual({ name: 'x', roughness: 3, side: 'up' });
  });

  it('treats an undefined value as absent, and accepts any defined value for type any', () => {
    expect(parse(MATERIAL, { name: 'x', color: undefined }).color).toBe('#ffffff');
    const anything = defineSchema({ v: { type: 'any', description: 'Anything.' } });
    expect(parse(anything, { v: [1, 'a'] }).v).toEqual([1, 'a']);
    expect(validate(anything, { v: null }).problems).toEqual([]);
  });

  it('copies plain objects given to a field of type any, so the caller keeps its own', () => {
    const anything = defineSchema({ v: { type: 'any', description: 'Anything.' } });
    const given = { size: [1, 2], nested: { a: 1 } };
    const parsed = parse(anything, { v: given }).v as typeof given;
    expect(parsed).toEqual(given);
    expect(parsed).not.toBe(given);
    expect(parsed.nested).not.toBe(given.nested);
    const thing = new Map([[1, 2]]);
    expect(parse(anything, { v: thing }).v).toBe(thing);
  });
});

describe('describeSchema and helpers', () => {
  it('lists fields as plain rows, a function default as "function", nested fields as rows', () => {
    const rows = describeSchema(MATERIAL);
    expect(rows.map((row) => row.key)).toEqual(['color', 'roughness', 'side', 'layers', 'count', 'name', 'onHit']);
    expect(rows[1]).toEqual({
      key: 'roughness',
      type: 'number',
      default: 1,
      minimum: 0,
      maximum: 1,
      description: 'Microfacet roughness.',
    });
    expect(rows[6].default).toBe('function');
    expect(rows[3].items?.properties?.[0]).toMatchObject({ key: 'scale', minimum: 0 });
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('suggests the spelling the language uses, shows values, and copies plain data', () => {
    expect(suggestKey('max', ['maximum', 'minimum'])).toBe(' (write maximum)');
    expect(suggestKey('hook', ['type', 'default'])).toBe(" (write type: 'function')");
    expect(suggestKey('colr', ['color'])).toBe(' (did you mean "color"?)');
    expect([show('a'), show(-0), show(() => 0), show(undefined)]).toEqual(['"a"', '-0', 'a function', 'undefined']);
    const data = { a: [1, { b: 2 }] };
    const copy = copyValue(data);
    expect(copy).toEqual(data);
    expect(copy.a).not.toBe(data.a);
  });

  it('freezes plain data all the way down, and leaves other objects as they are', () => {
    const data = { a: [1, { b: 2 }], at: new Map<number, number>() };
    expect(freezeValue(data)).toBe(data);
    expect([Object.isFrozen(data), Object.isFrozen(data.a), Object.isFrozen(data.a[1])]).toEqual([true, true, true]);
    expect(Object.isFrozen(data.at)).toBe(false);
    expect(freezeValue(3)).toBe(3);
  });
});

describe('types', () => {
  it('types parsed entries and specs from the schema', () => {
    const entry = parse(MATERIAL, { name: 'x' });
    expectTypeOf(entry.roughness).toEqualTypeOf<number>();
    expectTypeOf(entry.side).toEqualTypeOf<'front' | 'back' | 'double'>();
    expectTypeOf(entry.count).toEqualTypeOf<number | undefined>();
    expectTypeOf(entry.onHit).toEqualTypeOf<(damage: number) => number>();
    expectTypeOf<SpecOf<typeof MATERIAL>['name']>().toEqualTypeOf<string>();
  });
});
