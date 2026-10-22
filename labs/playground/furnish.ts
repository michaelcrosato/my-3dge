/**
 * @file Where the block's things stand (docs/PLAYGROUND.md §2, PLAN.md WP 13.18), as data the site's scenes read
 * (labs/playground/scenes/site.ts): in each room of the house, its lamp hung from the ceiling and its switch on the
 * wall by its door (`HOUSE_LIGHTS`), the lamp's light group the room's (`room:<name>`); the furniture, room by room
 * (`HOUSE_FURNITURE`), in the house's own metres and storeys (labs/playground/levels/house.ts); the garage door's two
 * switches; and outside (`OUTDOORS`, world metres): the patio, the backyard, the front yard's fence, hedge and mailbox,
 * the street's lamps, hydrant, parked car and bus stop and the ring's ropes (the range's targets are things:
 * labs/playground/weapons/range.ts); the zipline from the tree house to the garage's deck, the lookout's down to the
 * backyard, the hill's balloon and the backyard's trampoline (`SITE_RIDES`). A thing's yaw turns its +Z face (a prop's
 * front) about +Y.
 *
 * Game code, sim-side: data, importing nothing from the engine.
 *
 * @example
 * HOUSE_LIGHTS.kitchen.storey; // 1: the ground floor
 * @see labs/playground/scenes/site.test.ts
 */

/** Facing: +Z (south), +X (east), −Z (north), −X (west), as yaws (rad). */
const [S, E, N, W] = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** A room's lamp (where it hangs, x and z) and switch (x, z and the way it faces), in the house's metres. */
export interface RoomLight {
  readonly storey: number;
  readonly lamp: readonly [number, number] | null;
  readonly switch: readonly [number, number, number];
}

/** Each room's lamp and switch (see the file comment); the crawlspace has neither, the attic's lamp hangs from its ridge. */ // prettier-ignore
export const HOUSE_LIGHTS: Readonly<Record<string, RoomLight>> = {
  workshop: { storey: 0, lamp: [4.5, 10], switch: [8.75, 6.8, W] },
  stairwell: { storey: 0, lamp: [9.6, 6.5], switch: [10.25, 8.6, W] }, // at the foot of the stairs
  laundry: { storey: 0, lamp: [13, 7], switch: [10.5, 6.8, E] },
  storage: { storey: 0, lamp: [13, 13], switch: [14.3, 10.25, S] },
  kitchen: { storey: 1, lamp: [3, 7], switch: [5.5, 8.3, W] },
  hall: { storey: 1, lamp: [8, 6.5], switch: [8.4, 15.75, N] },
  bathroom: { storey: 1, lamp: [1.6, 13], switch: [3, 13.3, W] },
  dining: { storey: 1, lamp: [13.1, 7.2], switch: [10.5, 8.3, E] },
  living: { storey: 1, lamp: [12.8, 12.8], switch: [10.5, 13.7, E] },
  garage: { storey: 1, lamp: [18.9, 10], switch: [16, 8.3, E] },
  bedroom: { storey: 2, lamp: [3, 7], switch: [5.5, 8.3, W] },
  washroom: { storey: 2, lamp: [1.6, 13], switch: [3, 13.3, W] },
  landing: { storey: 2, lamp: [8.5, 6.5], switch: [8.4, 15.75, N] },
  study: { storey: 2, lamp: [13, 7], switch: [10.5, 8.3, E] },
  master: { storey: 2, lamp: [13, 13], switch: [10.5, 13.7, E] },
  attic: { storey: 3, lamp: [8, 10.5], switch: [12, 10.1, W] },
};

/** The garage door's switches, in the house's metres: inside on its east wall, and outside beside it. */
export const GARAGE_SWITCHES = [
  [21.75, 13.2, W],
  [21, 14, S],
] as const;

/** One thing in the house: its prop, where it stands (x, z, in the house's metres), its yaw and its storey. */
export type Placed = readonly [prop: string, x: number, z: number, yaw: number, storey: number];

/** The house's furniture, room by room (see the file comment). */
export const HOUSE_FURNITURE: readonly Placed[] = [
  // basement: the workshop, the laundry and boiler room, storage
  ['prop:playground-workbench', 4, 15.25, N, 0],
  ['prop:playground-shelves', 0.5, 10, E, 0],
  ['prop:crate', 7, 12, 0.3, 0],
  ['prop:crate', 7.7, 13.3, -0.2, 0],
  ['prop:playground-washer', 11.2, 4.75, S, 0],
  ['prop:playground-washer', 11.9, 4.75, S, 0],
  ['prop:playground-boiler', 15.1, 4.9, S, 0],
  ['prop:playground-shelves', 13, 15.5, N, 0],
  ['prop:crate', 12, 12, 0.1, 0],
  ['prop:barrel', 15.1, 11, 0, 0],
  ['prop:playground-box', 12.9, 12.3, 0.4, 0],
  // the ground floor: the kitchen, the dining room, the living room, the bathroom, the hall, the garage
  ['prop:playground-fridge', 0.6, 9.3, E, 1],
  ['prop:playground-stove', 4.85, 9.4, W, 1],
  ['prop:table', 13.1, 7.2, 0, 1],
  ['prop:chair', 12.6, 6.3, S, 1],
  ['prop:chair', 13.6, 6.3, S, 1],
  ['prop:chair', 12.6, 8.1, N, 1],
  ['prop:chair', 13.6, 8.1, N, 1],
  ['prop:playground-fireplace', 12.75, 10.8, S, 1],
  ['prop:playground-rug', 12.75, 12.6, 0, 1],
  ['prop:playground-sofa', 12.75, 14.2, N, 1],
  ['prop:playground-tv', 15.5, 12.5, W, 1],
  ['prop:playground-bath', 0.65, 14.6, E, 1],
  ['prop:playground-toilet', 0.6, 11, E, 1],
  ['prop:playground-basin', 2.75, 14.8, W, 1],
  ['prop:chest', 4.6, 15.2, N, 1],
  ['prop:playground-car', 18.9, 10.5, 0, 1],
  ['prop:playground-workbench', 21.3, 9, W, 1],
  ['prop:playground-shelves', 17.2, 6.5, S, 1],
  // the upper floor: the bedroom and its bunk bed, the master bedroom, the study, the washroom
  ['prop:playground-bunkbed', 0.75, 8.8, 0, 2],
  ['prop:playground-box', 3.5, 9.3, 0.6, 2],
  ['prop:playground-bed', 14.7, 12.5, W, 2],
  ['prop:playground-desk', 13, 4.6, S, 2],
  ['prop:chair', 13, 5.5, N, 2],
  ['prop:playground-bookshelf', 10.7, 9.3, E, 2], // clear of the door (z 7 to 8) and its switch
  ['prop:playground-bath', 0.65, 14.6, E, 2],
  ['prop:playground-toilet', 0.6, 11, E, 2],
  ['prop:playground-basin', 2.75, 14.8, W, 2],
  // the attic: boxes to carry, an old chest
  ['prop:playground-box', 3, 8, 0.2, 3],
  ['prop:playground-box', 4, 10.5, -0.5, 3],
  ['prop:playground-box', 13, 8, 0.9, 3],
  ['prop:chest', 14.5, 11.5, W, 3],
];

/** One thing outside: its prop, where its base stands (x, y, z, world metres) and its yaw. */
export type Outside = readonly [prop: string, x: number, y: number, z: number, yaw: number];

/** The picket fence's sections along the front yard (2 m each), but at the path and the driveway. */
const FENCE = [42, 44, 46, 48, 50, 54, 56, 58, 67, 69, 71].map((x): Outside => [
  'prop:playground-fence',
  x,
  0,
  81.5,
  S,
]);

/** The outdoor things (see the file comment). */
export const OUTDOORS: readonly Outside[] = [
  // the patio and the backyard
  ['prop:table', 54, 0, 46, 0],
  ['prop:chair', 53.5, 0, 45.1, S],
  ['prop:chair', 54.5, 0, 46.9, N],
  ['prop:playground-grill', 58.5, 0, 45.2, S],
  ['prop:playground-kennel', 52, 0, 38, S],
  ['prop:playground-swingset', 60, 0, 33, 0],
  ['prop:playground-tree', 68, 0, 38, 0],
  ['prop:playground-tree', 50, 0, 30, 0],
  ['prop:bench', 56, 0, 41.5, N],
  // the front yard
  ...FENCE,
  ['prop:playground-mailbox', 53.6, 0, 82.2, S],
  ...[66, 70, 74, 78].map((z): Outside => ['prop:playground-hedge', 71.4, 0, z, E]),
  ['prop:playground-tree', 46, 0, 70, 0],
  ['prop:playground-tree', 68, 0, 68, 0],
  // the street: its lamps on the north sidewalk, over the road; the hydrant; a parked car; the bus stop
  ...[45, 59, 73, 87].map((x): Outside => ['prop:playground-streetlight', x, 0.15, 84.2, S]),
  ['prop:playground-hydrant', 57, 0.15, 84, 0],
  ['prop:playground-car', 78, 0, 87, E],
  ['prop:playground-busstopRoof', 82, 2.55, 94.1, 0],
  ['prop:playground-busstopPost', 80.6, 0.15, 94.6, 0],
  ['prop:playground-busstopPost', 83.4, 0.15, 94.6, 0],
  ['prop:playground-busstopBack', 82, 0.15, 94.8, 0],
  ['prop:bench', 82, 0.15, 94.3, N],
  // the ring's ropes on its canvas (1 m up, x 63 to 69, z 3 to 9), but its south side, where its steps come up
  ...[1.5, 1.9, 2.3].flatMap((y): Outside[] => [['prop:playground-rope', 66, y, 3.1, 0], ['prop:playground-rope', 63.1, y, 6, E], ['prop:playground-rope', 68.9, y, 6, E]]), // prettier-ignore
];

/** The block's rides (engine/world/traverse.ts's specs), but the lookout's, which stands on the hill's height. */
export const SITE_RIDES = {
  /** From a pole on the tree house's deck (4 m) to one on the garage's deck (3 m), over the railing. */
  treehouse: { from: [47.5, 8, 22], to: [63, 6.5, 54], feet: [4, 3] },
  /** The backyard's trampoline: its mat 0.5 m up, bouncing 0.9 of a fall's speed back (the gym's). */
  trampoline: { at: [62, 0.5, 26], size: [3, 3], reach: 0.6, velocity: [0, Math.sqrt(2 * 19.05 * 2), 0], bounce: 0.9, mesh: 'trampoline', solid: true }, // prettier-ignore
} as const;
