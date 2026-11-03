/**
 * @file The looks and filters a game can use, as Markdown: lean/README.md's `lean:looks` block (tools/lib/lean.ts), so
 * an agent handed only that file can change how its game looks (the owner's handoff goal of 2026-11-03; ADR-0024
 * amendment 2). Written from the engine itself, never by hand: the built-in looks of a fresh registry
 * (engine/gfx/post/looks.ts's `defineLooks`), the whole looks with their descriptions and what each draws (`makeup`:
 * its style and sky, and its filters as its own `combine` resolves them, engine/gfx/post/combine.ts, scopes shown
 * where they are not `all`, since laying a look on brings its scopes along), then the one-filter presets by their
 * group, then every filter (engine/gfx/post/filters.ts's `FILTER_FIELDS`, in the order the chain draws them) with
 * what it does, where it may apply and each number's default and range, then a look's other fields (`LOOK_FIELDS`).
 * So the block names exactly what lean/my3dge.js registers, and `x docs --check` fails while it is stale.
 *
 * Invariants: pure: the same engine gives the same text; every look and every filter is listed once; a filter's
 * `scope` and `amount` are explained once, above the list, not on each line.
 *
 * @example
 * looksCatalog().includes('`look:storybook`'); // true
 * fieldText({ type: 'number', default: 0.45, minimum: 0, maximum: 1 }); // '0.45 (0–1)'
 * @see tools/lib/docsLooks.test.ts
 */
import { createRegistry, type Registry } from '../../engine/core/registry';
import type { Field } from '../../engine/core/schema';
import { combineChain } from '../../engine/gfx/post/combine';
import { FILTER_FIELDS, FILTER_NAMES } from '../../engine/gfx/post/filters';
import { AMOUNT, SCREEN_SCOPES } from '../../engine/gfx/post/filterSchema';
import { defineLooks, LOOK_FIELDS, type LookEntry } from '../../engine/gfx/post/looks';

/** A field's default and what it may be, compactly: `0.45 (0–1)`, `8 (1–24 px)`, `'#000000'`, `'kraft' (newsprint|…)`. */
export function fieldText(field: Field): string {
  const range = (unit?: string) =>
    field.minimum !== undefined && field.maximum !== undefined
      ? ` (${field.minimum}–${field.maximum}${unit ? ` ${unit}` : ''})`
      : '';
  if (field.type === 'number' || field.type === 'integer') return `${String(field.default)}${range(field.unit)}`;
  if (field.type === 'string' && field.enum) return `'${String(field.default)}' (${field.enum.join('|')})`;
  if (field.type === 'string') return `'${String(field.default)}'`;
  return JSON.stringify(field.default);
}

/** The first sentence of `text`. */
const sentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

/** A registry holding only the engine's built-in looks. */
function lookRegistry(): Registry {
  const registry = createRegistry();
  defineLooks(registry);
  return registry;
}

/** What a whole look is made of, as it draws: its style and sky when it names them, and its filters, scoped. */
export function makeup(look: LookEntry, registry: Pick<Registry, 'get'>): string {
  const chain = combineChain(look, registry, () => {});
  const on = FILTER_NAMES.filter((name) => chain[name].scope !== 'off').map((name) => {
    const { scope } = chain[name];
    return scope === 'all' ? name : `${name} (${scope})`;
  });
  const parts = [look.style && `style ${look.style}`, look.sky && `sky ${look.sky}`, on.length && `filters ${on.join(', ')}`]; // prettier-ignore
  return parts.filter(Boolean).join('; ');
}

/** The block's lines for the whole looks. */
function wholeLooks(looks: readonly LookEntry[], registry: Registry): string[] {
  return [
    '**Whole looks**, each with what it draws (its style and sky where it names them, its filters and their scopes):',
    '',
    ...looks
      .filter((look) => look.group === 'look')
      .map((look) => `- \`${look.id}\`: ${look.description} _${makeup(look, registry) || 'nothing'}._`),
  ];
}

/** The block's lines for a look's other fields: the ones a game sets besides `filters` and `combine`. */
function lookFields(): string[] {
  const keys = ['style', 'sky', 'skyGradient', 'toon', 'shells', 'resolution', 'textures', 'perspective', 'strength'];
  const fields = LOOK_FIELDS as unknown as Record<string, Field>;
  return [
    "**A look's other fields** (`defineLook(id, { description, filters, combine, … })`):",
    '',
    ...keys.map((key) => `- \`${key}\`: ${sentence(fields[key].description ?? '')}`),
  ];
}

/** The block's lines for the one-filter presets, a line a group. */
function presets(looks: readonly LookEntry[]): string[] {
  const groups = new Map<string, string[]>();
  for (const look of looks) {
    if (look.group === 'look') continue;
    groups.set(look.group, [...(groups.get(look.group) ?? []), look.id.slice(`look:${look.group}/`.length)]);
  }
  return [
    '**One-filter presets**, `look:<group>/<name>`: each turns its one filter on over everything, to draw alone or lay',
    "on with `combine` (the `shading` group sets the material style instead, and `screen` the screen's own glass):",
    '',
    ...[...groups].map(([group, names]) => `- \`${group}\`: ${names.join(', ')}`),
  ];
}

/** The block's lines for the filters, in the chain's order. */
function filters(): string[] {
  const lines = FILTER_NAMES.map((name) => {
    const spec = FILTER_FIELDS[name] as { description: string; properties: Record<string, Field> };
    const where = spec.properties.scope.enum?.length === SCREEN_SCOPES.length ? ' (the whole picture)' : '';
    // every filter's amount is the shared one, explained above, but grain's and chroma's are their strengths
    const fields = Object.entries(spec.properties)
      .filter(([key, field]) => key !== 'scope' && field !== AMOUNT)
      .map(([key, field]) => `\`${key}\` ${fieldText(field)}`);
    return `- \`${name}\`${where}: ${sentence(spec.description)}${fields.length ? ` ${fields.join(', ')}.` : ''}`;
  });
  return [
    "**The filters**, in the order the chain draws them, each `{ scope, amount, … }` in a look's `filters` or in",
    "`post.filters`, with each field's default and range; colours are `'#rrggbb'`. A filter marked (the whole picture)",
    "takes only `'all'` or `'off'`; the rest also take `'characters'`, `'objects'`, `'environment'` or two joined by",
    '`+`.',
    '',
    ...lines,
  ];
}

/** The `lean:looks` block (see the file comment). */
export function looksCatalog(): string {
  const registry = lookRegistry();
  const looks = (registry.list('look') as LookEntry[]).sort((a, b) => a.id.localeCompare(b.id));
  return [...wholeLooks(looks, registry), '', ...presets(looks), '', ...filters(), '', ...lookFields()].join('\n');
}
