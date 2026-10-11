/**
 * @file Unit tests for blob shadows (engine/gfx/puppets/blobShadow.ts), in Node: the shadow rule carried from
 * `shadowAt` (1 on the floor, falling to 0.35 at 5 m, never smaller, scaled by alpha), each disc's matrix (flat,
 * round, 1.25 cm above its floor), one instance per `add` in call order, the material (the prototype's near-black at
 * 45 % opacity, unlit, writing no depth), drawn after the opaque scene, and a crowd's shadows in one draw call per page.
 * @see engine/gfx/puppets/blobShadow.ts
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createMaterialLibrary } from '../materials/library';
import { BLOB_SHADOW, blobScale, blobShadowMaterial, createBlobShadows } from './blobShadow';

const library = createMaterialLibrary();

describe('the shadow rule', () => {
  it('shrinks the shadow with height: 1 on the floor, 0.35 from 5 m up', () => {
    expect([blobScale(0), blobScale(1), blobScale(2.5), blobScale(5), blobScale(9)]).toEqual([1, 0.8, 0.5, 0.35, 0.35]);
    expect(blobScale(-1), 'below the floor counts as on it').toBe(1);
  });
});

describe('blob shadows', () => {
  it('lays a flat, round disc of radius × scale × alpha, 1.25 cm above its floor', () => {
    const shadows = createBlobShadows({ materials: library });
    shadows.begin();
    shadows.add(3, 2, -4, 0.4);
    shadows.add(1, 0, 1, 0.4, 2.5, 0.5);
    shadows.end();
    const m = new Matrix4();
    const [position, scale] = [new Vector3(), new Vector3()];
    shadows.batch.getMatrixAt(0, m).decompose(position, new Quaternion(), scale);
    expect(position.toArray()).toEqual([3, Math.fround(2 + BLOB_SHADOW.lift), -4]);
    expect(scale.toArray().map((v) => +v.toFixed(6))).toEqual([0.4, 1, 0.4]);
    shadows.batch.getMatrixAt(1, m).decompose(position, new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(0.4 * 0.5 * 0.5, 6);
    expect(shadows.batch.count).toBe(2);
    shadows.dispose();
  });

  it('keeps a faded-out body’s disc as an instance of zero size', () => {
    const shadows = createBlobShadows({ materials: library });
    shadows.begin();
    shadows.add(0, 0, 0, 0.4, 0, 0);
    shadows.end();
    expect(shadows.batch.count).toBe(1);
    expect(shadows.batch.getMatrixAt(0, new Matrix4()).elements[0]).toBe(0);
    shadows.dispose();
  });

  it('draws with the prototype’s near-black at 45 % opacity, unlit, writing no depth, after the opaque scene', () => {
    const shadows = createBlobShadows({ materials: library });
    const page = shadows.batch.pages[0];
    const material = page.material as unknown as Record<string, unknown>;
    expect([material.type, material.transparent, material.opacity, material.depthWrite]).toEqual([
      'MeshBasicMaterial',
      true,
      0.45,
      false,
    ]);
    expect([page.renderOrder, page.castShadow, page.receiveShadow]).toEqual([1, false, false]);
    expect(Object.keys(page.geometry.attributes).sort()).toEqual(['normal', 'position']);
    shadows.dispose();
  });

  it('draws a crowd’s shadows in one draw call per page', () => {
    const shadows = createBlobShadows({ materials: library });
    shadows.begin();
    for (let i = 0; i < 2000; i++) shadows.add(i % 50, 0, Math.floor(i / 50), 0.3);
    shadows.end();
    expect([shadows.batch.stats().pages, shadows.batch.drawCalls(1)]).toEqual([2, 2]);
    shadows.dispose();
  });

  it('defines material:blobShadow on any registry once', () => {
    const reg = createRegistry();
    blobShadowMaterial(reg);
    blobShadowMaterial(reg);
    expect(reg.get('material', 'material:blobShadow').opacity).toBe(0.45);
  });
});
