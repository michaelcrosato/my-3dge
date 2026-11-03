/**
 * @file The page's look (PLAN.md WP 7.8, §6.7, ADR-0008 amendment 10): what `createEngine` (engine/app/engine.ts) does
 * before every warm-up, frame and shot, so the look the view setting `post.look` names (engine/gfx/post/looks.ts)
 * reaches the whole picture and not only the post chain's filters (engine/gfx/post/chain.ts):
 * - **its sky:** the stage's lights show the look's sky, or the stage's own for `''` (engine/gfx/stageSky.ts), with the
 *   quality tier's shadow budget (engine/gfx/quality.ts), its dome as the look's gradient asks (`skyGradient`);
 * - **its shells:** the outline shells round the stage's props and bodies, as the look's `shells` ask (WP 13.24,
 *   engine/gfx/stageShells.ts);
 * - **its resolution and textures** (WP 13.30): the mode its `resolution` asks for, drawn while `gfx.resolution` is
 *   `auto` (engine/gfx/resolution.ts `prefer`), and every material's maps filtered as its `textures` ask
 *   (engine/gfx/materials/library.ts `filter`), each changed only when the look's differs from the last;
 * - **its material style:** the page's style set (engine/gfx/materials/styles.ts), which the chain switches, joins the
 *   warm-up the first time a look asks for a style other than the set's own, so every warm-up from then on compiles
 *   the drawn meshes in the set's own style and in each style a look has asked for; and while it is joined, meshes
 *   shown since the last frame (a crowd entering, a stand-in) are re-pointed to the style drawn now.
 *
 * Why the style set joins the warm-up on demand, and only with the styles asked for: compiling a style multiplies
 * the pipelines a warm-up builds, which every page would pay at start and at every later warm-up, though most never
 * leave the scene's own style and a game's looks share one or two (the playground's cel and pixel looks both draw
 * toon: on its site, WP 13.18, the other two styles cost about 130 of its 330 s warm-up on SwiftShader). Joining, or
 * a look asking for a style not yet warmed, adds the set's warm-up entries and key part, which changes the shader key,
 * so the renderer warms up again before the first frame in the new style, never stalling one; from then on, switching
 * between styles asked for re-points materials already compiled and builds nothing. A page opened with a styled look
 * (`?post.look=…`) joins before its first warm-up. With `gfx.warmUp: asked` (`asked`, engine/gfx/warmup.ts) the set
 * joins with the look's style alone, its own too only if the page drew in it first, and adds its own once a look
 * in it is asked for: the playground, opened in its clean look (the set's own style), compiles toon the first time
 * its cel or pixel look is asked for, and a page kept in toon looks never compiles its own.
 *
 * Invariants: presentation only: it reads view settings and writes the stage's lights and materials, never the sim;
 * everything it changes before a frame either builds nothing or changes the warm-up's key, so the renderer warms up
 * first (engine/gfx/warmup.ts); the style set joins the warm-up once and stays.
 *
 * @example
 * // const look = createPageLook({ post, styles, warmup: gfx.warmup, resolution: gfx.resolution, library: styles.library,
 * //   quality: () => qualityBudget('auto', false) });
 * // gfx.frame(post.view(look.sync(stage, frameView))); // before each frame, warm-up and shot
 * @see tests/e2e/box-look.spec.ts
 */
import type { MaterialLibrary } from '../gfx/materials/library';
import type { StyleSet } from '../gfx/materials/styles';
import type { Post } from '../gfx/post/chain';
import type { QualityBudget } from '../gfx/quality';
import type { FrameView } from '../gfx/renderer';
import type { Resolution } from '../gfx/resolution';
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
  /** Whether warm-ups compile only what the page draws (`gfx.warmUp: asked`, engine/gfx/warmup.ts); false if absent. */
  asked?: () => boolean;
  /** The drawing buffer the look's `resolution` is asked of (engine/gfx/resolution.ts); none if absent. */
  resolution?: Pick<Resolution, 'prefer'>;
  /** The material library whose maps the look's `textures` filter (engine/gfx/materials/library.ts); none if absent. */
  library?: Pick<MaterialLibrary, 'filter'>;
}

/** A page's look (see the file comment). */
export interface PageLook {
  /** Whether the style set has joined the warm-up. */
  readonly styled: boolean;
  /** Brings `stage` to the look before `view` is drawn, warmed up or shot; returns `view`. */
  sync<V extends FrameView | { scene: FrameView['scene'] }>(stage: Pick<Stage, 'scene' | 'sky' | 'shells'>, view: V): V;
}

/** Makes a page's look (see the file comment). */
export function createPageLook(options: PageLookOptions): PageLook {
  const { post, styles, warmup } = options;
  const own = styles.style;
  let joined: ReturnType<StyleSet['attach']> | null = null;
  /** Whether a look in the set's own style was drawn before the set joined. */
  let drewOwn = false;
  return {
    get styled() {
      return joined !== null;
    },
    sync(stage, view) {
      const look = post.look;
      stage.sky.show(look.sky);
      stage.sky.budget(options.quality());
      stage.sky.sky?.gradient(look.skyGradient);
      stage.shells.set(look.shells);
      options.resolution?.prefer(look.resolution || null);
      options.library?.filter(look.textures || null);
      const owned = !look.style || look.style === own;
      if (owned && !joined) drewOwn = true;
      if (!owned && !joined?.styles.includes(look.style)) {
        if (joined) joined.add(look.style);
        else joined = styles.attach(warmup, stage.scene, options.asked?.() && !drewOwn ? [look.style] : [own, look.style]); // prettier-ignore
      }
      if (owned && joined && !joined.styles.includes(own)) joined.add(own); // asked: the set's own once a look asks
      if (joined) styles.apply(stage.scene);
      return view;
    },
  };
}
