<p align="center">
  <a href="https://make.fun/bounty/gta6-01"><img src="https://make.fun/badge/gta6-01.svg" alt="make.fun gta6-01" height="28"></a>
  <a href="https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/rank.svg"><img src="https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/rank.svg" alt="rank" height="28"></a>
  <a href="https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/reward.svg"><img src="https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/reward.svg" alt="reward" height="28"></a>
</p>

# Vice Harbor

An original open-world crime game for [make.fun's **Make GTA 6** bounty](https://make.fun/bounty/gta6-01) — built from nothing, in the spirit of GTA 6, and played entirely offline in a desktop browser.

Dusk on a working harbour city. You are a courier for the Cormorants, and everybody in Quayside owes them money. Walk the streets, take a car that isn't yours, run the five-mission story, and try to keep the heat down while the city decides what to do about you.

## Play

Open `game/index.html` in a desktop browser — no server, no network, no install. Or serve it locally:

```
node serve.ts
# then open http://localhost:8080
```

## What's in it

- **A city you can walk.** A tiled harbour district — avenues, side streets, a quay, water, warehouses, blocks with rooftop detail — with connected roads so you can always get where you are going on foot or by car.
- **Cars you can steal.** Traffic drives the grid; pull a driver out and take the wheel, with speed, steering and collisions.
- **People.** Pedestrians wander, scatter and react to gunfire and sirens.
- **A wanted system, 0 to 5 stars.** Police respond with patrol cars and officers, escalate, and call in a helicopter at high heat. Lose them and the heat decays.
- **Five named story missions** with dialogue, objectives, a mission tracker and rewards, plus a free-roam sandbox between them.
- **Combat.** Melee and firearms with ammo, muzzle flash, tracers and a health/damage model.
- **A proper HUD.** Health and armour, money, wanted stars, a live circular minimap with objective markers, radio station and district/time readout.
- **Save and load**, a start screen, and **synthesised audio** — all generated in code, no asset files.

## How it is built

Plain **Canvas 2D** and vanilla ES modules. No game engine, no framework, no third-party library, no network request at runtime — `game/` is static files that load offline. Twenty source files, each named for the one job it does:

| file | job |
| --- | --- |
| `game/index.html` | the page, the canvases, the boot |
| `src/config.js` | tunables: city size, heat floors, weapon table, timings |
| `src/geom.js` | vectors, rects, seeded RNG, helpers |
| `src/city.js` | the map: tiles, roads, blocks, water, spawn points |
| `src/render.js` | the world drawing: ground, roads, buildings, lighting |
| `src/camera.js` | follow camera with look-ahead and zoom |
| `src/input.js` | keyboard and mouse |
| `src/player.js` | the player: movement, aiming, weapons, health |
| `src/vehicles.js` | car physics and theft |
| `src/traffic.js` | AI drivers on the grid |
| `src/peds.js` | pedestrians and their reactions |
| `src/police.js` | wanted level, patrol response, helicopter |
| `src/missions.js` | the five-mission story and objectives |
| `src/effects.js` | particles, muzzle flash, explosions, skid marks |
| `src/hud.js` | health, money, stars, minimap, mission tracker |
| `src/audio.js` | synthesised engine, sirens, gunfire, radio |
| `src/save.js` | save and load |
| `src/world.js` | the world container and its update order |
| `src/shots.js` | the screenshot poses |
| `src/main.js` | boot, the loop, and the state machine |

`main.ts` is the entry program: it copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library.

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Deterministic — it seeds every generator, so two runs write identical bytes.

## Screenshots

`screenshots/1-cover.png` is the cover: Rey on foot with the city behind him and the heat rising.

## License

MIT — see `LICENSE`.
