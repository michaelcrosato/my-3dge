# Famous animations, and which ones to predraw

A survey of iconic animations from the games my-3d2dge was built to remake (NES to PS1/N64, plus a few modern retro references), grouped by views and genres. It ends with a ranked list of animations worth shipping ready-made, so a model can ask for them by name instead of animating them by hand, and with a map of how much of that list my-3dge's animation library already holds.

The research ran in five sweeps: side view, brawler and fighting, three-quarter and top-down, isometric and 3D-era, and JRPG battles plus shoot-'em-ups. Sources are linked in each row. Frame counts come from code wherever possible: the published *Prince of Persia* source, the *Zelda 1* and *Pokémon Red* disassemblies, the *A Link to the Past* and *Super Mario 64* decompilations, the DevilutionX data tables for *Diablo*, and the Sonic Physics Guide. "f" means one frame at 60 fps unless a row says otherwise. Where no source gave a number, none is given.

**Ported from my-3d2dge** (`my-3d2dge:docs/ANIMATION-RESEARCH.md`, PLAN.md WP 8.1), with three changes:
- **The 2D engine's status is dropped:** the "Engine" column of section 3, and the inventory of what my-3d2dge drew (`my-3d2dge:docs/ANIMATION-RESEARCH.md:31-77`). None of that engine came over, so none of it says what my-3dge can do.
- **The 2D engine's names stay where the survey proposed with them** (sections 4 to 6): `E.MOVES` was its table of attacks, `E.ACTIONS` the library of multi-beat sequences it proposed, `rig.update` its per-frame rig input. Section 2 says what each became here.
- **Section 7 is new:** the coverage map, the ranked list of section 5 against the clips in `data/anim/` (`docs/ANIMATION-LIBRARY.md`). `tests/unit/data/anim/catalogs/coverage.test.ts` checks every clip and count it names.

**Contents**
1. [What "predrawn" means here](#1-what-predrawn-means-here)
2. [The missing layer](#2-the-missing-layer)
3. [Famous animations by view and genre](#3-famous-animations-by-view-and-genre)
4. [What the research says](#4-what-the-research-says)
5. [What to predraw](#5-what-to-predraw)
6. [Build order](#6-build-order)
7. [The coverage map](#7-the-coverage-map)
8. [Timing references](#8-timing-references)
9. [Keeping it model-friendly](#9-keeping-it-model-friendly)

## 1. What "predrawn" means here

my-3dge animates from continuous values: procedural rigs, and clips from the animation library played through the clip layer (PLAN.md §10.4). So "predrawn" never means frame lists. It means an animation that ships **named, timed and tuned**:

- a model asks for it in one line, by name: an attack move, a held pose, an action, a library clip, a death effect;
- it has anticipation, a committed action, follow-through and a clean return built in;
- it works on every build (chibi, heroic, bulky, skeleton) and from every camera;
- a model can't easily get it wrong, because timing and body motion are already solved.

An animation is worth predrawing when:
- many genres need it;
- it's hard to author by hand (many joints moving in sequence, IK, whole-body rotation, cloth, a timed chain of states);
- or getting it wrong is what makes a remake look like an NES game instead of a PS1 one.

## 2. The missing layer

my-3d2dge packaged *attacks* in `E.MOVES` (wind, strike, recover), but nothing packaged the non-attack animations that are several beats long: knocked down → sit up → kneel → stand, lift → carry, item held up, ledge hang → climb up, roll. Its animation lab and each game slice rebuilt these as private phase lists (`[label, seconds, rigState]`). A shared library of actions, played by one call, is what turns most of the list below into one-liners.

In my-3dge that library is **ACTIONS** (PLAN.md WP 8.7): multi-beat sequences that combine timelines, library clips and effector overrides, with held contact frames, events and cancel windows. The survey's other names map the same way:
- `E.MOVES` → the engine's attack moves; an attack can also play a library clip and land its hit at the clip's strike time (WP 8.4);
- `E.ACTIONS` → ACTIONS;
- a rig input (`rig.update(dt, {...})`) → an input of the character's animator (WP 3.7);
- a layer over the rig → a layer of the character's layer stack (PLAN.md §10.4);
- reactions (hurt, knocked down, get-up) → WP 6.2's directional flinch and down, die and get-up timelines, with the ragdoll hand-off of WP 10.2.

## 3. Famous animations by view and genre

### 3.1 Side view: platformers, Metroidvanias, run-and-guns, cinematic platformers, fighters

| Animation | Game | What happens |
|---|---|---|
| Skid turnaround | [Super Mario Bros. 3, SMW](https://tcrf.net/Prerelease:Super_Mario_Bros./Sprites) | Reverse at speed: one braced skid pose while momentum carries him on, dust puffs, then a flip into the new run. Copied by almost every platformer. |
| Bored idle | [Sonic 1 and 2](https://info.sonicretro.org/SPG:Animations) | Sonic 2: 180f still, blink, look at the camera, foot taps every 18f, a watch check (60f), ×4, then lies down tapping his shoe. The textbook impatient idle. |
| Run rate tied to speed | [Sonic](https://info.sonicretro.org/SPG:Animations) | Frame time `max(0, 8 − speed)`. Whirling legs from speed 6; figure-8 feet from 10 (CD). |
| Spin dash rev and ball roll | [Sonic 2](https://info.sonicretro.org/SPG:Animations) | Crouch, curl, each press resets the spin (reads as revving) with a dust plume; release into a rolling ball. |
| Edge teeter | [Sonic 1-3](https://info.sonicretro.org/SPG:Animations) | Near a ledge: arms windmill, the body wobbles. Two or three variants by how far over the edge. |
| Run, jump, ledge hang, climb up | [Prince of Persia](https://github.com/jmechner/Prince-of-Persia-Apple-II) | Rotoscoped. 6 start-up frames into an 8-frame run, 8-frame turn, 18-frame standing jump, 14 frames to hang, 17 to climb up, and climbing down plays the climb up in reverse. |
| Death burst, teleport in | [Mega Man](https://megaman.fandom.com/wiki/Teleportation) | Death: the body vanishes and energy orbs fly out in rings. Stage start: a beam drops from the sky and unfolds into the hero. |
| Slide, dash, wall slide, wall kick | [Mega Man 3, Mega Man X](https://megaman.fandom.com/wiki/Wall_Kick) | A low slide with dust at the heel; a dash lean with dust; clinging to a wall and sliding down, then a kick off it with a spark. |
| Whip crack, backward knockback | [Castlevania](https://tasvideos.org/GameResources/NES/Castlevania) | Whip cocked behind the head, then out full length. The swing lasts 22 ticks and hits only on tick 17. Hurt: a stiff backward hop, 14 px high, about 100f of flicker. |
| Backdash with afterimages | [Symphony of the Night](https://www.sotn.fun/wiki/Alucard) | A quick, low glide backwards, the cape trailing; 6 ghost copies of older frames, drawn alternately. |
| Spin jump, Screw Attack, morph ball | [Super Metroid](https://metroid.fandom.com/wiki/Screw_Attack) | The running jump becomes a tight tucked somersault; the Screw Attack wraps it in an energy aura. The morph and the turnaround can't be interrupted. |
| Somersault jump, prone, 8-way aim | [Contra](https://en.wikipedia.org/wiki/Contra_(video_game)) | Every jump is a curled somersault; lying prone ducks shots; the torso aims 8 ways while running; death is a backward flip onto the back. |
| Enemy personality | [Metal Slug](https://metalslug.fandom.com/wiki/Enemy_Deaths) | Soldiers idle and chat, start in surprise, panic and flee screaming; each weapon kills differently (fire leaves them charred); freed prisoners salute. |
| Flutter jump | [Yoshi's Island](https://www.mariowiki.com/Flutter_Jump) | At the top of a jump the legs pedal on air with a strained face, then he drops. |
| Inhale, float | [Kirby's Adventure](https://wikirby.com/wiki/Kirby_Dance) | A huge open mouth and wind lines pulling enemies in; puffed up floating with flapping arms; the victory dance. |
| Helicopter hair, thrown fist | [Rayman](https://en.wikipedia.org/wiki/Rayman_(character)) | Hold to wind up a punch; the fist flies out and boomerangs back. Hair spun like a rotor slows the fall. |
| Ear-flap hover, grab and ride | [Klonoa](https://en.wikipedia.org/wiki/Klonoa:_Door_to_Phantomile) | Catch an enemy, inflate it, carry it overhead, then throw it or jump off it for a double jump. |
| Dash with state in the hair | [Celeste](https://celeste.ink/wiki/Dashing) | 15f dash including 3 frames of freeze; the hair color shows dashes left; strong squash and stretch on jumps and landings. |
| Grounded, weighty moves | [Flashback](https://en.wikipedia.org/wiki/Flashback_(1992_video_game)), [DKC](https://en.wikipedia.org/wiki/Donkey_Kong_Country) | Rotoscoped rolls and ledge pulls; pre-rendered rolls and cartwheels; DK pounding his chest. |
| Hadouken, Shoryuken | [Street Fighter II](https://en.wikipedia.org/wiki/Hadouken) | Hands cupped back to the hip, then both palms thrust forward; the ball spawns at the palms and the arms stay locked out through a long recovery. The Shoryuken coils low, then leaps in a spinning rising uppercut, fist first. |
| Parry | [SF III: 3rd Strike](https://3sos-blog.tumblr.com/post/7840889745/parry-frame-data) | Tap toward the hit at the moment of impact: a blue flash and both fighters freeze. 10f window on the ground, the attacker frozen 20f. |
| Dizzy | [SF II](https://streetfighter.fandom.com/wiki/Stun_Gauge) | Sways in place; stars, birds or angels orbit the head (longer stun, bigger icon). |
| Win poses, taunts | [SF II](https://gamerant.com/street-fighter-most-satisfying-victory-animations/), [3rd Strike](https://steamcommunity.com/app/586200/discussions/0/1696048879946163048/) | Ryu pumps a fist or crosses his arms and turns away; Sagat laughs; 3rd Strike taunts buff the fighter (Dudley throws a rose). |
| Hit reactions by element | [Darkstalkers](https://www.eventhubs.com/news/2025/jan/19/darkstalkers-characters-shocked-sprites/) | Every character has its own electrocuted and burned sprites; the frozen one is shared by the whole cast. Big squash and stretch on impact. |

### 3.2 Brawler view: beat-'em-ups

| Animation | Game | What happens |
|---|---|---|
| Grab → pummel → throw | [Final Fight](https://kb.speeddemosarchive.com/Final_Fight/Basics) | Walk into a foe to grab them; three knees or headbutts, the third knocks them loose; direction + attack throws over the shoulder or suplexes. Thrown bodies knock down other foes. |
| Piledriver | [Final Fight (Haggar)](https://kb.speeddemosarchive.com/Final_Fight/Basics), [SF II (Zangief)](https://streetfighter.fandom.com/wiki/Spinning_Piledriver) | Grab, leap spinning, drive the foe head first into the floor. The archetypal command grab. |
| Desperation spin | [Final Fight](https://kb.speeddemosarchive.com/Final_Fight/Basics) | Attack + jump: an invincible spin kick that knocks down everyone near and costs a little health (only if it connects). |
| Dash into rising uppercut | [Streets of Rage 2 (Axel)](https://www.nintendolife.com/news/2021/08/random_weve_been_wrong_about_this_streets_of_rage_special_move_for_almost_30_years) | Forward, forward, attack: a dash with the fist low, then a multi-hit flaming uppercut that sends foes flying. |
| Hair-grab knee, back elbow, weapon pickup | [Double Dragon](https://en.wikipedia.org/wiki/Double_Dragon_(video_game)) | Knee a held foe, flip them over the shoulder; a backward elbow; knock a bat or whip out of a foe's hands and pick it up. |
| Throw at the screen | [TMNT: Turtles in Time](https://en.wikipedia.org/wiki/Teenage_Mutant_Ninja_Turtles:_Turtles_in_Time) | A Foot soldier flies toward the viewer, growing until he hits the glass. |
| Magic cast, mounts | [Golden Axe](https://www.hardcoregaming101.net/golden-axe/) | Weapon raised, then a screen-filling spell scaled by pots spent (a 6-pot dragon). Kick a rider off a beast and ride it. |
| Launcher and juggle | [Guardian Heroes](https://www.hardcoregaming101.net/guardian-heroes/), [Streets of Rage 4](https://en.wikipedia.org/wiki/Streets_of_Rage_4) | A launcher sends foes up; they are juggled in the air and bounce off the screen walls. |
| Break a container, eat, pick up | [Final Fight](https://en.wikipedia.org/wiki/Final_Fight_(video_game)) | Barrels burst into a pipe, a knife or roast chicken; crouch to pick up; weapons wear out. |
| Lift and throw a body | [River City Ransom](https://en.wikipedia.org/wiki/River_City_Ransom) | Downed foes can be picked up and thrown like weapons. |
| Hit-stop | [SF II onward](https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/) | Both fighters freeze on contact, longer for heavier hits; the victim shakes (sideways on the ground, up and down in the air). |
| Knockdown, bounce, get up | every beat-'em-up | Flight arc, one bounce, lie there, get up with blinking invulnerability. |

### 3.3 Three-quarter and top-down: action adventures, JRPG towns, life sims, twin-sticks

| Animation | Game | What happens |
|---|---|---|
| Item get | [Zelda 1](https://github.com/aldonunez/zelda1-disassembly), [A Link to the Past](https://tvtropes.org/pmwiki/pmwiki.php/Main/ItemGet) | Stop, face the camera, raise the item overhead with both arms (one arm for thin items) for 128f while a jingle plays. ALttP lifts the item out of the chest on an arc first. Copied by Stardew and Harvest Moon. |
| Spin attack charge and release | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c) | After a swing, hold: the sword points forward, sparkles start after 6f, ready at 48f. Release: 12 steps through all 8 directions (~34f). The same routine is the victory spin after a boss. |
| Sword arc per facing | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c) | 90° arc in 9 steps (~14f), step 5 held longest: the contact frame, where grass is cut. |
| Lift, carry, throw | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c), [Harvest Moon](https://gamefaqs.gamespot.com/snes/562623-harvest-moon/faqs/52336) | Crouch, grip, overhead (6/7/7f; a heavy rock strains first). Walk with it overhead, no sword. Throw: the pot flies on an arc with its shadow and shatters. |
| Grab, push, pull | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c) | Pull loop of 3 poses at 5/5/12f, the long third one the heave. Pushing: lean on the block, then it slides a tile. |
| Pegasus boots | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c) | 29f of running in place with dust, the legs speeding up; then a locked dash with the sword out like a lance; a bonk off walls. |
| Fall into a pit | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/player.c) | Pulled toward the centre; then the body shrinks through 6 steps of 10f and vanishes. |
| Hurt knockback | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/sprite.c) | Pushed away along the line from the enemy, a small hop, no control for 19f, flickering for 58f. The genre's default damage feel. |
| Death spin | [A Link to the Past](https://github.com/snesrev/zelda3/blob/master/src/messaging.c) | The screen turns red, an iris closes on him, he spins through the 4 facings three times (~6f each) and collapses. |
| Room scroll | [Zelda 1](https://www.gridbugs.org/zelda-screen-transitions-are-undefined-behaviour/) | Control freezes and the camera slides a full screen; the HUD stays. |
| Ledge hop with a shadow | [Pokémon Red](https://github.com/pret/pokered/blob/master/engine/overworld/ledges.asm), [Link's Awakening](https://www.zeldadungeon.net/wiki/Roc's_Feather) | A 16-step height curve (~12 px, a hang at the top) over two tiles while a shadow stays on the ground. |
| "!" when spotted | [Pokémon](https://github.com/pret/pokered/blob/master/engine/overworld/emotion_bubbles.asm) | Music cuts, a "!" bubble for 60f, then the trainer walks up. Gen 1 also has "?" and a smile. |
| Battle-entry wipes | [Pokémon Red](https://github.com/pret/pokered/blob/master/engine/battle/battle_transitions.asm), [EarthBound](https://en.wikipedia.org/wiki/EarthBound) | 8 wipes chosen by trainer or wild, stronger enemy, dungeon (spirals, circles, stripes, shrink, split); wild battles outdoors open with 3 screen flashes. EarthBound's swirl color says who strikes first. |
| Dodge roll | [Minish Cap](https://zelda.fandom.com/wiki/Rolling) | A forward roll while walking; a roll attack comes out of it. |
| Charged weapon levels, knocked flat | [Secret of Mana](https://kb.speeddemosarchive.com/Secret_of_Mana) | Hold to charge one level per weapon level; each weapon has its own charged move. Big hits knock you flat and you get up. |
| Dash, slide, comet | [Illusion of Gaia](https://www.terraearth.com/illusion-of-gaia/moves/will/), [Terranigma](http://retrogameresource.com/index.php/2018/05/10/europes-chrono-trigger-terranigma-snes-resource/) | Hold until he flashes, release a dash; run then slide under gaps; dash → jump → a comet that crashes down and slides. |
| Party follows the leader | [EarthBound](https://forum.gamemaker.io/index.php?threads/followers-snake-earthbound-like-added-code-22-11-2020.81098/), [Chrono Trigger](https://en.wikipedia.org/wiki/Chrono_Trigger) | Followers replay the leader's path; in Chrono Trigger they break formation into battle positions on the spot. |
| Tool swings | [Stardew Valley](https://stardewvalleywiki.com/Modding:Farmer_sprite) | Hoe, axe or pickaxe: 150/40/40/170/75 ms (a slow wind-up, two smear frames, a held impact). Watering can: a 500 ms pour. Charging holds the next-to-last frame. Fishing: cast, reel, hold the catch up. |
| Melee kill, floor finish | [Hotline Miami](https://steamcommunity.com/sharedfiles/filedetails/?id=1404594863) | Legs walk one way while the torso turns to aim; pin a downed foe and strike. |
| Move one way, shoot another | [Smash TV](https://en.wikipedia.org/wiki/Smash_TV) | Twin sticks: 8-way movement, a separate firing direction. |
| Chain dash | [Hyper Light Drifter](https://steamcommunity.com/app/257850/discussions/0/343787920125272653/) | Press again as the Drifter rises from a dash to chain another. |

### 3.4 Isometric: action RPGs, dungeon crawlers, 3D-era remakes

| Animation | Game | What happens |
|---|---|---|
| Whirlwind | [Diablo II](https://diablo.fandom.com/wiki/Whirlwind_(Diablo_II)) | A spin with weapons out along a path; stun and knockback are ignored while it lasts. Copied by Path of Exile, Diablo III and IV. |
| The action-RPG move set | [Diablo II](https://maxroll.gg/d2/resources/breakpoints-animations), [Diablo](https://github.com/diasurgical/devilutionX/tree/master/assets/txtdata/classes) | Neutral, town neutral, walk, town walk, run, two attacks, kick, throw, four skills, cast, get-hit, block, death, corpse. Each has an "action frame" where the hit lands: a Diablo warrior's sword swing is 16 frames, hitting on 9. |
| Deaths by damage type | [Diablo II](https://diablo2.diablowiki.net/Freeze), [Diablo III](https://www.diablowiki.net/Death) | Frozen kills shatter and leave no corpse; fire leaves burning chunks; lightning a blackened husk; poison green smoke; critical kills explode. |
| Monster entrances | [Diablo](https://github.com/diasurgical/devilutionX/blob/master/assets/txtdata/monsters/monstdat.tsv), [Diablo II](https://diablo2.diablowiki.net/Fallen) | Skeletons rise from the ground; gargoyles wake from stone; the Fallen flee when a friend dies and come back; shamans revive the dead. |
| Ground pound | [Super Mario 64](https://github.com/n64decomp/sm64/blob/master/src/game/mario_actions_airborne.c) | A somersault that nudges him up for 10 frames, a hang, a "wah!", a straight drop, then a dust ring, a star burst and a camera shake. |
| Long jump, triple jump, backflip | [Super Mario 64](https://ukikipedia.net/wiki/Long_Jump) | Long jump: belly first, arms out, flying far and low. Triple jump: a flourish somersault. Backflip: a tucked backward somersault, very high. |
| Wall kick | [Super Mario 64](https://ukikipedia.net/wiki/Glitchy_Wall_Kick) | Flattened against the wall for a moment, then a kick off it, turned round. |
| Ledge grab, swim, bored idle | [Super Mario 64](https://github.com/n64decomp/sm64/blob/master/src/game/mario_actions_stationary.c) | Hang, then a slow or fast pull-up; breaststroke taps and a flutter kick; idle looks round, then after 10 cycles scratches, yawns, sits and sleeps; shivers on snow, pants at low health. |
| One death per hazard | [Crash Bandicoot](https://crashbandicoot.fandom.com/wiki/Death_animations) | Fire: ash that looks at the camera and crumbles. TNT: only shoes and eyes left. Electricity: a flashing skeleton. Crushed flat. Drowned. Frozen in a block. Shrunk away. Fell, and the shoes bounce back out. |
| Spin, belly flop | [Crash Bandicoot](https://all-things-andy-gavin.com/2011/02/04/making-crash-bandicoot-part-3/) | A tornado spin that keeps momentum in the air; jump then slam down belly first. Looney Tunes squash and stretch, a new face every frame. |
| Charged spin, lock-on moves | [Ocarina of Time](https://zeldawiki.wiki/wiki/Spin_Attack) | Hold to cock the sword behind, release to spin (twice if charged 2 s). Locked on: sidehop, backflip, a leaping jump attack; free: a forward roll. |
| Acrobatics on a grid | [Tomb Raider](https://www.wikiraider.com/index.php/TR_Classic_Controls) | Standing and running jumps, side and back somersaults, a handstand pulling up from a ledge, a swan dive, shimmy, a turning roll. About 60 hand-keyed moves. |
| Wall press, knock, crawl, alert | [Metal Gear Solid](https://en.wikipedia.org/wiki/Metal_Gear_Solid_(1998_video_game)) | Flatten against a wall and slide along it; knock to lure a guard; crawl under trucks; a red "!" over the guard's head. |
| Zombie turn, grab and bite, limp | [Resident Evil](https://residentevil.fandom.com/wiki/Turning_Around_Zombie) | The zombie slowly turns its head to the camera; lunges, grabs and bites; the hero holds her side when hurt and limps when near death. |
| Dash-strike | [Hades](https://hades.fandom.com/wiki/Gameplay_mechanics), [Bastion](https://mcvuk.com/business-news/behind-the-art-of-hades-we-value-artistic-integrity-and-excellence-in-artistic-craft-at-supergiant-however-were-first-and-foremost-a-game-design-lead-team/) | A short invulnerable dash; attacking out of it is a quick lunge. Both games are 3D models rendered to sprites, the closest cousins of this engine. |
| Charge, glide | [Spyro](https://spyro.fandom.com/wiki/Glide) | A head-down horn charge; wings spread in a glide. |
| Transformation | [Knight Lore](https://en.wikipedia.org/wiki/Knight_Lore) | At nightfall the hero jerks and twists and reforms as a werewolf. |
| Jump and carry in iso | [Landstalker](https://twentiethcenturygamer.wordpress.com/2018/06/01/landstalker-the-treasures-of-king-nole-genesis/), [Solstice](https://en.wikipedia.org/wiki/Solstice_(1990_video_game)) | Pick up, carry and drop objects; jumps are hard to judge without a shadow and a height cue. |
| Universal dodge | [Path of Exile 2](https://mobalytics.gg/poe-2/guides/dodge-roll-mechanic) | Every class shares one roll; the first half dodges, the second half is vulnerable. |

### 3.5 JRPG battles (brawler or side view)

| Animation | Game | What happens |
|---|---|---|
| Step in, strike, step back | [Final Fantasy IV-VI](https://www.ff6hacking.com/wiki/doku.php?id=ff3%3Aff3us%3Atutorial%3Asprites) | The active hero steps out of line, walks up, swings, and walks back. FF6 stores 17 animations and 46 poses per character. |
| Critical kneel, KO | [Final Fantasy VI](https://finalfantasy.fandom.com/wiki/HP_Critical) | Below 1/8 HP the hero kneels (and may unleash a desperation attack); KO lies flat. |
| Cast with an aura | [Final Fantasy IV-VI](https://guides.gamercorner.net/ffvi/spells/) | Step forward, raise the arms, a glow colored by the school of magic, then the effect on the target. A summon dims the screen. |
| Victory pose with the fanfare | [Final Fantasy VII](https://finalfantasy.fandom.com/wiki/Final_Fantasy_VII_victory_poses) | Cloud pumps his fist twice, twirls the sword and slings it on his back; each hero has their own. |
| Enemy death fade | [Final Fantasy](https://tropedia.fandom.com/wiki/Everything_Fades) | Enemies fade out in a purple haze; bosses get longer deaths. |
| Front-view feedback | [Dragon Quest](https://dragon-quest.org/wiki/Dragon_Quest) | Monsters only blink when hit; the screen shakes when the party is hit; the dead vanish. |
| Escape | [Final Fantasy](https://finalfantasy.fandom.com/wiki/Escape_(command)) | The party turns and runs off; in FF VI each member leaves at a different moment. |
| Jump off the screen | Final Fantasy IV (Kain) | The Dragoon leaps off the top of the screen and lands on the target a turn later. |
| Limit break, trance | [Final Fantasy VII](https://finalfantasy.fandom.com/wiki/Omnislash_(Final_Fantasy_VII)), [IX](https://finalfantasy.fandom.com/wiki/Trance_(Final_Fantasy_IX)) | Omnislash: a charge, 15 lunging hits, a leaping final strike. Trance: a glowing transformation. |
| Battle transitions | [FF X shatter](https://github.com/cognoscola/screen_break_effect), [EarthBound](https://en.wikipedia.org/wiki/EarthBound), FF VII-IX | The screen cracks into triangles that fly off; a swirl; a rotation. |
| Seamless battles | [Chrono Trigger](https://en.wikipedia.org/wiki/Chrono_Trigger), [Sea of Stars](https://blog.playstation.com/2022/07/07/a-closer-look-at-the-turn-based-combat-in-sea-of-stars/) | Fights start on the field map; heroes draw weapons and run into place; dual techs converge on one target. |
| Psychedelic backgrounds | [EarthBound](https://github.com/gjtorikian/Earthbound-Battle-Backgrounds-JS) | Two still layers moved by per-scanline wave offsets and palette cycling. |

### 3.6 Overhead: shoot-'em-ups, arcade, puzzle

| Animation | Game | What happens |
|---|---|---|
| Banking | [Raiden](https://shmups.wiki/library/Raiden) | Neutral, half and full tilt each way; at full tilt the hitbox narrows. |
| Loop the loop | [1942](https://www.hardcoregaming101.net/1942-2/) | The plane loops out of the plane of play: invincible, no firing, 3 per stage. |
| Trailing Options | [Gradius](https://www.raspberrypi.com/news/recreate-the-sprite-following-options-from-gradius-using-python-wireframe-issue-16/) | Orbs follow the ship's path (a position buffer, ~20f apart in one remake), copy its fire, and hold still when it stops. |
| Force pod, charge beam | [R-Type](https://shmups.wiki/library/R-Type) | An invincible pod docks front or back, launches and returns. Hold to fill a beam gauge, release a piercing beam. |
| Orbiting pods | [Thunder Force IV](https://en.wikipedia.org/wiki/Thunder_Force_IV) | Claws circle the ship and block some bullets. |
| Swoop-in paths, tractor beam | [Galaga](https://en.wikipedia.org/wiki/Galaga) | Foes fly in on curves, settle in a breathing formation, peel off to dive; the boss captures your ship with a beam. |
| The march | [Space Invaders](https://computerarcheology.com/Arcade/SpaceInvaders/Code.html) | One alien moves per update, so the formation ripples; it speeds up as they die. |
| Hyper, bullet cancel | [DoDonPachi DaiOuJou](https://shmups.wiki/library/DoDonPachi_DaiOuJou) | A full gauge cancels every bullet into score stars; activation brings brief invincibility. |
| Polarity swap | [Ikaruga](https://en.wikipedia.org/wiki/Ikaruga) | One button flips the ship black or white; same-color bullets are absorbed. |
| Tank that squashes | [Metal Slug](https://metalslug.fandom.com/wiki/SV-001_(Metal_Slug)) | A rigid tank crouches, jumps and squashes like an animal; it rams and explodes. |
| Boss death, respawn | [genre-wide](https://shmups.wiki/library/Help:Glossary) | Chain explosions, a white flash, shake, bullets turned into points, the stage-clear tally; the player flies back in from the bottom, blinking. |
| Line clear, chain pops, maze death | [Tetris](https://tetris.wiki/Tetris_(NES)), [Puyo Puyo](https://en.wikipedia.org/wiki/Puyo_Puyo), [Pac-Man](https://pacmancode.com/pacman-death) | Rows wipe from the centre out; groups flash and pop, and the pieces above fall into the next pop; Pac-Man shrinks away. |

## 4. What the research says

1. **About fifteen animations are in every genre.** Take-off and landing, a bored idle, get hurt with a hop and a blink, get knocked down and get up, pick up, carry and throw, hold an item up, open, a victory pose, a charge-up glow, a roll or dodge, a death that suits the cause, an alert "!", and a transition between screens. Every sweep produced its own copy of this list.
2. **The famous ones are transitions and reactions, not loops.** Walk and run cycles are rarely what people remember. The skid, the teeter, the ledge pull-up, the item get, the death spin, the piledriver and the victory pose are all short, multi-beat sequences between two states. That is the category my-3d2dge lacked, and the one ACTIONS fills (section 2).
3. **Timing is anticipation plus a held contact frame.** The ALttP sword holds step 5 of 9; the Castlevania whip hits on tick 17 of 22; Stardew's hoe holds its impact for 170 ms after two 40 ms smears; Diablo marks an "action frame" in every animation. my-3d2dge's `E.MOVES` worked this way (wind, active, `hitAt`, hold); my-3dge's moves and actions keep it.
4. **One death per cause is the modern standard.** Crash (fire, crush, drown, electricity), Diablo III (fire, cold, lightning, poison) and Metal Slug (by weapon) all do it. A small library of death styles that works on any rig or sprite makes a remake read as PS1 rather than NES.
5. **State shows on the body.** Madeline's hair shows dashes left; Resident Evil's heroes clutch their side, then limp; Final Fantasy's heroes kneel at critical HP; Mario pants at low health and shivers in snow. A rig input for condition (`hurtLevel`, `cold`, `tired`) gives every game this for free.
6. **Procedural rigs get reuse for free.** Prince of Persia plays its climb backwards to climb down, and Aladdin stretched its budget with holds, loops and flips. A rig does all of this without extra frames, and one move works in every facing. That is why the whole list below is affordable.
7. **Shadows and height cues matter off the side view.** Landstalker's jumps are notoriously hard to judge; Alundra's constant ground shadow is what makes three-quarter platforming readable. Any jump, hop or throw preset should draw its shadow at ground height.

## 5. What to predraw

Every entry names the famous references, the views and genres it serves, and the way the survey proposed to build it in my-3d2dge (section 2 maps its names to my-3dge's; section 7 says what the library already holds):
- **spec:** a new `E.MOVES` entry;
- **pose:** a held pose in the rig;
- **state:** a rig input driven by physics;
- **action:** a timed sequence of rig states in a new `E.ACTIONS` library;
- **layer:** joints post-processed after `rig.update`, as Emberdeep does;
- **prop:** an object drawn from the hand joints;
- **fx:** an effect preset;
- **rig:** a new rig.

Sizes, the survey's estimates for my-3d2dge: S is under a day, M a few days, L a week or more.

### Tier 1: staples every genre needs

| # | Animation | Famous references | Views, genres | Build | Size |
|---|---|---|---|---|---|
| 1 | **Jump phases**: take-off squat, rise, apex hang, fall with the legs reaching, landing squash (a heavy-landing variant) | SMB, Prince of Persia, Celeste, the Pokémon ledge-hop curve | all | state: read `vz` in the pose (the lab already does the squat and the landing) | S |
| 2 | **Get up**: lie → sit up → one knee → stand, with an invulnerability blink window; optional tech roll | Final Fight, Streets of Rage, SF wake-up, Secret of Mana | all | action (the lab has it) | S |
| 3 | **Hurt variants and knockback hop**: high, gut, low, from behind; stagger; a hop away with a blink | ALttP (hop, 19f locked, 58f blink), Castlevania, SF | all | pose variants of `hurt` + an actor blink helper | S |
| 4 | **Launched, tumbling, bouncing**: body angled by `vz` in the air, a ground bounce, a wall bounce, bodies bowling others over | Mortal Kombat, Guardian Heroes, SoR4, Emberdeep | brawler, side, iso | state `tumble` + the Emberdeep ballistic code | M |
| 5 | **Dizzy**: sway in place, stars, birds or angels orbiting the head | SF II, beat-'em-ups | brawler, side, adventure | pose + fx | S |
| 6 | **Death styles**: topple (✅), spin and collapse, pop up and fall off, a ring of orbs, fall apart into bones, fade or dissolve, blink out, burn to ash, freeze and shatter, electrocuted skeleton, crushed flat, shrink into a pit, sink, explode into pieces | Zelda, Mario, Mega Man, Castlevania, Final Fantasy, Crash, Diablo III, Metal Slug | all | fx that work from the actor's drawn silhouette, so rigs, Blobs and sprites all get them | M-L |
| 7 | **Flips and rolls**: forward roll, backflip, side hop, somersault jump, spin jump with an aura | Ocarina, Minish Cap, Hades, Contra, Super Metroid, SM64 | all | layer: promote Emberdeep's `heroRoll` into the rig as `flip: { u, axis, tuck }` | M |
| 8 | **Lift, carry, throw**: crouch and grip, hold overhead while walking, throw on an arc with a shadow | ALttP, Harvest Moon, SMB2, Klonoa, River City Ransom, Landstalker | all | pose `carry` + action `lift` + the `throw` move; a hold point between the hands | S-M |
| 9 | **Push, pull, strain** | ALttP (the pull heave), Tomb Raider, box puzzles | all ground views, side | poses | S |
| 10 | **Item get / present**: face the camera, both arms up, item overhead (one arm for thin things), about 2 s | Zelda (128f), Stardew, SM64 star, Mega Man weapon get | all | pose `present` + a hold point for the item sprite | S |
| 11 | **Interactions**: open a chest (and a kick-open for a big one), turn to talk, face up to read, pick up from the floor, pull a lever, press a switch, enter a door | Zelda, Ocarina, every RPG town | all | actions | S each |
| 12 | **Idle life**: escalating bored idles (look round → tap foot → sit → sleep with Zs), shiver, pant at low health, clutch the side, limp | Sonic, SM64, Resident Evil, Emberdeep | all | state: an idle timer and a `condition` input, plus the Emberdeep wound layer | M |
| 13 | **Emote bubbles**: ! ? … ♪ ♥, anger vein, sweat drop, Zz | Pokémon (60f "!"), Metal Gear Solid, Chrono Trigger | all | fx at `rig.head()` | S |
| 14 | **Charge-up**: weapon held back with sparkles or a pulsing color, a full-charge flash, then release into a move | ALttP (sparkles from 6f, ready at 48f), Mega Man buster, Secret of Mana, KOF, R-Type | all | a `charge: 0..1` pose modifier + an aura fx | S-M |

### Tier 2: traversal

| # | Animation | Famous references | Views, genres | Build | Size |
|---|---|---|---|---|---|
| 15 | **Ledge hang, shimmy, climb up** (played backwards to climb down) | Prince of Persia (14f, 17f), Flashback, SM64, Tomb Raider, Contra III monkey bars | side, iso | state `hang` + action `climbUp`; ledge detection in `Platformer` | M |
| 16 | **Wall slide and wall kick** | Mega Man X, Super Metroid, SM64, Celeste | side, iso | state `wall` passed by `Platformer.rigState()` (the physics exists) | S |
| 17 | **Swim**: surface paddle, breaststroke, flutter kick, tread water; drown | SM64, Zelda, Sonic | all | state `swim: 0..1` gait | M |
| 18 | **Skid turnaround and edge teeter** | Mario, Sonic | side, iso | state: automatic from a velocity reversal; an `edge` flag | S |
| 19 | **Slide, crawl, prone** | Mega Man, Contra, Metal Gear Solid, Illusion of Gaia | side, ground views | pose `prone` + a crawl gait | M |
| 20 | **Hover, glide, flutter**: legs pedal in the air, arms out | Yoshi's Island, Klonoa, Spyro, raccoon Mario | side, iso | state `hover` | S |
| 21 | **Ground pound, dive, long jump** | SM64, Crash, Banjo-Kazooie | side, iso | actions built on the flip layer | S-M |
| 22 | **Hop down a ledge** with the shadow on the ground | Pokémon, Link's Awakening, Alundra | three-quarter, top-down, iso | an easing curve for `Body` jumps | S |
| 23 | **Fall into a pit** (shrink and spin), climb stairs, enter a pipe or door | ALttP, Mario | all | actions + fx | S |

### Tier 3: combat signatures

| # | Animation | Famous references | Views, genres | Build | Size |
|---|---|---|---|---|---|
| 24 | **Specials as moves**: hadouken (palms), shoryuken (rising spinning uppercut), tatsumaki (spinning air kick), desperation spin, dash into uppercut, a flurry | SF II, Final Fight, SoR2, Chun-Li | brawler, side, any melee | spec: new `E.MOVES` entries, a spin allowed in the air | S each |
| 25 | **Grab, hold, pummel, throw, and the victim's side**: held, thrown, suplexed, piledriven, vaulted over | Final Fight, Double Dragon, SF II, TMNT, SoR2 | brawler, side | spec (grab, suplex, piledriver) + a victim state `held: { by }` pinned to the attacker's hand with IK | M-L |
| 26 | **Whip or chain weapon** | Castlevania (hits on tick 17 of 22), Earthworm Jim, hookshot | side, all | a new weapon `whip`: a strand like the hair, plus a crack move | M |
| 27 | **Bow and shield**: draw, aim and release; raise the shield, bash, block high and low | Zelda, Diablo rogue, Ocarina | all | new weapons + moves | M |
| 28 | **Block variants and parry**: crouch block, block spark, parry freeze with a flash | SF III, every fighter | side, brawler | pose `block: 'low'` + fx | S |
| 29 | **Tools and daily life**: hoe, axe, pickaxe, watering can, scythe, fishing (cast, reel, hold up the catch), eat, drink | Stardew, Harvest Moon, Emberdeep's drink | three-quarter, top-down | props + the existing moves, timed to Stardew's numbers | S-M |
| 30 | **Cast variants**: aimed thrust, both arms up for an area, a ground slam, a channelled loop, a summon | Diablo, Final Fantasy | all | spec + a looping pose | S |
| 31 | **Ceremonies**: sword twirl and sheathe, bow, salute, dance, arms crossed and turn away, laugh, level-up burst | FF VII, Metal Slug, Kirby, SF II, Emberdeep | all | poses and actions | S each |
| 32 | **JRPG battle actions**: step out when ready, run or leap to the target and back, item held up or thrown, revive, a Dragoon jump off the screen, an enemy blink and a purple fade | Final Fantasy IV-VII, Chrono Trigger | brawler, side | actions (the RPG slice has several) + fx | M |
| 33 | **Enemy personality**: notice (start + "!"), panic and flee, cower, taunt; entrances (rise from the ground, drop from above, burst through a door, dig out, a statue awakes, beam in) | Metal Slug, Metal Gear Solid, Diablo, Mega Man | all | actions + fx | M |

### Tier 4: rigs, vehicles and presentation

| # | Animation | Famous references | Views, genres | Build | Size |
|---|---|---|---|---|---|
| 34 | **Promote the Emberdeep creatures**: crawler, serpent, watcher | Diablo spiders, Zelda serpents, eye bosses | all | move the rigs from `src/emberdeep/33-beasts.js` into the engine | L |
| 35 | **A four-legged rig**: walk, trot, gallop, pounce, sit, lie down; mounts | Golden Axe mounts, Epona, Diablo wolves, Spyro | all | rig | L |
| 36 | **Riders and vehicles**: ride a mount; a tank that squashes; a car | Golden Axe, Metal Slug, GTA | all | rig + attach points | L |
| 37 | **A ship helper**: bank from sideways speed, thruster flicker, the 1942 loop, trailing and orbiting pods, a docking pod, swoop paths with a breathing formation, a tractor beam, flying back in with a blink, pickups that bob and cycle color | Raiden, 1942, Gradius, Thunder Force, R-Type, Galaga | overhead, side | helpers around sprites and `Bullets` (the shooter slice has the bank and path following) | M |
| 38 | **Transitions**: iris in and out, mosaic, swirl, spiral, stripes, shatter, triple flash | Zelda, Mario, Pokémon, EarthBound, FF X | all | `game.go(scene, data, { fx })` | M |
| 39 | **A path trail**: followers on the leader's path (party members, Options, serpent segments) | EarthBound, Gradius, Chrono Trigger | all | one shared position-history helper | S |
| 40 | **Wavy backgrounds**: per-row wave offsets and color cycling | EarthBound battles | JRPG, shmup | a backdrop effect | S |

## 6. Build order

By value (how many genres use it) over cost. ACTIONS' first set (PLAN.md WP 8.7) follows it, and the coverage map (section 7) shows which of these the library's clips already serve:

1. **`E.ACTIONS` and a player for it**, starting with the get-up (2), item get (10), lift and carry (8) and interactions (11). This is the missing layer; most of Tier 1 then becomes a few lines each.
2. **Jump phases** (1). Every game with a jump uses it, and the fix is small.
3. **Hurt variants, knockback hop, blink, dizzy** (3, 5).
4. **The flip layer** (7), promoted from Emberdeep; it unlocks rolls, backflips, somersault and spin jumps, the ground pound (21) and the Dragoon jump (32).
5. **Death styles** (6). The biggest visual jump from NES to PS1 for the least work per game.
6. **Emote bubbles and charge-up** (13, 14). Small, and every genre uses them.
7. **Fighting and beat-'em-up specials as `E.MOVES`** (24), then **grab and victim poses** (25).
8. **Ledge hang and wall slide** (15, 16). The physics is partly there already.
9. **Idle life** (12), promoting the Emberdeep wound layer.
10. **Transitions** (38) and the **path trail** (39).
11. **The ship helper** (37).
12. **New rigs** (34-36).

## 7. The coverage map

The survey never looked at clips. This map holds the ranked list of section 5 against the animation library (`docs/ANIMATION-LIBRARY.md`): the clips its catalogs describe (`data/anim/catalogs/`), the takes the CMU ledger marks `pick` (`data/anim/cmu/`), and how many of the ledger's takes fall in a category. Each clip is named as its catalog names it; a name in two sets (`Chest_Open`, `Roll`) is in both. Verdicts:
- **Covered:** clips serve the item on a humanoid, played in place with the clip layer (PLAN.md §10.4);
- **Partial:** clips serve part of it;
- **Missing:** no clip serves it;
- **Not a clip:** the item is engine work, an effect or presentation.

The last column says what fills each gap (PLAN.md §10.6).

| # | Item | In the library | Verdict | What fills the gap |
|---|---|---|---|---|
| 1 | Jump phases | `Jump_Start`, `Jump_Loop`, `Jump_Land`, `NinjaJump_Start`, `NinjaJump_Idle_Loop`, `NinjaJump_Land`, `Jump_2`, `Jump_2_RM`, `Run Jump`, `Land_Three_Point`; 177 `jump` takes | Covered | The clips jump in place, so the game supplies the arc; ACTIONS (WP 8.7) chains the phases |
| 2 | Get up | `LayToIdle`, `Get_Up_From_Back`, `Get_Up_Face_Down`, `Get_Up_From_Side`, `Zombie_Rise` | Covered | — |
| 3 | Hurt variants and knockback hop | `Hit_Chest`, `Hit_Head`, `Hit_Knockback`, `Hit_Knockback_RM`, `Idle_Shield_Break`, `Dodge_back` | Partial | Gut, low and from-behind hits: WP 6.2's directional flinch; the blink is game code |
| 4 | Launched, tumbling, bouncing | `Hit_Knockback`, `Death_B` | Partial | Physics owns the flight: the ragdoll hand-off (WP 10.2) |
| 5 | Dizzy | `Dizzy` | Covered | — (the orbiting stars are an effect) |
| 6 | Death styles | `Death01`, `Death_A`, `Death_B`, `Death_C`, `Death_D`, `Fall_On_Face` | Partial | The clips are body falls; the dissolves, shatters and burns are effects, not clips |
| 7 | Flips and rolls | `Roll`, `Roll_RM`, `Backflip`, `Dive_Roll`, `Cartwheel`, `Jump_Twist`, `Dodge_left`, `Dodge_right`, `Dodge_back`; picks `Cartwheels`, `Handstand_Kicks` | Covered | — |
| 8 | Lift, carry, throw | `PickUp_Table`, `Pick_Up_Box`, `Walk_Carry_Loop`, `Carry_Heavy_Box`, `OverhandThrow`, `Throw Object`; pick `Throw_Catch` | Covered | — (the load is a prop between the hands) |
| 9 | Push, pull, strain | `Push_Loop` | Partial | No pull: ACTIONS; the ledger's take 81_07 ("pull heavy object") is the nearest capture |
| 10 | Item get / present | none (`Cheering_Two_Hands` comes close) | Missing | ACTIONS (WP 8.7), with the item as a held prop |
| 11 | Interactions | `Chest_Open`, `Interact`, `Kick_Breach`, `Farm_Harvest`, `Search_Ground`, `Head Nod`, `Greeting`, `Idle_Rail_Call` | Covered | — |
| 12 | Idle life | `Idle_Subtle`, `Waiting_Loop`, `Looking_Around`, `Stretch_Yawn`, `Shivering`, `Idle Hurt`, `Tired Hunched`, `Kneeling Tired`, `Wounded_Walk_Loop`, `Hurt_Stomach_Walk_Loop`, `Sleeping`, `Meditate`; pick `Idle_Shift` | Covered | — (the escalating idle is an action that plays them) |
| 13 | Emote bubbles | — | Not a clip | An effect at the head |
| 14 | Charge-up | `Power Up`, `Spell_Simple_Enter`, `Spell_Simple_Idle_Loop` | Covered | — (the aura is an effect) |
| 15 | Ledge hang, shimmy, climb up | `Ledge Hang`, `ClimbUp_1m_RM`, `Climb Wall`, `Climb Ladder`, `Climb_Ladder`, `Ladder_Idle`, `Pipe Climb` | Partial | No shimmy: ACTIONS (WP 8.7) |
| 16 | Wall slide and wall kick | — | Missing | ACTIONS (WP 8.7), plus procedural moves |
| 17 | Swim | `Swim_Idle_Loop`, `Swim_Fwd_Loop`; picks `Breaststroke_Loop`, `Backstroke_Loop` | Covered | — |
| 18 | Skid turnaround and edge teeter | `Run_Quick_Stop`, `Turn_Left_90`, `Turn_Right_90`, `Turn_Left_180`, `Turn_Right_180` | Partial | No teeter: procedural moves |
| 19 | Slide, crawl, prone | `Slide_Start`, `Slide_Loop`, `Slide_Exit`, `Crawl`, `Crawl RM`, `Crouch_Fwd_Loop`, `Crouch_Walk_Loop` | Covered | — |
| 20 | Hover, glide, flutter | `Glide`, `Flying Forward`, `Flying Forward Super`, `Levitate Entrance`, `Levitate Idle`; pick `Superhero` | Covered | — |
| 21 | Ground pound, dive, long jump | `Attack_Ground_Pound`, `Dive_Roll`, `Run Jump` | Partial | No long jump: the flip layer in ACTIONS (WP 8.7) |
| 22 | Hop down a ledge | — | Not a clip | A jump arc with its shadow on the ground |
| 23 | Fall into a pit | pick `Stairs_Up` (climbing stairs) | Not a clip | Actions and effects (shrink and spin, enter a door) |
| 24 | Specials as moves | `Two-hand Blast`, `Jump_Kick`, `Punch_Combo`; pick `Spin_Jump_Kick` | Partial | The rest as attack moves; a move can play a clip and land its hit at the clip's strike time (WP 8.4) |
| 25 | Grab, hold, pummel, throw, and the victim's side | — | Missing | A paired grab in ACTIONS (WP 8.7). CMU subjects 18 to 23 are two-person takes, not yet explored |
| 26 | Whip or chain weapon | — | Missing | ACTIONS (WP 8.7), plus procedural moves and a chain (WP 6.2) |
| 27 | Bow and shield | `Bow`, `Bow Pull Back`, `Bow Pull Hold`, `Bow Release`, `Idle_Shield_Loop`, `Shield_OneShot`, `Idle_Shield_Break`, `Shield_Dash_RM` | Covered | — |
| 28 | Block variants and parry | `Sword_Block`, `Defend`, `Block_Combo` | Covered | — (the parry flash is an effect) |
| 29 | Tools and daily life | `Farm_Harvest`, `Farm_PlantSeed`, `Farm_Watering`, `TreeChopping_Loop`, `Chop_Wood`, `Dig`, `Rake_Leaves`, `Sweep_Loop`, `Wash_Window_Loop`, `Fishing`, `Fishing_Cast`, `Fishing_Reel`, `Fishing_Catch`, `Consume`, `Drink_Water`; picks `Hammer_Picture`, `Plant_Tree`, `Eat_Dinner`, `Chug_Beer` | Covered | — (the tools are props) |
| 30 | Cast variants | `Spell_Simple_Shoot`, `Two-hand Blast`, `Levitate Idle` | Covered | — (the spells are effects) |
| 31 | Ceremonies | `Salute`, `Greeting`, `Curtsey`, `Victory`, `Victory Fist Pump`, `Cheer_One_arm`, `Cheering_Two_Hands`, `Idle_FoldArms_Loop`, `Dance_Loop`, `Dance Body Roll`, `Dance Charleston`, `Dance Reach Hip`; picks `Salsa_Loop`, `Charleston`, `Chicken_Dance` | Covered | — |
| 32 | JRPG battle actions | — | Not a clip | Actions and effects, built from the clips above |
| 33 | Enemy personality | `Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop`, `Zombie_Scratch`, `Zombie Yell`, `Zombie_Rise`, `Confused`, `Duck_Thrown_Object`, `Gorilla_Walk_Loop`, `Frankenstein_Walk_Loop`; 167 `animal and character` takes | Partial | Notice, panic and flee as actions; the entrances as effects |
| 34 | Promote the Emberdeep creatures | — | Missing | Procedural building blocks and fixture rigs (WP 10.1) |
| 35 | A four-legged rig | — | Missing | Procedural building blocks and fixture rigs (WP 10.1) |
| 36 | Riders and vehicles | `Driving_Loop` (seated, hands on a wheel) | Partial | Later, when a game needs them |
| 37 | A ship helper | — | Not a clip | Game code around a craft |
| 38 | Transitions | — | Not a clip | Presentation |
| 39 | A path trail | — | Not a clip | A shared position-history helper |
| 40 | Wavy backgrounds | — | Not a clip | A backdrop effect |

**Net:**
- For **humanoids**, the library already serves most of Tiers 1 to 3: jump phases, get-ups, flips and rolls, lift and carry, interactions, idle life, swimming, crawling, sliding and gliding, bow and shield, blocks, tool work, ceremonies and dances. 100STYLE (WP 8.10) adds about 100 styles of walking, running and standing.
- **Missing:** item-get, wall slide, whip, grabs with a victim, creatures and four-legged rigs. Vehicles wait for a game.
- **The missing layer** (section 2) is what the engine builds *on top of* clips: ACTIONS sequences them, with held contact frames.

## 8. Timing references

Numbers from code or measured data, to seed the defaults of new animations. They are at 60 fps unless noted.

| What | Numbers | Source |
|---|---|---|
| Zelda item get | held 128f (~2.1 s), 16 px above the head | [Zelda 1 disassembly](https://github.com/aldonunez/zelda1-disassembly) |
| ALttP sword swing | 9 steps, delays 1,0,0,0,0,3,0,0,1 (~14f); step 5 is the contact | [zelda3 player.c](https://github.com/snesrev/zelda3/blob/master/src/player.c) |
| ALttP spin attack | sparkles from 6f, ready at 48f; release ~34f through 12 steps | same |
| ALttP lift | 6/7/7f; heavy strain loop 8,24,8,24,8,32 | same |
| ALttP pull | 5/5/12f, the long third pose is the heave | same |
| ALttP hurt | knockback speed 24, a hop (z speed 12), 19f without control, 58f blinking | [zelda3 sprite.c](https://github.com/snesrev/zelda3/blob/master/src/sprite.c) |
| ALttP pit fall | 6 shrink steps × 10f | [zelda3 player.c](https://github.com/snesrev/zelda3/blob/master/src/player.c) |
| ALttP death | 4 facings × 3 turns, ~6f each, then collapse | [zelda3 messaging.c](https://github.com/snesrev/zelda3/blob/master/src/messaging.c) |
| Pokémon ledge hop | 16-step height table $38,36,34,32,31,30,30,30,31,32,33,34,36,38,3C,3C | [pokered ledges.asm](https://github.com/pret/pokered/blob/master/engine/overworld/ledges.asm) |
| Pokémon "!" bubble | 60f | [pokered emotion_bubbles.asm](https://github.com/pret/pokered/blob/master/engine/overworld/emotion_bubbles.asm) |
| Pokémon battle flash | 3 flashes, 12 palette steps × 2f each | [pokered battle_transitions.asm](https://github.com/pret/pokered/blob/master/engine/battle/battle_transitions.asm) |
| Sonic 2 bored idle | 180f still, blink 6f, look 30f, taps every 18f, watch 60f, ×4, then lies down | [Sonic Physics Guide](https://info.sonicretro.org/SPG:Animations) |
| Sonic run rate | frame time `max(0, 8 − speed)`; whirl at speed 6 | same |
| Castlevania whip | 22 ticks, hits on tick 17; knockback 14 px up, ~100f flicker | [TASVideos](https://tasvideos.org/GameResources/NES/Castlevania) |
| Prince of Persia | run 6 + 8 loop, turn 8, standing jump 18, running jump 11, to hang 14, climb up 17 (down = reversed), drink 15, death 6 frames | [PoP source, SEQTABLE.S](https://github.com/jmechner/Prince-of-Persia-Apple-II) |
| SM64 ground pound | rises 20,18,…,2 units over 10 frames, hangs 4 frames past the flip, drops at −50 | [sm64 decomp](https://github.com/n64decomp/sm64/blob/master/src/game/mario_actions_airborne.c) |
| SM64 jumps | long jump ×1.5 forward speed (cap 48), up 30; triple jump up 69; backflip up 62, back 16 | [Ukikipedia](https://ukikipedia.net/wiki/Long_Jump) |
| SF III parry | ground window 10f (6 if held), air 7f; attacker frozen 20f on a parried jab | [3S-o-S](https://3sos-blog.tumblr.com/post/7840889745/parry-frame-data) |
| Celeste dash | 15f with a 3-frame freeze at the start | [Celeste wiki](https://celeste.ink/wiki/Dashing) |
| Stardew heavy tool | 150/40/40/170/75 ms; watering can 75/100/500 ms; walk 4 × 200 ms | [Stardew modding wiki](https://stardewvalleywiki.com/Modding:Farmer_sprite) |
| Diablo (animation frames) | warrior sword 16 (hits on 9), rogue bow 12 (on 7), sorcerer cast 12 (on 8); death 20; hit recovery 6-8 | [DevilutionX tables](https://github.com/diasurgical/devilutionX/tree/master/assets/txtdata/classes) |
| Diablo II (frames at 25 fps) | cast 13-19 by class; get-hit 9-15; block 5-11 | [Maxroll](https://maxroll.gg/d2/resources/breakpoints-animations) |
| KOF '94 dodge | 39 invulnerable frames | [Dream Cancel wiki](https://dreamcancel.com/wiki/The_King_of_Fighters_'94/System_Mechanics) |
| DoDonPachi DaiOuJou hyper | 80f invulnerable in stages, 120f at bosses | [shmups.wiki](https://shmups.wiki/library/DoDonPachi_DaiOuJou) |

## 9. Keeping it model-friendly

The survey's advice, in my-3dge's terms:
- **One documented name per family, not per animation.** Game agents read `docs/API.md`, which is generated from the doc comments, so a family is one export whose comment lists its names (as my-3d2dge's card listed `E.ACTIONS: getup itemget lift carry throw open talk read pickup lever door`), with one example call.
- **Agents search the library; they never read it whole.** `x anim find <words>` searches the catalogs, then the ledger, and `x anim show <set>/<clip>` prints one clip (PLAN.md §10.3; the tools arrive with WP 8.5).
- **Everything plays in the box.** Clip mode (WP 8.9) plays any clip on the mannequin and the hero, headless and in the page, so each new animation runs on every build without a screen.
- **Check each one with numbers, then with a contact sheet.** The `anim` QA family (WP 8.6) checks every clip and action; a contact sheet (`x anim sheet`) shows the anticipation, the committed action, the held contact and a clean return when a metric points at a clip.
