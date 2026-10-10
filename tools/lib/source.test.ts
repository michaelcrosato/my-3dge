/**
 * @file Unit tests for the source checkouts: the constants come from `scripts/setup.sh`, resolution follows its order
 * (variable, `.cache`, local clone, remote) and detaches at the pin, a variable's checkout is never changed, and
 * `requireSource` skips a test as `deferred: no source` when a source cannot be resolved.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoSlug, requireSource, resolveSource, sourceSpecs, type SkippableTest, type SourceSpec } from './source';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

/**
 * A temporary repository root whose scripts/setup.sh declares two sources: `demo`, pinned at the first of two
 * commits of a local "cloud image" clone, and `other`, whose clone and remote do not exist.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'x-source-'));
  temporary.push(root);
  const origin = join(root, 'image', 'demo');
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(origin, 'a.txt'), 'one');
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'one');
  const pinned = git(origin, 'rev-parse', 'HEAD');
  writeFileSync(join(origin, 'a.txt'), 'two');
  git(origin, 'commit', '--quiet', '-am', 'two');
  const newer = git(origin, 'rev-parse', 'HEAD');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(
    join(root, 'scripts', 'setup.sh'),
    [
      '# resolve_source VAR DEST COMMIT LOCAL_CLONE URL',
      `resolve_source DEMO_SRC .cache/src-demo ${pinned} \\`,
      `  ${origin} https://github.com/example/demo`,
      `GIT_LFS_SKIP_SMUDGE=1 resolve_source OTHER_SRC .cache/src-other ${'0'.repeat(40)} \\`,
      `  ${join(root, 'image', 'missing')} file://${join(root, 'nowhere.git')}`,
      '',
    ].join('\n'),
  );
  const [demo, other] = sourceSpecs(root) as [SourceSpec, SourceSpec];
  return { root, origin, pinned, newer, demo, other };
}

/** A stand-in for Vitest's test context that records the skip. */
function fakeTest(): SkippableTest & { note?: string } {
  const test: SkippableTest & { note?: string } = {
    task: { meta: {} },
    skip(note?: string): never {
      test.note = note;
      throw new Error('skipped');
    },
  };
  return test;
}

describe('the source constants', () => {
  it('name GitHub repositories as owner/repo', () => {
    expect(repoSlug('https://github.com/michaelcrosato/shardfall')).toBe('michaelcrosato/shardfall');
    expect(repoSlug('https://github.com/michaelcrosato/shardfall.git')).toBe('michaelcrosato/shardfall');
  });

  it('are parsed from scripts/setup.sh: both sources, full commits, the shardfall LFS switch', () => {
    const specs = sourceSpecs();
    expect(specs.map((spec) => [spec.name, spec.variable, spec.dest, spec.commit.slice(0, 7)])).toEqual([
      ['my-3d2dge', 'MY3D2DGE_SRC', '.cache/src-3d2dge', 'e37e4ee'],
      ['shardfall', 'SHARDFALL_SRC', '.cache/src-shardfall', 'fa2dab6'],
    ]);
    for (const spec of specs) {
      expect(spec.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(spec.url).toBe(`https://github.com/michaelcrosato/${spec.name}`);
    }
    expect(specs[0].env).toEqual({});
    expect(specs[1].env).toEqual({ GIT_LFS_SKIP_SMUDGE: '1' });
  });
});

describe('resolveSource', () => {
  it('clones from the local clone into .cache, detached at the pin, then reuses it', () => {
    const { root, pinned, demo } = sandbox();
    const first = resolveSource(demo, { root, env: {} });
    expect(first).toMatchObject({ ok: true, via: 'local clone', head: pinned, path: join(root, '.cache/src-demo') });
    expect(() => git(join(root, '.cache/src-demo'), 'symbolic-ref', '-q', 'HEAD')).toThrow();
    expect(resolveSource(demo, { root, env: {} })).toMatchObject({ ok: true, via: '.cache', head: pinned });
  });

  it('moves a drifted .cache checkout back to the pin', () => {
    const { root, pinned, newer, demo } = sandbox();
    resolveSource(demo, { root, env: {} });
    git(join(root, '.cache/src-demo'), 'checkout', '--quiet', '--detach', newer);
    expect(resolveSource(demo, { root, env: {} })).toMatchObject({ ok: true, via: '.cache', head: pinned });
  });

  it('only checks a checkout named by its variable, and never changes it', () => {
    const { root, origin, pinned, newer, demo } = sandbox();
    const wrong = resolveSource(demo, { root, env: { DEMO_SRC: origin } });
    expect(wrong).toMatchObject({ ok: false, via: 'variable', head: newer });
    expect(wrong.problem).toBe(
      `DEMO_SRC=${origin} is at ${newer.slice(0, 7)}, not the pinned ${pinned.slice(0, 7)}; ` +
        'it is read-only, so fix it by hand',
    );
    expect(git(origin, 'rev-parse', 'HEAD')).toBe(newer);
    git(origin, 'checkout', '--quiet', pinned);
    expect(resolveSource(demo, { root, env: { DEMO_SRC: origin } })).toMatchObject({ ok: true, via: 'variable' });
    expect(existsSync(join(root, '.cache'))).toBe(false);
  });

  it('names the repository the session must include when nothing can be cloned, and leaves nothing behind', () => {
    const { root, other } = sandbox();
    const result = resolveSource(other, { root, env: {} });
    expect(result).toMatchObject({ ok: false, via: 'none' });
    expect(result.problem).toBe(
      `OTHER_SRC is unresolved: cannot reach ${other.url}; ` +
        `the session must include ${repoSlug(other.url)} (PLAN.md §11.5): escalate once`,
    );
    expect(existsSync(join(root, '.cache/src-other'))).toBe(false);
  });

  it('clones nothing when asked not to', () => {
    const { root, demo } = sandbox();
    expect(resolveSource(demo, { root, env: {}, clone: false })).toMatchObject({ ok: false, via: 'none' });
    expect(existsSync(join(root, '.cache/src-demo'))).toBe(false);
  });
});

describe('requireSource', () => {
  it('returns the checkout of a source that resolves', () => {
    const { root, demo } = sandbox();
    expect(requireSource('demo', fakeTest(), root)).toBe(join(root, demo.dest));
  });

  it('skips the test as "deferred: no source" when the source cannot be resolved', () => {
    const { root } = sandbox();
    const test = fakeTest();
    expect(() => requireSource('OTHER_SRC', test, root)).toThrow('skipped');
    expect(test.note).toMatch(/^deferred: no source \(OTHER_SRC is unresolved: /);
    expect(test.task.meta).toEqual({ deferred: 'no source' });
  });

  it('gives this repository the read-only my-3d2dge checkout at its pin', (context) => {
    const path = requireSource('my-3d2dge', context);
    expect(git(path, 'rev-parse', '--short=7', 'HEAD')).toBe('e37e4ee');
  });
});
