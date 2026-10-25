/**
 * @file What the MCP bridge's tools answer (PLAN.md §8.11, WP 7.6): MCP `CallToolResult`s made from what the members
 * return. A value is compact JSON text; a text (a scene tree, help) goes as it is; a failure is a result with
 * `isError`, its text the error's first line (an engine error's `[CODE] message: fix`), so the client's model reads
 * the fix and the session goes on. A shot is the frame as a PNG image (tools/cmd/shot.ts `encodePng`, from the
 * shot's RGBA, or its marked copy with `marks`) and its numbers as JSON: the look metrics and their notes, the ID
 * pass (each visible object's pixels, share, box and centre, largest first; the unseen ones by name, by reason) and
 * the thumbnail's object map. A replay is judged against its file's goldens for this platform, as `x replay` judges.
 *
 * Invariants: a text over `MAX_TEXT` characters is cut, the cut saying how much went and where the whole text is
 * (`out/mcp/<tool>.txt`), since a client keeps only so much of a result; images are never cut. Nothing here calls the
 * engine.
 *
 * @example
 * judgeGoldens({ '0': 'a', '60': 'b' }, { '0': 'a', '60': 'b' }); // { platform: 'linux-x64', checked: 2, match: true }
 * errorResult(new Error('[DEV_BAD_ARGS] __engine.step: n is -1: call it as step(n = 1, intents?)')).isError; // true
 * @see tools/mcp/tools.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ShotJson } from '../../engine/gfx/shot';
import { encodePng } from '../cmd/shot';
import { PLATFORM } from '../cmd/replay';

/** The longest text a result carries, in characters: about 15,000 tokens, under what clients keep of a result. */
export const MAX_TEXT = 60_000;

/** The most visible objects a shot's JSON lists one by one, largest first; the rest are counted. */
export const MAX_LISTED = 40;

/** `text` as a result's text, cut past `MAX_TEXT` with a line saying where the whole of it is (under `root`). */
export function cutText(text: string, root: string, tool: string): string {
  if (text.length <= MAX_TEXT) return text;
  const file = join('out', 'mcp', `${tool}.txt`);
  mkdirSync(join(root, 'out', 'mcp'), { recursive: true });
  writeFileSync(join(root, file), text);
  const more = (text.length - MAX_TEXT).toLocaleString('en');
  return `${text.slice(0, MAX_TEXT)}\n… ${more} more characters cut: the whole result is in ${file}; narrow the call`;
}

/** A result holding `value`: a string as it is, anything else as compact JSON. */
export function valueResult(value: unknown, root: string, tool: string, isError = false): CallToolResult {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined');
  return { content: [{ type: 'text', text: cutText(text, root, tool) }], ...(isError ? { isError } : {}) };
}

/** The first line of an error's message, without the wrappers a page or Playwright put round it. */
export function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split('\n')[0]
    .replace(/^(?:page\.evaluate: |the inspect session answered \d+: )+/, '')
    .replace(/^(?:Uncaught )?(?:\w*Error: )(?=\[[A-Z])/, '');
}

/** A failed call as a result: its text names what went wrong and the fix. */
export function errorResult(error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: errorLine(error) }], isError: true };
}

/** How a replay's hashes stand against its goldens for this platform. */
export interface GoldenVerdict {
  platform: string;
  checked: number;
  match: boolean;
  /** The first checkpoint that differs. */
  step?: string;
  expected?: string;
  actual?: string;
  /** Why none were checked: no goldens for this platform, or none at the steps played. */
  note?: string;
}

/** Judges `hashes` (by step) against `goldens`, at the steps both hold. */
export function judgeGoldens(
  goldens: Record<string, string> | undefined,
  hashes: Record<string, string>,
): GoldenVerdict {
  if (!goldens)
    return { platform: PLATFORM, checked: 0, match: false, note: `the file has no goldens for ${PLATFORM}` };
  const steps = Object.keys(goldens)
    .filter((step) => step in hashes)
    .sort((a, b) => Number(a) - Number(b));
  const first = steps.find((step) => goldens[step] !== hashes[step]);
  if (first !== undefined) {
    return { platform: PLATFORM, checked: steps.length, match: false, step: first, expected: goldens[first], actual: hashes[first] }; // prettier-ignore
  }
  if (!steps.length) return { platform: PLATFORM, checked: 0, match: false, note: 'no golden step was played' };
  return { platform: PLATFORM, checked: steps.length, match: true };
}

/** A shot's numbers for the client: the look, the ID pass and the thumbnail's map, without pixels. */
export function shotSummary(shot: ShotJson): Record<string, unknown> {
  const { width, height, ids, metrics, notes, thumbnail, marks, built, ms } = shot;
  const out: Record<string, unknown> = { width, height };
  if (metrics) out.metrics = metrics;
  if (notes?.length) out.notes = notes.map((note) => `${note.level} ${note.id}: ${note.message}`);
  if (ids) {
    const visible = ids.visible.slice(0, MAX_LISTED).map(({ name, px, share, bbox, centre, entity }) => ({ name, px, share, bbox, centre, ...(entity === undefined ? {} : { entity }) })); // prettier-ignore
    const unseen: Record<string, string[]> = {};
    for (const entry of ids.unseen) (unseen[entry.reason] ??= []).push(entry.name);
    for (const names of Object.values(unseen)) if (names.length > MAX_LISTED) names.splice(MAX_LISTED, Infinity, `… ${names.length - MAX_LISTED} more`); // prettier-ignore
    out.ids = {
      objects: ids.objects,
      visible,
      ...(ids.visible.length > MAX_LISTED ? { more: ids.visible.length - MAX_LISTED } : {}),
      unseen,
      empty: ids.empty,
      stray: ids.stray,
      protagonist: ids.protagonist,
    };
  }
  if (thumbnail?.map) Object.assign(out, { map: thumbnail.map, legend: thumbnail.legend });
  if (marks?.length) out.marks = marks.map(({ n, name, at }) => ({ n, name, at }));
  return { ...out, built, ms };
}

/** A shot as a result: the frame as a PNG (the marked copy when marks were drawn) and its numbers as JSON. */
export function shotResult(shot: ShotJson, root: string): CallToolResult {
  const rgba = shot.marked ?? shot.pixels;
  const text = cutText(JSON.stringify(shotSummary(shot)), root, 'engine_shot');
  if (!rgba) return { content: [{ type: 'text', text }] };
  const png = encodePng(shot.width, shot.height, new Uint8Array(Buffer.from(rgba, 'base64')));
  return {
    content: [
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      { type: 'text', text },
    ],
  };
}
