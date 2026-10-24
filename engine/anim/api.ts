/**
 * @file The animation part of the public sim API (PLAN.md §6.1, WP 8.7 integration, ADR-0020 amendment 8): every
 * name sim-side game code takes from engine/anim/, re-exported whole by engine/sim-api.ts, so engine/sim-api.ts stays
 * under its line cap. Game code imports these names from engine/sim-api.ts (or engine/index.ts), never from here: the
 * public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only; each WP appends its animation names at the end of their area. Only engine/anim/ modules are
 * re-exported, and each name is documented where it is declared.
 *
 * @example
 * // an action module made by `node x new action`, e.g. labs/box/actions/bow.ts
 * // import { defineAction } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Animation (WP 3.4): the humanoid skeleton (a root plus 23 joints) and its builds, poses with three.js quaternions,
// blending under bone masks, additive layers, forward kinematics, SVG contact sheets and the pose checks.
export { JOINTS } from './skeleton';
export { SOCKETS } from './skeleton';
export { MASKS } from './skeleton';
export type { JointName } from './skeleton';
export type { SocketName } from './skeleton';
export type { MaskName } from './skeleton';
export { createSkeleton } from './skeleton';
export type { Skeleton } from './skeleton';
export { boneMask } from './skeleton';
export type { BoneMask } from './skeleton';
export { defineBuild } from './builds';
export { getBuild } from './builds';
export type { Build } from './builds';
export type { BuildSpec } from './builds';
export { Pose } from './pose';
export type { JointRef } from './pose';
export type { BlendOptions } from './pose';
export { blendPoses } from './pose';
export { makeAdditive } from './pose';
export { addPose } from './pose';
export { hashPose } from './pose';
export { forwardKinematics } from './fk';
export { createWorldPose } from './fk';
export type { WorldPose } from './fk';
export { jointPosition } from './fk';
export { jointRotation } from './fk';
export { jointMatrix } from './fk';
export { jointToWorld } from './fk';
export { socketPosition } from './fk';
export { tipPosition } from './fk';
export { animSheet } from './sheet';
export type { Sheet } from './sheet';
export type { SheetFrame } from './sheet';
export type { SheetOptions } from './sheet';
export type { SheetView } from './sheet';
export { animCheck } from './check';
export type { AnimCheckSpec } from './check';
export type { AnimCheckReport } from './check';
export type { AnimProblem } from './check';
export type { RigidPair } from './check';
export type { PointName } from './check';
export { twoBone } from './ik';
export { twoBoneRot } from './ik';
export type { TwoBoneOptions } from './ik';
export type { LimbEnd } from './ik';
export type { Limb } from './ik';
export { LIMBS } from './ik';
export { aim } from './ik';
export type { AimOptions } from './ik';
export type { AimLink } from './ik';
export { AIM_CHAIN } from './ik';
export { footPlant } from './footPlant';
export type { FootPlantOptions } from './footPlant';
export type { FootPlantState } from './locomotion/locks';
export type { FootLock } from './locomotion/locks';
export { createFootPlantState } from './locomotion/locks';
export { FOOT_LOCK } from './locomotion/locks';
export { FOOT_PLANT } from './footPlant';
export { FootPlant } from './footPlant';
export type { FootPlantLayerOptions } from './footPlant';
export { queryGround } from './footPlant';
export type { GroundQueries } from './footPlant';
export type { GroundProbe } from './ik';
export type { GroundHit } from './ik';
export { handTo } from './ik';
// The procedural humanoid (WP 3.6): my-3d2dge's gait, idle, lean, arm swing, held poses and stances as effector
// targets written with B(forward, right, up), solved onto the skeleton; a fixed step and a seeded stream.
export { Humanoid } from './humanoid';
export type { HumanoidOptions } from './humanoid';
export type { HumanoidInput } from './humanoid';
export type { HumanoidState } from './humanoid';
export type { HumanoidWeights } from './locomotion';
export type { BodyMotion } from './locomotion';
export { POSES } from './poses';
export type { PoseName } from './poses';
export { STANCES } from './poses';
export type { StanceName } from './poses';
export { WEAPONS } from './poses';
export type { Weapon } from './poses';
export type { Effectors } from './poses';
export { B } from './authoring';
export { turnRight } from './authoring';
export type { FRU } from './authoring';
export type { LimbSide } from './authoring';
export type { Sided } from './authoring';
// The character animator (WP 3.7): a body driven through an explicit layer stack (weights, base, override, solve,
// then layers in clips, additive, post, physics and secondary), told its body states each step (unknown words warn
// with the closest), with footsteps, sockets, a trail and detail levels; step runs in the sim, pose in the view.
export { Animator } from './character';
export type { AnimatorOptions } from './character';
export type { PoseOptions } from './character';
export type { AnimatorReport } from './character';
export type { AnimEvent } from './character';
export type { TrailSample } from './character';
export { BODY_STATES } from './states';
export type { BodyStateName } from './states';
export type { AnimatorInput } from './states';
export { checkBodyStates } from './states';
export { TRAILS } from './states';
export type { TrailName } from './states';
export { SAMPLE_STATES } from './states';
export type { SampleState } from './states';
export { SLOTS } from './weights';
export type { SlotName } from './weights';
export { LAYER_SLOTS } from './weights';
export type { LayerSlot } from './weights';
export type { AnimLayer } from './weights';
export { LOD } from './weights';
export { easeWeight } from './weights';
export type { WeightRates } from './weights';
export { HUMANOID_WEIGHTS } from './weights';
export type { WeightInfo } from './weights';
// Blob and floater rigs (WP 5.3): my-3d2dge's squash-and-stretch blob on a minimal skeleton (a volume-preserving
// squash spring, a smoothed look, wings, its moves as data: bite, leap, pounce, spit) and a floater that hovers over
// the floor, banks into turns and carries orbiting motes; step runs in the sim, pose in the view.
export { Blob } from './blob';
export type { BlobOptions } from './blob';
export type { BlobInput } from './blob';
export type { BlobState } from './blob';
export { BLOB } from './blob';
export { BLOB_JOINTS } from './blob';
export type { BlobJoint } from './blob';
export type { BlobPose } from './blob';
export { BLOB_LEAP } from './blob';
export type { BlobLeap } from './blob';
export { BLOB_MOVES } from './blob';
export type { BlobMove } from './blob';
export type { BlobMoveName } from './blob';
export type { BlobMoveFrame } from './blob';
export { blobMove } from './blob';
export { blobMoveTimes } from './blob';
export { Floater } from './floater';
export type { FloaterOptions } from './floater';
export type { FloaterInput } from './floater';
export type { FloaterState } from './floater';
export type { FloaterPose } from './floater';
export { FLOATER } from './floater';
// The animation library (WP 8.4): readable key-pose clips (format 1 and 2: parse, print, check, the normalized lens,
// mirroring, the decode to 36 body points), loaded per set; baked to 30 fps rotation tracks on the skeleton,
// retargeted onto any build (rotation copy aligned at rest, the hip-height ratio, contact IK) or given to three.js as
// AnimationClip JSON; played by the clip layer in the animator's clip slot, loops at the ground speed, with shardfall's
// walk-run switch and strike time.
export { parseClip } from './clip/validate';
export { parseClipSet } from './clip/validate';
export { validateClip } from './clip/validate';
export { poseError } from './clip/validate';
export { poseMeanError } from './clip/validate';
export type { ClipSet } from './clip/validate';
export type { ClipSource } from './clip/validate';
export type { RestBody } from './clip/validate';
export type { ClipWarning } from './clip/validate';
export { clipText } from './clip/lens';
export { normalizedLens } from './clip/lens';
export { mirrorClip } from './clip/mirror';
export { decodePose } from './clip/readable';
export { samplePose } from './clip/readable';
export { POSE_POINTS } from './clip/readable';
export { POINT_INDEX } from './clip/readable';
export type { Clip } from './clip/readable';
export type { ClipKey } from './clip/readable';
export type { KeyPose } from './clip/readable';
export type { LimbPose } from './clip/readable';
export type { ClipEvent } from './clip/readable';
export type { ClipContact } from './clip/readable';
export { bakeClip } from './clip/bake';
export { sampleBaked } from './clip/bake';
export { travelAt } from './clip/bake';
export { BAKE_FPS } from './clip/bake';
export type { BakedClip } from './clip/bake';
export { retargetPose } from './clip/retarget';
export type { RetargetOptions } from './clip/retarget';
export { clipJSON } from './clip/retarget';
export type { AnimationClipJSON } from './clip/retarget';
export { hipRatio } from './clip/retarget';
export { standingHipHeight } from './clip/retarget';
export { restSkeleton } from './clip/rest';
export { restPoints } from './clip/rest';
export { restBuild } from './clip/rest';
export { RETARGET } from './clip/retarget';
export { loadClipLibrary } from './clip/library';
export type { ClipLibrary } from './clip/library';
export type { ClipOrigin } from './clip/library';
export { clipPace } from './clip/library';
export { walkRate } from './clip/library';
export { runOverWalk } from './clip/library';
export { strikeTime } from './clip/library';
export { GROUND_SPEED } from './clip/library';
export { STRIKE } from './clip/library';
export { ClipLayer } from './clip/layer';
export { CLIP_LAYER } from './clip/layer';
export type { ClipLayerOptions } from './clip/layer';
export type { ClipPlay } from './clip/layer';
export type { ClipSlot } from './clip/layer';
export type { ClipLayerState } from './clip/layer';
export type { ClipLayerEvent } from './clip/layer';
export type { ClipStepInput } from './clip/layer';
// Moves (WP 6.1): moves as data in metres (the kind move: my-3d2dge's 24, converted by Appendix C's table), timelines
// whose events carry leftover time, attacks and combos with hit windows, sweeps and root motion, moves played on a
// humanoid through its body state (the arm path), moves at a moment for previews, measured hit shapes, the cone
// helpers and a hit's knockback velocity.
export { defineMove } from './moves-data';
export { getMove } from './moves-data';
export { resolveMove } from './moves-data';
export { MOVE_PHASES } from './moves-data';
export { LEGACY_FIELDS } from './moves-data';
export { fromLegacy } from './moves-data';
export type { Move } from './moves-data';
export type { MoveSpec } from './moves-data';
export type { MoveInput } from './moves-data';
export type { MovePhase } from './moves-data';
export type { LegacyMove } from './moves-data';
export { Timeline } from './timeline';
export type { TimelinePhase } from './timeline';
export type { TimelineMark } from './timeline';
export type { TimelineEvent } from './timeline';
export type { TimelineState } from './timeline';
export { Attack } from './attack';
export { Combo } from './attack';
export type { AttackState } from './attack';
export type { ComboState } from './attack';
export type { Sweep } from './attack';
export { moveAt } from './moves';
export { measureMove } from './moves';
export type { HitShape } from './moves';
export { strikePart } from './moves';
export { strikeSegment } from './moves';
export type { StrikeBody } from './moves';
export type { StrikeAnimator } from './moves';
export type { ArmState } from './strike';
export { inArc } from './moves';
export { inHitShape } from './moves';
export { knockbackVelocity } from './moves';
// Reactions and secondary motion (WP 6.2): a directional flinch, knockdown, death and the get-up chosen by how the
// body lies (face up or face down), stepped in the sim; verlet chains (hair, tails) with bone-capsule colliders, a
// floor probe and a rest shape, a cape of two chains, and the squash spring as a volume-preserving root scale, drawn
// by an animator layer in the view.
export { Reactions } from './reactions';
export type { ReactionOptions } from './reactions';
export type { ReactionState } from './reactions';
export type { ReactionBody } from './reactions';
export type { ReactionName } from './reactions';
export { REACTION } from './reactions';
export { REACTIONS } from './reactions';
export type { Lying } from './reactions';
export { lyingOf } from './reactions';
export { Chain } from './chain';
export type { ChainOptions } from './chain';
export type { ChainTuning } from './chain';
export type { BoneCapsule } from './chain';
export { CHAIN } from './chain';
export { Cape } from './chain';
export type { CapeOptions } from './chain';
export { Secondary } from './secondary';
export type { SecondaryOptions } from './secondary';
export { HAIR } from './secondary';
export { CAPE } from './chain';
export { TAIL } from './secondary';
export { SQUASH } from './secondary';
export { squashScale } from './secondary';
export { BODY_CAPSULES } from './secondary';
export { bodyCapsules } from './secondary';

// Animation checks (WP 6.6): the state matrix (each body state held at each facing, from rest and back to rest) and
// animCheckBody, which checks a whole body over it: every pose, the same hashes twice, 1/60 s against 1/120 s; and the
// camera presets sheets of it are drawn from.
export { stateMatrix } from './stateMatrix';
export { STATE_MATRIX } from './stateMatrix';
export type { MatrixState } from './stateMatrix';
export type { MatrixRun } from './stateMatrix';
export type { StateMatrixOptions } from './stateMatrix';
export { animCheckBody } from './check';
export type { BodyCheckOptions } from './check';
export type { BodyCheckReport } from './check';
export type { AnimCheckName } from './check';
export { SHEET_CAMERAS } from './stateMatrix';

// Actions (WP 8.7): multi-beat sequences a body plays, beats of body states, clips, IK targets, flips and squashes
// with held contact frames, events, flags and cancel windows; the engine's set is data/anim/actions/, which
// loadActions defines.
export { Actions } from './actions';
export type { ActionsOptions } from './actions';
export type { ActionsState } from './actions';
export { defineAction } from './actions-data';
export { getAction } from './actions-data';
export { loadActions } from './actions-data';
export { actionCheck } from './actions-check';
export type { Action } from './actions-data';
export type { Beat } from './actions-data';
export type { ActionSpec } from './actions-data';
export { ACTION } from './actions-data';
export { FLIP_AXES } from './actions-data';
export { EFFECTORS } from './actions-data';
export { CHANNELS } from './actions';

// Clip sets in the registry (WP 8.9): the kind clipset, one entry per set of readable clips, which a page or tool
// registers from data/anim/sets/ (defineClipSet), and the clip layer of an entity kept as plain data, loaded from it
// at every use (ClipLayerPool), as an actor's component clips holds it.
export { defineClipSet } from './clip/clipsets';
export { clipSetFromFiles } from './clip/clipsets';
export { getClipSet } from './clip/clipsets';
export { clipSetId } from './clip/clipsets';
export { clipSetIds } from './clip/clipsets';
export { defineSetBuild } from './clip/clipsets';
export type { ClipSetEntry } from './clip/clipsets';
export { CLIPSET_FIELDS } from './clip/clipsets';
export { CLIPS_FIELDS } from './clip/clipsets';
export type { ClipsData } from './clip/clipsets';
export { emptyClipState } from './clip/clipsets';
export { ClipLayerPool } from './clip/clipsets';

// The quadruped rig (WP 13.21): a dog on the planted gait for a crowd body (the rig `quadruped`), its state plain
// data, its pose the joints its body is drawn on, and its rig contract for the anim QA.
export { Quadruped } from './quadruped';
export { QUADRUPED } from './quadruped';
export { QUADRUPED_LEGS } from './quadruped';
export { QUADRUPED_RIG } from './quadruped';
export type { QuadrupedOptions } from './quadruped';
export type { QuadrupedInput } from './quadruped';
export type { QuadrupedState } from './quadruped';
export type { QuadrupedPose } from './quadruped';
export type { QuadrupedBone } from './quadruped';
