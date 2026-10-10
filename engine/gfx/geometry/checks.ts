/**
 * @file The geometry kit's codes and argument checks (PLAN.md WP 2.4): a builder given sizes it cannot build (a
 * size of 0, a limb shorter than the difference of its radii, a ring whose inner radius is not below its outer)
 * throws `GFX_BAD_GEOMETRY`, naming the shape, the problem and what to pass, before it writes a vertex. A module of
 * its own so every builder raises the same code without importing the others.
 *
 * Invariants: a check never changes its arguments; NaN and infinities fail every check.
 *
 * @example
 * assertSizes('box', { width: 1, height: 2 }); // passes
 * // assertSizes('box', { width: 0 }) throws GFX_BAD_GEOMETRY: cannot build the box: width is 0
 * @see engine/gfx/geometry/kit.test.ts
 */
import { codeError, defineCodes } from '../../core/log';

/** The codes the geometry kit raises, with their fixes. */
export const GEOMETRY_CODES = defineCodes('gfx', {
  GFX_BAD_GEOMETRY: {
    template: 'cannot build the {shape}: {problem}',
    fix: 'pass {expected}',
    doc: 'Raised by the geometry kit (engine/gfx/geometry/) when a builder gets sizes it cannot build: a size of 0 or less, NaN, a limb no longer than the difference of its radii, a ring whose inner radius is not below its outer, fewer segments than the shape needs.',
  },
});

/** Throws `GFX_BAD_GEOMETRY` for `shape` with `problem`, naming what to pass. */
export function badGeometry(shape: string, problem: string, expected: string): never {
  throw codeError('GFX_BAD_GEOMETRY', { shape, problem, expected });
}

/** Throws `GFX_BAD_GEOMETRY` unless every size is a finite number above 0 (or, with `orZero`, at least 0). */
export function assertSizes(shape: string, sizes: Record<string, number>, orZero: readonly string[] = []): void {
  for (const [name, value] of Object.entries(sizes)) {
    const zero = orZero.includes(name);
    if (Number.isFinite(value) && (zero ? value >= 0 : value > 0)) continue;
    badGeometry(shape, `${name} is ${value}`, `${name} in metres, ${zero ? 'at least 0' : 'above 0'}`);
  }
}

/** Throws `GFX_BAD_GEOMETRY` unless `value` is a whole number of segments of at least `min`. */
export function assertSegments(shape: string, name: string, value: number, min: number): void {
  if (Number.isInteger(value) && value >= min) return;
  badGeometry(shape, `${name} is ${value}`, `${name} as a whole number, at least ${min}`);
}
