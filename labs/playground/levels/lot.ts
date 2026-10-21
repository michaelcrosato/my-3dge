/**
 * @file The lot's levels (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3), which labs/playground/scenes/lot.ts stands on its
 * terrain: `LOT_HOUSE`, a house written as storeys (a cellar, a ground floor with the hall and the kitchen, an upper
 * floor with the bedroom and the study, an attic under a gable), and `LOT_SHED`, a shed under a flat roof. They are the
 * playground's copies of the storey fixtures (fixtures/levels/storeys/house.txt and shed.txt), its room markers its
 * own (`LOT_ROOMS`, capitals the gym's glyphs leave free), until WP 13.18 builds the site.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * LOT_ROOMS.K; // 'kitchen'
 * @see labs/playground/scenes/lot.test.ts
 */
import { defineGlyph, defineLevel } from '../../../engine/sim-api';

/** The house's rooms by marker character. */
export const LOT_ROOMS = { L: 'cellar', E: 'hall', K: 'kitchen', N: 'bedroom', Y: 'study', G: 'attic' } as const;

for (const [char, room] of Object.entries(LOT_ROOMS)) {
  defineGlyph(`glyph:lot-${room}`, {
    char,
    description: `Floor marking the lot house's ${room}.`,
    mesh: 'floor',
    room,
  });
}

/** The lot's house, written as storeys (see the file comment). */
export const LOT_HOUSE = `---
description: The lot's house on 0.5 m tiles, 8 × 6 m: a cellar 3 m down, a ground floor with the hall and the kitchen, an upper floor with the bedroom and the study, an attic under a gable (35°, the ridge east to west); flights of stairs from the cellar to the kitchen and from the hall to the landing, a ladder against the study's west wall, up through the attic's hatch.
tile: 0.5
---
---
storey: cellar
base: -3
height: 2.7
---
################
#L.............#
#..............#
#............<<#
#............<<#
#............<<#
#............<<#
#............<<#
#............<<#
#............<<#
#..............#
################
---
storey: ground
base: 0
height: 2.7
---
#########::::###
#E....#K.......#
#.....#........#
#<<...#.....!~~#
#<<...+.....!~~#
#<<...+.....!~~#
#<<...#.....!~~#
#<<...#.....!~~#
#<<.@.#.....!~~#
#<<...#.....!~~#
#.....#.....!!!#
##++############
---
storey: upper
base: 3
height: 2.7
---
################
#N.....#Y......#
#......#.......#
#~~!...#.......#
#~~!...+.......#
#~~!...+.......#
#~~!...#|......#
#~~!...#.......#
#~~!...#.......#
#~~!...#.......#
#!!!...#.......#
####::####::::##
---
storey: attic
base: 6
roof: gable
pitch: 35
eaves: 0.5
---
################
################
################
################
#G.............#
#.......~~~....#
#.......~~~....#
#.......~~~....#
################
################
################
################
`;

/** The lot's shed (see the file comment). */
export const LOT_SHED = `---
description: The lot's shed on 0.5 m tiles, 3 × 4 m and 2.5 m high under a flat roof bodies stand on, with a door and a window.
tile: 0.5
---
---
storey: ground
base: 0
height: 2.5
roof: flat
roofSurface: tar
---
######
#@...#
#....:
#....:
#....#
#....#
#....#
##++##
`;

defineLevel('level:lot-house', { text: LOT_HOUSE, file: 'labs/playground/levels/lot.ts' });
defineLevel('level:lot-shed', { text: LOT_SHED, file: 'labs/playground/levels/lot.ts' });
