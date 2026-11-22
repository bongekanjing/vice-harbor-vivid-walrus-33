// Builds Vice Harbor: a deterministic 96x96 tile city of seven avenues, seven streets and a quay road,
// with a harbour, piers, cranes, a park, building lots with real heights, and spawn tables for traffic and pedestrians.

import {
  MAP_W,
  MAP_H,
  TILE,
  ROADS_X,
  ROADS_Y,
  QUAY_X,
  WATER_X,
  WATER_Y,
  T,
  LANE,
  CAR_MODELS,
  PED_COLOURS,
  DISTRICTS,
} from './config.js';
import { makeRng, clamp } from './geom.js';

const EMPTY = 255;
const idx = (tx, ty) => ty * MAP_W + tx;
const px = (t) => t * TILE + TILE / 2;

// Building tones: warehouse brick, hotel stone, glass tower, cheap render, painted timber.
const BUILDING_TONES = ['#40323c', '#4a3a3a', '#37334a', '#443b3a', '#3d3f4a', '#4b4033', '#38323f'];

export function buildCity(seed = 20261122) {
  const rng = makeRng(seed);
  const grid = new Uint8Array(MAP_W * MAP_H).fill(EMPTY);

  carveWater(grid);
  carveRoads(grid);
  carvePavements(grid);
  carveParkAndPlaza(grid, rng);
  const buildings = placeBuildings(grid, rng);
  const cranes = placeCranes();
  carvePiers(grid, cranes);

  const nodes = buildNodes();
  const edges = buildEdges(nodes);
  const carSpawns = buildCarSpawns(edges, rng);
  const pedSpawns = buildPedSpawns(grid, rng);
  const props = placeProps(grid, rng);
  const missionSpots = pickMissionSpots(grid, buildings);

  return {
    seed,
    tiles: grid,
    buildings,
    cranes,
    nodes,
    edges,
    carSpawns,
    pedSpawns,
    props,
    missionSpots,
    width: MAP_W,
    height: MAP_H,
  };
}

// Everything east of the quay and south of the last street is harbour water.
function carveWater(grid) {
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (tx >= WATER_X || ty >= WATER_Y) grid[idx(tx, ty)] = T.WATER;
    }
  }
}

// Roads are three tiles wide on every avenue, street and on the quay; they all cross, so the graph is connected.
function carveRoads(grid) {
  for (const cx of ROADS_X) {
    for (let ty = 0; ty < WATER_Y; ty++) {
      for (let d = -1; d <= 1; d++) grid[idx(cx + d, ty)] = T.ROAD;
    }
  }
  for (let ty = 0; ty < WATER_Y; ty++) {
    for (let d = -1; d <= 1; d++) grid[idx(QUAY_X + d, ty)] = T.ROAD;
  }
  for (const cy of ROADS_Y) {
    for (let tx = 0; tx < WATER_X; tx++) {
      for (let d = -1; d <= 1; d++) grid[idx(tx, cy + d)] = T.ROAD;
    }
  }
}

// One ring of pavement around every road tile: the whole city is walkable along these.
function carvePavements(grid) {
  const out = [];
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (grid[idx(tx, ty)] !== EMPTY) continue;
      let touches = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (grid[idx(nx, ny)] === T.ROAD) touches = true;
      }
      if (touches) out.push(idx(tx, ty));
    }
  }
  for (const i of out) grid[i] = T.PAVEMENT;
}

// A green park with crossing paths, and a paved plaza where the market stalls go.
function carveParkAndPlaza(grid, rng) {
  for (let ty = 20; ty <= 28; ty++) {
    for (let tx = 20; tx <= 28; tx++) {
      grid[idx(tx, ty)] = T.GRASS;
    }
  }
  for (let tx = 20; tx <= 28; tx++) grid[idx(tx, 24)] = T.PLAZA;
  for (let ty = 20; ty <= 28; ty++) grid[idx(24, ty)] = T.PLAZA;
  for (let ty = 44; ty <= 52; ty++) {
    for (let tx = 56; tx <= 64; tx++) {
      if (rng.chance(0.06)) continue;
      grid[idx(tx, ty)] = T.PLAZA;
    }
  }
}

// Greedy lots: buildings fill their block edge to edge and may share party walls, so frontages read
// as solid city blocks while the pavement ring and the mid-block alley stay clear and walkable.
function placeBuildings(grid, rng) {
  const buildings = [];
  for (let ty = 1; ty < WATER_Y - 1; ty++) {
    for (let tx = 1; tx < WATER_X - 1; tx++) {
      const i = idx(tx, ty);
      if (grid[i] !== EMPTY) continue;
      const w = Math.min(rng.int(2, 6), runLength(grid, tx, ty, 1, 0));
      const h = Math.min(rng.int(2, 5), runLength(grid, tx, ty, 0, 1));
      if (w < 2 || h < 2) continue;
      if (!rectIsEmpty(grid, tx, ty, w, h)) continue;
      const district = districtAt(px(tx), px(ty));
      const tall = district === 'Vesper Heights' || district === 'Marlowe Quay' ? 1.35 : 1;
      const height = Math.round((rng.range(26, 96) * tall + (rng.chance(0.18) ? rng.range(60, 130) : 0)) / 2) * 2;
      const tone = rng.pick(BUILDING_TONES);
      for (let y = ty; y < ty + h; y++) {
        for (let x = tx; x < tx + w; x++) grid[idx(x, y)] = T.BUILDING;
      }
      buildings.push({
        tx,
        ty,
        w,
        h,
        x: tx * TILE,
        y: ty * TILE,
        wx: w * TILE,
        wy: h * TILE,
        height,
        tone,
        kind: height > 120 ? 'tower' : height > 62 ? 'block' : 'warehouse',
        lit: rng.range(0.15, 0.55),
        seed: rng.int(1, 9999),
        sign: rng.chance(0.22) ? rng.pick(['QUAY', 'SALT', 'ICE', 'FISH', 'HOTEL', 'BAR', 'DOCK 9', 'PAWN']) : null,
        signTone: rng.pick(['#ff5f8d', '#ffb46b', '#7fd3ff', '#ffe066']),
      });
    }
  }
  // Whatever lots are left over become courtyards and service alleys you can walk through.
  for (let i = 0; i < grid.length; i++) if (grid[i] === EMPTY) grid[i] = T.PAVEMENT;
  return buildings;
}

function rectIsEmpty(grid, tx, ty, w, h) {
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= WATER_Y) return false;
      if (grid[idx(x, y)] !== EMPTY) return false;
    }
  }
  // Buildings front straight onto the pavement ring; nothing may sit on a walkable tile.
  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= WATER_Y) continue;
      const id = grid[idx(x, y)];
      if (id === T.ROAD || id === T.PLAZA || id === T.GRASS || id === T.DOCK) return false;
    }
  }
  return true;
}

// How many empty tiles run from (tx,ty) along a direction, capped, for sizing a lot to its lane.
function runLength(grid, tx, ty, dx, dy) {
  let n = 0;
  while (n < 9) {
    const x = tx + dx * n;
    const y = ty + dy * n;
    if (x < 0 || y < 0 || x >= MAP_W || y >= WATER_Y) break;
    if (grid[idx(x, y)] !== EMPTY) break;
    n++;
  }
  return n;
}

// Four container cranes standing on the pier heads, where the harbour wall meets open water.
function placeCranes() {
  return [
    { x: 87 * TILE + 8, y: 22 * TILE, angle: -0.35, reach: 108 },
    { x: 87 * TILE + 8, y: 40 * TILE, angle: -0.2, reach: 96 },
    { x: 87 * TILE + 8, y: 58 * TILE, angle: -0.5, reach: 120 },
    { x: 87 * TILE + 8, y: 72 * TILE, angle: -0.15, reach: 92 },
  ];
}

function carvePiers(grid, cranes) {
  // The apron along the quay, and four finger piers reaching out into the harbour.
  for (let ty = 0; ty < WATER_Y; ty++) {
    grid[idx(WATER_X - 2, ty)] = T.DOCK;
    grid[idx(WATER_X - 1, ty)] = T.DOCK;
  }
  for (const band of [21, 39, 57, 71]) {
    for (let ty = band; ty <= band + 3; ty++) {
      for (let tx = WATER_X - 2; tx < MAP_W; tx++) grid[idx(tx, ty)] = T.DOCK;
    }
  }
  // Two spits out in the water, reachable only by boat but good silhouette.
  for (let ty = 91; ty <= 94; ty++) {
    for (let tx = 14; tx <= 21; tx++) grid[idx(tx, ty)] = ty === 91 ? T.GRASS : T.DOCK;
    for (let tx = 58; tx <= 66; tx++) grid[idx(tx, ty)] = ty === 91 ? T.GRASS : T.DOCK;
  }
  for (const c of cranes) c.pierBand = true;
}

// Nodes are the road crossings, in pixels; the quay road crossing every street is the last column.
function buildNodes() {
  const nodes = [];
  const xs = [...ROADS_X, QUAY_X];
  for (let yi = 0; yi < ROADS_Y.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      nodes.push({ x: px(xs[xi]), y: px(ROADS_Y[yi]), xi, yi });
    }
  }
  return nodes;
}

// Two one-way edges per road span, in opposite directions: traffic keeps right.
function buildEdges(nodes) {
  const edges = [];
  const at = (xi, yi) => nodes.find((n) => n.xi === xi && n.yi === yi);
  const add = (a, b) => {
    const horizontal = a.y === b.y;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = Math.cos(ang + Math.PI / 2) * LANE;
    const ny = Math.sin(ang + Math.PI / 2) * LANE;
    for (const dir of [1, -1]) {
      edges.push({
        id: edges.length,
        from: dir === 1 ? a : b,
        to: dir === 1 ? b : a,
        angle: dir === 1 ? ang : ang + Math.PI,
        len,
        offsetX: dir === 1 ? nx : -nx,
        offsetY: dir === 1 ? ny : -ny,
        horizontal,
      });
    }
  };
  for (let yi = 0; yi < ROADS_Y.length; yi++) {
    for (let xi = 0; xi < ROADS_X.length; xi++) {
      if (xi + 1 < ROADS_X.length) add(at(xi, yi), at(xi + 1, yi));
      add(at(ROADS_X.length, yi), at(xi, yi));
    }
  }
  for (let xi = 0; xi <= ROADS_X.length; xi++) {
    for (let yi = 0; yi + 1 < ROADS_Y.length; yi++) add(at(xi, yi), at(xi, yi + 1));
  }
  return edges;
}

// Where a civilian car may appear: on the lanes, facing the way the lane runs.
function buildCarSpawns(edges, rng) {
  const spawns = [];
  const weights = CAR_MODELS.flatMap((m) => Array(m.weight).fill(m.id));
  for (const e of edges) {
    if (!rng.chance(0.34)) continue;
    const t = rng.range(0.2, 0.8);
    spawns.push({
      x: e.from.x + (e.to.x - e.from.x) * t + e.offsetX,
      y: e.from.y + (e.to.y - e.from.y) * t + e.offsetY,
      angle: e.angle,
      model: rng.pick(weights),
      edge: e.id,
    });
  }
  return spawns;
}

// Pavement corners where people stand about, and long runs where they walk.
function buildPedSpawns(grid, rng) {
  const spots = [];
  for (let ty = 1; ty < WATER_Y - 1; ty++) {
    for (let tx = 1; tx < WATER_X - 1; tx++) {
      const id = grid[idx(tx, ty)];
      if (id !== T.PAVEMENT && id !== T.PLAZA && id !== T.DOCK) continue;
      if (!rng.chance(0.055)) continue;
      spots.push({
        x: px(tx) + rng.range(-10, 10),
        y: px(ty) + rng.range(-10, 10),
        angle: rng.range(-Math.PI, Math.PI),
        colour: rng.pick(PED_COLOURS),
      });
    }
  }
  return spots;
}

// Street furniture: lamps on the kerb, palms in the park, crates and drums on the docks, neon over doors.
function placeProps(grid, rng) {
  const lamps = [];
  const palms = [];
  const crates = [];
  const signs = [];
  for (let ty = 1; ty < WATER_Y - 1; ty++) {
    for (let tx = 1; tx < WATER_X - 1; tx++) {
      const id = grid[idx(tx, ty)];
      if (id === T.PAVEMENT && rng.chance(0.09)) lamps.push({ x: px(tx), y: px(ty) });
      if (id === T.GRASS && rng.chance(0.3)) palms.push({ x: px(tx), y: px(ty) });
      if (id === T.DOCK && rng.chance(0.14)) crates.push({ x: px(tx), y: px(ty), s: rng.range(8, 15), tone: rng.pick(['#8a5a3c', '#6f7f5c', '#9a6a45']) });
      if (id === T.PAVEMENT && rng.chance(0.02)) signs.push({ x: px(tx), y: px(ty), text: rng.pick(['BAR', 'DINER', 'MOTEL', 'PAWN', 'DOCKS']), tone: rng.pick(['#ff5f8d', '#ffb46b', '#7fd3ff']) });
    }
  }
  return { lamps, palms, crates, signs };
}

// Spots that missions and the story use, snapped onto real walkable ground: a pier head, the park, the plaza,
// a back alley off the market, the docks, the hotel front and a warehouse door.
function pickMissionSpots(grid, buildings) {
  const snap = (tx, ty) => {
    for (let r = 0; r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x < 1 || y < 1 || x >= WATER_X - 1 || y >= WATER_Y - 1) continue;
          const id = grid[y * MAP_W + x];
          if (id === T.PAVEMENT || id === T.PLAZA || id === T.DOCK || id === T.GRASS) {
            return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
          }
        }
      }
    }
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  };
  const at = (tx, ty, name) => ({ ...snap(tx, ty), name });
  return {
    pier: at(86, 40, 'Pier Nine'),
    park: at(24, 24, 'Vesper Green'),
    plaza: at(60, 48, 'Old Salt Market'),
    alley: at(34, 63, 'Cannery Lane'),
    docks: at(80, 20, 'Cormorant Docks'),
    hotel: at(60, 13, 'The Cormorant Hotel'),
    warehouse: nearestBuildingEdge(nearestTo(buildings, 50, 34)),
  };
}

function nearestTo(buildings, tx, ty) {
  let best = null;
  let bestD = Infinity;
  for (const b of buildings) {
    const d = Math.hypot(b.tx + b.w / 2 - tx, b.ty + b.h / 2 - ty);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

// A door on the south face of a building, stepped out onto the pavement in front of it.
function nearestBuildingEdge(b) {
  if (!b) return { x: 50 * TILE, y: 34 * TILE, name: 'Warehouse 9' };
  return { x: b.x + b.wx / 2, y: b.y + b.wy + TILE * 0.9, name: 'Warehouse 9' };
}

// Which neighbourhood a point belongs to, for the HUD's area line.
export function districtAt(x, y) {
  const tx = x / TILE;
  const ty = y / TILE;
  let hit = DISTRICTS[0];
  for (const d of DISTRICTS) {
    if (tx >= d.x0 && tx < d.x1 && ty >= d.y0 && ty < d.y1) return d.name;
  }
  return hit.name;
}

// A random pavement point near a tile window, used to seed pedestrians and loiterers.
export function randomPavementNear(city, x, y, radius, rng) {
  for (let tries = 0; tries < 40; tries++) {
    const tx = clamp(Math.floor(x / TILE) + Math.round(rng.range(-radius, radius)), 1, WATER_X - 2);
    const ty = clamp(Math.floor(y / TILE) + Math.round(rng.range(-radius, radius)), 1, WATER_Y - 2);
    const id = city.tiles[idx(tx, ty)];
    if (id === T.PAVEMENT || id === T.PLAZA || id === T.DOCK) return { x: px(tx), y: px(ty) };
  }
  return { x: px(24), y: px(24) };
}

// The nearest node to a point, so anything that wants to drive can join the road graph.
export function nearestNode(city, x, y) {
  let best = city.nodes[0];
  let bestD = Infinity;
  for (const n of city.nodes) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// The edge leaving a node that best continues the current heading: traffic turns at crossings, never U-turns.
export function nextEdgeFrom(city, node, heading, rng) {
  const options = city.edges.filter((e) => e.from === node);
  if (options.length === 0) return null;
  const straight = options.filter((e) => Math.abs(Math.abs(e.angle - heading) % (Math.PI * 2)) < 0.3);
  if (straight.length > 0 && rng.chance(0.72)) return rng.pick(straight);
  return rng.pick(options);
}

export { EMPTY as EMPTY_TILE };
