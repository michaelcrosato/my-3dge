/**
 * @file Node material copies (PLAN.md WP 13.12, WP 10.5): `nodeCopy(material)` is a node material drawn as `material`
 * is, with an id of its own, for a mesh that draws its materials its own way through the style set's
 * `userData.restyle` (engine/gfx/materials/styles.ts): first person's viewmodel (engine/gfx/viewmodel/material.ts)
 * and the terrain's splat (engine/gfx/terrainSplat.ts) set their own nodes on the copy. Split from the viewmodel's
 * material when the terrain came to need it.
 *
 * Measured on r182 (WP 13.12): `NodeMaterial.copy`, and so `clone`, keeps the node properties alone (a cloned
 * standard material lost its roughness), so a copy takes every property of its source, as three.js's
 * `NodeLibrary.fromMaterial` turns a classic material into its node material.
 *
 * Invariants: the source is never changed; the copy keeps its own uuid and a deep copy of the source's `userData`
 * (the style set re-points it by its entry); null when three.js has no node material for the source's type.
 *
 * @example
 * import { MeshLambertMaterial } from 'three/webgpu';
 * const lit = new MeshLambertMaterial({ color: '#336699' });
 * const copy = nodeCopy(lit)!;
 * [copy.type, copy.isNodeMaterial, copy.color.getHexString(), copy === lit]; // ['MeshLambertMaterial', true, '336699', false]
 * @see engine/gfx/viewmodel/material.test.ts
 */
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  type Material,
  type NodeMaterial,
} from 'three/webgpu';

/** The node material three.js draws each classic material type as (its standard library's). */
const NODE_CLASSES: Readonly<Record<string, new () => NodeMaterial>> = {
  MeshLambertMaterial: MeshLambertNodeMaterial,
  MeshBasicMaterial: MeshBasicNodeMaterial,
  MeshStandardMaterial: MeshStandardNodeMaterial,
  MeshPhongMaterial: MeshPhongNodeMaterial,
  MeshToonMaterial: MeshToonNodeMaterial,
};

/** What a copy keeps of its own: its identity, its version and its `userData` (a deep copy of the source's). */
const OWN = new Set(['uuid', 'version', 'userData']);

/** A node material drawn as `material` is, with an id of its own (null when three.js has none for it). */
export function nodeCopy(material: Material): NodeMaterial | null {
  const node = (material as NodeMaterial).isNodeMaterial === true;
  const Class = node ? null : NODE_CLASSES[material.type];
  if (!node && !Class) return null;
  const fresh = material.clone() as unknown as Record<string, unknown>; // an id, a uuid and userData of its own
  const copy = (Class ? new Class() : fresh) as unknown as Record<string, unknown>;
  const source = material as unknown as Record<string, unknown>;
  for (const key in source) if (!OWN.has(key) && !key.startsWith('_')) copy[key] = source[key];
  [copy.uuid, copy.userData] = [fresh.uuid, fresh.userData];
  return copy as unknown as NodeMaterial;
}
