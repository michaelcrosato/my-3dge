/**
 * @file Unit tests for tools/lib/oneFile.ts: a page's scripts and stylesheets go inline, `</script` is escaped, a
 * `<!--` and a missing file fail by name, `externalRefs` finds what loads from outside; and the committed
 * playground.html opens with its note, loads nothing from outside and holds no path of this checkout, so a build on
 * another machine gives its bytes. Whether it is current is `node x html --check` (a build, about 11 s, kept out of T1).
 * @see tools/lib/oneFile.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../x';
import { externalRefs, inlineBuild, ONE_FILE, ONE_FILE_NOTE } from './oneFile';

const PAGE = [
  '<html><head><meta charset="utf-8" />',
  '<script type="module" crossorigin src="../../assets/main-1.js"></script>',
  '<link rel="stylesheet" crossorigin href="../../assets/style-2.css">',
  '</head><body><canvas></canvas></body></html>',
].join('\n');

describe('the one-file playground', () => {
  it('puts the script and the stylesheet inline, the note after the charset', () => {
    const html = inlineBuild(PAGE, { 'assets/main-1.js': 'go("</script>")', 'assets/style-2.css': 'a{b:c}' });
    expect(html).toContain('<script type="module">go("<\\/script>")</script>');
    expect(html).toContain('<style>a{b:c}</style>');
    expect(html).toContain(`<meta charset="utf-8" />\n    ${ONE_FILE_NOTE}`);
    expect(externalRefs(html)).toEqual([]);
  });

  it('fails by name on a missing file and on a "<!--" in the script', () => {
    expect(() => inlineBuild(PAGE, { 'assets/style-2.css': '' })).toThrow(/main-1\.js is not in the build/);
    expect(() => inlineBuild(PAGE, { 'assets/main-1.js': 'x = "<!--"', 'assets/style-2.css': '' })).toThrow(/<!--/);
  });

  it('names what loads from outside, data URLs aside', () => {
    const html = '<link rel="icon" href="data:," /><img src="a.png"><script type="module">x="src=\\"b.js\\""</script>';
    expect(externalRefs(html)).toEqual(['a.png']);
  });

  it('is committed with its note, loading nothing from outside and holding no path of this checkout', () => {
    const html = readFileSync(join(ROOT, ONE_FILE), 'utf8');
    expect(html.slice(0, 1024)).toContain(ONE_FILE_NOTE);
    expect(externalRefs(html)).toEqual([]);
    expect(html.includes(ROOT)).toBe(false);
  });
});
