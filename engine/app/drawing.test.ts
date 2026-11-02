/**
 * @file Unit tests for the page drawing's cameras (engine/app/drawing.ts): a warm-up compiles for every camera of the
 * view in `gfx.warmUp: all`, and in `asked` only for those the page has drawn with, in the view's order. The drawing
 * itself starts in a page: tests/e2e/box.spec.ts, tests/e2e/warm-up.spec.ts.
 * @see engine/app/drawing.ts
 */
import { describe, expect, it } from 'vitest';
import { warmedCameras } from './drawing';

describe('warmedCameras', () => {
  it("is every camera of the view in all, and in asked only those drawn, in the view's order", () => {
    const [perspective, orthographic] = [{ id: 1 }, { id: 2 }];
    const both = [perspective, orthographic] as const;
    expect(warmedCameras(both, new Set(), false)).toEqual(both);
    expect(warmedCameras(both, new Set([orthographic]), false)).toEqual(both);
    expect(warmedCameras(both, new Set(), true)).toEqual([]);
    expect(warmedCameras(both, new Set([orthographic]), true)).toEqual([orthographic]);
    expect(warmedCameras(both, new Set([orthographic, perspective]), true)).toEqual(both);
  });
});
