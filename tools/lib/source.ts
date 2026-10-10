/**
 * @file The read-only source checkouts: my-3d2dge at `$MY3D2DGE_SRC` and shardfall at `$SHARDFALL_SRC` (PLAN.md
 * WP 0.1). Resolved exactly as `scripts/setup.sh` does, from the same constants: the variable; else
 * `.cache/src-*`; else `git clone --shared` from the local clone; else a clone from GitHub; then detached at the
 * pinned commit. `x src` prints them; tests that read a source call `requireSource()`.
 *
 * Invariants: the constants (variable, directory, full commit, local clone, URL) are parsed from the
 * `resolve_source` lines of `scripts/setup.sh`, never restated here. A checkout named by its variable is never
 * changed. Network clones never prompt (`GIT_TERMINAL_PROMPT=0`).
 *
 * @example
 * const mine = sourceSpecs(process.cwd()).map((spec) => spec.variable); // ['MY3D2DGE_SRC', 'SHARDFALL_SRC']
 * @see tools/lib/source.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One source checkout, as `scripts/setup.sh` declares it. */
export interface SourceSpec {
  /** The repository's name, from its URL: `my-3d2dge`, `shardfall`. */
  name: string;
  /** The environment variable that may name a checkout: `MY3D2DGE_SRC`. */
  variable: string;
  /** The clone used when the variable is unset, relative to the repository root: `.cache/src-3d2dge`. */
  dest: string;
  /** The pinned commit, as a full SHA. */
  commit: string;
  /** An existing clone to share objects with (the cloud image's), used before GitHub. */
  localClone: string;
  /** The GitHub repository, the last resort. */
  url: string;
  /** Environment set for every git command on this source (`GIT_LFS_SKIP_SMUDGE=1` for shardfall). */
  env: Record<string, string>;
}

/** How a source resolved. `ok` means its checkout is at the pinned commit. */
export interface ResolvedSource {
  spec: SourceSpec;
  ok: boolean;
  /** The checkout's absolute path, when one exists. */
  path?: string;
  /** The checkout's HEAD commit, when it has one. */
  head?: string;
  /** Where it came from. */
  via: 'variable' | '.cache' | 'local clone' | 'GitHub' | 'none';
  /** Why it is not `ok`, as a sentence naming the fix. */
  problem?: string;
}

/** The repository root, two levels above this file. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `owner/repo` for a GitHub URL: what the session must include when the source cannot be reached. */
export function repoSlug(url: string): string {
  return url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}

/** Parses the `resolve_source VAR DEST COMMIT LOCAL_CLONE URL` lines of `scripts/setup.sh` under `root`. */
export function sourceSpecs(root: string = ROOT): SourceSpec[] {
  const text = readFileSync(join(root, 'scripts', 'setup.sh'), 'utf8').replace(/\\\n\s*/g, ' ');
  const line =
    /^((?:[A-Z_][A-Z0-9_]*=\S+\s+)*)resolve_source\s+([A-Z_][A-Z0-9_]*)\s+(\S+)\s+([0-9a-f]{40})\s+(\S+)\s+(\S+)\s*$/gm;
  const specs = [...text.matchAll(line)].map(([, prefix, variable, dest, commit, localClone, url]) => ({
    name: repoSlug(url).split('/').pop() ?? url,
    variable,
    dest,
    commit,
    localClone,
    url,
    env: Object.fromEntries(
      prefix
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((pair) => pair.split('=', 2)),
    ),
  }));
  if (specs.length === 0) throw new Error(`no resolve_source lines in ${join(root, 'scripts', 'setup.sh')}`);
  return specs;
}

/** Runs git quietly; returns its trimmed output, or undefined when it fails. */
function git(args: string[], env: Record<string, string>, cwd?: string): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

/** Options for `resolveSource`; tests point them at temporary repositories. */
export interface ResolveOptions {
  /** The repository root that `spec.dest` is relative to. */
  root?: string;
  /** The environment to read the variable from. */
  env?: Record<string, string | undefined>;
  /** Clone when no checkout exists (default true). */
  clone?: boolean;
}

/**
 * Resolves one source as `scripts/setup.sh` does, cloning and detaching `.cache/src-*` when needed. A checkout
 * named by its variable is only checked. Never throws: problems come back in `problem`.
 */
export function resolveSource(spec: SourceSpec, options: ResolveOptions = {}): ResolvedSource {
  const root = options.root ?? ROOT;
  const env = options.env ?? process.env;
  const short = spec.commit.slice(0, 7);
  const include = `the session must include ${repoSlug(spec.url)} (PLAN.md §11.5): escalate once`;
  let path: string;
  let via: ResolvedSource['via'];
  const fromVariable = env[spec.variable];
  if (fromVariable) {
    path = fromVariable;
    via = 'variable';
  } else {
    path = join(root, spec.dest);
    via = '.cache';
    if (!existsSync(join(path, '.git'))) {
      if (options.clone === false) {
        return {
          spec,
          ok: false,
          via: 'none',
          problem: `${spec.variable} is unset and ${spec.dest} is missing: run node x src`,
        };
      }
      rmSync(path, { recursive: true, force: true });
      mkdirSync(dirname(path), { recursive: true });
      if (existsSync(join(spec.localClone, '.git'))) {
        via = 'local clone';
        git(['clone', '--quiet', '--shared', spec.localClone, path], spec.env);
      } else {
        via = 'GitHub';
        git(['clone', '--quiet', spec.url, path], spec.env);
      }
      if (!existsSync(join(path, '.git'))) {
        rmSync(path, { recursive: true, force: true });
        const from = via === 'GitHub' ? `cannot reach ${spec.url}` : `could not clone ${spec.localClone}`;
        return { spec, ok: false, via: 'none', problem: `${spec.variable} is unresolved: ${from}; ${include}` };
      }
    }
    if (git(['cat-file', '-e', `${spec.commit}^{commit}`], spec.env, path) === undefined) {
      git(['fetch', '--quiet', spec.url, spec.commit], spec.env, path);
    }
    if (git(['rev-parse', 'HEAD'], spec.env, path) !== spec.commit) {
      git(['checkout', '--quiet', '--detach', spec.commit], spec.env, path);
    }
  }
  const head = git(['rev-parse', 'HEAD'], spec.env, path);
  if (head === spec.commit) return { spec, ok: true, path, head, via };
  const problem = head
    ? `${spec.variable}=${path} is at ${head.slice(0, 7)}, not the pinned ${short}; it is read-only, so fix it by hand`
    : `${spec.variable}=${path} is not a git checkout of ${spec.name}; point it at one at ${short}, or unset it`;
  return { spec, ok: false, path, head, via, problem: via === 'variable' ? problem : `${problem}; ${include}` };
}

/** The part of a Vitest test context that `requireSource` uses (kept structural, so this file never imports Vitest). */
export interface SkippableTest {
  task: { meta: object };
  skip(note?: string): never;
}

const resolvedOnce = new Map<string, ResolvedSource>();

/**
 * Returns the absolute path of the named source (`my-3d2dge` or `shardfall`) for a test that reads it. When it
 * cannot be resolved (offline), it marks the test's report entry `meta.deferred = "no source"` and skips the test,
 * so the summary reports `deferred: no source`.
 */
export function requireSource(name: string, test: SkippableTest, root: string = ROOT): string {
  const spec = sourceSpecs(root).find((candidate) => candidate.name === name || candidate.variable === name);
  if (!spec) throw new Error(`requireSource: no source named "${name}" in scripts/setup.sh`);
  const key = `${root}\0${spec.variable}`;
  const resolved = resolvedOnce.get(key) ?? resolveSource(spec, { root });
  resolvedOnce.set(key, resolved);
  if (resolved.ok && resolved.path) return resolved.path;
  Object.assign(test.task.meta, { deferred: 'no source' });
  return test.skip(`deferred: no source (${resolved.problem ?? spec.variable})`);
}
