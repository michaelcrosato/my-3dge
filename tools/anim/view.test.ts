/**
 * @file Tests looking at one clip (tools/anim/view.ts, WP 8.5) on the committed sets: a clip found by `<set>/<clip>`
 * or by a name only one set has, the errors naming the choices, the bake's FK parity with the decode (under the 1 mm
 * mean WP 8.4 proves for every set), and a contact sheet's frames.
 */
import { describe, expect, it } from 'vitest';
import { bakeReport, clipSheet, resolveClip } from './view';

describe('a clip, looked at', () => {
  it('is found by set and name, or by a name only one set has', () => {
    const ref = resolveClip('cmu/Cartwheel');
    expect([ref.set, ref.name, ref.clip.src]).toEqual(['cmu', 'Cartwheel', 'CMU_49']);
    expect(resolveClip('Cartwheel').set).toBe('cmu');
    expect(() => resolveClip('Walk_Loop')).toThrow(/Walk_Loop is in .* and .*: name it as <set>\/Walk_Loop/);
    expect(() => resolveClip('cmu/Moonwalk')).toThrow(/no clip Moonwalk in cmu/);
    expect(() => resolveClip('nosuch/Walk_Loop')).toThrow(/no set nosuch/);
  });

  it('bakes with FK parity under a millimetre on average', () => {
    const { baked, bytes, parity } = bakeReport(resolveClip('cmu/Walk_Loop'));
    expect(baked.frames).toBe(34);
    expect(bytes).toBeGreaterThan(10_000);
    expect(parity.mean).toBeLessThan(1);
    expect(parity.worst).toBeGreaterThanOrEqual(parity.mean);
  });

  it('draws a contact sheet, each frame labelled with its time', () => {
    const sheet = clipSheet(resolveClip('quaternius/Punch_Cross'), { frames: 3, views: ['side'] });
    expect(sheet.frames).toBe(3);
    expect(sheet.svg).toContain('0.00 s');
    expect(sheet.svg).toContain('quaternius/Punch_Cross');
  });
});
