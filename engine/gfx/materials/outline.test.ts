/**
 * @file Unit tests for outline shells (engine/gfx/materials/outline.ts), in Node: the material (back faces, no fog,
 * the push as its `positionNode`, width and colour as uniforms), a mesh's shell (a child sharing its geometry, no
 * shadows, `userData.outline`), an instanced mesh's shell sharing its instance matrices, a skinned mesh's shell bound
 * to its skeleton (WP 13.24), the refusal (`GFX_OUTLINE_TARGET` for a group), widths given at a number of lines, and
 * a batch's shells: one per page inside the batch's root,
 * sharing each page's matrices, following its count and visibility on `sync()`, growing with the pages, registered
 * with the warm-up and removed by `dispose()`. Where the push puts the line (the ID pass's bounding boxes on
 * instanced box parts) is tests/e2e/materials-v2.spec.ts.
 * @see engine/gfx/materials/outline.ts
 */
import {
  BackSide,
  Bone,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createInstancedBatch } from '../instancing';
import { createOutline, OUTLINE_MODES } from './outline';

describe('createOutline', () => {
  it('makes a back-faced, fogless material whose position node is the push; width and colour are uniforms', () => {
    const outline = createOutline();
    expect(OUTLINE_MODES).toEqual(['normal', 'centre']);
    expect(outline.mode).toBe('normal');
    expect(outline.width).toBe(1);
    expect('#' + outline.color.getHexString()).toBe('#141018');
    expect(outline.material).toMatchObject({ side: BackSide, fog: false, name: 'outline:normal' });
    expect(outline.material.positionNode).not.toBeNull();
    outline.width = 3;
    expect(outline.width).toBe(3);
    outline.color.set('#ff0000');
    expect(outline.material.color.getHex()).toBe(0xff0000);
    const centre = createOutline({ color: '#202020', width: 2, mode: 'centre' });
    expect([centre.mode, centre.width, centre.material.name]).toEqual(['centre', 2, 'outline:centre']);
    outline.dispose();
  });

  it('gives a mesh a shell: a child sharing its geometry, without shadows, marked as its outline', () => {
    const outline = createOutline();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = 'crate';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.entity = 7;
    const shell = outline.shell(mesh);
    expect(shell.parent).toBe(mesh);
    expect(shell.geometry).toBe(mesh.geometry);
    expect(shell.material).toBe(outline.material);
    expect(shell).toMatchObject({ name: 'crate/outline', castShadow: false, receiveShadow: false });
    expect(shell.userData).toEqual({ entity: 7, outline: true });
  });

  it("shares an instanced mesh's matrices, binds a skinned mesh's to its skeleton, and refuses anything not a mesh", () => {
    const outline = createOutline({ mode: 'centre' });
    const instanced = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1100);
    instanced.count = 5;
    const shell = outline.shell(instanced) as InstancedMesh;
    expect(shell.isInstancedMesh).toBe(true);
    expect(shell.instanceMatrix).toBe(instanced.instanceMatrix);
    expect([shell.count, shell.instanceColor]).toEqual([5, null]);
    const bone = new Bone();
    const skinned = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    skinned.userData.entity = 3;
    const body = outline.shell(skinned) as SkinnedMesh;
    expect([body.isSkinnedMesh, body.skeleton, body.parent, body.geometry]).toEqual([true, skinned.skeleton, skinned, skinned.geometry]); // prettier-ignore
    expect([body.bindMode, body.bindMatrix.equals(skinned.bindMatrix)]).toEqual([skinned.bindMode, true]);
    expect(body.userData).toEqual({ entity: 3, outline: true });
    expect(createOutline({ lines: 270 }).material.positionNode).not.toBeNull(); // the width scaled in the shader
    expect(() => outline.shell(new Group() as unknown as Mesh)).toThrow(
      expect.objectContaining({ code: 'GFX_OUTLINE_TARGET' }),
    );
  });
});

describe('outline.batch', () => {
  it('shells every page, sharing its matrices and following its count and visibility, as the pages grow', () => {
    const outline = createOutline({ mode: 'centre' });
    const batch = createInstancedBatch({
      name: 'parts',
      geometry: new BoxGeometry(),
      material: new MeshBasicMaterial(),
    });
    const shells = outline.batch(batch);
    expect(shells.shells).toHaveLength(1);
    expect(shells.shells[0]).toMatchObject({ name: 'parts/page0/outline', count: 0, visible: false });
    expect(shells.shells[0].parent).toBe(batch.root);
    expect(shells.shells[0].instanceMatrix).toBe(batch.pages[0].instanceMatrix);
    const m = new Matrix4();
    batch.begin();
    for (let i = 0; i < 1500; i++) batch.add(m.makeTranslation(i, 0, 0).elements);
    batch.end();
    shells.sync();
    expect(shells.shells.map((shell) => [shell.name, shell.count, shell.visible])).toEqual([
      ['parts/page0/outline', 1024, true],
      ['parts/page1/outline', 476, true],
    ]);
    expect(shells.shells[1].instanceMatrix).toBe(batch.pages[1].instanceMatrix);
    expect(shells.shells[1].userData).toMatchObject({ batch: 'parts', page: 1, outline: true });

    const entries = new Map<string, () => readonly unknown[]>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly unknown[] }) => {
        entries.set(id, () => entry.objects());
        return { dispose: () => void entries.delete(id) };
      },
    };
    const registration = shells.register(warmup);
    expect(entries.get('outline:parts')!()).toEqual(shells.shells);
    registration.dispose();
    expect(entries.size).toBe(0);
    shells.register(warmup, 'outline:mine');
    shells.dispose();
    expect(entries.size).toBe(0);
    expect(batch.root.children.every((child) => !child.userData.outline)).toBe(true);
    expect(shells.shells).toHaveLength(0);
  });
});
