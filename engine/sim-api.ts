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
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). The Animation area lives in
 * engine/anim/api.ts, re-exported here whole so this file stays under its line cap (ADR-0020 amendment 8): append
 * animation names there; Phase 13's movement areas likewise in engine/sim/movementApi.ts (ADR-0025 amendment 7). Only sim-side modules are re-exported (ESLint's layer rule for this file). Each name is
 * documented where it is declared, and `x docs --check` fails a public export without its doc comment. Game code
 * reaches three.js only through these re-exports.
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
export type { SceneSound } from './sim/scene';

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

// Animation (WP 3.4 onward): skeleton, builds, poses, IK, the humanoid, moves, reactions, checks and actions, listed
// area by area in engine/anim/api.ts so this file stays under its line cap (ADR-0020 amendment 8).
export * from './anim/api';

// Physics (WP 3.1): Rapier behind plain terms. A scene with `physics: true` has a physics world: bodies by id,
// raycasts, shape casts, overlaps and ground probes, collision groups by name, a level's bodies; presentation reads
// it through the read-only QueryView.
export { physicsOf } from './physics/binding';
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
// the feel meter measures how one handles. A body's reactions and an actor's secondary motion as components (WP 7.8).
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
export { measureFeel } from './sim/feelCourse';
export type { FeelReport } from './physics/feel';
export type { FeelOptions } from './sim/feelCourse';
export type { AnimatorComponent } from './sim/actors';
export { reactTo } from './sim/reactions';
export { stepReactions } from './sim/reactions';
export { REACTION_FIELDS } from './sim/reactions';
export { SECONDARY_FIELDS } from './sim/reactions';
export type { SecondaryComponent } from './sim/reactions';
export type { ReactionComponents } from './sim/reactions';

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

// Bodies and props (WP 4.1): props of one shape in the prototype's material, torque impulses and the knock; movers,
// kinematic bodies whose pose is a function of time, carrying riders; sensors and triggers; the lost-body rescue.
export { PROP_MATERIAL } from './physics/bodies';
export type { PropSpec } from './physics/bodies';
export { addProp } from './physics/bodies';
export { addBox } from './physics/bodies';
export { addBall } from './physics/bodies';
export { addCapsule } from './physics/bodies';
export { addCylinder } from './physics/bodies';
export { applyTorqueImpulse } from './physics/bodies';
export { knock } from './physics/bodies';
export type { KnockOptions } from './physics/bodies';
export { MOVER_FIELDS } from './physics/bodies';
export { MOVER } from './physics/bodies';
export type { Mover } from './physics/bodies';
export { moverPose } from './physics/bodies';
export { driveBody } from './physics/bodies';
export { driveMover } from './physics/bodies';
export { addSensor } from './physics/bodies';
export type { SensorSpec } from './physics/bodies';
export { sensorHits } from './physics/bodies';
export { TRIGGER_FIELDS } from './physics/bodies';
export type { Trigger } from './physics/bodies';
export { updateTrigger } from './physics/bodies';
export { rescueLost } from './physics/bodies';
export type { RescueLevel } from './physics/bodies';
// Props as data (WP 4.5): the registry kind `prop` (meshes by geometry and material id, a body, a light spot, where a
// level places it, the hit and use hooks), the engine's crate, barrel, brazier fire and pillar, and their placement.
export { defineProp } from './world/props/prop';
export { getProp } from './world/props/prop';
export { propCentre } from './world/props/prop';
export type { Prop } from './world/props/prop';
export type { PropDefinition } from './world/props/prop';
export type { PropPart } from './world/props/prop';
export type { PropTouch } from './world/props/prop';
export type { PropKnock } from './world/props/prop';
export { levelProps } from './world/props/place';
export { propBody } from './world/props/place';
export { propPose } from './world/props/place';
export type { PropPlacement } from './world/props/place';
export type { PropBody } from './world/props/place';
export type { PropPose } from './world/props/place';
// Props in a scene (WP 4.6): spawnProp stands a prop in a running scene (its body, and an entity with the component
// sceneProp whose pose is read back after each step, which the view draws as the prop); hitProp calls its hit hook
// with the means to knock it; removeProp.
export { spawnProp } from './sim/props';
export { removeProp } from './sim/props';
export { hitProp } from './sim/props';
export { SCENE_PROP_FIELDS } from './sim/props';
export type { ScenePropComponent } from './sim/props';
export type { ScenePropComponents } from './sim/props';

// Crowd bodies (WP 5.1): agents as dynamic capsules and balls driven by the velocities their AI wants (approach
// limits, only on their feet), knockback and launches, the corpse group and its timers, spawn and despawn queues.
export { CROWD_AGENT_FIELDS } from './physics/crowd';
export { CROWD_AGENT } from './physics/crowd';
export type { CrowdAgent } from './physics/crowd';
export type { AgentState } from './physics/crowd';
export { CROWD_MATERIAL } from './physics/crowd';
export { CROWD_LIMITS } from './physics/crowd';
export { CROWD_GROUNDED } from './physics/crowd';
export { addAgent } from './physics/crowd';
export { removeAgent } from './physics/crowd';
export { setVelocity } from './physics/crowd';
export type { VelocityOptions } from './physics/crowd';
export { knockback } from './physics/crowd';
export { launch } from './physics/crowd';
export { killAgent } from './physics/crowd';
export { updateCrowd } from './physics/crowd';
export type { CrowdOptions } from './physics/crowd';
export type { CrowdChanges } from './physics/crowd';
export type { CrowdStepper } from './physics/crowd';

// Steering kit (WP 5.2): the velocity a crowd agent wants (seek and arrive, flow-field following, approach rings, a
// flyer's hover, a jumper's hop), attack tokens that cap the attackers at once, and awareness by distance and sight.
export { seek } from './world/steer';
export { followFlow } from './world/steer';
export { approachRing } from './world/steer';
export { hover } from './world/steer';
export { airTime } from './world/steer';
export { hop } from './world/steer';
export { FOLLOW } from './world/steer';
export { APPROACH_RING } from './world/steer';
export { HOVER } from './world/steer';
export { HOP } from './world/steer';
export type { SteerPoint } from './world/steer';
export type { FollowOptions } from './world/steer';
export type { ApproachRingOptions } from './world/steer';
export type { HoverOptions } from './world/steer';
export { ATTACK_TOKENS_FIELDS } from './world/ai';
export { ATTACK_TOKENS } from './world/ai';
export type { AttackTokens } from './world/ai';
export { takeToken } from './world/ai';
export { releaseToken } from './world/ai';
export { holdsToken } from './world/ai';
export { keepTokens } from './world/ai';
export { canSee } from './world/ai';
export { clearSight } from './world/ai';
export { SIGHT } from './world/ai';
export type { SightOptions } from './world/ai';

// Crowd bodies (WP 5.7): a crowd member's look and rig (a humanoid in a build, a blob, a floater) in the component
// crowdBody, its rig stepped in the sim by stepCrowdBody; the stage draws them through a crowd with its level of detail.
export { CROWD_BODY_FIELDS } from './sim/crowdBodies';
export { CROWD_BODY } from './sim/crowdBodies';
export type { CrowdBody } from './sim/crowdBodies';
export type { CrowdRig } from './sim/crowdBodies';
export type { CrowdBodyInput } from './sim/crowdBodies';
export { stepCrowdBody } from './sim/crowdBodies';

// Telegraphs (WP 6.4): an attack's warning shape on the floor as data (an arc, a ring, a line or a cone, in metres),
// and the geometry sim code tests it with as it goes off: a body inside it is hit, one just outside it a near miss.
export { TELEGRAPH_SHAPES } from './world/telegraphs';
export { defineTelegraph } from './world/telegraphs';
export { getTelegraph } from './world/telegraphs';
export { telegraphGap } from './world/telegraphs';
export { inTelegraph } from './world/telegraphs';
export { nearMiss } from './world/telegraphs';
export { telegraphFill } from './world/telegraphs';
export { coneOf } from './world/telegraphs';
export type { Telegraph } from './world/telegraphs';
export type { TelegraphSpec } from './world/telegraphs';
export type { TelegraphPlace } from './world/telegraphs';
export type { PointLike } from './world/telegraphs';

// Combat helpers (WP 6.3): hit queries against hurt capsules found through a spatial hash (cones with height windows,
// weapon sweeps), damage on health and crowd bodies (knockback as momentum, launches, death into the corpse group, the
// event damage), hit-stop handed to the frame clock's budget, and projectiles with swept tests.
export { PROJECTILE_FIELDS } from './world/projectiles';
export { PROJECTILE } from './world/projectiles';
export type { Projectile } from './world/projectiles';
export type { ProjectileState } from './world/projectiles';
export type { ProjectileStep } from './world/projectiles';
export type { ProjectileHit } from './world/projectiles';
export { stepProjectiles } from './world/projectiles';
export type { HurtCapsule } from './world/projectiles';
export type { HurtSet } from './world/projectiles';
export { capsuleCast } from './world/projectiles';
export type { WallTest } from './world/projectiles';
export type { WallContact } from './world/projectiles';
export { inCone } from './sim/hits';
export { coneHits } from './sim/hits';
export { sweepTouches } from './sim/hits';
export { sweepHits } from './sim/hits';
export { physicsWalls } from './sim/hits';
export { HEALTH_FIELDS } from './sim/damage';
export { HEALTH } from './sim/damage';
export type { Health } from './sim/damage';
export type { DamageTarget } from './sim/damage';
export type { HitSpec } from './sim/damage';
export type { DamageEvent } from './sim/damage';
export type { DamageEvents } from './sim/damage';
export { damage } from './sim/damage';
export { requestHitStop } from './sim/damage';

// Clips on actors (WP 8.9): the clip layer in an actor's animator as sim data, the component clips, stepped at the
// actor's ground speed and drawn over its body by the view; its events come as `clip`. spawnActor's `body` names the
// body it is drawn as (body:mannequin).
export { addClips } from './sim/actorClips';
export type { ClipsSpec } from './sim/actorClips';
export { playClip } from './sim/actorClips';
export { stopClip } from './sim/actorClips';
export { seekClip } from './sim/actorClips';
export { locomoteClips } from './sim/actorClips';
export { clipLayerOf } from './sim/actorClips';
export type { PuppetComponent } from './sim/actors';

// Movement (Phase 13): movement profiles and the shooter model, its live tuning and placing (the feel kit), and the
// rides; listed in engine/sim/movementApi.ts, re-exported whole so this file stays under its line cap.
export * from './sim/movementApi';
