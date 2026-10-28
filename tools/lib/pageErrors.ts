/**
 * @file Page errors mapped to their sources (PLAN.md §8.1, §8.8): a browser's stack parsed into frames (`parseStack`),
 * each mapped to its `.ts` file and line through the inline source map Vite serves with the module (`mapStack`), and
 * an uncaught page error named by its first frame in the repository (`mapPageError`, `describePageError`), as
 * tools/lib/browser.ts's `preparePage` collects them. Split from browser.ts at its line cap.
 *
 * Invariants: a module that cannot be fetched or has no readable map leaves its frames as the browser gave them;
 * each module is fetched once a call; paths are repository-relative (`/@fs/` too), else the URL itself.
 *
 * @example
 * parseStack('Error: x\n    at boom (http://127.0.0.1:5173/tests/pages/demo.ts?t=1:4:9)'); // [{ fn: 'boom', url: 'http://127.0.0.1:5173/tests/pages/demo.ts?t=1', line: 4, column: 9 }]
 * servedPath('http://127.0.0.1:5173/@fs/repo/engine/a.ts', '/repo'); // 'engine/a.ts'
 * @see tools/lib/pageErrors.test.ts
 */
import { SourceMap } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, two levels above this file. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One frame of a stack, at its source position when a source map gave one. */
export interface SourceFrame {
  /** The function name the stack gave, when any. */
  fn?: string;
  /** The URL the browser ran. */
  url: string;
  /** Repository-relative source file (`tests/pages/harness.ts`), or the URL when it is not served from the repo. */
  file: string;
  /** 1-based line in `file`. */
  line: number;
  /** 1-based column in `file`. */
  column: number;
  /** Whether a source map moved the position. */
  mapped: boolean;
}

/** Splits a V8 stack into its frames' function names, URLs and 1-based positions. */
export function parseStack(stack: string): { fn?: string; url: string; line: number; column: number }[] {
  const frames = [];
  for (const raw of stack.split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(\S+?):(\d+):(\d+)\)?$/.exec(raw);
    if (match) frames.push({ fn: match[1], url: match[2], line: Number(match[3]), column: Number(match[4]) });
  }
  return frames;
}

/** The repository-relative path of a URL the dev server serves (`/@fs/…` included), or the URL itself. */
export function servedPath(url: string, root: string): string {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
  if (pathname.startsWith('/@fs/')) {
    const path = relative(root, pathname.slice(4));
    return path.startsWith('..') ? pathname.slice(4) : path;
  }
  return pathname.replace(/^\//, '');
}

/** The inline source map at the end of a served module, when it has one. */
function inlineSourceMap(code: string): SourceMap | undefined {
  const match = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(
    code,
  );
  if (!match) return undefined;
  return new SourceMap(JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')));
}

/**
 * Maps every frame of a browser stack to its source through the served modules' inline source maps. `fetchText`
 * fetches a module as the browser got it (by default `fetch`); modules are fetched once per call.
 */
export async function mapStack(
  stack: string,
  options: { root?: string; fetchText?: (url: string) => Promise<string> } = {},
): Promise<SourceFrame[]> {
  const root = options.root ?? ROOT;
  const fetchText = options.fetchText ?? (async (url: string) => (await fetch(url)).text());
  const maps = new Map<string, Promise<SourceMap | undefined>>();
  const frames: SourceFrame[] = [];
  for (const frame of parseStack(stack)) {
    const base = { fn: frame.fn, url: frame.url, line: frame.line, column: frame.column };
    if (!/^https?:/.test(frame.url)) {
      frames.push({ ...base, file: frame.url, mapped: false });
      continue;
    }
    const key = frame.url.replace(/[?#].*$/, '');
    if (!maps.has(key)) {
      // A module that cannot be fetched, or has no readable map, leaves its frames as the browser gave them.
      maps.set(
        key,
        fetchText(frame.url)
          .then(inlineSourceMap)
          .catch(() => undefined),
      );
    }
    const entry = (await maps.get(key))?.findEntry(frame.line - 1, frame.column - 1);
    if (entry && 'originalSource' in entry) {
      frames.push({
        ...base,
        file: servedPath(new URL(entry.originalSource, frame.url).href, root),
        line: entry.originalLine + 1,
        column: entry.originalColumn + 1,
        mapped: true,
      });
    } else {
      frames.push({ ...base, file: servedPath(frame.url, root), mapped: false });
    }
  }
  return frames;
}

/** A page error with its stack mapped to sources; `file`, `line` and `column` are its first repository frame. */
export interface PageError {
  message: string;
  stack: string;
  frames: SourceFrame[];
  file?: string;
  line?: number;
  column?: number;
}

/** One line for a page error: its message and where it was thrown (`tests/pages/harness.ts:12:9`). */
export function describePageError(error: PageError): string {
  return error.file ? `${error.message} (${error.file}:${error.line}:${error.column})` : error.message;
}

/** Maps one uncaught page error to its source frames. */
export async function mapPageError(error: Error, root: string = ROOT): Promise<PageError> {
  const stack = error.stack ?? String(error);
  const frames = await mapStack(stack, { root });
  const first =
    frames.find((frame) => !frame.file.includes('node_modules/') && !frame.file.startsWith('@')) ?? frames[0];
  const message = `${error.name}: ${error.message}`;
  return first
    ? { message, stack, frames, file: first.file, line: first.line, column: first.column }
    : { message, stack, frames };
}
