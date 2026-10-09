# C. Rig and animation core of `engine/my-3d2dge.js`

Source: `my-3d2dge` v0.14.0 at `e37e4ee`. Every `file:line` below is relative to the source repo. Line numbers with no file are in `engine/my-3d2dge.js`.
Scope: §1 MATH (69–205), §8 PARTICLES (936–1037, structure only), §10 GAME (1472–1739), §11 HUMANOID RIG (1740–2583: `Humanoid`, `Attack`, `Combo`, `E.MOVES`), and §12 BLOB (2584–2673). I compared these with the agent edition (`engine/my-3d2dge-agent.js`) and with the consumers: `src/stress-world/30-crowd.js`, `src/stress-world/20-sim.js`, `src/lab3d/40-characters.js` and `src/mocap/mocap.js` (interface only).
To check a few claims, I loaded the engine read-only in a Node VM. The probe script is at `scratchpad/c-rig/probe.mjs`, and its results are quoted where they are used.

---

## 0. Decisions in brief

- **The rig is already a real 3D skeleton.** Every step it computes 15 joint points plus a blade direction in a body-local 3D frame, using procedural effector targets and two-bone IK. Only drawing projects them. Of §11's 77 KB, about **38 KB is portable animation logic** and about **42 KB is Canvas2D pixel-art drawing**, which only Card mode needs.
- **It stores joint positions, not a rotation skeleton.** It has no bone orientations (no twist or roll, no head orientation) and no explicit parent table. Mocap needs orientations, so it passes them through a side channel (`mocapTilt`).
- **Keep these, ported as logic and data:**
  - effector-space procedural layers, with named weights eased by `approach`;
  - the gait and idle formulas;
  - the move model: anticipation, strike, overshoot and hold, blend back by position, and chaining from the current pose;
  - the `Attack` and `Combo` timers;
  - `E.MOVES` as data;
  - verlet cape and hair;
  - the world-space weapon trail;
  - `E.move(name, u, phase)`, which gives deterministic previews.
- **Do not carry these over:**
  - view leaks into the simulation: `_cheat`, `_pitch` → `sidePlane`, and `_camSide`;
  - `charView`, `charPitch` and `zBoost`;
  - the knockdown that rotates every joint;
  - `Mocap.drive` monkey-patching instance methods;
  - `Math.random` seeding;
  - substeps whose size changes with the display's refresh rate.
- **Proposed new module, `anim/`:**
  - a rotation-based skeleton (local quaternions, with forward kinematics (FK) giving positions) as the canonical output;
  - procedural layers kept in effector space and solved into rotations by IK;
  - moves as data, with events, hit sweeps and root-motion curves;
  - generic verlet chains;
  - a strict fixed step;
  - tools that let agents inspect and check their own work.
  - Size: about 55–70 KB, roughly 16–20k tokens. Card-mode drawing is **not** ported; it would bring about 57 KB of 2D code with it.

---

## 1. Rig data model

### 1.1 Skeleton and implicit hierarchy

`JOINT_KEYS` (1753) holds 15 points: `hipL hipR kneeL kneeR footL footR hipC shC shL shR head elbowL elbowR handL handR`. `J.bladeDir` (1986) is a unit vector. There is no parent table. The hierarchy exists only as the evaluation order inside `_pose()` (1917–1994):

```
hipC (pelvis: the body's root)
 ├─ hipL / hipR = hipC ± hipHalf along r, rotated by twist·0.4                      (1925)
 │    └─ kneeL/R, footL/R = ik3(hip, footTarget, legUpper, legLower, hint [1, ±.15, .1])   (1939)
 └─ shC = hipC + leanDir·torso                                                       (1944)
      ├─ shL / shR = shC ± shoulderHalf, rotated by twist                            (1946)
      │    └─ elbowL/R, handL/R = ik3(sh, handTarget, armUpper, armLower, hint [-1, ±.7, -.2])  (1976)
      │         └─ bladeDir (the weapon in handR)                                    (1979-1988)
      └─ head = shC + norm(leanDir + [hunch·.9, 0, 0])·(neck + headR)   (a centre point, with no orientation)  (1947)
```

- The `foot*` points are the sole: z = 0 when standing. Drawing adds a toe 1.9 units forward (2134).
- In the probe, chibi joints at rest are hipC z 11.6, shC 19.3 and head 24.2, with the head top at about 27.6. Other builds' head tops: heroic 31.5, bulky 28.9, skeleton 30.1.
- IK keeps limb lengths exact. Even knocked down, thigh = 6.000, shin = 6.000 and torso = 8.000.
- `BUILDS` (1755–1761) sets proportions and gait for chibi (the defaults, 1767), heroic, bulky and skeleton. Some fields only affect drawing: `limbW`, `torsoW`, `hair`, `sleeves` and `eyeGlow`.

### 1.2 Frames, units and facing

- **World** (header 9): x = east, y = south, z = up. One tile = 16 units. This frame is **left-handed**.
  - The 3D labs use U = 16 units per metre and swap axes: `toThree = (x,y,z) => (x/U, z/U, y/U)` (`src/stress-world/00-setup.js:39,53`).
  - So Rapier quaternions need sign flips: `_pq.set(-p.q[0], -p.q[2], -p.q[1], p.q[3])` (`30-crowd.js:320-321`).
  - Feeding gameplay into the rig needs the swap back: `heroRig.update(dt, { x: h.x * U, y: h.z * U, z: h.y * U, ... })` (`lab3d/40-characters.js:256`).
- **Rig local frame** (1742): f = forward, r = right, z = up. It is also left-handed. A positive attack angle swings "toward the right hand" (1744).
- **Facing:** `facing` is a ground angle in radians, with 0 = east and π/2 = south (`angleTo`, 188). `spin` adds a whole-body turn (spin moves and mocap heading). `_cheat` adds the camera cheat (§4.3).
- **Units:** "engine units". `size` scales the body at world placement only, so `J` stays in build units whatever the size. A size-1 chibi is about 27.6 units tall, about 1.7 m at U = 16.

### 1.3 `rig.J` and `rig._w`

`J` is rebuilt every `_pose` call; the `V3` helpers allocate new arrays. `_w` (1794–1797) turns a local point into a world offset from (x, y, z):

```js
_w(p) {
  const a = this.facing + this.spin + this._cheat, c = Math.cos(a), s = Math.sin(a), sz = this.o.size, k = (1 - this.sq * .4) * sz;
  return [(p[0] * c - p[1] * s) * k, (p[0] * s + p[1] * c) * k, p[2] * (1 + this.sq) * sz];
}
```

It applies yaw, size, and squash (horizontal × (1 − 0.4·sq), vertical × (1 + sq)). Three methods expose world-space sockets:

- `hand(which)` (1790);
- `tip()` (1792): the gun muzzle at 5, the staff orb at 10, the sword tip at `bladeLen`;
- `head()` (1996).

The labs use `_w` in two ways:

- **Directly:** `worldPoint` in `lab3d/40-characters.js:80`.
- **Re-implemented without allocation and without the cheat:** `frame()` and `wp()` in `30-crowd.js:79-88`, with the comment "the puppet ignores the 2D three-quarter cheat".

### 1.4 Per-step API

`update(dt, s)` (1803) takes a state bag `s`. No key is validated except `attack.spec`.

| key | effect |
|---|---|
| `x, y, z` | root position. `x` and `y` are copied as given (`this.x = s.x`, 1806, so omitting them gives undefined); `z` defaults to 0 |
| `vx, vy` | speed drives the gait weight `spW`; direction becomes the local move direction `mv` (strafe and backpedal) |
| `facing` | yaw. It resets to 0 if omitted, so it must be passed every step |
| `run` | 0..1 runs in place |
| `dash, hurt, air, point, climb` | booleans that drive eased weights |
| `aim` | gun pitch while `point` |
| `vz` | climb speed (sets the pace of hand-over-hand on a ladder) |
| `pose` | `'cheer' 'cast' 'guard' 'kneel' 'crouch' 'wave' 'hips' 'block' 'die' 'down'` |
| `down` | 0..1 knock-down amount (overrides `pose`) |
| `stance` | `'guard'` (fists up while moving), `'ready'` (weapon forward) |
| `attack` | `{ spec, phase: 'wind' \| 'active' \| 'recover', u: 0..1 }` |
| `expr` | `'smile' 'shout' 'angry' 'wince'`: face drawing only |

- **Options** (`this.o`, 1766–1771):
  - proportions;
  - gait: `stride 6.5, lift 3.4, swing 4, speedRef 70`;
  - `lean` and `hunch`;
  - `weapon` (`sword | gun | staff | null`) and `bladeLen`;
  - `cape {len, width, seg, body}` and `hair` (`long` and `ponytail` are simulated);
  - `cheat` (0.5 rad);
  - `swingPlane` and `charView`;
  - drawing-only options: style, outfit, sleeves, armor, hood, hat and colors.
- **Other methods:** `kick(v)` adds a squash impulse (1788). `_pose()`, `_cape(dt)` and `_hair(dt)` are internal but called from outside (Mocap, `drawPortrait`).
- **State size:** 31 own fields after construction and **53 after a walk, attack and pose run** (probe). Draw and mocap code adds more: `_pitch, _lastView, _camSide, _ops, _pv, _pcs, mocap, mocapW, mocapMask, mocapBlade, mocapTilt, _ownSpin, _talk, climbP`, plus `_cc`/`_cf`, which the crowd lab caches on the rig. About 20 fields are created lazily with `||`.

### 1.5 Drawing entry points (all Canvas2D, at a projected root `(ox, oy)`)

- `draw(g, ox, oy, view)` (2086) sets `_pitch`, applies `charView`, sets `_camSide` and `_cheat`, then dispatches to `_drawHD` (2100–2305) or `_drawClassic` (2307–2383).
  - Parts are pushed into `ops` with a camera depth `d`, sorted, then painted (2303–2304).
  - It runs inside `r.actor(x, y, z, (g, ox, oy) => rig.draw(g, ox, oy, r.view), opts)` (renderer 1290), which adds outline, rim, flash, ghosts and x-ray.
- `drawSmear(r, colors)` (2406): the trail as a dithered ribbon, or a ground-plane smear arc.
- `drawPortrait(g, x, y, size, o)` (2004): a dialog bust that re-poses the rig temporarily.
- `debug(r)` (2444): a skeleton overlay. `_hat` (2384): five hat styles.
- Blob: `draw(g, ox, oy, view)` → `_drawBody` (2609–2670).

### 1.6 The de-facto "body contract"

`docs/CHARACTERS.md:65` lists it:

- methods: `update(dt, s)`, `draw`, `drawSmear`, `drawPortrait`, `kick`, `hand`, `head`, `tip`, `_w`;
- joints: `J`, with at least `hipC, shC, head, handL, handR, bladeDir`;
- fields: `o.size`, `C`, and `x, y, z, facing, t, phase`.

Custom bodies keep this contract. `DanRig` (`src/emberdeep/22-char-dan.js:21`) runs unchanged in the 3D lab ("any engine rig (J, x, y, z, _w, update, draw)", `lab3d/40-characters.js:18`).

Emberdeep's `checkRig` (`src/emberdeep/18-characters.js:81-140`) is the best agent-testing idea in the repo, and it is worth reviving. It drives a body through:

- the 14 `CHAR_STATES` (idle, run, dodge, jump, wind-up, strike, follow-through, cast, guard, hurt, knocked down, death, cheer, wave);
- 2 facings and 5 views;
- checks for finite joints, sockets near the body, and `kick`.

It reports problems as plain sentences.

---

## 2. Animation layers

### 2.1 Evaluation order

`update()` (1803–1898) runs these steps in order:

1. **Teleport check** (1805): a jump of more than 24·size resets cloth, hair and trail.
2. **Gait speed and phase:**
   - `spW` approaches the speed at rate 7;
   - `mv` lerps at `dt·10`;
   - `phase += dt·speed / (stride·size·max(.4, min(1, spW)))` (1813).
3. **Weights**, each eased by `approach(w, target, dt·rate)`, with rise/fall rates as given:
   - `dashW` 24/8, `hurtW` 14, `atkW` 30/7, `airW` 10/18;
   - 8 `poseW` entries at 9, `stW`/`rdW` at 10, `climbW` at 12, `pointW` 30/8, `aimA` 14;
   - `downW` rises at 2.5 + 10·downW (it falls faster and faster) and recovers at 3.2;
   - the `dieT` timeline.
4. **Blink** (random) and the **squash spring** (1831–1832).
5. **Attack:** `theta`/`atkZ`/`reach`, body targets (lean, lunge, hop, crouch, twist) and `smear` (1834–1876).
6. **Smoothing:** `armW`, then `lerp(…, min(1, dt·k))` on `lunge` 22, `hop` 25, `crouchA` 20, `atkLean` 25 and `twist` 25 (1877–1880).
7. `_pose()`, then `_cape(dt)` and `_hair(dt)`, then **trail** samples (1881–1897).

`_pose()` is a fixed-priority stack of target lerps. **The last lerp wins.** There are no per-bone masks; the masking is implicit, because attacks only touch arms and torso, so the legs keep their gait.

- **Pelvis** (1924): `hipC = [mf·.4·sp − .4·hurt + lunge·.55, mr·.3·sp + sway, hipZ + bob + breathe·.3 − dash·2.2 − hurt·.6 − kneel·hipZ·.42 − guard·.9 − crouch·hipZ·.32 + hop]`
- **Each foot** (1926–1941): gait → dash → air → kneel → guard → crouch → lead-foot lunge step → hop → climb → kick, then `ik3`.
- **Torso** (1942–1943): `leanF = o.lean + .16·sp·mf + .45·dash + atkLean − .35·hurt + cr·.22` and `leanR = .1·sp·mr`.
- **Each hand** (1952–1977), about 15 overrides: gait swing → dash → hurt flinch → air → point/aim → cheer → cast → guard pose → guard stance → ready → wave → hips → block → climb → attack (the striking hand or two-hand grip; the other hand guards or pulls back) → kick balance, then `ik3`.
- **Blade direction** (1979–1988): rest → attack → wind blend → cheer → block → ready → point → dropped while down.
- **Knockdown** (1989–1993): rotates the whole `J` about the r axis by `dw·π/2·.96`, with lift and shift.

### 2.2 Locomotion and idle

These formulas are worth porting verbatim (1919–1941 and 1953–1954):

```js
const breathe = Math.sin(this.t * 2.3) * (1 - sp);                       // idle breathing
const bob = (.5 - Math.abs(Math.cos(ph)) * 1.3) * sp;                     // pelvis bob, two per cycle
const sway = Math.sin(this.t * 1.15) * .3 * (1 - sp) * (1 - this.atkW);   // weight shift foot to foot
// foot s = ±1: p = ph + (s > 0 ? π : 0); along = sin(p)·stride·sp
foot = [mf * along + (s > 0 ? .8 : -.6) * (1 - sp), s * o.footSpread + mr * along, Math.max(0, Math.cos(p)) * o.lift * sp];
// hand s: q = ph + (s > 0 ? 0 : π); along = -sin(q)·swing·sp
hand = sh + [mf * along + .5 * (1 - sp) + o.hunch * 3, s * .9 + mr * along, -armLen * .86 + Math.abs(Math.sin(q)) * 1.2 * sp];
```

- Feet follow sinusoidal paths. There is no planting and no contact event; contact is only implied by the phase.
- `air` is a single tuck. `docs/ANIMATION-RESEARCH.md` §2 notes there are no rise, apex or fall poses.
- `climb` moves hand over hand using `climbP` (1823, 1936, 1968).
- `run` runs in place. `speedRef` normalizes speed per build.

### 2.3 Poses and stances

Held poses blend at rate 9 and stances at 10. Their targets are effector offsets written inline. Examples:

- guard: `guardAt = shC + (s < 0 ? [3.8, -1, .4] : [2.3, 1.5, -.6])` (1961);
- cheer: `armLen·(.74 + .12·sin(9t + …))` pumps the fists (1959);
- wave: the waving hand is the free hand, or **the camera-side hand** (`_camSide`) when both are free (1965).

`'die'` is a timeline (1824–1827): hurt for 0.25 s, kneel from 0.2 to 0.6 s, then `down` after 0.45 s.

### 2.4 Moves: the exact `E.MOVES` spec

The header (1744–1747) and the doc block (2534–2542) define these fields:

- `a0`/`a1`: angles in radians. Positive means the right side, or up in the side plane.
- `z0`/`z1`: heights. With `rel: true` they are units from the shoulder centre; for kicks they are **shares of hip height**.
- `reach`, or `r0`/`r1` for an extending thrust. With `rel`, reach scales by `(armUpper + armLower)/9.2`.
- `hand`: `'R' | 'L' | 'both'`.
- `plane: 'side'`: always a vertical swing.
- Flags: `kick` (right foot), `spin` (full turn).
- Body motion: `lunge`, `hop`, `crouch`, `lean`, `twist`, `hold`.
- `blade: 0`: no trail.
- `wind`/`active`/`recover`: seconds.
- `hitAt` (read by `Attack.hits`).

Examples (2545, 2554, 2562):

```js
slash:      { rel: true, a0: 1.7, a1: -1.7, z0: -6, z1: -9, reach: 7.5, wind: .08, active: .1, recover: .22 },
jab:        { rel: true, hand: 'L', a0: .05, a1: 0, z0: -1, z1: -.5, r0: 3, r1: 8.6, wind: .035, active: .06, recover: .13, lunge: .9, lean: .22, blade: 0 },
roundhouse: { rel: true, kick: true, a0: 1.7, a1: -.45, z0: 1, z1: 1.55, reach: 7, wind: .1, active: .13, recover: .24, twist: 1.3, lean: -.3 },
```

There are 24 moves (2543–2572): 8 blade, 6 fist, 6 kick, and 4 others (cast, throw, bash, claw). Total durations run from 0.225 s (jab) to 0.66 s (cast).

**Phase semantics** (1846–1866):

- **wind (anticipation):**
  - `theta` eases from where the arm is (a chained hit) or from rest, to `a0` (outQuad);
  - reach goes to `r0`;
  - the body leans back (`−|lean|·.45`), draws back (`−lunge·.3·k`) and dips (`crouch`);
  - the first wind step snapshots the real hand and blade (`_from`, 1849), so the wind blends from the actual pose without snapping.
- **active (strike):**
  - `theta` goes from `a0` to `a1` (outCubic) and reach from `r0` to `r1`;
  - full lean and lunge; hop follows `sin(k·π)`;
  - `spin` turns the whole body by −TAU·k in ground views, but **loops the blade in front in side views** (1860).
- **recover (follow-through):**
  - overshoot: `theta = a1 + span·.08·k`;
  - hold for `hold` (default 0.3 of recover), then `armT` eases to 0 so the arm blends back **by position** ("never swing backwards", 1841).
- **Twist:** `clamp(theta·(side ? .08 : .32)·twist·(L ? −1 : 1), ±.7)` turns the shoulders, and the hips by ×0.4 (1867, 1925, 1946).
- **Strike target** (1950–1951):
  - ground plane: `aT = shC + [cos θ·reach, sin θ·reach, rel ? atkZ : atkZ − shC.z]`;
  - side plane: `shC + [cos θ·reach, ±.8, sin θ·reach]`.
- **Kicks** drive the right foot to `[cos θ·(reach + 3), sin θ·(reach + 3), atkZ·hipZ]` (1937), and the arms go up for balance (1975).

### 2.5 `Attack`, `Combo`, `E.move`

**`Attack`** (2467–2504):

- `new E.Attack(spec | 'name', overrides)`. Defaults: wind 0.06, active 0.1, recover 0.18. **Only the name path adds `hitAt: .35`** (2470); a spec object gets 0.
- `start(canCancel)` returns false while busy, unless `canCancel` is set and it is in recover.
- `update(dt)` returns the phase that just began ("active = play the swing sound"). Its `while` loop carries leftover time across phases, so timing stays exact even with a large dt.
- `hits(targets, test, fn)` hits each target once per swing, during active and once `u ≥ hitAt`.
- Also: `state` → `{ spec, phase, u }`, `busy`, `active`, `u`, `cancel()`.

**`Combo`** (2515–2532): a list of Attacks, specs or names.

- `press()` chains to the next hit during recover, or within `window` (0.3 s) after the hit ends; otherwise it restarts at 0.
- It returns false during wind or active; there is no internal buffering, so games use `input.buffered`.
- Also: `step`, `current`, `state`, `hits`, `update`, `cancel`.

**Others:**

- `E.move(name, u, phase)` (2575) gives the state of any move at any moment, from a cached spec. Previews and character sheets use it.
- `E.knockback(from, target, speed, up)` (2577).

### 2.6 Hit reactions and knockdown

- `hurt`: a single flinch. Hips go back and down, the torso leans back, the right hand shields the face and the left is flung back (1924, 1942, 1956).
- `down`: the rigid-rotation hack (1989–1993). Drawing details turn with it through `_offsets` (2083–2084).
- `die`: the timeline in §2.3.
- Missing:
  - directional reactions (hit from the front, back or side);
  - impulse-driven reactions;
  - ragdoll;
  - get-up sequences: games chain `down` → `kneel` → stand by hand (`docs/ANIMATION-RESEARCH.md` §2, "one structural gap": no `E.ACTIONS` for non-attack sequences of several beats).

### 2.7 Squash and stretch, and secondary motion

**Squash** (1832): `sqV += (−260·sq − 15·sqV)·dt; sq = clamp(sq + sqV·dt, −.3, .3)`.

- `kick(v)` adds velocity; games call `rig.kick(-3)` on landing and on dash.
- Squash is applied only in `_w` and in drawing; `J` is untouched. In the probe, `kick(−3)` lowered the world head z from 24.21 to 23.23 while `J.head` stayed put.

**Hair** (1900–1916): a world-space verlet strand.

- N = 6 points (`long`) or 4 (`ponytail`); segment 1.9 or 1.6 × size.
- Gravity 200 u/s², pushed backward by −20 along facing, damping `0.97^(dt·120)`, 3 iterations.
- Constraints: a body cylinder, the floor, and the head top.

**Cape** (2033–2068): two world-space verlet edges, L and R.

- N = `len` (6 by default), `seg` 2.4.
- Gravity 230, plus flutter `sin(11t − .8i + s)·40·(i/N)`.
- A width constraint that widens 25% toward the hem.
- 4 iterations. It is kept behind the back plane and outside the body cylinder, below the head.
- It is anchored through `_w`, **so the camera cheat moves it.**
- Games reach into it directly: `settleCape` lerps `n.x`/`n.px` toward a rest shape (`20-sim.js:521-527`).

**Trail** (1885–1897): world-space `{ b, t, o, age, w }` samples. The pair is blade base and tip for swords, elbow and hand for fists, knee and foot for kicks. At most 12 samples; they age out after 0.14 s during active and 0.07 s after.

- The 2D `drawSmear` and the 3D ribbons both read it (`lab3d/40-characters.js:257`).
- `smear` (1868–1875) is a separate ground-plane arc that only the 2D renderer uses.

### 2.8 Mocap overrides (interface)

`Mocap.drive(rig, lib)` (`src/mocap/mocap.js:174`) **replaces the instance's `update` and `_pose`**. After the base `_pose` runs, it retargets the clip's 36 points (`readable.js:20`: pelvis … toe) onto the rig:

- bone directions are multiplied by the rig's own bone lengths;
- limbs are re-solved with `E.ik3`, with the clip's knee and elbow as the bend hints;
- `mocapW` blends the result in a yaw-turned frame;
- `mocapMask = 'upper'` keeps the rig's own legs;
- `spin` is set from the chest's heading;
- `mocapTilt` passes 3×3 chest and head frames, which `_offsets` uses so the face and hair tilt (2076–2082);
- `downW` is derived from torso tilt;
- the blade follows index → pinky when `mocapBlade` is set, and is clamped above the floor.

The clip carries orientations (chestF, faceF, index/pinky) that the joint-position rig cannot hold. That is the root of these workarounds.

### 2.9 Timing model

- **Game loop** (1639–1650):
  - `dt = min(.05, frame time)`, `steps = max(1, ceil(dt·timeScale/(1/120)))`, `h = dt·timeScale/steps`.
  - Each substep is **at most** 1/120 s but **not fixed**: 1/144 s at 144 Hz, 1/150 s at 75 Hz, and about 1/480 s in 0.25× slow motion.
  - There is no accumulator and no render interpolation.
  - The header's claim "motion is identical at 60, 120 or 144 Hz" (29–30) is only approximately true (§5).
- `hitstop` returns before the scene update (1701), so rigs freeze during hit-stop. Timers run on `game.time`.
- The rig has its own clock `t`, advanced by `update`'s dt.
- **Mixed dt models in the rig:**
  - linear `approach(w, target, dt·rate)`;
  - first-order `lerp(x, target, min(1, dt·k))`;
  - verlet that assumes a constant dt (`(n.x − n.px)·damp` with damping `.97^(dt·120)`).

### 2.10 Hitboxes, reach and `E.inArc`

**Nothing ties hit volumes to the animation.**

- `E.inArc(a, facing, b, range, halfAngle)` (194) is a ground-plane cone that ignores z.
- Games choose ranges by hand: the header example uses 22 and 1.4; the stress world's `HIT` table uses slash range 27, half-angle 1.35 (`20-sim.js:108`).
- `spec.reach` is the arm's reach from the shoulder centre, not a gameplay range.
- The stress world **measures** each move's reach by sampling a spare rig: it forces `rig.t = 0`, calls `update(1, …)` to snap the smoothing, and takes the max of `tip()` (`20-sim.js:85-99`). It adds its own height check, `inArc3` (233).
- With "skip off-screen animation", unseen monsters don't pose at all (`20-sim.js:538`). Gameplay therefore cannot rely on live sockets.

---

## 3. Blob rig (2587–2671)

- **State:** `o.R` (6.5), `C`, `sq`/`sqV`, `look` `[dx, dy]`, `t`, `squint`, `scale`, `walk`, `flap`, `flapP`, `hang`. `target` (2591) is a dead field.
- **`update(dt, s)`** (2595–2602):
  - a spring toward `s.squash`: `sqV += (−(sq − target)·320 − 14·sqV)·dt`, clamped to ±0.45;
  - `look` lerps toward the normalized `s.look` at rate 8;
  - `flap` approaches its target at rate 6, and `flapP += dt·14·flap`;
  - `squint`, `walk` and `hang` are copied.
- **Drawing** (70 lines):
  - an ellipse body: horizontal `a = 1 − .55·sq`, vertical `b = 1 + sq` (a²b ≈ 1 − .1·sq, nearly volume-preserving);
  - eyes on a sphere at the look angle ± 0.42 rad, culled by camera depth unless the view is steep; `face: 'front'` pins them to the camera side;
  - ears, horns, wings, tail, feet and mouth are **2D screen-space decorations**;
  - `hang` flips the canvas.
- **3D port:** it is already done in `slimeParts` (`30-crowd.js:140-161`): one scaled sphere with (a, b, a), eye balls, cone horns and ears, and box wings driven by `flapP`.
- In the new engine, Blob becomes about 2 KB: a squash spring, look smoothing, flap phase, and a part list.

---

## 4. The split: 3D math vs 2D drawing

### 4.1 Pure skeletal and animation math (portable)

| part | lines | bytes |
|---|---|---|
| §1 core math, `V3`, `ik3` | 72–140 | 4.5 KB |
| builds and joint keys (data) | 1753–1761 | ~1.3 KB |
| constructor (minus colors), `kick`/`hand`/`tip`/`_w`/`head` | 1762–1797, 1995–1996 | ~2.8 KB |
| `update()` (minus smear, 0.7 KB) | 1798–1898 | ~9.3 KB |
| `_pose()` | 1917–1994 | 8.4 KB |
| `_hair` + `_cape` (verlet) | 1899–1916, 2033–2068 | 5.3 KB |
| `Attack` + `Combo` + `MOVES`/`move`/`knockback` | 2457–2583 | 10.2 KB |
| Blob constructor + update | 2584–2602 | 1.4 KB |
| **total** | | **≈ 43 KB ≈ 12.4k tokens** |

### 4.2 2D pixel-art drawing (Card mode only)

| part | bytes |
|---|---|
| `_drawHD` | 20.8 KB |
| `_drawClassic` | 6.1 KB |
| `_hat` | 2.1 KB |
| `drawSmear` | 2.8 KB |
| `drawPortrait` | 3.2 KB |
| `debug` | 1.2 KB |
| Blob draw | 5.3 KB |
| colors | 0.4 KB |
| **subtotal** | **41.9 KB** |

Card mode also needs these 2D dependencies:

- §2 pixel primitives (7.8 KB);
- `View` and `charView` (4.5 KB);
- `tones`/`shade`/`ramp` (≈ 3 KB);
- the labs' own atlas and card code (`30-crowd.js:205-290`, ≈ 6.6 KB).

The Card stack totals **≈ 57–63 KB, about 17k tokens**, for characters that are flat, sit at one depth and ignore scene lights (`lab3d/40-characters.js:5-7`).

### 4.3 Mixed parts (where drawing writes simulation state)

- **`draw()`** (2086–2095) writes:
  - `_pitch` (the real view pitch), which `update` reads to choose `sidePlane` (1838);
  - `_cheat` (2093), which `_w` reads, and so do `hand()`, `tip()`, `head()`, the cape and hair anchors, and the trail;
  - `_camSide` (2092), which `_pose` reads to pick the waving hand;
  - `_lastView`, which `drawSmear` and the lab's card trail read.
- `_offsets()` (2076–2085): frames for details, from `mocapTilt` or `downW`. The 3D Puppet uses it too (`lab3d:113`).
- `update()`: its smear (1868–1875) and `sidePlane` (1836–1838) are view concepts inside the simulation.
- `drawPortrait()` (2012–2025): zeroes `downW`, `hurtW` and poses, calls `_pose()`, draws, then restores. Drawing re-runs the simulation.

### 4.4 View-dependent hacks a true 3D engine should drop or replace

1. **Cheated three-quarter turn** (2090–2093): in views with pitch under 45° the body turns up to 0.5 rad toward the camera (`clamp(angDiff(facing, camA), ±cheat)·(1 − pitch/45)`). This moves world sockets and cloth. Both labs zero it by hand (`30-crowd.js:358,365`; `lab3d:112,137`). → **Drop.**
2. **`charView` / `E.style.charPitch`** (388–404): in views with pitch 40–89° characters are drawn from pitch 30, with `zBoost` compensated; top-down uses a 0.78 height constant. It is a global mutable style flag that the stress world's panel toggles (`60-panel.js:137`). → **Drop.**
3. **`View.zBoost`** (348–354, values 1.3–1.35): height exaggeration. → **Drop.**
4. **Screen-plane chops**: `sidePlane` switches to vertical swings automatically when `_pitch < 15` (1838), and `spin` becomes a windmill in side views (1860). → **Replace** with the explicit `plane` field in move data. In 3D, horizontal and vertical swings are both valid moves.
5. **Ground-plane `smear`**, drawn only when pitch ≥ 30 (2428). → **Drop**; keep the world-space trail.
6. **`_camSide`** wave-hand choice (1965). → Choose by gameplay (the free hand).
7. **Drawing-time culling and facing tricks**: the sternum and neckline only when facing the camera (2156, 2175), ears on the camera side (2234), eyes culled by depth (2253), Blob `face: 'front'` (2653) and screen-space wings and ears. → Real 3D geometry.
8. **Knockdown as a rigid rotation of all joints** (1989–1993). → Root orientation plus ragdoll or a get-up timeline.
9. **Particles**: `ring` stands vertical when pitch < 20 and is otherwise a ground decal (981–982); overhead views lift by z·0.5 (964). Not rig code, but the same pattern.
10. **2D facing semantics** at the edge: `Platformer.rigState` maps facing ±1 to 0 or π (3456).

---

## 5. Determinism

- **`Math.random` in rig code** (only two places):
  - `this.t = Math.random() * 10` (1782): the phase of idle breathing and sway, which **changes joint positions**;
  - `blink = 2 + Math.random() * 3` (1831): the face only.
- **Elsewhere:**
  - Blob uses no randomness.
  - Particles call `Math.random` 37 times (936–1037). `hitFx` jitters damage text (1578).
  - `E.rand`, `randInt`, `pick` and `chance` (180–184) all use `Math.random`.
  - The engine already has `E.rng(seed)` (85, a mulberry32-style generator), but the rig doesn't use it.
- **Wall clock:** the rig reads none. The loop uses `performance.now()` to size substeps (§2.9).
- **Probe results:**
  - Two rigs fed identical inputs for 5 s differ by up to **0.08 units in joints and 0.83 units at the cape** (because `t` is random).
  - With `t` forced equal, joints and cloth are **bit-identical**; only `blink` differs.
  - The same 2 s walk at 1/120 s steps vs 1/144 s steps differs by **0.05 units in joints and 0.23 units at the cape tip**: the result depends on frame rate.
- **View leakage:** the simulation depends on which view drew the rig last (`_cheat`, `_pitch`, `_camSide`; §4.3).
- **Verdict:** rig state *can* be part of a deterministic simulation if three conditions hold:
  1. a seeded clock and RNG per entity;
  2. no reads of any view or camera;
  3. a strict fixed step, run with an accumulator.

  Today the stress world keeps rigs out of its proof hash ("the particles and the rigs' idle motion use Math.random (looks only, never read back)", `20-sim.js:23-24`). It still reads `tip()` for impact effects, and it measures reach once at load with `t = 0`.
- **Recommendation for the new engine:**
  - Animation that gameplay reads (sockets, sweeps, root motion, events) runs inside the fixed simulation step and is hashed.
  - Purely visual extras (blink, cloth on LOD'd bodies) may run at render rate, but are never read back.

---

## 6. Extraction design: a renderer-agnostic `anim/` module

### 6.1 Principles

- **No camera input anywhere.** No function in `anim/` takes a view; this is enforced by the API.
- **Deterministic:**
  - `seed` per character, and an RNG passed in;
  - fixed `dt` (for example 1/120, or the simulation step);
  - `anim.hash(pose)` gives quantized pose hashes for tests and proofs.
- **Data first:** skeletons, builds, poses, stances, moves and reactions are tables with a one-line comment per row, and code only reads tables. This is where today's 200–260 inline numbers per function go (§7).
- **One frame convention end to end:**
  - metres, seconds, radians;
  - right-handed, +Y up, as in three.js, Rapier and glTF;
  - characters face +Z (glTF, and three's `lookAt` for non-camera objects).
  - Authoring stays in today's intuitive **(forward, right, up)** triplets through one helper, `B(f, r, u)`, so offset tables port with only a unit conversion (÷16).
  - This removes the `toThree` swaps and quaternion sign flips (§1.2).

### 6.2 Skeleton definition (data)

A 22-bone humanoid that lines up with both today's joints and the mocap point set:

```js
// name, parent, rest offset in parent space (from the build, metres), today's J key / mocap point
root          -                                             (ground point under the pelvis; yaw = facing)
pelvis        root     [0, hipZ, 0]                          hipC        / pelvis
spine, chest  pelvis…  torso split .5/.5                     shC (top)   / spine2, chest (+chestF for orientation)
neck, head    chest…   [0, neck, 0], [0, headR, 0]           head        / neck, head (+faceF, headTop)
clavL/R, upperArmL/R, forearmL/R, handL/R                    shL/R, elbowL/R, handL/R / clav, sh, elbow, wrist (+index, pinky)
thighL/R, shinL/R, footL/R, toeL/R                           hipL/R, kneeL/R, footL/R / hip, knee, ankle, ball, toe
sockets: weaponR (bladeDir), weaponL, headTop, eyeL/R, contactL/R (soles)
```

- `BUILDS` ports as data in metres, split into skeletal fields and the drawing fields that go to the mesh generator.
- Non-humanoid bodies (Dan, the crawler, the serpent) are **their own bone tables**, with their own procedural layer modules, behind the same `Character` interface.

### 6.3 Pose representation: decision

- **Canonical output:** `Pose = { root: pos, rootRot quat, rootScale vec3 (squash), local: Float32Array(B·4) quaternions }`. FK gives model-space matrices and positions, cached per step.
- **Procedural layers stay in effector space**, as today:
  - they write targets: pelvis offset, foot and hand positions in body space, lean and twist angles, a look target;
  - a **solve stage** turns them into rotations:
    - the spine from lean and twist;
    - limbs by two-bone IK with today's hints as pole vectors;
    - feet flat or aligned to the ground normal;
    - hands aligned to the forearm or to the weapon direction.
- **Why rotations** (rather than keeping joint positions):
  - skinned meshes need them;
  - per-bone masks and slerp/nlerp blending keep bone lengths without re-solving;
  - additive layers (breathing, flinch, recoil, look-at) are straightforward;
  - a ragdoll maps one rigid body to one bone;
  - clips play on any build as rotation copies plus contact IK, with no direction-times-length re-solve (Mocap.drive's job, 2.8);
  - head and hand orientation exist natively, so `mocapTilt` and `_offsets` disappear.
- **Why keep effector authoring:**
  - the existing formulas are effector placements;
  - LLM agents reason far better about "the guard fist is at chest + (0.24 m fwd, 0.09 m right, −0.04 m up)" than about quaternions;
  - tests can assert positions through FK ("hand above head while cheering").

### 6.4 Layer stack (the `Character` animator)

The stack is explicit, named and ordered. `inspect()` lists each layer's weight.

```
1 weights    named eased weights from a table { dash: [24, 8], hurt: [14, 14], attack: [30, 7], air: [10, 18], ... }
2 base       locomotion: gait, idle (breathe, sway), air, climb → effectors (+ footstep events from the phase)
3 override   stance, held pose, move strike, reaction → effectors, by priority (today's lerp order, written as a list)
4 solve      effectors → local rotations (IK)
5 clips      sampled clip layers (mocap, keyframes): weight, bone mask ('upper', 'arms', a custom list), crossfade
6 additive   breathe, directional flinch (a spring), recoil, look-at
7 post       foot IK on terrain (probe), two-hand grip, aim (point/aim)
8 physics    ragdoll blend weight 0..1
9 secondary  verlet chains (cape, hair, tail), squash spring → root scale
→ outputs    pose, matrices, sockets, trail, chains, events
```

### 6.5 IK solvers

- `twoBone(a, b, L1, L2, pole)`: `ik3` ported verbatim (129–140, 12 lines), plus `twoBoneRot` returning the two local quaternions with an explicit pole vector.
- `aim(chain, target, limits, share)`: look-at spread over chest, neck and head; also gun aim, replacing `point`/`aim`.
- `footPlant(probe)`:
  - `probe(x, z) → { y, normal }` is supplied by the physics module (a Rapier ray cast); `anim/` never imports Rapier.
  - It lowers the pelvis by the deepest foot drop (clamped), sets each foot's target height, aligns the foot to the normal, and locks the foot during the gait's stance window. This fixes foot sliding.
- `handTo(target)`: grips, ladders, levers.

### 6.6 Moves as data: events, hit volumes, root motion

Keep the semantics and make the fields self-describing, in metres:

```js
slash: { hand: 'R', plane: 'ground', arc: [1.7, -1.7], height: [-.375, -.5625], reach: .47,
         time: { wind: .08, active: .1, recover: .22 }, hitAt: .35,
         body: { lean: .3, lunge: .075, hop: 0, crouch: .15, twist: 1 }, trail: 'blade' },
```

- **One `Timeline` type** for `Attack` and for the missing non-attack actions (get-up, roll, ledge climb, potion). Phases have durations, effector or clip content, and events.
  - Port `Attack.update` (leftover-time carry), `hits`-once-per-swing and `Combo` nearly verbatim.
  - Make `hitAt` a property of the move, not of the construction path.
- **Events** go into `ch.events` each step: `wind`, `active`, `hitOpen` (u ≥ hitAt), `hitClose`, `recover`, `end`, `footstep{side}`, `land`, and clip markers. Gameplay, audio and particles subscribe to them.
- **Hit volumes:**
  - **Precise:** each step inside the hit window, the character publishes the weapon sweep (the previous and current base→tip segments, the same data as today's trail) for gameplay to test against hurt capsules on bones.
  - **Cheap:** at load, each move is measured into a `hitShape` `{ range, halfAngle, yMin, yMax }`, as the stress world does by hand (`20-sim.js:85-99`). Off-screen or LOD'd bodies can then fight without being posed. `inArc` stays as the cheap test.
- **Root motion:** `lunge` and `hop` become curves that yield `rootDelta` each step.
  - `rootMotion: 'visual'` keeps today's look: the hips move while the body stays put.
  - `'apply'` hands the delta to the character controller.

### 6.7 Secondary motion

- One generic `Chain({ anchor: [bone, offset], n, seg, gravity, drag, wind, iterations, colliders: bone capsules, floor: probe, stiffness })`.
  - Cape = 2 chains plus the width constraint (port 2042–2066).
  - Hair and tails = 1 chain (port 1900–1916).
- Keep the teleport reset (1805, 1894).
- `stiffness` toward a rest shape replaces game-side `settleCape` hacks.
- Fixed dt only.
- The squash spring (1832) becomes a root-scale channel with volume preserved.
- Blob is the same spring plus look smoothing.

### 6.8 Clips, mocap and retargeting hooks (the mocap agent owns the converter)

- `ch.play(clip, { weight, mask: 'upper', fade: .25, loop, speed })` adds a clip layer.
- Readable position clips stay as the format agents read and edit. At load they are converted once into rotation tracks for a skeleton:
  - bone directions give the swing;
  - chestF, faceF and index/pinky give the twist.
- Retargeting is then:
  - a rotation copy;
  - root translation scaled by the hip-height ratio;
  - contact IK for feet and hands.
- `lib.moveAt` (travel) feeds root motion.

### 6.9 Ragdoll hand-off and terrain

- A bone capsule table (radii from `limbW`/`torsoW`) defines the ragdoll.
- The physics module builds Rapier bodies and joints on demand from the FK transforms and from velocities taken from the last two poses.
- `ragdollWeight` blends physics into the pose. On recovery, a get-up `Timeline` is chosen by the pelvis's orientation (face up or face down).
- The `down`/`die` timelines stay as the fallback when physics is off.
- This replaces the rigid-rotation hack (1989–1993).

### 6.10 Render adapters (outside `anim/`)

- **Rigid parts:** "a body as data", in the lab's format (`lab3d/40-characters.js:27-48`: `['limb', a, b, ra, rb, color]` and so on), attached to bones. Instanced batches handle crowds (`30-crowd.js:20-67`).
- **Skinned procedural meshes:** `ch.matrices` in skeleton order, with the bind pose taken from the build.
- **Card mode:** not ported (§4.2). If the pixel look is wanted, get it in the renderer (low-resolution target, toon ramps, outline shell) on real geometry.

### 6.11 Agent-facing API and tooling

```js
const ch = anim.humanoid({ build: 'heroic', seed: 7, cape: { len: 6 }, hair: 'ponytail' });
ch.step(dt, { pos, yaw, vel, grounded, attack: slash.state, stance: 'ready', lookAt });  // same state-bag idea as today
ch.pose; ch.matrices; ch.socket('weaponTip'); ch.events; ch.trail; ch.chains; ch.rootDelta
ch.inspect()                       // { weights, layers, effectors, sockets, events, warnings }: plain JSON
anim.poseAt(def, state, seconds)   // pure: a fresh character stepped at a fixed dt → pose (golden tests, sheets)
anim.check(def)                    // checkRig revived: CHAR_STATES × facings → finite, bone lengths, feet ≥ ground,
                                   // sockets in reach, same hash twice, 1/60 vs 1/120 within tolerance
anim.sheet(def, states)            // an SVG skeleton contact sheet from FK: inspectable without a GPU
```

- Unknown state keys, pose names and move names warn once and suggest the closest match. Today unknown poses and stances fail silently.

### 6.12 Port verbatim vs rewrite

| port nearly verbatim (rename, comment, metres) | rewrite | drop |
|---|---|---|
| `clamp lerp approach ease angDiff lerpAng approachAng smoothDamp rng hash2 noise2` (72–96), `ik3` (129–140) | joint positions → rotation skeleton + FK | `charView`, `charPitch`, `zBoost` |
| the gait, idle, lean and arm-swing formulas (1919–1954) | `_w` → a root transform (+ squash scale) | `_cheat`, `_camSide`, auto `sidePlane` |
| pose and stance effector targets, moved into tables (1924–1937, 1955–1968) | knockdown → root + ragdoll / get-up | ground `smear` |
| the attack arm path: anticipation, `_from` blend, overshoot, hold (1842–1867, 1950–1951, 1969–1986) | `Mocap.drive` patching → a clip layer with mask | `_drawHD`, `_drawClassic`, `_hat`, portrait, Blob draw |
| `Attack`, `Combo`, `E.MOVES` (24 entries), `E.move` (2467–2575) | `hits` + `inArc` → events + sweeps + measured `hitShape` | `style: 'classic'` stick figures |
| cape and hair verlet as `Chain` (1900–1916, 2033–2068), trail sampling (1885–1897) | `Math.random` → seeded per entity | dither, painter's-sort ops |
| squash spring (1832), Blob update (2595–2602), `die` timeline (1824–1827) | dt models unified to a fixed step | |

---

## 7. Quality problems that would confuse an LLM agent

1. **Dense lines.**
   - Sections 11–12 have 66 lines over 200 characters and 7 over 300; the longest is 375 characters (2175).
   - 1842 declares 7 constants on one line (`sp, side, rest, RS, R, r0, r1`).
   - 1823 carries two trailing comments.
   - 1924's pelvis formula has 14 terms across its 3 components.
2. **Implicit, lazily created state.**
   - `this.poseW || (this.poseW = {...8 keys})` (1820), while `_pose` falls back to a *different* 4-key default (1921).
   - `|| 0)` fallbacks such as `this.stW || 0`, `this.lunge || 0` and `(this.downW || 0)` appear 16 times in `update` and `_pose`.
   - 31 fields grow to 53+ with no declaration list.
3. **Magic numbers.** Numeric literals: 200 in `update()`, 261 in `_pose()`, 99 in cloth, 243 in `MOVES`.
   - Rates are scattered: `dt * 14` ×4, `dt * 10` ×4, and `dt * (s.attack ? 30 : 7)`.
   - Offsets such as `[s > 0 ? 4 : -5, s * 2.2, s > 0 ? 1.5 : .3]` (dash feet, 1929) and constants such as `.96` and `.08` have no names.
4. **Cryptic names.** `spW mv stW rdW cw kn lg cr PW pk sA aT aDir bd wk mf mr`, `_th0 _z0 _r0 _from _windK _aPh _aSp`, and the drawing lambdas `S Sp Q lq PW`.
5. **Priority hidden in order.** About 15 sequential `V3.lerp` overrides per hand (1953–1975). Which layer wins is never written down.
6. **Drawing mutates simulation state** (§4.3), and `drawPortrait` re-poses the rig inside a draw.
7. **Outside code mutates internals.**
   - `rig._cheat = 0` (both labs), `rig.t = 0` (`20-sim.js:91`), `portrait._talk = …` (4266).
   - `settleCape` writes cloth points (`20-sim.js:521`).
   - `Mocap.drive` reassigns `rig.update` and `rig._pose`.
8. **Inconsistent defaults and units.**
   - `hitAt` depends on how the Attack was constructed (2470).
   - `Attack` defaults differ from every `MOVES` entry.
   - Kick heights are shares of hip height while hand heights are units.
   - `a0`/`a1` change meaning with `plane`.
   - `z` defaults to 0 but `x` and `y` do not (1806).
9. **Silent failures.** A misspelled `pose`/`stance` or an unknown key does nothing and warns nothing; only `build`, `weapon` and move names warn (1764, 1775, 2470).
10. **Sticky flags.** `kicking` and `atkHand` persist after the attack ends (1830, 1851). It works only because the weights decay.
11. **Three dt models** (§2.9). With variable substeps, the result depends on frame rate.
12. **Allocation-heavy `V3`.** Every op returns a new array. Crowds re-implement `_w` to avoid the garbage (`30-crowd.js:79`).
13. **The agent edition strips comments from the same code.**
    - In `_pose`, "the lead foot steps into the strike", "a flinch: one arm up to shield the face…" and "the free hand waves (the camera-side one…)" are all removed.
    - Its "header is the manual" style (`my-3d2dge-agent.js:1-356`, about 7.8k tokens: quick start, an API card, recipes, rules) suits *game authors*. But engine *maintainers* lose the *why*.
    - The new engine should keep both: a header manual per module, plus intent comments next to the code.

---

## 8. Size budget (tokens ≈ bytes / 3.5)

| today | bytes | tokens |
|---|---|---|
| whole engine | 374 KB | ~107k |
| §11 Humanoid + Attack + Combo + MOVES | 77.3 KB | ~22.1k |
| §12 Blob | 6.7 KB | ~1.9k |
| portable part of §1 + §11 + §12 (dense style) | ≈ 43 KB | ≈ 12.4k |
| Card-mode drawing stack (§4.2) | ≈ 57–63 KB | ≈ 17k |
| agent edition rig (474 lines) + Blob | 47.8 KB | ~13.7k |

Proposed `anim/`, in readable style (shorter lines, tables, intent comments):

| file | KB | tokens |
|---|---|---|
| `math.js` (vec3, quat, ease, approach, seeded rng) | 6 | 1.7k |
| `skeleton.js` (bone tables, builds, FK) | 5 | 1.4k |
| `pose.js` (pose buffers, blend, mask, additive, hash) | 4 | 1.1k |
| `ik.js` (two-bone, aim, footPlant, handTo) | 5 | 1.4k |
| `locomotion.js` + `poses.js` (gait, idle, air, climb, POSES and STANCES tables) | 9 | 2.6k |
| `moves.js` (Timeline/Attack/Combo, MOVES data, arm path, events, sweeps, hitShape, root motion) | 12 | 3.4k |
| `reactions.js` (flinch, directional additive, down/die timelines, ragdoll glue) | 4 | 1.1k |
| `secondary.js` (Chain, cape, hair, springs) | 5 | 1.4k |
| `clips.js` (clip layer, mask, crossfade; the converter lives in mocap) | 3 | 0.9k |
| `character.js` (layer stack, weights table, inspect, check, sheet) | 7 | 2.0k |
| `blob.js` | 2 | 0.6k |
| module header manual | 4 | 1.1k |
| **total** | **≈ 66 KB** (55 KB without check/sheet and with a terser style) | **≈ 16–19k** |

An agent's working set for a typical task is small: "tune a move" means the header plus `moves.js`, about 4.5k tokens; "add a pose" means the header plus `poses.js`, about 3.5k tokens. Today either task means opening a 374 KB file, or at least the 22k-token §11.
