/**
 * @file Unit tests for drawing puppets (engine/gfx/puppets/draw.ts), in Node, with three.js's own CPU skinning
 * (`SkinnedMesh.getVertexPosition`, what the vertex shader computes): the rigid-skinned geometry (two groups, one bone
 * per vertex at weight 1, the slots' colours, the `geo` QA family's checks), the bones bound at rest, every socket
 * where FK puts it in posed, moved and scaled poses (the bones, and the skinned centres of the pieces on sockets),
 * the bounding sphere holding every posed vertex, the draw-call count, and the instanced crowd: its batches per shape,
 * its instance matrices where FK puts the pieces, its colours and draw calls, and the warm-up registration. The GPU half
 * (pixels where FK says, draw calls counted by the renderer) is tests/e2e/puppets.spec.ts.
 * @see engine/gfx/puppets/draw.ts
 */
import { Matrix4, Quaternion, Vector3, type BufferAttribute, type SkinnedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { defineEveryPart } from '../../../fixtures/bodies/everyPart';
import { defineSocketMarks } from '../../../fixtures/bodies/socketMarks';
import { forwardKinematics, jointPosition, socketPosition } from '../../anim/fk';
import { Pose } from '../../anim/pose';
import { JOINTS, SOCKETS, type SocketName } from '../../anim/skeleton';
import { createRegistry } from '../../core/registry';
import { inspectGeometry } from '../geometry/inspect';
import { createMaterialLibrary } from '../materials/library';
import { compileBody, type CompiledBody } from './compile';
import { createPuppet, createPuppetBatches, puppetGeometry, unitGeometry, type PieceRange } from './draw';

const library = createMaterialLibrary();
const humanoid = compileBody('body:humanoid', 'build:heroic');
const everyPart = compileBody(defineEveryPart(createRegistry()), 'build:chibi');

/** A seeded pose: every joint turned up to `spread` radians about a random axis; the root moved, turned, scaled. */
function randomPose(seed: number, spread = 1.2): Pose {
  let state = seed * 7919 + 17;
  const next = () => ((state = (state * 48271) % 2147483647) / 2147483647) * 2 - 1;
  const pose = new Pose();
  const q = new Quaternion();
  for (let j = 0; j < JOINTS.length; j++) {
    const axis = new Vector3(next(), next(), next()).normalize();
    pose.setRotation(j, q.setFromAxisAngle(axis, next() * spread));
  }
  pose.rootPos.set(next() * 5, next(), next() * 5);
  pose.rootRot.setFromAxisAngle(new Vector3(next(), 1, next()).normalize(), next() * 3);
  pose.rootScale.setScalar(1 + next() * 0.3);
  return pose;
}

/** The skinned centre of a piece's vertices (its unit shape is centrally symmetric): the middle of their bounds. */
function skinnedCentre(mesh: SkinnedMesh, range: PieceRange): Vector3 {
  const [min, max, v] = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity), new Vector3()]; // prettier-ignore
  for (let i = range.start; i < range.start + range.count; i++) {
    mesh.getVertexPosition(i, v);
    min.min(v);
    max.max(v);
  }
  return min.add(max).multiplyScalar(0.5);
}

/** The pieces on sockets: the eyes and the hands (balls on the grips). */
const ON_SOCKETS: Record<string, SocketName> = {
  'mirror[7]': 'eyeL',
  'mirror[7] (right)': 'eyeR',
  'mirror[6]': 'weaponL',
  'mirror[6] (right)': 'weaponR',
};

describe('the rigid-skinned geometry', () => {
  const geometry = puppetGeometry(humanoid);
  const ranges = geometry.userData.pieces as PieceRange[];

  it('holds the lit pieces in group 0 and the eyes in group 1', () => {
    const index = geometry.getIndex()!;
    expect(geometry.groups).toEqual([
      { start: 0, count: geometry.groups[0].count, materialIndex: 0 },
      { start: geometry.groups[0].count, count: index.count - geometry.groups[0].count, materialIndex: 1 },
    ]);
    expect(ranges.slice(-2).map((range) => range.shape)).toEqual(['eye', 'eye']);
    expect(ranges.reduce((sum, range) => sum + range.count, 0)).toBe(geometry.getAttribute('position').count);
  });

  it('skins each vertex to its piece’s bone alone, coloured by its slot', () => {
    const [skinIndex, skinWeight, color] = ['skinIndex', 'skinWeight', 'color'].map(
      (name) => geometry.getAttribute(name) as BufferAttribute,
    );
    for (const range of ranges) {
      const piece = humanoid.pieces.find((p) => p.part === range.part && p.shape === range.shape)!;
      const rgb = humanoid.colors[range.slot].map(Math.fround);
      for (const i of [range.start, range.start + range.count - 1]) {
        expect([skinIndex.getX(i), skinWeight.getX(i), skinWeight.getY(i)], range.part).toEqual([piece.bone + 1, 1, 0]);
        expect([color.getX(i), color.getY(i), color.getZ(i)], range.part).toEqual(rgb);
      }
    }
  });

  it('leaves out an empty group: a body of glow pieces only draws once', () => {
    const marks = compileBody(defineSocketMarks(createRegistry()), 'build:chibi');
    expect(puppetGeometry(marks).groups).toEqual([{ start: 0, count: expect.any(Number), materialIndex: 1 }]);
    expect(createPuppet(marks, { materials: library }).drawCalls(1)).toBe(2);
  });

  it('passes the geo QA family’s checks: finite, no degenerate or flipped triangles, unit normals', () => {
    for (const compiled of [humanoid, everyPart]) {
      const report = inspectGeometry(puppetGeometry(compiled));
      expect([report.nonFinite, report.badIndex, report.degenerate, report.badNormals, report.flipped]).toEqual([
        0, 0, 0, 0, 0,
      ]);
    }
    for (const shape of ['ball', 'eye', 'box', 'cone', 'blade', 'strip', 'limb@0.5'] as const) {
      const report = inspectGeometry(unitGeometry(shape));
      expect([report.degenerate, report.badNormals, report.flipped], shape).toEqual([0, 0, 0]);
    }
  });
});

describe('a puppet', () => {
  const puppet = createPuppet(humanoid, { materials: library });
  const { mesh } = puppet;
  const ranges = mesh.geometry.userData.pieces as PieceRange[];

  it('has a root bone and one per joint, named, and the body’s two materials', () => {
    expect(mesh.skeleton.bones.map((bone) => bone.name)).toEqual(['root', ...JOINTS]);
    expect(mesh.name).toBe('puppet:body:humanoid');
    const [lit, glow] = mesh.material as { vertexColors: boolean; type: string }[];
    expect([lit.vertexColors, glow.vertexColors, glow.type]).toEqual([true, true, 'MeshBasicMaterial']);
  });

  it('is bound at rest: the skinned rest pose is the geometry', () => {
    puppet.setPose(new Pose());
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < position.count; i += 7) {
      expect(mesh.getVertexPosition(i, v).distanceTo(new Vector3().fromBufferAttribute(position, i))).toBeLessThan(
        1e-6,
      );
    }
  });

  it('draws every socket where FK puts it, within 1 mm, in posed, moved and scaled poses', () => {
    let worst = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const pose = randomPose(seed);
      puppet.setPose(pose);
      mesh.updateMatrixWorld(true);
      const world = forwardKinematics(humanoid.skeleton, pose);
      for (const socket of SOCKETS) {
        worst = Math.max(
          worst,
          puppet.socketPosition(socket).distanceTo(socketPosition(humanoid.skeleton, world, socket)),
        );
      }
      for (const range of ranges.filter((r) => ON_SOCKETS[r.part])) {
        const fk = socketPosition(humanoid.skeleton, world, ON_SOCKETS[range.part]);
        worst = Math.max(worst, skinnedCentre(mesh, range).distanceTo(fk));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('keeps every posed vertex inside its bounding sphere', () => {
    const v = new Vector3();
    const position = mesh.geometry.getAttribute('position');
    for (let seed = 1; seed <= 10; seed++) {
      puppet.setPose(randomPose(seed, Math.PI));
      mesh.updateMatrixWorld(true);
      const sphere = mesh.boundingSphere!;
      for (let i = 0; i < position.count; i++) {
        expect(sphere.containsPoint(mesh.getVertexPosition(i, v))).toBe(true);
      }
    }
  });

  it('draws in 2 draw calls, 4 with one shadow map: within 10', () => {
    expect([puppet.drawCalls(), puppet.drawCalls(1)]).toEqual([2, 4]);
  });

  it('registers its mesh with the warm-up, and frees its geometry', () => {
    const seen: (readonly unknown[])[] = [];
    puppet.register({ register: (_id, entry) => (seen.push(entry.objects()), { dispose() {} }) });
    expect(seen).toEqual([[mesh]]);
    puppet.dispose();
    expect(mesh.parent).toBeNull();
  });
});

describe('instanced puppets', () => {
  /** Draws `n` humanoids in their seeded poses; returns the batches. */
  function crowd(n: number, compiled: CompiledBody = humanoid) {
    const batches = createPuppetBatches({ materials: library });
    batches.begin();
    let written = 0;
    for (let i = 0; i < n; i++) written += batches.draw(compiled, randomPose(i + 1));
    batches.end();
    return { batches, written };
  }

  it('draws each limb as a frustum and two balls, each shape in its own batch', () => {
    const { batches, written } = crowd(1);
    const limbs = humanoid.pieces.filter((piece) => piece.shape === 'limb').length;
    expect(written).toBe(humanoid.pieces.length + 2 * limbs);
    expect([...batches.batches.keys()].filter((key) => !key.startsWith('limb@')).sort()).toEqual(['ball', 'eye']);
    const instances = [...batches.batches.values()].reduce((sum, batch) => sum + batch.count, 0);
    expect(instances).toBe(written);
  });

  it('puts each instance where FK puts its piece: the eyes on their sockets, limbs at their joints', () => {
    const pose = randomPose(1);
    const { batches } = crowd(1);
    const world = forwardKinematics(humanoid.skeleton, pose);
    const m = new Matrix4();
    const eyes = batches.batches.get('eye')!;
    for (const [slot, socket] of [
      [0, 'eyeL'],
      [1, 'eyeR'],
    ] as const) {
      const at = new Vector3().setFromMatrixPosition(eyes.getMatrixAt(slot, m));
      expect(at.distanceTo(socketPosition(humanoid.skeleton, world, socket)), socket).toBeLessThan(1e-5);
    }
    // The first limb's frustum (the hips' bar, thighL to thighR) starts at the left hip and ends at the right.
    const bar = humanoid.pieces[0];
    const frustum = [...batches.batches.entries()].find(([key]) => key.startsWith('limb@'))![1];
    frustum.getMatrixAt(0, m);
    const [start, end] = [new Vector3(0, 0, 0), new Vector3(0, 1, 0)].map((p) => p.applyMatrix4(m));
    const ends = [jointPosition(world, 'thighL'), jointPosition(world, 'thighR')];
    expect(bar.part).toBe('parts[0]');
    expect(start.distanceTo(ends[0]) + end.distanceTo(ends[1])).toBeLessThan(1e-5);
  });

  it('colours each instance by its slot', () => {
    const { batches } = crowd(1);
    const eyes = batches.batches.get('eye')!;
    const colors = eyes.pages[0].instanceColor!.array;
    expect(Array.from(colors.slice(0, 3))).toEqual(humanoid.colors.eye.map(Math.fround));
  });

  it('costs a draw call per shown page, whatever the crowd: 100 humanoids only fill more pages', () => {
    const one = crowd(1).batches;
    const hundred = crowd(100).batches;
    expect([...hundred.batches.keys()]).toEqual([...one.batches.keys()]);
    expect(one.drawCalls()).toBe(one.batches.size);
    let [calls, shadowed] = [0, 0];
    for (const [key, batch] of hundred.batches) {
      expect(batch.count, key).toBe(100 * one.batches.get(key)!.count);
      const pages = Math.ceil(batch.count / batch.pageSlots);
      calls += pages;
      shadowed += key === 'eye' ? pages : 2 * pages;
    }
    expect([hundred.drawCalls(), hundred.drawCalls(1)]).toEqual([calls, shadowed]);
    const instances = [...hundred.batches.values()].reduce((sum, batch) => sum + batch.count, 0);
    expect([instances, calls], '100 humanoids: thousands of instances in under 10 draw calls').toEqual([6200, 9]);
  });

  it('draws every part type of the fixture body, and registers every page with the warm-up', () => {
    const { batches, written } = crowd(3, everyPart);
    expect(written).toBeGreaterThan(3 * everyPart.pieces.length);
    expect([...batches.batches.keys()].filter((key) => !key.startsWith('limb@')).sort()).toEqual([
      'ball',
      'blade',
      'box',
      'cone',
      'eye',
      'strip',
    ]);
    let objects: readonly unknown[] = [];
    batches.register({ register: (_id, entry) => ((objects = entry.objects()), { dispose() {} }) });
    expect(objects).toEqual([...batches.batches.values()].flatMap((batch) => batch.pages));
    batches.dispose();
    expect(batches.root.children).toHaveLength(0);
  });
});
