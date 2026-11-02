/**
 * @file The one-file playground, `playground.html` at the root (ADR-0023 amendment 5, the owner's call of
 * 2026-11-02): the playground (labs/playground/) built as one self-contained HTML page, its script and styles inline
 * and nothing fetched, so it opens from disk (file://) in a WebGPU browser, sent as one file. It is how the engine is
 * distributed and how the owner tests it, in place of the Vercel deployment it replaces.
 *
 * `buildOneFile` runs Vite's build on labs/playground/index.html with vite.config.ts's alias (a bare `three` is
 * `three/webgpu`), every dynamic import folded into the one script (`inlineDynamicImports`) and every asset a data URL;
 * `inlineBuild` then puts the script and the stylesheet into the page. The build gives the same bytes on every machine
 * (no path or time goes in: tools/lib/oneFile.test.ts), so `node x html --check` rebuilds it and compares, and the
 * quick gate runs that check (tools/cmd/ci.ts): the committed file matches its sources at every merge.
 *
 * Invariants: the page fetches nothing (`externalRefs` is empty); a `</script` inside the script is written
 * `<\/script`, which means the same in a string, a template, a regular expression or a comment, and a `<!--` in it, which
 * no such rewrite makes safe, fails the build. The links to the other pages (the labs index, the Stress Box) lead
 * nowhere from the file: only the playground is in it.
 *
 * @example
 * inlineBuild('<script type="module" crossorigin src="./a.js"></script>', { 'a.js': 'go()' }); // '<script type="module">go()</script>'
 * ONE_FILE; // 'playground.html'
 * @see tools/lib/oneFile.test.ts
 * @see tools/cmd/html.ts
 */
import { join } from 'node:path';
import type { Rollup } from 'vite';

/** The file, from the repository root. */
export const ONE_FILE = 'playground.html';

/** The page it is built from. */
export const ONE_FILE_PAGE = 'labs/playground/index.html';

/** The note the file opens its head with. */
export const ONE_FILE_NOTE = `<!-- ${ONE_FILE}: the my-3dge playground as one self-contained page (https://github.com/michaelcrosato/my-3dge, MIT; it carries three.js, MIT, Rapier, Apache-2.0, and @stdlib functions, Apache-2.0: see lean/LICENSE). Open it in a browser with WebGPU. Written by node x html --write from ${ONE_FILE_PAGE}; never edit it by hand. -->`; // prettier-ignore

/** A module script or stylesheet Vite's page loads from a file. */
const LOADED = /<script type="module" crossorigin src="([^"]+)"><\/script>|<link rel="stylesheet" crossorigin href="([^"]+)">/g; // prettier-ignore

/**
 * The page `html` with each script and stylesheet it loads put inline, from `files` (by file name; a reference
 * matches the file whose name it ends with), and `ONE_FILE_NOTE` after its charset. Throws, naming the file, when a
 * reference has no file or a script holds a `<!--`.
 */
export function inlineBuild(html: string, files: Readonly<Record<string, string>>): string {
  const find = (ref: string): string => {
    const name = Object.keys(files).find((file) => ref.endsWith(`/${file}`) || ref === file || ref === `./${file}`);
    if (name === undefined) throw new Error(`${ref} is not in the build: the page loads a file Vite did not write`);
    return files[name];
  };
  const inlined = html.replace(LOADED, (_tag, script?: string, style?: string) => {
    if (style) return `<style>${find(style)}</style>`;
    const code = find(script!).replaceAll('</script', '<\\/script');
    if (code.includes('<!--')) {
      throw new Error(`${script} holds "<!--", which an inline script cannot: write it apart ('<' + '!--') in the source`); // prettier-ignore
    }
    return `<script type="module">${code}</script>`;
  });
  return inlined.replace('<meta charset="utf-8" />', (charset) => `${charset}\n    ${ONE_FILE_NOTE}`);
}

/** The `src` and `href` attributes of `html` that load something other than a data URL (none, in the one file). */
export function externalRefs(html: string): string[] {
  const outside = html.replace(/<script type="module">[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
  return [...outside.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((match) => match[1]).filter((ref) => !ref.startsWith('data:')); // prettier-ignore
}

/** Builds the one file from the repository at `root` and returns its text (about 7 MB; about 11 s). */
export async function buildOneFile(root: string): Promise<string> {
  const { build } = await import('vite');
  const result = await build({
    root,
    configFile: false,
    logLevel: 'warn',
    base: './',
    resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
    build: {
      write: false,
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: () => true,
      chunkSizeWarningLimit: Infinity,
      rollupOptions: { input: { playground: join(root, ONE_FILE_PAGE) }, output: { inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const files: Record<string, string> = {};
  let html: string | undefined;
  for (const item of outputs.flatMap((output) => output.output)) {
    const text = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source); // prettier-ignore
    if (item.fileName.endsWith('.html')) html = text;
    else files[item.fileName] = text;
  }
  if (html === undefined) throw new Error(`Vite wrote no page from ${ONE_FILE_PAGE}: check that it exists`);
  return inlineBuild(html, files);
}
