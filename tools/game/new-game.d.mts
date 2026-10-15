/**
 * @file The types of tools/game/new-game.mjs, for the TypeScript that imports it (tools/cmd/engine.ts, the tests):
 * the module is plain JavaScript so it runs on any Node before anything is installed, and its comments are the manual.
 * @see tools/game/new-game.mjs
 */
import type { EngineIdentity } from './files.mjs';

/** A package.json, as far as a game's is read and written. */
export interface PackageJson {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** What `createGame` did. */
export interface Created {
  root: string;
  name: string;
  identity: EngineIdentity;
  engineFiles: number;
  starterFiles: number;
  kept: string[];
  initialized: boolean;
}

/** What `updateGame` did. */
export interface Updated {
  root: string;
  from: EngineIdentity;
  to: EngineIdentity;
  added: string[];
  removed: string[];
  replaced: string[];
  kept: string[];
  lockfileFits: boolean;
}

export const TEMPLATES: readonly (readonly [string, string])[];
export function gameName(target: string, name?: string): string;
export function render(text: string, values: Readonly<Record<string, string>>): string;
export function gamePackage(
  engine: PackageJson,
  name: string,
  previous?: PackageJson,
  before?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  },
): PackageJson;
export function gameLockfile<T extends { name: string; packages: Record<string, object> }>(
  engineLock: T,
  name: string,
): T;
export function createGame(options: { target: string; name?: string; source?: string; git?: boolean }): Created;
export function updateGame(options: { target: string; source?: string; force?: boolean }): Updated;
export function main(argv?: string[], out?: (line: string) => void, err?: (line: string) => void): number;
