# Vice Harbor

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Vice Harbor rank](https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/rank.svg)](https://make.fun/bounty/gta6-01)
[![Vice Harbor reward](https://make.fun/badge/gta6-01/bongekanjing/vice-harbor-vivid-walrus-33/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game for the [make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01), written from
scratch in plain JavaScript and Canvas 2D with no engine, no framework and no asset pipeline.

Vice Harbor is a working harbour city at dusk, laid out as a 96 by 96 tile grid — seven avenues, seven cross
streets, a quay road running the whole waterfront, four finger piers with container cranes on them, and seven named
districts from Vesper Heights down to The Spits. You play Rey Calloway, a man who knows what everybody owes the
Cormorant Brothers, and over the course of one long night you take on five jobs for three people who all want a
piece of the harbour back. Between the jobs the city is yours to drive: 34 civilian cars work the streets, 46
pedestrians walk the pavements, and if you make enough noise the Marina Patrol will fill the road behind you
with sirens until you either shake them or get busted. Everything you see — cars, people, buildings, water,
muzzle flashes — is drawn with canvas primitives at runtime, and everything you hear is synthesised with
WebAudio. There are no image or audio files anywhere in the build.

## How to play

Open `game/index.html` in a desktop browser, or serve the folder locally (see "Running it"). Everything is
keyboard and mouse; there is no touch input.

| Input | What it does |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Walk, and drive once you are in a car |
| `Shift` | Sprint on foot (drains a stamina bar); handbrake while driving |
| `Space` | Handbrake too, while driving |
| Mouse | Aim |
| Left click | Fire the current weapon |
| `E` | Enter or leave a car; also advances the current line of dialogue and steps into a mission briefing |
| `F` | Horn, while driving |
| `1` `2` `3` `4` | Fists, Quayside 9mm, Cannery SMG, Dockmaster 12g |
| `R` | Reload |
| `Esc` | Pause (from the pause menu, `Q` returns to the title screen) |
| `M` | Mute or unmute the radio |
| `N` | Next radio track |
| `F5` / `F9` | Save / load the night |

On foot you have 100 health, armour, sprint stamina and a wallet that starts at 350 dollars. Walking into a
parked car and pressing `E` breaks the lock and adds a little heat; getting into a moving one is a quick
scuffle. Guns have real magazines — the 9mm holds twelve rounds, the SMG forty, the shotgun eight shells of six
pellets each — and `R` refills them from your reserve.

Missions start by walking to the orange marker on the map and pressing `E`. A briefing panel opens with the
giver, the objectives and the payout; `Enter` accepts and `Esc` walks away. The current objective sits in the
HUD with an on-screen arrow pointing at it. Dying fails the mission and `Enter` retries from the giver.

### Wanted level

Heat is a 0–100 number. One star starts at 18 heat, two at 40, three at 60, four at 80 and five at 94. Shooting
people, wrecking cars and stealing them all add heat. Once you have been out of sight for 7.5 seconds the heat
starts bleeding away at 4.2 per second, but only while no officer has eyes on you — and the helicopter's
searchlight deliberately keeps you hot. Each star puts another patrol car on the road, from one at a single
star up to five at five stars. At three stars the patrol starts laying roadblocks on the road ahead of you, and
two officers get out of every car instead of one. At four stars a helicopter arrives and sweeps a searchlight
cone over the streets. Patrol cars close to pistol range, officers bail out when the car slows, then advance,
strafe and fire in bursts. If officers get within 70 pixels while you are on foot and not in a car, an arrest
meter fills; fill it and you are busted, which costs 250 dollars and clears the heat.

## What's in the game

- Five story missions, in order, each with intro dialogue, objective checkpoints, a payout and a fail/retry:

  1. **Last Call at the Cormorant** — Marla Vane wants her ledger back out of the old ice house on Cannery
     Lane. Drive over, clear three Cormorant boys, pick up the ledger and bring it back to the hotel. Pays 900.
  2. **Pier Nine Shakedown** — Ossian Pike taxes every crate in the harbour, and the pier crew has stopped
     paying. Get to Pier Nine, break up four of them, collect the unpaid tax, then lose the patrol. Pays 1400.
  3. **The Ice House Run** — Dovie Marsh has an uninspected Kestrel GT on the docks and needs it at the Old Salt
     Market. Steal it, deliver it, and lose the patrol before it gets impounded. Pays 2100.
  4. **Cormorant Cull** — the Cormorant Brothers are meeting in Warehouse Nine, all of them. Reach the
     warehouse, take out six of them (the bosses carry 130 health instead of 55), survive 45 seconds of patrol
     response, then get clear. Pays 3600.
  5. **High Tide at the Quay** — the last of the Cormorant money is on a boat at the quay. Take a Spitfire to
     the docks, pull the money off the boat and reach Vesper Green before dawn. Pays 6000.

- Six civilian car models with their own mass, grip, top speed, acceleration and hit points — the Brantley 88,
  Kestrel GT, Cormorant Van, Spitfire Coupe, Harbour Cab and Saltpan Pickup — plus the Marina Patrol cruiser.
  Cars take damage, catch fire, explode, leave skid marks and can be stolen from their drivers.
- Civilian traffic driving a road graph in lanes, braking for what is in front of them, and reacting to sirens
  and gunfire by speeding off or bailing out.
- Eight pedestrian archetypes — docker, barkeep, courier, tourist, night fisher, card dealer, off-duty patrol,
  pier kid — each with their own line of dialogue, bravery and walking speed. They gawk at trouble and run
  from gunfire.
- A drawn world: extruded buildings with lit windows, a harbour with shimmering water, dock cranes, a park,
  seven districts and a full dusk palette.
- A HUD with health and armour bars, money, wanted stars, a baked circular minimap with blips and a viewport
  cone, the mission objective line, dialogue box, weapon and ammo readout, a speedometer while driving and a
  busted-risk bar.
- Harbour FM 88.6 with five invented tracks, cycled with `N` and muted with `M`, all synthesised.
- A title screen with a new night or continue, a pause menu, mission briefings, and busted/complete/failed
  cards.
- Save and load to `localStorage`, with an in-memory fallback when storage is blocked.
- Four deterministic screenshot poses, reachable with `?shot=cover`, `?shot=drive`, `?shot=chase` and
  `?shot=mission`.

## How it's built

Twenty files, each with one job, plain ES modules loaded by `game/index.html`. No imports from outside `game/`,
no network requests at runtime, nothing to compile or bundle.

| file | job |
| --- | --- |
| `game/index.html` | the page: two canvases (world and HUD), the vignette, the boot card |
| `game/src/config.js` | all tuning: tile ids, 96x96 map, palette, car and weapon tables, heat floors, districts |
| `game/src/geom.js` | maths helpers: clamp, lerp, angles, circle/box collision against tiles, line-of-sight ray cast |
| `game/src/city.js` | builds the map deterministically from a seed: roads, blocks, buildings, water, piers, cranes, spawn tables |
| `game/src/world.js` | one bag of session state (city, player, traffic, patrol, story, effects) and the fixed-step rules |
| `game/src/render.js` | draws the world: tiles, water, road markings, extruded buildings, entities, flashes, the dusk light pass |
| `game/src/camera.js` | follow camera with look-ahead, speed zoom, shake and the world-to-screen transform |
| `game/src/input.js` | keyboard and mouse state, one-frame edges, the binding table |
| `game/src/player.js` | Rey on foot and behind the wheel: movement, aiming, shooting, melee, stamina, health, cars |
| `game/src/vehicles.js` | car physics, damage and explosion, theft, horn, sirens |
| `game/src/traffic.js` | civilian drivers on the road graph, and roadblocks |
| `game/src/peds.js` | pedestrian archetypes, their lines, and how they react to gunfire |
| `game/src/police.js` | heat and wanted stars, patrol spawning, chase driving, officers on foot, helicopter |
| `game/src/missions.js` | the five-mission story: objective state machines, markers, dialogue, rewards, fail/retry |
| `game/src/effects.js` | bullet sweeps and the particle/flash pool behind every spark, spray and explosion |
| `game/src/hud.js` | every HUD panel, plus the title screen, pause menu and briefing panel |
| `game/src/audio.js` | all sound synthesised with WebAudio: engine, guns, sirens, horns, footsteps, Harbour FM |
| `game/src/save.js` | save and load with a version guard and a fallback when storage is unavailable |
| `game/src/shots.js` | the four deterministic poses the screenshot capture asks for |
| `game/src/main.js` | boot, the fixed 60 Hz loop, the state machine, and the `?shot=` hook |

`main.ts` is the hand-in program, not part of the game. It checks `game/` and `screenshots/` against the
bounty's caps, copies both into the output directory, then writes `dossier.json` with the vendored
`buildDossier` from `vendor/makefun-game.ts`. It uses the Node standard library only, touches no network, and
is deterministic.

## Screenshots

Four 1280x720 stills of the game itself live in `screenshots/`: `1-cover.png` (Rey on foot with traffic,
pedestrians and arriving patrol cars), `2-drive.png` (driving down a harbour road at speed),
`3-chase.png` (four stars, a helicopter searchlight and a near-full busted bar) and `4-mission.png` (a mission
briefing over the paused world). They were captured by loading the game with `?shot=<name>`.

## Running it

The game needs a static server because it loads ES modules, which browsers refuse over `file://`:

```
node serve.ts
# then open http://localhost:8080
```

To produce the hand-in:

```
cd /root/makefun/g7/repo
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That writes `out/game/`, `out/screenshots/` and `out/dossier.json` and prints a summary of what it staged.

## License

MIT — see `LICENSE`.
