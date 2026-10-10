/**
 * @file The path checks of `x docs` (PLAN.md §8.12, WP 0.6): every path, source citation and name that the file and
 * export comments, AGENTS.md, README.md and the Markdown under `docs/` mention must exist.
 *
 * What is checked, per line:
 * - **repository paths**, written from the root: tokens starting `engine/`, `labs/`, `data/`, `fixtures/`,
 *   `scripts/`, `tools/`, `tests/`, `docs/`, `evals/`, `.claude/` or `node_modules/`, with an optional `:line` or
 *   `:from-to` (checked against the file's length). `{a,b}` and `<a|b>` expand to each; a segment holding a
 *   placeholder (`<kind>`, `*`, `NNNN`, `…`) checks its directory instead;
 * - **Markdown links** in the docs, relative to the document;
 * - **source citations**, `my-3d2dge:<path>[:line]` and `shardfall:<path>[:line]`, against the checkouts at
 *   `$MY3D2DGE_SRC` and `$SHARDFALL_SRC` (resolved as tools/lib/source.ts does, never cloned here: an unresolved
 *   source is a warning that names `node x src`);
 * - **names**: `node x <cmd>` and `` `x <cmd>` `` need `tools/cmd/<cmd>.ts` (prose such as "node x or npm" is
 *   skipped); `npm run <script>` needs the script.
 *
 * A path or command that does not exist yet passes while a work package still to come plans it: PLAN.md §9 names it
 * in the **Owns** of a WP whose §14 status is not `done` (or it sits inside a directory one owns), or §6.2's layout
 * lists it. Once that WP is done, the path must exist.
 *
 * Not checked: `DOCTRINE.md`, `docs/research/`, `docs/reference/`, `docs/escalations/` (point-in-time records), the
 * generated INDEX, API and ERRORS (checked through the comments they come from), and `@example` blocks, which are
 * proved by running them.
 *
 * @example
 * import { readModules } from './docs';
 * const { failures } = checkPaths(process.cwd(), readModules(process.cwd()), { sources: {} }); // [] when all exist
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Finding } from './report';
import { resolveSource, sourceSpecs } from './source';
import { walk, type DocComment, type ModuleDoc } from './docs';

/** The documents the path checks read besides the code comments. */
export function coveredDocs(root: string): string[] {
  const skipped = ['docs/research/', 'docs/reference/', 'docs/escalations/'];
  const generated = ['docs/INDEX.md', 'docs/API.md', 'docs/ERRORS.md'];
  const docs = walk(root, 'docs').filter(
    (file) => file.endsWith('.md') && !skipped.some((dir) => file.startsWith(dir)) && !generated.includes(file),
  );
  return [...['AGENTS.md', 'README.md'].filter((file) => existsSync(join(root, file))), ...docs];
}

/** Top-level directories whose paths the checks recognise in prose. */
const TOPS = [
  'engine',
  'labs',
  'data',
  'fixtures',
  'scripts',
  'tools',
  'tests',
  'docs',
  'evals',
  '\\.claude',
  'node_modules',
];
const PATH = new RegExp(`(?<![\\w./:@~\\\\-])((?:${TOPS.join('|')})/[\\w.@+/<>|{},*…-]*)(?::(\\d+)(?:-(\\d+))?)?`, 'g');
const CITATION = /(?<![\w/.-])(my-3d2dge|shardfall):([\w.@+/-]+?)(?::(\d+)(?:-(\d+))?)?(?=[\s`'"),;\]]|\.(?:\s|$)|$)/g;
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const COMMAND = /(?:\bnode x |`x )(?!(?:or|and|the|to|a|an|is|as|with|commands?)\b)([a-z][\w-]*)/g;
const SCRIPT = /\bnpm run ([\w:-]+)/g;
const PLACEHOLDER = /[<*…]|(?<![A-Za-z])N{2,}(?![A-Za-z])/;

/** Expands `{a,b}` and `<a|b>` into every alternative. */
export function expand(path: string): string[] {
  const match = /\{([^{}]*,[^{}]*)\}|<([^<>]*\|[^<>]*)>/.exec(path);
  if (!match) return [path];
  const choices = (match[1] ?? match[2]).split(match[1] !== undefined ? ',' : '|');
  return choices.flatMap((choice) =>
    expand(path.slice(0, match.index) + choice.trim() + path.slice(match.index + match[0].length)),
  );
}

/** The part of a path to check: the whole path, or the directory above its first placeholder segment. */
export function checkable(path: string): string {
  const cut = path.search(PLACEHOLDER);
  return cut < 0 ? path : path.slice(0, path.lastIndexOf('/', cut) + 1);
}

/** The paths PLAN.md plans: the Owns of WPs not yet done, and §6.2's layout. */
export interface Planned {
  owned: string[];
  layout: string[];
}

/** Reads the planned paths from PLAN.md under `root` (none when it is missing). */
export function readPlanned(root: string): Planned {
  const file = join(root, 'PLAN.md');
  if (!existsSync(file)) return { owned: [], layout: [] };
  const lines = readFileSync(file, 'utf8').split('\n');
  const status = new Map<string, string>();
  for (const line of lines) {
    const row = /^\| (\d+\.\d+) \|[^|]*\|[^|]*\| ([^|]+?) \|/.exec(line);
    if (row) status.set(row[1], row[2]);
  }
  const owned: string[] = [];
  let wp: string | undefined;
  for (const line of lines) {
    if (line.startsWith('#')) wp = /^#### WP-(\d+\.\d+) /.exec(line)?.[1];
    if (!wp || !line.startsWith('- **Owns:**') || status.get(wp) === 'done') continue;
    for (const [, token] of line.matchAll(/`([^`]+)`/g)) owned.push(...expand(token));
  }
  const layout: string[] = [];
  const start = lines.findIndex((line) => line.startsWith('### 6.2 '));
  const open = lines.findIndex((line, i) => i > start && line.startsWith('```'));
  const stack: string[] = [];
  for (let i = open + 2; start >= 0 && i < lines.length && !lines[i].startsWith('```'); i++) {
    const indent = /^ */.exec(lines[i])?.[0].length ?? 0;
    const depth = indent / 2;
    const content = lines[i].trim();
    if (!Number.isInteger(depth) || depth < 1 || depth > stack.length + 1 || content.startsWith('(')) continue;
    const names = content
      .split(/\s{3,}/)[0]
      .split(/\s+/)
      .filter((token) => /^[\w.@*<>-]+(\/[\w.@*<>-]+)*\/?$/.test(token));
    stack.length = depth - 1;
    layout.push(...names.map((name) => stack.join('') + name));
    if (names.length === 1 && names[0].endsWith('/')) stack.push(names[0]);
  }
  return { owned, layout };
}

/**
 * Whether `planned` covers `path` (a file, or a directory ending in `/`): an entry names it or lies inside it, or,
 * for an owned directory (`labs/hello/`, `engine/world/level/**`, `tests/replays/box-1-*.json`), it lies inside one.
 */
export function isPlanned(path: string, planned: Planned): boolean {
  const dir = path.endsWith('/') ? path : `${path}/`;
  const names = (entry: string) => entry === path || entry.startsWith(dir);
  const holds = (entry: string) => checkable(entry).endsWith('/') && path.startsWith(checkable(entry));
  return planned.owned.some((entry) => names(entry) || holds(entry)) || planned.layout.some(names);
}

/** Options for `checkPaths`. */
export interface PathOptions {
  /** Source checkouts by name (`my-3d2dge`, `shardfall`); by default resolved from scripts/setup.sh, never cloned. */
  sources?: Record<string, string | undefined>;
  /** Planned paths; by default read from PLAN.md. */
  planned?: Planned;
}

/** The source checkouts, as tools/lib/source.ts resolves them, without cloning. */
function defaultSources(root: string): Record<string, string | undefined> {
  try {
    return Object.fromEntries(
      sourceSpecs(root).map((spec) => {
        const resolved = resolveSource(spec, { root, clone: false });
        return [spec.name, resolved.ok ? resolved.path : undefined];
      }),
    );
  } catch {
    return {};
  }
}

const lineCount = (file: string) => readFileSync(file, 'utf8').split('\n').length;

/** The lines of a doc comment to scan: its raw rows, with `@example` blocks blanked (they are run instead). */
function commentRows(doc: DocComment): string[] {
  const rows = doc.raw.split('\n');
  doc.tags.forEach((tag, i) => {
    if (tag.name !== 'example') return;
    const end = (doc.tags[i + 1]?.line ?? doc.line + rows.length) - doc.line;
    for (let row = tag.line - doc.line; row < end && row < rows.length; row++) rows[row] = '';
  });
  return rows;
}

/** Checks every path, citation and name the comments of `modules` and the covered docs mention. */
export function checkPaths(
  root: string,
  modules: readonly ModuleDoc[],
  options: PathOptions = {},
): { failures: Finding[]; warnings: Finding[]; checked: number } {
  const planned = options.planned ?? readPlanned(root);
  const sources = options.sources ?? defaultSources(root);
  const scripts = existsSync(join(root, 'package.json'))
    ? Object.keys((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: object }).scripts ?? {})
    : [];
  const failures: Finding[] = [];
  const unresolved = new Map<string, number>();
  let checked = 0;
  const fail = (id: string, message: string, file: string, line: number) => failures.push({ id, message, file, line });
  const exists = (path: string) => existsSync(join(root, path));
  const lineOk = (file: string, from?: string, to?: string) =>
    !from || !statSync(file).isFile() || Number(to ?? from) <= lineCount(file);

  const scan = (text: string, file: string, line: number, markdown: boolean) => {
    for (const match of text.matchAll(PATH)) {
      const token = match[1].replace(/[.,;:)…]+$/, '');
      for (const path of expand(token)) {
        const target = checkable(path);
        checked++;
        if (!exists(target) && !isPlanned(target, planned)) {
          fail(
            'DOCS_PATH',
            `${path} does not exist, and no WP still to come plans it: fix the path or remove it`,
            file,
            line,
          );
        } else if (target === path && exists(path) && !lineOk(join(root, path), match[2], match[3])) {
          fail('DOCS_PATH', `${path}:${match[2]}${match[3] ? `-${match[3]}` : ''} is past the file's end`, file, line);
        }
      }
    }
    if (markdown) {
      for (const [, raw] of text.matchAll(LINK)) {
        if (/^[a-z][\w+.-]*:|^#/i.test(raw)) continue;
        const path = posix.normalize(posix.join(posix.dirname(file), decodeURI(raw.replace(/#.*$/, ''))));
        checked++;
        if (!exists(path) && !isPlanned(path, planned))
          fail('DOCS_LINK', `the link to ${raw} is broken (${path})`, file, line);
      }
    }
    for (const match of text.matchAll(CITATION)) {
      const [, name, path, from, to] = match;
      checked++;
      const base = sources[name];
      if (!base) {
        unresolved.set(name, (unresolved.get(name) ?? 0) + 1);
        continue;
      }
      const target = join(base, checkable(path));
      if (!existsSync(target))
        fail('DOCS_CITATION', `${name}:${path} does not exist in ${name}'s pinned checkout`, file, line);
      else if (!lineOk(target, from, to))
        fail('DOCS_CITATION', `${match[0]} is past the end of ${name}:${path}`, file, line);
    }
    for (const [, command] of text.matchAll(COMMAND)) {
      const path = `tools/cmd/${command}.ts`;
      checked++;
      if (!exists(path) && !isPlanned(path, planned))
        fail('DOCS_NAME', `there is no command x ${command} (${path})`, file, line);
    }
    for (const [, script] of text.matchAll(SCRIPT)) {
      checked++;
      if (!scripts.includes(script))
        fail('DOCS_NAME', `package.json has no script "${script}" (npm run ${script})`, file, line);
    }
  };

  for (const module of modules) {
    const comments = [module.fileComment, ...module.exports.map((item) => item.doc)].filter((doc) => doc !== undefined);
    const lines = new Set<number>();
    for (const doc of comments) {
      if (lines.has(doc.line)) continue;
      lines.add(doc.line);
      commentRows(doc).forEach((row, i) => scan(row, module.path, doc.line + i, false));
    }
  }
  for (const file of coveredDocs(root)) {
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .forEach((row, i) => scan(row, file, i + 1, true));
  }
  const warnings = [...unresolved].map(([name, count]) => ({
    id: 'DOCS_SOURCE_DEFERRED',
    message: `${count} citation${count === 1 ? '' : 's'} of ${name} not checked: its checkout is unresolved (node x src)`,
  }));
  return { failures, warnings, checked };
}
