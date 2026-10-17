/**
 * @file Unit tests for copy as profile (engine/dev/feel/profile.ts): the spec keeps the base profile's character and
 * only the numbers that differ from Apex's, a base's own tuning among them; defined, it makes the character the panel
 * was playing; the text is a `defineMovement` call, with the camera settings that differ after it.
 * @see engine/dev/feel/profile.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createCharacter } from '../../physics/character';
import { defineMovement, getMovement } from '../../physics/movement/profile';
import '../../physics/movement/profiles';
import { tuneCharacter } from '../../physics/movement/settings';
import { profileText, tunedSpec } from './profile';

describe('copy as profile', () => {
  it('keeps the base’s character and only the numbers off Apex’s, and makes the character the panel played', () => {
    const apex = getMovement('movement:apex');
    const overrides = [
      ['gaits', 'sprint', 8],
      [undefined, 'turnRate', 3],
    ] as const;
    const spec = tunedSpec(apex, overrides);
    expect(spec).toEqual({ description: 'movement:apex, as tuned in the feel panel.', character: apex.character, model: { gaits: { sprint: 8 }, turnRate: 3 } }); // prettier-ignore
    const registry = createRegistry();
    defineMovement('movement:playtest', spec as Record<string, unknown>, registry);
    const played = tuneCharacter(createCharacter({ movement: 'movement:apex' }), overrides);
    expect(createCharacter({ movement: 'movement:playtest' }, registry)).toEqual(played);
    expect(tunedSpec(apex, []).model).toEqual({}); // Apex's, untuned
  });

  it('carries a base profile’s own tuning, and writes a defineMovement call with the camera preset after it', () => {
    const registry = createRegistry();
    const quick = defineMovement('movement:quick', { model: { gaits: { run: 5 } } }, registry);
    expect(tunedSpec(quick, [['air', 'speed', 2]]).model).toEqual({ gaits: { run: 5 }, air: { speed: 2 } });
    const text = profileText('movement:playtest', tunedSpec(quick, []), { 'cam.distance': 4 });
    expect(text).toMatch(/^defineMovement\("movement:playtest", \{\n {2}"description": "movement:quick, as tuned/);
    expect(text).toContain('"run": 5');
    expect(text.trimEnd().split('\n').at(-1)).toBe('// {"cam.distance":4}');
  });
});
