// Civilian traffic: cars driven along the road graph, following their lane, braking for whatever is in front,
// turning at junctions only where a road exists, and reacting to sirens and gunfire by speeding up or bailing out.

import { TILE, TRAFFIC, modelById } from './config.js';
import { makeCar, stepCar, applyDamage } from './vehicles.js';
import { clamp, dist, angleDiff, carFootprintClear, lineClear } from './geom.js';
import { nearestNode, nextEdgeFrom } from './city.js';

// A car with a driver on a given edge: position along the edge, and the lane it holds.
export function spawnTrafficCar(city, rng, edgeId, t = 0.2, modelId = null) {
  const edge = city.edges[edgeId] ?? city.edges[0];
  const id = modelId ?? pickModel(city, rng);
  const x = edge.from.x + (edge.to.x - edge.from.x) * t + edge.offsetX;
  const y = edge.from.y + (edge.to.y - edge.from.y) * t + edge.offsetY;
  const car = makeCar(id, x, y, edge.angle, { locked: true, edge: edge.id, t, driver: 'ai' });
  car.ai = {
    edge,
    t,
    targetNode: edge.to,
    cruise: TRAFFIC.cruise * rng.range(0.8, 1.15),
    laneOffset: 0,
    panic: 0,
    stuck: 0,
    decisions: 0,
  };
  return car;
}

// Pick a model by the table's weights (cabs are common downtown, vans on the docks).
function pickModel(city, rng) {
  const models = city.carSpawns;
  if (models.length === 0) return 'brantley';
  return models[Math.floor(rng() * models.length)].model;
}

// Populate the whole city at boot.
export function seedTraffic(city, rng, count = TRAFFIC.cars) {
  const cars = [];
  const edges = city.edges;
  for (let i = 0; i < count; i++) {
    const edge = edges[Math.floor(rng() * edges.length)];
    const car = spawnTrafficCar(city, rng, edge.id, rng.range(0.1, 0.9));
    // Do not stack two cars on top of each other at boot.
    if (cars.some((c) => dist(c.x, c.y, car.x, car.y) < 70)) {
      i--;
      continue;
    }
    cars.push(car);
  }
  return cars;
}

// One AI step for one car: drive to the end of its edge, then choose the next edge at the junction.
export function stepTrafficCar(car, world, dt, hooks) {
  const ai = car.ai;
  if (!ai || car.dead) return;
  const tiles = world.city.tiles;
  ai.t += (car.speed * dt) / Math.max(1, ai.edge.len);

  if (ai.t >= 1) {
    const node = ai.edge.to;
    const next = nextEdgeFrom(world.city, node, ai.edge.angle, world.rng);
    if (next) {
      ai.edge = next;
      ai.t = 0;
      // A hard turn slows the car, as a driver actually would.
      const turn = Math.abs(angleDiff(next.angle, car.angle));
      car.speed *= clamp(1 - turn * 0.42, 0.3, 1);
      ai.decisions++;
    } else {
      ai.t = 0;
      car.angle += Math.PI;
      ai.edge = { ...ai.edge, angle: ai.edge.angle + Math.PI };
    }
  }

  // Steer back onto the lane: a pure-pursuit target a little ahead along the edge.
  const look = clamp(car.speed * 0.05, 26, 90);
  const targetT = clamp(ai.t + look / ai.edge.len, 0, 1);
  const tx = ai.edge.from.x + (ai.edge.to.x - ai.edge.from.x) * targetT + ai.edge.offsetX;
  const ty = ai.edge.from.y + (ai.edge.to.y - ai.edge.from.y) * targetT + ai.edge.offsetY;
  const want = Math.atan2(ty - car.y, tx - car.x);
  const diff = angleDiff(want, car.angle);
  const steer = clamp(diff * 2.2, -1, 1);

  // Speed: cruise, but brake for the car ahead, for a pedestrian on the road, and for a red-ish junction.
  let speedTarget = car.model.maxSpeed * ai.cruise * (1 + ai.panic * 0.6);
  if (Math.abs(diff) > 0.35) speedTarget *= 0.55;
  const ahead = world.cars.find((o) => o !== car && !o.dead && aheadOf(car, o) < 62);
  if (ahead) speedTarget = Math.min(speedTarget, Math.max(0, aheadOf(car, ahead) - 18) * 3.2);
  const pedAhead = world.peds.find((p) => !p.dead && aheadOf(car, p) < 46);
  if (pedAhead) speedTarget = Math.min(speedTarget, 26);

  const throttle = car.speed < speedTarget ? clamp((speedTarget - car.speed) / 90 + 0.25, 0, 1) : 0;
  const brake = car.speed > speedTarget + 12 ? clamp((car.speed - speedTarget) / 140, 0, 1) : 0;
  stepCar(car, tiles, { throttle, brake, steer, handbrake: false }, dt, hooks);

  // Stuck against a wall: reverse a little, then take the next junction turn.
  if (Math.abs(car.speed) < 5 && throttle > 0.4) {
    ai.stuck += dt;
    if (ai.stuck > 1.6) {
      ai.stuck = 0;
      car.speed = -70;
      car.angle += (world.rng() - 0.5) * 0.7;
    }
  } else {
    ai.stuck = 0;
  }
  if (ai.panic > 0) ai.panic = Math.max(0, ai.panic - dt * 0.18);
}

// How far in front of `car` another body is, measured along the car's nose; -1 when it is behind or aside.
function aheadOf(car, other) {
  const dx = other.x - car.x;
  const dy = other.y - car.y;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const along = dx * c + dy * s;
  const side = -dx * s + dy * c;
  if (along < 6 || Math.abs(side) > (car.model.wid * 0.5 + (other.model ? other.model.wid * 0.45 : 8))) return -1;
  return along;
}

// Gunfire near the road: civilians floor it and lean on the horn, or abandon the car entirely.
export function spookTraffic(world, x, y, radius = 300) {
  for (const car of world.cars) {
    if (!car.ai || car.dead) continue;
    if (dist(car.x, car.y, x, y) > radius) continue;
    car.ai.panic = Math.min(1.4, car.ai.panic + 0.7);
    car.horn = 1.2;
  }
}

// A police roadblock: cars parked nose-to-tail across a junction, cops standing behind them.
export function placeRoadblock(city, rng, node, count = 2) {
  const out = [];
  const base = Math.atan2(node.y - city.nodes[0].y, node.x - city.nodes[0].x) + Math.PI / 2;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 58;
    const x = node.x + Math.cos(base + Math.PI / 2) * off;
    const y = node.y + Math.sin(base + Math.PI / 2) * off;
    const car = makeCar('patrol', x, y, base + (rng() - 0.5) * 0.3, { police: true, locked: false, driver: null });
    car.roadblock = true;
    out.push(car);
  }
  return out;
}

// Traffic that has lost its driver (bailed out, or stolen then left) is recycled after a while.
export function recycleAbandoned(world, dt) {
  for (const car of world.cars) {
    if (car.dead || car.ai || car.driver === 'player') continue;
    if (!car.abandonedAt) car.abandonedAt = world.time;
    if (world.time - car.abandonedAt > 55 && dist(car.x, car.y, world.player.x, world.player.y) > 700) {
      car.recycle = true;
    }
  }
}
