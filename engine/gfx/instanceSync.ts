/**
 * @file The instance sync fix (PLAN.md WP 3.8, I-19; engine/gfx/instancing.ts, whose file comment tells the quirk):
 * r182's `InstanceNode` syncs its buffers' versions in its node update, which runs after the renderer uploads the
 * object's buffers, so a change after a quiet frame shows one render late. `syncBeforeUpload` gives every instance
 * node an `updateBefore` that runs its own `update` once per render, before the upload; importing the module applies
 * it (`INSTANCE_SYNC`). On a release other than r182, or a node class without r182's methods, it changes nothing and
 * says why (instancing.ts then advises `GFX_INSTANCING_UNPINNED`). Split from instancing.ts at its line cap.
 *
 * Invariants: applied once (a second import or call changes nothing); only the pinned release is patched.
 *
 * @example
 * INSTANCE_SYNC; // { patched: true, problems: [] } on r182
 * syncBeforeUpload(undefined, '185').patched; // false: another release
 * @see engine/gfx/instancing.test.ts
 */
import { InstanceNode, REVISION } from 'three/webgpu';
import { NodeUpdateType } from 'three/tsl';
import { PINNED_REVISION } from './pipelines';

/** The part of r182's `InstanceNode` the sync fix wraps. */
interface InstanceNodeShape {
  update(frame: unknown): void;
  updateBefore(frame: unknown): void;
  getUpdateBeforeType(): string;
  [SYNCED]?: true;
}

/** Marks an `InstanceNode` prototype as wrapped, so a second import or call changes nothing. */
const SYNCED = Symbol('my3dge.instanceSync');

/**
 * Makes r182's `InstanceNode` sync its buffers' versions before the renderer uploads them (see the file comment):
 * every instance node gets an `updateBefore` that runs its own `update` once per render. Returns whether it did,
 * and if not why: another release, or a node class without the methods r182's has.
 */
export function syncBeforeUpload(
  node: { prototype: object } | undefined = InstanceNode,
  revision: string = REVISION,
): { patched: boolean; problems: string[] } {
  const proto = node?.prototype as InstanceNodeShape | undefined;
  const problems: string[] = [];
  if (revision !== PINNED_REVISION)
    problems.push(`three.js is r${revision}, the fix wraps r${PINNED_REVISION}'s InstanceNode`);
  if (typeof proto?.update !== 'function' || typeof proto.getUpdateBeforeType !== 'function') {
    problems.push('InstanceNode has no update() and getUpdateBeforeType() to wrap');
  }
  if (problems.length || !proto) return { patched: false, problems };
  if (proto[SYNCED]) return { patched: true, problems };
  proto.getUpdateBeforeType = () => NodeUpdateType.RENDER;
  proto.updateBefore = function (this: InstanceNodeShape, frame: unknown) {
    this.update(frame);
  };
  proto[SYNCED] = true;
  return { patched: true, problems };
}

/** What importing this module did to r182's `InstanceNode` (see `syncBeforeUpload`): `patched` is true on r182. */
export const INSTANCE_SYNC = syncBeforeUpload();
