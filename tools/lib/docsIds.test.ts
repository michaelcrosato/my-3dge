/**
 * @file The built-in ids catalogue (tools/lib/docsIds.ts): every entry of each listed kind named once on its kind's
 * line, the level legend a line a glyph with the spawn markers on one, and a kind told by its first clause.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import '../../engine/index';
import { firstClause, firstSentence, ID_KINDS, idsCatalog } from './docsIds';

const lines = (await idsCatalog()).split('\n');

describe('idsCatalog', () => {
  it('names every built-in entry of each kind once, on its line', () => {
    for (const kind of ID_KINDS) {
      const line = lines.find((each) => each.startsWith(`- \`${kind}:\` `));
      expect(line, kind).toBeDefined();
      const named = line!.slice(`- \`${kind}:\` `.length).split('. ')[0].split(', ');
      expect(named.sort(), kind).toEqual(registry.list(kind).map((entry) => entry.id.slice(kind.length + 1)).sort()); // prettier-ignore
    }
    expect(lines.find((line) => line.startsWith('- `sky:` '))).toMatch(/^- `sky:` dawn, daylight, dusk, hall, night, noon\. Sky presets\.$/); // prettier-ignore
  });

  it('gives the level legend a line a glyph, the spawn markers on one', () => {
    const glyphs = registry.list('glyph') as unknown as { id: string; char: string }[];
    for (const glyph of glyphs.filter((each) => !/^glyph:marker\d$/.test(each.id))) {
      expect(
        lines.filter((line) => line.startsWith(`- \`${glyph.char}\`: `)),
        glyph.id,
      ).toHaveLength(1);
    }
    expect(lines).toContain('- `1` to `9`: Floor with the spawn marker n (spawn:n): where a scene places what it numbers n, such as a mover\'s start.'); // prettier-ignore
  });
});

describe('firstClause', () => {
  it('keeps what a kind is and drops the detail after a colon, a bracket or a semicolon', () => {
    expect(firstClause('Sky presets: what surrounds a level. More.')).toBe('Sky presets.');
    expect(firstClause('Firearms: fire rate, damage.')).toBe('Firearms.');
    expect(firstClause('A sound effect (voices).')).toBe('A sound effect.');
    expect(firstClause('Props: x')).toBe('Props: x');
    expect(firstSentence('One. Two.')).toBe('One.');
  });
});
