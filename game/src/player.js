// Rey Calloway on foot and behind the wheel: movement with tile collision, aiming, shooting, melee, sprint stamina,
// health and armour, money, entering and leaving cars, wanted heat from his own actions, and death/respawn.

import { PLAYER, TILE, POLICE_MODEL, weaponById, WEAPONS, CAR_MODELS } from './config.js';
import { clamp, approach, lerp, dist, slideCircle, circleClear, rayCast, makeRng, angleDiff } from './geom.js';
import { stepCar, applyDamage, enterCar, exitCar, carToEnter } from './vehicles.js';

export function createPlayer(x, y) {
  return {
    x,
    y,
    angle: 0,
    aim: 0,
    speed: 0,
    radius: PLAYER.radius,
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    armour: PLAYER.armour,
    maxArmour: 100,
    money: PLAYER.money,
    weapon: 'pistol',
    ammo: { pistol: 48, smg: 0, shotgun: 0 },
    cooldown: 0,
    reload: 0,
    inCar: null,
    sprint: 100,
    walkPhase: 0,
    hitFlash: 0,
    footstepAccum: 0,
    colour: '#6d4a5e',
    kills: 0,
    lastDamageFrom: null,
    heat: 0,
    heatCool: 0,
    dead: false,
    deathTimer: 0,
    driveSkill: 1,
  };
}

// Where the player is really looking: the mouse aim on foot, the car's nose when driving.
export function playerAim(world) {
  const p = world.player;
  if (p.inCar) return p.inCar.angle;
  return p.aim;
}

// The aim angle from the player to the mouse in world space.
export function aimAtPointer(player, cameraTransform, mouse) {
  const w = cameraTransform.toWorld(mouse.x, mouse.y);
  return Math.atan2(w.y - player.y, w.x - player.x);
}

// On-foot step: movement keys, sprint stamina, collision, and the walk cycle for the renderer.
export function stepPlayerOnFoot(player, world, input, move, dt, hooks) {
  const p = player;
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt * 2.6);
  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) finishReload(p);
  }

  const wantSprint = input.anyDown('ShiftLeft', 'ShiftRight') && move.len > 0 && p.sprint > 8;
  const speed = wantSprint ? PLAYER.run : PLAYER.walk;
  p.sprint = clamp(p.sprint + (wantSprint ? -26 : 16) * dt, 0, 100);

  const vx = move.x * speed;
  const vy = move.y * speed;
  p.speed = lerp(p.speed, move.len > 0 ? speed : 0, 1 - Math.exp(-12 * dt));
  if (move.len > 0) {
    const want = Math.atan2(move.y, move.x);
    p.angle = want;
    const next = slideCircle(world.city.tiles, p.x, p.y, vx * dt, vy * dt, p.radius);
    p.x = next.x;
    p.y = next.y;
    p.walkPhase += p.speed * dt * 0.075;
    p.footstepAccum += p.speed * dt;
    if (p.footstepAccum > 34) {
      p.footstepAccum = 0;
      if (hooks && hooks.onFootstep) hooks.onFootstep(wantSprint);
    }
  }

  // Aiming: the mouse wins when it is over the canvas, otherwise keep the last aim.
  if (world.mouseAim !== null) p.aim = world.mouseAim;

  // Fire.
  if (input.state.mouseDown && p.cooldown <= 0 && p.reload <= 0) {
    fireWeapon(p, world, hooks);
  }

  // Melee when the weapon is the fist: a nearby pedestrian or cop takes it.
  if (p.weapon === 'fist' && input.state.mouseClicked) {
    meleeSwing(p, world, hooks);
  }
}

// Fire the current gun: spawn bullets, kick the camera, add heat if a cop or a civilian is in the way.
export function fireWeapon(p, world, hooks) {
  const w = weaponById(p.weapon);
  if (w.id === 'fist') {
    p.cooldown = w.rate;
    if (hooks && hooks.onPunch) hooks.onPunch();
    return;
  }
  const reserve = p.ammo[w.id] ?? 0;
  if (reserve <= 0) {
    if (hooks && hooks.onDryFire) hooks.onDryFire();
    p.cooldown = 0.3;
    return;
  }
  p.ammo[w.id] = reserve - 1;
  p.cooldown = w.rate;
  const muzzleX = p.x + Math.cos(p.aim) * 16;
  const muzzleY = p.y + Math.sin(p.aim) * 16;
  const rng = world.rng;
  for (let i = 0; i < w.pellets; i++) {
    const a = p.aim + (rng() - 0.5) * w.spread * 2;
    world.bullets.push({
      x: muzzleX,
      y: muzzleY,
      angle: a,
      speed: w.bulletSpeed,
      dmg: w.dmg,
      life: w.range / w.bulletSpeed,
      from: 'player',
      tone: '#ffd66b',
      trail: [],
    });
  }
  world.flashes.push({ x: muzzleX, y: muzzleY, angle: p.aim, life: 0.055, maxLife: 0.055 });
  if (hooks && hooks.onShot) hooks.onShot(w);
  if (hooks && hooks.onShake) hooks.onShake(p.inCar ? 2.5 : 1.6);
  // Shooting near civilians is what makes them scream and run.
  for (const ped of world.peds) {
    if (ped.dead) continue;
    if (dist(ped.x, ped.y, p.x, p.y) < 300) {
      if (hooks && hooks.onScare) hooks.onScare(ped, p.x, p.y, 1);
    }
  }
  if (w.id === 'shotgun' && hooks && hooks.onShotgun) hooks.onShotgun();
}

// A bare-knuckle swing at whatever is in front and close.
export function meleeSwing(p, world, hooks) {
  const reach = weaponById('fist').range;
  const targetAngle = p.aim;
  for (const ped of world.peds) {
    if (ped.dead) continue;
    const d = dist(ped.x, ped.y, p.x, p.y);
    if (d > reach) continue;
    if (Math.abs(angleDiff(Math.atan2(ped.y - p.y, ped.x - p.x), targetAngle)) > 1.0) continue;
    if (hooks && hooks.onMeleeHit) hooks.onMeleeHit(ped, 9);
    return;
  }
  for (const cop of world.cops) {
    if (cop.dead) continue;
    const d = dist(cop.x, cop.y, p.x, p.y);
    if (d > reach + 6) continue;
    if (Math.abs(angleDiff(Math.atan2(cop.y - p.y, cop.x - p.x), targetAngle)) > 1.0) continue;
    if (hooks && hooks.onMeleeHit) hooks.onMeleeHit(cop, 11);
    return;
  }
}

export function startReload(p) {
  const w = weaponById(p.weapon);
  if (w.id === 'fist' || p.reload > 0) return;
  if ((p.ammo[w.id] ?? 0) >= w.ammo) return;
  p.reload = w.id === 'shotgun' ? 1.5 : 1.1;
}

function finishReload(p) {
  const w = weaponById(p.weapon);
  if (w.id === 'fist') return;
  p.ammo[w.id] = w.ammo + (p.ammo[w.id] ?? 0);
}

// Switch guns with 1-4, keeping the last one he held.
export function selectWeapon(p, index) {
  const w = WEAPONS[index];
  if (!w) return;
  if (w.id !== 'fist' && (p.ammo[w.id] ?? 0) <= 0 && p.ammo[w.id] !== undefined) return;
  p.weapon = w.id;
  p.reload = 0;
  p.cooldown = 0.12;
}

// While driving: throttle, brake, steering, handbrake, and the horn on F.
export function stepPlayerDriving(p, world, input, dt, hooks) {
  const car = p.inCar;
  if (!car) return;
  const forward = (input.anyDown('KeyW', 'ArrowUp') ? 1 : 0) - (input.anyDown('KeyS', 'ArrowDown') ? 1 : 0);
  const steer = (input.anyDown('KeyD', 'ArrowRight') ? 1 : 0) - (input.anyDown('KeyA', 'ArrowLeft') ? 1 : 0);
  const throttle = Math.max(0, forward);
  const brake = Math.max(0, -forward) + (input.anyDown('KeyS', 'ArrowDown') && car.speed > 10 ? 1 : 0) * 0;
  const handbrake = input.anyDown('ShiftLeft', 'ShiftRight', 'Space');
  stepCar(car, world.city.tiles, { throttle, brake: Math.min(1, brake), steer, handbrake }, dt, hooks);
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  p.aim = car.angle;
  if (car.horn > 0 && hooks && hooks.onHorn) {
    car.horn = 0;
    hooks.onHorn();
  }
  // Engine sound follows the speed.
  if (hooks && hooks.onEngine) hooks.onEngine(car);
}

// Taking a hit: armour soaks first, then health. Returns true when he went down.
export function hurtPlayer(p, amount, fromX, fromY, hooks) {
  if (p.dead) return false;
  const soak = Math.min(p.armour, amount * 0.6);
  p.armour = Math.max(0, p.armour - soak);
  p.hp -= amount - soak;
  p.hitFlash = 0.8;
  p.lastDamageFrom = { x: fromX, y: fromY };
  if (hooks && hooks.onHurt) hooks.onHurt(amount);
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    p.deathTimer = 0;
    if (hooks && hooks.onDeath) hooks.onDeath();
    return true;
  }
  return false;
}

// Waking up at the quay after a bust or a shooting, with a hospital bill.
export function respawnPlayer(p, x, y, cost = 100) {
  p.dead = false;
  p.hp = p.maxHp;
  p.armour = 0;
  p.money = Math.max(0, p.money - cost);
  p.inCar = null;
  p.x = x;
  p.y = y;
  p.speed = 0;
  p.hitFlash = 0;
  p.cooldown = 0;
  p.reload = 0;
  p.heat = 0;
  p.deathTimer = 0;
}

// Getting in and out of cars: E, when close enough and the lock is broken (or the lock break is underway).
export function tryEnterExit(p, world, dt, hooks) {
  if (p.inCar) {
    const car = p.inCar;
    exitCar(car, p, world.city.tiles);
    if (hooks && hooks.onExitCar) hooks.onExitCar(car);
    return;
  }
  const near = carToEnter(world.cars, p, 70);
  if (near) {
    if (near.locked) {
      if (hooks && hooks.onLockBreak) hooks.onLockBreak(near);
      near.lockProgress += dt * 2;
      if (near.lockProgress >= 0.85) {
        near.locked = false;
        near.stolen = true;
        if (hooks && hooks.onSteal) hooks.onSteal(near);
      }
      return;
    }
    enterCar(near, p);
    if (near.ai) near.ai = null;
    if (hooks && hooks.onEnterCar) hooks.onEnterCar(near);
    return;
  }
  // At a mission marker, E talks to whoever is standing there.
  if (hooks && hooks.onInteract) hooks.onInteract();
}

// The nearest car the player could take, for the prompt and the E-key path.
export function carNearby(world, reach = 70) {
  return carToEnter(world.cars, world.player, reach);
}

// Heat from an action: shooting a gun in public, hitting a cop, stealing a car in front of one.
export function addHeat(p, amount) {
  p.heat = clamp(p.heat + amount, 0, 100);
  p.heatCool = 0;
}

// Police cars spawn on the road behind the player, out of sight, from the road graph.
export function spawnPointBehind(city, x, y, rng, minDist = 520, maxDist = 900) {
  const candidates = city.nodes.filter((n) => {
    const d = dist(n.x, n.y, x, y);
    return d > minDist && d < maxDist;
  });
  if (candidates.length === 0) return { x: x + 300, y: y + 300, angle: 0 };
  const n = candidates[Math.floor(rng() * candidates.length)];
  return { x: n.x + (rng() - 0.5) * 20, y: n.y + (rng() - 0.5) * 20, angle: rng() * Math.PI * 2 };
}
