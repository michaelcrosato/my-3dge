/**
 * @file The `help()` drift check (PLAN.md §8.12, §8.3, WP 1.6; doctrine: Agent-operable): `x docs --check` fails when
 * the inspector's `help()` differs from its real API, the members the object actually has.
 *
 * It imports, in this process, engine/app/headless.ts and every module under `engine/` and `labs/` (tests aside)
 * that registers an inspector member (`defineMember(` or `'inspectorMember'` in its text), starts an empty scene
 * headless, and compares the names `help()` lists with the object's own: calls as `name()`, properties as `name`,
 * namespaces walked (`scene.dump()`). A member patched onto the object, one missing from it, or a call listed as a
 * property is a failure naming it; a module that cannot load is one too. Before WP 1.6's modules exist it checks
 * nothing. `help()` and the object are built from one table, so a core member missing from it, extra or renamed is
 * tsc's to catch: engine/dev/inspector.ts types that table against the `Inspector` interface (`CoreMembers`).
 *
 * Invariants: getters are never read (only their descriptors), so walking the API runs no member.
 *
 * @example
 * helpNames('step(n = 1)  Runs steps.\nerrors  The records.'); // ['errors', 'step()']
 * apiOf({ step() {}, scene: { dump() {} } }); // ['scene.dump()', 'step()']
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { walk } from './docs';
import type { Finding } from './report';

/** The module that makes a headless engine; without it there is no inspector to check. */
const HEADLESS = 'engine/app/headless.ts';

/** The object's members, sorted: calls as `name()`, properties as `name`, namespaces walked with dotted names. */
export function apiOf(inspector: object, prefix = ''): string[] {
  const names: string[] = [];
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(inspector))) {
    const name = prefix + key;
    const value: unknown = descriptor.value;
    if (descriptor.get) names.push(name);
    else if (typeof value === 'function') names.push(`${name}()`);
    else if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
      names.push(...apiOf(value, `${name}.`));
    } else names.push(name);
  }
  return names.sort();
}

/** The members a `help()` text lists, sorted: each line's signature, `name()` for a call, `name` for a property. */
export function helpNames(text: string): string[] {
  const names = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = /^([^\s(]+)(\()?/.exec(line);
      return match ? `${match[1]}${match[2] ? '()' : ''}` : line;
    });
  return names.sort();
}

/** Where `help()` and the object part, one sentence each ([] when they agree). */
export function helpDrift(inspector: { help(): string }): string[] {
  const api = apiOf(inspector);
  const listed = helpNames(inspector.help());
  return [
    ...api
      .filter((name) => !listed.includes(name))
      .map((name) => `__engine.${name} exists, but help() does not list it`),
    ...listed
      .filter((name) => !api.includes(name))
      .map((name) => `help() lists ${name}, but __engine has no such member`),
  ];
}

/** The modules under `engine/` and `labs/` (tests aside) that register inspector members, sorted. */
export function memberModules(root: string): string[] {
  return ['engine', 'labs']
    .flatMap((dir) => (existsSync(join(root, dir)) ? walk(root, dir) : []))
    .filter((file) => /\.ts$/.test(file) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(file))
    .filter((file) => /defineMember\(|['"`]inspectorMember['"`]/.test(readFileSync(join(root, file), 'utf8')))
    .sort();
}

/** Loads the member modules, starts an empty scene headless and compares `help()` with the object. */
export async function checkHelp(root: string): Promise<{ failures: Finding[]; members: number }> {
  if (!existsSync(join(root, HEADLESS))) return { failures: [], members: 0 };
  const load = (file: string) => import(pathToFileURL(join(root, file)).href) as Promise<Record<string, unknown>>;
  const failures: Finding[] = [];
  for (const file of memberModules(root)) {
    await load(file).catch((error: unknown) => {
      const why = (error instanceof Error ? error.message : String(error)).split('\n')[0];
      failures.push({ id: 'DOCS_HELP', message: `${file} registers inspector members but did not load: ${why}`, file });
    });
  }
  const { createHeadless } = (await load(HEADLESS)) as typeof import('../../engine/app/headless');
  const { createRegistry } = (await load('engine/core/registry.ts')) as typeof import('../../engine/core/registry');
  const { defineScene } = (await load('engine/sim/scene.ts')) as typeof import('../../engine/sim/scene');
  const scene = defineScene(
    'docs:help',
    { description: 'Nothing: the help() check.', setup: () => {} },
    createRegistry(),
  );
  const engine = await createHeadless({ scene });
  const fix = 'register members with defineMember (engine/dev/members.ts), never add them to the object';
  for (const message of helpDrift(engine)) failures.push({ id: 'DOCS_HELP', message: `${message}: ${fix}` });
  return { failures, members: apiOf(engine).length };
}
