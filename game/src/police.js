// The Marina Patrol: a wanted level of zero to five stars built from heat, cop cars that spawn out of sight and
// chase, officers who get out and shoot, roadblocks at three stars, a searchlight helicopter at four, and the
// arrest-or-escape logic that ends a chase.

import { STAR_HEAT, HEAT_DECAY, HEAT_DECAY_DELAY, COP_CALM, TRAFFIC } from './config.js';
import { clamp, dist, lerp, angleDiff, approachAngle, lineClear } from './geom.js';
import { makeCar, stepCar, applyDamage } from './vehicles.js';
import { nearestNode } from './city.js';
import { placeRoadblock } from './traffic.js';
import {
  spawnPointBehind,
} from './player.js';

// How many stars the current heat warrants.
export function wantedStarsFor(heat) {
  let stars = 0;
  for (let i = 1; i < STAR_HEAT.length; i++) if (heat >= STAR_HEAT[i]) stars = i;
  return stars;
}

// A body of patrol resources tied to one game session.
export function createPolice() {
  return {
    heat: 0,
    stars: 0,
    cool: 0,
    cars: [],
    officers: [],
    heli: null,
    blockCooldown: 0,
    spawnCooldown: 0,
    bustRisk: 0,
    lastCrime: 0,
    roadblocks: [],
    arrestTimer: 0,
  };
}

// Heat from a crime; the amount is what the act costs in "heat" points.
export function reportCrime(police, amount, world) {
  police.heat = clamp(police.heat + amount, 0, 100);
  police.cool = 0;
  police.lastCrime = world.time;
  const stars = wantedStarsFor(police.heat);
  if (stars > police.stars) {
    police.stars = stars;
    world.events.push({ type: 'wanted', stars });
  }
}

// The decay rule: no new crime for HEAT_DECAY_DELAY seconds and the heat bleeds away; at zero the stars clear.
export function stepWanted(police, world, dt) {
  police.cool += dt;
  const seen = copsWhoCanSee(police, world.player).length > 0;
  if (police.cool > HEAT_DECAY_DELAY && !seen) {
    police.heat = Math.max(0, police.heat - HEAT_DECAY * dt);
  }
  const stars = wantedStarsFor(police.heat);
  if (stars < police.stars) {
    police.stars = stars;
    world.events.push({ type: 'wanted', stars });
  }
  // Busting: with officers close and the player on foot, the risk meter fills; full means busted.
  const close = police.officers.filter((o) => !o.dead && dist(o.x, o.y, world.player.x, world.player.y) < 70).length;
  if (close > 0 && !world.player.inCar && police.heat > 6) {
    police.bustRisk = clamp(police.bustRisk + dt * 0.22 * close, 0, 1);
  } else {
    police.bustRisk = Math.max(0, police.bustRisk - dt * 0.35);
  }
  if (police.bustRisk >= 1) {
    world.events.push({ type: 'busted' });
    police.bustRisk = 0;
  }
}

// Officers with a clear line of sight to the player, used for heat decay and for shooting decisions.
export function copsWhoCanSee(police, player) {
  return police.officers.filter((o) => {
    if (o.dead) return false;
    if (dist(o.x, o.y, player.x, player.y) > 420) return false;
    return true;
  });
}

// Keep the patrol fleet right for the current star count: spawn on roads behind the player, despawn far ones.
export function stepPoliceFleet(police, world, dt) {
  const stars = police.stars;
  police.spawnCooldown -= dt;
  const wantCars = TRAFFIC.copCount[stars] ?? 0;
  const p = world.player;

  if (police.cars.length < wantCars && police.spawnCooldown <= 0) {
    police.spawnCooldown = 2.4;
    const spot = spawnPointBehind(world.city, p.x, p.y, world.rng, 480, 900);
    const car = makeCar('patrol', spot.x, spot.y, spot.angle, { police: true, locked: false, driver: 'ai' });
    const node = nearestNode(world.city, spot.x, spot.y);
    const edge = world.city.edges.find((e) => e.from === node) ?? world.city.edges[0];
    car.ai = { edge, t: 0, targetNode: edge.to, pursuit: true, siren: true, stuck: 0, reverse: 0 };
    police.cars.push(car);
  }
  // Too many: retire the ones furthest away.
  while (police.cars.length > wantCars) {
    let worst = 0;
    for (let i = 0; i < police.cars.length; i++) {
      if (dist(police.cars[i].x, police.cars[i].y, p.x, p.y) > dist(police.cars[worst].x, police.cars[worst].y, p.x, p.y)) worst = i;
    }
    const [gone] = police.cars.splice(worst, 1);
    for (const o of police.officers) if (o.carId === gone.id) o.dead = true;
  }

  // Roadblocks from three stars up, on the road ahead of the player.
  police.blockCooldown -= dt;
  if (stars >= 3 && police.blockCooldown <= 0) {
    police.blockCooldown = 16;
    const heading = world.player.inCar ? world.player.inCar.angle : world.player.aim;
    const ahead = nearestNode(world.city, p.x + Math.cos(heading) * 460, p.y + Math.sin(heading) * 460);
    const block = placeRoadblock(world.city, world.rng, ahead, Math.min(3, stars - 1));
    for (const car of block) {
      police.cars.push(car);
      police.roadblocks.push(car);
    }
  }

  // The helicopter at four stars and above.
  if (stars >= 4 && !police.heli) {
    police.heli = { x: p.x + 400, y: p.y - 320, active: true, beamAngle: Math.PI * 0.75, rotor: 0, spawnT: 0 };
    world.events.push({ type: 'heli' });
  }
  if (stars < 4 && police.heli) police.heli = null;
}

// Chase driving: head straight for the player when there is a clear line, otherwise follow the road graph.
export function stepPoliceCars(police, world, dt, hooks) {
  const p = world.player;
  for (const car of police.cars) {
    if (car.dead || car.roadblock) continue;
    const d = dist(car.x, car.y, p.x, p.y);
    const clear = lineClear(world.city.tiles, car.x, car.y, p.x, p.y);
    let steer = 0;
    let throttle = 0.85;
    let brake = 0;

    if (d < 420 && clear) {
      // Direct pursuit: point at the player and bury the throttle.
      const want = Math.atan2(p.y - car.y, p.x - car.x);
      const diff = angleDiff(want, car.angle);
      steer = clamp(diff * 1.9, -1, 1);
      throttle = d > 120 ? 1 : 0.55;
      if (Math.abs(diff) > 1.6 && Math.abs(car.speed) > 40) {
        brake = 1;
        throttle = 0;
      }
    } else if (car.ai) {
      // Graph pursuit: aim for the node nearest the player, along the lane.
      const ai = car.ai;
      ai.t += (car.speed * dt) / Math.max(1, ai.edge.len);
      if (ai.t >= 1) {
        const node = ai.edge.to;
        const options = world.city.edges.filter((e) => e.from === node);
        let best = options[0];
        let bestD = Infinity;
        for (const e of options) {
          const dd = dist(e.to.x, e.to.y, p.x, p.y);
          if (dd < bestD) {
            bestD = dd;
            best = e;
          }
        }
        ai.edge = best ?? ai.edge;
        ai.t = 0;
      }
      const tx = ai.edge.from.x + (ai.edge.to.x - ai.edge.from.x) * clamp(ai.t + 0.25, 0, 1) + ai.edge.offsetX;
      const ty = ai.edge.from.y + (ai.edge.to.y - ai.edge.from.y) * clamp(ai.t + 0.25, 0, 1) + ai.edge.offsetY;
      const want = Math.atan2(ty - car.y, tx - car.x);
      steer = clamp(angleDiff(want, car.angle) * 2, -1, 1);
    }
    const speedTarget = car.model.maxSpeed * (d < 200 ? 0.85 : 1.0);
    if (car.speed > speedTarget + 20) brake = 0.7;
    stepCar(car, world.city.tiles, { throttle, brake, steer, handbrake: false }, dt, hooks);

    // A cop car that gets stuck reverses and tries again.
    if (Math.abs(car.speed) < 6 && throttle > 0.5) {
      car.ai.stuck = (car.ai.stuck ?? 0) + dt;
      if (car.ai.stuck > 1.2) {
        car.speed = -90;
        car.angle += (world.rng() - 0.5) * 1.1;
        car.ai.stuck = 0;
      }
    }

    // Officers bail out when the car is close and slow; the car then sits as cover.
    if (d < 130 && Math.abs(car.speed) < 70 && police.officers.filter((o) => o.carId === car.id).length === 0) {
      deployOfficers(police, car, world);
    }
    car.siren = police.stars >= 1;
    car.wanted = police.stars;
  }
}

// Two officers out of each car, with pistols drawn, positioned on either flank.
export function deployOfficers(police, car, world) {
  const count = police.stars >= 3 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const side = i === 0 ? 1 : -1;
    const a = car.angle + Math.PI / 2 * side;
    police.officers.push({
      id: police.officers.length + 1,
      x: car.x + Math.cos(a) * 26,
      y: car.y + Math.sin(a) * 26,
      angle: car.angle,
      speed: 0,
      walkPhase: 0,
      dead: false,
      hp: 60,
      cooldown: 0.6 + i * 0.3,
      carId: car.id,
      state: 'engage',
      strafe: side,
      think: 0,
      burst: 0,
    });
  }
  car.occupied = true;
}

// Officer AI: close to pistol range, strafe, shoot in bursts, and hold fire when the player is not visible.
export function stepOfficers(police, world, dt, hooks) {
  const p = world.player;
  for (const o of police.officers) {
    if (o.dead) continue;
    o.cooldown = Math.max(0, o.cooldown - dt);
    o.think -= dt;
    o.burst = Math.max(0, o.burst - dt);
    const d = dist(o.x, o.y, p.x, p.y);
    const see = lineClear(world.city.tiles, o.x, o.y, p.x, p.y) && d < 520;
    const want = Math.atan2(p.y - o.y, p.x - o.x);
    o.angle = approachAngle(o.angle, want, 5 * dt);

    if (d > 90) {
      const speed = 120;
      o.x += Math.cos(o.angle) * speed * dt;
      o.y += Math.sin(o.angle) * speed * dt;
      o.walkPhase += dt * 9;
    } else if (d < 55) {
      o.x -= Math.cos(o.angle) * 60 * dt;
      o.y -= Math.sin(o.angle) * 60 * dt;
      o.walkPhase += dt * 7;
    } else {
      // Strafe sideways so a firefight is never static.
      const s = o.angle + Math.PI / 2 * o.strafe;
      o.x += Math.cos(s) * 46 * dt;
      o.y += Math.sin(s) * 46 * dt;
      o.walkPhase += dt * 6;
      if (o.think <= 0) {
        o.strafe *= -1;
        o.think = 1.4 + world.rng() * 1.4;
      }
    }
    // Do not walk through walls: nudge back onto clear ground.
    if (!lineClear(world.city.tiles, o.x, o.y, o.x, o.y)) {
      o.x += (world.rng() - 0.5) * 8;
      o.y += (world.rng() - 0.5) * 8;
    }

    if (see && o.cooldown <= 0 && police.heat > 4) {
      const spread = (world.rng() - 0.5) * 0.16;
      const a = want + spread;
      world.bullets.push({
        x: o.x + Math.cos(a) * 14,
        y: o.y + Math.sin(a) * 14,
        angle: a,
        speed: 980,
        dmg: 9,
        life: 0.6,
        from: 'cop',
        tone: '#ff9a6b',
        trail: [],
      });
      world.flashes.push({ x: o.x + Math.cos(a) * 16, y: o.y + Math.sin(a) * 16, angle: a, life: 0.05, maxLife: 0.05 });
      o.cooldown = 0.5 + world.rng() * 0.55;
      if (hooks && hooks.onCopShot) hooks.onCopShot(o);
    }
  }
  // Drop officers that have fallen far behind and are no longer in the fight.
  for (const o of police.officers) {
    if (o.dead) continue;
    if (dist(o.x, o.y, p.x, p.y) > 1400) o.dead = true;
  }
}

// The helicopter drifts toward the player, its searchlight sweeping a cone over the streets ahead of him.
export function stepHeli(police, world, dt) {
  const h = police.heli;
  if (!h) return;
  const p = world.player;
  const wantX = p.x + Math.cos(world.time * 0.2) * 120;
  const wantY = p.y - 210;
  h.x = lerp(h.x, wantX, 1 - Math.exp(-1.1 * dt));
  h.y = lerp(h.y, wantY, 1 - Math.exp(-1.1 * dt));
  h.beamAngle = Math.atan2(p.y - h.y, p.x - h.x) + Math.sin(world.time * 0.7) * 0.5;
  h.rotor = (h.rotor + dt * 30) % (Math.PI * 2);
  // The beam catches the player: it keeps the heat from cooling and can call in more cars.
  const inBeam = dist(h.x + Math.cos(h.beamAngle) * 180, h.y + 70 + Math.sin(h.beamAngle) * 110, p.x, p.y) < 90;
  if (inBeam) police.cool = Math.min(police.cool, 1.2);
}

// On arrest: cash lost, weapons kept, heat cleared, player dumped at the quay.
export function releaseFromCustody(world, spawn) {
  const police = world.police;
  police.heat = 0;
  police.stars = 0;
  police.bustRisk = 0;
  for (const o of police.officers) o.dead = true;
  police.officers.length = 0;
  police.cars.length = 0;
  police.heli = null;
  world.player.money = Math.max(0, world.player.money - 250);
}

// Does the player have any heat at all? Used by the HUD's star readout and the radio's news sting.
export function isWanted(police) {
  return wantedStarsFor(police.heat) > 0;
}
