/**
 * @file The MCP bridge's headless backend (PLAN.md §8.11, WP 7.6): `createHeadless` in this process, with the scene's
 * view (engine/app/headless.ts `view: true`, no GPU), so `scene.dump` and `camera` answer, and no renderer, so no shot
 * (`renders: false`). `x mcp --headless` serves it: a scene opens in seconds where a page warms its pipelines for
 * minutes on this container's SwiftShader, which suits a sim-only playtest; and T1 drives the tools through it.
 *
 * A page opens as its scene: `labs/<lab>` with `params.scene` names a scene of `labs/<lab>/scenes/` by its id or the
 * name after its colon (`room`: `box:room`); a scene id (`box:room`) or a scene module (`labs/box/scenes/room.ts`)
 * opens as `x sim` opens it (tools/lib/scenes.ts, the animation library first). The other parameters are read as the
 * page's routes read them (engine/app/routes.ts `parseRoutes`: `seed`, `cam` or `cam3`, settings by path, each
 * checked, an unknown key naming the closest); `replay` is a page's real-time playback, here engine_replay's. What a
 * lab's page imports beside its scenes for the view to draw with, its `bodies/` and `looks/` modules, is imported
 * too, and a level no module registered is read from its lab's files, as `x sim --map` reads it (tools/cmd/sim.ts
 * `levelOf`).
 *
 * Invariants: one run at a time, replaced by each open; members are called as the inspector holds them (dotted names
 * on its namespaces, value members read), their results copied through JSON as a page's are. A replay plays in a run
 * of its own scene (`forReplay` opens one when another is open, since a view draws one scene: `APP_OTHER_SCENE`).
 *
 * @example
 * sceneTarget(process.cwd(), 'labs/box', { scene: 'room' }); // { target: 'labs/box/scenes/room.ts', id: 'box:room' }
 * // const backend = headlessBackend(process.cwd());
 * // await backend.open('labs/box', { scene: 'room' }, () => {}); // { page: 'box:room', ready: true, … }
 * @see tools/mcp/server.test.ts
 */
import { createHeadless, type Headless } from '../../engine/app/headless';
import { parseRoutes } from '../../engine/app/routes';
import { registry } from '../../engine/core/registry';
import type { Member } from '../../engine/dev/members';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { levelOf } from '../cmd/sim';
import { walk } from '../lib/docs';
import { loadScene, sceneModules } from '../lib/scenes';
import type { Backend, OpenArgs, Params } from './backend';

/** The scene module and id a page names (see the file comment). */
export function sceneTarget(root: string, page: string, params: Params): { target: string; id?: string } {
  const lab = /^labs\/([\w-]+)\/?(?:index\.html)?$/.exec(page.replace(/^\.?\//, ''))?.[1];
  const scene = params.scene === undefined ? undefined : String(params.scene);
  if (!lab)
    return { target: page, id: scene?.includes(':') ? scene : /^[\w-]+:[\w:-]+$/.test(page) ? page : undefined };
  const own = [...sceneModules(root)].filter(([, file]) => file.startsWith(`labs/${lab}/scenes/`));
  const found = own.find(([id]) => id === scene || id.slice(id.indexOf(':') + 1) === scene);
  if (!found) {
    const names = own.map(([id]) => id.slice(id.indexOf(':') + 1)).sort();
    const asked = scene === undefined ? 'names no scene' : `has no scene ${scene}`;
    throw new Error(`MCP_NO_SCENE: labs/${lab} ${asked} headless: give params.scene, one of ${names.join(', ') || 'none'}`); // prettier-ignore
  }
  return { target: found[1], id: found[0] };
}

/** Calls (or reads) member `name` on `engine` with `args`, its value copied through JSON. */
export async function invoke(engine: Headless, name: string, args: readonly unknown[]): Promise<unknown> {
  const member = registry.get('inspectorMember', name) as Member; // CORE_NO_ENTRY names the closest
  const path = name.split('.');
  const leaf = path.pop() as string;
  let holder = engine as Record<string, unknown>;
  for (const part of path) holder = holder[part] as Record<string, unknown>;
  const value = member.value ? holder[leaf] : await (holder[leaf] as (...a: unknown[]) => unknown)(...args);
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

/** Imports what a scene module's lab page imports beside its scenes: `labs/<lab>/{bodies,looks}/`, tests aside. */
async function loadLabData(root: string, file: string): Promise<void> {
  const lab = /^labs\/([^/]+)\/scenes\//.exec(file)?.[1];
  if (!lab) return;
  const modules = ['bodies', 'looks'].flatMap((dir) => walk(root, `labs/${lab}/${dir}`));
  for (const module of modules.filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))) {
    await import(pathToFileURL(join(root, module)).href);
  }
}

/** The headless backend over the repository at `root` (see the file comment). */
export function headlessBackend(root: string): Backend {
  let engine: Headless | null = null;
  const open = async (page: string, params: Params) => {
    const [path, query = ''] = page.split(/\?(.*)/s, 2);
    const all = { ...Object.fromEntries(new URLSearchParams(query)), ...params };
    const { target, id } = sceneTarget(root, path, all);
    const { file, scene } = await loadScene(root, target, id);
    await loadLabData(root, file);
    if (scene.level && !registry.has('level', scene.level)) levelOf(root, file, scene);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(all)) search.set(key, typeof value === 'string' ? value : JSON.stringify(value)); // prettier-ignore
    const routes = parseRoutes(`?${search}`, { scenes: [scene.id] });
    if (routes.replay !== undefined) {
      throw new Error(`MCP_HEADLESS_REPLAY: ?replay plays in a page's frames; headless, play it with engine_replay({ file: 'tests/replays/${routes.replay}.replay.json' })`); // prettier-ignore
    }
    engine = null;
    engine = await createHeadless({ scene, seed: routes.seed, settings: routes.settings, view: true, ...(routes.cam ? { cam: routes.cam } : {}) }); // prettier-ignore
    return { page: scene.id, ready: true, errors: [], info: (await invoke(engine, 'info', [])) as Record<string, unknown> }; // prettier-ignore
  };
  return {
    kind: 'headless',
    renders: false,
    open,
    resume: async (args: OpenArgs | undefined) => (args ? open(args.page, args.params ?? {}) : null),
    async call(name, args) {
      if (!engine) throw new Error("MCP_NOT_OPEN: no scene is open: call engine_open first ({ page: 'labs/box', params: { scene: 'room' } })"); // prettier-ignore
      return invoke(engine, name, args);
    },
    async forReplay(scene) {
      const showing = engine && ((await invoke(engine, 'info', [])) as { scene: string }).scene;
      if (showing !== scene) await open(scene, { scene });
    },
    notices: () => [],
    close: async () => void (engine = null),
  };
}
