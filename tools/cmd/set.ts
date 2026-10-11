/**
 * @file Checks a setting against the settings schema, prints it as a URL parameter, and applies it to the page `x
 * inspect` keeps open (PLAN.md §8.1, §3's Agent-operable, I-37, WP 2.7): `node x set box.room.speed 3`.
 *
 * Every setting comes from one schema (engine/core/settings.ts), so `x set`, URL parameters and `__engine.set` reach
 * the same settings the same way. In Node it loads every module that declares settings (under engine/, labs/ and
 * fixtures/: the engine's, the box's scenes', the fixtures'), or with `--scene <id|module>` the engine's and that
 * scene's, and types the value as the schema says (`3` → 3, `true`, a JSON list): an unknown path names the closest
 * one, and a value out of range or of the wrong type names the rule. It prints the setting's unit, default and when
 * the change takes effect, the URL that opens the page with it (`labs/box/?scene=room&box.room.speed=3`), and, when
 * an inspect session runs, what `__engine.set` did there (a non-view change is recorded at its step, like an input).
 *
 * Usage: node x set <key> <value> [--scene s]. Exit 0 when the value is valid (and applied, when a session runs), 1
 * when the page refused it, 2 on a usage error (an unknown setting, a bad value, a missing argument).
 *
 * @example
 * // node x set box.room.speed 3 --scene room
 * // node x set gfx.resolution full
 * settingParam('box.room.speed', 3); // 'box.room.speed=3'
 * @see tools/cmd/set.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../../engine/core/log';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { createSettings, type SettingChange, type SettingValue } from '../../engine/core/settings';
import { walk } from '../lib/docs';
import { UsageError, type Command, type CommandResult } from '../x';
import { callSession, findSession, reloadLines } from './inspect';
import { pageUrl } from './shot';
import { resolveSceneModule, sceneModules } from './sim';

/** The module of `scene`: a module path, a scene id, or the name after an id's colon (`room` for `box:room`). */
export function sceneModuleOf(root: string, scene: string): string {
  const named = [...sceneModules(root)].filter(([id]) => id.slice(id.indexOf(':') + 1) === scene);
  return named.length === 1 && !scene.includes(':') ? named[0][1] : resolveSceneModule(root, scene);
}

/** The modules that declare settings (`defineSettings(` in their text), tests aside; with `scene`, only its own. */
export function settingModules(root: string, scene?: string): string[] {
  const own = scene === undefined ? undefined : sceneModuleOf(root, scene);
  return ['engine', 'labs', 'fixtures']
    .flatMap((dir) => (existsSync(join(root, dir)) ? walk(root, dir) : []))
    .filter((file) => file.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(file))
    .filter((file) => own === undefined || file.startsWith('engine/') || file === own)
    .filter((file) => /\bdefineSettings\(/.test(readFileSync(join(root, file), 'utf8')))
    .sort();
}

/** Imports the modules that declare settings, so the shared registry knows them; returns them. */
export async function loadSettings(root: string, scene?: string): Promise<string[]> {
  const files = settingModules(root, scene);
  for (const file of files) await import(pathToFileURL(join(root, file)).href);
  return files;
}

/** A setting as a URL parameter: `path=value`, a string as it is, anything else as JSON. */
export function settingParam(path: string, value: SettingValue): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new URLSearchParams([[path, text]]).toString().replaceAll('%2C', ',');
}

/** Types `text` for the setting `path` on a fresh store; throws `UsageError` naming the closest path or the rule. */
export function checkSetting(path: string, text: string, registry: Registry = sharedRegistry): SettingChange {
  try {
    return createSettings({ registry }).setText(path, text);
  } catch (error) {
    if (error instanceof EngineError) throw new UsageError(error.message);
    throw error;
  }
}

export default {
  usage: 'set <key> <value> [--scene s]',
  options: { scene: { type: 'string' } },
  maxPositionals: 2,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const [path, text] = positionals;
    if (path === undefined || text === undefined) {
      throw new UsageError(
        'name a setting and its value: node x set box.room.speed 3 (node x describe setting lists them)',
      );
    }
    const scene = values.scene as string | undefined;
    await loadSettings(root, scene);
    const change = checkSetting(path, text);
    const entry = sharedRegistry.get('setting', path) as unknown as {
      unit?: string;
      default: SettingValue;
      view?: boolean;
    };
    const param = settingParam(path, change.value);
    const session = findSession(root);
    const name = scene?.includes(':') ? scene.slice(scene.indexOf(':') + 1) : scene;
    const page = session?.page ?? 'labs/box';
    const url = pageUrl(page, { scene: name, set: [param.replace(/%3D/g, '=')] });
    const facts = [entry.unit, `default ${JSON.stringify(entry.default)}`, `takes effect ${change.when}`];
    const lines = [`URL parameter: ?${param}`, `page: ${url}`];
    const failures = [];
    if (!session) lines.push('no inspect session: start one with node x inspect, or open the page above');
    else {
      try {
        const reply = await callSession<{ change: SettingChange; reloaded?: string }>(session, 'set', {
          path,
          value: text,
        });
        lines.unshift(...reloadLines(reply));
        const recorded = reply.change.view ? 'a view setting, never recorded' : 'recorded at this step';
        lines.push(
          `applied in ${session.page}: ${JSON.stringify(reply.change.previous)} → ${JSON.stringify(reply.change.value)} (${recorded})`,
        );
      } catch (error) {
        const message = `${session.page} refused ${path}=${text}: ${error instanceof Error ? error.message : String(error)}`;
        failures.push({ id: 'SET_REFUSED', message });
      }
    }
    return {
      ok: failures.length === 0,
      target: path,
      summary: `${path} = ${JSON.stringify(change.value)} (${facts.filter(Boolean).join('; ')}${entry.view ? '; view only' : ''})`,
      lines,
      failures,
      metrics: { path, value: JSON.stringify(change.value), when: change.when, view: entry.view === true },
    };
  },
} satisfies Command;
