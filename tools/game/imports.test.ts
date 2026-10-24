/**
 * @file Unit tests: every file a game gets imports only files a game gets (PLAN.md WP 10.7, ADR-0024). A game made by
 * tools/game/new-game.mjs holds the engine's files and the starter, never the engine repository's own (fixtures/,
 * tests/ but its baselines, the playground: tools/game/files.mjs `RULES`; its package.json and root files are written
 * for it), so a static import from one into the other breaks the game's tsc and the command that imports it.
 * `node x engine --test` finds that in the full run, after the merge; this finds it in T1, from the import lines
 * alone. Comment lines are left out: doc examples may import the fixtures, since `x docs` runs them only here.
 * @see tools/game/files.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { plan, SOURCE } from './files.mjs';
import { TEMPLATES } from './new-game.mjs';

/** What every game holds besides the plan's files: package.json and its lock (`gamePackage`), and the root templates. */
const WRITTEN = ['package.json', 'package-lock.json', ...TEMPLATES.map(([, target]) => target)];

/** What a relative specifier may leave out: the extension, or a folder's index file. */
const ENDINGS = ['', '.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js', '/index.mjs'];
/** `import … from` and `export … from` at a line's start, side-effect imports, and dynamic imports of a literal. */
const IMPORTS = [
  /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** The relative specifiers `text` imports, its comment lines left out. */
function relativeImports(text: string): string[] {
  const code = text
    .split('\n')
    .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
    .join('\n');
  return IMPORTS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1])).filter((specifier) =>
    /^\.\.?\//.test(specifier),
  );
}

/** The repository file `specifier` names from `file`, or undefined when there is none. */
function resolveImport(file: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(file), specifier.split('?')[0]));
  return ENDINGS.map((ending) => base + ending).find((path) => {
    const at = join(SOURCE, path);
    return existsSync(at) && statSync(at).isFile();
  });
}

describe('the files a game gets', () => {
  it('import only files a game gets', () => {
    const items = plan();
    const gets = new Set([...items.map((item) => item.from), ...WRITTEN]);
    const wrong = items
      .filter(({ from }) => /\.m?[jt]s$/.test(from) && !/\.d\.m?ts$/.test(from))
      .flatMap(({ from }) =>
        relativeImports(readFileSync(join(SOURCE, from), 'utf8')).map((specifier) => {
          const target = resolveImport(from, specifier);
          return target && !gets.has(target) ? `${from} imports ${target}, which a game never gets` : '';
        }),
      )
      .filter(Boolean);
    expect(
      wrong,
      "import the engine repository's own files at run time, by path, where the checkout has them (tools/qa/level.ts), or move what a game needs into a folder it gets",
    ).toEqual([]);
  });

  it('reads the import lines, multi-line and dynamic ones too, and never a comment', () => {
    const text = [
      "import { a } from './a';",
      'import {',
      '  b,',
      "} from '../b';",
      "export { c } from './c';",
      "import './side';",
      "const d = await import('./d');",
      "import { e } from 'three/webgpu';",
      " * import f from '../../fixtures/f';",
      "// import g from './g';",
      "const h = 'from ./h';",
    ].join('\n');
    expect(relativeImports(text).sort()).toEqual(['../b', './a', './c', './d', './side']);
  });

  it('resolves a specifier to the file it names', () => {
    expect(resolveImport('tools/qa/level.ts', '../../engine/core/registry')).toBe('engine/core/registry.ts');
    expect(resolveImport('tools/qa/anim/points.ts', '../../../fixtures/rigs/biped')).toBe(
      'fixtures/rigs/biped/index.ts',
    );
    expect(resolveImport('tools/qa/level.ts', './nowhere')).toBeUndefined();
  });
});
