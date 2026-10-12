/**
 * @file The hall's floor (PLAN.md WP 7.8, from WP 7.3): flagstones with the rune circle glowing on the dais, moss
 * creeping in from the foot of the walls and contact shadows along them, baked once over the whole hall as the
 * prototype baked it (`levelFloorTexture`, engine/gfx/textures/contactShadow.ts). It defines the bake
 * (`texture:hallFloor`) and the material that draws it (`material:hallFloor`, its runes glowing through the emissive
 * map), and `HALL_MATERIALS`, the hall level's material swap, which the page registers with the level's text
 * (labs/box/main.ts): wherever the engine's recipes name `material:flagstone` in the hall (its floor, the galleries'
 * walks, the dais's top), the hall draws its bake, whose texels line up with its tiles, since those surfaces' UVs are
 * metres from the hall's corner (engine/gfx/level/surface.ts).
 *
 * Level art, not a look: every look draws it, the clean one too (the torch-lit looks light it, labs/box/looks/); the
 * room keeps the engine's flagstones. The swap is presentation only (the level entry's `materials`, which only the view
 * reads, engine/app/view.ts): the sim and the hash never see it.
 *
 * Invariants: data only, defined once when the module loads, from the hall the scenes compile (`HALL_LEVEL`,
 * labs/box/scenes/hall.ts, labs/box/levels/hall.txt's copy); the bake is pure in it (1,024 × 704 texels, 16 a metre).
 * Carried from the hall floor's bake (`my-3d2dge:src/stress-world/10-hall.js:205-219, 266-287`), as WP 7.3 rebuilt it
 * for any level.
 *
 * @example
 * HALL_MATERIALS; // { 'material:flagstone': 'material:hallFloor' }
 * @see labs/box/looks/hall-floor.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineMaterial, defineTexture, levelFloorTexture } from '../../../engine';
import { HALL_LEVEL } from '../scenes/hall';

/** The hall's floor bake: its texture id. */
export const HALL_FLOOR_TEXTURE = 'texture:hallFloor';

/** The material that draws the hall's floor bake. */
export const HALL_FLOOR = 'material:hallFloor';

defineTexture(HALL_FLOOR_TEXTURE, levelFloorTexture(HALL_LEVEL));

defineMaterial(HALL_FLOOR, {
  description:
    "The hall's floor (texture:hallFloor): flagstones, moss at the walls' feet, contact shadows, the dais's runes glowing.",
  map: HALL_FLOOR_TEXTURE,
  roughness: 0.85,
  emissive: '#ffffff',
});

/** The hall level's material swap: its flagstones drawn as the hall's floor bake (see the file comment). */
export const HALL_MATERIALS: Readonly<Record<string, string>> = { 'material:flagstone': HALL_FLOOR };
