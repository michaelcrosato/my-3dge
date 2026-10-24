/**
 * @file Screen-space reflections (PLAN.md WP 11.5): r182's `SSRNode` addon for the look's `ssr` section: a ray from
 * each metal pixel, reflected about its normal, marched through the depth buffer, takes the colour where it lands,
 * fading with distance and growing at grazing angles; rougher surfaces read a blurrier level of the result. The scene
 * pass gives it metalness and roughness in its `metalrough` target (engine/gfx/post/mrt.ts, made only while
 * `feature:ssr` is on), and engine/gfx/post/shading.ts mixes the reflection over the scene's light by its alpha. A
 * pixel with no metalness reflects nothing. With `feature:ssr` off, a look's `ssr` draws nothing.
 *
 * r182's node decides when it is built whether its camera is perspective (its incident ray) and never again; the
 * engine's frames go through perspective and orthographic cameras alike (the five camera codes). So there are two
 * passes, one through a perspective lens and one through an orthographic one, each a stand-in whose matrices copy the
 * frame camera's when it is of its kind (`follow`), and only the one of the frame camera's kind runs.
 *
 * Invariants: presentation only, never in the hash; a pass runs only in frames whose look asks for it and whose
 * camera is of its kind (and the warm-up's frame, which builds both).
 *
 * @example
 * // engine/gfx/post/shading.ts, through engine/gfx/features.ts:
 * // const reflections = createReflections({ colour, depth, normal, metalrough }); reflections.follow(camera);
 * SSR.resolution; // 0.5
 * @see engine/gfx/enhanced/ssr.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { OrthographicCamera, PerspectiveCamera, type Camera, type Node, type TextureNode } from 'three/webgpu';
import { mix, renderGroup, uniform } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { defineCodes } from '../../core/log';

/** Its advice code, raised by the feature registry when it is off. */
export const SSR_CODES = defineCodes('gfx', {
  GFX_NO_SSR: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when screen-space reflections are off: a look's `ssr` section draws nothing.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const SSR_FEATURE = {
  id: 'feature:ssr',
  description:
    "Screen-space reflections (three.js's SSRNode) on metal surfaces where a look's ssr section asks; the scene pass writes metalness and roughness for it (engine/gfx/enhanced/ssr.ts).",
  advice: 'GFX_NO_SSR',
  downgrade: 'no screen-space reflections: metal shows only its lights and environment',
} as const;

/** The passes: their resolution (a share of the picture's) and r182's quality knob (0 to 1). */
export const SSR = { resolution: 0.5, quality: 0.5 } as const;

/** What the reflections read of the scene pass: its colour, depth, view normals and (metalness, roughness). */
export interface ReflectionInputs {
  colour: TextureNode;
  depth: TextureNode;
  normal: TextureNode;
  metalrough: TextureNode;
}

/** The reflections (see the file comment). */
export interface Reflections {
  /** The two passes, perspective then orthographic: gate each by `kind`. */
  readonly nodes: readonly [Node, Node];
  /** The kind of camera the last `follow` saw. */
  readonly kind: 'perspective' | 'orthographic';
  /** The reflection at a pixel: rgb, and alpha how much it shows. */
  readonly texture: Node;
  /** Sets how strongly it shows (0 to 1), how far a ray goes (m) and how thick a surface counts (m). */
  set(strength: number, distance: number, thickness: number): void;
  /** Each frame: copies `camera` into the lens of its kind. */
  follow(camera: Camera): void;
  dispose(): void;
}

/** Makes the reflections over the scene pass's `inputs` (see the file comment). */
export function createReflections(inputs: ReflectionInputs): Reflections {
  const lenses = [new PerspectiveCamera(), new OrthographicCamera()] as const;
  const { colour, depth, normal, metalrough } = inputs;
  const passes = lenses.map((lens) => {
    const node = ssr(colour, depth, normal, metalrough.r, metalrough.g, lens);
    node.resolutionScale = SSR.resolution;
    node.quality.value = SSR.quality;
    return node;
  });
  const ortho = uniform(0).setGroup(renderGroup);
  const reflections: Reflections = {
    nodes: [passes[0], passes[1]],
    kind: 'perspective',
    texture: mix(passes[0], passes[1], ortho),
    set(strength, distance, thickness) {
      for (const node of passes) {
        node.opacity.value = strength;
        node.maxDistance.value = distance;
        node.thickness.value = thickness;
      }
    },
    follow(camera) {
      const isOrtho = (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
      const lens = lenses[isOrtho ? 1 : 0];
      lens.projectionMatrix.copy(camera.projectionMatrix);
      lens.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      lens.matrixWorld.copy(camera.matrixWorld);
      lens.matrixWorldInverse.copy(camera.matrixWorldInverse);
      const { near, far } = camera as Camera & { near?: number; far?: number };
      [lens.near, lens.far] = [near ?? lens.near, far ?? lens.far];
      ortho.value = isOrtho ? 1 : 0;
      (reflections as { kind: Reflections['kind'] }).kind = isOrtho ? 'orthographic' : 'perspective';
    },
    dispose: () => passes.forEach((node) => node.dispose()),
  };
  return reflections;
}
