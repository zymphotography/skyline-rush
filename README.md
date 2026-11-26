# Skyline Rush

A chase-view flight game that runs offline in a desktop browser from static
files. Fly the Skylark through glowing rings over recognisable terrain,
watch the fuel, and bring her home to the runway.

An entry for make.fun's **Make the best flight game** bounty
($500, 50 places paid).

## How to fly

- **↑ / ↓** pitch — nose up, nose down
- **← / →** bank — roll into a turn
- **W / S** throttle — more power, less power
- **Mouse drag** steers like a stick; **wheel** works the throttle
- **P** pause · **R** retry · **Enter** back to the mission list

## The sorties

1. **Dawn Patrol** — six rings over green valleys, then home to the strip.
2. **Canyon Run** — eight rings down a rock canyon. Wide turns meet the walls.
3. **Dusk Landing** — five rings, then a short strip at dusk in a crosswind.

Fly through every ring (+100 each), then land gently on the runway: slow,
level, and on the strip (+500, plus fuel and time bonuses). Hit the terrain,
land too hard, or run out of sky, and the Skylark is lost.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

No build step, no network requests at runtime, no libraries: the game is
plain ES modules on a 2D canvas, with sounds synthesised live in WebAudio.

## Layout

- `game/index.html` — the page and the canvas
- `game/src/tuning.js` — numbers, palettes, missions
- `game/src/random.js` — the seeded random generator
- `game/src/terrain.js` — the heightfield, ring course, runway, trees, clouds
- `game/src/flight.js` — the aircraft and its physics
- `game/src/input.js` — keyboard and mouse
- `game/src/sound.js` — synthesised engine, chimes and warnings
- `game/src/render.js` — the pseudo-3D view, the HUD, the screens
- `game/src/shots.js` — the staged screenshot scenes and their autopilot
- `game/src/main.js` — the loop and the screen state machine
- `main.ts` — hands the game in: copies `game/` and `screenshots/` and
  writes `dossier.json` with the vendored make.fun library
- `screenshots/` — four real renders of the game running

MIT licensed. The aircraft, terrain, names and sounds are original.
