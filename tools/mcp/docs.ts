/**
 * @file The MCP bridge's `docs_lookup` (PLAN.md §8.11, WP 7.6): the manual that `x docs` generates, for an agent that
 * reads no files. A name is looked up in the order an agent writes them:
 * - an error or advice code (`DEV_BAD_ARGS`): its section of docs/ERRORS.md, message, fix and where it is raised;
 * - a module path (`engine/app/headless.ts`, the extension optional): its file comment, its exports and its tests;
 * - an export (`createHeadless`): its doc comment as written, from each module that declares it, as docs/API.md
 *   indexes them (a re-export is followed to its declaration).
 * Nothing found answers the closest names among the exports and the modules.
 *
 * Invariants: it reads docs/API.md, docs/ERRORS.md and the modules' comments (tools/lib/docs.ts), never runs a
 * module; an answer names its files from the repository root, so an agent that can read them finds the rest there.
 *
 * @example
 * docsLookup(process.cwd(), 'DEV_NO_RENDERER').split('\n')[0]; // '### DEV_NO_RENDERER (docs/ERRORS.md)'
 * docsLookup(process.cwd(), 'fnv1aHex').split('\n')[0]; // '`fnv1aHex` (function, tools/lib/hash.ts:…)'
 * @see tools/mcp/tools.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isModulePath, readModule } from '../lib/docs';
import { closest } from '../x';

/** A code as docs/ERRORS.md heads its section. */
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** A doc comment's text without its markers. */
const unmark = (raw: string) =>
  raw
    .replace(/^\/\*\*\s?/, '')
    .replace(/\s*\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();

/** Each export docs/API.md lists, with the modules that declare it. */
function apiIndex(root: string): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  let section = '';
  for (const line of readFileSync(join(root, 'docs', 'API.md'), 'utf8').split('\n')) {
    const heading = /^### \[`([^`]+)`\]/.exec(line);
    if (heading) section = heading[1];
    const item = /^- `([^`]+)` \([\w-]+(?: from \[`([^`]+)`\])?/.exec(line);
    if (!item) continue;
    const declared = item[2] ?? section;
    if (declared.startsWith('engine/index.ts') || declared.startsWith('engine/sim-api.ts')) continue;
    if (!index.has(item[1])) index.set(item[1], new Set());
    index.get(item[1])!.add(declared);
  }
  return index;
}

/** The section docs/ERRORS.md gives `code`, or undefined. */
function codeSection(root: string, code: string): string | undefined {
  const text = readFileSync(join(root, 'docs', 'ERRORS.md'), 'utf8');
  const start = text.indexOf(`\n### ${code}\n`);
  if (start < 0) return undefined;
  const end = text.slice(start + 1).search(/\n##+ /);
  const body = text.slice(start + 1, end < 0 ? undefined : start + 1 + end).trim();
  return body.replace(`### ${code}`, `### ${code} (docs/ERRORS.md)`).replace(/\]\(\.\.\//g, '](');
}

/** A module's file comment, exports and tests. */
function moduleText(root: string, path: string): string {
  const doc = readModule(root, path);
  const exports = doc.exports.map((item) => item.name).join(', ') || 'none';
  const tests = doc.tests.join(', ') || 'none';
  const comment = doc.fileComment ? unmark(doc.fileComment.raw).replace(/^@file\s*/, '') : '(no file comment)';
  return [path, comment, `Exports: ${exports}`, `Tests: ${tests}`].join('\n');
}

/** An export's doc comment in the module that declares it. */
function exportText(root: string, path: string, name: string): string | undefined {
  const item = readModule(root, path).exports.find((entry) => entry.name === name);
  if (!item) return undefined;
  return `\`${name}\` (${item.kind}, ${path}:${item.line})\n${item.doc ? unmark(item.doc.raw) : '(no doc comment)'}`;
}

/** The module path `name` names, with or without its extension; undefined when it names none. */
function modulePath(root: string, name: string): string | undefined {
  const path = name.replace(/^\.?\//, '');
  return [path, `${path}.ts`, `${path}/index.ts`].find((file) => isModulePath(file) && existsSync(join(root, file)));
}

/** What the docs say about `symbol` (see the file comment). */
export function docsLookup(root: string, symbol: string): string {
  const name = symbol.trim().replace(/^`|`$/g, '');
  if (CODE.test(name)) {
    const section = codeSection(root, name);
    if (section) return section;
  }
  const path = modulePath(root, name);
  if (path) return moduleText(root, path);
  const index = apiIndex(root);
  const texts = [...(index.get(name) ?? [])].map((file) => exportText(root, file, name)).filter(Boolean);
  if (texts.length) return texts.join('\n\n');
  const near = closest(name, [...index.keys()]);
  const hint = near ? `did you mean ${near}?` : 'name an export, an error code or a module path';
  return `the docs list no ${name}: ${hint} (an inspector member's help: engine_help)`;
}
