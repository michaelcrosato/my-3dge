/**
 * @file `node x eye <scene>` (PLAN.md WP 12.3, §5.8): the agent eye in Node, no GPU. It runs a scene headless with its
 * view (engine/app/headless.ts `createHeadless({ view: true })`), steps it (`--steps`, at least one: a scene's bodies
 * join the queries at the first physics step), sets a camera (`--cam <code>`, the scene's own by default) and moves it
 * on by a second of frames (`camera.follow`, `EYE_FRAMES`), as a page's frames would have placed it and run its
 * cutaways, and asks `__engine.eye` (engine/dev/eye.ts) what it sees of the bodies, passing where the view draws
 * nothing: the raster as text, a character a cell, with its legend, and each thing it sees with its cells. The picture
 * prints at `--cols` × `--rows`, 56 × 16 by default (a terminal's characters are about twice as tall as wide, so it
 * reads at the page's 16:9); `eye.txt` beside the report holds it with its legend and `eye.json` the whole answer. A level no module registered is read from the
 * scene's lab or `fixtures/levels/`, as `x sim --map` reads it.
 *
 * Usage: node x eye <scene> [--scene id] [--steps n] [--seed s] [--cam code] [--cols n] [--rows n]. Exit 0 with the
 * picture, 1 when the scene throws, 2 on a usage error (no such scene, a bad camera code, no physics, a bad size).
 *
 * @example
 * // node x eye labs/box/scenes/room-hero --cam cam=topdown
 * // x eye: ok: box:room-hero from cam=topdown: the level 71% and the player (2 cells) in 896 cells
 * @see tools/cmd/eye.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHeadless } from '../../engine/app/headless';
import { EngineError } from '../../engine/core/log';
import type { EyeJson } from '../../engine/dev/eye';
import { loadScene } from '../lib/scenes';
import { targetSlug } from '../lib/report';
import { UsageError, wholeFlag, type Command, type CommandResult } from '../x';
import { levelOf } from './sim';

/** The picture's size by default: 56 × 16 characters, the page's 16:9 in a terminal's tall characters. */
export const EYE_PRINT = { cols: 56, rows: 16 } as const;

/** The frames the camera is moved on by before the eye looks: a second of a page's, so a follow camera has swung out. */
export const EYE_FRAMES = 60;

/** How many things the summary names, most cells first; `eye.json` lists them all. */
export const SUMMARY_THINGS = 6;

/** One thing seen, as the summary names it: the player, the level, or its kind and entity; its share, or its cells. */
export function thingText(thing: EyeJson['visible'][number]): string {
  const name = thing.player ? 'the player' : thing.key === 'level' ? 'the level' : `${thing.kind} #${thing.entity}`;
  return `${name} ${thing.share >= 0.01 ? `${Math.round(thing.share * 100)}%` : `(${thing.cells} cell${thing.cells === 1 ? '' : 's'})`}`; // prettier-ignore
}

/** What the summary says it sees: the first `SUMMARY_THINGS` things (`thingText`), then how many more. */
export function seenText(visible: EyeJson['visible']): string {
  const named = visible.slice(0, SUMMARY_THINGS).map(thingText);
  const more = visible.length - named.length;
  return visible.length ? [...named, ...(more ? [`${more} more (eye.json)`] : [])].join(', ') : 'nothing';
}

export default {
  usage: 'eye <scene> [--scene id] [--steps n] [--seed s] [--cam code] [--cols n] [--rows n]',
  options: {
    scene: { type: 'string' },
    steps: { type: 'string' },
    seed: { type: 'string' },
    cam: { type: 'string' },
    cols: { type: 'string' },
    rows: { type: 'string' },
  },
  maxPositionals: 1,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const [target] = positionals;
    if (!target) throw new UsageError('name a scene module (labs/box/scenes/room-hero) or a scene id');
    const { file, scene } = await loadScene(root, target, values.scene as string | undefined);
    if (!scene.physics) throw new UsageError(`${scene.id} has no physics: the eye casts at bodies (defineScene({ physics: true }))`); // prettier-ignore
    if (scene.level) levelOf(root, file, scene);
    const steps = wholeFlag(values.steps, 'steps', 1, 1);
    const size = { cols: wholeFlag(values.cols, 'cols', EYE_PRINT.cols, 1), rows: wholeFlag(values.rows, 'rows', EYE_PRINT.rows, 1) }; // prettier-ignore
    const engine = (await createHeadless({
      scene,
      seed: wholeFlag(values.seed, 'seed', 1),
      view: true,
    })) as unknown as {
      step(n: number): number;
      camera: { get(): { code: string }; set(code: string): { code: string }; follow(n: number): { code: string } };
      eye(size: object): EyeJson;
    };
    engine.step(steps);
    let eye: EyeJson;
    let code: string;
    try {
      engine.camera.set(String(values.cam ?? engine.camera.get().code));
      code = engine.camera.follow(EYE_FRAMES).code;
      eye = engine.eye(size);
    } catch (error) {
      if (error instanceof EngineError) throw new UsageError(error.message);
      throw error;
    }
    const out = join('out', 'eye', targetSlug(scene.id));
    mkdirSync(join(root, out), { recursive: true });
    const legend = Object.entries(eye.legend).map(([ch, what]) => `${ch} ${what}`);
    writeFileSync(join(root, out, 'eye.txt'), `${[...eye.map, '', ...legend].join('\n')}\n`);
    writeFileSync(join(root, out, 'eye.json'), `${JSON.stringify({ scene: scene.id, camera: code, steps, ...eye }, null, 2)}\n`); // prettier-ignore
    return {
      ok: true,
      target: scene.id,
      summary: `${scene.id} from ${code}: ${seenText(eye.visible)} in ${eye.cols * eye.rows} cells`,
      lines: [...eye.map.slice(0, 16), `legend: ${legend.join(', ') || 'nothing seen'}`],
      metrics: { cells: eye.cols * eye.rows, empty: eye.empty, things: eye.visible.length },
      artifacts: [
        { path: `${out}/eye.txt`, kind: 'text', describes: `what ${code} sees in ${scene.id}, a character a cell, and its legend` }, // prettier-ignore
        { path: `${out}/eye.json`, kind: 'json', describes: 'the eye’s whole answer: the picture, the legend, each thing seen with its cells' }, // prettier-ignore
      ],
      warnings: eye.visible.length ? [] : [{ id: 'EYE_NOTHING', message: `${code} sees no body in ${scene.id}: step it (--steps) or pick another camera (--cam)` }], // prettier-ignore
    };
  },
} satisfies Command;
