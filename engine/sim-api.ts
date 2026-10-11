/**
 * @file The public API for sim-side game code (PLAN.md §6.1, §6.9, WP 1.6; doctrine: Quality under the hood): what a
 * scene, a cast member or a behaviour imports, and all it may import (ESLint's public-API rule), so `x sim` runs it
 * in Node and its play is reproducible. engine/index.ts re-exports all of it for pages.
 *
 * What is here: scenes, the world and its components, the registries and settings, the intents vocabulary,
 * three.js's math classes with the engine's angle helpers, seeded randomness, and the event types. docs/API.md
 * lists every name with the first sentence of its doc comment; `node x describe` lists the registries.
 *
 * Invariants: a flat list of `export … from` lines, one name per line, grouped by area, and append-only: each WP adds
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). Only sim-side modules are
 * re-exported (ESLint's layer rule for this file). Each name is documented where it is declared, and
 * `x docs --check` fails a public export without its doc comment. Game code reaches three.js only through these
 * re-exports.
 *
 * @example
 * // fixtures/scenes/kernel/index.ts
 * // import { defineScene, defineComponent, held, type World } from '../../../engine/sim-api';
 * @see fixtures/scenes/kernel/index.ts
 */

// Scenes: defined as data with a setup and a step, run by x sim, x replay and createHeadless.
export { defineScene } from './sim/scene';
export type { Scene } from './sim/scene';
export type { SceneSpec } from './sim/scene';
export type { SceneAction } from './sim/scene';

// The world: entities, components, systems, timers, events.
export type { World } from './sim/world';
export type { SimRng } from './sim/world';
export type { WorldTimers } from './sim/world';
export type { WorldEvents } from './sim/world';
export { defineComponent } from './sim/state';
export type { Entity } from './sim/state';
export type { With } from './sim/state';
export type { SpawnSpec } from './sim/state';
export type { ComponentOf } from './sim/state';
export { PHASES } from './sim/systems';
export type { Phase } from './sim/systems';
export type { SystemFn } from './sim/systems';

// Registries and settings: content as data, one schema for every setting.
export { defineKind } from './core/registry';
export { def } from './core/registry';
export type { Entry } from './core/registry';
export type { Kind } from './core/registry';
export type { KindSpec } from './core/registry';
export type { Field } from './core/schema';
export type { Schema } from './core/schema';
export { defineSettings } from './core/settings';
export type { SimSettings } from './core/settings';
export type { SettingValue } from './core/settings';

// Intents: what the sim reads from outside each step.
export { held } from './input/intents';
export { pressed } from './input/intents';
export { fromCamera } from './input/intents';
export { INTENT_KEYS } from './input/intents';
export type { Intents } from './input/intents';
export type { IntentValue } from './input/intents';
export type { CustomIntentKey } from './input/intents';
export { createInputBuffer } from './input/intents';
export { updateInputBuffer } from './input/intents';
export { released } from './input/intents';
export { buffered } from './input/intents';
export { consume } from './input/intents';
export { consumeAll } from './input/intents';
export { repeated } from './input/intents';
export { BUFFER_STEPS } from './input/intents';
export { REPEAT_DELAY } from './input/intents';
export { REPEAT_RATE } from './input/intents';
export type { InputBuffer } from './input/intents';

// Math: three.js's math classes and the engine's helpers (MathUtils covers clamp, lerp, damp, smoothstep).
export { Vector3 } from './core/math';
export { Quaternion } from './core/math';
export { Matrix4 } from './core/math';
export { Euler } from './core/math';
export { Box3 } from './core/math';
export { Sphere } from './core/math';
export { Ray } from './core/math';
export { Plane } from './core/math';
export { Color } from './core/math';
export { MathUtils } from './core/math';
export { approach } from './core/math';
export { angDiff } from './core/math';
export { lerpAng } from './core/math';
export { approachAng } from './core/math';
export { smoothDamp } from './core/math';
export { ease } from './core/math';
export { swingTwist } from './core/math';

// Randomness: seeded streams (the world's are w.rng('<stream>')).
export { Rng } from './core/rng';

// Events: emitted with w.emit, heard with w.events.on.
export type { EventMap } from './core/events';
export type { Listener } from './core/events';
export type { TraceRecord } from './core/events';

// Levels: a legend of glyphs, level text compiled to plain data (heights, solid grid, colliders, meshes, spawns).
export { compileLevel } from './world/level/compile';
export type { CompileOptions } from './world/level/compile';
export { validateLevel } from './world/level/validate';
export type { LevelSource } from './world/level/validate';
export type { LevelProblem } from './world/level/problems';
export { defineGlyph } from './world/level/glyph';
export type { Glyph } from './world/level/glyph';
export type { GlyphSpec } from './world/level/glyph';
export { defineLevel } from './world/level/level';
export { getLevel } from './world/level/level';
export type { LevelEntry } from './world/level/level';
export { floorHeight } from './world/level/heights';
export { topHeight } from './world/level/heights';
export { solidAt } from './world/level/heights';
export { tileAt } from './world/level/heights';
export { LEVEL_FORMAT } from './world/level/types';
export type { CompiledLevel } from './world/level/types';
export type { LevelGlyph } from './world/level/types';
export type { BoxCollider } from './world/level/types';
export type { ColliderDescriptor } from './world/level/types';
export type { GroundDescriptor } from './world/level/types';
export type { MeshDescriptor } from './world/level/types';
export type { SpawnPoint } from './world/level/types';
export type { LightSpot } from './world/level/types';
export type { TileRect } from './world/level/types';
export type { Point3 } from './world/level/types';

// Animation (WP 3.4): the humanoid skeleton (a root plus 23 joints) and its builds, poses with three.js quaternions,
// blending under bone masks, additive layers, forward kinematics, SVG contact sheets and the pose checks.
export { JOINTS } from './anim/skeleton';
export { SOCKETS } from './anim/skeleton';
export { MASKS } from './anim/skeleton';
export type { JointName } from './anim/skeleton';
export type { SocketName } from './anim/skeleton';
export type { MaskName } from './anim/skeleton';
export { createSkeleton } from './anim/skeleton';
export type { Skeleton } from './anim/skeleton';
export { boneMask } from './anim/skeleton';
export type { BoneMask } from './anim/skeleton';
export { defineBuild } from './anim/builds';
export { getBuild } from './anim/builds';
export type { Build } from './anim/builds';
export type { BuildSpec } from './anim/builds';
export { Pose } from './anim/pose';
export type { JointRef } from './anim/pose';
export type { BlendOptions } from './anim/pose';
export { blendPoses } from './anim/pose';
export { makeAdditive } from './anim/pose';
export { addPose } from './anim/pose';
export { hashPose } from './anim/pose';
export { forwardKinematics } from './anim/fk';
export { createWorldPose } from './anim/fk';
export type { WorldPose } from './anim/fk';
export { jointPosition } from './anim/fk';
export { jointRotation } from './anim/fk';
export { jointMatrix } from './anim/fk';
export { jointToWorld } from './anim/fk';
export { socketPosition } from './anim/fk';
export { tipPosition } from './anim/fk';
export { animSheet } from './anim/sheet';
export type { Sheet } from './anim/sheet';
export type { SheetFrame } from './anim/sheet';
export type { SheetOptions } from './anim/sheet';
export type { SheetView } from './anim/sheet';
export { animCheck } from './anim/check';
export type { AnimCheckSpec } from './anim/check';
export type { AnimCheckReport } from './anim/check';
export type { AnimProblem } from './anim/check';
export type { RigidPair } from './anim/check';
export type { PointName } from './anim/check';
export { twoBone } from './anim/ik';
export { twoBoneRot } from './anim/ik';
export type { TwoBoneOptions } from './anim/ik';
export type { LimbEnd } from './anim/ik';
export type { Limb } from './anim/ik';
export { LIMBS } from './anim/ik';
export { aim } from './anim/ik';
export type { AimOptions } from './anim/ik';
export type { AimLink } from './anim/ik';
export { AIM_CHAIN } from './anim/ik';
export { footPlant } from './anim/ik';
export type { FootPlantOptions } from './anim/ik';
export type { FootPlantState } from './anim/ik';
export type { FootLock } from './anim/ik';
export { createFootPlantState } from './anim/ik';
export { FOOT_PLANT } from './anim/ik';
export type { GroundProbe } from './anim/ik';
export type { GroundHit } from './anim/ik';
export { handTo } from './anim/ik';
// The procedural humanoid (WP 3.6): my-3d2dge's gait, idle, lean, arm swing, held poses and stances as effector
// targets written with B(forward, right, up), solved onto the skeleton; a fixed step and a seeded stream.
export { Humanoid } from './anim/humanoid';
export type { HumanoidOptions } from './anim/humanoid';
export type { HumanoidInput } from './anim/humanoid';
export type { HumanoidState } from './anim/humanoid';
export type { HumanoidWeights } from './anim/locomotion';
export type { BodyMotion } from './anim/locomotion';
export { POSES } from './anim/poses';
export type { PoseName } from './anim/poses';
export { STANCES } from './anim/poses';
export type { StanceName } from './anim/poses';
export { WEAPONS } from './anim/poses';
export type { Weapon } from './anim/poses';
export type { Effectors } from './anim/poses';
export { B } from './anim/authoring';
export { turnRight } from './anim/authoring';
export type { FRU } from './anim/authoring';
export type { LimbSide } from './anim/authoring';
export type { Sided } from './anim/authoring';
// The character animator (WP 3.7): a body driven through an explicit layer stack (weights, base, override, solve,
// then layers in clips, additive, post, physics and secondary), told its body states each step (unknown words warn
// with the closest), with footsteps, sockets, a trail and detail levels; step runs in the sim, pose in the view.
export { Animator } from './anim/character';
export type { AnimatorOptions } from './anim/character';
export type { PoseOptions } from './anim/character';
export type { AnimatorReport } from './anim/character';
export type { AnimEvent } from './anim/character';
export type { TrailSample } from './anim/character';
export { BODY_STATES } from './anim/states';
export type { BodyStateName } from './anim/states';
export type { AnimatorInput } from './anim/states';
export { checkBodyStates } from './anim/states';
export { TRAILS } from './anim/states';
export type { TrailName } from './anim/states';
export { SAMPLE_STATES } from './anim/states';
export type { SampleState } from './anim/states';
export { SLOTS } from './anim/weights';
export type { SlotName } from './anim/weights';
export { LAYER_SLOTS } from './anim/weights';
export type { LayerSlot } from './anim/weights';
export type { AnimLayer } from './anim/weights';
export { LOD } from './anim/weights';
export { easeWeight } from './anim/weights';
export type { WeightRates } from './anim/weights';
export { HUMANOID_WEIGHTS } from './anim/weights';
export type { WeightInfo } from './anim/weights';
// Moves (WP 6.1): moves as data in metres (the kind move: my-3d2dge's 24, converted by Appendix C's table), timelines
// whose events carry leftover time, attacks and combos with hit windows, sweeps and root motion, moves played on a
// humanoid through its body state (the arm path), moves at a moment for previews, measured hit shapes, and the cone
// and knockback helpers.
export { defineMove } from './anim/moves-data';
export { getMove } from './anim/moves-data';
export { resolveMove } from './anim/moves-data';
export { MOVE_PHASES } from './anim/moves-data';
export { LEGACY_FIELDS } from './anim/moves-data';
export { fromLegacy } from './anim/moves-data';
export type { Move } from './anim/moves-data';
export type { MoveSpec } from './anim/moves-data';
export type { MoveInput } from './anim/moves-data';
export type { MovePhase } from './anim/moves-data';
export type { LegacyMove } from './anim/moves-data';
export { Timeline } from './anim/timeline';
export type { TimelinePhase } from './anim/timeline';
export type { TimelineMark } from './anim/timeline';
export type { TimelineEvent } from './anim/timeline';
export type { TimelineState } from './anim/timeline';
export { Attack } from './anim/timeline';
export { Combo } from './anim/timeline';
export type { AttackState } from './anim/timeline';
export type { ComboState } from './anim/timeline';
export type { Sweep } from './anim/timeline';
export { moveAt } from './anim/moves';
export { measureMove } from './anim/moves';
export type { HitShape } from './anim/moves';
export { strikePart } from './anim/moves';
export { strikeSegment } from './anim/moves';
export type { StrikeBody } from './anim/moves';
export type { StrikeAnimator } from './anim/moves';
export type { ArmState } from './anim/strike';
export { inArc } from './anim/moves';
export { inHitShape } from './anim/moves';
export { knockback } from './anim/moves';

// Physics (WP 3.1): Rapier behind plain terms. A scene with `physics: true` has a physics world: bodies by id,
// raycasts, shape casts, overlaps and ground probes, collision groups by name, a level's bodies; presentation reads
// it through the read-only QueryView.
export { physicsOf } from './physics/world';
export type { Physics } from './physics/world';
export type { BodySpec } from './physics/world';
export type { ColliderSpec } from './physics/world';
export type { BodyState } from './physics/world';
export type { BodyChange } from './physics/world';
export type { BodyType } from './physics/world';
export type { Shape } from './physics/queries';
export type { Vec3Like } from './physics/queries';
export type { QuatLike } from './physics/queries';
export type { Hit } from './physics/queries';
export type { Ground } from './physics/queries';
export type { QueryOptions } from './physics/queries';
export type { RayOptions } from './physics/queries';
export type { ShapeCastOptions } from './physics/queries';
export type { OverlapOptions } from './physics/queries';
export type { ProbeOptions } from './physics/queries';
export { COLLISION_GROUPS } from './physics/groups';
export type { GroupName } from './physics/groups';
export { PHYSICS_SETTINGS } from './physics/params';
export { addLevelBodies } from './sim/levelBodies';
export { queryViewOf } from './sim/queryView';
export type { QueryView } from './sim/queryView';

// Characters (WP 3.2): actors moved by the character controller (Rapier's, moved across then down), with an action
// game's feel: acceleration and skid, coyote time, a jump buffer, a variable jump, a wall jump, a dash, pushing props;
// the feel meter measures how one handles.
export { createCharacter } from './physics/character';
export type { Character } from './physics/character';
export { CHARACTER_FIELDS } from './physics/character';
export { CHARACTER_STATE_FIELDS } from './physics/character';
export type { CharacterState } from './physics/character';
export { spawnActor } from './sim/actors';
export { removeActor } from './sim/actors';
export type { ActorSpec } from './sim/actors';
export type { ActorComponent } from './sim/actors';
export type { ActorComponents } from './sim/actors';
export { measureFeel } from './sim/actors';
export type { FeelReport } from './physics/feel';
export type { FeelOptions } from './sim/actors';
export type { AnimatorComponent } from './sim/actors';

// Levels v2 (WP 4.2): the hall's glyphs (gallery =, stairs ^, dais o, brazier t), ramps and daises, hull and cylinder
// colliders, and the surface tag underfoot.
export { surfaceAt } from './world/level/heights';
export type { HullCollider } from './world/level/types';
export type { CylinderCollider } from './world/level/types';
export type { RampDescriptor } from './world/level/types';
export type { DaisDescriptor } from './world/level/types';
export type { Side } from './world/level/types';

// Navigation and spatial queries (WP 4.3): a level's walkable grid under a climb limit (the crowd's, or a hero's jump
// reach from measureFeel), A* paths smoothed by line of sight, cached flow fields with reach and a look-ahead
// direction, and a spatial hash on typed arrays for neighbours.
export { NavGrid } from './world/nav';
export { FlowField } from './world/nav';
export { NAV_GRID_FIELDS } from './world/nav';
export type { NavGridOptions } from './world/nav';
export type { FlowOptions } from './world/nav';
export type { GroundPoint } from './world/nav';
export { NAV_DIRECTIONS } from './world/nav';
export { LOOK_AHEAD } from './world/nav';
export { NEAREST_RINGS } from './world/nav';
export { NAV_CLIMB } from './world/level/validate';
export { SpatialHash } from './world/spatial';
export { SPATIAL_HASH_FIELDS } from './world/spatial';
export type { SpatialHashOptions } from './world/spatial';
