/**
 * @file The types of tools/game/new-game.mjs, for the TypeScript that imports it (tools/cmd/engine.ts, the tests):
 * the module is plain JavaScript so it runs on any Node before anything is installed, and its comments are the manual.
 * @see tools/game/new-game.mjs
 */
import type { EngineIdentity } from './files.mjs';

export { gameLockfile, gamePackage, npmClashes } from './files.mjs';
export type { PackageJson } from './files.mjs';

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
  /** The game's own files and package.json entries (`field.key`) that `force` let the engine's replace. */
  forced: string[];
  /** Root files the game never edited, brought to the engine's templates (or written, for a template new to it). */
  refreshed: string[];
  /** Root files the game edited whose templates changed: to compare by hand. */
  diverged: string[];
  lockfileFits: boolean;
}

export const TEMPLATES: readonly (readonly [string, string])[];
export function gameName(target: string, name?: string): string;
export function render(text: string, values: Readonly<Record<string, string>>): string;
export function createGame(options: { target: string; name?: string; source?: string; git?: boolean }): Created;
export function updateGame(options: { target: string; source?: string; force?: boolean }): Updated;
export function main(argv?: string[], out?: (line: string) => void, err?: (line: string) => void): number;
