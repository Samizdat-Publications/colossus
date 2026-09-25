# COLOSSUS

A third-person boss fight in the browser. A lone warrior walks into a drowned, ruined arena at night.
Rain hammers the flagstones, lightning cracks over the broken arches, and the rubble in the middle of the
arena rises, rock by rock, into **OSTRAKON, THE LIVING RUIN**: a stone golem more than eight times your
height. One fight, three phases, Souls-like but fair.

Built with Vite, TypeScript and Three.js. Every model and texture was made by Python scripts in Blender
(`blender_scripts/`); every sound and the music are synthesized live with the Web Audio API. Nothing was
downloaded.

## Run it

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5419 (the dev server picks the next free port if that one is taken).

```bash
npm run build      # type-check and build into dist/
npm run preview    # serve the build on http://127.0.0.1:4419
```

## How to fight

Stone deflects your blade. **Only the glowing cyan cores can be hurt**: one on each forearm and one low
on its back.

- After a slam or a sweep, a fist stays stuck in the ground. That is your window: strike the arm core
  (the **STRIKE** tag marks it).
- Core hits fill the **BREAK** meter. When it is full the golem falls to its knees: get behind it and hit
  the core on its back (critical damage). While it is down every hit counts.
- Every attack is telegraphed on the floor: **red** rings and sectors show where a blow lands, **pale red**
  rings are shockwaves (roll or jump through them), **amber** cracks are burning ground.
- Phase 2 (at two thirds of its health) splits its body with glowing cracks and adds a two-fisted slam
  with a racing fissure, a rock volley and a sweep combo. Phase 3 (one third) bursts its chest open on a
  molten heart and adds a leaping slam, a double stomp and a meteor rain.

## Controls

| Action | Keyboard and mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Camera | Mouse (click the game to capture it) | Right stick |
| Light attack (3-hit combo) | Left click | RB / R1 |
| Heavy attack (hold to charge) | Right click | RT / R2 |
| Block (hold) | Shift | LB / L1 |
| Dodge roll (invulnerable frames) | Space | B / Circle |
| Jump | F | A / Cross |
| Lock on / off | Q, middle click or Tab | R3 |
| Drink a flask (heal, 3 per attempt) | R | X / Square |
| Pause | Esc or P | Start |
| Show or hide the controls card | H | |

Every action is buffered: press it during another action and it fires as soon as it can. The controls card
shows for the first seconds of your first attempt; **Settings** (title screen or pause menu) has mouse
sensitivity, invert Y, master, music and effects volume, camera shake and the controls card. Settings are
remembered in the browser.

## Performance

The game aims for 60 fps on a mid-range laptop. An adaptive quality governor watches the frame time: after a
few seconds above about 19.5 ms it lowers the render scale (and then the shadow resolution), and it raises
them again after a long fast stretch. Add `?quality=low`, `?quality=medium` or `?quality=high` to the URL to
pin a level, and `?fps=1` to show the frame time. Every shader is compiled behind the loading screen, so the
first stagger or phase change never stalls.

## Tuning

`public/balance.json` holds every damage, health and timing value. Edit it and reload the page (in a
build, edit `dist/balance.json`); no code changes are needed.

## Assets

`npm run assets` regenerates every model and texture with Blender 5.x in background mode (set
`BLENDER_PATH` if Blender is not installed at the default path). See `CLAUDE.md` for the asset list and
the pipeline.

## Tests

```bash
npm run playtest -- --scenario smoke        # real keyboard and mouse input through every control
npm run playtest -- --scenario win          # the in-page bot fights to a victory
npm run playtest -- --scenario lose         # a death, the death screen, try again
npm run playtest -- --scenario perf         # frame times and draw calls over 20 s of fighting
npm run playtest -- --scenario critic       # 19 player-camera screenshots of every beat
npm run playtest -- --scenario feelcritic   # frame bursts around hits, impacts and weather
npm run playtest -- --scenario uicritic     # every menu, HUD state and end screen
npm run balance -- --runs 8                 # the "decent" bot fights 8 full attempts (no god mode)
```

Screenshots, console logs and a report land in `test-output/`. The decent bot wins roughly one attempt in
four or five, with most losses late in phase 3: a player who learns the patterns should win within three to
six attempts. `docs/critic/` holds every screenshot-critic report and what was fixed after it.
