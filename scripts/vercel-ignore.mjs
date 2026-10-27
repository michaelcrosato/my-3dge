/**
 * @file Vercel's Ignored Build Step (vercel.json's `ignoreCommand`; ADR-0023 amendment 4): which pushes Vercel builds,
 * to keep its cost down at the owner's direction of 2026-10-27 without changing what it serves.
 * - **Production** (`VERCEL_ENV` `production`, a push to `main`) builds when a file that can ship changed since the
 *   last deployment that succeeded (`VERCEL_GIT_PREVIOUS_SHA`), or when that cannot be told (no earlier deployment,
 *   or its commit missing from Vercel's shallow clone). A change only to what never ships (`NEVER_SHIPS`: the docs,
 *   the plan, the tests but the replays the pages play, the tools but the one vite.config.ts imports, the CI and the
 *   agents' files) is skipped: the site would come out byte for byte the same.
 * - **A preview** (any other branch) builds only when its commit message asks, with `[preview]`: agents push their
 *   branch many times a stage, and nobody opens those previews (merges wait on the quick gate, never on Vercel).
 * `NEVER_SHIPS` lists what never ships rather than what does, so a page that starts importing from a new place builds
 * anyway: a wrong guess costs one build, never a stale site.
 *
 * Without `VERCEL_ENV` (Vercel's system variables not exposed) it builds, as it does whenever it cannot tell.
 *
 * Exit codes are Vercel's: 0 skips the build, 1 builds. It runs in Vercel's build image before `npm ci`, so it is plain
 * JavaScript with Node's own modules only.
 *
 * @example
 * decide({ env: 'production', message: '', changed: ['docs/PROGRESS.md', 'PLAN.md'] }).build; // false
 * decide({ env: 'production', message: '', changed: ['labs/playground/main.ts'] }).build; // true
 * decide({ env: 'preview', message: 'labs: a new lab [preview]', changed: [] }).build; // true
 * @see tests/unit/vercel-ignore.test.ts
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** What never ships: no page imports it, and `npm run build` reads none of it (the build's module graph, 2026-10-27). */
export const NEVER_SHIPS = Object.freeze([
  /^docs\//,
  /^[^/]+\.md$/,
  /^LICENSE$/,
  /^\.github\//,
  /^\.claude\//,
  /^evals\//,
  /^fixtures\//,
  /^lean\//,
  /^scripts\//,
  /^tools\/(?!lib\/tiers\.ts$)/,
  /^tests\/(?!replays\/)/,
  /\.test\.ts$/,
  /^(eslint\.config\.js|playwright\.config\.ts|stryker\.config\.json|x\.js|\.gitignore|\.gitattributes|\.nvmrc)$/,
]);

/** Whether `path` (from the repository's root, with `/`) never ships. */
export function neverShips(path) {
  return NEVER_SHIPS.some((pattern) => pattern.test(path));
}

/**
 * Whether Vercel builds a push (see the file comment): `env` is `VERCEL_ENV`, `message` the commit's message, and
 * `changed` the files changed since the last deployment that succeeded, or null when that cannot be told.
 */
export function decide({ env, message, changed }) {
  if (!env) return { build: true, reason: 'VERCEL_ENV unset: whether this is production cannot be told' };
  if (env !== 'production') {
    return /\[preview\]/i.test(message ?? '')
      ? { build: true, reason: 'a preview its commit message asks for ([preview])' }
      : { build: false, reason: 'a preview: built only when its commit message says [preview]' };
  }
  if (!changed) return { build: true, reason: 'production: what changed since the last deployment is unknown' };
  const ships = changed.filter((path) => !neverShips(path));
  if (!ships.length) return { build: false, reason: `production: none of the ${changed.length} changed files ships` };
  const named = ships.slice(0, 3).join(', ') + (ships.length > 3 ? ', …' : '');
  return { build: true, reason: `production: ${ships.length} changed files ship (${named})` };
}

/** The files changed from `from` to `to` in the checkout at the working directory; null when git cannot tell. */
export function changedFiles(from, to) {
  if (!from || !to) return null;
  try {
    const out = execFileSync('git', ['diff', '--name-only', from, to], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); // prettier-ignore
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const changed = changedFiles(env.VERCEL_GIT_PREVIOUS_SHA, env.VERCEL_GIT_COMMIT_SHA);
  const { build, reason } = decide({ env: env.VERCEL_ENV, message: env.VERCEL_GIT_COMMIT_MESSAGE, changed });
  console.log(`vercel-ignore: ${build ? 'build' : 'skip'}: ${reason}`);
  process.exit(build ? 1 : 0);
}
