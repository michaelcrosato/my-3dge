/**
 * @file Body builds (PLAN.md WP 3.4, §5.2, I-08): the registry kind `build`, one entry per body proportion set, in
 * metres. `build:chibi` (the default: a big head), `build:heroic` (tall), `build:bulky` (brawlers, bosses) and
 * `build:skeleton` come from my-3d2dge; `build:adult` (WP 13.2) is an adult's, 1.80 m standing, its legs and trunk on
 * Drillis and Contini's shares of height (thigh 0.245, shin and ankle 0.285, the knees a little bent in the stance),
 * its arm's two segments nearly equal, as the moves and grips written for the source's builds need, and its gait
 * planting its soles at full stride (`plantedStride`); a game adds its own with `defineBuild`. `createSkeleton` (skeleton.ts) turns a build into rest-pose bone offsets; locomotion (WP 3.6)
 * reads the stance and gait fields.
 *
 * Invariants: every length is in metres before `size`, which scales them all (a 0.5 build is half as tall). The
 * carried fields keep the source's names and are its numbers / 16, except `hipZ` → `hipHeight` and `headR` →
 * `headRadius` (Z is no longer up). `legUpper + legLower` is the hip-to-sole length, so the rest pose stands the soles
 * on the floor; `hipHeight`, the relaxed stance, is at most that (the knees bend a little). `ankleHeight`,
 * `footLength`, `handLength` and `chestDepth` are new (the old rig had no ankles, hands or back): their defaults were
 * chosen here, from the source's drawn boots (the toe 1.9 units ahead of the foot point). The drawing fields (`limbW`,
 * `torsoW`, hair, outfits) belong to the body grammar (WP 3.8), not here.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1755-1773` (`BUILDS` and the `Humanoid` defaults).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * getBuild('build:heroic').legUpper; // 0.4625: 7.4 units / 16
 * const giant = defineBuild('build:giant', { size: 2, torso: 0.6 }, createRegistry());
 * giant.hipHeight * giant.size; // 1.45: chibi's stance, doubled
 * @see engine/anim/builds.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Schema, SpecOf } from '../core/schema';

/** A length field of the build schema, in metres. */
const metres = (value: number, description: string) =>
  ({ type: 'number', default: value, minimum: 0, unit: 'm', description }) as const;

/** The fields of a `build` entry. The defaults are `build:chibi`'s. */
export const BUILD_FIELDS = {
  size: { type: 'number', default: 1, minimum: 0.01, description: 'Scale applied to every length of the build.' },
  legUpper: metres(0.375, 'Hip joint to knee: the thigh.'),
  legLower: metres(0.375, 'Knee to sole: the shin plus the ankle height.'),
  hipHeight: metres(0.725, 'Pelvis height in the relaxed stance, at most legUpper + legLower (the old hipZ).'),
  hipHalf: metres(0.11875, 'Pelvis centre to each hip joint, sideways.'),
  footSpread: metres(0.11875, 'Pelvis centre to each foot, sideways, in the stance.'),
  torso: metres(0.5, 'Pelvis to the shoulder centre (the base of the neck).'),
  shoulderHalf: metres(0.20625, 'Shoulder centre to each shoulder joint, sideways.'),
  neck: metres(0.075, 'Base of the neck to the base of the skull.'),
  headRadius: metres(0.2125, "The head's radius; its centre is one radius above the base of the skull."),
  armUpper: metres(0.2875, 'Shoulder to elbow.'),
  armLower: metres(0.2875, 'Elbow to wrist.'),
  ankleHeight: metres(0.08, 'Sole to ankle joint (new: the old rig stood its foot point on the floor).'),
  footLength: metres(0.17, 'Heel to toe tip (new).'),
  handLength: metres(0.15, 'Wrist to fingertip (new).'),
  chestDepth: metres(0.2, 'Front to back through the chest, for the back socket (new).'),
  lean: { type: 'number', default: 0, unit: 'rad', description: 'Forward lean of the torso in the stance.' },
  hunch: { type: 'number', default: 0, minimum: 0, description: 'How far the head and hands slump forward (share).' },
  stride: metres(0.40625, 'Half the foot travel of one walking step, at the reference speed.'),
  lift: metres(0.2125, 'How high a foot lifts while walking.'),
  swing: metres(0.25, 'How far the hands swing while walking.'),
  speedRef: {
    type: 'number',
    default: 4.375,
    minimum: 0.01,
    unit: 'm/s',
    description: 'The speed the stride is tuned for.',
  },
  plantedStride: {
    type: 'boolean',
    default: false,
    description:
      "Whether the gait lowers the pelvis so a planted sole reaches its target at full stride (new: the source's builds keep its gait, whose soles hang at full stride, ADR-0009 amendment 4).",
  },
} as const satisfies Schema;

/** A `build` entry: one body's proportions, in metres before `size`. */
export type Build = Entry<typeof BUILD_FIELDS>;

/** What `defineBuild` takes: any field; the others keep `build:chibi`'s values. */
export type BuildSpec = SpecOf<typeof BUILD_FIELDS>;

/** The engine's builds: my-3d2dge's numbers / 16, plus the new fields' values. `build:chibi` is all defaults. */
const ENGINE_BUILDS: Record<string, BuildSpec> = {
  'build:chibi': {},
  'build:heroic': {
    legUpper: 0.4625,
    legLower: 0.4625,
    hipHeight: 0.89375,
    torso: 0.6,
    shoulderHalf: 0.21875,
    headRadius: 0.190625,
    neck: 0.09375,
    armUpper: 0.34375,
    armLower: 0.3375,
    hipHalf: 0.1125,
    stride: 0.4875,
    speedRef: 5,
    ankleHeight: 0.085,
    footLength: 0.2,
    handLength: 0.17,
    chestDepth: 0.22,
  },
  'build:bulky': {
    legUpper: 0.4,
    legLower: 0.3875,
    hipHeight: 0.7625,
    torso: 0.5875,
    shoulderHalf: 0.2875,
    headRadius: 0.2,
    neck: 0.05625,
    armUpper: 0.325,
    armLower: 0.325,
    hipHalf: 0.15,
    footSpread: 0.15,
    stride: 0.4125,
    speedRef: 3.75,
    ankleHeight: 0.09,
    footLength: 0.21,
    handLength: 0.18,
    chestDepth: 0.3,
  },
  'build:adult': {
    legUpper: 0.44,
    legLower: 0.51,
    hipHeight: 0.93,
    hipHalf: 0.09,
    footSpread: 0.11,
    torso: 0.55,
    shoulderHalf: 0.2,
    neck: 0.1,
    headRadius: 0.11,
    armUpper: 0.3,
    armLower: 0.29,
    ankleHeight: 0.075,
    footLength: 0.27,
    handLength: 0.19,
    chestDepth: 0.24,
    stride: 0.5,
    lift: 0.17,
    swing: 0.28,
    speedRef: 4.41,
    plantedStride: true,
  },
  'build:skeleton': {
    legUpper: 0.4375,
    legLower: 0.4375,
    hipHeight: 0.8375,
    torso: 0.5625,
    shoulderHalf: 0.2,
    headRadius: 0.19375,
    neck: 0.1,
    armUpper: 0.33125,
    armLower: 0.325,
    hipHalf: 0.09375,
    stride: 0.4375,
    hunch: 0.2,
    footLength: 0.19,
    handLength: 0.16,
    chestDepth: 0.16,
  },
};

/** The problems of a build beyond its fields: a stance taller than the legs, an ankle above the knee. */
function buildProblems(build: Build): string[] {
  const problems: string[] = [];
  const leg = build.legUpper + build.legLower;
  if (build.hipHeight > leg) {
    problems.push(`hipHeight ${build.hipHeight} is above legUpper + legLower (${leg}); straight legs cannot reach it`);
  }
  if (build.ankleHeight >= build.legLower) {
    problems.push(`ankleHeight ${build.ankleHeight} is not below legLower ${build.legLower}; the shin needs a length`);
  }
  if (build.legUpper <= 0 || build.legLower <= 0 || build.armUpper <= 0 || build.armLower <= 0) {
    problems.push('legUpper, legLower, armUpper and armLower must be above 0');
  }
  return problems;
}

/** Declares the kind `build` on `registry`, with the engine's builds, unless it has it. */
export function buildKind(registry: Registry): void {
  if (registry.kinds().includes('build')) return;
  registry.defineKind('build', {
    description:
      'Body proportions for the humanoid skeleton, in metres before size (limbs, torso, head, stance, gait).',
    fields: BUILD_FIELDS,
    fallback: 'build:chibi',
    defineWith: "defineBuild('<id>', { legUpper: …, torso: …, size: … })",
    check: (entry) => buildProblems(entry as Build),
  });
  for (const [id, spec] of Object.entries(ENGINE_BUILDS)) registry.def('build', id, spec as Record<string, unknown>);
}
buildKind(sharedRegistry);

/**
 * Defines a build on `registry` (the shared one by default) and returns it; absent fields keep `build:chibi`'s
 * values. Throws `CORE_BAD_SPEC` naming each problem (a stance above straight legs, an ankle above the knee…),
 * `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineBuild(id: string, spec: BuildSpec, registry: Registry = sharedRegistry): Build {
  buildKind(registry);
  return registry.def('build', id, spec as Record<string, unknown>) as Build;
}

/** The build `id` of `registry`; a missing id warns once (`CORE_UNKNOWN_ID`) and gives `build:chibi`. */
export function getBuild(id: string, registry: Registry = sharedRegistry): Build {
  buildKind(registry);
  return registry.get('build', id) as Build;
}
