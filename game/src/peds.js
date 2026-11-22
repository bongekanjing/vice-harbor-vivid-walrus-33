// Harbour regulars: pedestrian archetypes with names and lines, how each reacts to gunfire, and the little state
// machine that walks them along pavements, makes them gawk, and sends them running when shots start.

import { TILE } from './config.js';
import { angleDiff, approachAngle, dist, lerp, makeRng, resolveCircle } from './geom.js';

// Named people you can meet around Vice Harbor. `line` is what they say if you stop beside them.
export const ARCHETYPES = [
  { id: 'docker', name: 'Docker', coat: '#5c6f88', line: 'Shift ended two hours ago. Still smells of herring.', brave: 0.8, speed: 0.82, weight: 16 },
  { id: 'barkeep', name: 'Barkeep', coat: '#7a4a52', line: 'Harbour FM plays the same six songs. I love all six.', brave: 0.55, speed: 0.9, weight: 10 },
  { id: 'courier', name: 'Courier', coat: '#c9a04a', line: 'I got a crate with no address and a lot of tape. Not my problem.', brave: 0.5, speed: 1.22, weight: 12 },
  { id: 'tourist', name: 'Tourist', coat: '#4f8a8a', line: 'Is that the crane from the postcard? It is. Wow.', brave: 0.3, speed: 0.95, weight: 14 },
  { id: 'fisher', name: 'Night Fisher', coat: '#3f5a45', line: 'Nothing biting but the cold. Same as every night.', brave: 0.7, speed: 0.8, weight: 9 },
  { id: 'dealer', name: 'Card Dealer', coat: '#8a6fa8', line: 'Table opens at nine. Bring cash, not questions.', brave: 0.45, speed: 1.0, weight: 8 },
  { id: 'cop_off', name: 'Off-Duty Patrol', coat: '#33405c', line: 'I am off the clock. Do not make me come back on.', brave: 0.9, speed: 1.0, weight: 6 },
  { id: 'kid', name: 'Pier Kid', coat: '#b5566b', line: 'Mister, you got a dollar? I know a shortcut to Pier Nine.', brave: 0.35, speed: 1.3, weight: 10 },
];

// Things said when a civilian is panicking, by archetype id where it matters, otherwise generic.
const PANIC_LINES = [
  'Gun! Gun!',
  "He's got a piece!",
  'Not tonight, not tonight!',
  'Call the marina patrol!',
  'I did not see anything!',
];

const IDLE_LINES = [
  'Quiet night for the harbour.',
  'They say the Cormorants are back in town.',
  'Ferry is late again.',
  'You hear that helicopter?',
  'Two bucks for a coffee on the quay now.',
];

// Weighted pick of an archetype, deterministic from the caller's rng.
export function pickArchetype(rng) {
  const total = ARCHETYPES.reduce((n, a) => n + a.weight, 0);
  let r = rng() * total;
  for (const a of ARCHETYPES) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return ARCHETYPES[0];
}

export function makePed(x, y, rng, opts = {}) {
  const arch = opts.archetype ?? pickArchetype(rng);
  return {
    id: opts.id ?? Math.floor(rng() * 1e9),
    x,
    y,
    angle: opts.angle ?? rng() * Math.PI * 2,
    homeX: x,
    homeY: y,
    arch,
    name: arch.name,
    colour: opts.colour ?? arch.coat,
    skin: ['#d8a882', '#b8845c', '#8a5f42', '#e2c39c'][Math.floor(rng() * 4)],
    state: 'walk',
    stateTime: 0,
    walkPhase: rng() * 6.283,
    speed: 0,
    targetX: x,
    targetY: y,
    wantX: x,
    wantY: y,
    fleeing: false,
    fear: 0,
    dead: false,
    hp: 30,
    say: '',
    sayTime: 0,
    lineCooldown: rng() * 8,
    panicRng: rng,
    wanderRng: rng,
  };
}

// Sends a civilian running away from a threat point, with a scatter so they do not all take the same line.
export function scarePed(ped, fromX, fromY, strength = 1) {
  if (ped.dead) return;
  const away = Math.atan2(ped.y - fromY, ped.x - fromX) + (ped.panicRng() - 0.5) * 0.9;
  ped.fleeing = true;
  ped.state = 'flee';
  ped.stateTime = 0;
  ped.fear = Math.min(2, ped.fear + strength);
  ped.wantX = ped.x + Math.cos(away) * 220;
  ped.wantY = ped.y + Math.sin(away) * 220;
  if (ped.sayTime <= 0) {
    ped.say = PANIC_LINES[Math.floor(ped.panicRng() * PANIC_LINES.length)];
    ped.sayTime = 2.4;
  }
}

// Picks a new wander target a short walk away, staying on the pavement the ped is standing on.
export function chooseWander(ped, tiles, rng) {
  const a = rng() * Math.PI * 2;
  const r = 40 + rng() * 90;
  ped.wantX = ped.x + Math.cos(a) * r;
  ped.wantY = ped.y + Math.sin(a) * r;
  ped.state = 'walk';
  ped.stateTime = 0;
}

// Idle chatter: a line every handful of seconds while calm, used by the HUD's proximity bubble.
export function maybeSpeak(ped, dt, rng, nearPlayer) {
  ped.lineCooldown -= dt;
  if (ped.sayTime > 0) ped.sayTime -= dt;
  if (ped.lineCooldown > 0) return;
  ped.lineCooldown = 6 + rng() * 9;
  if (nearPlayer && !ped.fleeing) {
    ped.say = ped.arch.line;
    ped.sayTime = 3.2;
  } else if (!ped.fleeing && rng() < 0.3) {
    ped.say = IDLE_LINES[Math.floor(rng() * IDLE_LINES.length)];
    ped.sayTime = 2.6;
  }
}

// One step of walking: steer toward the want point, resolve tiles, and settle into a stop when arrived.
export function stepPed(ped, tiles, dt, world) {
  if (ped.dead) return;
  ped.stateTime += dt;
  const calmDown = ped.fleeing ? 0.16 : 0;
  if (calmDown > 0) ped.fear = Math.max(0, ped.fear - dt * calmDown);
  if (ped.fleeing && ped.fear <= 0 && ped.stateTime > 4) {
    ped.fleeing = false;
    ped.state = 'walk';
  }

  const dx = ped.wantX - ped.x;
  const dy = ped.wantY - ped.y;
  const d = Math.hypot(dx, dy);
  let speedTarget = 0;
  if (d > 6) {
    const want = Math.atan2(dy, dx);
    ped.angle = approachAngle(ped.angle, want, (ped.fleeing ? 9 : 4.4) * dt);
    speedTarget = ped.fleeing ? 168 * ped.arch.speed : 46 * ped.arch.speed;
    if (Math.abs(angleDiff(want, ped.angle)) > 1.1) speedTarget *= 0.35;
  } else if (ped.state !== 'idle' && !ped.fleeing) {
    ped.state = 'idle';
    ped.stateTime = 0;
    chooseWander(ped, tiles, ped.wanderRng);
  }
  ped.speed = lerp(ped.speed, speedTarget, 1 - Math.exp(-7 * dt));
  if (ped.speed > 1) {
    const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
    const p = resolveCircle(tiles, nx, ny, 6);
    if (Math.abs(p.x - nx) > 0.6 || Math.abs(p.y - ny) > 0.6) {
      // Blocked: sidestep along the wall instead of grinding into it.
      ped.angle += ped.fleeing ? 1.4 : 0.9;
    }
    ped.x = p.x;
    ped.y = p.y;
    ped.walkPhase += ped.speed * dt * 0.16;
  }

  // Shoved aside by moving traffic: a pedestrian on the road is really in danger.
  for (const car of world.cars) {
    if (car.dead || Math.abs(car.speed) < 30) continue;
    const dd = dist(car.x, car.y, ped.x, ped.y);
    if (dd < car.model.len * 0.7) {
      const push = Math.atan2(ped.y - car.y, ped.x - car.x);
      ped.x += Math.cos(push) * 6;
      ped.y += Math.sin(push) * 6;
      if (!ped.fleeing) scarePed(ped, car.x, car.y, 0.9);
    }
  }
}

// Damage a pedestrian; they drop and the crowd scatters.
export function hurtPed(ped, amount, world) {
  if (ped.dead) return;
  ped.hp -= amount;
  if (ped.hp <= 0) {
    ped.dead = true;
    ped.speed = 0;
    world.deadPeds.push({ x: ped.x, y: ped.y, angle: ped.angle });
    for (const other of world.peds) {
      if (other !== ped && !other.dead && dist(other.x, other.y, ped.x, ped.y) < 220) scarePed(other, ped.x, ped.y, 1.4);
    }
    return;
  }
  scarePed(ped, ped.x + 1, ped.y, 1.2);
}

// Populate a city's pavements with regulars, spread across the map.
export function seedPeds(city, rng, count) {
  const peds = [];
  const spots = city.pedSpawns;
  for (let i = 0; i < count && spots.length > 0; i++) {
    const s = spots[Math.floor(rng() * spots.length)];
    const p = makePed(s.x + rng.range(-14, 14), s.y + rng.range(-14, 14), rng, { angle: s.angle, colour: s.colour });
    chooseWander(p, city.tiles, rng);
    peds.push(p);
  }
  return peds;
}
