/**
 * @file Unit tests for engine/gfx/sceneDump.ts (T1, PLAN.md §8.3's `scene.dump`, WP 2.7): one line per object with
 * its name or type and id, type, hidden flag, position, size, material, triangles, instances and entity, a light's
 * intensity and whether it casts (WP 13.23); `depth` cuts
 * the tree and counts what it cut; `filter` keeps matches with their ancestors; the dump never changes the tree.
 * @see engine/gfx/sceneDump.ts
 */
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, PointLight, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { dumpScene } from './sceneDump';

/** A scene: a named group holding a box (an entity), a hidden instanced mesh and an unnamed group. */
function scene() {
  const root = new Scene();
  root.name = 'stage';
  const group = new Group();
  group.name = 'things';
  group.position.set(1, 0, 2);
  const box = new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicMaterial());
  box.material.userData.material = 'material:crate';
  Object.assign(box, { name: 'crate' });
  box.userData.entity = 7;
  const many = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
  many.name = 'pebbles';
  many.visible = false;
  group.add(box, many, new Group());
  root.add(group);
  return root;
}

describe('dumpScene', () => {
  it("gives a light's intensity, 0 for one put out, and marks one that casts", () => {
    const root = new Group();
    root.name = 'lights';
    const [lamp, out] = [new PointLight('#ffffff', 3.256), new PointLight('#ffffff', 0)];
    Object.assign(lamp, { name: 'lamp' });
    Object.assign(out, { name: 'out', castShadow: true });
    root.add(lamp, out);
    expect(dumpScene(root).split('\n').slice(1)).toEqual(['  lamp PointLight at 0,0,0 lit 3.26', '  out PointLight at 0,0,0 lit 0 shadow']); // prettier-ignore
  });

  it('writes one line per object, indented by depth', () => {
    const root = scene();
    const lines = dumpScene(root).split('\n');
    expect(lines[0]).toBe('stage Scene at 0,0,0 size 2×1×1');
    expect(lines[1]).toBe('  things Group at 1,0,2 size 2×1×1');
    expect(lines[2]).toBe('    crate Mesh at 0,0,0 size 2×1×1 material:crate tris 12 entity 7');
    expect(lines[3]).toMatch(/^ {4}pebbles InstancedMesh hidden at 0,0,0 .*MeshBasicMaterial tris 12 ×3$/);
    expect(lines[4]).toMatch(/^ {4}Group#\d+ Group at 0,0,0$/);
  });

  it('cuts at a depth, counting what it cut, and keeps matches of a filter with their ancestors', () => {
    const root = scene();
    expect(dumpScene(root, { depth: 1 }).split('\n')[1]).toBe('  things Group at 1,0,2 size 2×1×1 (+3 below)');
    expect(dumpScene(root, { filter: 'CRATE' }).split('\n')).toEqual([
      'stage Scene at 0,0,0 size 2×1×1',
      '  things Group at 1,0,2 size 2×1×1',
      '    crate Mesh at 0,0,0 size 2×1×1 material:crate tris 12 entity 7',
    ]);
    expect(dumpScene(root, { filter: 'nothing' })).toBe('stage Scene at 0,0,0 size 2×1×1');
    expect(dumpScene(root)).toBe(dumpScene(root));
  });
});
