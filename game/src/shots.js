// The four deterministic poses the screenshot capture asks for with ?shot=<name>: cover, drive, chase and mission.
// Each one builds the exact frame the brief describes, then freezes the loop. No randomness that is not seeded,
// no dependence on wall-clock time, so the same PNG comes out of the same build.

import { TILE } from './config.js';
import { makeRng } from './geom.js';
import { makeCar } from './vehicles.js';
import { makePed, ARCHETYPES } from './peds.js';
import { MISSIONS } from './missions.js';
import { snapCamera, addShake } from './camera.js';
import { spawnExplosion, spawnImpact } from './effects.js';

// The pavement spot the cover is built around: the corner of the last avenue and the dock road at the harbour's
// east end, where the street runs east to the pier and a container crane stands over the rooftops.
const COVER = { tx: 80, ty: 76 };

// A tile id at a tile coordinate, for placing a pose on real ground.
function tileIdAt(world, tx, ty) {
  const w = world.city.width;
  if (tx < 0 || ty < 0 || tx >= w || ty >= world.city.height) return -1;
  return world.city.tiles[ty * w + tx];
}

// Walks a tile coordinate to the nearest walkable one, so a pose never lands inside a building.
function walkableNear(world, tx, ty, radius = 6) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const id = tileIdAt(world, tx + dx, ty + dy);
        if (id === 1 || id === 4 || id === 6 || id === 5) {
          return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 };
        }
      }
    }
  }
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// A point on the roadway, snapped to the nearest road tile centre.
function roadNear(world, tx, ty, radius = 6) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tileIdAt(world, tx + dx, ty + dy) === 0) {
          return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 };
        }
      }
    }
  }
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

export function poseNamed(world, name) {
  switch (name) {
    case 'cover':
      return poseCover(world);
    case 'drive':
      return poseDrive(world);
    case 'chase':
      return poseChase(world);
    case 'mission':
      return poseMission(world);
    default:
      return poseCover(world);
  }
}

// A car parked where a civilian drove up and left it, so the cover always has a steal target.
function parkHeroCar(world, x, y, angle, modelId = 'brantley', paint = '#b8543f') {
  const car = makeCar(modelId, x, y, angle, { locked: false, driver: null, paint });
  car.stolen = true;
  car.headlight = true;
  world.cars.push(car);
  return car;
}

// A civilian car on the road, placed by hand and then given a lane and a heading.
function addTrafficAt(world, x, y, angle, modelId, paint) {
  const car = makeCar(modelId, x, y, angle, { locked: true, driver: 'ai', paint });
  car.speed = 90;
  car.ai = { edge: pickEdgeNear(world, x, y, angle), t: 0.5, cruise: 0.5, panic: 0, stuck: 0, decisions: 0 };
  world.cars.push(car);
  return car;
}

function pickEdgeNear(world, x, y, angle) {
  return world.city.edges.reduce((best, e) => {
    const d = Math.hypot(e.from.x - x, e.from.y - y) + Math.abs(e.angle - angle) * 40;
    const bd = Math.hypot(best.from.x - x, best.from.y - y) + Math.abs(best.angle - angle) * 40;
    return d < bd ? e : best;
  }, world.city.edges[0]);
}

// A pedestrian standing exactly where the frame needs one, with a chosen archetype and coat.
function addPedAt(world, x, y, angle, archId, colour) {
  const arch = ARCHETYPES.find((a) => a.id === archId) ?? ARCHETYPES[0];
  const rng = makeRng(Math.floor(x * 7 + y * 13));
  const ped = makePed(x, y, rng, { angle, archetype: arch, colour: colour ?? arch.coat });
  ped.wantX = x;
  ped.wantY = y;
  ped.state = 'idle';
  world.peds.push(ped);
  return ped;
}

// A patrol car arriving, lights on, officers already out.
function addCopCar(world, x, y, angle) {
  const car = makeCar('patrol', x, y, angle, { police: true, locked: false, driver: 'ai' });
  car.speed = 40;
  car.siren = true;
  car.ai = { edge: pickEdgeNear(world, x, y, angle), t: 0.5, cruise: 0.3, panic: 0, stuck: 0, decisions: 0 };
  world.police.cars.push(car);
  world.cars.push(car);
  return car;
}

function addOfficer(world, x, y, angle) {
  world.police.officers.push({
    id: world.police.officers.length + 1,
    x,
    y,
    angle,
    speed: 0,
    walkPhase: 0,
    dead: false,
    hp: 60,
    cooldown: 0.8,
    carId: -1,
    state: 'engage',
    strafe: 1,
    think: 1,
    burst: 0,
  });
}

// 1. Cover: Rey on the pavement of the long quay street, a stolen coupe at the kerb, traffic and pedestrians all
//    around, two patrol cars arriving with two stars lit, a crane over the rooftops and the mission line on screen.
function poseCover(world) {
  const p = world.player;
  const feet = walkableNear(world, COVER.tx, COVER.ty, 3);
  p.x = feet.x;
  p.y = feet.y;
  p.angle = 0;
  p.aim = -0.12;
  p.weapon = 'pistol';
  p.ammo.pistol = 34;
  p.money = 2480;
  p.hp = 78;
  p.armour = 42;
  p.inCar = null;

  // The stolen car at the kerb, just ahead of him and pointing east along the street.
  const kerb = roadNear(world, COVER.tx + 2, COVER.ty + 2, 4);
  parkHeroCar(world, kerb.x, kerb.y - 6, 0.0, 'spitfire', '#c94f4f');

  // Traffic on the street: three cars east of him, one coming the other way, one on the cross avenue.
  addTrafficAt(world, kerb.x + 250, kerb.y, 0.02, 'harbour', '#d9983f');
  addTrafficAt(world, kerb.x + 430, kerb.y - 22, Math.PI, 'cormorant', '#4c7fb8');
  addTrafficAt(world, kerb.x - 240, kerb.y - 20, 0.0, 'brantley', '#c8c0b4');
  addTrafficAt(world, kerb.x + 120, kerb.y + 24, 0.0, 'kestrel', '#8a5fae');
  addTrafficAt(world, kerb.x + 640, kerb.y, 0.0, 'saltpan', '#5f9c79');

  // Pedestrians: five in frame, two already turning to watch the patrol arrive.
  addPedAt(world, kerb.x + 96, kerb.y - 44, 2.7, 'tourist', '#4f8a8a');
  addPedAt(world, kerb.x + 158, kerb.y - 40, -1.9, 'docker', '#5c6f88');
  addPedAt(world, kerb.x - 66, kerb.y - 46, 0.4, 'courier', '#c9a04a');
  addPedAt(world, kerb.x + 36, kerb.y + 42, -2.4, 'barkeep', '#7a4a52');
  addPedAt(world, kerb.x + 300, kerb.y - 44, 3.0, 'kid', '#b5566b');

  // The patrol arrives: two cars, four officers, two stars.
  world.police.heat = 44;
  world.police.stars = 2;
  addCopCar(world, kerb.x + 700, kerb.y + 20, Math.PI - 0.04);
  addCopCar(world, kerb.x - 330, kerb.y - 22, 0.02);
  addOfficer(world, kerb.x + 620, kerb.y - 30, Math.PI);
  addOfficer(world, kerb.x + 648, kerb.y + 6, Math.PI - 0.3);

  // The story is live: mission one, objective one, the giver's second line on screen.
  const ms = world.missions;
  ms.index = 0;
  ms.active = MISSIONS[0];
  ms.state = 'active';
  ms.objective = 0;
  ms.dialogue = MISSIONS[0].intro;
  ms.dialogueIndex = 1;
  ms.markers = [{ x: world.city.missionSpots.alley.x, y: world.city.missionSpots.alley.y, tone: '#ffd66b', primary: true, kind: 'goto', label: 'the ice house' }];
  world.radioTrack = 'The Quayside Four — "Salt and Neon"';
  world.hasSave = true;

  snapCamera(world.camera, p.x + 250, p.y - 20, 0.80);
  world.camera.leadX = 130;
  world.camera.leadY = -30;
  return { name: 'cover', focus: { x: p.x + 250, y: p.y } };
}

// 2. Drive: flat out west along the quay street, streaks on the tarmac, a courier leaping clear of the bonnet,
//    traffic ahead and a cab coming the other way.
function poseDrive(world) {
  const p = world.player;
  const on = roadNear(world, 70, 78, 4);
  const car = makeCar('kestrel', on.x, on.y - 4, Math.PI, { locked: false, driver: 'player', paint: '#4c7fb8' });
  car.speed = 322;
  car.steer = -0.1;
  car.ai = null;
  world.cars.push(car);
  p.inCar = car;
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  p.aim = car.angle;
  p.hp = 92;
  p.money = 3120;

  // Traffic ahead on the same carriageway, one cab coming the other way, a van closing from behind.
  const lead = makeCar('brantley', on.x - 320, on.y - 24, Math.PI, { locked: true, driver: 'ai', paint: '#c8c0b4' });
  lead.speed = 150;
  lead.ai = { edge: pickEdgeNear(world, on.x - 320, on.y, Math.PI), t: 0.4, cruise: 0.45, panic: 0, stuck: 0, decisions: 0 };
  world.cars.push(lead);
  const oncoming = makeCar('harbour', on.x - 210, on.y + 26, 0.02, { locked: true, driver: 'ai', paint: '#d9983f' });
  oncoming.speed = 170;
  oncoming.ai = { edge: pickEdgeNear(world, on.x, on.y, 0), t: 0.2, cruise: 0.5, panic: 0, stuck: 0, decisions: 0 };
  world.cars.push(oncoming);
  const behind = makeCar('cormorant', on.x + 360, on.y - 20, Math.PI, { locked: true, driver: 'ai', paint: '#5f9c79' });
  behind.speed = 200;
  behind.ai = { edge: pickEdgeNear(world, on.x + 360, on.y, Math.PI), t: 0.6, cruise: 0.5, panic: 0, stuck: 0, decisions: 0 };
  world.cars.push(behind);

  // The leap: a courier already off the kerb and mid-air, angled away from the bonnet.
  const leapSpot = walkableNear(world, 66, 76, 3);
  const leaper = addPedAt(world, leapSpot.x + 40, leapSpot.y + 10, Math.PI * 0.72, 'courier', '#c9a04a');
  leaper.fleeing = true;
  leaper.state = 'flee';
  leaper.x = on.x - 120;
  leaper.y = on.y - 46;
  leaper.wantX = on.x - 260;
  leaper.wantY = on.y - 150;
  leaper.walkPhase = 1.9;
  leaper.speed = 150;
  const watcher = walkableNear(world, 63, 80, 3);
  addPedAt(world, watcher.x, watcher.y, 0.4, 'docker', '#5c6f88').fleeing = true;
  addPedAt(world, leapSpot.x - 60, leapSpot.y + 40, -0.6, 'tourist', '#4f8a8a');

  // Skid marks from the last corner, trailing behind the car.
  for (let i = 0; i < 18; i++) {
    world.skids.push({ x0: on.x + 40 + i * 26, y0: on.y - 22, x1: on.x + 64 + i * 26, y1: on.y - 18 });
    world.skids.push({ x0: on.x + 40 + i * 26, y0: on.y + 12, x1: on.x + 64 + i * 26, y1: on.y + 16 });
  }

  world.police.heat = 6;
  world.police.stars = 0;
  const ms = world.missions;
  ms.index = 0;
  ms.active = MISSIONS[0];
  ms.state = 'active';
  ms.objective = 0;
  ms.markers = [{ x: world.city.missionSpots.alley.x, y: world.city.missionSpots.alley.y, tone: '#ffd66b', primary: true, kind: 'goto', label: 'the ice house' }];

  snapCamera(world.camera, on.x - 120, on.y - 6, 0.72);
  world.camera.leadX = -220;
  return { name: 'drive', focus: { x: on.x - 180, y: on.y } };
}

// 3. Chase: four stars, three patrol cars on the tail, the helicopter's beam on the roof, tracers, a fireball where
//    a cruiser just went up, and the bust meter nearly full.
function poseChase(world) {
  const p = world.player;
  const on = roadNear(world, 42, 54, 4);
  const car = makeCar('spitfire', on.x, on.y, -Math.PI / 2 - 0.1, { locked: false, driver: 'player', paint: '#c94f4f' });
  car.speed = 288;
  car.hp = 74;
  car.damage = 0.4;
  world.cars.push(car);
  p.inCar = car;
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  p.aim = car.angle;
  p.hp = 54;
  p.armour = 12;
  p.money = 1940;
  p.weapon = 'smg';
  p.ammo.smg = 26;

  world.police.heat = 88;
  world.police.stars = 4;
  world.police.bustRisk = 0.86;
  world.police.cool = 0;

  // Three cruisers filling the mirror, nose to tail on the avenue behind him.
  const c1 = addCopCar(world, on.x - 20, on.y + 150, -Math.PI / 2 - 0.03);
  c1.speed = 300;
  const c2 = addCopCar(world, on.x + 26, on.y + 240, -Math.PI / 2 + 0.03);
  c2.speed = 310;
  const c3 = addCopCar(world, on.x - 30, on.y + 330, -Math.PI / 2 - 0.06);
  c3.speed = 260;
  addOfficer(world, on.x + 62, on.y + 116, -Math.PI / 2 - 0.5);

  // The helicopter overhead, its beam down on the roof of the red coupe.
  world.police.heli = { x: on.x + 30, y: on.y - 200, active: true, beamAngle: Math.PI * 0.55, rotor: 0, spawnT: 0 };

  // Tracers: a burst from the lead cruiser, and the player's SMG answering over his shoulder.
  for (let i = 0; i < 4; i++) {
    world.bullets.push({ x: on.x + 6 + i * 6, y: on.y + 200 - i * 40, angle: -Math.PI / 2 + 0.06, speed: 980, dmg: 9, life: 0.5, from: 'cop', tone: '#ff9a6b' });
  }
  for (let i = 0; i < 3; i++) {
    world.bullets.push({ x: on.x - 10 + i * 5, y: on.y - 40 - i * 40, angle: Math.PI / 2 - 0.3, speed: 1080, dmg: 13, life: 0.5, from: 'player', tone: '#ffd66b' });
  }
  // The car in front just went up: a fireball, a ring, smoke and a scorch.
  spawnExplosion(world, on.x - 90, on.y - 190, 1.15);
  for (let i = 0; i < 10; i++) spawnImpact(world, on.x - 60 + i * 9, on.y - 170, 1.2, '#ffca6b');
  world.flashWhite = 0.22;
  addShake(world.camera, 12);

  const ms = world.missions;
  ms.index = 0;
  ms.active = MISSIONS[3];
  ms.state = 'active';
  ms.objective = 2;
  ms.markers = [];
  ms.dialogue = [['Rey', 'The whole harbour is behind me. Good. Let them watch.']];
  ms.dialogueIndex = 0;

  snapCamera(world.camera, on.x - 30, on.y + 60, 0.68);
  world.camera.leadX = 0;
  world.camera.leadY = 170;
  return { name: 'chase', focus: { x: on.x, y: on.y + 40 } };
}

// 4. Mission: the briefing panel over the paused, dimmed world on Cannery Lane.
function poseMission(world) {
  const p = world.player;
  const spot = world.city.missionSpots.alley;
  const feet = walkableNear(world, Math.floor(spot.x / TILE) + 1, Math.floor(spot.y / TILE) + 1, 4);
  p.x = feet.x;
  p.y = feet.y;
  p.angle = -1.5;
  p.aim = -1.5;
  p.hp = 96;
  p.armour = 18;
  p.money = 1540;

  parkHeroCar(world, spot.x - 46, spot.y - 40, -0.2, 'cormorant', '#8a5fae');
  addTrafficAt(world, spot.x + 10, spot.y - 240, 0.02, 'harbour', '#d9983f');
  addTrafficAt(world, spot.x + 210, spot.y - 60, Math.PI, 'brantley', '#c8c0b4');
  addPedAt(world, spot.x + 96, spot.y - 10, -2.4, 'docker', '#5c6f88');
  addPedAt(world, spot.x - 110, spot.y - 30, 0.9, 'fisher', '#3f5a45');
  addPedAt(world, spot.x + 40, spot.y + 70, 2.2, 'dealer', '#8a6fa8');

  // The job on the table: mission one, its first objective marked, its briefing panel open.
  const ms = world.missions;
  ms.index = 0;
  ms.active = MISSIONS[0];
  ms.state = 'active';
  ms.objective = 0;
  ms.dialogue = null;
  ms.markers = [{ x: spot.x, y: spot.y, tone: '#ffd66b', primary: true, kind: 'goto', label: 'the ice house' }];
  world.briefing = {
    name: MISSIONS[0].name,
    giver: MISSIONS[0].giver,
    summary: MISSIONS[0].briefing,
    objectives: MISSIONS[0].objectives.map((o) => o.text),
    reward: MISSIONS[0].reward,
    city: 'Vice Harbor',
  };
  world.police.heat = 12;
  world.police.stars = 0;

  snapCamera(world.camera, spot.x + 10, spot.y + 20, 0.95);
  return { name: 'mission', focus: { x: spot.x, y: spot.y } };
}

// Everything a shot needs after posing: settle physics a few frames without input so nothing overlaps, then stop.
export function settleShot(world, stepWorld, input, frames = 8) {
  for (let i = 0; i < frames; i++) {
    stepWorld(world, input, 1 / 60);
    world.events.length = 0;
  }
}
