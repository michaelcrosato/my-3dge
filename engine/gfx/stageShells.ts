/**
 * @file The stage's outline shells (PLAN.md WP 13.24; docs/PLAYGROUND.md §5.2's cel look): engine/gfx/materials/
 * outline.ts's inverted hulls, wired to the stage (engine/gfx/stage.ts) round its props and its bodies. Every batch
 * of the props (engine/gfx/props.ts, a shell per page sharing its instance matrices, pushed away from each part's
 * centre) and every actor's puppet (a skinned shell bound to its skeleton, pushed along its normals, so the line
 * follows the posed body, first person's hidden pieces hidden in it too) gets its shell as it first appears, at
 * `sync()`, which the stage runs at the end of each draw, so the instances and the pieces match the frame's.
 *
 * A look asks for them (`shells: { width, color }`, engine/gfx/post/looks.ts), which the page's look hands over each
 * frame (engine/app/look.ts): `width` in pixels at 270 lines, scaled in the shader to the picture's lines in whole
 * pixels, so the line keeps its weight in every resolution mode; 0 hides every shell. Showing, hiding, the width and
 * the colour are visibility and uniforms: the shells are registered with the warm-up whatever the look, so switching
 * builds nothing. The ID pass leaves them out (`userData.outline`, engine/gfx/idpass.ts): the shells are the look's,
 * not objects of their own, and a shot's objects are the same in every look.
 *
 * Left out: the crowd's batches (engine/gfx/stageCrowd.ts): a crowd of hundreds would double its draw calls, and the
 * post chain's ink outlines it.
 *
 * Invariants: presentation only; a shell is made once per batch and per puppet, and goes with its puppet's mesh;
 * nothing here reaches the sim.
 *
 * @example
 * // const shells = createStageShells({ props: stage.props, actors: stage.actors });
 * // shells.set({ width: 1, color: '#141018' }); // the cel look's
 * // stage.draw(alpha); shells.sync();
 * @see engine/gfx/stageShells.test.ts
 * @see tests/e2e/playground-looks.spec.ts
 */
import type { Mesh } from 'three/webgpu';
import { shellsOn, type FeatureReport } from './features';
import type { Puppet } from './puppets/draw';
import type { ActorPuppets } from './puppets/actors';
import type { InstancedBatch } from './instancing';
import { createOutline, type OutlineShells } from './materials/outline';
import type { StageProps } from './stageProps';
import type { Warmup } from './warmup';

/** The lines a look's shell width is given at: scaled to the picture's height in whole pixels. */
export const SHELL_LINES = 270;

/** What a look asks of the shells: their width in pixels at 270 lines (0 for none), and their colour, hex. */
export interface ShellLook {
  width: number;
  color: string;
}

/** The stage's shells (see the file comment). */
export interface StageShells {
  /** The width asked for now: 0 while hidden. */
  readonly width: number;
  /** How many shells there are, of the props' pages and of the bodies. */
  count(): { props: number; bodies: number };
  /** Shows the shells as `look` asks, from the next frame. */
  set(look: ShellLook): void;
  /** Gives shells to the batches and puppets that appeared since, and matches every shell to its frame. */
  sync(): void;
  /**
   * Registers every shell, present and future, with `warmup`. With `features` (the renderer's report,
   * engine/gfx/features.ts) where `feature:shells` is off, it makes none from then on, registers none and shows none.
   */
  register(warmup: Pick<Warmup, 'register'>, features?: FeatureReport): { dispose(): void };
  /** Removes the shells and frees their materials. */
  dispose(): void;
}

/** Makes the stage's shells over its props and its actors' puppets (see the file comment). */
export function createStageShells(parts: {
  props: Pick<StageProps, 'meshes'>;
  actors: Pick<ActorPuppets, 'puppets'>;
}): StageShells {
  const objects = createOutline({ mode: 'centre', width: 0, lines: SHELL_LINES });
  const bodies = createOutline({ mode: 'normal', width: 0, lines: SHELL_LINES });
  objects.material.name = 'outline:props';
  bodies.material.name = 'outline:bodies';
  const batches = new Map<InstancedBatch, OutlineShells>();
  const puppets = new Map<Puppet, Mesh>();
  let shown = false;
  let off = false; // feature:shells off: no shell is made

  return {
    get width() {
      return shown ? objects.width : 0;
    },
    count: () => ({
      props: [...batches.values()].reduce((n, each) => n + each.shells.length, 0),
      bodies: puppets.size,
    }),
    set(look) {
      shown = look.width > 0 && !off;
      objects.width = bodies.width = look.width;
      objects.color.set(look.color);
      bodies.color.set(look.color);
    },
    sync() {
      if (off) return;
      for (const batch of parts.props.meshes?.batches() ?? []) {
        if (!batches.has(batch)) batches.set(batch, objects.batch(batch));
      }
      for (const group of batches.values()) {
        group.sync();
        if (!shown) for (const shell of group.shells) shell.visible = false;
      }
      const live = new Set(parts.actors.puppets.values());
      for (const [puppet, shell] of puppets)
        if (!live.has(puppet) || shell.parent !== puppet.mesh) puppets.delete(puppet);
      for (const puppet of live) {
        let shell = puppets.get(puppet);
        if (!shell) puppets.set(puppet, (shell = bodies.shell(puppet.mesh)));
        shell.frustumCulled = false; // the puppet keeps its own bounds; its shell draws with it
        shell.visible = shown;
      }
    },
    register(warmup, features) {
      off = !shellsOn(features);
      if (off) return { dispose: () => undefined };
      const entries = [
        warmup.register('shells:props', { objects: () => [...batches.values()].flatMap((group) => group.shells) }),
        warmup.register('shells:bodies', { objects: () => [...puppets.values()] }),
      ];
      return { dispose: () => entries.forEach((entry) => entry.dispose()) };
    },
    dispose() {
      for (const group of batches.values()) group.dispose();
      for (const shell of puppets.values()) shell.removeFromParent();
      batches.clear();
      puppets.clear();
      objects.dispose();
      bodies.dispose();
    },
  };
}
