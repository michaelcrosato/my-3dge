/**
 * @file Unit tests for rides on the stage (engine/gfx/stageRides.ts), built in Node with no GPU: a zipline is its
 * cable from anchor to anchor, a pole and a pulley under each anchor above its foot, and a balloon over a balloon's
 * upper anchor; a ladder its two rails and a rung every 0.3 m to its top, across its face; a pad a disc at its top, a
 * trampoline a mat, a rim and four legs; each mesh named `<component>#<id>/<part>` with its entity; a ride is built
 * once, again when its component changes, and removed with its entity; they join the scene with the first ride; the
 * warm-up sees every mesh and the drawn parts' looks in the shader key.
 * @see engine/gfx/stageRides.ts
 */
import { Box3, Group, Vector3, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createMaterialLibrary } from './materials/library';
import { RUNG, createStageRides } from './stageRides';

const ZIPLINE = { from: [0, 8, 0], to: [0, 2, 30], balloon: false, poles: true, feet: [6, 0] };
const BALLOON = { from: [5, 0, 0], to: [5, 60, 0], balloon: true, poles: true, feet: [0, 0] };
const LADDER = { foot: [10, 0, 0], top: 3, normal: [-1, 0], width: 0.6 };
const PAD = { at: [0, 0, 10], size: [1.5, 1.5], reach: 0.3, velocity: [0, 10, 0], bounce: 0, keep: true, mesh: 'pad', solid: false }; // prettier-ignore
const MAT = { ...PAD, at: [4, 0.5, 10], size: [3, 3], mesh: 'trampoline', solid: true };

/** The rides made from `entities`, and what they drew, by mesh name. */
function drawn(entities: { id: number; [kind: string]: unknown }[]) {
  const rides = createStageRides({ scene: new Group(), materials: createMaterialLibrary() });
  const ids = rides.capture(entities);
  const meshes = new Map<string, Mesh>();
  rides.root.traverse((object) => (object as Mesh).isMesh && meshes.set(object.name, object as Mesh));
  return { rides, ids, meshes };
}

/** A mesh's world box. */
const box = (mesh: Mesh) => new Box3().setFromObject(mesh);

describe('rides on the stage', () => {
  it('draw a zipline’s cable, its poles to their feet, and a balloon over a balloon’s line', () => {
    const { ids, meshes } = drawn([
      { id: 3, zipline: ZIPLINE },
      { id: 4, zipline: BALLOON },
    ]);
    expect(ids).toEqual(new Set([3, 4]));
    expect([...meshes.keys()].filter((name) => name.startsWith('zipline#3'))).toEqual(['zipline#3/cable', 'zipline#3/pole0', 'zipline#3/pulley0', 'zipline#3/pole1', 'zipline#3/pulley1']); // prettier-ignore
    const cable = box(meshes.get('zipline#3/cable')!);
    expect([cable.min.z, cable.max.z, cable.max.y]).toEqual([expect.closeTo(-0.02, 1), expect.closeTo(30, 1), expect.closeTo(8, 1)]); // prettier-ignore
    const pole = box(meshes.get('zipline#3/pole0')!);
    expect([pole.min.y, pole.max.y]).toEqual([expect.closeTo(6, 6), expect.closeTo(8, 6)]); // on the tower it stands on
    expect(meshes.get('zipline#3/cable')!.userData).toMatchObject({ entity: 3, component: 'zipline' });
    expect([...meshes.keys()].filter((name) => name.startsWith('zipline#4'))).toEqual(['zipline#4/cable', 'zipline#4/balloon']); // prettier-ignore
    expect(box(meshes.get('zipline#4/balloon')!).getCenter(new Vector3()).y).toBeCloseTo(62.5, 6);
  });

  it('draw a ladder’s rails and a rung every 0.3 m up to its top, across its face', () => {
    const { meshes } = drawn([{ id: 5, ladder: LADDER }]);
    const rungs = [...meshes.keys()].filter((name) => name.includes('/rung'));
    expect(rungs).toHaveLength(Math.floor((LADDER.top + 0.2) / RUNG));
    const rung = box(meshes.get('ladder#5/rung1')!);
    expect([rung.max.z - rung.min.z, rung.max.x - rung.min.x]).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.04, 6),
    ]); // across its face, facing west // prettier-ignore
    expect(box(meshes.get('ladder#5/rail1')!).max.y).toBeCloseTo(LADDER.top + 0.4, 6);
  });

  it('draw a pad’s disc at its top, and a trampoline’s mat, rim and legs', () => {
    const { meshes } = drawn([
      { id: 6, launcher: PAD },
      { id: 7, launcher: MAT },
    ]);
    expect(box(meshes.get('launcher#6/pad')!).max.y).toBeCloseTo(0.02, 6);
    const parts = [...meshes.keys()].filter((name) => name.startsWith('launcher#7')).map((name) => name.split('/')[1].replace(/[-\d]/g, '')); // prettier-ignore
    expect(parts.sort()).toEqual(['leg', 'leg', 'leg', 'leg', 'mat', 'rim', 'rim', 'rim', 'rim']);
    expect(box(meshes.get('launcher#7/mat')!).max.y).toBeCloseTo(0.51, 6);
  });

  it('join the scene with the first ride only', () => {
    const scene = new Group();
    const rides = createStageRides({ scene, materials: createMaterialLibrary() });
    rides.capture([{ id: 1, crate: { x: 0, z: 0 } }]);
    expect(scene.children).toEqual([]); // no ride: the scene keeps the graph it had
    rides.capture([{ id: 5, ladder: LADDER }]);
    expect(scene.children).toEqual([rides.root]);
  });

  it('build a ride once, again when it changes, remove it with its entity, and show the warm-up every mesh', () => {
    const { rides, meshes } = drawn([{ id: 5, ladder: LADDER }]);
    const rung = meshes.get('ladder#5/rung1')!;
    rides.capture([{ id: 5, ladder: LADDER }]);
    expect(rides.root.getObjectByName('ladder#5/rung1')).toBe(rung); // the same: unchanged
    rides.capture([{ id: 5, ladder: { ...LADDER, top: 6 } }]);
    expect(rides.root.getObjectByName('ladder#5/rung1')).not.toBe(rung);
    const registered: (() => unknown[])[] = [];
    const keys = new Map<string, () => string>();
    rides.register({
      register: (_id: string, spec: { objects: () => unknown[] }) => (registered.push(spec.objects), { dispose() {} }),
      keyPart: (name: string, part: () => string) => (keys.set(name, part), { dispose() {} }),
    } as never);
    expect(registered[0]().length).toBe(2 + Math.floor((6 + 0.2) / RUNG));
    expect(keys.get('stage:rides')!()).toBe('ladder');
    expect(rides.capture([])).toEqual(new Set());
    expect(rides.root.children).toHaveLength(0);
  });
});
