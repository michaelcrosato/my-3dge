/**
 * @file Scene lookup for the tools (PLAN.md §8.1, WP 1.5): where scene modules live (`sceneRoots`: `fixtures/scenes/`
 * and every `labs/<name>/scenes/`), which module defines which scene id (`sceneModules`, from the modules' text: a
 * `defineScene('<id>', …)` with a literal id, tests aside), the module a target names (`resolveSceneModule`: a `.ts`
 * file, a directory's `index.ts`, or a scene id's module) and the scene it exports (`loadScene`, `--scene <id>` for a
 * module that defines several). `x sim`, `x perf`, `x replay`, `x set` and `x audio` find scenes through it. Split from tools/cmd/sim.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * Invariants: lookups read the files' text, never import them, so finding a scene runs no scene code; `loadScene`
 * imports only the module it names, after the library's clip sets are defined (the sim reads no files). A target that
 * names nothing throws `UsageError` listing the scene ids.
 *
 * @example
 * sceneModules(process.cwd()).get('kernel'); // 'fixtures/scenes/kernel/index.ts'
 * resolveSceneModule(process.cwd(), 'fixtures/scenes/kernel'); // 'fixtures/scenes/kernel/index.ts'
 * @see tools/cmd/sim.test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../../engine/core/log';
import { getScene, isScene, type Scene } from '../../engine/sim/scene';
import { defineLibrary } from '../anim/library';
import { UsageError } from '../x';
import { walk } from './docs';

/** Where scene modules live: `fixtures/scenes/` and every `labs/<name>/scenes/` (tests/pages/replay.ts globs the same). */
export function sceneRoots(root: string): string[] {
  const labs = existsSync(join(root, 'labs')) ? walk(root, 'labs') : [];
  const dirs = new Set(labs.map((file) => /^labs\/[^/]+\/scenes\//.exec(file)?.[0]).filter((dir) => dir !== undefined));
  return ['fixtures/scenes/', ...[...dirs].sort()];
}

/** `defineScene('<id>'` (type arguments allowed), the literal id captured. */
const DEFINES = /\bdefineScene\s*(?:<[^(]*?>)?\s*\(\s*(['"`])([^'"`]+)\1/g;

/** Scene id → the module that defines it, from the modules' text (tests aside). */
export function sceneModules(root: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of sceneRoots(root)) {
    for (const file of walk(root, dir.replace(/\/$/, ''))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      for (const match of readFileSync(join(root, file), 'utf8').matchAll(DEFINES)) found.set(match[2], file);
    }
  }
  return found;
}

/** The module a target names: a `.ts` file (its extension optional), a directory's `index.ts`, or a scene id's module. */
export function resolveSceneModule(root: string, target: string): string {
  const path = resolve(root, target);
  if (existsSync(path) && statSync(path).isDirectory() && existsSync(join(path, 'index.ts'))) {
    return relative(root, join(path, 'index.ts'));
  }
  if (existsSync(path) && path.endsWith('.ts')) return relative(root, path);
  if (existsSync(`${path}.ts`)) return relative(root, `${path}.ts`); // extensionless, as imports name it
  const modules = sceneModules(root);
  const file = modules.get(target);
  if (file) return file;
  const known = [...modules.keys()].sort().join(', ') || 'none';
  throw new UsageError(
    `${target} is neither a scene module (a .ts file or a directory with index.ts) nor a scene id (scenes: ${known})`,
  );
}

/** Imports a scene module and picks its scene: `id`, else the one scene it exports. */
export async function loadScene(root: string, target: string, id?: string): Promise<{ file: string; scene: Scene }> {
  const file = resolveSceneModule(root, target);
  defineLibrary(); // the sim reads no files: clip mode's sets come first, as in the box page
  const module = (await import(pathToFileURL(join(root, file)).href)) as Record<string, unknown>;
  const exported = [...new Set(Object.values(module).filter(isScene))];
  if (id !== undefined) {
    try {
      return { file, scene: getScene(id) };
    } catch (error) {
      if (error instanceof EngineError) throw new UsageError(error.message);
      throw error;
    }
  }
  if (exported.length === 1) return { file, scene: exported[0] };
  const ids = exported.map((scene) => scene.id).join(', ');
  throw new UsageError(
    exported.length
      ? `${file} defines ${ids}: name one with --scene <id>`
      : `${file} exports no scene (export default defineScene(…))`,
  );
}
