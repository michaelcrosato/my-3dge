/**
 * @file Unit tests for the dev server (`tools/lib/vite.ts`) and `vite.config.ts`: test pages are served and a missing
 * page is a 404, `.ts` modules come with inline source maps, a bare `three` resolves to `three/webgpu`, and every
 * runtime dependency is pre-bundled.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../../vite.config';
import { startVite, type DevServer } from './vite';

const ROOT = join(import.meta.dirname, '..', '..');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
let server: DevServer;
beforeAll(async () => {
  server = await startVite();
});
afterAll(async () => {
  await server?.close();
});

describe('startVite', () => {
  it('serves a test page on a free port of 127.0.0.1', async () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    const response = await fetch(`${server.url}tests/pages/harness.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<script type="module" src="./harness.ts"></script>');
  });

  it('answers a missing page with 404, not the root page', async () => {
    expect((await fetch(`${server.url}tests/pages/missing.html`)).status).toBe(404);
    expect((await fetch(`${server.url}labs/missing/`)).status).toBe(404);
  });

  it('serves TypeScript as JavaScript with an inline source map', async () => {
    const code = await (await fetch(`${server.url}tests/pages/harness.ts`)).text();
    expect(code).not.toContain('interface HarnessSignals');
    expect(code).toMatch(/\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+\s*$/);
  });
});

describe('vite.config.ts', () => {
  it('resolves a bare three to the module three/webgpu resolves to', async () => {
    const vite = await createServer({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
    });
    try {
      const importer = join(ROOT, 'tests/pages/harness.ts');
      const bare = await vite.pluginContainer.resolveId('three', importer);
      const webgpu = await vite.pluginContainer.resolveId('three/webgpu', importer);
      // Pre-bundled (node_modules/.vite/deps/three_webgpu.js) or, before that, the package's own build file.
      expect(bare?.id).toMatch(/(\/\.vite\/deps\/three_webgpu\.js|\/three\/build\/three\.webgpu\.js)(\?|$)/);
      expect(bare?.id).toBe(webgpu?.id);
    } finally {
      await vite.close();
    }
  });

  it('pre-bundles every runtime dependency of package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const include = config.optimizeDeps?.include ?? [];
    for (const dependency of Object.keys(pkg.dependencies)) {
      expect(
        include.some((entry) => entry === dependency || entry.startsWith(`${dependency}/`)),
        `optimizeDeps.include in vite.config.ts lacks ${dependency}`,
      ).toBe(true);
    }
  });

  it('runs Vitest in Node on *.test.ts, without the browser suites, reporting to out/test/report.json', () => {
    expect(config.test).toMatchObject({
      environment: 'node',
      include: ['**/*.test.ts'],
      reporters: ['dot', 'json'],
      outputFile: { json: 'out/test/report.json' },
    });
    expect(config.test?.exclude).toContain('tests/e2e/**');
    expect(config.test?.exclude).toContain('.cache/**');
  });

  it('makes a test filter that matches no file exit 1 (npm test -- <filter>)', () => {
    const report = join(mkdtempSync(join(tmpdir(), 'x-vitest-')), 'report.json');
    const run = spawnSync(process.execPath, [VITEST, 'run', 'no/such/test/path', `--outputFile.json=${report}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(run.stdout + run.stderr).toContain('No test files found');
    expect(run.status).toBe(1);
    rmSync(dirname(report), { recursive: true, force: true });
  });
});
