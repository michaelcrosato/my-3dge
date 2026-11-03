/**
 * @file The built-in entries a game names by id, as Markdown: lean/README.md's `lean:ids` block (tools/lib/lean.ts), so
 * an agent handed only that file can name a sky, a material, a prop or a sound without reading the engine's source
 * (ADR-0024 amendment 2, after a fresh agent's trial needed the bundle's source for each). Written from the engine
 * itself: every entry the engine's index registers, kind by kind (`ID_KINDS`), each line its ids and what the kind is
 * (its description's first clause), then the level legend, a line a glyph, from the `glyph` kind. A kind's fields are one call away in a running
 * page, `__engine.describe('<kind>')`, so they are not repeated here.
 *
 * Invariants: pure but for loading the engine's index once (its registrations); every entry of the listed kinds is
 * named once; the spawn markers `1` to `9` share one line.
 *
 * @example
 * (await idsCatalog()).includes('`sky:` dawn'); // true
 * firstSentence('Sky presets: what surrounds a level. More.'); // 'Sky presets: what surrounds a level.'
 * firstClause('Sky presets: what surrounds a level. More.'); // 'Sky presets.'
 * @see tools/lib/docsIds.test.ts
 */
import type { Registry } from '../../engine/core/registry';

/** The kinds whose built-in entries a game names by id, in the block's order. */
export const ID_KINDS = [
  'sky',
  'material',
  'texture',
  'geometry',
  'prop',
  'light',
  'emitter',
  'telegraph',
  'sfx',
  'song',
  'body',
  'build',
  'movement',
  'move',
  'weapon',
  'thing',
  'actionMap',
] as const;

/** The first sentence of `text`. */
export const firstSentence = (text: string): string => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

/** The first clause of `text`, before a colon, a bracket or a semicolon: what a kind is, without the detail. */
export function firstClause(text: string): string {
  const sentence = firstSentence(text);
  const cut = sentence.search(/: | \(|; /);
  return cut >= 8 ? `${sentence.slice(0, cut)}.` : sentence;
}

/** The engine's registry with every built-in entry its index registers. */
async function engineRegistry(): Promise<Registry> {
  await import('../../engine/index');
  return (await import('../../engine/core/registry')).registry;
}

/** The block's line for `kind`: its ids without their prefix, then what the kind is (and how emitters run). */
function kindLine(registry: Registry, kind: string): string {
  const ids = registry.list(kind).map((entry) => entry.id.slice(kind.length + 1));
  const line = `- \`${kind}:\` ${ids.join(', ')}. ${firstClause(String(registry.describe(kind).description ?? ''))}`;
  return kind === 'emitter' ? `${line} ${emitterUse(registry)}` : line;
}

/** Which emitters a sim event bursts (by its type) and which run continuously: the entries' `events` and `rate`. */
function emitterUse(registry: Registry): string {
  const emitters = registry.list('emitter') as unknown as { id: string; events: string[]; rate: number }[];
  const burst = emitters.flatMap((emitter) => emitter.events).sort();
  const running = emitters.filter((emitter) => emitter.rate > 0).map((emitter) => emitter.id.slice('emitter:'.length));
  return `Burst by a sim event of the type: ${burst.join(', ')}. Running at a rate (lay them into your own): ${running.join(', ')}.`; // prettier-ignore
}

/** The level legend, a line a glyph, the spawn markers on one line. */
function legend(registry: Registry): string[] {
  const glyphs = registry.list('glyph') as unknown as { id: string; char: string; description: string }[];
  const markers = glyphs.filter((glyph) => /^glyph:marker\d$/.test(glyph.id));
  const rest = glyphs.filter((glyph) => !markers.includes(glyph));
  const lines = rest.map((glyph) => `- \`${glyph.char}\`: ${firstSentence(glyph.description)}`);
  if (markers.length) {
    const chars = markers.map((glyph) => glyph.char);
    const about = firstSentence(markers[0].description).replaceAll(markers[0].char, 'n');
    lines.push(`- \`${chars[0]}\` to \`${chars.at(-1)}\`: ${about}`);
  }
  return lines;
}

/** The `lean:ids` block (see the file comment). */
export async function idsCatalog(): Promise<string> {
  const registry = await engineRegistry();
  return [
    "**Built-in ids**, by kind, as a scene names them (`material: 'material:glow'`, `spawnProp(w, { prop: 'prop:bench',",
    "at: [x, 0, z], yaw: 0 })`); `__engine.describe('<kind>')` in a running page lists a kind's fields, and",
    '`define<Kind>` adds your own.',
    '',
    ...ID_KINDS.map((kind) => kindLine(registry, kind)),
    '',
    '**The level legend**, a character a tile (`compileLevel`; `defineGlyph` adds one):',
    '',
    ...legend(registry),
  ].join('\n');
}
