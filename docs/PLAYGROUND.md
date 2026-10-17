# The Playground

The engine's second integration target (PLAN.md Phase 13; the owner's direction of 2026-10-17, ADR-0025):
`labs/playground/`, a house on a block where the player moves as in Apex Legends, in five cameras and two looks. This
page is its design: the site, the move set with its reference values, the cameras, the looks, what a player can do
there, and how agents and the owner know it feels and looks right. The work packages that build it are PLAN.md
Phase 13 and the on-demand WPs it fires; their **Done when** lists take their numbers from here.

Play it: `npm run dev`, then `http://localhost:5173/labs/playground/` in Chrome or Edge (WebGPU); `PORT=5174` before
the command when another server holds 5173.

## 1. Why

- **Something to touch.** The engine's foundation is proven by numbers (G0 to G9), but there was nothing to play. The
  playground is that place: a house, its yard and a street, where the owner and agents try every system and decide what
  to build next.
- **The character first.** Movement, cameras and animation decide whether a game feels good; if the core character
  does not feel and look right, nothing built on it matters. Stage 1 (G10) is the character alone, in a gym of
  calibrated features, before the house exists.
- **What we compete on.** Gameplay, features and content, where agents excel; not graphics. Two looks done properly,
  cel-shaded and pixel art, and the simple asset system (procedural first, then text: doctrine principle 4) are the
  advantage: an agent writes a chair, a room or a move as data.
- **The long aim.** The engine grows to play like Red Dead Redemption 2, GTA V, Apex Legends and Cyberpunk 2077
  (their gameplay, not their graphics; §11). The playground is the first slice on that road.

## 2. The site

One block, 96 × 96 m, in level coordinates (metres, +Y up, +X east, +Z south: row 0 of a map is its north edge,
PLAN.md §6.3). Outdoors is terrain; the house, the shed, the tree house and the gym are levels standing on it (a site,
§6.3).

```
 x: 0                 36                                   72          96
 z=0  +-----------------------------------------------+-----------+
      | THE RANGE: lanes, targets at 10, 25 and 50 m   | THE RING  |  THE
 z=12 +------------------+----------------------------+-----------+  HILL:
      | THE GYM:         | THE BACKYARD: patio, shed, tree house, |  terrain
      | the calibrated   | zipline, trampoline, swing set, dog    |  rising
      | features of      +----------------------------------------+  to 10 m,
      | §2.3             | THE HOUSE 16 x 12 m (basement, ground, |  slopes
      |                  | upper floor, attic, roof); the garage  |  of 10 to
      |                  | 6 x 8 m and its roof deck; the porch   |  30 deg,
      |                  +----------------------------------------+  trees,
      |                  | THE FRONT YARD: lawn, path, fence,     |  the
 z=82 +------------------+ hedge, mailbox, driveway               |  lookout
      | THE STREET: sidewalks, two lanes, streetlights, bus stop, |  and its
 z=96 | a parked car, the neighbours                              |  zipline
      +-----------------------------------------------------------+
```

### 2.1 The house

Footprint 16 × 12 m (x 44 to 60, z 48 to 60), a garage 6 × 8 m on its east side, a porch on the street side and a
deck on the backyard side. Its level is in format 2 (§6) with 0.25 m tiles, so walls are 0.25 m thick and doors 1 m
wide. Floors are 0.3 m slabs.

| Storey | Floor | Clear height | Rooms and features |
|---|---|---|---|
| Basement | −3.0 m | 2.7 m | workshop, laundry and boiler room, storage (shelves, crates); a crawlspace 1.1 m high under the deck, crouch and slide only, to the bulkhead doors in the backyard; the stairs up; a light switch at the stairs |
| Ground floor | 0.0 m | 2.7 m | the front door onto the porch; the hall, with stairs up and down; the living room (sofa, TV, fireplace, rug); the dining room; the kitchen, with an island to vault; a bathroom; the back door onto the deck; the door into the garage; windows on every side |
| Upper floor | 3.0 m | 2.7 m | the landing over the stairwell, with a railing; two bedrooms (a bunk bed to mantle onto); the study; a bathroom; a door onto the garage's roof deck; a door onto the porch roof; the attic hatch and its ladder |
| Attic | 6.0 m | 0 at the eaves to 4.2 m at the ridge | crouch at the edges, stand in the middle; a roof window out |
| Roof | gable, 35°, ridge 10.2 m, east to west | walkable slopes | the chimney to mantle onto; the porch roof (3.0 m); the garage's deck (3.0 m, a 1.0 m railing) |
| Garage | 0.0 m | 3.0 m | the roll-up door on its switch; a car (a prop until vehicles arrive, §11); shelves and a workbench |

### 2.2 Outside

- **The front yard** (z 62 to 82): lawn, the path to the porch, a picket fence 0.9 m high (vault it), a hedge 1.2 m
  high, the mailbox, a tree, the driveway to the garage.
- **The street** (z 82 to 96): sidewalks 2 m wide, a two-lane road 8 m wide with curbs, four streetlights (on at dusk,
  §8.2), a bus stop (mantle onto its roof), a hydrant, a parked car, the neighbours (§7.4).
- **The backyard** (z 12 to 44): lawn and a patio (table, chairs, a grill); the shed (3 × 4 m, 2.5 m high, a flat roof);
  the tree house (a platform 4 m up, its ladder, and a zipline to the garage's deck); the trampoline (a launcher); a swing
  set; the dog's kennel.
- **The hill** (x 72 to 96): terrain rising to 10 m in slopes of 10° to 30° (slides gain speed down them), trees and
  rocks placed by seed, the lookout at the top and its zipline down to the backyard, and a redeploy balloon: a vertical zipline up to 60 m, then a
  skydive over the whole block.
- **The range** (z 0 to 12, x 0 to 60): a covered bench at x 4, lanes with targets at 10, 25 and 50 m, pop-up and moving
  targets (§7.2).
- **The ring** (z 0 to 12, x 60 to 72): sparring dummies on springs, and two that ragdoll (§7.3).

### 2.3 The gym

The west strip (x 0 to 36, z 12 to 82): calibrated features, each with a sign showing its number, so the owner reads
what a feature tests, and each with a course `node x feel` runs (§9.1). In Stage 1 it is a format-1 level of its own,
its heights given by the playground's own glyphs; from WP 13.18 it stands in its place on the site.

| Feature | Sizes | What it measures |
|---|---|---|
| Sprint strip | 60 m, marks every 5 m | walk, run and sprint speeds; starting and stopping |
| Mantle walls | 0.5, 1.0, 1.5 and 2.0 m high, and 2.1 m (just past the reach), 2 m wide | the mantle's reach and time, and the refusal above it |
| Fences | 0.6, 0.9 and 1.2 m high, thin | mantling over at a sprint, sprinting out |
| Slide ramps | 5°, 10°, 20° and 30°, 12 m long, flat run-outs | the slide on the flat and the gain downhill |
| Crawl | a tunnel 1.0 m high and 8 m long; a bar at 1.2 m | crouching and sliding under |
| Gaps | 2 to 9 m between platforms 1.5 m up | the jump's reach: running, sprinting, slide-jumping, superglided |
| Climb walls | 3, 4, 5, 6 and 6.9 m high, and 7.2 m (just past the reach) | the wall-climb's reach, topping out into a mantle; wall-bounces |
| Stairs and slopes | risers 0.10, 0.15, 0.20 and 0.25 m; ramps at the slope limit and above it | steps and slopes |
| The tower | 6 m, a ladder, a zipline 40 m long | ladders, ziplines, the drop, the mantle hang at its top |
| Launchers | a jump pad and a trampoline | launch heights |
| Doors | wood, glass, double, locked | using, kicking and breaking |
| Movers | a sliding and a turning platform | being carried |

## 3. The character

### 3.1 The body

- `build:adult`: 1.80 m standing, legs that reach their planted feet at full stride (ADR-0009 amendment 4's short
  feet do not return), its capsule sized to it.
- The player: a jacket, trousers, boots, gloves, hair and a face in the body grammar; a strong silhouette and two
  tones per part, so the cel look's bands and the pixel look's palette both read; one accent colour that marks the
  player from every camera.
- The neighbours vary the same slots by seed (§7.4).

### 3.2 The move set

Two profiles of the kind `movement` (WP 13.3): `movement:apex`, the playground's default, and `movement:platformer`,
the Stress Box hero's feel (a dash, a wall jump, a variable jump), kept for comparison and for every existing scene.
The reference values are Apex Legends', as the community has measured them and as reconstructions of its movement
code read them; the source column names where each comes from, and a value marked *(tuned)* has no measurement: it is a
starting value for the owner's playtests. Distances are metres (Apex's units are inches: 1 unit = 0.0254 m). The
playground's sim runs at 60 Hz, so it plays as Apex does locked at 60 frames a second (the superglide's one-tick
window included).

Tolerances, unless a row says otherwise: speeds ±2%, accelerations ±5%, times ±1 tick (1/60 s), heights and
distances ±2 cm, angles ±1°. Where sources disagree, the row says so and gives the value `movement:apex` starts with.

| Move | Rule | Reference | Source |
|---|---|---|---|
| Run | the default gait; one speed, no walk or jog split; strafing and backpedalling at full speed | 4.41 m/s armed (173.5 u/s); 5.07 m/s holstered (×1.15) | ERA-p, AMW-G, R5W |
| Sprint | held or toggled; only while moving within 45° of the view; a side key dips it to 4.80 m/s | 6.60 m/s armed (260 u/s); 7.59 m/s holstered | ERA-p, AMW-G, TF2 |
| Walk | ours: Apex walks only while aiming down sights; a held key or a light stick tilt gives the rifle's aiming speed | 2.20 m/s (the run × 0.5) | R5W (`ads_move_speed_scale`) |
| Crouch-walk | | 2.03 m/s armed (80 u/s); 2.34 m/s holstered | ERA-p, AMW-G |
| Acceleration | linear, in m/s², toward the wished velocity; the speed is capped at the larger of the current speed and the wished one | 63.5 m/s² below 3.05 m/s; 11.4 m/s² up to the run; 2.54 m/s² from the run to the sprint (0.83 s: the run's band overshoots it by a tick, as R5Reloaded's trial shows) | ERA-p, ERA-c, TF2 (one datamine: medium confidence) |
| Deceleration | only the part of the velocity away from the input slows; the input's own direction keeps up to the wished speed | 31.8 m/s² standing (sprint to a stop in about 0.21 s); crouched 38.1 m/s² | ERA-p, TF2 |
| Capsule | radius and heights of Apex's medium legends | radius 0.41 m; 1.83 m standing; 1.19 m crouched; eyes at 1.52 m and 0.81 m | AMW-EN, ERA-p |
| Steps and slopes | | steps up to 0.56 m; walkable up to 45.57° (a floor normal at least 0.7 up) | ERA-p, AMW-EN |
| Crouch | the capsule shrinks from the top on the ground, from both ends in the air (feet tuck 0.32 m); re-pressing within 0.4 s never shrinks it (crouch spam) | down 0.4 s (the capsule switches at the end), up 0.2 s (at the start); 0.2 s when it starts a slide | AMW-G, TF2 |
| Slide: start | crouch while moving within 53° of the view at speed, on walkable ground; or crouch held on landing | at least 5.08 m/s; on landing at least 2.29 m/s across and 5.08 m/s down | AMW-S, CVAR |
| Slide: boost | added once per slide; a 2 s cooldown from each slide's start | +3.81 m/s, capped at 10.16 m/s (11.6 m/s measured from a holstered sprint) | AMW-S, CVAR |
| Slide: friction | the slowing, then a decay of the velocity | 2.54 m/s² (10.2 m/s² when crouch is released or the input opposes the slide), then × 0.7 per second | ERA-p, TF2 |
| Slide: steering, slopes, steps | sideways only; gravity along the floor (half before the move, half after); a step up costs speed | 1.27 m/s² sideways; the pull g · n_y along the slope; 10 m/s lost per metre climbed | ERA-c, TF2 |
| Slide: end | into a crouch; releasing crouch ends it only when slow | below 3.18 m/s; release ends it at or under 8.89 m/s | ERA-p, TF2 |
| Slide-jump | the jump keeps the slide's speed, but a boost jumped in its first 0.24 s above 8.89 m/s is taken back (a "dead slide") | a jump of 1.27 m | AMW-S, ERA-c |
| Jump | gravity, height and grace | g = 19.05 m/s² (750 u/s²); 1.42 m high (7.36 m/s up); coyote time 0.2 s | CVAR, AMW-G, ERA-p |
| Jump fatigue | a jump soon after landing goes lower; a mantle, walking off a ledge or the coyote time clears it | 0.15 s after landing: 0.3 of the height, back to full by 0.75 s | AMW-G, ERA-p |
| Air control | Quake's air acceleration (strafing turns and gains speed); no air friction | wished speed capped at 1.52 m/s; 12.7 m/s² | AMW-A, ERA-c, CVAR |
| Lurch | a move key pressed soon after a jump turns the velocity toward it (keyboard only) | within 0.4 s: strength 0.7 to 0.2 s, falling to 0 at 0.4 s; at most 4.6 m/s of change (contested: 0.5 s) | AMW-L, CVAR |
| Bunny hops | jumping again just after landing above the sprint speed costs speed | 2.54 m/s per hop (contested window: 1 s or 0.1 s; `movement:apex` starts with 1 s) | AMW-G, AMW-BH |
| Landing | no fall damage; a fall stun by the impact speed along the floor's normal (slopes cancel it), recovering over 1 s, no sprint below 0.7 of speed | none below a 7.6 m fall, full stun from 20.3 m | AMW-A, ERA-p |
| Mantle | holding jump at a ledge within reach; push and view within 50° of the wall; a 0.25 s cooldown; sprinting in, sprinting out (a slide may follow at once); low obstacles are mantled, as Apex has no separate vault | ledges up to 2.03 m; the grab 0.45 s (from a climb), the pull 0.3 s (contested: 0.45 s) | CVAR, AMW-M |
| Mantle hang | letting go of forward during the grab hangs from the ledge | needs 1.52 m of clearance below | AMW-M, CVAR |
| Superglide | at a sprint: a jump, then a crouch exactly one tick later, within the pull's last 0.15 s; uses the slide's boost and its cooldown | about 13.7 m/s out of the mantle | AMW-SG, AMW-LT |
| Mantle boost | Apex's one-button superglide (Season 27): the same window, no cooldown of its own, a slightly higher arc; an option in the settings | as the superglide | AMW-MB |
| Wall-climb | airborne, moving and facing a wall steeper than 45.57° within 45.57°; forward held keeps it going; tops out into a mantle | up to 2.54 m above where it caught or 3.73 m above the last ground, then +0.71 m; up at 5.72 m/s, sideways at 6.55 m/s; it ends 1 s after it stops rising; the highest ledge reached 6.93 m | AMW-C, AMW-AC, AMW-EN |
| Wall-bounce | a jump off a climb | from 0.48 to 1.19 m above where it caught: a big lift and 6.55 m/s away; below 0.48 m: +0.72 m and 4.78 m/s; higher: a push away only | AMW-C |
| Climb again | a new climb starts lower than the last | 3.25 m lower after letting go, 6.50 m after a jump, unless the wall turns by 25.84° or more | AMW-C |
| Ziplines | caught by use or by jumping into them while looking within 35° (90° in the air); momentum along the line kept; three catches per jump | 15.24 m/s top (12.19 m/s vertical); 10.16 m/s² to it (25.4 m/s² when jumping on); off at up to 11.3 m/s by a jump (10.16 m/s added) | AMW-Z |
| Redeploy balloon | a vertical zipline up to a balloon, then a skydive | skydiving at 20 to 35 m/s; the landing pose about 30 m up | AMW-Z, AMW-A |
| Ladders | ours, from GTA V and Red Dead Redemption 2: Apex has none | up and down at the run's speed × 0.5 *(tuned)*; a jump off; a mantle at the top | none |
| Doors | use toggles; a door swings away from the player, either way; bodies block it; melee only counts when the player faced it as the swing began | the first melee hit knocks it open, the second breaks it; an explosive breaks it at once | WGD, AMW-IT |
| Melee | a punch or a kick with a lunge to a target in reach; the weapon comes back after; a melee from a slide is an uppercut | 30 damage; reach 1.52 m in a 30° cone; the lunge 0.35 s; the weapon back after 0.75 s; the view frozen 0.25 s on a hit | DX, R5W |

Sources (fetched 2026-10-17): AMW is the Apex Movement Wiki, https://apexmovement.tech/wiki, whose pages the tags
name (G ground, S slide, AS advanced slide, A air, L lurch, M mantle, SG superglide, MB mantle boost, C and AC climb, Z
ziplines, IT item interactions, LT legend tech, EN the engine, BH bunny hops); ERA is er-apex, a reconstruction of
Apex's movement from its files (https://github.com/umiiii/er-apex: p its parameters, c its controller); CVAR is an
Apex console-variable dump (https://github.com/240hz/ApexConfigs); R5W are R5Reloaded's season 3 weapon files
(https://github.com/CafeFPS/r5_flowstate); TF2 are notes on Titanfall 2's decompiled movement
(https://github.com/Kurisu003/titanium-dioxide); WGD is the wiki.gg door page (https://apexlegends.wiki.gg/wiki/Door);
DX is Dexerto on melee. One unit is an inch (0.0254 m), as Respawn's own scripts convert; wiki figures that assume
0.75 in run 25% low.

### 3.3 Controls

Apex's default bindings where the browser allows; every action rebinds (WP 13.9, WP 13.25).

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move | W A S D | left stick |
| Look | the mouse, under pointer lock | right stick |
| Jump | Space | A |
| Crouch and slide | C (hold; the toggle a setting): Apex's Left Ctrl closes the tab with W | B |
| Sprint | Left Shift (hold or toggle) | left stick click |
| Walk (ours, §3.2) | Left Alt (hold) | a light tilt of the stick |
| Use | E | X |
| Melee (the door kick) | V | right stick click |
| Fire, aim down sights | left and right mouse buttons | RT, LT |
| Reload, holster | R, 3 | X (hold), Y (hold) |
| Camera mode, shoulder swap | T, X | view button, d-pad left |
| Isometric turn | Q and E (isometric only) | d-pad right |
| Pause, menu | Escape | menu button |

### 3.4 Feel beyond the numbers

- Presses are never lost: a jump, a crouch or a mantle pressed up to the buffer before it can happen still happens, and
  a jump just after leaving a ledge still jumps (the existing coyote time and buffer, PLAN.md WP 3.2).
- Every move has its camera effect (§4), its animation (§5.1) and its sound (§8.1); none is silent or static.
- The owner's feel panel (WP 13.4) changes any number live and copies the result as a profile, so a playtest's
  tuning comes back as data.

## 4. The cameras

The field of view is Apex's: horizontal degrees at 4:3, a slider from 70 to 110 (Apex starts at 70; the playground at
90); aiming down sights zooms to the weapon's (Apex's rifles 55 and pistols 60 at a field of view of 70) in about
0.25 s.

Five modes, switched live (`T` cycles them, the menu picks one, `?cam3=` or `?cam=` starts in one,
`__engine.camera.set` sets one) with a blend of 0.35 s over position, turn and field of view, orthographic and
perspective meeting at a matched frustum. Cameras are view-only: the sim gets only the recorded `look`, `aim` and
`cam` intents, so no camera, effect or switch changes a hash.

| Mode | Code | The rig | Moves relative to | Aims with |
|---|---|---|---|---|
| First person | `cam3=first` | the profile's eye height (Apex: 1.52 m standing, 0.81 m crouched), not the body's eyes; the viewmodel arms and weapon in their own pass, never clipping (WP 13.12), as Apex shows them (no legs; the full body as an option); Apex's effects: the sprint lowers the eye 0.15 m and rolls up to 2° into turns, a boosted slide widens the field of view ×1.1 and rolls up to 15°, jumps and landings kick the view on a spring, the weapon bobs on a 0.4 s cycle | the look | the screen centre |
| Shooter | `cam3=shoulder` | over the right shoulder (0.5 m right, 0.3 m up, 3.8 m back, Apex's third-person distance), swapped to the left with X; aiming down sights pulls in to 1.5 m and zooms as first person does | the look | the screen centre's ray: the body aims at its hit point |
| Platformer | `cam3=follow` | orbit and follow: arm 5.5 m, pitch −20°, recentring behind the movement after 1.5 s without look input, 1 m of look-ahead, a vertical dead zone of ±1.5 m so jumps do not shake the frame | the camera | where the character faces |
| Isometric | `cam=iso` | orthographic, azimuth 45°, elevation 30°; Q and E turn it by 90°; whole-number zooms; the storeys above the player cut away | the screen | the pointer's ray onto the player's floor; twin sticks on a pad |
| Top-down | `cam=overhead` | orthographic, straight down, north up; whole-number zooms, pixel-exact; the storeys above and the roof hidden indoors | the screen | as isometric |

Every follow camera collides: a 0.2 m ball cast through the query view pulls it in and eases it out, and a wall between
it and the player fades. The bounds the camera metrics check (WP 13.4, §9.1): no frame moves the camera more than
0.3 m, or turns it more than 4°, beyond what the player's motion, the look input and a blend account for; no frame
inside geometry; the player in view in every frame (the arms in first person).

## 5. How it looks

### 5.1 Animation

Motion comes from the library where it is good and from the procedural humanoid where nothing fits, warped and
planted so that feet and hands stay where they touch (WP 13.10, WP 13.11, WP 8.8).

| Move | Its motion |
|---|---|
| Idle, walk, run, sprint, crouch-walk | blend sets in eight directions: 100STYLE's neutral and crouched sets, Quaternius's jog, sprint and crouch, Mesh2Motion's strafes; phase-synced on foot contacts, stride- and orientation-warped |
| Starts, stops, pivots, turning in place | matched to distance; Mesh2Motion's turns and CMU's quick stop where they fit, procedural otherwise |
| Slide | Quaternius's slide start, loop and exit; the pelvis to the slope; a hand trailing on the ground |
| Jump, fall, landings | rise, apex and fall poses by vertical speed; the soft and the hard landing (Mesh2Motion's three-point landing) by landing speed |
| Mantle, mantle hang | the hands on the sim's contact points, the body over (Quaternius's climb warped to the height); a fence's top under one hand at a sprint; Mesh2Motion's ledge hang |
| Wall-climb, ladder, zipline, skydive | hand over hand with the feet pushing; the ladder cycle locked to the vertical speed; both hands on the cable; the skydive's spread pose and its dive |
| Door kick, melee | Mesh2Motion's `Kick_Breach`, its hit at the strike; the engine's 12 fist and kick moves |
| Holding and aiming | the weapon lowered at a sprint; the support hand on the grip; aim offsets by pitch and yaw; the head and eyes toward the aim |

The bounds, over every course (§9.1): a planted foot drifts at most 5 cm per contact (the anim QA's limit, ADR-0009
amendment 6); a hand stays within 3 cm of its contact; no transition pops (the anim QA's twist-pop bound); the muzzle
points within 2° of the aim.

### 5.2 The two looks

Both are tuned for each of the five cameras, by day and by night (WP 13.24).

- **Cel-shaded:** a light ramp per material (three bands and a rim), shadows shifted in hue rather than darkened, ink
  from depth and normals at a width scaled to the resolution, the outline shell on props and bodies (skinned bodies
  included), a sky gradient. Ink never comes from texture brightness.
- **Pixel art:** a low-resolution render at a whole-number scale (the largest scale that gives 240 to 360 lines), 1-pixel
  ink from depth and normals, palette ramps per material with an ordered dither fixed to the world, the orthographic
  cameras snapped to the pixel grid in translation with the sub-pixel remainder carried as a smooth offset of the
  upscaled picture (no shimmer when the camera pans), whole-number zooms, and a perspective variant for first person and
  the shooter, where snapping cannot hold.
- The look metrics (WP 13.24): thumbnails per look and camera; the shimmer metric (pixels changed by a sub-pixel
  orthographic pan) is 0 in the pixel look; contrast and palette use within each look's bounds.

## 6. Levels with storeys, and sites

### 6.1 Storeys (level format 2)

Format 2 (`my3dge-level/2`, WP 13.13) is a superset of today's format: a format-1 file is one storey at height 0 and
compiles to the same data and hash.

- **Storeys:** a file holds several maps of the same size, each a storey with its base height and its clear height,
  read top to bottom of the file as bottom to top of the building; a base may be below 0 (a basement).
- **Glyphs:** the legend gains void (no floor: a stairwell, a double height, the outside), doors, windows, railings,
  stairs from one storey to the next, ladders, roof areas (gable, hip or flat, with a pitch) and room markers.
- **Colliders:** walls per storey, slabs with their openings, stair hulls and roofs, all fixed bodies in `world`.
- **Queries in 3D:** `floorBelow(level, x, y, z)`, and the storey, the room and the surface at a point. The 2D queries
  stay for single-storey levels.
- **Validation:** a door wider than the capsule, stairs within the climb limit, headroom where the capsule stands,
  every room reachable (`node x qa level`).
- **Drawing** (WP 13.14): walls with door and window openings (frames, lintels, sills), slabs with their openings,
  stair flights, railings, roofs with eaves and a chimney, materials per room.

### 6.2 Rooms

Room markers name the floor areas walls and doors enclose. A room is data the rest of the playground reads: its
reverb (§8.1), its light group (§8.2), its name on the HUD, and the cutaway's grouping.

### 6.3 Sites

A scene stands any number of levels on its terrain (WP 13.15): each placed at an offset and a turn of 90°, the terrain
cut under it (basements and window wells; Rapier 0.21's heightfield has no holes, so the terrain is cut into
triangle-mesh chunks there). `floorBelow`, `surfaceAt`, sight lines and the lost-body rescue answer over all of them;
navigation is a grid per storey and over the terrain, linked through stairs, ladders and doorways; the cutaway hides
what is above the player's storey, and the roof when indoors.

## 7. Things to do

### 7.1 Doors, windows, switches and pickups

All sim-side and replayable (WP 13.16):

- **Use** (E): the usable thing in reach and in view, its prompt on the HUD with the binding of the device used last.
- **Doors:** hinged; use opens one away from the player and closes it, as Apex's do; locked; a body in the way blocks
  it. The first kick or punch bursts it open, the second breaks it off its hinges (Apex's rule; only when the player
  faced it as the swing began): the slab falls and splinters fly. Explosives and shots break it too.
- **Windows:** panes that break and leave the opening passable.
- **Switches:** room lights, the porch light, the garage door.
- **Pickups:** carry a light prop (a chair, a ball, a box) and throw it along the aim.

### 7.2 Weapons and the range

A pistol and a rifle (the kind `weapon`, WP 13.20), built from parts: hip fire and aiming down sights, hitscan through
the sim's raycasts, spread and a recoil pattern as data, reloading, holstering (holstered runs faster, as in Apex),
impacts with decals, particles and sounds, tracers. The range's targets pop up and move; the HUD keeps hits and
accuracy. Every camera aims, isometric and top-down with the pointer.

### 7.3 Melee and the ring

The punch and the kick (WP 13.19), with Apex's numbers (§3.2): a lunge to a target in reach, 30 damage, the uppercut from
a slide; their hits land on props, doors, dummies and people; the second kick breaks a door off its hinges; hit-stop,
a shake and a sound sell each one. The ring's dummies spring back; two of them ragdoll on a hard hit
and get up (WP 10.2).

### 7.4 The neighbours and the dog

- **Neighbours** (WP 13.21): a handful of people on routes and schedules (the sidewalk, a porch, the garden bench),
  over the site's navigation. They look at the player, step aside, flinch when shoved, startle at a kick or a shot
  (awareness, WP 10.4), ragdoll on a hard hit and get up. Their bodies and outfits vary by seed.
- **The dog** (WP 10.1, WP 13.21): a quadruped on the procedural building blocks' planted gait, following the player, sitting,
  and fetching a thrown ball.

## 8. Sound, light and the front end

### 8.1 Sound

(WP 13.22.) Footsteps by surface (wood, tile, carpet, concrete, grass, gravel, metal) and gait; foley for slides,
landings, mantles, climbs, ladders and ziplines; doors, windows, switches, impacts by material, gunshots and reloads;
reverb from the room the listener stands in (the basement's concrete, a carpeted bedroom, outdoors); indoor and outdoor
ambience; occlusion through walls; wind that rises with speed. Every sound is procedural DSP, as the engine's are.

### 8.2 Light and time

(WP 13.23.) The time of day is sim state a scene sets and runs; the sky, the sun, fog and ambience follow it in the
view. Switchable lights are sim components the light pool reads each frame: room lights, the porch light, the
streetlights at dusk. Beyond the pool's count, tiled lighting (WP 11.5) carries the house; cascaded shadows cover the
yard, ambient occlusion the rooms; rain and dust are GPU particles (WP 11.3).

### 8.3 The front end

(WP 10.6, WP 10.9, WP 13.25.) A title screen; the spawn picker (each area and room); pause; settings (camera mode and
field of view, controls and rebinding, sensitivity, the movement profile, the look, audio levels, graphics and quality),
kept across sessions by the store; the HUD for each camera (crosshair, prompts, ammo, the feel readout); photo mode
(the free camera and the looks).

## 9. How we know it feels and looks right

### 9.1 Numbers agents check

- **Courses** (`node x feel <lab> --course <name|all>`, WP 13.4): each gym feature driven by scripted intents, its
  numbers checked against §3.2's reference values and tolerances, the report at `out/feel/<course>/report.json`.
- **Animation metrics** on the same runs: foot slide, pops, hands at their contacts, aim error (§5.1's bounds).
- **Camera metrics** on the same runs: continuity, never inside geometry, the player in view (§4's bounds).
- **Look metrics**: thumbnails, the shimmer metric and the look metrics per look and camera (§5.2).
- **Reach**: the bot (WP 5.6) reaches every room of every storey and every area from the spawn and back; in Node, the
  agent eye (WP 12.3) says whether the player is in view from each camera in every room.
- **Performance**: 0 pipelines built after the warm-up in every camera and look; `node x perf` counters; GPU time on
  the owner's machine (WP 11.2).

### 9.2 Replays and the tour

Every move, every course and every interaction has a replay with golden hashes in Node and in the rendering page. The
tour (WP 13.26) is one replay through every feature in every camera and both looks: the attract mode, a film per look,
and a check in T2.

### 9.3 The owner's playtest

At each gate the stage's PR carries this checklist; the owner plays, and notes come back as tuning (the feel panel's
profile and its saved replay), never as a blocker:

1. Sprint the strip in first person: speed, the sprint's field of view, the stop.
2. Slide down the 20° ramp and slide-jump off its end: is the speed kept?
3. Mantle every wall, vault every bar, climb every climb wall: which heights feel wrong?
4. Superglide off the 1.5 m wall, and with the mantle boost on.
5. Ride the tower's zipline and jump off halfway; ride the balloon up and skydive onto the roof.
6. Kick in the front door, break a window, throw a chair, switch the kitchen light.
7. In the shooter camera: aim down sights at the range, swap shoulders, walk the house's rooms; the camera never
   clips a wall.
8. In the platformer camera: run and jump around the yard; does the recentring help or fight?
9. In isometric and top-down: walk every storey; the right floors cut away; aim with the pointer.
10. Everything in both looks, at noon and at night.

## 10. The work

PLAN.md Phase 13 holds the stages (Feel G10, The house G11, Alive G12, The tech demo G13), the work packages and their
order. Each on-demand WP the playground fires names, in its Trigger line, the need here that fires it. The
playground's content stays in `labs/playground/`; what the engine gains is generic (PLAN.md §5.7).

## 11. Beyond the playground

The road from this slice toward the gameplay of the four games. Each pillar grows from something the playground
builds; each later slice gets its own ADR and phase, chosen by the owner after playing this one.

| Pillar | Games | What the engine needs | Grows from |
|---|---|---|---|
| On foot | all four | movement, cameras, animation, interaction | this playground |
| Shooting and melee | all four | cover, a weapon wheel, lock-on, hit reactions, ragdolls | WPs 13.19, 13.20, 10.2, 10.4 |
| Vehicles | GTA V, Cyberpunk 2077 | ray-cast vehicles (Rapier's vehicle controller), getting in and out, driving cameras, traffic | the street, the garage's car, the camera modes |
| Horses | Red Dead Redemption 2 | quadruped gaits at speed, mounting, riding cameras, the horse's mind | the dog (WP 10.1) |
| Open world | GTA V, RDR2, Cyberpunk 2077 | streaming terrain and structures, level of detail, foliage, weather | sites (WP 13.15), terrain (WP 10.5), light and time (WP 13.23) |
| Population | GTA V, RDR2, Cyberpunk 2077 | schedules, crowds, reactions, a wanted level, traffic | the neighbours (WP 13.21), crowds (WP 11.4), awareness (WP 10.4) |
| Abilities and stealth | Apex Legends, Cyberpunk 2077 | abilities with cooldowns, awareness, cover, hacking | melee and firearms, awareness |
| Story | RDR2, GTA V, Cyberpunk 2077 | missions as data, dialogue, cutscenes on camera rails, saves | the front end, the store, the rail camera |
| Progression | Cyberpunk 2077, RDR2 | inventory, an economy, perks, outfits | the store, the body grammar |
| Multiplayer | Apex Legends | lockstep or rollback over the deterministic sim | the replay format (doctrine principle 5); Phase H |

Suggested next slices, after the owner plays this one: the street (driving, GTA V); the ranch (a horse, RDR2); the
block (an open neighbourhood with population, day and weather); the mission (story systems); the arena (abilities and
multiplayer, Apex Legends).
