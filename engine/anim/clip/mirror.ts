/**
 * @file Mirroring a clip (PLAN.md §10.2, WP 8.2): the same motion on the other side. L and R swap, turns and tilts
 * change sign, sideways numbers flip, and the clip is renamed `<clip>_Mirror`. Ported from
 * `my-3d2dge:src/mocap/readable.js`'s `mirror` with no change in behaviour, and extended to format 2's fields.
 *
 * Limb directions, feet, shoulders, hands, foot rolls and grips are written per side in the figure's own terms (out
 * + = away from the body on that side), so they swap unchanged; a limb's twist changes sign. The hips, root and blade
 * flip their right; body, chest, head and the spine override flip turn and tilt; root yaw flips; events, contacts and
 * props swap their sides.
 *
 * Invariants: the result is a new clip; the input is not changed. Mirroring twice gives back the original numbers
 * (a missing bend or twist becomes 0, and a zero twist −0, as in the source), so it decodes within 0.5 mm of it.
 *
 * @example
 * import { busy } from '../../../tests/unit/anim/clip-fixtures';
 * const punch = { clip: 'Punch_R', dur: 0, keys: [busy(0)] };
 * const left = mirrorClip(punch); // 'Punch_R_Mirror': the same motion, led by the left arm
 * left.keys[0].armL; // [100, -10, 20, 15, 45]: the right arm's, its twist negated
 * @see engine/anim/clip/mirror.test.ts
 */
import type { Clip, ClipContact, ClipEvent, ClipKey, LimbPose, Triple } from './readable';

type Side = 'L' | 'R';
const OTHER = { L: 'R', R: 'L' } as const;

/** One key on the other side. */
function mirrorKey(k: ClipKey): ClipKey {
  const neg = (v: Triple): Triple => [-v[0], v[1], -v[2]];
  const m: Record<string, unknown> = {
    t: k.t,
    hips: [k.hips[0], -k.hips[1], k.hips[2]],
    body: neg(k.body),
    chest: neg(k.chest),
    head: neg(k.head),
  };
  if (k.root) m.root = [k.root[0], -k.root[1]];
  for (const [a, b] of [
    ['L', 'R'],
    ['R', 'L'],
  ] as const) {
    for (const limb of ['arm', 'leg'] as const) {
      const v = k[`${limb}${b}`];
      m[`${limb}${a}`] = [v[0], v[1], v[2], v[3] || 0, -(v[4] || 0)] satisfies LimbPose;
    }
    for (const f of ['foot', 'sh', 'hand'] as const) {
      const v = k[`${f}${b}`];
      if (v) m[`${f}${a}`] = v.slice();
    }
    for (const f of ['roll', 'grip'] as const) if (k[`${f}${b}`] !== undefined) m[`${f}${a}`] = k[`${f}${b}`];
  }
  if (k.blade) m.blade = [k.blade[0], -k.blade[1], k.blade[2]];
  if (k.spine) m.spine = neg(k.spine);
  if (k.yaw !== undefined) m.yaw = -k.yaw;
  return m as unknown as ClipKey;
}

/** `<prop>:<hands>` with its hands swapped: `sword:R` → `sword:L`; `box:LR` stays. */
const mirrorProp = (prop: string) => prop.replace(/:(L|R)$/, (_whole, side: Side) => `:${OTHER[side]}`);
const mirrorEvent = (e: ClipEvent): ClipEvent => (e.side ? { ...e, side: OTHER[e.side] } : { ...e });
const mirrorContact = (c: ClipContact): ClipContact => ({
  ...c,
  part: `${c.part.slice(0, 4) as 'foot' | 'hand'}${OTHER[c.part.slice(4) as Side]}`,
});

/** The same clip on the other side, named `<clip>_Mirror` (see the file comment). */
export function mirrorClip(clip: Clip): Clip {
  const out: Clip = { ...clip, clip: `${clip.clip || 'clip'}_Mirror`, keys: clip.keys.map(mirrorKey) };
  if (clip.events) out.events = clip.events.map(mirrorEvent);
  if (clip.contacts) out.contacts = clip.contacts.map(mirrorContact);
  if (clip.props) out.props = clip.props.map(mirrorProp);
  return out;
}
