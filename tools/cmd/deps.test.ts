/**
 * @file Unit tests for `x deps` (tools/cmd/deps.ts, tools/lib/depsCheck.ts, tools/lib/depsUpdate.ts): the check on
 * fixture repositories written to temporary directories (pins too new, behind the newest compatible release
 * recorded, without a reason, drifted, unrecorded), `--update` and `--qualify` against fixture registries (offline),
 * the command's usage errors, the pinned packages imported from node_modules, and the repository's own pins. The
 * version model's own tests are in tools/lib/deps.test.ts.
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { gitBlob } from '../lib/deps';
import { checkDeps } from '../lib/depsCheck';
import { planUpdate, qualify, update, type Registry, type Runner } from '../lib/depsUpdate';
import { dispatch, ROOT } from '../x';
import { discoverPlugins } from './check';
import { createDepsCommand } from './deps';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DAY = '2026-10-10';
const NODE = 'v24.21.0';
const rel = (version: string, date: string) => ({ version, date });
/** A release from `"<version> <date>"`. */
const at = (text: string) => rel(...(text.split(' ') as [string, string]));
/** A next line: its first release (`"<version> <date>"`) and the day it qualifies. */
const next = (first: string, qualifies: string) => ({ ...at(first), qualifies });
/** A compatible record: qualifying, then the pin (also the newest release of its line), then `rest`. */
const entry = (qualifying: string, pin: string, rest: object) => ({
  ...{ qualifying: at(qualifying), pin: at(pin), newest: at(pin), rule: 'compatible', next: null },
  ...rest,
});
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are edited freely, then written as JSON */
type Files = { pkg: any; lock: any; record: any; nvmrc: string; extra: Record<string, string | Buffer> };

/** A fixture repository: alpha (runtime), beta and @types/alpha (dev), @types/gamma via beta, helper via types. */
function fixture(edit: (files: Files) => void = () => {}): string {
  const files: Files = {
    pkg: { dependencies: { alpha: '1.4.2' }, devDependencies: { beta: '0.3.1', '@types/alpha': '1.4.0' } },
    lock: {
      packages: {
        '': { dependencies: { alpha: '1.4.2' }, devDependencies: { beta: '0.3.1', '@types/alpha': '1.4.0' } },
        'node_modules/alpha': { version: '1.4.2' },
        'node_modules/beta': { version: '0.3.1', dependencies: { '@types/gamma': '2.0.5' } },
        'node_modules/@types/alpha': { version: '1.4.0', dependencies: { helper: '~0.1.0' } },
        'node_modules/@types/gamma': { version: '2.0.5' },
        'node_modules/helper': { version: '0.1.7' },
      },
    },
    record: {
      measured: DAY,
      dependencies: {
        alpha: entry('1.2.0 2025-01-10', '1.4.2 2026-08-01', {
          next: next('2.0.0 2026-03-01', '2027-03-01'),
          reason: 'it draws',
        }),
      },
      devDependencies: {
        beta: entry('0.3.0 2025-05-05', '0.3.1 2026-02-02', { reason: 'it tests' }),
        '@types/alpha': entry('1.2.0 2025-01-12', '1.4.0 2026-08-02', {
          ...{ follows: 'alpha', next: next('2.0.0 2026-03-02', '2027-03-01'), reason: "alpha's types" },
        }),
      },
      types: { '@types/gamma': entry('2.0.1 2025-02-02', '2.0.5 2026-04-04', { reason: 'beta pulls it in' }) },
      typesDeps: { helper: { version: '0.1.7', via: '@types/alpha', reason: 'declarations only' } },
      platform: {
        node: entry('24.10.0 2025-10-08', '24.21.0 2026-09-07', {
          ...{ rule: 'platform', next: next('26.0.0 2026-05-05', '2027-05-05'), reason: 'the runtime' },
        }),
        chromium: { pin: { version: '141.0.7390.37' }, rule: 'platform', next: null, reason: 'the browser' },
      },
      knowledge: {},
    },
    nvmrc: '24.21.0',
    extra: {},
  };
  edit(files);
  const root = mkdtempSync(join(tmpdir(), 'x-deps-'));
  temporary.push(root);
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  write('package.json', JSON.stringify(files.pkg));
  write('package-lock.json', JSON.stringify(files.lock));
  write('tools/deps.json', JSON.stringify(files.record));
  write('.nvmrc', `${files.nvmrc}\n`);
  for (const [path, content] of Object.entries(files.extra)) write(path, content);
  return root;
}

/** The check's failure and warning ids on a fixture. */
function ids(root: string, today = DAY, nodeVersion = NODE) {
  const outcome = checkDeps(root, { today, nodeVersion });
  return { failures: outcome.failures.map((f) => f.id), warnings: outcome.warnings?.map((w) => w.id) ?? [], outcome };
}
/** Moves alpha to `version` in package.json and the lockfile. */
const pinAlpha = (f: Files, version: string) => {
  f.pkg.dependencies.alpha =
    f.lock.packages[''].dependencies.alpha =
    f.lock.packages['node_modules/alpha'].version =
      version;
};

describe('x deps --check', () => {
  it('passes on pins its record admits', () => {
    expect(ids(fixture())).toMatchObject({ failures: [], warnings: [] });
  });

  it('fails a pin too new for its rule', () => {
    const major = fixture((f) => {
      pinAlpha(f, '2.0.0');
      f.record.dependencies.alpha.pin = f.record.dependencies.alpha.newest = rel('2.0.0', '2026-03-01');
      f.record.dependencies.alpha.next = null;
    });
    expect(ids(major).failures).toContain('DEPS_TOO_NEW');
    expect(ids(major).outcome.failures[0].message).toContain(
      'not backward compatible with its qualifying release 1.2.0',
    );
    const young = fixture((f) => (f.record.devDependencies.beta.rule = 'qualifies'));
    expect(ids(young).failures).toEqual(['DEPS_TOO_NEW']);
  });

  it('fails a pin older than the newest compatible release recorded', () => {
    const root = fixture((f) => (f.record.dependencies.alpha.newest = rel('1.4.5', '2026-09-30')));
    expect(ids(root).failures).toEqual(['DEPS_BEHIND']);
    expect(ids(root).outcome.failures[0].message).toContain('node x deps --update adopts it');
  });

  it('fails a package without a reason, a types dependency included', () => {
    expect(ids(fixture((f) => (f.record.devDependencies.beta.reason = ' '))).failures).toEqual(['DEPS_REASON']);
    expect(ids(fixture((f) => (f.record.typesDeps.helper.reason = ''))).failures).toEqual(['DEPS_REASON']);
  });

  it('fails pins that drift from the record, ranges, a stale lockfile, and unrecorded or stale packages', () => {
    expect(ids(fixture((f) => pinAlpha(f, '1.4.3'))).failures).toEqual(['DEPS_PIN']);
    expect(ids(fixture((f) => (f.pkg.dependencies.alpha = '^1.4.2'))).failures).toEqual(['DEPS_RANGE']);
    expect(ids(fixture((f) => (f.lock.packages['node_modules/alpha'].version = '1.4.1'))).failures).toEqual([
      'DEPS_LOCK',
    ]);
    expect(ids(fixture((f) => (f.pkg.dependencies.delta = '1.0.0'))).failures).toEqual(['DEPS_UNRECORDED']);
    expect(ids(fixture((f) => delete f.pkg.devDependencies.beta)).failures).toContain('DEPS_STALE');
  });

  it("holds the lockfile's types packages, and what only they pull in, to the record", () => {
    expect(ids(fixture((f) => (f.lock.packages['node_modules/@types/gamma'].version = '2.0.6'))).failures).toEqual([
      'DEPS_PIN',
    ]);
    const extra = fixture((f) => (f.lock.packages['node_modules/@webgpu/types'] = { version: '0.1.74' }));
    expect(ids(extra).failures).toEqual(['DEPS_UNRECORDED']);
    expect(ids(fixture((f) => (f.lock.packages['node_modules/helper'].version = '0.1.8'))).failures).toEqual([
      'DEPS_PIN',
    ]);
    // helper is no longer there only because of a types package once alpha needs it too.
    const shared = fixture((f) => (f.lock.packages['node_modules/alpha'].dependencies = { helper: '^0.1.0' }));
    expect(ids(shared).failures).toEqual(['DEPS_STALE']);
  });

  it('checks follows, the measurement of an internal, the ADR of a same-way pin, and unknown keys', () => {
    const apart = fixture((f) => {
      f.pkg.devDependencies['@types/alpha'] = f.lock.packages[''].devDependencies['@types/alpha'] = '2.0.0';
      f.lock.packages['node_modules/@types/alpha'].version = '2.0.0';
      Object.assign(f.record.devDependencies['@types/alpha'], {
        pin: rel('2.0.0', '2026-03-02'),
        newest: rel('2.0.0', '2026-03-02'),
        rule: 'internals',
        measurement: 'faster',
        next: null,
      });
    });
    expect(ids(apart).failures).toEqual(['DEPS_FOLLOWS']);
    expect(ids(fixture((f) => (f.record.dependencies.alpha.rule = 'internals'))).failures).toEqual([
      'DEPS_MEASUREMENT',
    ]);
    const sameWay = (f: Files) => Object.assign(f.record.dependencies.alpha, { rule: 'same-way', adr: 'ADR-0007' });
    expect(ids(fixture(sameWay)).failures).toEqual(['DEPS_ADR']);
    const adr = fixture((f) => (sameWay(f), (f.extra['docs/decisions/ADR-0007-versions.md'] = '# ADR-0007\n')));
    expect(ids(adr).failures).toEqual([]);
    const typo = ids(fixture((f) => (f.record.dependencies.alpha.reasons = 'x')));
    expect(typo.outcome.failures[0].message).toContain('did you mean "reason"?');
  });

  it("fails when .nvmrc differs from the record, and warns when the active node is not .nvmrc's", () => {
    expect(ids(fixture((f) => (f.nvmrc = '24.20.0'))).failures).toContain('DEPS_PIN');
    expect(ids(fixture(), DAY, 'v22.22.0')).toMatchObject({ failures: [], warnings: ['DEPS_NODE'] });
  });

  it('warns once a next line has qualified (the package that follows stays quiet)', () => {
    const later = ids(fixture(), '2027-03-02');
    expect(later).toMatchObject({ failures: [], warnings: ['DEPS_QUALIFIED'] });
    expect(later.outcome.warnings?.[0].message).toContain('alpha 2.0.0');
  });

  it('holds a pinned document to its pin line, its revision and its source blob', () => {
    const page = Buffer.from('## TSL\n\nThe page, unchanged.\n');
    const doc = { follows: 'alpha', line: '1.x', page: 'TSL.md', revision: 'abc1234def', blob: gitBlob(page) };
    const files =
      (body: Buffer, line = '1.x') =>
      (f: Files) => {
        f.record.knowledge = { 'docs/reference/tsl.md': { ...doc, line } };
        f.extra['docs/reference/tsl.md'] = Buffer.concat([Buffer.from('<!--\nRevision: abc1234def\n-->\n'), body]);
      };
    expect(ids(fixture(files(page))).failures).toEqual([]);
    expect(ids(fixture(files(Buffer.from('## TSL, edited\n'))))).toMatchObject({ failures: ['DEPS_KNOWLEDGE'] });
    expect(ids(fixture(files(page, '2.x')))).toMatchObject({ failures: ['DEPS_KNOWLEDGE'] });
  });
});

/** A fixture registry; `extra` adds releases, `fails` names packages it does not answer for. @types/gamma 2.0.6 is
 * held back by beta's exact range, and beta's 9.9.9 was unpublished. */
function registry(extra: Record<string, Record<string, string>> = {}, fails: string[] = []): Registry {
  const times: Record<string, Record<string, string>> = {
    alpha: { '1.2.0': '2025-01-10', '1.4.2': '2026-08-01', '2.0.0': '2026-03-01', '2.1.0': '2026-06-06' },
    beta: { '0.3.0': '2025-05-05', '0.3.1': '2026-02-02', '9.9.9': '2026-01-01' },
    '@types/alpha': { '1.2.0': '2025-01-12', '1.4.0': '2026-08-02', '2.0.0': '2026-03-02' },
    '@types/gamma': { '2.0.1': '2025-02-02', '2.0.5': '2026-04-04', '2.0.6': '2026-09-09' },
  };
  return {
    async npm(name) {
      if (fails.includes(name)) throw new Error('ENOTFOUND registry.npmjs.org');
      const time = { ...times[name], ...extra[name] };
      return {
        time,
        versions: Object.keys(time).filter((v) => v !== '9.9.9'),
        latest: name === 'beta' ? '0.3.1' : undefined,
      };
    },
    async node() {
      return {
        time: {
          '24.10.0': '2025-10-08',
          '24.21.0': '2026-09-07',
          '25.0.0': '2025-10-15',
          '26.0.0': '2026-05-05',
          ...extra.node,
        },
      };
    },
  };
}

describe('x deps --update and --qualify, against fixture registries', () => {
  it('finds nothing to adopt right after the pins are set, and leaves the record as it is', async () => {
    const plan = await planUpdate(fixture(), { registry: registry(), today: DAY });
    expect(plan).toMatchObject({ adoptions: [], failures: [], notes: [], changed: false });
  });

  it('--dry-run lists a newer compatible release and changes nothing', async () => {
    const root = fixture();
    const before = readFileSync(join(root, 'tools/deps.json'), 'utf8');
    const calls: string[] = [];
    const result = await update(root, {
      registry: registry({ alpha: { '1.4.3': '2026-10-01' } }),
      today: DAY,
      dryRun: true,
      run: (c, a) => (calls.push(`${c} ${a.join(' ')}`), { status: 0, output: '' }),
    });
    expect(result.lines).toEqual(['adopt alpha 1.4.2 → 1.4.3 (2026-10-01)']);
    expect([result.wrote, calls, readFileSync(join(root, 'tools/deps.json'), 'utf8')]).toEqual([false, [], before]);
  });

  it('adopts it with npm install --save-exact, rewrites the record, then runs T0 and T1', async () => {
    const root = fixture();
    const calls: string[] = [];
    const run: Runner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args[0] === 'install') {
        const [pkg, lock] = ['package.json', 'package-lock.json'].map((file) =>
          JSON.parse(readFileSync(join(root, file), 'utf8')),
        );
        pkg.dependencies.alpha =
          lock.packages[''].dependencies.alpha =
          lock.packages['node_modules/alpha'].version =
            '1.4.3';
        writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
        writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
      }
      return { status: 0, output: '' };
    };
    const result = await update(root, { registry: registry({ alpha: { '1.4.3': '2026-10-01' } }), today: DAY, run });
    expect(calls).toEqual(['npm install --save-exact --save-prod alpha@1.4.3', 'npm run check', 'npm test']);
    expect([result.wrote, result.failures]).toEqual([true, []]);
    expect(JSON.parse(readFileSync(join(root, 'tools/deps.json'), 'utf8')).dependencies.alpha.pin).toEqual(
      rel('1.4.3', '2026-10-01'),
    );
    expect(ids(root)).toMatchObject({ failures: [], warnings: [] });
  });

  it('names a package the registry did not answer for, a newer Node, and stops at a failed step', async () => {
    const plan = await planUpdate(fixture(), {
      registry: registry({ node: { '24.22.0': '2026-10-08' } }, ['beta']),
      today: DAY,
    });
    expect(plan.failures.map((f) => f.id)).toEqual(['DEPS_REGISTRY']);
    expect(plan.notes[0]).toContain('node 24.22.0 (2026-10-08) is newer than .nvmrc');
    const failing = await update(fixture(), {
      registry: registry({ alpha: { '1.4.3': '2026-10-01' } }),
      today: DAY,
      run: () => ({ status: 1, output: 'E404' }),
    });
    expect([failing.wrote, failing.failures.map((f) => f.id)]).toEqual([false, ['DEPS_STEP']]);
  });

  it('--qualify lists lines that qualified beyond the pins, with what an upgrade pins (Node by even lines)', async () => {
    expect((await qualify(fixture(), { registry: registry(), today: DAY })).upgrades).toEqual([]);
    const later = await qualify(fixture(), { registry: registry(), today: '2027-06-06' });
    expect(later.upgrades.map((u) => [u.name, u.qualified, u.target.version])).toEqual([
      ['alpha', '2027-03-01', '2.1.0'],
      ['node', '2027-05-05', '26.0.0'],
    ]);
    expect(later.lines[0]).toBe(
      'alpha 2.x qualified on 2027-03-01 (2.0.0, 2026-03-01): an upgrade WP pins 2.1.0 (2026-06-06)',
    );
  });
});

describe('node x deps', () => {
  const run = (argv: string[], root = fixture()) =>
    dispatch(['deps', ...argv], {
      root,
      print: () => {},
      commands: { deps: async () => createDepsCommand({ registry: registry(), today: DAY, nodeVersion: NODE }) },
    });

  it('checks by default, and refuses two modes or --dry-run without --update (exit 2)', async () => {
    expect(await run([])).toBe(0);
    expect(await run(['--update', '--dry-run'])).toBe(0);
    expect(await run(['--check', '--update'])).toBe(2);
    expect(await run(['--dry-run'])).toBe(2);
    expect(
      await run(
        ['--check'],
        fixture((f) => (f.record.dependencies.alpha.reason = '')),
      ),
    ).toBe(1);
  });

  it("passes on the repository's pins, and x check runs it as a plugin", async () => {
    const outcome = checkDeps(ROOT, { nodeVersion: NODE });
    expect(outcome.failures).toEqual([]);
    expect((await discoverPlugins(ROOT)).map((plugin) => plugin.name)).toContain('deps');
    const cli = spawnSync(process.execPath, ['x', 'deps', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(cli.status, cli.stdout).toBe(0);
  });
});

describe('the pinned packages, from node_modules', () => {
  it('are the versions tools/deps.json records', () => {
    const record = JSON.parse(readFileSync(join(ROOT, 'tools/deps.json'), 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'types']) {
      for (const [name, rec] of Object.entries<{ pin: { version: string } }>(record[section])) {
        const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
        expect(`${name}@${installed}`).toBe(`${name}@${rec.pin.version}`);
      }
    }
  });

  it('import in Node: Rapier steps a world, and three/webgpu gives its math and WebGPU classes', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    for (let step = 0; step < 60; step++) world.step();
    expect(body.translation().y).toBeLessThan(5 - 4.9 * 0.9); // about one second of free fall
    world.free();
    expect(new THREE.Vector3(1, 2, 2).length()).toBe(3);
    expect([typeof THREE.WebGPURenderer, typeof THREE.PostProcessing, 'RenderPipeline' in THREE]).toEqual([
      'function',
      'function',
      false,
    ]);
  });
});
