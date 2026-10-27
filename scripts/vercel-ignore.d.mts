/** Types for scripts/vercel-ignore.mjs (plain JavaScript, run before `npm ci`); its file comment says what each does. */

/** What never ships. */
export declare const NEVER_SHIPS: readonly RegExp[];

/** Whether `path` never ships. */
export declare function neverShips(path: string): boolean;

/** What a push is: `VERCEL_ENV`, the commit's message, and the files changed since the last deployment, or null. */
export interface Push {
  env: string | undefined;
  message: string | undefined;
  changed: readonly string[] | null;
}

/** Whether Vercel builds a push, and why. */
export declare function decide(push: Push): { build: boolean; reason: string };

/** The files changed from `from` to `to`; null when git cannot tell. */
export declare function changedFiles(from: string | undefined, to: string | undefined): string[] | null;
