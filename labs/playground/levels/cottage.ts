/**
 * @file The cottage (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1), which labs/playground/scenes/interact.ts stands on
 * its lot: one room written as a storey, 6 × 5 m on 0.5 m tiles under a flat roof, the kitchen, behind a front door in
 * the south wall, with a window beside the door and another in the east wall: the openings the scene hangs its door in
 * and stands its panes in. Its room marker is its own (`Q`, a capital the gym's and the lot's glyphs leave free), until
 * WP 13.18 builds the site's house.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * COTTAGE_ROOMS.Q; // 'kitchen'
 * @see labs/playground/scenes/interact.test.ts
 */
import { defineGlyph, defineLevel } from '../../../engine/sim-api';

/** The cottage's rooms by marker character. */
export const COTTAGE_ROOMS = { Q: 'kitchen' } as const;

defineGlyph('glyph:cottage-kitchen', {
  char: 'Q',
  description: "Floor marking the cottage's kitchen.",
  mesh: 'floor',
  room: 'kitchen',
});

/** The cottage, written as a storey (see the file comment). */
export const COTTAGE = `---
description: The interact scene's cottage on 0.5 m tiles, 6 × 5 m and 2.7 m high under a flat roof, one room, the kitchen; a front door in the south wall, a window west of it and one in the east wall.
tile: 0.5
---
---
storey: ground
base: 0
height: 2.7
roof: flat
---
############
#Q.........#
#..........#
#..........:
#..........:
#..........#
#..........#
#..........#
#..........#
#::##++#####
`;

defineLevel('level:cottage', { text: COTTAGE, file: 'labs/playground/levels/cottage.ts' });
