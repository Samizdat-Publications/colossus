# COLOSSUS: session handoff

Updated 2026-09-26 at the end of the second build session. Read this, then `CLAUDE.md` (project guide, milestones,
DECISIONS log) and `README.md`.

## Where things are

- Folder: `C:\Users\stewa\ClaudeProjects\Opu5.5 Game Prompt\colossus` (its own git repo, branch `main`).
- Remote: private GitHub repo `Samizdat-Publications/colossus`. Everything is committed and pushed.
- Public site: Cloudflare Pages project `colossus`, **https://colossus-bem.pages.dev** (the landing page), with the
  game at **/play/**. The plain `colossus.pages.dev` name was taken, so Cloudflare added the `-bem` suffix.
- The master folder holds other games built by other sessions: never write outside `colossus/`.

## Status: released (1.0)

All five milestones are closed (see `CLAUDE.md` and `docs/critic/`):

1. Greybox: 16 critic rounds.
2. Assets: 16 rounds.
3. Feel: 12 rounds. Closed with the critic still rating MAJOR, but on items that changed every round and sometimes
   contradicted earlier rounds; the reasoning is in `docs/critic/m3-r12.md`.
4. UI: 5 rounds, closed the same way (`docs/critic/m4-r5.md`).
5. Polish and perf: final balance (the decent bot wins 3 in 10), zero console errors in smoke, lose, win and every
   capture, 60 fps with the adaptive quality governor, six final screenshots in `screenshots/`, README.

## What the second session did

- The dodge roll: a full shoulder roll with exact floor contact (see the DECISIONS log).
- Milestone 3 rounds 8 to 12 and milestone 4 rounds 1 to 5 (reports and fixes in `docs/critic/`).
- Film mode (`scripts/film.mjs`), the media cutter (`scripts/make-media.mjs`), the landing page (`site/`), the site
  builder (`scripts/build-site.mjs`), the Cloudflare Pages project, and the README with GIFs.

## If you pick this up again

- Redeploy after a change: `npm run site -- --deploy` (it rebuilds the game with base `/play/`).
- New footage after a gameplay change: `npm run film -- --shoot intro`, `npm run film -- --shoot fight --nobuild`,
  `npm run film -- --shoot lose --nobuild`, `npm run film -- --shoot showcase --nobuild`, then `npm run media` (it also needs `test-output/final-critic`,
  `test-output/m1-critic-r16` and `test-output/m2-critic-r1` for the greybox-to-finished slider; the first comes from
  `npm run playtest -- --scenario critic --out test-output/final-critic`). `test-output/` is gitignored, so on a new
  machine the slider stills already in `site/media/` are the only copy.
- Known items the critics kept raising (not bugs): the kneeling golem reads as a heap at melee range; lightning bolts
  sometimes end in open sky; the tip strip sits at the top of the screen (a milestone 1 decision).
- Critic loop mechanics: a `general-purpose` background subagent that opens only the PNGs, **from a copy outside the
  repo** (inside it, Claude Code auto-loads `CLAUDE.md` into the subagent). Captures: `--scenario critic`,
  `feelcritic`, `uicritic`. A frozen capture frame still ticks the game with dt 0; anything that records per frame
  must skip dt 0 (the sword trail did not, and collapsed in every critic frame).

## Commands and hooks

- Tests: `npm run playtest -- --scenario smoke|lose|win|perf|critic|feelcritic|uicritic|final|tour|bot`, and
  `npm run balance -- --runs N`. Outputs go to `test-output/`.
- Probes in `scripts/`: `probe-roll.mjs` (floor contact through a roll), `probe-deflect.mjs` (what blocks the view at
  the shin), `probe-cam.mjs`, `probe-pose.mjs`, `probe-hitch.mjs`, `probe-heart.mjs`, `probe-pick.mjs`,
  `probe-ui.mjs`, `shot.mjs`.
- In-page hooks with `?test=1` (`window.__CO`): `state`, `begin`, `skipIntro`, `god`, `godFloor`, `holdGolem`,
  `forceAttack(name, side)`, `forcePhase(n)`, `killGolem`, `teleportPlayer`, `bot`, `stopBot`, `setTimeScale`,
  `events(since)`, `drain()`. `window.__game` is the Game instance and `window.__THREE` is three.js.
- URL flags: `?god=1`, `?skipintro=1`, `?phase=2|3`, `?bot=decent|expert`, `?nosound=1`, `?fps=1`, `?greybox=1`,
  `?quality=low|medium|high`.
- Blender: see `CLAUDE.md` (never build in the shared GUI scene; `co_launch.launch("<family>.py")`).
