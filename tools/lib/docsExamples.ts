/**
 * @file Runs the `@example` blocks of file and export comments in Node (PLAN.md §8.12, WP 0.6): `x docs --check`
 * runs them, and so does `tests/unit/examples.test.ts` in T1. An example that throws, rejects or times out fails.
 *
 * How an example runs: TypeScript transpiles it (type annotations are fine), its `import` lines become dynamic
 * imports resolved from its module's directory, and it runs as the body of an async function whose parameters are
 * its module's named exports, so it calls them by name as a reader would (`fnv1aHex('hello')`). Top-level `await`
 * works. `console.log`, `info` and `debug` are captured, not printed; warnings stay visible, so in T1 the advice
 * trap still sees them. Write each example as code that runs on this repository as it is, offline: an expected
 * value goes in a trailing comment.
 *
 * Browser examples are flagged for T2 instead of run: those of page code (`labs/`, `tests/e2e/`, `tests/pages/`), of
 * modules that import Playwright, and any whose first line is a `// browser` comment.
 *
 * Invariants: examples run one at a time, in module order, each with a time limit (`EXAMPLE_TIMEOUT_MS`).
 *
 * @example
 * const [hash] = collectExamples(process.cwd()).filter((example) => example.module === 'tools/lib/hash.ts');
 * const outcome = await runExample(process.cwd(), hash); // { ok: true, ms: … }
 * @see tests/unit/examples.test.ts
 * @see tools/cmd/docs.test.ts
 */
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { readModules, resolveSpecifier, type Example, type ModuleDoc } from './docs';

/** The longest an example may run, in milliseconds. */
export const EXAMPLE_TIMEOUT_MS = 20_000;

/** How one example went. */
export interface ExampleOutcome {
  ok: boolean;
  ms: number;
  /** Why it failed: the error's first line. */
  error?: string;
  /** What it printed through `console.log`, `info` and `debug`. */
  printed: string[];
}

/** Every example of the repository's modules (or of `modules`), in module order. */
export function collectExamples(root: string, modules: readonly ModuleDoc[] = readModules(root)): Example[] {
  return modules.flatMap((module) => module.examples);
}

/** Rewrites the `import` declarations of transpiled JavaScript into `await __import(…)` lines. */
export function rewriteImports(js: string): string {
  const source = ts.createSourceFile('example.js', js, ts.ScriptTarget.Latest, true);
  let out = '';
  let at = 0;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = JSON.stringify(statement.moduleSpecifier.text);
    const clause = statement.importClause;
    const parts: string[] = [];
    if (clause?.name) parts.push(`default: ${clause.name.text}`);
    const bindings = clause?.namedBindings;
    let line = '';
    if (bindings && ts.isNamespaceImport(bindings)) {
      line = `const ${bindings.name.text} = await __import(${from});`;
      if (parts.length) line += ` const { ${parts.join(', ')} } = ${bindings.name.text};`;
    } else {
      for (const item of bindings?.elements ?? []) {
        parts.push(item.propertyName ? `${item.propertyName.text}: ${item.name.text}` : item.name.text);
      }
      line = parts.length ? `const { ${parts.join(', ')} } = await __import(${from});` : `await __import(${from});`;
    }
    out += js.slice(at, statement.getStart(source)) + line;
    at = statement.end;
  }
  return out + js.slice(at);
}

/** Transpiles an example (TypeScript allowed) to the JavaScript body `runExample` executes. */
export function compileExample(code: string): string {
  const { outputText, diagnostics } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
    reportDiagnostics: true,
  });
  const error = diagnostics?.find((item) => item.category === ts.DiagnosticCategory.Error);
  if (error) throw new SyntaxError(ts.flattenDiagnosticMessageText(error.messageText, ' '));
  return rewriteImports(outputText);
}

const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => unknown;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const CAPTURED = ['log', 'info', 'debug'] as const;

/** Runs one example in this process; never throws. */
export async function runExample(
  root: string,
  example: Example,
  timeoutMs: number = EXAMPLE_TIMEOUT_MS,
): Promise<ExampleOutcome> {
  const started = performance.now();
  const printed: string[] = [];
  const saved = CAPTURED.map((level) => console[level]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = compileExample(example.code);
    const file = join(root, example.module);
    const module = (await import(file)) as Record<string, unknown>;
    const names = Object.keys(module).filter((name) => name !== 'default' && IDENTIFIER.test(name));
    const importFrom = (specifier: string) => {
      const target = resolveSpecifier(root, example.module, specifier);
      if (specifier.startsWith('.') && !target) throw new Error(`cannot resolve "${specifier}" from ${dirname(file)}`);
      return import(target ? join(root, target) : specifier);
    };
    const run = new AsyncFunction(...names, '__import', `{\n${body}\n}`);
    CAPTURED.forEach(
      (level) => (console[level] = (...args: unknown[]) => void printed.push(args.map(String).join(' '))),
    );
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`it ran past ${timeoutMs} ms`)), timeoutMs);
    });
    await Promise.race([run(...names.map((name) => module[name]), importFrom), limit]);
    return { ok: true, ms: Math.round(performance.now() - started), printed };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, ms: Math.round(performance.now() - started), error: message.split('\n')[0], printed };
  } finally {
    clearTimeout(timer);
    CAPTURED.forEach((level, i) => (console[level] = saved[i]));
  }
}

/** The examples' verdicts: Node examples run in order; browser examples are listed for T2. */
export async function runExamples(
  root: string,
  examples: readonly Example[],
): Promise<{ example: Example; outcome?: ExampleOutcome }[]> {
  const results: { example: Example; outcome?: ExampleOutcome }[] = [];
  for (const example of examples) {
    results.push({ example, outcome: example.browser ? undefined : await runExample(root, example) });
  }
  return results;
}
