/**
 * @file An action's check (PLAN.md WP 8.7): `actionCheck` turns an action's `check` (actions-data.ts `ACTION_FIELDS`)
 * into a state of the animation QA's matrix (stateMatrix.ts `MatrixState`): it plays the action through `Actions` on
 * the animator's build, signals at the check's times and lifts the body as `lift` says. tools/qa/anim.ts plays every
 * action of data/anim/actions/ by it. Split from actions.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * import { defineAction } from './actions-data';
 * import { Animator } from './character';
 * defineAction('action:check-nod', { desc: 'A nod.', beats: [{ name: 'dip', seconds: 0.2 }] });
 * const state = actionCheck('check-nod'); // state.seconds: 0.4, the beat and ACTION.out
 * const tick = state.script(new Animator({ build: 'build:heroic' }));
 * tick(1 / 60).position?.y; // 0: no lift
 * @see engine/anim/actions.test.ts
 */
import { MathUtils, Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { Actions } from './actions';
import { ACTION, getAction, type Action } from './actions-data';
import type { MatrixState } from './stateMatrix';
import { ClipLayer } from './clip/layer';
import type { ClipLibrary } from './clip/library';
import { TICK_EPSILON } from './timeline';

/** The body's height in `check.lift` at `t` seconds: linear between its points, flat beyond them. */
function liftAt(points: readonly (readonly number[])[], t: number): number {
  const i = points.findIndex((p) => p[0] > t);
  if (i <= 0) return (i < 0 ? points.at(-1) : points[0])?.[1] ?? 0;
  const [[t0, y0], [t1, y1]] = [points[i - 1], points[i]];
  return MathUtils.lerp(y0, y1, (t - t0) / Math.max(1e-9, t1 - t0));
}

/**
 * The action's check: a state of the matrix (check.ts) that plays it as `check` says, on the animator's build with a
 * clip layer over `libraries` (its clip beats' sets), signalling at its times and lifting the body by `lift` (times
 * the build's size). `registry` is where it is defined (the shared one).
 */
export function actionCheck(
  action: Action | string,
  options: { libraries?: readonly ClipLibrary[]; registry?: Registry } = {},
): MatrixState {
  const registry = options.registry ?? sharedRegistry;
  const entry = typeof action === 'string' ? getAction(action, registry) : action;
  const { seconds, signals, lift } = entry.check;
  const length = entry.beats.reduce((sum, b) => sum + (b.until === 'next' ? 0 : b.seconds), 0);
  return {
    seconds: seconds || Math.max(0, ...signals.map((s) => s.at)) + length + ACTION.out, // the last signal, then the rest
    script: (animator) => {
      const { dt, build } = animator.body;
      const libraries = options.libraries ?? [];
      const clips = libraries.length ? new ClipLayer({ library: libraries, build, dt }) : undefined;
      if (clips) animator.use('clips', clips);
      const acts = new Actions({ clips, dt, registry }).attach(animator);
      let n = 0;
      return (step) => {
        const [now, end] = [n * step, ++n * step];
        if (now === 0) acts.play(entry);
        for (const s of signals) {
          if (s.at <= now - TICK_EPSILON || s.at > end - TICK_EPSILON) continue;
          if (s.do === 'next' || s.do === 'finish' || s.do === 'stop') acts[s.do]();
          else acts.go(s.do);
        }
        acts.step();
        clips?.step({ groundSpeed: 0 });
        return { ...acts.body, position: new Vector3(0, liftAt(lift, end) * build.size, 0) };
      };
    },
  };
}
