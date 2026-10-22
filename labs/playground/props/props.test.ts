/**
 * @file Unit tests for the playground's own props (labs/playground/props/house.ts, outdoors.ts; PLAN.md WP 13.18): each
 * is registered, and every part of each builds its geometry from its parameters as the view would
 * (engine/gfx/geometry/geometry.ts `buildGeometry`), so a part the view refuses (a limb of no length) fails here, not
 * in a page.
 * @see labs/playground/props/house.ts
 */
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../engine/gfx/geometry/geometry';
import { getProp } from '../../../engine/sim-api';
import { HOUSE_PROPS } from './house';
import { OUTDOOR_PROPS } from './outdoors';

const IDS = [...Object.keys(HOUSE_PROPS), ...Object.keys(OUTDOOR_PROPS)];

describe("the playground's props", () => {
  it('registers each, and builds every part of each from its parameters', () => {
    const refused: string[] = [];
    for (const id of IDS) {
      for (const part of getProp(id).parts) {
        try {
          buildGeometry({ geometry: part.geometry, params: part.params }).dispose();
        } catch (error) {
          refused.push(`${id} ${part.name}: ${(error as Error).message}`);
        }
      }
    }
    expect([IDS.length > 20, refused]).toEqual([true, []]);
  });
});
