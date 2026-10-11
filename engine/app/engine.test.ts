/**
 * @file Unit tests for the page engine's error records (engine/app/engine.ts, PLAN.md §8.3, WP 2.7): `recordOf` keeps
 * a coded error's own code and values, reads a `GfxError`'s values back from its message through the code's template
 * (a `GfxError` carries only its message), and files anything else under the code it is given, with its message.
 * tests/e2e/box.spec.ts starts the page, with WebGPU and without.
 * @see engine/app/engine.ts
 */
import { describe, expect, it } from 'vitest';
import { codeError } from '../core/log';
import { GfxError } from '../gfx/renderer';
import { recordOf } from './engine';
import './view'; // registers APP_NO_VIEW

describe('recordOf', () => {
  it("reads a GfxError's values back from its message through the code's template", () => {
    const reason = 'navigator.gpu.requestAdapter() gave no adapter';
    expect(recordOf(new GfxError('GFX_NO_WEBGPU', { reason }), 'APP_START')).toEqual(['GFX_NO_WEBGPU', { reason }]);
    // a value with regular-expression characters, colons and a line break comes back whole
    const odd = 'adapter [x] (y)? a+b: $1 \\d\nsecond line';
    expect(recordOf(new GfxError('GFX_NO_WEBGPU', { reason: odd }), 'APP_START')).toEqual([
      'GFX_NO_WEBGPU',
      { reason: odd },
    ]);
  });

  it("keeps a coded error's own code and values, and files anything else under the code given", () => {
    const coded = codeError('APP_NO_VIEW', { member: 'camera.get' });
    expect(recordOf(coded, 'APP_START')).toEqual(['APP_NO_VIEW', { member: 'camera.get' }]);
    expect(recordOf(new TypeError('x is not a function'), 'APP_FRAME')).toEqual([
      'APP_FRAME',
      { message: 'x is not a function' },
    ]);
    expect(recordOf('a string thrown', 'APP_START')).toEqual(['APP_START', { message: 'a string thrown' }]);
    const unknown = Object.assign(new Error('from elsewhere'), { code: 'ENOENT' });
    expect(recordOf(unknown, 'APP_START')).toEqual(['APP_START', { message: 'from elsewhere' }]);
  });

  it("marks a value it cannot read back from a message that does not match the code's template", () => {
    const changed = Object.assign(new Error('another wording'), { code: 'GFX_NO_WEBGPU' });
    expect(recordOf(changed, 'APP_START')).toEqual(['GFX_NO_WEBGPU', { reason: '?' }]);
  });
});
