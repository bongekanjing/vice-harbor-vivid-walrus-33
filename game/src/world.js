// The world object: one bag of state for a session (city, player, traffic, patrol, story, effects), the aliases the
// renderer and HUD read, and the fixed-step simulation that moves all of it. main.js owns the loop; this owns the rules.

import { TILE, TRAFFIC } from './config.js';
import { makeRng, dist, clamp } from './geom.js';
import { buildCity, districtAt } from './city.js';
import { createPlayer, stepPlayerOnFoot, stepPlayerDriving, addHeat, respawnPlayer, startReload, selectWeapon } from './player.js';
import { seedTraffic, stepTrafficCar, spookTraffic, recycleAbandoned } from './traffic.js';
import { seedPeds, stepPed, hurtPed, maybeSpeak } from './peds.js';
import { createPolice, reportCrime, stepWanted, stepPoliceFleet, stepPoliceCars, stepOfficers, stepHeli } from './police.js';
import { createMissions, stepMissions, stepHostiles, buildMarkers, MISSIONS, missionAtPlayer } from './missions.js';
import { stepBullets, stepParticles, laySkid, makeVehicleHooks } from './effects.js';
import { RADIO_TRACKS } from './audio.js';

// The player starts on the pavement outside the Cormorant Hotel, facing the harbour.
const START = { x: 60 * TILE + 16, y: 13 * TILE, angle: Math.PI / 2 };

export function createWorld(seed = 20261122) {
  const rng = makeRng(seed);
  const city = buildCity(seed);
  const player = createPlayer(START.x, START.y);
  player.angle = START.angle;
  player.aim = START.angle;

  const police = createPolice();
  const missions = createMissions();
  const cars = seedTraffic(city, rng, TRAFFIC.cars);
  const peds = seedPeds(city, rng, TRAFFIC.peds);

  const world = {
    seed,
    rng,
    time: 0,
    city,
    player,
    cars,
    peds,
    police,
    cops: police.officers,
    missions,
    hostiles: [],
    bullets: [],
    particles: [],
    flashes: [],
    skids: [],
    scorches: [],
    wrecks: [],
    deadPeds: [],
    events: [],
    hudEvents: [],
    markers: [],
    prompt: null,
    objectiveText: '',
    nextMissionName: MISSIONS[0].name,
    radioTrack: RADIO_TRACKS[0],
    muted: false,
    rain: 0,
    flashWhite: 0,
    vignette: { tone: '#7a0d20', alpha: 0 },
    pendingShake: 0,
    pendingHeat: 0,
    mouseAim: null,
    titleChoice: 0,
    hasSave: false,
    briefing: null,
    completeTitle: '',
    completeReward: 0,
    hooks: {},
    vehicleHooks: null,
    advanceDialogue: false,
    lastKill: 0,
  };

  world.vehicleHooks = makeVehicleHooks(world);

  // The renderer and HUD read a few things by their short names; keep them pointing at the live arrays.
  Object.defineProperty(world, 'markers', {
    get: () => missions.markers,
    configurable: true,
  });
  Object.defineProperty(world, 'objectiveText', {
    get: () => {
      const m = missions.active;
      if (!m) {
        if (missions.index >= MISSIONS.length) return 'The harbour is quiet. Rey owns the night.';
        return 'Meet ' + MISSIONS[missions.index].giver + ' at ' + world.city.missionSpots[MISSIONS[missions.index].where].name + '.';
      }
      const obj = m.objectives[missions.objective];
      return obj ? obj.text : 'Mission complete.';
    },
    configurable: true,
  });
  Object.defineProperty(world, 'nextMissionName', {
    get: () => {
      if (missions.active) return missions.active.name;
      return MISSIONS[Math.min(missions.index, MISSIONS.length - 1)].name;
    },
    configurable: true,
  });

  buildMarkers(missions, world);
  return world;
}

// One fixed step of everything except rendering and input polling. `input` may be a stub when posing shots.
export function stepWorld(world, input, dt) {
  world.time += dt;
  const p = world.player;

  // Heat earned earlier in the step is applied here, once, so a burst of kills cannot double-count.
  if (world.pendingHeat > 0) {
    addHeat(p, world.pendingHeat);
    if (p.heat > 4) reportCrime(world.police, 0, world);
    world.pendingHeat = 0;
  }

  if (!p.dead) {
    if (p.inCar) stepPlayerDriving(p, world, input, dt, playerHooks(world));
    else stepPlayerOnFoot(p, world, input, world.moveAxis, dt, playerHooks(world));
  }

  // Traffic, then their collisions with the player's car and each other.
  for (const car of world.cars) {
    if (car.dead || car.recycle) continue;
    if (car.ai) stepTrafficCar(car, world, dt, world.vehicleHooks);
    else if (car !== p.inCar) {
      // A parked car still obeys physics enough to be shoved.
      car.speed *= 1 - 2 * dt;
      car.x += car.vx * dt;
      car.y += car.vy * dt;
      car.vx *= 1 - 3 * dt;
      car.vy *= 1 - 3 * dt;
    }
    const sliding = Math.abs(car.speed) > 120 && (car.handbrake || Math.abs(car.steer) > 0.6);
    laySkid(world, car, dt, sliding);
  }
  collideAll(world);
  world.cars = world.cars.filter((c) => !c.recycle);

  // People.
  for (const ped of world.peds) {
    if (ped.dead) continue;
    stepPed(ped, world.city.tiles, dt, world);
    const near = dist(ped.x, ped.y, p.x, p.y) < 120;
    maybeSpeak(ped, dt, ped.panicRng, near);
  }

  // Patrol, hostiles, bullets and effects.
  stepWanted(world.police, world, dt);
  stepPoliceFleet(world.police, world, dt);
  stepPoliceCars(world.police, world, dt, world.vehicleHooks);
  stepOfficers(world.police, world, dt, policeHooks(world));
  stepHeli(world.police, world, dt);
  stepHostiles(world, dt);
  stepBullets(world, dt);
  stepParticles(world, dt);
  stepMissions(world.missions, world, dt);
  recycleAbandoned(world, dt);

  // Player death: a short beat, then the hospital bill and a spawn at the quay.
  if (p.dead) {
    p.deathTimer += dt;
    if (p.deathTimer > 2.4) {
      respawnPlayer(p, START.x, START.y, 150);
      world.police.heat = 0;
      world.police.stars = 0;
      world.flashWhite = 1;
      world.hudEvents.push({ type: 'toast', text: 'You wake up on the quay. $150 for the doctor.' });
    }
  }

  // Police stand down when the player is clean for long enough.
  if (world.police.stars === 0) {
    world.police.bustRisk = Math.max(0, world.police.bustRisk - dt);
    if (world.police.cars.length > 0 && world.police.heat < 2) world.police.cars.length = 0;
  }

  world.vignette.alpha = clamp((1 - p.hp / p.maxHp) * 0.55 + world.police.bustRisk * 0.22, 0, 0.8);
  world.flashWhite = Math.max(0, world.flashWhite - dt * 2.4);

  // Prompts and the cursor's aim are cheap to recompute every step and keep the HUD honest.
  updatePrompt(world);
  if (world.rain > 0) world.rain = Math.max(0, world.rain - dt * 0.02);
  return world;
}

// Player-level hooks: sounds, shakes, heat and the crowd's reaction to a drawn gun.
function playerHooks(world) {
  return {
    onShot(w) {
      addHeat(world.player, w.id === 'shotgun' ? 9 : w.id === 'smg' ? 7 : 5);
      if (world.hooks.shotSound) world.hooks.shotSound(w.id);
      spookTraffic(world, world.player.x, world.player.y, 320);
      world.pendingShake = Math.max(world.pendingShake ?? 0, 2.2);
    },
    onShotgun() {
      world.pendingShake = Math.max(world.pendingShake ?? 0, 5.5);
    },
    onDryFire() {
      world.hudEvents.push({ type: 'toast', text: 'Empty. Press R.' });
      if (world.hooks.drySound) world.hooks.drySound();
    },
    onPunch() {
      if (world.hooks.punchSound) world.hooks.punchSound();
    },
    onMeleeHit(target, dmg) {
      target.hp = (target.hp ?? 30) - dmg;
      world.pendingShake = Math.max(world.pendingShake ?? 0, 3);
      if (target.hp <= 0 && !target.dead) {
        target.dead = true;
        if (world.peds.includes(target)) world.deadPeds.push({ x: target.x, y: target.y, angle: target.angle });
        addHeat(world.player, 8);
      } else if (target.arch) {
        hurtPed(target, 0, world);
      }
      if (world.hooks.punchSound) world.hooks.punchSound();
      spookTraffic(world, target.x, target.y, 260);
    },
    onScare(ped, x, y, strength) {
      if (world.hooks.scare) world.hooks.scare(ped, x, y, strength);
    },
    onHurt(amount) {
      if (world.hooks.hurtSound) world.hooks.hurtSound(amount);
      world.pendingShake = Math.max(world.pendingShake ?? 0, 4 + amount * 0.2);
    },
    onDeath() {
      world.events.push({ type: 'playerDead' });
      if (world.hooks.deathSound) world.hooks.deathSound();
    },
    onFootstep(running) {
      if (world.hooks.stepSound) world.hooks.stepSound(running);
    },
    onEngine(car) {
      if (world.hooks.engineSound) world.hooks.engineSound(car);
    },
    onHorn() {
      if (world.hooks.hornSound) world.hooks.hornSound();
    },
    onEnterCar(car) {
      world.hudEvents.push({ type: 'toast', text: 'You slide into the ' + car.model.name + '.' });
      if (world.hooks.enterSound) world.hooks.enterSound();
    },
    onExitCar() {
      if (world.hooks.exitSound) world.hooks.exitSound();
    },
    onSteal(car) {
      addHeat(world.player, 6);
      world.hudEvents.push({ type: 'toast', text: 'Lock popped. The ' + car.model.name + ' is yours.' });
      if (world.hooks.stealSound) world.hooks.stealSound();
    },
    onLockBreak(car) {
      if (world.hooks.lockSound) world.hooks.lockSound();
    },
    onInteract() {
      const m = missionAtPlayer(world.missions, world);
      if (m) {
        world.briefing = {
          name: m.name,
          giver: m.giver,
          summary: m.briefing,
          objectives: m.objectives.map((o) => o.text),
          reward: m.reward,
          city: 'Vice Harbor',
        };
        world.pendingMission = m;
        world.events.push({ type: 'briefing', mission: m });
      }
    },
  };
}

// Cop-level hooks: their gunshots are quieter than the player's, but they still count.
function policeHooks(world) {
  return {
    onCopShot() {
      if (world.hooks.copShotSound) world.hooks.copShotSound();
    },
  };
}

// Every car against every other car, and the player's car against people. O(n^2) over ~40 cars is fine.
function collideAll(world) {
  const cars = world.cars.filter((c) => !c.dead);
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const reach = (a.model.len + b.model.len) * 0.34;
      if (dist(a.x, a.y, b.x, b.y) > reach) continue;
      shoveCars(a, b, world);
    }
    // A car that runs into a pedestrian kills them; the crowd scatters.
    const car = cars[i];
    if (Math.abs(car.speed) < 55) continue;
    for (const ped of world.peds) {
      if (ped.dead) continue;
      if (dist(ped.x, ped.y, car.x, car.y) > car.model.len * 0.55) continue;
      if (world.hooks.scare) world.hooks.scare(ped, car.x, car.y, 2);
      ped.hp -= Math.abs(car.speed) * 0.28;
      if (ped.hp <= 0) {
        ped.dead = true;
        world.deadPeds.push({ x: ped.x, y: ped.y, angle: ped.angle });
        if (car.driver === 'player') addHeat(world.player, 14);
      }
    }
  }
}

function shoveCars(a, b, world) {
  const d = dist(a.x, a.y, b.x, b.y) || 0.01;
  const nx = (b.x - a.x) / d;
  const ny = (b.y - a.y) / d;
  const overlap = (a.model.len + b.model.len) * 0.34 - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const closing = Math.abs(a.speed - b.speed) * 0.5 + Math.abs(a.speed) * 0.25;
  const dmg = closing > 45 ? (closing - 45) * 0.2 : 0;
  if (dmg > 0.4) {
    a.hp -= dmg * 0.7;
    b.hp -= dmg * 0.7;
    a.damage = clamp(1 - a.hp / a.maxHp, 0, 1);
    b.damage = clamp(1 - b.hp / b.maxHp, 0, 1);
    if (world.vehicleHooks.onCrash) world.vehicleHooks.onCrash(a, closing, 'car');
    if (a.hp <= 0 && !a.dead) world.vehicleHooks.onExplode(a);
    if (b.hp <= 0 && !b.dead) world.vehicleHooks.onExplode(b);
  }
  a.speed *= 0.4;
  b.speed *= 0.4;
  a.vx -= nx * 30;
  a.vy -= ny * 30;
  b.vx += nx * 30;
  b.vy += ny * 30;
}

// The one contextual line the HUD shows: a car you could take, a job you could start, or nothing.
function updatePrompt(world) {
  const p = world.player;
  world.prompt = null;
  if (p.dead) return;
  if (p.inCar) {
    world.prompt = 'E — get out    F — horn    SHIFT — handbrake';
    return;
  }
  const nearCar = world.cars.find((c) => !c.dead && !c.police && dist(c.x, c.y, p.x, p.y) < 70);
  if (nearCar) {
    world.prompt = nearCar.locked ? 'E — break into the ' + nearCar.model.name : 'E — drive the ' + nearCar.model.name;
    return;
  }
  const m = missionAtPlayer(world.missions, world);
  if (m) world.prompt = 'E — hear ' + m.giver + ' out';
}

// Deal with the story and patrol events the simulation pushed this step: sounds, cards, state changes.
export function drainEvents(world, audioHooks) {
  const out = [];
  for (const e of world.events) {
    if (e.type === 'wanted') {
      if (audioHooks.wanted) audioHooks.wanted(e.stars);
      if (e.stars > 0) world.hudEvents.push({ type: 'card', card: 'WANTED  ' + '★'.repeat(e.stars), time: 2.2 });
      else world.hudEvents.push({ type: 'toast', text: 'The patrol has lost interest.' });
    } else if (e.type === 'busted') {
      out.push({ type: 'busted' });
    } else if (e.type === 'missionStart') {
      if (audioHooks.sting) audioHooks.sting('start');
      world.hudEvents.push({ type: 'toast', text: e.mission.name });
    } else if (e.type === 'missionComplete') {
      out.push({ type: 'complete', mission: e.mission, reward: e.reward });
    } else if (e.type === 'missionFailed') {
      out.push({ type: 'failed', reason: e.reason });
    } else if (e.type === 'playerDead') {
      out.push({ type: 'playerDead' });
    } else if (e.type === 'kill') {
      if (audioHooks.kill) audioHooks.kill(e.target);
    } else if (e.type === 'pickup') {
      world.hudEvents.push({ type: 'toast', text: e.item === 'cash' ? 'Picked up the money.' : 'Picked up the ledger.' });
      if (audioHooks.pickup) audioHooks.pickup();
    } else if (e.type === 'heli') {
      world.hudEvents.push({ type: 'card', card: 'AIR SUPPORT INBOUND', time: 2.4 });
    } else if (e.type === 'briefing') {
      out.push({ type: 'briefing' });
    } else if (e.type === 'objective') {
      world.hudEvents.push({ type: 'toast', text: 'Objective: ' + e.text });
    }
  }
  world.events.length = 0;
  return out;
}

// Actions the input layer triggers directly (E to interact, F5 to save, weapon keys).
export function handleKeyAction(world, input, code) {
  const p = world.player;
  if (code === 'KeyR') {
    startReload(p);
    return true;
  }
  if (code === 'Digit1') return selectWeapon(p, 0), true;
  if (code === 'Digit2') return selectWeapon(p, 1), true;
  if (code === 'Digit3') return selectWeapon(p, 2), true;
  if (code === 'Digit4') return selectWeapon(p, 3), true;
  if (code === 'KeyE') {
    if (input) input.state.interact = true;
    return true;
  }
  return false;
}

// A save is a snapshot of this; see save.js for the writer.
export function worldSummary(world) {
  return {
    time: Math.round(world.time),
    money: world.player.money,
    heat: Math.round(world.police.heat),
    stars: world.police.stars,
    mission: world.missions.active ? world.missions.active.name : 'none',
    district: districtAt(world.player.x, world.player.y),
    cars: world.cars.length,
    peds: world.peds.length,
    cops: world.police.officers.length,
  };
}
