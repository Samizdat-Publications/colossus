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
lets the in-page bot play, `?nosound=1`, `?fps=1` shows a frame-time overlay.

## Milestones (in order, do not skip ahead)

1. [ ] **Greybox**: core loop with primitive shapes. Player controller (move, lock-on, light and heavy
   attacks, roll with i-frames, block, jump, flask, stamina, input buffer), golem with all attacks for
   3 phases, weak points, break and stagger, hazards, win and lose states.
2. [ ] **Assets**: model everything in Blender via the MCP (golem, warrior, arena, pillars, rubble),
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

## Asset list

| Family script | Output | Contents |
| --- | --- | --- |
| `textures.py` | `tex_*.png` | Tileable baked textures: golem rock (albedo, normal, roughness), crack mask, flagstones, wall ashlar, cloth, metal wear |
| `golem.py` | `golem.glb` | Armature (19 bones) with bone-parented rock chunks, 3 core crystals (forearms, lower back), chest core, eyes, chest plates that break off in phase 3 |
| `warrior.py` | `warrior.glb` | Armature (18 bones) with bone-parented armor plates, helmet, longsword, flask, cape mesh (cloth-simulated in game) |
| `arena.py` | `arena.glb` | Flagstone floor disc, central rune seal, ring wall with arches (partly collapsed), entrance gate, outer tiers, cliff ring, braziers |
| `pillars.py` | `pillars.glb` | Intact column, 3 broken columns, fallen column, capital fragments |
| `rubble.py` | `rubble.glb` | Boulders for throws and meteors, 6 debris chunks for particles, rubble piles, the dormant golem mound |

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
