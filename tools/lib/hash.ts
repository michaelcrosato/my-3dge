/**
 * @file The FNV-1a hash (32-bit), shared by the tools: report ids, the e2e fixture's named random streams, and the
 * proof hashes later WPs print. It is the same function everywhere: Node, Chromium, and pages it is injected into.
 *
 * Invariants: strings are hashed as their UTF-8 bytes; results are unsigned 32-bit integers; `fnv1a` is
 * self-contained (no closure, no imports), so `tools/lib/browser.ts` can serialize it into a page's init script.
 *
 * @example
 * fnv1aHex('hello'); // '4f9f2cab'
 * @see tools/lib/hash.test.ts
 */

/** Hashes a string (as UTF-8) or bytes with 32-bit FNV-1a, continuing from `seed` (the FNV offset basis by default). */
export function fnv1a(data: string | Uint8Array, seed: number = 0x811c9dc5): number {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** `fnv1a` as eight lowercase hex digits, the form reports and logs print. */
export function fnv1aHex(data: string | Uint8Array, seed?: number): string {
  return fnv1a(data, seed).toString(16).padStart(8, '0');
}
