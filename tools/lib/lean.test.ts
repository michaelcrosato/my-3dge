/**
 * @file Unit tests for the lean package (tools/lib/lean.ts): the import map names every import lean/my3dge.js makes,
 * each URL it maps to jsDelivr's npm path is a file node_modules holds at the version package.json pins (so the CDN
 * serves the bytes the engine was built and tested against), and the generated blocks go between their markers. That
 * lean/ is current is `x docs --check`; that its page plays is tests/e2e/lean.spec.ts.
 * @see tools/lib/lean.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../x';
import { EXTERNAL, LEAN_URL, leanHead, leanImports, withBlock } from './lean';

/** The modules lean/my3dge.js imports: each import statement's specifier (at a line's start), and `import("…")`'s. */
function bundleImports(): string[] {
  const bundle = readFileSync(join(ROOT, 'lean/my3dge.js'), 'utf8');
  const statements = /^import\b[^;"]*?(?:\bfrom\s*)?"([^"]+)";/gm;
  const dynamic = /\bimport\(\s*"([^"]+)"\s*\)/g;
  const found = [...bundle.matchAll(statements), ...bundle.matchAll(dynamic)].map((match) => match[1]);
  return [...new Set(found)].sort();
}

describe('the lean package', () => {
  it('maps every import the bundle makes, and makes none but three.js and Rapier', () => {
    const imports = bundleImports();
    const map = leanImports(ROOT);
    expect(imports.length).toBeGreaterThan(1);
    for (const name of imports) {
      expect(EXTERNAL.test(name), `${name} should be bundled, or added to EXTERNAL and the map`).toBe(true);
      const mapped = name in map || Object.keys(map).some((key) => key.endsWith('/') && name.startsWith(key));
      expect(mapped, `${name} has no entry in leanImports`).toBe(true);
    }
  });

  it('maps them to files node_modules holds, at the versions package.json pins', () => {
    for (const [name, url] of Object.entries(leanImports(ROOT))) {
      if (name === 'my3dge') {
        expect(url).toBe(`${LEAN_URL}my3dge.js`);
        continue;
      }
      const [, pkg, version, path] = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.*)$/.exec(url)!; // prettier-ignore
      const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')) as { version: string }; // prettier-ignore
      expect(installed.version, pkg).toBe(version);
      expect(existsSync(join(ROOT, 'node_modules', pkg, path)), url).toBe(true);
    }
  });

  it('writes the page head, and each block between its markers', () => {
    expect(leanHead(ROOT)).toContain('<script type="importmap">');
    expect(withBlock('a\n<!-- lean:x:start -->\nold\n<!-- lean:x:end -->\nb', 'x', 'new')).toBe('a\n<!-- lean:x:start -->\nnew\n<!-- lean:x:end -->\nb'); // prettier-ignore
    expect(() => withBlock('no markers', 'x', 'new')).toThrow(/lean:x:start .* are missing/);
  });
});
