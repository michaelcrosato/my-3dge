/**
 * @file Unit tests for the feel panel's arithmetic (engine/dev/feel/panel.ts): a slider runs within the declared range
 * cut to three times the default (or 1, or the value) either side of 0, in steps of 1, 2 or 5 times a power of ten,
 * about a three-hundredth of its span. The panel's DOM is checked in the page
 * (tests/e2e/playground.spec.ts).
 * @see engine/dev/feel/panel.ts
 */
import { describe, expect, it } from 'vitest';
import { sliderRange } from './panel';

describe('the feel panel’s sliders', () => {
  it('run to three times the default, within the declared range, in round steps', () => {
    expect(sliderRange({ value: 4.4069, default: 4.4069, minimum: 0, maximum: 100 })).toEqual([0, 13.25, 0.05]);
    expect(sliderRange({ value: 0.7, default: 0.7, minimum: 0, maximum: 1 })).toEqual([0, 1, 0.002]); // a share: to 1
    expect(sliderRange({ value: 0, default: 0, minimum: 0, maximum: 1 })).toEqual([0, 1, 0.002]); // a default of 0
    expect(sliderRange({ value: 63.5, default: 63.5, minimum: 0, maximum: 1e4 })).toEqual([0, 190.5, 0.5]);
    expect(sliderRange({ value: 20, default: 6.604, minimum: 0, maximum: 100 })[1]).toBe(20); // past it: up to the value
    expect(sliderRange({ value: -2, default: 1 })[0]).toBe(-2); // no minimum: down to the value
    expect(sliderRange({ value: 1, default: 1, minimum: -100 })[0]).toBe(-3); // a wide minimum: three times the default
  });
});
