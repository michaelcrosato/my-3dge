/**
 * @file Unit tests for scripts/vercel-ignore.mjs and vercel.json (ADR-0023 amendment 4): production builds a push that
 * changes what can ship and skips one that changes only what never ships; a preview builds only on `[preview]`; and
 * whatever cannot be told builds. No file the build reads (the pages, the engine, the clip sets, the replays the pages
 * play, the configs) counts as never shipping. vercel.json runs the script, and caches for a year only `/assets/`,
 * whose every file name Vite hashes (no output names set in vite.config.ts), so a new deployment shows at once.
 * Not a deployment test (ADR-0021): it reads the script and the configs, in Node.
 * @see scripts/vercel-ignore.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedFiles, decide, neverShips } from '../../scripts/vercel-ignore.mjs';
import config from '../../vite.config';

/** The repository's root. */
const ROOT = new URL('../../', import.meta.url).pathname;

describe('which pushes Vercel builds', () => {
  it('builds production when something that ships changed, and skips it when nothing did', () => {
    const production = (changed: string[] | null) => decide({ env: 'production', message: 'x', changed }).build;
    expect(production(['docs/PROGRESS.md', 'PLAN.md', 'AGENTS.md', 'tests/e2e/box.spec.ts', 'tools/cmd/ci.ts'])).toBe(false); // prettier-ignore
    expect(production(['labs/playground/ui/checks.test.ts', 'scripts/setup.sh', '.github/workflows/ci.yml'])).toBe(false); // prettier-ignore
    expect(production(['docs/PROGRESS.md', 'labs/playground/main.ts'])).toBe(true);
    expect(production(['tests/replays/playground-tour.replay.json'])).toBe(true); // the tour page plays it
    expect(production(['tools/lib/tiers.ts'])).toBe(true); // vite.config.ts imports it
    expect(production(['package-lock.json'])).toBe(true);
    expect(production(['a-new-root/thing.ts'])).toBe(true); // what no rule names builds
    expect(production(null)).toBe(true);
    expect(production([])).toBe(false);
  });

  it('builds a preview only when its commit message asks, and whatever it cannot place', () => {
    expect(decide({ env: 'preview', message: 'labs: a lab', changed: ['labs/x.ts'] }).build).toBe(false);
    expect(decide({ env: 'preview', message: 'labs: a lab [preview]', changed: [] }).build).toBe(true);
    expect(decide({ env: undefined, message: '', changed: [] }).build).toBe(true);
  });

  it('counts no file the build reads as never shipping', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const read = tracked.filter((path) => /^(engine|labs|data|tests\/replays)\//.test(path) && !path.endsWith('.test.ts')); // prettier-ignore
    const configs = ['index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'vercel.json', '.vercelignore', 'tools/lib/tiers.ts']; // prettier-ignore
    const tsconfigs = tracked.filter((path) => /^tsconfig[^/]*\.json$/.test(path));
    expect(read.length).toBeGreaterThan(1500);
    expect([...read, ...configs, ...tsconfigs].filter(neverShips)).toEqual([]);
  });

  it('reads what changed from git, and nothing when git cannot tell', () => {
    expect(changedFiles('HEAD', 'HEAD')).toEqual([]);
    expect(changedFiles('0000000000000000000000000000000000000000', 'HEAD')).toBeNull();
    expect(changedFiles(undefined, 'HEAD')).toBeNull();
  });

  it('runs from vercel.json, which caches only the hashed assets for a year', () => {
    const vercel = JSON.parse(readFileSync(`${ROOT}vercel.json`, 'utf8')) as {
      ignoreCommand: string;
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    expect(vercel.ignoreCommand).toBe('node scripts/vercel-ignore.mjs');
    expect(vercel.headers).toEqual([{ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]); // prettier-ignore
    expect(config.build?.rollupOptions?.output).toBeUndefined(); // Vite's names, each with its content's hash
  });
});
