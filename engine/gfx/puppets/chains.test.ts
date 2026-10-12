/**
 * @file Unit tests for secondary motion drawn (engine/gfx/puppets/chains.ts, WP 7.8): a mesh per part the layer has,
 * named for the ID pass; the cape's ribbon runs along its two edges with both faces lit outward (each face's normals
 * opposite the other's); a strand's corners sit `STRAND` wide round its points; bounds follow the chains; dispose
 * takes the meshes away.
 */
import { BufferAttribute, Group, Mesh, MeshLambertNodeMaterial, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Animator } from '../../anim/character';
import { Secondary } from '../../anim/secondary';
import { createChainMeshes, STRAND } from './chains';

/** A heroic animator wearing `secondary`, walked a second along +Z. */
function walked(secondary: Secondary): Animator {
  const hero = new Animator({ build: 'build:heroic' });
  hero.use('secondary', secondary);
  for (let k = 0; k < 60; k++) hero.update({ velocity: new Vector3(0, 0, 3), position: new Vector3(0, 0, k / 20) });
  return hero;
}

const material = new MeshLambertNodeMaterial({ vertexColors: true });
const at = (mesh: Mesh, v: number) => new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), v);

describe('secondary motion drawn', () => {
  it('draws a cape as a ribbon between its edges, lit on both faces, named for the ID pass', () => {
    const extras = new Secondary({ cape: true, squash: false });
    walked(extras);
    const chains = createChainMeshes(extras, { material, color: '#336699', name: 'actor#7' });
    chains.update();
    expect(chains.meshes.map((mesh) => mesh.name)).toEqual(['actor#7/cape']);
    const [cape] = chains.meshes;
    const { left, right } = extras.cape!;
    expect(cape.geometry.getAttribute('position').count).toBe(4 * left.n);
    for (let i = 0; i < left.n; i++) {
      expect(at(cape, 2 * i).distanceTo(left.points[i])).toBeLessThan(1e-6);
      expect(at(cape, 2 * i + 1).distanceTo(right.points[i])).toBeLessThan(1e-6);
      expect(at(cape, 2 * left.n + 2 * i).distanceTo(left.points[i])).toBeLessThan(1e-6);
    }
    const normal = cape.geometry.getAttribute('normal') as BufferAttribute;
    const [front, back] = [new Vector3().fromBufferAttribute(normal, 2), new Vector3().fromBufferAttribute(normal, 2 + 2 * left.n)]; // prettier-ignore
    expect(front.dot(back)).toBeLessThan(-0.99); // the back's own vertices face the other way
    const sphere = cape.geometry.boundingSphere!;
    expect(sphere.containsPoint(left.points[left.n - 1])).toBe(true);
    expect(cape.castShadow).toBe(true);
  });

  it('draws hair and a tail as strands STRAND wide round their points', () => {
    const extras = new Secondary({ hair: 'long', tail: true, squash: false });
    walked(extras);
    const chains = createChainMeshes(extras, { material, name: 'actor#2' });
    chains.update();
    expect(chains.meshes.map((mesh) => mesh.name)).toEqual(['actor#2/hair', 'actor#2/tail']);
    const [hair, tail] = chains.meshes;
    for (const [mesh, chain, width] of [
      [hair, extras.hair!, STRAND.hair],
      [tail, extras.tail!, STRAND.tail],
    ] as const) {
      expect(mesh.geometry.getAttribute('position').count).toBe(4 * chain.n);
      for (let i = 0; i < chain.n; i++) {
        for (let k = 0; k < 4; k++) {
          expect(at(mesh, 4 * i + k).distanceTo(chain.points[i])).toBeCloseTo(width / Math.SQRT2, 6);
        }
      }
    }
  });

  it('takes the meshes away on dispose', () => {
    const extras = new Secondary({ cape: true, hair: 'ponytail', squash: false });
    walked(extras);
    const chains = createChainMeshes(extras, { material, name: 'actor#3' });
    const parent = new Group();
    parent.add(...chains.meshes);
    chains.dispose();
    expect(parent.children).toEqual([]);
  });
});
