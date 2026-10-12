/**
 * @file The page's look (PLAN.md WP 7.8, §6.7, ADR-0008 amendment 9): what `createEngine` (engine/app/engine.ts) does
 * before every warm-up, frame and shot, so the look the view setting `post.look` names (engine/gfx/post/looks.ts)
 * reaches the whole picture and not only the post chain's filters (engine/gfx/post/chain.ts):
 * - **its sky:** the stage's lights show the look's sky, or the stage's own for `''` (engine/gfx/stageSky.ts), with the
 *   quality tier's shadow budget (engine/gfx/quality.ts);
 * - **its material style:** the page's style set (engine/gfx/materials/styles.ts), which the chain switches, joins the
 *   warm-up the first time a look asks for a style other than the set's own, so every warm-up from then on compiles
 *   the drawn meshes in every style; and while it is joined, meshes shown since the last frame (a crowd entering, a
 *   stand-in) are re-pointed to the style drawn now.
 *
 * Why the style set joins the warm-up on demand: compiling every style multiplies the pipelines a warm-up builds by
 * the styles (four), which every page would pay at start and at every later warm-up, though most never leave the
 * scene's own style. Joining adds the set's warm-up entries and key part, which changes the shader key, so the
 * renderer warms up again before the first frame in the new style, never stalling one; from then on, switching styles
 * re-points materials already compiled and builds nothing. A page opened with a styled look (`?post.look=…`) joins
 * before its first warm-up.
 *
 * Invariants: presentation only: it reads view settings and writes the stage's lights and materials, never the sim;
 * everything it changes before a frame either builds nothing or changes the warm-up's key, so the renderer warms up
 * first (engine/gfx/warmup.ts); the style set joins the warm-up once and stays.
 *
 * @example
 * // const look = createPageLook({ post, styles, warmup: gfx.warmup, quality: () => qualityBudget('auto', false) });
 * // gfx.frame(post.view(look.sync(stage, frameView))); // before each frame, warm-up and shot
 * @see tests/e2e/box-look.spec.ts
 */
import type { StyleSet } from '../gfx/materials/styles';
import type { Post } from '../gfx/post/chain';
import type { QualityBudget } from '../gfx/quality';
import type { FrameView } from '../gfx/renderer';
import type { Stage } from '../gfx/stage';
import type { Warmup } from '../gfx/warmup';

/** What a page's look works with. */
export interface PageLookOptions {
  /** The chain whose look (`post.look`) it follows. */
  post: Pick<Post, 'look'>;
  /** The style set the chain switches. */
  styles: Pick<StyleSet, 'style' | 'attach' | 'apply'>;
  /** The warm-up the style set joins. */
  warmup: Warmup;
  /** The quality tier's budget now. */
  quality: () => Pick<QualityBudget, 'shadowCasters'>;
}

/** A page's look (see the file comment). */
export interface PageLook {
  /** Whether the style set has joined the warm-up. */
  readonly styled: boolean;
  /** Brings `stage` to the look before `view` is drawn, warmed up or shot; returns `view`. */
  sync<V extends FrameView | { scene: FrameView['scene'] }>(stage: Pick<Stage, 'scene' | 'sky'>, view: V): V;
}

/** Makes a page's look (see the file comment). */
export function createPageLook(options: PageLookOptions): PageLook {
  const { post, styles, warmup } = options;
  const own = styles.style;
  let joined: { dispose(): void } | null = null;
  return {
    get styled() {
      return joined !== null;
    },
    sync(stage, view) {
      const look = post.look;
      stage.sky.show(look.sky);
      stage.sky.budget(options.quality());
      if (!joined && look.style && look.style !== own) joined = styles.attach(warmup, stage.scene);
      if (joined) styles.apply(stage.scene);
      return view;
    },
  };
}
