/**
 * @file Reads the manual out of the code (PLAN.md §6.8, WP 0.6): each module's file comment, its exports with their
 * doc comments, its `@example` blocks, its tests and the codes it registers, through the TypeScript compiler API.
 * `x docs` builds INDEX, API and ERRORS from this, and checks it for drift.
 *
 * Modules are the `.ts`, `.js` and `.mjs` files under `engine/`, `tools/`, `labs/` and `tests/` (where ESLint
 * requires file comments), plus the root's `*.config.{ts,js}`; tests (`*.test.ts`, `*.spec.ts`), any `fixtures/`
 * directory (test-only content) and `tools/templates/` are left out. A module's tests are the ones beside it
 * (`name.test.ts`, `name.spec.ts`) and the test files its file comment names with `@see`.
 *
 * Codes are read by tools/lib/docsCodes.ts, whose file comment gives the form `defineCodes` calls are written in.
 *
 * Invariants: reading never runs a module (examples run in tools/lib/docsExamples.ts). Paths are repository-relative
 * with `/`. Lists come out sorted, so generated docs are stable.
 *
 * @example
 * const doc = readModule(process.cwd(), 'tools/lib/hash.ts');
 * doc.exports.map((item) => item.name); // ['fnv1a', 'fnv1aHex']
 * doc.tests; // ['tools/lib/hash.test.ts']
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { firstSentence } from '../x';
import { codesOf, type CodeDoc } from './docsCodes';

/** One `@tag` of a doc comment, its text as written (indentation kept), and its 1-based line in the file. */
export interface DocTag {
  name: string;
  text: string;
  line: number;
}

/** A parsed JSDoc comment. */
export interface DocComment {
  /** The prose before the first tag; for a file comment, the `@file` text. */
  description: string;
  tags: DocTag[];
  /** 1-based line of the comment's first line. */
  line: number;
  /** How many lines the comment spans. */
  lines: number;
  /** The comment as written, markers included. */
  raw: string;
}

/** One export of a module. */
export interface ExportDoc {
  name: string;
  /** `function`, `class`, `interface`, `type`, `const`, `let`, `var`, `enum`, `namespace`, `default` or `re-export`. */
  kind: string;
  line: number;
  /** Its own doc comment (for a re-export, the comment on the `export … from` statement, if any). */
  doc?: DocComment;
  /** For a re-export: the module specifier it comes from. */
  from?: string;
  /** For a re-export: the name in the module it comes from (`*` for `export * from`). */
  imported?: string;
}

/** One `@example` block. */
export interface Example {
  module: string;
  /** 1-based line of the `@example` tag. */
  line: number;
  code: string;
  /** Flagged for T2 instead of run in Node, and why. */
  browser?: string;
}

/** Everything `x docs` knows about one module. */
export interface ModuleDoc {
  path: string;
  fileComment?: DocComment;
  /** The first sentence of the file comment ('' without one). */
  purpose: string;
  exports: ExportDoc[];
  examples: Example[];
  tests: string[];
  codes: CodeDoc[];
  /** The module specifiers it imports or re-exports from. */
  imports: string[];
}

/** The directories whose code files are modules. */
export const MODULE_ROOTS = ['engine', 'tools', 'labs', 'tests'];
/** Page-side directories: their examples need a browser (T2). */
const BROWSER_DIRS = ['labs/', 'tests/e2e/', 'tests/pages/'];
/** Packages whose importers drive a browser, so their examples run in T2. */
const BROWSER_PACKAGES = ['playwright', 'playwright-core', '@playwright/test'];
const CODE_FILE = /\.(ts|js|mjs)$/;
const TEST_FILE = /\.(test|spec)\.ts$/;
const FILE_TAGS = ['file', 'fileoverview', 'overview'];

/** Whether a repository-relative path is a module (not a test, fixture, template or declaration file). */
export function isModulePath(path: string): boolean {
  if (!CODE_FILE.test(path) || TEST_FILE.test(path) || path.endsWith('.d.ts')) return false;
  if (path.split('/').includes('fixtures') || path.startsWith('tools/templates/')) return false;
  if (!path.includes('/')) return /\.config\.(ts|js)$/.test(path);
  return MODULE_ROOTS.includes(path.split('/')[0]);
}

/** Every file under `dir` (repository-relative, sorted), skipping `node_modules` and dot-directories. */
export function walk(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(root, path);
      return entry.isFile() ? [path] : [];
    })
    .sort();
}

/** The repository's modules, sorted. */
export function listModules(root: string): string[] {
  const top = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  return [...top, ...MODULE_ROOTS.flatMap((dir) => walk(root, dir))].filter(isModulePath).sort();
}

/** 1-based line of character `index` in `text`. */
export const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Parses the raw text of a JSDoc comment that starts on `line`. */
export function parseDocComment(raw: string, line: number): DocComment {
  const rows = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((row, i) => (i === 0 ? row.trim() : row.replace(/^\s*\*? ?/, '').replace(/\s+$/, '')));
  const description: string[] = [];
  const tags: DocTag[] = [];
  rows.forEach((row, i) => {
    const tag = /^@(\w+)\s?(.*)$/.exec(row);
    if (tag) tags.push({ name: tag[1], text: tag[2], line: line + i });
    else if (tags.length) tags[tags.length - 1].text += `\n${row}`;
    else description.push(row);
  });
  for (const tag of tags) tag.text = tag.text.replace(/^\s*\n/, '').replace(/\s+$/, '');
  const file = tags.find((tag) => FILE_TAGS.includes(tag.name));
  const prose = [description.join('\n').trim(), file?.text ?? ''].filter(Boolean).join('\n\n');
  return { description: prose, tags, line, lines: rows.length, raw };
}

/** The doc comment directly before `node`: the last JSDoc comment among its leading comments. */
function docBefore(source: ts.SourceFile, node: ts.Node): DocComment | undefined {
  const text = source.text;
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = ranges.filter((range) => text.startsWith('/**', range.pos) && text[range.pos + 3] !== '/').pop();
  if (!last) return undefined;
  const doc = parseDocComment(text.slice(last.pos, last.end), lineOf(text, last.pos));
  return doc.tags.some((tag) => FILE_TAGS.includes(tag.name)) ? undefined : doc;
}

/** The file comment: the first leading JSDoc comment of the file that has an `@file` tag. */
function fileCommentOf(text: string): DocComment | undefined {
  const start = ts.getShebang(text)?.length ?? 0;
  for (const range of ts.getLeadingCommentRanges(text, start) ?? []) {
    if (!text.startsWith('/**', range.pos)) continue;
    const doc = parseDocComment(text.slice(range.pos, range.end), lineOf(text, range.pos));
    if (doc.tags.some((tag) => FILE_TAGS.includes(tag.name))) return doc;
  }
  return undefined;
}

const hasExport = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const hasDefault = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

/** The exports a parsed module declares (overloads once), and the specifiers it imports from. */
function exportsOf(source: ts.SourceFile): { exports: ExportDoc[]; imports: string[] } {
  const exports: ExportDoc[] = [];
  const imports: string[] = [];
  const line = (node: ts.Node) => lineOf(source.text, node.getStart(source));
  const add = (name: string, kind: string, node: ts.Node, extra: Partial<ExportDoc> = {}) => {
    const known = exports.find((item) => item.name === name);
    const doc = docBefore(source, node);
    if (known) known.doc ??= doc;
    else exports.push({ name, kind, line: line(node), doc, ...extra });
  };
  const KINDS: [(node: ts.Node) => boolean, string][] = [
    [ts.isFunctionDeclaration, 'function'],
    [ts.isClassDeclaration, 'class'],
    [ts.isInterfaceDeclaration, 'interface'],
    [ts.isTypeAliasDeclaration, 'type'],
    [ts.isEnumDeclaration, 'enum'],
    [ts.isModuleDeclaration, 'namespace'],
  ];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement)) {
      const from =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (from) imports.push(from);
      const clause = statement.exportClause;
      if (!clause) add(`* from '${from}'`, 're-export', statement, { from, imported: '*' });
      else if (ts.isNamespaceExport(clause)) add(clause.name.text, 're-export', statement, { from, imported: '*' });
      else {
        for (const item of clause.elements) {
          const imported = (item.propertyName ?? item.name).text;
          add(item.name.text, 're-export', statement, { from, imported });
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      add('default', 'default', statement);
    } else if (ts.isVariableStatement(statement) && hasExport(statement)) {
      const flags = statement.declarationList.flags;
      const kind = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, kind, statement);
      }
    } else if (hasExport(statement)) {
      const kind = KINDS.find(([test]) => test(statement))?.[1] ?? 'value';
      const name = (statement as ts.DeclarationStatement).name;
      add(hasDefault(statement) ? 'default' : name && ts.isIdentifier(name) ? name.text : 'default', kind, statement);
    }
  }
  return { exports: exports.sort((a, b) => a.name.localeCompare(b.name, 'en')), imports };
}

/** Parses a file with the TypeScript compiler (no type checking). */
export function parse(root: string, path: string): ts.SourceFile {
  const text = readFileSync(join(root, path), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/** Why a module's examples need a browser, or undefined when they run in Node. */
function browserReason(path: string, imports: readonly string[]): string | undefined {
  const dir = BROWSER_DIRS.find((prefix) => path.startsWith(prefix));
  if (dir) return `page code (${dir})`;
  const pkg = imports.find((name) => BROWSER_PACKAGES.includes(name));
  return pkg ? `it imports ${pkg}` : undefined;
}

/** Reads one module. */
export function readModule(root: string, path: string): ModuleDoc {
  const source = parse(root, path);
  const fileComment = fileCommentOf(source.text);
  const { exports, imports } = exportsOf(source);
  const pageSide = browserReason(path, imports);
  const comments = [fileComment, ...exports.map((item) => item.doc)].filter((doc) => doc !== undefined);
  const examples = comments.flatMap((doc) =>
    doc.tags
      .filter((tag) => tag.name === 'example')
      .map((tag) => {
        const code = tag.text.replace(/^\s*<caption>.*?<\/caption>/, '').replace(/^\s*\n/, '');
        const marked = /^\s*\/\/\s*browser\b/.test(code) ? 'marked // browser' : undefined;
        return { module: path, line: tag.line, code, browser: marked ?? pageSide };
      }),
  );
  const base = path.replace(CODE_FILE, '');
  const beside = [`${base}.test.ts`, `${base}.spec.ts`].filter((file) => existsSync(join(root, file)));
  const seen = (fileComment?.tags ?? [])
    .filter((tag) => tag.name === 'see')
    .map((tag) => tag.text.trim().split(/\s/)[0])
    .filter((file) => TEST_FILE.test(file) && existsSync(join(root, file)));
  return {
    path,
    fileComment,
    purpose: fileComment ? firstSentence(fileComment.description) : '',
    exports,
    examples: examples.filter((example, i) => examples.findIndex((other) => other.line === example.line) === i),
    tests: [...new Set([...beside, ...seen])].sort(),
    codes: codesOf(source, path),
    imports,
  };
}

/** Reads every module of the repository at `root`. */
export function readModules(root: string): ModuleDoc[] {
  return listModules(root).map((path) => readModule(root, path));
}

/** Resolves a relative specifier from `from` to a repository file (extensionless, as Vite and tsx resolve). */
export function resolveSpecifier(root: string, from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier)).replace(/\.js$/, '');
  const candidates = [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`];
  return candidates.find((file) => CODE_FILE.test(file) && existsSync(join(root, file)));
}

/** One export of a module, followed through re-exports to where it is declared. */
export interface ResolvedExport {
  name: string;
  /** The module that declares it, or the package it comes from. */
  declaredIn: string;
  line: number;
  kind: string;
  /** The doc comment at its declaration, else on the `export … from` statement that publishes it. */
  doc?: DocComment;
}

/** The exports of a module (a barrel such as engine/index.ts), each followed through re-exports to its declaration. */
export function resolveExports(root: string, barrel: string, seen = new Set<string>()): ResolvedExport[] {
  if (seen.has(barrel)) return [];
  seen.add(barrel);
  const result: ResolvedExport[] = [];
  const { exports } = exportsOf(parse(root, barrel));
  for (const item of exports) {
    if (item.kind !== 're-export' || !item.from) {
      result.push({ name: item.name, declaredIn: barrel, line: item.line, kind: item.kind, doc: item.doc });
      continue;
    }
    const target = resolveSpecifier(root, barrel, item.from);
    const own = { declaredIn: target ?? item.from, line: item.line, kind: 're-export', doc: item.doc };
    if (!target) {
      result.push({ name: item.name, ...own });
      continue;
    }
    const inner = resolveExports(root, target, new Set(seen));
    const star = item.imported === '*' && item.name.startsWith('* from');
    if (star) result.push(...inner.filter((candidate) => candidate.name !== 'default'));
    else if (item.imported === '*') result.push({ name: item.name, ...own, declaredIn: target });
    else {
      const found = inner.find((candidate) => candidate.name === item.imported);
      result.push(found ? { ...found, name: item.name, doc: found.doc ?? item.doc } : { name: item.name, ...own });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** The directory of a repository-relative path ('' for the root). */
export const directoryOf = (path: string) => (path.includes('/') ? dirname(path) : '');
