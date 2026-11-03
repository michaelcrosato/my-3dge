/**
 * @file The looks catalogue (tools/lib/docsLooks.ts): every built-in look and every filter is listed once, the whole
 * looks with their descriptions and what they draw, a field's default and range read compactly, the shared `amount`
 * left to the block's header but for the filters whose amount is their strength, and a look's other fields.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../engine/core/registry';
import { FILTER_NAMES } from '../../engine/gfx/post/filters';
import { defineLooks, type LookEntry } from '../../engine/gfx/post/looks';
import { fieldText, looksCatalog, makeup } from './docsLooks';

const catalog = looksCatalog();
const lines = catalog.split('\n');
const registry = createRegistry();
defineLooks(registry);
const looks = registry.list('look') as LookEntry[];

describe('looksCatalog', () => {
  it('lists every whole look once, with its description and what it draws', () => {
    const whole = looks.filter((look) => look.group === 'look');
    expect(whole.length).toBeGreaterThan(20);
    for (const look of whole) {
      expect(lines.filter((line) => line.startsWith(`- \`${look.id}\`: `))).toEqual([`- \`${look.id}\`: ${look.description} _${makeup(look, registry) || 'nothing'}._`]); // prettier-ignore
    }
  });

  it("tells what a whole look draws, its own layers resolved, scopes shown where they are not 'all'", () => {
    const get = (id: string) => registry.get('look', id) as LookEntry;
    // storybook's ink is on everything: laying it on brings that along (the lean README's rule)
    expect(makeup(get('look:storybook'), registry)).toBe('filters watercolor, outline, paper');
    expect(makeup(get('look:cartoon'), registry)).toMatch(/^style toon; filters /);
    expect(makeup(get('look:clean'), registry)).toBe('');
    expect(makeup(get('look:comic-noir'), registry)).toMatch(/\((characters\+objects|environment)\)/);
  });

  it("lists a look's other fields with their first sentences", () => {
    for (const key of ['style', 'sky', 'toon', 'resolution', 'textures', 'strength']) {
      expect(
        lines.some((line) => line.startsWith(`- \`${key}\`: `)),
        key,
      ).toBe(true);
    }
  });

  it('lists every one-filter preset under its group', () => {
    const presets = looks.filter((look) => look.group !== 'look');
    for (const look of presets) {
      const line = lines.find((each) => each.startsWith(`- \`${look.group}\`: `));
      expect(line, look.id).toBeDefined();
      expect(line!.slice(`- \`${look.group}\`: `.length).split(', ')).toContain(look.id.split('/')[1]);
    }
  });

  it('lists every filter once, in the chain order, the screen ones marked', () => {
    // the filters' section runs from its header to the look fields' header
    const section = lines.slice(lines.findIndex((line) => line.startsWith('**The filters**')), lines.findIndex((line) => line.startsWith("**A look's other fields**"))); // prettier-ignore
    const filters = section.filter((line) => /^- `[a-z]+`( \(the whole picture\))?: [A-Z]/.test(line));
    expect(filters.map((line) => /^- `([a-z]+)`/.exec(line)![1])).toEqual([...FILTER_NAMES]);
    expect(filters.find((line) => line.startsWith('- `vignette`'))).toMatch(/^- `vignette` \(the whole picture\): /);
    expect(filters.find((line) => line.startsWith('- `grade`'))).toMatch(/^- `grade`: Colour grading\. /);
  });

  it("leaves the shared amount to the header but shows grain's and chroma's own", () => {
    // a filter's line comes after its presets' group line, which starts the same
    const line = (name: string) => lines.filter((each) => each.startsWith(`- \`${name}\``)).at(-1)!;
    expect(line('vignette')).not.toContain('`amount`');
    expect(line('vignette')).toContain("`strength` 0.45 (0–1), `softness` 0.5 (0.05–1), `roundness` 1 (0–1), `color` '#000000'."); // prettier-ignore
    expect(line('grain')).toMatch(/`amount` [\d.]+ \(0–1\)/);
    expect(line('chroma')).toMatch(/`amount` [\d.]+ \(0–1\)/);
  });
});

describe('fieldText', () => {
  it('reads a number, a choice, a colour and a switch', () => {
    expect(fieldText({ type: 'number', default: 0.45, minimum: 0, maximum: 1 })).toBe('0.45 (0–1)');
    expect(fieldText({ type: 'number', default: 8, minimum: 0, maximum: 24, unit: 'px' })).toBe('8 (0–24 px)');
    expect(fieldText({ type: 'string', default: 'kraft', enum: ['newsprint', 'kraft'] })).toBe("'kraft' (newsprint|kraft)"); // prettier-ignore
    expect(fieldText({ type: 'string', default: '#000000', unit: '#rrggbb' })).toBe("'#000000'");
    expect(fieldText({ type: 'boolean', default: true })).toBe('true');
  });
});
