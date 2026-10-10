/**
 * @file Unit tests for engine/core/registry.ts (T1): kinds declared and refused, entries validated, filled, frozen and
 * defined once, missing ids (warn once and the fallback, or an error naming the closest), sorted listings, the three
 * forms of `describe`, typed kind handles, hooks asked instead of ids, and the shared registry's functions.
 * @see engine/core/registry.ts
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createLog, type LogConsole } from './log';
import { createRegistry, def, defineKind, get, has, list, registry, sameValue, type Registry } from './registry';

/** A registry whose log records instead of printing. */
function setup(): { reg: Registry; warned: string[] } {
  const warned: string[] = [];
  const out: LogConsole = { warn: (line) => warned.push(line), error: () => {} };
  return { reg: createRegistry({ log: createLog({ console: out }) }), warned };
}

const PROP = {
  description: 'A movable object in a level.',
  fields: {
    mass: { type: 'number', default: 10, minimum: 0, unit: 'kg', description: 'Its mass.' },
    tags: { type: 'array', default: [], items: { type: 'string' }, description: 'Free tags.' },
    onHit: { type: 'function', default: () => 'thud', description: 'The sound it makes when hit.' },
  },
  fallback: 'prop:crate',
} as const;

describe('defineKind', () => {
  it('refuses a malformed name, a second declaration, a missing description and unknown keys', () => {
    const { reg } = setup();
    reg.defineKind('prop', PROP);
    expect(() => reg.defineKind('Prop', PROP)).toThrow(/\[CORE_BAD_KIND\] kind "Prop": the name must be/);
    expect(() => reg.defineKind('prop', PROP)).toThrow(/kind "prop": it is already declared/);
    expect(() => reg.defineKind('a', { description: ' ', fields: {} })).toThrow(/it needs a description/);
    expect(() => reg.defineKind('b', { description: 'B.', fields: {}, fallbak: 'x' } as never)).toThrow(
      /unknown key "fallbak" \(did you mean "fallback"\?\)/,
    );
    expect(() => reg.defineKind('c', { description: 'C.', fields: {}, fallback: 3 } as never)).toThrow(
      /fallback must be an id/,
    );
  });

  it('checks the fields as a schema, and keeps id and kind for itself', () => {
    const { reg } = setup();
    const fields = { mass: { type: 'number', default: -1, minimum: 0, description: 'Mass.' } } as const;
    expect(() => reg.defineKind('a', { description: 'A.', fields })).toThrow(
      /\[CORE_BAD_SCHEMA\] kind "a": mass's default is -1, below its minimum 0/,
    );
    const reserved = { id: { type: 'string', description: 'Id.' } } as const;
    expect(() => reg.defineKind('b', { description: 'B.', fields: reserved })).toThrow(/"id" is added to every entry/);
    expect(reg.kinds()).toEqual([]);
  });
});

describe('def', () => {
  it('validates, fills defaults, adds id and kind, and freezes the entry', () => {
    const { reg } = setup();
    reg.defineKind('prop', PROP);
    const barrel = reg.def('prop', 'prop:barrel', { mass: 40 });
    expect(barrel).toMatchObject({ id: 'prop:barrel', kind: 'prop', mass: 40, tags: [] });
    expect(Object.isFrozen(barrel)).toBe(true);
    expect(() => reg.def('prop', 'prop:anvil', { mas: 1, mass: -2 })).toThrow(
      '[CORE_BAD_SPEC] prop "prop:anvil": unknown key "mas" (did you mean "mass"?); mass is -2, below its minimum 0',
    );
    expect(reg.has('prop', 'prop:anvil')).toBe(false);
  });

  it('defines an id once, refuses an empty id, and names the closest kind for an unknown one', () => {
    const { reg } = setup();
    reg.defineKind('prop', PROP);
    reg.def('prop', 'prop:barrel', {});
    expect(() => reg.def('prop', 'prop:barrel', {})).toThrow(
      /\[CORE_DUPLICATE_ID\] prop "prop:barrel" is already defined/,
    );
    expect(() => reg.def('prop', '', {})).toThrow(/the id "" must be a non-empty string/);
    expect(() => reg.def('props', 'prop:x', {})).toThrow(
      /\[CORE_UNKNOWN_KIND\] there is no kind "props" \(did you mean "prop"\?\)/,
    );
  });

  it("runs the kind's whole-entry check", () => {
    const { reg } = setup();
    reg.defineKind('range', {
      description: 'A span.',
      fields: {
        from: { type: 'number', default: 0, description: 'Start.' },
        to: { type: 'number', default: 1, description: 'End.' },
      },
      check: (entry) => (entry.from > entry.to ? [`from ${entry.from} is after to ${entry.to}`] : []),
    });
    expect(reg.def('range', 'range:ok', { to: 5 }).to).toBe(5);
    expect(() => reg.def('range', 'range:bad', { from: 3 })).toThrow(
      '[CORE_BAD_SPEC] range "range:bad": from 3 is after to 1',
    );
  });
});

describe('get', () => {
  it('warns once per missing id, naming the closest ids, and returns the fallback', () => {
    const { reg, warned } = setup();
    reg.defineKind('prop', PROP);
    const crate = reg.def('prop', 'prop:crate', {});
    reg.def('prop', 'prop:barrel', {});
    expect(reg.get('prop', 'prop:barel')).toBe(crate);
    expect(reg.get('prop', 'prop:barel')).toBe(crate);
    reg.get('prop', 'prop:anvil');
    expect(warned).toEqual([
      '[CORE_UNKNOWN_ID] there is no prop "prop:barel" (did you mean "prop:barrel"?); prop "prop:crate" stands in for it: fix the id (node x describe prop lists the defined ones), or define it with def(\'prop\', "prop:barel", { … })',
      expect.stringMatching(/^\[CORE_UNKNOWN_ID\] there is no prop "prop:anvil"; prop "prop:crate" stands in/),
    ]);
  });

  it('throws CORE_NO_ENTRY when the kind has no fallback, or its fallback is not defined', () => {
    const { reg, warned } = setup();
    reg.defineKind('move', { description: 'A move.', fields: {} });
    reg.def('move', 'move:slash', {});
    expect(() => reg.get('move', 'move:slsh')).toThrow(
      /\[CORE_NO_ENTRY\] there is no move "move:slsh" \(did you mean "move:slash"\?\)/,
    );
    reg.defineKind('prop', PROP);
    expect(() => reg.get('prop', 'prop:x')).toThrow(/CORE_NO_ENTRY/);
    expect(warned).toEqual([]);
  });
});

describe('list, kinds and describe', () => {
  it('sorts entries by id and kinds by name, whatever the order they were defined in', () => {
    const { reg } = setup();
    reg.defineKind('prop', PROP);
    reg.defineKind('move', { description: 'A move.', fields: {} });
    for (const id of ['prop:c', 'prop:a', 'prop:b']) reg.def('prop', id, {});
    expect(reg.list('prop').map((entry) => entry.id)).toEqual(['prop:a', 'prop:b', 'prop:c']);
    expect(reg.kinds()).toEqual(['move', 'prop']);
    expect(reg.list('move')).toEqual([]);
  });

  it('describes every kind, one kind, and one entry with its differences from the defaults', () => {
    const { reg } = setup();
    reg.defineKind('prop', PROP);
    reg.defineKind('move', { description: 'A move.', fields: {} });
    reg.def('prop', 'prop:crate', {});
    reg.def('prop', 'prop:bell', { mass: 30, onHit: () => 'dong' });
    expect(reg.describe()).toEqual({
      kinds: [
        { kind: 'move', description: 'A move.', count: 0 },
        { kind: 'prop', description: 'A movable object in a level.', count: 2, fallback: 'prop:crate' },
      ],
    });
    const kind = reg.describe('prop');
    expect(kind).toMatchObject({ kind: 'prop', fallback: 'prop:crate', ids: ['prop:bell', 'prop:crate'] });
    expect(kind.fields.map((field) => [field.key, field.default])).toEqual([
      ['mass', 10],
      ['tags', []],
      ['onHit', 'function'],
    ]);
    expect(reg.describe('prop', 'prop:bell').fields).toEqual([
      { key: 'mass', value: 30, differs: true },
      { key: 'tags', value: [], differs: false },
      { key: 'onHit', value: 'function', differs: true },
    ]);
    expect(reg.describe('prop', 'prop:crate').fields[2]).toEqual({
      key: 'onHit',
      value: 'function (default)',
      differs: false,
    });
    expect(() => reg.describe('prop', 'prop:nope')).toThrow(/CORE_NO_ENTRY/);
    expect(JSON.parse(JSON.stringify(reg.describe('prop')))).toEqual(reg.describe('prop'));
  });
});

describe('kinds as handles, and asking the entry', () => {
  it('binds the kind and types its entries from the schema', () => {
    const { reg } = setup();
    const props = reg.defineKind('prop', PROP);
    const crate = props.def('prop:crate', { mass: 5 });
    expect(props.name).toBe('prop');
    expect(props.get('prop:crate')).toBe(crate);
    expect(props.has('prop:crate')).toBe(true);
    expect(props.list()).toEqual([crate]);
    expectTypeOf(crate.mass).toEqualTypeOf<number>();
    expectTypeOf(crate.tags).toEqualTypeOf<string[]>();
  });

  it('gives every entry its hooks, so shared code calls them instead of comparing ids', () => {
    const { reg } = setup();
    const props = reg.defineKind('prop', PROP);
    props.def('prop:crate', {});
    props.def('prop:bell', { onHit: () => 'dong' });
    expect(props.list().map((prop) => prop.onHit())).toEqual(['dong', 'thud']);
  });
});

describe('the shared registry', () => {
  it('backs defineKind, def, get, has and list', () => {
    defineKind('testWidget', {
      description: 'A test-only kind.',
      fields: { size: { type: 'number', default: 1, description: 'Size.' } },
    });
    const widget = def('testWidget', 'testWidget:a', { size: 2 });
    expect(get('testWidget', 'testWidget:a')).toBe(widget);
    expect(has('testWidget', 'testWidget:b')).toBe(false);
    expect(list('testWidget')).toEqual([widget]);
    expect(registry.kinds()).toContain('testWidget');
  });
});

describe('sameValue', () => {
  it('compares plain data deeply, numbers by Object.is', () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue(0, -0)).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
  });
});
