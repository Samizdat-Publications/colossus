# COLOSSUS: session handoff

Written 2026-09-25 at the end of a long build session, to continue in a new one. Read this, then `CLAUDE.md`
(project guide, milestones, DECISIONS log) and `README.md`.

## Where things are

- Folder: `C:\Users\stewa\ClaudeProjects\Opu5.5 Game Prompt\colossus` (its own git repo, branch `main`).
- Remote: private GitHub repo `Samizdat-Publications/colossus`. Everything up to this handoff is committed and pushed.
- The master folder holds other games built by other sessions: never write outside `colossus/`.

## The task (from the user's original prompt)

Build a complete, polished, playable browser game from one prompt, making every decision yourself: COLOSSUS, a
third-person Souls-like boss fight against a stone golem in a drowned, rainy arena (full pitch in `CLAUDE.md`).

Hard rules:
- Vite + TypeScript + Three.js; `npm install`, `npm run dev` and `npm run build` must work.
- Every model comes from Blender via the Blender MCP, using Python scripts in `blender_scripts/` (one per asset
  family), exported as `.glb` to `public/assets/`. Nothing is downloaded; textures are procedural; all sound and
  music are Web Audio synthesis.
- Keep `CLAUDE.md` updated (pitch, controls, milestones, asset list, DECISIONS log).
- Milestones, in order: 1 greybox, 2 assets, 3 feel, 4 UI, 5 polish and perf (60 fps on a mid-range laptop, zero
  console errors).
- After every milestone, run the self-test loop: a Playwright run with scripted input and player-camera
  screenshots, then a separate critic subagent that sees only the screenshots and the pitch and lists the 5 worst
  problems. Fix, and repeat until the critic's worst remaining issue is cosmetic.
- Done means: a first-time player can start, understand the controls, play, and reach both the win and the lose
  screen with no bugs; `README.md` has controls and how to run; `screenshots/` holds 6 final player-view shots.

Standing user rules: never use em dashes anywhere (code, docs, commits, chat); commit at milestones and push to
the GitHub repo without asking; commit messages end with the `Co-Authored-By` line from the session's
attribution reminder.

## Milestone status

1. **Greybox: closed** after 16 critic rounds (`docs/critic/m1-r16.md`).
2. **Assets: closed** after 16 critic rounds (`docs/critic/m2-r16.md`). Rounds 12 to 16 were MINOR at worst.
3. **Feel: in progress.** Seven critic rounds so far (`docs/critic/m3-r1.md` to `m3-r7.md`). Round 7's worst was
   MAJOR (core-hit contact, the deflect at the shin, the roll). The round 7 fixes are in and committed, except
   the roll (below). A round 8 capture exists in `test-output/m3-critic-r8/`, but recapture after the roll fix.
4. **UI: built, loop not started.** Title, How to fight, Settings (remembered in localStorage), pause, death and
   victory screens with stats, HUD, tips and a controls card all exist. The `uicritic` capture scenario is ready.
5. **Polish and perf: partly done.**
   - Done: adaptive quality governor; shader warm-up behind the loading screen (including the transparent
     variants of the fading golem materials); `README.md` mostly up to date.
   - Perf: 60 fps on this machine, p95 about 19 ms.
   - Balance: player 110 HP, golem 1750 HP. The decent bot wins about 3 attempts in 10, which is the target band.
   - Not done: the 6 final screenshots, and ticking the milestones in `CLAUDE.md`.

Latest checks, all passing with zero console errors: `smoke`, `lose`, `win`, `npm run build`.

## Next steps, in order

1. **Fix the dodge roll animation** (`src/game/player.ts`, `startRoll`). Its single procedural step uses
   `ease: 'linear'`. The `Sequence` blends from the pre-roll pose toward the pose function's output with weight
   `t`, so:
   - the somersault is only partly shown;
   - past 180 degrees the quaternion blend would take the short way, backwards.

   `Step.blendIn` (added in `src/anim/pose.ts`) fixes the blending: use `blendIn: 0.05` and the pose follows the
   function exactly after 50 ms. But with the full rotation the body sinks into the floor mid-roll, because the
   pivot is only 0.55 m up and the pose also lowers by 0.42.

   Rotate about the tucked body's centre instead: `pos = (0, c - c*cos(a) + lift, -c*sin(a))` with `c` about
   0.55 to 0.65, and less lowering. Verify with a probe that samples the lowest bone's world `y` through the roll
   and keeps it at or above 0, and check a screenshot. An angle curve that starts at once was also tried (for
   example `a = r^0.8 * 2*pi` with `r = t / 0.85`): the body pitches forward immediately and keeps rolling
   through the whole move.
2. **Recapture and continue the milestone 3 loop.** Run
   `node scripts/playtest.mjs --scenario feelcritic --out test-output/m3-critic-r8`, then send the frames to a
   feel critic (prompt template below). Write `docs/critic/m3-r8.md` with the report and the fixes, and repeat.
   Milestones 1 and 2 were closed once several rounds in a row came back MINOR at worst. The recurring "the golem
   reads as a heap at melee range" is by design (a 15 m ruin at arm's length) and is covered by the floor
   telegraphs.
3. **Run the milestone 4 (UI) loop** with `--scenario uicritic`: loading, title, How to fight, settings, fight
   HUD, core hit HUD, low health, pause, victory and death screens.
4. **Finish milestone 5.**
   - `npm run balance -- --runs 10`: keep the decent bot at about 2 to 4 wins in 10.
   - A perf check.
   - The final screenshots:
     `node scripts/playtest.mjs --scenario final --width 1920 --height 1080 --out screenshots`. This writes 6
     shots (strike the core, shockwave, on its knees, fissure, meteor rain, the leap); delete the `report.json`
     it leaves.
   - A last `README.md` pass, the milestones ticked and the DECISIONS log finished in `CLAUDE.md`, then the final
     commit and push.

## Critic loop mechanics

- The critic is a `general-purpose` background subagent, told to open only the listed PNGs with Read, never code
  or docs.
- Give it the pitch, a short note on how the frames were captured (for example, "some beats are forced by the
  test script", or "bursts a, b, c are 0.1 to 0.7 s apart"), the folder, the file list, and the milestone lens.
- Ask for:
  1. One or two sentences on what works.
  2. The 5 worst problems, ranked, each with a title, severity (BLOCKER, MAJOR, MINOR, COSMETIC), the
     screenshots, and a concrete description.
  3. A final line: `Worst remaining issue severity: <...>`.
- Tell it not to use em dashes.
- Captures:
  - `--scenario critic`: 19 beats; its log records the warrior's on-screen size, state, time in state and camera.
  - `--scenario feelcritic`: bursts around hits, impacts and weather, with the simulation frozen per frame.
  - `--scenario uicritic`.
- Captures are scripted beats, so check that each frame shows what it claims. Several past "MAJOR" findings were
  capture timing artifacts; the shot log helps.

## Commands and hooks

- Tests: `npm run playtest -- --scenario smoke|lose|win|perf|critic|feelcritic|uicritic|final|tour|bot`, and
  `npm run balance -- --runs N`. Outputs go to `test-output/`.
- Test dev servers use random ports 5630 to 5689 with HMR off.
- Probes in `scripts/`:
  - `probe-cam.mjs`: lock-on framing log.
  - `probe-pose.mjs`: freeze a golem state and shoot 5 fixed views.
  - `probe-hitch.mjs`: worst frames of a scripted fight; use it for first-use shader compiles.
  - `probe-heart.mjs`: phase 3 heart hittable.
  - `probe-pick.mjs`: what is at a pixel.
  - `probe-ui.mjs`: menus with real input.
  - `shot.mjs`.
- In-page hooks with `?test=1` (`window.__CO`): `state`, `begin`, `skipIntro`, `god`, `holdGolem`,
  `forceAttack(name, side)`, `forcePhase(n)`, `killGolem`, `teleportPlayer`, `bot`, `stopBot`, `setTimeScale`,
  `events(since)`. `window.__game` is the Game instance and `window.__THREE` is three.js.
- URL flags: `?god=1`, `?skipintro=1`, `?phase=2|3`, `?bot=decent|expert`, `?nosound=1`, `?fps=1`, `?greybox=1`,
  `?quality=low|medium|high`.

## Blender

- The GUI Blender behind the MCP must be running. If `execute_blender_code` cannot connect on port 9876, start
  it with `Start-Process "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -ArgumentList "--online-mode"`
  and wait about 12 s.
- Never build in the shared scene. From the MCP, run
  `import sys; sys.path.insert(0, r"<repo>\blender_scripts"); import importlib, co_launch; importlib.reload(co_launch); result = co_launch.launch("golem.py")`,
  then wait for `[co ...] DONE` in `test-output/blender-logs/<family>.log`.
- Build times: golem about 90 to 650 s, warrior about 10 s, rubble about 6 s.
- The asset families are `textures`, `golem`, `warrior`, `arena`, `pillars` and `rubble`. The last rebuilds this
  session:
  - golem: ember eye sockets, column thighs, the back arch removed;
  - warrior: heroic proportions, a 1.27 m blade, a pleated cape;
  - rubble: displaced boulders.

## Known issues and backlog (from the latest critics)

- The golem reads as a heap of blocks at melee range and in the stagger (partly by design).
- Heavy release: a gold flare and grit, but no floor crack.
- Burning-ground flames still read as small cones.
- Phase 2 cracks are a fairly even pattern.
- Lightning is improved (forks, re-striking) but still thin at a distance.
- The deflect at the golem's shin can happen in a cramped view: the camera sits under the golem and the fist's
  core glow is nearby.
- Victory crumble: the stones now fall with acceleration, but it could use more dust.
- Perf numbers vary with machine load: many other sessions' node processes run here. Judge perf on a quiet run.
- `THREE.WebGLProgram ... X4122` console warnings are D3D shader compiler precision notes, not errors.

## Key files

- `src/game/`
  - `game.ts`: flow, director, cameras, cinematics, effects glue, HUD and audio glue.
  - `golem.ts`: AI, attacks, phases, stagger, hints to the camera director.
  - `player.ts`: controller, attacks, roll, hits.
  - `threats.ts`: rings, waves, rocks, hazards, fissures.
- `src/render/`
  - `cameraRig.ts`: the lock-on framing solve.
  - `fx.ts`, `particles.ts`: effects.
  - `threatView.ts`: the telegraph visuals.
  - `models.ts`: materials, water, heart shader.
  - `heroLight.ts`, `stoneMaterial.ts`, `partFader.ts`, `assembler.ts`, `weather.ts`, `flames.ts`, `trail.ts`,
    `renderer.ts` (with the quality governor).
- `src/ui/`: `hud.ts`, `screens.ts`, `styles.css`.
- `src/audio/`: the synthesized sound and music.
- Tuning and data: `public/balance.json` (all tuning) and `src/data/*.json` (rig and arena layout, shared with
  Blender).
