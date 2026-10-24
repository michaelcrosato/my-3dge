/**
 * @file Unit tests for the stage's outline shells (engine/gfx/stageShells.ts), in Node, on stand-ins for the stage's
 * props (one instanced batch) and actors (puppets as skinned meshes): a shell per page and per puppet once synced,
 * hidden at width 0 and shown as a look asks, in its colour; a puppet's shell skinned to its skeleton, dropped with
 * the puppet; every shell registered with the warm-up whatever the look; `dispose()` removes them. What they draw is
 * tests/e2e/playground-looks.spec.ts's.
 * @see engine/gfx/stageShells.ts
 */
import { Bone, BoxGeometry, Matrix4, MeshBasicMaterial, Skeleton, SkinnedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createInstancedBatch } from './instancing';
import type { Puppet } from './puppets/draw';
import { createStageShells, SHELL_LINES } from './stageShells';

/** A puppet as the stage's actors hold one: its skinned mesh. */
function puppet(name: string): Puppet {
  const bone = new Bone();
  const mesh = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
  mesh.name = name;
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  return { mesh } as unknown as Puppet;
}

/** The stage's props and actors, as the shells read them. */
function stand() {
  const batch = createInstancedBatch({ name: 'prop:crate/mesh', geometry: new BoxGeometry(), material: new MeshBasicMaterial() }); // prettier-ignore
  batch.begin();
  for (let i = 0; i < 3; i++) batch.add(new Matrix4().makeTranslation(i, 0, 0).elements);
  batch.end();
  const puppets = new Map<number, Puppet>([[1, puppet('actor#1')]]);
  const parts = { props: { meshes: { batches: () => [batch] } }, actors: { puppets } } as unknown as Parameters<typeof createStageShells>[0]; // prettier-ignore
  return { batch, puppets, parts };
}

describe('createStageShells', () => {
  it('gives every page and puppet its shell, hidden at width 0 and shown as a look asks', () => {
    const { batch, puppets, parts } = stand();
    const shells = createStageShells(parts);
    shells.sync();
    expect(shells.count()).toEqual({ props: 1, bodies: 1 });
    const [page] = batch.root.children.filter((child) => child.userData.outline === true);
    const body = puppets.get(1)!.mesh.children.find((child) => child.userData.outline === true) as SkinnedMesh;
    expect([shells.width, page.visible, body.visible]).toEqual([0, false, false]);
    shells.set({ width: 1, color: '#1a1420' });
    shells.sync();
    expect([shells.width, page.visible, body.visible, (page as unknown as { count: number }).count]).toEqual([1, true, true, 3]); // prettier-ignore
    expect(body.isSkinnedMesh && body.skeleton === puppets.get(1)!.mesh.skeleton).toBe(true);
    expect(SHELL_LINES).toBe(270);
  });

  it('drops a gone puppet’s shell, registers every shell whatever the look, and removes them on dispose', () => {
    const { batch, puppets, parts } = stand();
    const shells = createStageShells(parts);
    const entries = new Map<string, () => readonly unknown[]>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly unknown[] }) => {
        entries.set(id, () => entry.objects());
        return { dispose: () => void entries.delete(id) };
      },
    };
    const registration = shells.register(warmup);
    shells.sync();
    expect([entries.get('shells:props')!().length, entries.get('shells:bodies')!().length]).toEqual([1, 1]);
    puppets.set(2, puppet('actor#2'));
    puppets.delete(1);
    shells.sync();
    expect(shells.count()).toEqual({ props: 1, bodies: 1 });
    expect((entries.get('shells:bodies')!()[0] as SkinnedMesh).parent).toBe(puppets.get(2)!.mesh);
    registration.dispose();
    expect(entries.size).toBe(0);
    shells.dispose();
    expect(batch.root.children.some((child) => child.userData.outline === true)).toBe(false);
    expect(puppets.get(2)!.mesh.children.some((child) => child.userData.outline === true)).toBe(false);
  });
});
