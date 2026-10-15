/**
 * @file The types of tools/game/files.mjs, for the TypeScript that imports it (tools/cmd/engine.ts, the tests): the
 * module is plain JavaScript so it runs on any Node before anything is installed, and its comments are the manual.
 * @see tools/game/files.mjs
 */

/** Whose a file is in a game: the engine's (read-only, pinned), the game's own (the starter), or the engine repo's. */
export type Owner = 'engine' | 'game' | 'skip';

/** The engine a game is on, as its lock records it. */
export interface EngineIdentity {
  repository: string;
  commit: string;
  date: string;
  dirty: boolean;
}

/** One file a game gets: its source path, its path in the game, whose it is. */
export interface PlanItem {
  from: string;
  to: string;
  owner: Owner;
}

/** The package.json entries a game shares with the engine, by field (`NPM_FIELDS`). */
export interface NpmEntries {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean | string>;
}

/** A package.json, as far as a game's is read and written. */
export interface PackageJson extends NpmEntries {
  name: string;
  [key: string]: unknown;
}

/** engine-lock.json. */
export interface EngineLock {
  format: string;
  game: string;
  engine: EngineIdentity;
  /** The package.json entries the game got from the engine. */
  npm: NpmEntries;
  /** Each root file written from the engine's templates: the hash of what was written, or null (the game's own). */
  templates?: Record<string, string | null>;
  files: Record<string, string>;
}

/** What `verifyGame` finds. */
export interface GameCheck {
  lock: EngineLock;
  changed: string[];
  missing: string[];
  /** Files the game added in the engine's folders (`ENGINE_DIRS`). */
  added: string[];
  declared: string[];
  undeclared: string[];
}

export const ENGINE_REPOSITORY: string;
export const LOCK_FILE: string;
export const LOCK_FORMAT: string;
export const FEEDBACK_FILE: string;
export const STARTER: string;
export const SOURCE: string;
export const RENAMED: Readonly<Record<string, string>>;
export const RULES: readonly { owner: Owner; why: string; test(path: string): boolean }[];
export function ownerOf(path: string): Owner | null;
export function sourceFiles(source?: string): string[];
export function engineIdentity(source?: string): EngineIdentity;
export function hashText(text: string | Uint8Array): string;
export function hashFile(file: string): string;
export function plan(source?: string): PlanItem[];
export const ENGINE_DIRS: readonly string[];
export const NPM_FIELDS: readonly (keyof NpmEntries)[];
export function engineNpm(engine: NpmEntries): Required<NpmEntries>;
export function gamePackage(
  engine: PackageJson,
  name: string,
  previous?: PackageJson,
  before?: NpmEntries,
): PackageJson;
export function npmClashes(previous: PackageJson, engine: PackageJson, before?: NpmEntries): string[];
export function gameLockfile<T extends { name: string; packages: Record<string, object> }>(
  engineLock: T,
  name: string,
): T;
export function sameDependencies(pkg: NpmEntries, engine: NpmEntries): boolean;
export function lockFor(
  source: string,
  items: readonly PlanItem[],
  identity: EngineIdentity,
  game: string,
  engine: NpmEntries,
  templates?: Record<string, string | null>,
): EngineLock;
export function declaredPatches(target: string): string[];
export function verifyGame(target: string): GameCheck;
