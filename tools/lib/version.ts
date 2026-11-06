/**
 * @file The version check (PLAN.md WP 13.45, ADR-0026): every merge bumps the engine's version, so a branch that
 * differs from main must carry a version above main's. `versionCheck(root)` compares package.json's version with
 * `origin/main`'s: nothing differing from main (main's own full run) passes, as does a checkout with no `origin/main`
 * (it says so); otherwise the version must be `major.minor.patch` and above main's. `above(a, b)` orders two
 * versions by major, then minor, then patch. Nothing here fetches: run `git fetch origin main` first.
 *
 * The fix it names: `npm version patch --no-git-tag-version` for a fix (`minor` for a feature or a change to the
 * public API), then `node x docs --write` and `node x html --write`, which put the new version in the lean package's
 * URLs and the playground's page.
 *
 * @example
 * above('0.2.0', '0.1.9'); // true
 * above('0.1.0', '0.1.0'); // false
 * parseVersion('1.2'); // null
 * @see tools/lib/version.test.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the check found. */
export interface VersionCheck {
  ok: boolean;
  /** package.json's version. */
  version: string;
  /** origin/main's version, when there is an origin/main that differs. */
  main?: string;
  /** One sentence saying why. */
  reason: string;
}

/** The fix for a version not above main's. */
export const BUMP_FIX =
  'bump it: npm version patch --no-git-tag-version (minor for a feature or a public API change), then node x docs --write and node x html --write'; // prettier-ignore

/** A version's three numbers, or null when `text` is not `major.minor.patch`. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether version `a` is above `b`: a higher major, else minor, else patch; false when either is no version. */
export function above(a: string, b: string): boolean {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return false;
  const at = x.findIndex((n, i) => n !== y[i]);
  return at >= 0 && x[at] > y[at];
}

/** Runs git in `root`; undefined when it fails. */
function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

/** Compares package.json's version in `root` with origin/main's (see the file comment). */
export function versionCheck(root: string): VersionCheck {
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
  if (!parseVersion(version)) return { ok: false, version, reason: `package.json's version ${version} is not major.minor.patch` }; // prettier-ignore
  if (git(root, ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']) === undefined)
    return { ok: true, version, reason: 'there is no origin/main to compare with (git fetch origin main)' };
  const differs = git(root, ['diff', '--quiet', 'origin/main']) === undefined;
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) ?? '') !== '';
  if (!differs && !untracked) return { ok: true, version, reason: 'nothing differs from origin/main' };
  const shown = git(root, ['show', 'origin/main:package.json']);
  const main = shown ? (JSON.parse(shown) as { version?: string }).version : undefined;
  if (main === undefined) return { ok: true, version, reason: 'origin/main has no package.json version to compare with' }; // prettier-ignore
  return above(version, main)
    ? { ok: true, version, main, reason: `${version} is above main's ${main}` }
    : { ok: false, version, main, reason: `${version} is not above main's ${main}: ${BUMP_FIX}` };
}
