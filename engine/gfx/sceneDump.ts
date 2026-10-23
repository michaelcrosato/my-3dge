/**
 * @file The scene as text (PLAN.md §8.3's `scene.dump`; doctrines: Agent-operable, Verifiable): `dumpScene(root,
 * { depth, filter })` writes a three.js object tree one object a line, indented by depth, so an agent reads what a
 * page draws without seeing it, in Node as in a page (the stage needs no GPU, engine/gfx/stage.ts). Each line gives
 * the name (or `<type>#<id>` for an unnamed object), the type, `hidden` when it is invisible, `at x,y,z` (its local
 * position, m), `size w×h×d` (its world bounds, m, for an object with geometry below it), the material (its library
 * id, `userData.material`, else its type; one per group for a multi-material mesh), the triangles one draw takes,
 * and `×n` instances for an instanced mesh. `lit n` gives a light's intensity (0 for one put out: a pool's slot with no
 * source, a lamp's switch off, WP 13.23). `shadow` marks a light that casts shadows (`shadow ×3 cascades` when it
 * casts through cascades, engine/gfx/enhanced/csm.ts: the cascades made, 0 before their first build); `entity n`
 * names the sim entity an object stands for.
 *
 * `filter` keeps the objects whose name or type contains it (any case), with their ancestors for context; `depth`
 * cuts the tree below that depth (the root is depth 0). A cut or filtered subtree is counted on its parent's line.
 *
 * Invariants: read-only: it never changes the tree (bounds come from `Box3.setFromObject` on world matrices it
 * updates first); numbers are rounded to 0.01 m; the same tree gives the same text.
 *
 * @example
 * // dumpScene(stage.scene, { depth: 2 })
 * // stage:room Scene
 * //   light:sky HemisphereLight at 0,1,0 lit 1.6
 * //   level:room Group at 0,0,0 size 16×3.5×12
 * //     level:room/floor Mesh at 0,0,0 size 14×0×10 material:flagstone tris 280
 * @see engine/gfx/sceneDump.test.ts
 */
import {
  Box3,
  type BufferGeometry,
  type InstancedMesh,
  type Light,
  type Material,
  type Mesh,
  type Object3D,
} from 'three/webgpu';

/** What `dumpScene` writes. */
export interface DumpOptions {
  /** The deepest level written (the root is 0); every level by default. */
  depth?: number;
  /** Keep only objects whose name or type contains this (any case), with their ancestors. */
  filter?: string;
}

/** A number rounded to 0.01, without trailing zeros or `-0`. */
const num = (value: number) => String(Math.round(value * 100) / 100 + 0);

/** The triangles one draw of `geometry` takes. */
function triangles(geometry: BufferGeometry): number {
  const count = geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0);
  const drawn = Number.isFinite(geometry.drawRange.count) ? Math.min(count, geometry.drawRange.count) : count;
  return Math.floor(drawn / 3);
}

/** A material's name in a dump: its library id, else its type. */
const materialName = (material: Material) =>
  typeof material.userData.material === 'string' ? material.userData.material : material.type;

/** One object's line, without its indent. */
function line(object: Object3D, hidden: number): string {
  const mesh = object as Mesh & Partial<InstancedMesh>;
  const type = mesh.isInstancedMesh ? 'InstancedMesh' : object.type; // three.js types an InstancedMesh 'Mesh'
  const parts = [object.name || `${type}#${object.id}`, type];
  if (!object.visible) parts.push('hidden');
  const { x, y, z } = object.position;
  parts.push(`at ${num(x)},${num(y)},${num(z)}`);
  let drawn = false;
  object.traverse((node) => void (drawn ||= (node as Mesh).geometry !== undefined));
  if (drawn) {
    const box = new Box3().setFromObject(object, true);
    if (!box.isEmpty()) {
      const size = box.getSize(box.min.clone());
      parts.push(`size ${num(size.x)}×${num(size.y)}×${num(size.z)}`);
    }
  }
  if (mesh.material) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    parts.push(materials.map(materialName).join('+'));
  }
  if (mesh.geometry) parts.push(`tris ${triangles(mesh.geometry)}`);
  if (mesh.isInstancedMesh) parts.push(`×${mesh.count}`);
  const light = object as Light;
  if (light.isLight) parts.push(`lit ${num(light.intensity)}`);
  if (light.isLight && light.castShadow) {
    const node = light.shadow?.shadowNode as { cascades?: unknown; lights?: unknown[] } | undefined;
    parts.push(typeof node?.cascades === 'number' ? `shadow ×${node.lights?.length ?? 0} cascades` : 'shadow');
  }
  if (typeof object.userData.entity === 'number') parts.push(`entity ${object.userData.entity}`);
  if (hidden) parts.push(`(+${hidden} below)`);
  return parts.join(' ');
}

/** Counts `object`'s descendants. */
function descendants(object: Object3D): number {
  let n = -1;
  object.traverse(() => void n++);
  return n;
}

/** The tree under `root` as text, one object a line (see the file comment). */
export function dumpScene(root: Object3D, options: DumpOptions = {}): string {
  root.updateMatrixWorld(true);
  const depth = options.depth ?? Infinity;
  const wanted = options.filter?.toLowerCase();
  const matches = (object: Object3D) =>
    !wanted || object.name.toLowerCase().includes(wanted) || object.type.toLowerCase().includes(wanted);
  const keep = new Set<Object3D>([root]);
  root.traverse((object) => {
    if (!matches(object)) return;
    for (let node: Object3D | null = object; node && !keep.has(node); node = node.parent) keep.add(node);
  });
  const lines: string[] = [];
  const walk = (object: Object3D, level: number) => {
    const shown = level < depth ? object.children.filter((child) => keep.has(child)) : [];
    const hidden = object.children.reduce(
      (sum, child) => sum + (shown.includes(child) ? 0 : keep.has(child) ? 1 + descendants(child) : 0),
      0,
    );
    lines.push(`${'  '.repeat(level)}${line(object, hidden)}`);
    for (const child of shown) walk(child, level + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}
