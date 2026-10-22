/**
 * @file Unit tests for the prop registry (engine/world/props/prop.ts, catalog.ts), in Node: every registry gets the
 * engine's props (the catalog's four, the library's nine, the fittings' four), filled with their defaults, their
 * bodies of engine/physics/bodies.ts's material; the centre is half the body's height; specs with problems are refused
 * naming each; a missing id gives the crate after a warning; the hooks answer from the entry (a dynamic prop is
 * knocked, others are not) and a game's hooks replace them.
 * @see engine/world/props/prop.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../core/registry';
import { PROP_MATERIAL } from '../../physics/bodies';
import { BUILT_IN_PROPS } from './catalog';
import { FITTING_PROPS } from './fittings';
import { LIBRARY_PROPS } from './library';
import { defineProp, getProp, propCentre, type Prop, type PropKnock, type PropTouch } from './prop';

/** A touch of `prop` from the west, recording the knocks it asks for. */
function touchOf(prop: Prop): { touch: PropTouch; knocks: (PropKnock | undefined)[] } {
  const knocks: (PropKnock | undefined)[] = [];
  return { touch: { prop, body: 3, from: [-1, 0, 0], knock: (options) => knocks.push(options) }, knocks };
}

describe('the prop kind', () => {
  it("lists the engine's props, filled, their bodies of the props' material", () => {
    const reg = createRegistry();
    const crate = getProp('prop:crate', reg);
    expect(reg.describe('prop').ids).toEqual([...Object.keys(BUILT_IN_PROPS), ...Object.keys(LIBRARY_PROPS), ...Object.keys(FITTING_PROPS)].sort()); // prettier-ignore
    // The catalog's four, the library's eight (WP 10.3) and the house's fittings (WP 13.16).
    expect(reg.describe('prop').ids).toEqual(['prop:banner', 'prop:barrel', 'prop:bench', 'prop:brazier', 'prop:chair', 'prop:chest', 'prop:crate', 'prop:door', 'prop:garageDoor', 'prop:lamp', 'prop:lantern', 'prop:pane', 'prop:pillar', 'prop:sconce', 'prop:statue', 'prop:switch', 'prop:table']); // prettier-ignore
    const { type, shape, size, density, friction, restitution, linearDamping, angularDamping } = crate.body;
    expect({ type, shape, size }).toEqual({ type: 'dynamic', shape: 'box', size: [0.75, 0.75, 0.75] });
    expect({ density, friction, restitution, linearDamping, angularDamping }).toEqual({ ...PROP_MATERIAL });
    expect(crate.parts).toEqual([
      expect.objectContaining({ name: 'mesh', geometry: 'geometry:box', material: 'material:crate', tint: '#ffffff' }),
    ]);
    expect(crate.parts[0].flame.tongues).toBe(0);
    expect(crate.place).toEqual({ spawn: 'crate', light: '' });
    expect(crate.light.tag).toBe('');
    const brazier = getProp('prop:brazier', reg);
    expect([brazier.body.type, brazier.place.light, brazier.light.tag, brazier.light.flicker]).toEqual([
      'none',
      'torch',
      'torch',
      true,
    ]);
    expect(brazier.parts[0].flame).toMatchObject({ tongues: 3, ring: 0.1, core: '#ffd36a' });
    expect(Object.isFrozen(crate.body)).toBe(true);
  });

  it('puts the centre half the body’s height above the base, at the base without a body', () => {
    const reg = createRegistry();
    const centres = ['prop:crate', 'prop:barrel', 'prop:brazier', 'prop:pillar'].map((id) =>
      propCentre(getProp(id, reg)),
    );
    expect(centres).toEqual([0.375, 0.4375, 0, 1.5]);
    const ball = defineProp('prop:ball', { parts: [{}], body: { type: 'dynamic', shape: 'ball', radius: 0.2 } }, reg);
    const pole = defineProp('prop:pole', { parts: [{}], body: { type: 'fixed', shape: 'capsule', radius: 0.1 } }, reg);
    expect([propCentre(ball), propCentre(pole)]).toEqual([0.2, 0.6]);
  });

  it('refuses a prop with problems, naming each', () => {
    const reg = createRegistry();
    expect(() => defineProp('prop:ghost', {}, reg)).toThrow(/it draws nothing: give it a part, or a light/);
    const bad = () =>
      defineProp(
        'prop:bad',
        {
          parts: [{ tint: 'red', position: [0, 1] }, { flame: { core: '#12345' } }],
          body: { type: 'dynamic', shape: 'box', size: [1, 0, 1] },
          place: { spawn: 'two words' },
          light: { color: '#ffaa00', position: [0, 1, 0, 0] },
        },
        reg,
      );
    expect(bad).toThrow(/\[CORE_BAD_SPEC\]/);
    for (const problem of [
      /parts\[1\]\.name "mesh" is taken by another part/,
      /parts\[0\]\.position has 2 numbers/,
      /parts\[0\]\.tint "red" is not a hex colour/,
      /parts\[1\]\.flame\.core "#12345" is not a hex colour/,
      /a box body needs sizes above 0: size/,
      /light\.position has 4 numbers/,
      /place\.spawn "two words" must be a word/,
    ]) {
      expect(bad).toThrow(problem);
    }
    expect(() => defineProp('prop:heavy', { parts: [{}], body: { type: 'dynamic', density: 0 } }, reg)).toThrow(
      /a dynamic body needs a density above 0/,
    );
    expect(() => defineProp('prop:odd', { parts: [{}], body: { type: 'fixed', shape: 'cone' as 'box' } }, reg)).toThrow(
      /body\.shape/,
    );
    expect(reg.has('prop', 'prop:bad')).toBe(false);
  });

  it('gives the crate for a missing id, after a warning', () => {
    const reg = createRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getProp('prop:crat', reg).id).toBe('prop:crate');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/^\[CORE_UNKNOWN_ID\].*prop:crat.*defineProp/),
    ]);
    warn.mockRestore();
  });

  it('answers hits and uses from the entry: a dynamic prop is knocked, others ignore them', () => {
    const reg = createRegistry();
    for (const [id, knocked] of [
      ['prop:crate', 1],
      ['prop:barrel', 1],
      ['prop:pillar', 0],
      ['prop:brazier', 0],
    ] as const) {
      const prop = getProp(id, reg);
      const { touch, knocks } = touchOf(prop);
      prop.hit(touch);
      prop.use(touch);
      expect(knocks.length, id).toBe(knocked);
    }
    const urn = defineProp(
      'prop:urn',
      {
        parts: [{ geometry: 'geometry:frustum' }],
        body: { type: 'dynamic', shape: 'cylinder', radius: 0.2, height: 0.5 },
        hit: (touch) => touch.knock({ speed: 2, up: 4 }),
        use: (touch) => touch.knock({ speed: 0.5 }),
      },
      reg,
    );
    const { touch, knocks } = touchOf(urn);
    urn.hit(touch);
    urn.use(touch);
    expect(knocks).toEqual([{ speed: 2, up: 4 }, { speed: 0.5 }]);
  });
});
