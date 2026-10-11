/**
 * @file The fixture body `body:socketMarks` (PLAN.md WP 3.8): a white, unlit ball of 8 mm radius centred on every
 * socket of the humanoid skeleton and nothing else, so a shot of it shows where a puppet draws its sockets: the
 * puppets page (tests/pages/puppets.ts) shoots each ball from the front and the side and compares its centre with
 * FK's socket (tests/e2e/puppets.spec.ts). Eyes are drawn unlit, so every ball is the same flat white whatever the
 * light, and a ball's silhouette is centred on its socket from any side.
 *
 * Invariants: one ball per socket, in `SOCKETS` order; nothing is defined on import; `defineSocketMarks(registry)`
 * defines it once on a registry (twice throws `CORE_DUPLICATE_ID`).
 *
 * @example
 * import { createRegistry } from '../../engine/core/registry';
 * defineSocketMarks(createRegistry()).parts.length; // 8
 * @see tests/e2e/puppets.spec.ts
 */
import { defineBody, SOCKETS, type Body, type BodyPart, type BodySpec } from '../../engine';
import type { Registry } from '../../engine/core/registry';

/** The fixture body's id. */
export const SOCKET_MARKS_ID = 'body:socketMarks';

/** Each ball's radius, in metres at size 1. */
export const SOCKET_MARK_RADIUS = 0.008;

/** The fixture body (see the file comment). */
export const SOCKET_MARKS: BodySpec = {
  description: 'A test body: a white unlit ball on every socket of the humanoid skeleton.',
  slots: { mark: '#ffffff' },
  parts: SOCKETS.map((socket): BodyPart => ['eye', socket, SOCKET_MARK_RADIUS, 'mark']),
};

/** Defines `body:socketMarks` on `registry` and returns it. Throws `CORE_DUPLICATE_ID` the second time. */
export function defineSocketMarks(registry: Registry): Body {
  return defineBody(SOCKET_MARKS_ID, SOCKET_MARKS, registry);
}
