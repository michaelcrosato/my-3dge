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

/** engine-lock.json. */
export interface EngineLock {
  format: string;
  game: string;
  engine: EngineIdentity;
  npm: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
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
export function hashFile(file: string): string;
export function plan(source?: string): PlanItem[];
export const ENGINE_DIRS: readonly string[];
export function gameScripts(engine: { scripts?: Record<string, string> }): Record<string, string>;
export function lockFor(
  source: string,
  items: readonly PlanItem[],
  identity: EngineIdentity,
  game: string,
  engine: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  },
): EngineLock;
export function declaredPatches(target: string): string[];
export function verifyGame(target: string): GameCheck;
