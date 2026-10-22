/**
 * @file Unit tests for the drawn faces the agent eye asks (engine/dev/eyeFaces.ts, PLAN.md WP 12.3), on three.js
 * meshes built by hand: a box's top shows to a ray going down and its bottom does not (culled, unless its material
 * draws both sides), a point off its faces is on none, a hidden mesh, an instance past the drawn count, the sky and a
 * skinned mesh are not indexed (an entity's stand-in is), and a mirrored instance keeps its faces outward.
 * @see engine/dev/eyeFaces.ts
 */
import { BoxGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { drawnFaces, FACE_NEAR, type EyeObject } from './eyeFaces';

const DOWN = new Vector3(0, -1, 0);

/** A 1 m box standing on the ground at (x, 0, z), under `root`. */
function box(root: Group, x = 0, z = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.set(x, 0.5, z);
  root.add(mesh);
  return mesh;
}

/** `root`'s drawn faces, its matrices updated. */
function faces(root: Group) {
  root.updateMatrixWorld(true);
  return drawnFaces(root as unknown as EyeObject);
}

describe('the drawn faces', () => {
  it('show a box’s top to a ray going down, not its bottom, nor a point off its faces', () => {
    const root = new Group();
    box(root);
    const drawn = faces(root);
    expect(drawn.count).toBe(12);
    expect(drawn.faceAt(new Vector3(0.2, 1, -0.3), DOWN)?.toArray()).toEqual([0, 1, 0]); // the top, facing up
    expect(drawn.faceAt(new Vector3(0.2, 0, -0.3), DOWN)).toBeNull(); // the bottom faces down, away from the ray
    expect(drawn.faceAt(new Vector3(0.2, 1 + FACE_NEAR / 2, -0.3), DOWN)).not.toBeNull(); // within reach of it
    expect([drawn.faceAt(new Vector3(0.2, 1.05, -0.3), DOWN), drawn.faceAt(new Vector3(0.6, 1, 0), DOWN)]).toEqual([null, null]); // prettier-ignore
    expect(drawn.faceAt(new Vector3(0.5, 0.5, 0), new Vector3(-1, 0, 0))?.toArray()).toEqual([1, 0, 0]); // its east side
  });

  it('show a face from either side when its material draws both', () => {
    const root = new Group();
    (box(root).material as MeshBasicMaterial).side = DoubleSide;
    expect(
      faces(root)
        .faceAt(new Vector3(0.2, 0, -0.3), DOWN)
        ?.toArray(),
    ).toEqual([0, 1, 0]); // turned against the ray
  });

  it('leave out what the frame does not draw as indexed: a hidden mesh, the instances past its count, the sky, a skinned mesh', () => {
    const root = new Group();
    box(root).visible = false;
    box(root, 4).userData.background = true;
    Object.assign(box(root, 8), { isSkinnedMesh: true }); // the GPU poses it
    const batch = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
    batch.setMatrixAt(0, new Matrix4().makeTranslation(-4, 0.5, 0));
    batch.setMatrixAt(1, new Matrix4().makeTranslation(-8, 0.5, 0));
    batch.count = 1;
    root.add(batch);
    const drawn = faces(root);
    const stand = box(root, 12);
    stand.userData.entity = 3; // a stand-in: an entity's, drawn as it is
    const indexed = faces(root);
    expect([drawn.count, indexed.count]).toEqual([12, 24]); // the first instance only, then the stand-in too
    expect([-4, 0, 4, 8, -8, 12].map((x) => indexed.faceAt(new Vector3(x, 1, 0), DOWN) !== null)).toEqual([true, false, false, false, false, true]); // prettier-ignore
  });

  it('keep a mirrored instance’s faces outward', () => {
    const root = new Group();
    const batch = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 1);
    batch.setMatrixAt(0, new Matrix4().makeScale(-1, 1, 1).setPosition(0, 0.5, 0)); // its corners turn clockwise
    root.add(batch);
    const drawn = faces(root);
    expect([drawn.faceAt(new Vector3(0, 1, 0), DOWN)?.toArray(), drawn.faceAt(new Vector3(0, 0, 0), DOWN)]).toEqual([[0, 1, 0], null]); // prettier-ignore
  });
});
