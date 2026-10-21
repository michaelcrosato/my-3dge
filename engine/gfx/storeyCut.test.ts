/**
 * @file Unit tests for engine/gfx/storeyCut.ts (T1; WP 13.15): the plan shows the player's storey and those below,
 * the roof only outdoors, everything for a player outside; the place of the feet is their storey, indoors in a room or
 * under a roof's footprint, none on a roof or outside; on the storey house's meshes it hides by `visible`, the
 * cutaway's twins with their parts, says when anything changed, and shows everything again on `clear`.
 * @see engine/gfx/storeyCut.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mesh, MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../fixtures/levels/storeys/glyphs';
import { createRegistry } from '../core/registry';
import { compileLevel } from '../world/level/compile';
import { createLevelMeshes } from './level/meshes';
import { createStoreyCut, cutPlace, planStoreys } from './storeyCut';

describe('planStoreys', () => {
  const pieces = [0, 1, 2, 3].map((storey) => ({ storey, roof: false })).concat({ storey: 3, roof: true });
  it('shows the player’s storey and those below, the roof only outdoors, everything for a player outside', () => {
    expect(planStoreys(pieces, 1, true)).toEqual([true, true, false, false, false]);
    expect(planStoreys(pieces, 3, true)).toEqual([true, true, true, true, false]); // in the attic: the roof off
    expect(planStoreys(pieces, 3, false)).toEqual([true, true, true, true, true]);
    expect(planStoreys(pieces, -1, true)).toEqual([true, true, true, true, true]);
    expect(planStoreys([{ roof: false }], 0, true)).toEqual([true]); // a level of one storey
  });
});

const registry = createRegistry();
defineStoreyFixtureGlyphs(registry);
const fixture = (name: string) => compileLevel(readFileSync(join(import.meta.dirname, `../../fixtures/levels/storeys/${name}.txt`), 'utf8'), { file: `${name}.txt`, registry }); // prettier-ignore
const house = fixture('house');

describe('cutPlace', () => {
  it('stands the feet on their storey, indoors in a room or under a roof, nowhere on a roof or outside', () => {
    expect([cutPlace(house, 2, 0, 2), cutPlace(house, 0.75, 6, 2.25)]).toEqual([{ storey: 1, indoors: true }, { storey: 3, indoors: true }]); // prettier-ignore
    expect([cutPlace(house, 2, -1e-5, 2), cutPlace(house, 0.9, -3.0000068, 0.9)]).toEqual([
      { storey: 1, indoors: true },
      { storey: 0, indoors: true },
    ]); // feet a hair into the floor, as a body's rest
    expect([cutPlace(house, 4, 7.5, 1.5), cutPlace(house, -0.25, 0, 2)]).toEqual([{ storey: -1, indoors: false }, { storey: -1, indoors: false }]); // prettier-ignore
    const shed = fixture('shed'); // no room marked: under its roof is indoors
    expect([cutPlace(shed, 1.5, 0, 2), cutPlace(shed, 1.5, 2.7, 2)]).toEqual([{ storey: 0, indoors: true }, { storey: -1, indoors: false }]); // prettier-ignore
  });
});

describe('createStoreyCut on the storey house', () => {
  const meshes = createLevelMeshes(house, { materials: { get: () => new MeshBasicMaterial() } });
  const shown = () => meshes.root.children.filter((child) => child.visible).map((child) => child.name.replace('level:house/', '')); // prettier-ignore

  it('hides what stands above the player’s storey, the roof indoors, and says when anything changed', () => {
    const cut = createStoreyCut(meshes);
    expect(cut.set(1, true)).toBe(true);
    expect(shown().every((name) => name.startsWith('cellar/') || name.startsWith('ground/'))).toBe(true);
    expect(shown()).toContain('ground/heads');
    expect(cut.set(1, true)).toBe(false); // nothing changed
    cut.set(3, true);
    expect([shown().includes('attic/roof'), shown().some((name) => name.startsWith('attic/'))]).toEqual([false, true]);
    cut.set(3, false);
    expect(shown()).toContain('attic/roof');
    expect(cut.clear()).toBe(false); // already whole
    expect(shown().length).toBe(meshes.root.children.length);
  });

  it('hides a twin the cutaway adds later with its part', () => {
    const cut = createStoreyCut(meshes);
    cut.set(0, true);
    const twin = Object.assign(new Mesh(), { name: 'level:house/upper/wall:cut' });
    twin.userData.storey = 2;
    meshes.root.add(twin);
    cut.set(0, true); // the same storey, a new mesh under the root
    expect(twin.visible).toBe(false);
    cut.clear();
    twin.removeFromParent();
  });
});
