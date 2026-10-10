/**
 * @file Unit tests for the geometry registry (engine/gfx/geometry/geometry.ts, builtins.ts), in Node: every registry
 * gets the kit's shapes, each building at its defaults what its builder builds, within its vertex budget and clean
 * by the QA measures; parameters are checked against the entry's schema; a game defines its own shape; a parameter
 * schema without defaults is refused; a missing id builds `geometry:box` after a warning.
 * @see engine/gfx/geometry/geometry.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../core/registry';
import { boxGeometry } from './box';
import { BUILT_IN_GEOMETRY } from './builtins';
import { buildGeometry, defineGeometry, getGeometry, type GeometryEntry } from './geometry';
import { inspectGeometry } from './inspect';
import { ringGeometry } from './ring';
import { roundedBoxGeometry } from './roundedBox';

describe('the geometry kind', () => {
  it("lists the kit's shapes, each clean at its defaults and within its budget", () => {
    const reg = createRegistry();
    getGeometry('geometry:box', reg);
    expect(reg.describe('geometry').ids).toEqual(Object.keys(BUILT_IN_GEOMETRY).sort());
    for (const entry of reg.list('geometry') as unknown as GeometryEntry[]) {
      const report = inspectGeometry(buildGeometry(entry.id, reg));
      expect(report.vertices, entry.id).toBeLessThanOrEqual(entry.budget);
      expect(report.vertices, entry.id).toBeGreaterThan(entry.budget / 3);
      expect(
        [report.missing, report.badIndex, report.nonFinite, report.degenerate, report.badNormals, report.flipped],
        entry.id,
      ).toEqual([[], 0, 0, 0, 0, 0]);
    }
  });

  it('builds what the builder builds, with the parameters given and the rest at their defaults', () => {
    const reg = createRegistry();
    const built = buildGeometry({ geometry: 'geometry:ring', params: { height: 0.2, radialSegments: 8 } }, reg);
    const direct = ringGeometry({ height: 0.2, radialSegments: 8 });
    expect(Array.from(built.getAttribute('position').array)).toEqual(Array.from(direct.getAttribute('position').array));
    expect(inspectGeometry(buildGeometry('geometry:roundedBox', reg)).vertices).toBe(
      inspectGeometry(roundedBoxGeometry()).vertices,
    );
    expect(buildGeometry('geometry:box', reg)).not.toBe(buildGeometry('geometry:box', reg));
    expect(() => buildGeometry({ geometry: 'geometry:box', params: { width: -1 } }, reg)).toThrow(/CORE_BAD_SPEC/);
    expect(() => buildGeometry({ geometry: 'geometry:box', params: { widht: 2 } }, reg)).toThrow(/widht/);
  });

  it("defines a game's own shape and refuses a parameter without a default", () => {
    const reg = createRegistry();
    defineGeometry(
      'geometry:crate',
      {
        description: 'A crate: a rounded box.',
        params: { size: { type: 'number', default: 0.8, minimum: 0.1, unit: 'm', description: 'Its side.' } },
        budget: 300,
        create: ({ size }) => roundedBoxGeometry({ width: size, height: size, depth: size, radius: 0.04 }),
      },
      reg,
    );
    expect(inspectGeometry(buildGeometry({ geometry: 'geometry:crate', params: { size: 1 } }, reg)).max[1]).toBeCloseTo(
      1,
      6,
    );
    expect(() =>
      defineGeometry(
        'geometry:bad',
        {
          description: 'No default.',
          params: { size: { type: 'number', description: 'Its side.' } },
          create: () => boxGeometry(),
        },
        reg,
      ),
    ).toThrow(/params\.size needs a default/);
  });

  it('builds geometry:box at its defaults for a missing id, after a warning', () => {
    const reg = createRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const built = buildGeometry({ geometry: 'geometry:crat', params: { size: 2 } }, reg);
    expect(inspectGeometry(built).max).toEqual([0.5, 1, 0.5]);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/^\[CORE_UNKNOWN_ID\].*geometry:crat/),
    ]);
    warn.mockRestore();
  });
});
