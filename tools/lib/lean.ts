/**
 * @file The lean package, lean/ (ADR-0024 amendment 1, the owner's call of 2026-10-16): the engine shipped the way
 * three.js, Rapier or Babylon.js ship, as a library and nothing else, with no tests, checks, tools or install. It is the
 * default handoff (README.md's first section): any agent, a chat in a browser with no sandbox included, reads one file
 * and writes a game as one HTML page that loads the engine from a CDN.
 *
 * - lean/my3dge.js: the engine (engine/index.ts, which re-exports engine/sim-api.ts) as one ES module, built by Vite's
 *   library mode; three.js and Rapier stay imports by their npm names (`EXTERNAL`), which a page's import map points
 *   at jsDelivr at the versions package.json pins (`leanImports`), so a page loads one copy of each.
 * - lean/my3dge.css: the touch controls' styles (engine/ui/touch.css).
 * - lean/game.html: the starter game (labs/game/) as one page, hand-written but for its head's CSS link and import map
 *   (`leanHead`), which this module writes between the `lean:head` markers.
 * - lean/README.md: the one file an agent reads, hand-written but for four blocks this module writes: game.html whole
 *   (`lean:game`), the looks and filters (`lean:looks`, tools/lib/docsLooks.ts), the built-in ids and the level
 *   legend (`lean:ids`, tools/lib/docsIds.ts) and the public API by area (`lean:api`, tools/lib/docsGameApi.ts's map).
 * - lean/LICENSE: the engine's license, then the notice and license of the @stdlib functions the bundle carries and
 *   the notice of its movement model's port of er-apex (MIT).
 *
 * `x docs --write` writes the files that differ (`writeLean`); `x docs --check`, and so `npm run check`, fails while
 * one does (`leanFindings`): the build takes about 3 s and gives the same bytes every time. The repository proves the
 * package for it, and none of that ships: tools/lib/lean.test.ts checks that the import map names every import the
 * bundle makes and that each mapped file is in node_modules at the pinned version, and tests/e2e/lean.spec.ts plays
 * game.html with the CDN's URLs served from node_modules and lean/.
 *
 * Pages take the engine at its version's tag, `@v<version>` (ADR-0026: main's push tags each version, and jsDelivr
 * serves a tag as it was, for good), so a game keeps the engine it was made with; it moves to a newer engine by
 * putting a newer version in its two engine URLs.
 *
 * @example
 * leanImports(process.cwd()).three; // 'https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js'
 * withBlock('a <!-- lean:x:start -->old<!-- lean:x:end -->', 'x', 'new'); // 'a <!-- lean:x:start -->\nnew\n<!-- lean:x:end -->'
 * @see tools/lib/lean.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rollup } from 'vite';
import { ENGINE_VERSION } from '../../engine/core/version';
import { ENGINE_REPOSITORY } from '../game/files.mjs';
import { apiMap } from './docsGameApi';
import { idsCatalog } from './docsIds';
import { looksCatalog } from './docsLooks';
import type { Finding } from './report';

/** The package's folder. */
export const LEAN = 'lean';

/** Where pages load the package from: jsDelivr's copy of this repository at the engine's version tag. */
export const LEAN_URL = `${ENGINE_REPOSITORY.replace('https://github.com/', 'https://cdn.jsdelivr.net/gh/')}@v${ENGINE_VERSION}/${LEAN}/`;

/** The imports the bundle leaves to the page's import map: three.js and Rapier, by their npm names. */
export const EXTERNAL = /^(three|@dimforge\/)/;

/** Rapier's package: the compat build, whose WebAssembly is inside its JavaScript, so a CDN serves it as one file. */
const RAPIER = '@dimforge/rapier3d-simd-compat';

/** The first lines of lean/my3dge.js. */
const BANNER = `/*! my3dge ${ENGINE_VERSION}: the my-3dge engine as one ES module (${ENGINE_REPOSITORY}, MIT; it carries @stdlib functions, Apache-2.0: see LICENSE). It imports three.js and Rapier by name: lean/README.md gives the import map. Written by node x docs --write from engine/index.ts. */`; // prettier-ignore

/** How lean/README.md introduces the API: every name comes from one module. */
const API_WORDS = {
  intro: [
    "Every name below is an export of `my3dge` (`import { createEngine, defineScene } from 'my3dge'`). Each has the",
    'first sentence of its doc comment in docs/API.md, and its whole manual where engine/ declares it.',
  ],
  pages: 'For the page (the browser side), not for code that runs in the sim:',
};

/** The import map a page needs, by specifier: the engine, and three.js and Rapier at the versions package.json pins. */
export function leanImports(root: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  const three = `https://cdn.jsdelivr.net/npm/three@${pkg.dependencies.three}/`;
  return {
    my3dge: `${LEAN_URL}my3dge.js`,
    three: `${three}build/three.webgpu.js`,
    'three/webgpu': `${three}build/three.webgpu.js`,
    'three/tsl': `${three}build/three.tsl.js`,
    'three/addons/': `${three}examples/jsm/`,
    [RAPIER]: `https://cdn.jsdelivr.net/npm/${RAPIER}@${pkg.dependencies[RAPIER]}/dist/rapier.mjs`,
  };
}

/** game.html's generated head: the engine's CSS and the import map, indented as the page's head is. */
export function leanHead(root: string): string {
  const map = JSON.stringify({ imports: leanImports(root) }, null, 2).replaceAll('\n', '\n      ');
  return [
    `    <link rel="stylesheet" href="${LEAN_URL}my3dge.css" />`,
    '    <script type="importmap">',
    `      ${map}`,
    '    </script>',
  ].join('\n');
}

/** `text` with the block between `<!-- lean:<name>:start -->` and its end marker replaced by `body`. */
export function withBlock(text: string, name: string, body: string): string {
  const [start, end] = [`<!-- lean:${name}:start -->`, `<!-- lean:${name}:end -->`];
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0)
    throw new Error(`the markers ${start} and ${end} are missing: put them back around the block`);
  return `${text.slice(0, from + start.length)}\n${body}\n${text.slice(text.lastIndexOf('\n', to) + 1)}`;
}

/** The engine as one ES module, with its banner: Vite's library mode on engine/index.ts, in memory. */
export async function leanBundle(root: string): Promise<string> {
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      write: false,
      target: 'es2022',
      reportCompressedSize: false,
      lib: { entry: join(root, 'engine/index.ts'), formats: ['es'], fileName: 'my3dge' },
      rollupOptions: { external: (id) => EXTERNAL.test(id) },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const files = outputs.flatMap((output) => output.output);
  const [chunk] = files;
  if (files.length !== 1 || chunk.type !== 'chunk') {
    throw new Error(`the engine built to ${files.length} files, not one module: a dynamic import or an asset split it`);
  }
  return `${BANNER}\n${chunk.code}`;
}

/**
 * lean/LICENSE: the engine's license, then the @stdlib functions' notice and license, copied from node_modules, then
 * the notice of the movement model's port of er-apex (engine/physics/movement/NOTICE).
 */
function leanLicense(root: string): string {
  const stdlib = join(root, 'node_modules/@stdlib/math-base-special-sin');
  return [
    readFileSync(join(root, 'LICENSE'), 'utf8').trimEnd(),
    '',
    '---',
    '',
    'lean/my3dge.js carries functions of the stdlib project (@stdlib/math-base-special-sin, -cos and -pow, and the',
    '@stdlib packages they use), under the Apache License 2.0. Their notice, then their license:',
    '',
    readFileSync(join(stdlib, 'NOTICE'), 'utf8').trim(),
    '',
    readFileSync(join(stdlib, 'LICENSE'), 'utf8').trim(),
    '',
    '---',
    '',
    'lean/my3dge.js carries the shooter movement model of engine/physics/movement/. Its notice:',
    '',
    readFileSync(join(root, 'engine/physics/movement/NOTICE'), 'utf8').trim(),
    '',
  ].join('\n');
}

/** Every file of the package as `x docs --write` leaves it, by repository path. */
export async function leanFiles(root: string): Promise<Record<string, string>> {
  const read = (file: string) => readFileSync(join(root, LEAN, file), 'utf8');
  const game = withBlock(read('game.html'), 'head', leanHead(root));
  const blocks = {
    game: `\`\`\`html\n${game.trimEnd()}\n\`\`\``,
    looks: looksCatalog(),
    ids: await idsCatalog(),
    api: apiMap(root, API_WORDS),
  };
  const readme = Object.entries(blocks).reduce((text, [name, body]) => withBlock(text, name, body), read('README.md'));
  return {
    [`${LEAN}/my3dge.js`]: await leanBundle(root),
    [`${LEAN}/my3dge.css`]: readFileSync(join(root, 'engine/ui/touch.css'), 'utf8'),
    [`${LEAN}/game.html`]: game,
    [`${LEAN}/README.md`]: readme,
    [`${LEAN}/LICENSE`]: leanLicense(root),
  };
}

/**
 * The most lean/README.md may weigh, in bytes (about 20,000 tokens): every lean agent reads it whole, often in a chat,
 * and docs/HANDOFF.md cites the budget. It weighed about 76 KB when budgeted, with the catalogues of looks and built-in
 * ids that a fresh agent's trial needed (ADR-0024 amendment 2).
 */
export const LEAN_README_BUDGET_BYTES = 80_000;

/** The package's stale files, and its README over its budget, as findings; none in a game made from the engine. */
export async function leanFindings(root: string): Promise<Finding[]> {
  if (!existsSync(join(root, LEAN, 'README.md'))) return [];
  try {
    const files = await leanFiles(root);
    const readme = `${LEAN}/README.md`;
    const bytes = Buffer.byteLength(files[readme]);
    const over: Finding[] =
      bytes > LEAN_README_BUDGET_BYTES
        ? [{ id: 'DOCS_LEAN', message: `${readme} weighs ${bytes} bytes, over its ${LEAN_README_BUDGET_BYTES}: every lean agent reads it whole, so cut prose rather than raise the budget`, file: readme }] // prettier-ignore
        : [];
    const stale = Object.entries(files)
      .filter(([path, text]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== text)
      .map(([path]) => ({ id: 'DOCS_STALE', message: `${path} is stale: run node x docs --write (tools/lib/lean.ts writes it)`, file: path })); // prettier-ignore
    return [...over, ...stale];
  } catch (error) {
    return [{ id: 'DOCS_LEAN', message: `the lean package failed to build: ${(error as Error).message}`, file: LEAN }];
  }
}

/** Writes the package's files that differ; returns their paths. */
export async function writeLean(root: string): Promise<string[]> {
  if (!existsSync(join(root, LEAN, 'README.md'))) return [];
  const files = await leanFiles(root);
  const stale = Object.keys(files).filter((path) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== files[path]); // prettier-ignore
  for (const path of stale) writeFileSync(join(root, path), files[path]);
  return stale;
}
