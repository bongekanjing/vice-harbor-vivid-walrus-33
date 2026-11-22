// Cars: physics with throttle, brake, steering, drift and handbrake, damage and explosion, theft (a lock break
// that takes a moment), horns, the siren on police cars, and the list of everything drivable in the city.

import { CAR_MODELS, POLICE_MODEL, modelById, CAR_PAINTS, TILE, T } from './config.js';
import { clamp, approach, lerp, angleDiff, slideCircle, carFootprintClear, circleClear, dist } from './geom.js';

let nextCarId = 1;

export function makeCar(modelId, x, y, angle, opts = {}) {
  const model = modelById(modelId);
  return {
    id: nextCarId++,
    model,
    x,
    y,
    angle,
    speed: 0,
    vx: 0,
    vy: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    hp: model.hp,
    maxHp: model.hp,
    damage: 0,
    paint: opts.paint ?? CAR_PAINTS[(nextCarId * 3) % CAR_PAINTS.length],
    police: !!opts.police,
    siren: !!opts.police,
    driver: opts.driver ?? null,
    dead: false,
    burning: 0,
    killed: false,
    stolen: false,
    locked: opts.locked ?? true,
    lockProgress: 0,
    offerEnter: false,
    horn: 0,
    ai: opts.ai ?? null,
    edge: opts.edge ?? -1,
    tOnEdge: opts.t ?? 0,
    wanted: 0,
  };
}

// Total kinetic damage a hit deals, from the closing speed and the difference in mass.
export function impactDamage(speed) {
  const s = Math.abs(speed);
  return s < 45 ? 0 : (s - 45) * 0.22;
}

// One physics step. Input is 0..1 throttle, 0..1 brake, -1..1 steer, and a handbrake flag.
export function stepCar(car, tiles, input, dt, hooks) {
  if (car.dead) {
    car.speed = approach(car.speed, 0, 900 * dt);
    return;
  }
  car.throttle = input.throttle ?? 0;
  car.brake = input.brake ?? 0;
  car.handbrake = !!input.handbrake;
  const m = car.model;

  // Steering eases in and out, and bites harder at low speed.
  const steerTarget = (input.steer ?? 0) * clamp(Math.abs(car.speed) / 90, 0.2, 1);
  car.steer = lerp(car.steer, steerTarget, 1 - Math.exp(-9 * dt));

  const topSpeed = m.maxSpeed * (car.handbrake ? 0.6 : 1);
  if (car.throttle > 0) car.speed += m.accel * car.throttle * dt;
  if (car.brake > 0) car.speed -= m.accel * 1.5 * car.brake * dt;
  if (car.throttle === 0 && car.brake === 0) car.speed = approach(car.speed, 0, m.accel * 0.32 * dt);
  if (car.handbrake) car.speed = approach(car.speed, 0, 320 * dt);

  // Off-road drag: pavement and grass are slow, walls are solid.
  const onRoad = tileKindAt(tiles, car.x, car.y);
  const grip = onRoad === T.ROAD ? m.grip : m.grip * 0.72;
  if (onRoad !== T.ROAD) car.speed = approach(car.speed, 0, 90 * dt);

  car.speed = clamp(car.speed, -m.maxSpeed * 0.42, topSpeed);
  const driftAmount = car.handbrake ? 0.55 : clamp(Math.abs(car.speed) / m.maxSpeed, 0, 1) * 0.22;
  const turn = car.steer * m.turn * (1 - driftAmount * 0.4) * (car.speed >= 0 ? 1 : -1);
  car.angle += turn * clamp(Math.abs(car.speed) / 60, 0, 2.4) * dt;

  // Velocity chases the nose direction; grip decides how fast it gets there (low grip = drift).
  const desiredX = Math.cos(car.angle) * car.speed;
  const desiredY = Math.sin(car.angle) * car.speed;
  const k = 1 - Math.exp(-grip * dt);
  car.vx = lerp(car.vx, desiredX, k);
  car.vy = lerp(car.vy, desiredY, k);

  const nextX = car.x + car.vx * dt;
  const nextY = car.y + car.vy * dt;
  const hl = m.len * 0.42;
  const hw = m.wid * 0.42;

  // Try the full move; failing that, test each axis so a glancing hit slides instead of stopping dead.
  if (carFootprintClear(tiles, nextX, nextY, car.angle, hl, hw)) {
    car.x = nextX;
    car.y = nextY;
  } else if (carFootprintClear(tiles, nextX, car.y, car.angle, hl, hw)) {
    car.x = nextX;
    car.vy *= -0.25;
    car.vx *= 0.7;
    car.speed *= 0.72;
    if (hooks && hooks.onCrash) hooks.onCrash(car, Math.abs(car.speed), 'scrape');
  } else if (carFootprintClear(tiles, car.x, nextY, car.angle, hl, hw)) {
    car.y = nextY;
    car.vx *= -0.25;
    car.vy *= 0.7;
    car.speed *= 0.72;
    if (hooks && hooks.onCrash) hooks.onCrash(car, Math.abs(car.speed), 'scrape');
  } else {
    const impact = Math.abs(car.speed);
    car.speed = -car.speed * 0.22;
    car.vx *= -0.22;
    car.vy *= -0.22;
    if (impact > 60) applyDamage(car, impactDamage(impact), hooks);
    if (hooks && hooks.onCrash) hooks.onCrash(car, impact, 'wall');
  }
  // Push the body out of any wall it ended up inside (a corner, a hit from behind).
  const fix = slideCircle(tiles, car.x, car.y, 0, 0, Math.min(hl, hw) * 0.9);
  car.x = fix.x;
  car.y = fix.y;

  if (car.horn > 0) car.horn = Math.max(0, car.horn - dt);
  if (car.lockProgress > 0 && !car.locked) car.lockProgress = 0;
}

function tileKindAt(tiles, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= 96 || ty >= 96) return T.WATER;
  return tiles[ty * 96 + tx];
}

// Damage, smoke, fire, and finally an explosion with shrapnel and a wreck.
export function applyDamage(car, amount, hooks) {
  if (car.dead || amount <= 0) return;
  car.hp -= amount;
  car.damage = clamp(1 - car.hp / car.maxHp, 0, 1);
  if (car.hp <= 0) {
    if (hooks && hooks.onExplode) hooks.onExplode(car);
    car.dead = true;
    car.burning = 0;
    car.speed = 0;
    car.vx = 0;
    car.vy = 0;
  }
}

// A collision between two cars: both take damage, both get shoved apart.
export function collideCars(a, b, hooks) {
  const d = dist(a.x, a.y, b.x, b.y);
  const reach = (a.model.len + b.model.len) * 0.34;
  if (d > reach || d < 0.001) return;
  const nx = (b.x - a.x) / d;
  const ny = (b.y - a.y) / d;
  const overlap = reach - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const closing = Math.abs(a.speed - b.speed) * 0.5 + Math.abs(a.speed) * 0.3;
  const dmg = impactDamage(closing);
  if (dmg > 0.5) {
    applyDamage(a, dmg * 0.7, hooks);
    applyDamage(b, dmg * 0.7, hooks);
    if (hooks && hooks.onCrash) hooks.onCrash(a, closing, 'car');
  }
  const bounce = 0.35;
  a.speed *= bounce;
  b.speed *= bounce;
  a.vx -= nx * 40;
  a.vy -= ny * 40;
  b.vx += nx * 40;
  b.vy += ny * 40;
}

// Press a stolen car: how far the lock break has got. Returns true on the frame it pops.
export function pickLock(car, dt, player) {
  if (!car.locked) return true;
  const skill = player.armour > 50 ? 1.5 : 1;
  car.lockProgress += dt * skill;
  if (car.lockProgress >= 0.85) {
    car.locked = false;
    car.lockProgress = 0;
    car.stolen = true;
    return true;
  }
  return false;
}

// Put the player in a car: his body goes with it and his on-foot state is parked.
export function enterCar(car, player) {
  player.inCar = car;
  player.x = car.x;
  player.y = car.y;
  car.driver = 'player';
  car.locked = false;
}

export function exitCar(car, player, tiles) {
  const side = car.angle + Math.PI / 2;
  let x = car.x + Math.cos(side) * (car.model.wid * 0.9);
  let y = car.y + Math.sin(side) * (car.model.wid * 0.9);
  if (!circleClear(tiles, x, y, player.radius)) {
    x = car.x - Math.cos(side) * (car.model.wid * 0.9);
    y = car.y - Math.sin(side) * (car.model.wid * 0.9);
  }
  if (!circleClear(tiles, x, y, player.radius)) {
    x = car.x - Math.cos(car.angle) * (car.model.len * 0.8);
    y = car.y - Math.sin(car.angle) * (car.model.len * 0.8);
  }
  player.x = x;
  player.y = y;
  player.inCar = null;
  car.driver = null;
  car.speed *= 0.3;
}

// The nearest car within reach that the player could get into, for the E prompt.
export function carToEnter(cars, player, reach = 62) {
  let best = null;
  let bestD = reach;
  for (const c of cars) {
    if (c.dead || c.police) continue;
    const d = dist(c.x, c.y, player.x, player.y) - c.model.len * 0.2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Traffic cars become "parked" when they have no driver: they sit, hazards blinking, until stolen.
export function parkCar(car) {
  car.driver = null;
  car.ai = null;
  car.speed = 0;
  car.vx = 0;
  car.vy = 0;
  car.locked = true;
}

// Repaint a car at a spray booth: clears damage and the paint job changes.
export function respray(car, rng) {
  car.hp = car.maxHp;
  car.damage = 0;
  car.paint = CAR_PAINTS[Math.floor(rng() * CAR_PAINTS.length)];
  car.stolen = false;
  car.wanted = 0;
}

export function newCarModelList() {
  return [...CAR_MODELS, POLICE_MODEL];
}
