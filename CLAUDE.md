# COLOSSUS - project guide

Fourth game in the `Opu5.5 Game Prompt` master folder (one-shot build from the shared game meta-prompt).
This folder is its own git repo and private GitHub repo (`Samizdat-Publications/colossus`).
Other games live in sibling folders and are built by other sessions: never touch files outside `colossus/`.
Writing rule for every file here: no em dashes (use commas, colons, periods or a spaced hyphen).

## Pitch

**COLOSSUS** is a third-person boss fight. A lone warrior walks into a drowned, ruined arena at night.
Rain hammers the flagstones, lightning cracks over the broken arches, and in the middle of the arena
the rubble begins to move: it rises, rock by rock, into OSTRAKON, THE LIVING RUIN, a stone golem more
than eight times your height. One fight, three phases. Souls-like but fair: every attack has a clear
wind-up, and the golem can only be hurt in one place.

- **The loop:** stone deflects your blade. Only the glowing cores can be hurt: one on each forearm,
  one low on its back. The fists come down to the ground after slams and sweeps, which is your
  window to hit the arm cores. Enough core damage fills the BREAK meter and the golem collapses to its
  knees: for a few seconds every hit counts, and the back core takes critical damage.
- **Phase 1 (100-66%):** ground slam (cracks the floor, leaves burning hazards), sweep, stomp
  shockwave (roll or jump through the ring), rock throw at range.
- **Phase 2 (66-33%):** cracks split its body and glow orange. Adds a two-fisted slam that sends a
  fissure racing toward you, a three-rock volley and a two-arm sweep combo. Faster.
- **Phase 3 (33-0%):** its chest bursts open on a molten core, lava light floods the arena. Adds a
  leaping slam, a double stomp and a meteor rain of rubble. Hazards last longer.
- **Win:** bring its health to zero; it crumbles back into rubble. **Lose:** your health reaches zero.
  Retry restarts the fight at once (short re-assembly instead of the full intro).

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Camera | Mouse (click the game to capture it) | Right stick |
| Light attack (3-hit combo) | Left click | RB / R1 |
| Heavy attack (hold to charge) | Right click | RT / R2 |
| Block (hold) | Shift | LB / L1 |
| Dodge roll (i-frames) | Space | B / Circle |
| Jump | F | A / Cross |
| Lock on / off | Q, middle click or Tab | R3 |
| Drink flask (heal) | R | X / Square |
| Pause | Esc or P | Start |

Ctrl is deliberately unused (Ctrl+W closes the browser tab). Every action is input-buffered for
`player.inputBuffer` seconds, so a press during another action fires as soon as it can.

## Tech

- Vite + TypeScript + Three.js (WebGL2, PCF soft shadows, bloom, custom grade pass).
- DOM/CSS overlay for all UI. Fonts: Cinzel (display) and EB Garamond (text), SIL Open Font
  License, bundled from npm `@fontsource/*` (no runtime network fetch).
- Audio: 100% Web Audio synthesis (no audio files), including the music.
- Assets: `blender_scripts/*.py` (one script per asset family) build every model and bake every
  texture, exporting `.glb` and `.png` to `public/assets/`. Shared helpers in `co_common.py`.
- `public/balance.json`: every damage, health and timing value. Fetched at startup, merged over
  the code defaults, so it can be edited without touching code (reload the page).
- Rigs: golem and warrior are bone-parented segmented rigs. At load time the game converts each
  armature into pivots with identity rest rotation (world-aligned axes) and drives them with a
  pose system (`src/anim`), so every animation stretches to the timings in `balance.json`.

### Commands

- `npm install`, `npm run dev` (http://127.0.0.1:5419), `npm run build`, `npm run preview` (4419)
- `npm run playtest -- --scenario smoke|win|lose|tour [--out dir]` headless Playwright self-test
  (real keyboard and mouse input for menus and controls, in-page bot for long fights). Screenshots,
  console log and report land in `test-output/`.
- `npm run balance -- --bot decent --runs 20` runs bot attempts at high time scale to check tuning.
- `npm run assets` regenerates every asset through Blender in background mode (needs Blender 5.x at
  the default path or `BLENDER_PATH`).

### Running the Blender scripts through the MCP

The GUI Blender behind the MCP is shared with other sessions, so never build in its open scene.
From the MCP, spawn an isolated background Blender on a family script:

```python
import sys; sys.path.insert(0, r"<repo>/blender_scripts")
import co_launch; result = co_launch.launch("golem.py")
```

`launch` uses `Popen` and returns at once (a blocking call would hold the shared Blender's main
thread). Logs go to `test-output/blender-logs/<script>.log`; previews to `test-output/asset-previews/`.

### Test hooks

`?test=1` exposes `window.__CO` (state snapshot, time scale, bot control). `?god=1` makes the player
invulnerable, `?skipintro=1` skips the intro, `?phase=2|3` starts in a later phase, `?bot=decent|expert`
lets the in-page bot play, `?nosound=1`, `?fps=1` shows a frame-time overlay, `?greybox=1` uses the
primitive greybox models instead of the Blender assets. Hooks for tests: `forcePhase(n)` always plays a
phase-change roar, `killGolem()` starts the victory, `forceAttack(name, side)`.

## Milestones (in order, do not skip ahead)

1. [x] **Greybox**: core loop with primitive shapes. Player controller (move, lock-on, light and heavy
   attacks, roll with i-frames, block, jump, flask, stamina, input buffer), golem with all attacks for
   3 phases, weak points, break and stagger, hazards, win and lose states.
2. [x] **Assets**: model everything in Blender via the MCP (golem, warrior, arena, pillars, rubble),
   bake procedural textures, export GLB, swap into the game.
3. [ ] **Feel**: animation, camera, particles, screen shake, hit stop and feedback, rain, lightning,
   dust and debris, synthesized sound and music.
4. [ ] **UI**: title, HUD, pause menu, death and victory screens. Consistent font, palette and spacing.
5. [ ] **Polish and perf**: steady 60 fps on a mid-range laptop, zero console errors, final balance,
   README, 6 final screenshots.

Self-test loop after every milestone: Playwright plays via scripted input, captures player-camera
screenshots and console output; a critic subagent that sees ONLY the screenshots and this pitch lists
the 5 worst problems; fix; repeat until the worst remaining issue is cosmetic. Critic reports are
saved in `docs/critic/`.

Done means: a first-time player can start, understand the controls, play, and reach both a win and a
lose screen with no bugs; README.md with controls and how to run; `screenshots/` with 6 final shots.

Milestone 1 closed after 16 critic rounds (see `docs/critic/m1-r16.md`): the worst remaining item was
close-range framing of the giant, which moved into milestone 3's camera work.

Milestone 2 closed after 16 critic rounds (see `docs/critic/m2-r16.md`): rounds 12 to 16 were MINOR at worst. The
recurring items (the golem reads as a heap at melee range, phase lighting, effects) move to milestones 3 and 4.
Balance at the close: the decent bot wins about 3 attempts in 10.

## Asset list

| Family script | Output | Contents |
| --- | --- | --- |
| `textures.py` | `tex_*.jpg/png` | Tileable baked textures (4D noise on a torus, Cycles bakes, numpy compositing): rock and dressed stone (albedo, normal, roughness), crack vein mask, metal (normal, roughness), cloth normal |
| `golem.py` | `golem.glb` | Armature (19 bones) with about 126 bone-parented pieces: dressed blocks, fluted column drums (upper arms and thighs), boulders, rubble filler; core crystals `core_arm_L/R`, `core_back`, `core_chest`; ember eye sockets `eye_L/R`; `chestplate_0..2` (burst off in phase 3); AO baked into vertex colours |
| `warrior.py` | `warrior.glb` | Armature (19 bones) with one merged armour object per bone (broad pauldrons, heavy plate), `sword` (grip origin, 1.27 m), `flask`, `cape` (a pleated 9 x 13 grid for the cloth pass) |
| `arena.py` | `arena.glb` | `floor_stones` (1590 flagstones in 20 rings, some missing or sunk), `floor_water`, `seal_stones` + `seal_runes`, `arcade` (24 bays, 6 collapsed), `wall_rubble`, `tiers`, `cliffs` |
| `pillars.py` | `pillars.glb` | `pillar_intact`, `pillar_broken_tall`, `pillar_broken_mid`, `pillar_stump`, `pillar_fallen`, `capital_fragment`, `brazier` |
| `rubble.py` | `rubble.glb` | `rock_throw`, `meteor` (unit radius), `debris_0..5`, `rubble_pile_a/b/c` (unit footprint), `golem_mound` |

All GLBs are Draco-compressed (about 2.1 MB together); the decoder is served from the three package by
a Vite plugin (`/draco/`). Each family script writes a preview render to `test-output/asset-previews/`
and a report (triangles, sizes) to `test-output/blender-logs/<family>.json`.

### Asset conventions

- Units are metres. Blender Z-up is exported as glTF Y-up. Characters face Blender -Y, which becomes
  three.js +Z. A character's left is +X in both.
- Rig joint positions come from `src/data/golem_rig.json` and `src/data/warrior_rig.json`, read by
  both the Blender scripts and the greybox, so greybox and final model share one skeleton.
- Bone names: `hips spine chest neck head shoulder_L upperarm_L forearm_L hand_L thigh_L shin_L
  foot_L` (and `_R`). Core meshes are named `core_arm_L`, `core_arm_R`, `core_back`, `core_chest`.
- Props are top-level objects named as the game looks them up, origin at ground contact.

## Palette (UI + art direction)

| Token | Hex | Use |
| --- | --- | --- |
| ink | `#0d0e12` | backgrounds, text on light |
| slate | `#23262e` | panels |
| rain | `#6f86a8` | UI lines, cold light |
| bone | `#e6dfcf` | primary text |
| ash | `#9a9486` | secondary text |
| ember | `#ff7a2a` | cores, accents, break meter |
| gold | `#e0b25a` | victory, highlights |
| blood | `#a3262c` | player health, death screen |
| moss | `#79a05a` | stamina |

## DECISIONS log

Newest at the bottom. Record every non-obvious choice.

- 2026-09-24: Repo lives at `colossus/` directly under the master folder (the user asked for a subfolder
  like the other games). Own git history, private GitHub repo.
- 2026-09-24: Controls follow the common PC action layout (LMB light, RMB heavy, Space roll) with block on
  Shift. Roll fires on press (not on release like Souls games) for responsiveness, so sprint is dropped:
  the run speed is tuned for the arena instead. Jump (F) exists so the stomp ring can be jumped as well
  as rolled through.
- 2026-09-24: Damage model: only cores take damage outside a stagger. Core hits fill a BREAK meter;
  full meter = stagger (collapse to knees, every hit counts at 50%, back core x2.4). The back core sits
  low on the spine so it is only reachable when the golem kneels. Stone hits give a loud, distinct
  deflect (grey sparks, recoil, "no effect" text) so the rule is learned by attempt 1.
- 2026-09-24: Golem attacks are pose sequences whose segment durations come from balance.json, with
  2-bone IK so slam fists land exactly on the telegraphed target. Animation is procedural in code
  (poses as data) rather than baked actions, so timing tweaks never desync animation and hitboxes.
- 2026-09-24: Ground telegraphs (faint glowing rings) mark slam, rock and meteor landing points in
  the last part of each wind-up. Fairness over purity.
- 2026-09-24: Flasks (3 charges, R) added although not required: a three-phase fight with no healing
  is too swingy for the 3 to 6 attempt target.
- 2026-09-24: Dev server pinned to port 5419 so tests never hit a sibling game's Vite server.
- 2026-09-24 (M1): `public/balance.json` is fetched at runtime and also inlined as fallback defaults
  through a tiny Vite plugin (`virtual:balance-defaults`); Vite refuses direct imports from public/.
- 2026-09-24 (M1): In-page bot (`src/debug/bot.ts`, skills expert/decent/novice/idle) drives the same
  virtual input a player uses; Playwright runs it at 2-4x time scale for win/balance runs and uses real
  keyboard/mouse events for the controls smoke test.
- 2026-09-24 (M1 bot): the slam's burning hazard sat exactly where the punish window is, so doing the
  right thing burned you. Hazards now have an arm delay: the cracks glow dim while the fist is stuck and
  only burn once it is pulled out.
- 2026-09-24 (M1 bot): fissure eruptions started inside the slam radius with no warning. The fissure
  line now glows red for 0.55 s first and erupts from just outside the slam radius.
- 2026-09-24 (M1 bot): only one stagger in a 13-minute expert run. Break decay slowed (12 s delay,
  1.2/s) and break per hit raised (12/12/16 light, 24/36 heavy). Stomps and the meteor rain now end in a
  braced pose with both fists planted (a punish window), so every phase keeps readable openings.
- 2026-09-24 (M1 critic r1): colour language fixed: cores are cyan (the only cyan in the game), incoming
  impacts are red rings with a filling disc, burning ground is an orange crack pattern, the stomp
  shockwave is a pale ring band. The lock-on reticle marks the best core, not the torso.
- 2026-09-24 (M1): a NaN from `pow()` of a negative number in one shader blacked out the whole frame via
  bloom. Added a sanitize pass before bloom (NaN/Inf to black, clamp to 48).
- 2026-09-24 (M1 critic r2): moon placed behind the golem (rim light plus a Fresnel rim in the golem
  shader, shadow falls toward the player), sky dome with clouds. Camera pulled back to 7.8 m and rises
  over the golem instead of pushing in. Arm cores moved from mid-forearm to the wrist (head height in
  every punish window), fists clamped above the floor by IK. Boss bar moved to the bottom (Souls layout).
- 2026-09-24 (M1 critic r3-r6): the lock-on camera is a framing solve (`src/render/cameraRig.ts`): each
  frame it picks pitch and FOV so the warrior's feet and the near edges of warning rings stay above the
  boss panel (hard constraint) and the golem's highest point stays in frame (soft); it pulls back at most
  3 m (plus director "wide" requests: leap 4 m, stagger 2 m, victory 3 m). It never moves into the golem;
  golem parts that crowd the lens fade as whole parts (`PartFader`), because a dither pattern read as
  "dotted see-through mesh". Earlier "rise over the golem" and 10 m pull-backs made the warrior a speck.
- 2026-09-24 (M1 critic r4-r5): every melee attack now has a ground telegraph (sweep = red arc sector,
  stomp = ring around the lifted foot, stagger rise = push ring). Tips sit in a one-line strip at the top
  (the camera keeps that strip clear of golem) and hush while a warning covers the warrior.
- 2026-09-24 (M1 critic r5-r6): the phase 3 molten heart is a real weak point, but only while the golem is
  down: it glows lava-orange while out of reach and turns cyan (with the STRIKE tag) when it can be hit,
  so "cyan = hit here" never lies.
- 2026-09-24 (M1 bot): with the fixes above the decent bot wins about 1 run in 4 (fight about 4 minutes)
  and the expert bot wins in under 5 minutes with little health to spare: in the target band.
- 2026-09-25 (M1 critic r9-r16): the lock-on framing solve got director inputs: `topParts` (only the torso
  counts for the top of the frame in the meteor rain and the leap), `topBoost` (the leap's apex is framed
  before the jump), `snappy` (faster pitch and FOV in fast moves), `maxPull`, `rise` (a low camera looks up
  at the airborne golem). The meteor rain opens with a roar that shoves the warrior 11 m back, so golem
  and rings fit one frame.
- 2026-09-25 (M1 critic r12-r15): STRIKE appears only when a reachable core is in an open window with no
  warning, sweep, fissure or shockwave on the way; burning ground is amber, shockwaves pale red, incoming
  hits red, cores cyan; burning cracks show fire creeping outward for the last second before they burn.
- 2026-09-25 (M1 critic r15): fairness bug: the golem kept turning after the sweep sector was drawn. It
  now commits its facing when the sector appears, and the sweep can only hit inside the drawn sector.
- 2026-09-25 (M1 close): milestone 1 closed after 16 rounds with close-range framing of the giant as the
  recurring MAJOR (the rings always carried the gameplay). Camera work belongs to milestone 3.
- 2026-09-25 (M2): Blender runs in background processes launched from the MCP-connected GUI (`co_launch.py`,
  chains via `co_chain.py`), never in the shared scene. Every script builds in three.js space and
  converts with one rotation, so the JSON rig and layout data drive Blender and the game alike.
- 2026-09-25 (M2): textures tile seamlessly by evaluating Blender's 4D noise and Voronoi on a 4D torus
  made from the UV square; layers are Cycles emission bakes combined with numpy in Blender.
- 2026-09-25 (M2): the golem is 120 separate bone-parented pieces (not one skinned mesh) so the intro can
  fly each one in from the rubble, the camera fade can dim whole pieces and the chest plates can burst off.
  `Rig.fromObject` turns the glTF armature into the same pivot rig the greybox used.
- 2026-09-25 (M2): all GLBs are Draco-compressed (arena 17 MB to 1 MB); flagstones bevel only their top
  edges; spandrel blocks have no bevel. A moonlit PMREM environment gives steel, wet stone and water
  something to reflect.
- 2026-09-25 (M2): the warrior's accent colour is ivory, not red: red is reserved for danger, amber for
  fire, cyan for cores.
- 2026-09-25 (M2 critic r5): the warrior has its own light (`heroLight.ts`): a camera-side fill and a cool
  rim patched into the warrior's materials only, stronger the further the camera is. The moon sits behind
  the golem, so without it the warrior showed the camera its unlit side and vanished on wet stone.
- 2026-09-25 (M2 critic r5): the lock-on camera trades some golem for a bigger warrior: FOV cap 72, automatic
  pull-back 3 m (5 in the leap), smaller director widening. Critic shots log the warrior's on-screen height.
- 2026-09-25 (M2 critic r5): phase changes cut to a short cinematic of the roaring golem (the roar is
  harmless, so taking the camera for 3 s is safe); death gets a low camera over the fallen warrior.
- 2026-09-25 (M2 critic r5): phase 3 "lava light" is molten red light in the flooded flagstone joints (deep
  red, dimmer than the amber of burning ground so the colour language holds), a dark sky with a red
  horizon and black ridges, instead of an overall warm tint that read as a brown haze.
- 2026-09-25 (perf): lights are never parented to meshes whose visibility changes. A hidden parent drops its
  light from the scene, the light count changes and three.js recompiles every shader (1-2 s freezes). A
  warm-up pass compiles and renders the whole scene once behind the loading screen.
- 2026-09-25 (perf): adaptive quality governor: after 2.5 s above 19.5 ms per frame it steps render scale
  1.5 / 1.0 / 0.85 (with 1024 shadows) / 0.7; after 12 s under 13.5 ms it steps back up. `?quality=` pins it.
- 2026-09-25 (M2 critic r7): line of sight is judged against the golem's bone capsules (segment-to-segment
  distance from the camera to the warrior's chest and feet); any bone that cuts it fades as a whole part.
- 2026-09-25 (M2 critic r7): point lights are pooled and never change in number: one cyan light follows the core
  that matters most, two fire lights follow the burning patches nearest the warrior.
- 2026-09-25 (M2 critic r8-r9): the flooded joints no longer glow (any glow in the ring-shaped joints read as
  rings or burning tiles); burning ground carries a pool of flame billboards; the night is darker.
- 2026-09-25 (M2 critic r10): the lock-on camera sits over the right shoulder (0.75 m, 1.7 m while the golem
  kneels) so the warrior never hides what it fights; the open back core's halo draws through geometry.
- 2026-09-25 (M2 critic r11-r12): phase 3 reads from the golem: a big white-hot heart in the burst chest with a
  glow sprite, calmer veins, and a soft molten pool on the floor around its feet (a strong floor light painted
  the whole golem salmon). The leap and the meteor call keep extra sky above the golem (director top margin).
- 2026-09-25 (M2 critic r12): the death camera keeps one clock and one viewpoint across dying and the FALLEN
  screen, picks the clearest of 16 directions around the body, re-picks (gliding) if a limb swings into the
  view, and frames the body in an outer third clear of the screen's text.
