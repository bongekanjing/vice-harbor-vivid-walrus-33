// Bullets and effects: the projectile sweep that hits people, cars and walls, plus the particle/flash pool that
// every explosion, spark, blood spray and muzzle flash feeds, and the skid-mark trail the cars leave.

import { TILE } from './config.js';
import { dist, clamp, circleHitsBox, lineClear } from './geom.js';
import { applyDamage, impactDamage } from './vehicles.js';

// Step every bullet: a short segment test each frame so fast rounds never tunnel through a body.
export function stepBullets(world, dt) {
  const survivors = [];
  for (const b of world.bullets) {
    b.life -= dt;
    if (b.life <= 0) continue;
    const nx = b.x + Math.cos(b.angle) * b.speed * dt;
    const ny = b.y + Math.sin(b.angle) * b.speed * dt;
    const hit = bulletHit(world, b, nx, ny);
    if (hit) {
      spawnImpact(world, nx, ny, b.angle, hit.tone);
      if (hit.type === 'ped') hurtPedBullet(world, hit.target, b);
      else if (hit.type === 'cop') hurtCopBullet(world, hit.target, b);
      else if (hit.type === 'hostile') hurtHostileBullet(world, hit.target, b);
      else if (hit.type === 'car') {
        applyDamage(hit.target, b.dmg * 0.55, world.vehicleHooks);
        spawnImpact(world, nx, ny, b.angle + Math.PI, '#ffca6b');
      } else if (hit.type === 'wall') {
        spawnImpact(world, nx, ny, b.angle, '#cfc4b0');
      }
      continue;
    }
    b.x = nx;
    b.y = ny;
    survivors.push(b);
  }
  world.bullets = survivors;
}

// What the segment from the bullet to its next position touches, nearest thing first.
function bulletHit(world, b, nx, ny) {
  // Walls first: a shot into a building never reaches the street behind it.
  if (!lineClear(world.city.tiles, b.x, b.y, nx, ny)) return { type: 'wall', tone: '#cfc4b0' };
  const seg = { x0: b.x, y0: b.y, x1: nx, y1: ny };
  if (b.from !== 'player') {
    if (segmentHitsPoint(seg, world.player.x, world.player.y, 11)) return { type: 'player', tone: '#ff7a7a' };
  } else {
    for (const ped of world.peds) {
      if (ped.dead) continue;
      if (segmentHitsPoint(seg, ped.x, ped.y, 10)) return { type: 'ped', target: ped, tone: '#a01f2c' };
    }
    for (const cop of world.cops) {
      if (cop.dead) continue;
      if (segmentHitsPoint(seg, cop.x, cop.y, 11)) return { type: 'cop', target: cop, tone: '#a01f2c' };
    }
    for (const h of world.hostiles) {
      if (h.dead) continue;
      if (segmentHitsPoint(seg, h.x, h.y, 11)) return { type: 'hostile', target: h, tone: '#a01f2c' };
    }
  }
  for (const car of world.cars) {
    if (car.dead) continue;
    if (circleHitsBox(nx, ny, 7, car.x, car.y, car.angle, car.model.len * 0.5, car.model.wid * 0.5)) {
      return { type: 'car', target: car, tone: '#ffca6b' };
    }
  }
  return null;
}

// Point-to-segment distance, the honest way to test a fast bullet against a small body.
function segmentHitsPoint(seg, px, py, r) {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - seg.x0) * dx + (py - seg.y0) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = seg.x0 + dx * t;
  const cy = seg.y0 + dy * t;
  return dist(cx, cy, px, py) <= r;
}

function hurtPedBullet(world, ped, b) {
  ped.hp -= b.dmg;
  spawnBlood(world, b.x, b.y, b.angle);
  if (ped.hp <= 0) {
    ped.dead = true;
    world.deadPeds.push({ x: ped.x, y: ped.y, angle: ped.angle });
    world.events.push({ type: 'kill', target: 'ped' });
    for (const other of world.peds) {
      if (other !== ped && !other.dead && dist(other.x, other.y, ped.x, ped.y) < 260 && world.hooks.scare) {
        world.hooks.scare(other, ped.x, ped.y, 1.5);
      }
    }
  } else if (world.hooks.scare) {
    world.hooks.scare(ped, b.x, b.y, 1.2);
  }
}

function hurtCopBullet(world, cop, b) {
  cop.hp -= b.dmg;
  spawnBlood(world, b.x, b.y, b.angle);
  if (cop.hp <= 0) {
    cop.dead = true;
    world.events.push({ type: 'kill', target: 'cop' });
  }
}

function hurtHostileBullet(world, h, b) {
  h.hp -= b.dmg;
  spawnBlood(world, b.x, b.y, b.angle);
  if (h.hp <= 0) {
    h.dead = true;
    world.player.kills++;
    world.events.push({ type: 'kill', target: 'hostile' });
    world.pendingHeat = (world.pendingHeat ?? 0) + 4;
  }
}

// A spray of sparks and dust where a round lands, coloured by what it hit.
export function spawnImpact(world, x, y, angle, tone) {
  for (let i = 0; i < 4; i++) {
    world.particles.push({
      kind: 'spark',
      x,
      y,
      vx: Math.cos(angle + Math.PI + (world.rng() - 0.5) * 1.6) * (40 + world.rng() * 120),
      vy: Math.sin(angle + Math.PI + (world.rng() - 0.5) * 1.6) * (40 + world.rng() * 120),
      life: 0.16 + world.rng() * 0.16,
      maxLife: 0.32,
      r: 1,
      tone,
    });
  }
  world.particles.push({
    kind: 'smoke',
    x,
    y,
    vx: 0,
    vy: -8,
    life: 0.3,
    maxLife: 0.3,
    r: 3 + world.rng() * 3,
    tone: '#c8bfb0',
  });
}

export function spawnBlood(world, x, y, angle) {
  for (let i = 0; i < 6; i++) {
    world.particles.push({
      kind: 'blood',
      x,
      y,
      vx: Math.cos(angle + (world.rng() - 0.5) * 1.2) * (30 + world.rng() * 90),
      vy: Math.sin(angle + (world.rng() - 0.5) * 1.2) * (30 + world.rng() * 90),
      life: 0.5 + world.rng() * 0.4,
      maxLife: 0.9,
      r: 1.6 + world.rng() * 2,
      tone: '#5b1220',
    });
  }
}

// The full explosion: a ring, a flash, smoke, sparks, debris and a scorch mark.
export function spawnExplosion(world, x, y, scale = 1) {
  world.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5, r: 18 * scale, tone: '#ffd08a' });
  world.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.75, maxLife: 0.75, r: 10 * scale, tone: '#ff7a3a' });
  for (let i = 0; i < 26; i++) {
    const a = world.rng() * 6.283;
    const sp = 60 + world.rng() * 260;
    world.particles.push({
      kind: world.rng() < 0.4 ? 'debris' : 'spark',
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.5 + world.rng() * 0.8,
      maxLife: 1.3,
      r: 2,
      spin: world.rng() * 6.283,
      tone: world.rng() < 0.5 ? '#ffb347' : '#ff6a3d',
    });
  }
  for (let i = 0; i < 14; i++) {
    const a = world.rng() * 6.283;
    const sp = 20 + world.rng() * 80;
    world.particles.push({
      kind: 'smoke',
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 30,
      life: 1.2 + world.rng() * 1.4,
      maxLife: 2.6,
      r: 12 + world.rng() * 20,
      tone: '#4a4650',
    });
  }
  world.flashes.push({ x, y, angle: 0, life: 0.14, maxLife: 0.14, big: true });
  world.scorches.push({ x, y, r: 26 + world.rng() * 12 });
  if (world.scorches.length > 40) world.scorches.shift();
}

// Particles: the whole pool integrates here, in one pass, and dead ones are dropped.
export function stepParticles(world, dt) {
  const alive = [];
  for (const p of world.particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2.2 * dt;
    p.vy *= 1 - 2.2 * dt;
    if (p.kind === 'smoke') {
      p.vy -= 6 * dt;
      p.r += 8 * dt;
    }
    if (p.spin !== undefined) p.spin += dt * 7;
    alive.push(p);
  }
  world.particles = alive;
  const flashes = [];
  for (const f of world.flashes) {
    f.life -= dt;
    if (f.life > 0) flashes.push(f);
  }
  world.flashes = flashes;
}

// Cars lay short skid segments when the handbrake bites or the tyres are sliding.
export function laySkid(world, car, dt, sliding) {
  if (!sliding) return;
  const last = car.lastSkid;
  if (!last || dist(last.x, last.y, car.x, car.y) > 14) {
    if (last) {
      world.skids.push({ x0: last.x, y0: last.y, x1: car.x, y1: car.y });
      if (world.skids.length > 420) world.skids.shift();
    }
    car.lastSkid = { x: car.x, y: car.y };
  }
}

// Vehicle hooks: the renderer, police and audio all react through one small object set up in main.
export function makeVehicleHooks(world) {
  return {
    onCrash(car, speed, kind) {
      world.pendingShake = Math.max(world.pendingShake ?? 0, Math.min(14, speed * 0.055));
      if (speed > 70) {
        world.particles.push({ kind: 'ring', x: car.x, y: car.y, vx: 0, vy: 0, life: 0.3, maxLife: 0.3, r: 12, tone: '#ffcf9a' });
      }
      if (world.hooks.crashSound) world.hooks.crashSound(speed / 200, kind);
      if (kind === 'car' && car.driver === 'player') world.pendingHeat = (world.pendingHeat ?? 0) + 1;
    },
    onExplode(car) {
      spawnExplosion(world, car.x, car.y, 1);
      world.wrecks.push({ x: car.x, y: car.y, angle: car.angle, model: car.model });
      if (world.hooks.explosionSound) world.hooks.explosionSound();
      if (car.driver === 'player') {
        const p = world.player;
        p.inCar = null;
        p.hp = 0;
        p.dead = true;
        p.deathTimer = 0;
        world.events.push({ type: 'playerDead' });
      }
    },
  };
}
