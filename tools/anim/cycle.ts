/**
 * @file The loop-cycle search (PLAN.md §5.3, WP 8.5): the best cycle in a stretch of a take, a stride or a hop, the
 * span whose end matches its start in pose and in speed. Ported from `my-3d2dge:tools/asf-amc.mjs:111-134` with its
 * operations kept, for its bits. tools/anim/asf-amc.ts cuts a CMU loop there.
 *
 * How spans are scored: frames i < j, `min` seconds (half a second unless the pick says) to 2.5 s apart, cost = the
 * RMS difference of their poses + a tenth of the difference of their velocities (as mm a frame, times src / 2) + a
 * small premium on length. A span must keep moving: its frames must change at least half as fast as the stretch's
 * typical frame does, since a pause matches itself perfectly. A gait whose feet meet between steps (a robot's, a limp)
 * matches itself after one step: its pick asks for a shorter `min`; a full stride is longer.
 *
 * @example
 * // a point going round a circle once a second, sampled 30 times a second for three seconds
 * const at = (k: number) => new Float64Array([Math.cos((k / 30) * 2 * Math.PI), Math.sin((k / 30) * 2 * Math.PI), 0]);
 * const [from, to] = bestCycle(91, 30, 0, 3, at);
 * Math.round((to - from) * 30); // 30: one turn
 * @see tools/anim/asf-amc.test.ts
 */

/**
 * The best cycle in seconds `from`–`to` of a take of `count` frames at `src` a second: `[start, end, seam]`, in
 * seconds, `seam` the cost that remained. `frameAt(k)` gives frame k as the search compares it (its points seen from
 * its hips, facing forward). Throws when no span of `min` seconds or more keeps moving.
 */
export function bestCycle(
  count: number,
  src: number,
  from: number,
  to: number,
  frameAt: (k: number) => Float64Array,
  min = 0.5,
): [start: number, end: number, seam: number] {
  const [a, b, F] = [Math.round(from * src), Math.min(count - 1, Math.round(to * src)), [] as Float64Array[]];
  for (let k = a; k <= b; k++) F.push(frameAt(k));
  const rms = (x: Float64Array, y: Float64Array, z?: Float64Array, w?: Float64Array) => {
    let e = 0;
    for (let k = 0; k < x.length; k++) {
      const d = z && w ? x[k] - y[k] - (z[k] - w[k]) : x[k] - y[k];
      e += d * d;
    }
    return Math.sqrt(e / x.length);
  };
  // how far the pose travels, frame to frame (summed, so any span's motion is a subtraction)
  const step = F.map((v, k) => (k ? rms(v, F[k - 1]) : 0));
  const sum = [0];
  step.forEach((d, k) => sum.push(sum[k] + d));
  const typical = step.slice(1).sort((x, y) => x - y)[Math.floor((step.length - 1) / 2)] || 0;
  let best: { cost: number; i: number; j: number } | null = null;
  for (let i = 1; i < F.length - 1; i++) {
    for (let j = i + Math.round(src * min); j < Math.min(F.length - 1, i + 2.5 * src); j++) {
      if ((sum[j + 1] - sum[i + 1]) / (j - i) < typical / 2) continue; // too still to be the motion's cycle
      const cost =
        rms(F[i], F[j]) + (0.1 * rms(F[i + 1], F[i - 1], F[j + 1], F[j - 1]) * src) / 2 + (0.002 * (j - i)) / src;
      if (!best || cost < best.cost) best = { cost, i, j };
    }
  }
  if (!best) throw new Error(`no cycle of ${min} s or more between ${from} s and ${to} s: pick a longer stretch`);
  return [(a + best.i) / src, (a + best.j) / src, best.cost];
}
