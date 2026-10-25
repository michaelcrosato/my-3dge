/**
 * @file The library's hand contacts played on every humanoid (WP 8.8's review; engine/anim/clip/retarget.ts): at each
 * edge of a hand's IK (each 60 Hz step where its weight, `handWeight`, leaves 0 or reaches 1), on every build the anim
 * QA drives (tools/qa/anim.ts `HUMANOIDS`), a hand moves no more in the step than the same pose without hand IK moves
 * it, plus `SLACK`. Without the fade, a build whose copied hand stands elsewhere than the source's jumped there
 * in one step: more than 50 mm on about 50 clips a build, up to 410 mm.
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bakeClip, type BakedClip } from '../../../../engine/anim/clip/bake';
import { handWeight, retargetPose } from '../../../../engine/anim/clip/retarget';
import { createWorldPose, jointPosition } from '../../../../engine/anim/fk';
import { Pose } from '../../../../engine/anim/pose';
import { createSkeleton, type Skeleton } from '../../../../engine/anim/skeleton';
import { Vector3 } from '../../../../engine/core/math';
import { readSet } from '../../../../tools/anim/repack';
import { HUMANOIDS } from '../../../../tools/qa/anim';

/**
 * How much more (m) than the pose without hand IK a hand may move in a step at an edge: the IK follows the source's
 * hand, the copy the build's, and the lift follows whichever hand sinks lowest, so they part by a few millimetres a
 * step (15 at most, measured: CMU's `Get_Up_Face_Down` on build:heroic, its other hand fading in).
 */
const SLACK = 0.02;
const STEP = 1 / 60;
const SETS = readdirSync(new URL('../../../../data/anim/sets/', import.meta.url)).sort();
const world = createWorldPose();

/** Where hand `part` is at `t` s on `skeleton`, with the clip's contacts or with none. */
function hand(baked: BakedClip, t: number, skeleton: Skeleton, part: 'handL' | 'handR', ik: boolean): Vector3 {
  retargetPose(baked, t, skeleton, new Pose(), ik ? { world } : { world, contacts: [] });
  return jointPosition(world, part, new Vector3());
}

describe("the library's hand contacts on every humanoid", () => {
  const clips = SETS.flatMap((dir) => {
    const set = readSet(dir);
    return Object.entries(set.clips)
      .filter(([, clip]) => (clip.contacts ?? []).some((c) => c.part.startsWith('hand')))
      .map(([name, clip]) => ({ id: `${dir}/${name}`, clip, rest: set.sources![clip.src!].rest }));
  });

  it('are there to test: the climbs, the crawls, the falls and the get-ups', () => {
    expect(clips.length).toBeGreaterThan(30);
    expect(clips.map((c) => c.id)).toEqual(
      expect.arrayContaining(['mesh2motion/Climb Ladder', 'mesh2motion/Ledge Hang']),
    );
  });

  it.each(HUMANOIDS.map((h) => h.build))('never jump at an edge of a contact or its fade on %s', (build) => {
    const skeleton = createSkeleton(build);
    const worst: [number, string][] = [];
    for (const { id, clip, rest } of clips) {
      const baked = bakeClip(clip, rest, id);
      for (const part of ['handL', 'handR'] as const) {
        const weight = (t: number) => handWeight(baked.contacts, part, t, baked.duration, baked.loop);
        for (let k = 0; (k + 1) * STEP <= clip.dur; k++) {
          const [a, b] = [k * STEP, (k + 1) * STEP];
          const [wa, wb] = [weight(a), weight(b)];
          if ((wa === 0) === (wb === 0) && (wa === 1) === (wb === 1)) continue; // not an edge: off, on, or easing
          const moved = hand(baked, a, skeleton, part, true).distanceTo(hand(baked, b, skeleton, part, true));
          const copied = hand(baked, a, skeleton, part, false).distanceTo(hand(baked, b, skeleton, part, false));
          if (moved > copied + SLACK) worst.push([Math.round((moved - copied) * 1000), `${id} ${part} at ${a.toFixed(3)} s`]); // prettier-ignore
        }
      }
    }
    expect(worst, 'mm more than the copy moves, at an edge').toEqual([]);
  });
});
