/**
 * @file Tests cutting a smaller set from bigger ones (tools/anim/cut.ts, WP 8.5) on the committed sets: the clips
 * picked with their fit and their libraries' records, the lead library first, `SET:Clip` for a name two sets share,
 * and the errors for a missing clip, an ambiguous one and one picked twice.
 */
import { describe, expect, it } from 'vitest';
import { parseClipSet } from '../../engine/anim/clip/validate';
import { cutSet } from './cut';
import { readSet, splitSet, joinSet } from './repack';

describe('x anim cut', () => {
  const [quaternius, cmu] = [readSet('quaternius'), readSet('cmu')];

  it('picks clips with their fit and their libraries, the first set’s first library leading, the rest in their sets’ order', () => {
    const set = cutSet([quaternius, cmu], ['QUATERNIUS:Walk_Loop', 'Cartwheel', 'cmu:Boxing_Jab'], {
      name: 'HERO',
      title: 'Hero',
    });
    expect(Object.keys(set.clips)).toEqual(['Walk_Loop', 'Cartwheel', 'Boxing_Jab']);
    expect(set.from).toEqual(['QUATERNIUS', 'CMU']);
    expect(Object.keys(set.sources ?? {})).toEqual(['UAL1', 'CMU_13', 'CMU_49']); // the lead, then each set's in its order
    expect(set.fit?.Cartwheel).toEqual(cmu.fit?.Cartwheel);
    expect(set.body).toEqual(quaternius.body);
    expect(parseClipSet(set)).toEqual(set);
    expect(joinSet(splitSet(set))).toEqual(set);
  });

  it('names what it cannot pick', () => {
    expect(() => cutSet([quaternius, cmu], ['Walk_Loop'], { name: 'X' })).toThrow(
      /Walk_Loop is in QUATERNIUS and CMU: pick one as SET:Walk_Loop/,
    );
    expect(() => cutSet([cmu], ['Moonwalk'], { name: 'X' })).toThrow(/no clip Moonwalk in CMU: x anim find Moonwalk/);
    expect(() => cutSet([cmu], ['Cartwheel', 'Cartwheel'], { name: 'X' })).toThrow(/Cartwheel is picked twice/);
    expect(() => cutSet([], ['Cartwheel'], { name: 'X' })).toThrow(/at least one set/);
  });
});
