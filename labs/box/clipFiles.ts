/**
 * @file The animation library's files (`data/anim/sets/<set>/*.json`) as text, in one chunk: the pages that register
 * the whole library (the box's clip mode, labs/box/main.ts; the Animation Lab with a library clip, labs/anim/; the
 * Library Lab, labs/library/) import this module when they need it (`await import(…)`), so a visit fetches one file
 * instead of one a clip (1,270 of them on 2026-10-27, each a request Vercel counts; ADR-0023 amendment 4). The bytes
 * are the same text, and compress better together. `CLIP_FILES` is what `loadLibrary` (labs/box/library.ts) takes:
 * each path with its text, handed over at once.
 *
 * Invariants: the module only reads the files Vite bundles into it; nothing else imports it statically, so a page
 * that never needs the library never fetches it.
 *
 * Game code, a page's: it imports nothing.
 *
 * @example
 * // const { CLIP_FILES } = await import('./clipFiles');
 * // await loadLibrary(CLIP_FILES); // __engine.describe('clipset').ids: ['clipset:cmu', 'clipset:mesh2motion', …]
 */
/// <reference types="vite/client" />

/** Every clip set's files, by path (`../../data/anim/sets/<set>/<file>.json`), as their text. */
const TEXT = import.meta.glob<string>('../../data/anim/sets/*/*.json', { query: '?raw', import: 'default', eager: true }); // prettier-ignore

/** The library's files as `loadLibrary` takes them: each path, and its text. */
export const CLIP_FILES: Readonly<Record<string, () => Promise<string>>> = Object.fromEntries(
  Object.entries(TEXT).map(([path, text]) => [path, () => Promise.resolve(text)]),
);
