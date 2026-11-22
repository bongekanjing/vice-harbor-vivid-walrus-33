// Small geometry and maths helpers: clamping, lerp, angles, circles and boxes against the tile grid, and a tile ray-cast for line of sight.

import { TILE, MAP_W, MAP_H, T, tileIsSolid } from './config.js';

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return b === a ? 0 : (v - a) / (b - a);
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function within(ax, ay, bx, by, r) {
  return dist2(ax, ay, bx, by) <= r * r;
}

// Shortest signed difference a - b, wrapped into -PI..PI.
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(cur, target, step) {
  const d = angleDiff(target, cur);
  if (Math.abs(d) <= step) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * step);
}

export function wrapAngle(a) {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

export function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  return Math.max(cur - step, target);
}

export function moveToward(cur, target, rate, dt) {
  return approach(cur, target, rate * dt);
}

// Deterministic randomness: the same seed always replays the same city.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  next.pick = (list) => list[Math.min(list.length - 1, Math.floor(next() * list.length))];
  next.chance = (p) => next() < p;
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}

// The tile id under a world point; outside the map counts as water.
export function tileAt(tiles, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.WATER;
  return tiles[ty * MAP_W + tx];
}

export function solidAtPoint(tiles, x, y) {
  return tileIsSolid(tileAt(tiles, x, y));
}

// Whether a circle at (x,y) with radius r clears every solid tile. Cheap: samples the box the circle covers.
export function circleClear(tiles, x, y, r) {
  const x0 = Math.floor((x - r) / TILE);
  const x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE);
  const y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      let id = T.WATER;
      if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H) id = tiles[ty * MAP_W + tx];
      if (!tileIsSolid(id)) continue;
      const nx = clamp(x, tx * TILE, tx * TILE + TILE);
      const ny = clamp(y, ty * TILE, ty * TILE + TILE);
      if (dist2(x, y, nx, ny) < r * r) return false;
    }
  }
  return true;
}

// Slides a circle out of the tiles along the smallest push, so walkers brush walls instead of sticking.
export function resolveCircle(tiles, x, y, r) {
  const x0 = Math.floor((x - r) / TILE);
  const x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE);
  const y1 = Math.floor((y + r) / TILE);
  let px = x;
  let py = y;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      let id = T.WATER;
      if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H) id = tiles[ty * MAP_W + tx];
      if (!tileIsSolid(id)) continue;
      const bx = tx * TILE;
      const by = ty * TILE;
      const nx = clamp(px, bx, bx + TILE);
      const ny = clamp(py, by, by + TILE);
      const dx = px - nx;
      const dy = py - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        px = nx + (dx / d) * r;
        py = ny + (dy / d) * r;
      } else {
        // Centre inside the tile: push out through the nearest face.
        const left = px - bx;
        const right = bx + TILE - px;
        const up = py - by;
        const down = by + TILE - py;
        const m = Math.min(left, right, up, down);
        if (m === left) px = bx - r;
        else if (m === right) px = bx + TILE + r;
        else if (m === up) py = by - r;
        else py = by + TILE + r;
      }
    }
  }
  return { x: px, y: py };
}

// Moves a circle by (dx,dy), resolving tile collisions, returning the new point.
export function slideCircle(tiles, x, y, dx, dy, r) {
  let p = resolveCircle(tiles, x + dx, y, r);
  p = resolveCircle(tiles, p.x, p.y + dy, r);
  return p;
}

// Whether a car's four corners are all on drivable ground (roads, docks, plaza, pavement is allowed but slow).
export function carFootprintClear(tiles, x, y, angle, halfLen, halfWid) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corners = [
    [halfLen, halfWid],
    [halfLen, -halfWid],
    [-halfLen, halfWid],
    [-halfLen, -halfWid],
  ];
  for (const [fx, fy] of corners) {
    const px = x + c * fx - s * fy;
    const py = y + s * fx + c * fy;
    if (solidAtPoint(tiles, px, py)) return false;
  }
  return true;
}

// A coarse ray-cast over the tile grid: true when nothing solid sits between the two points.
// Walks in steps of half a tile; good enough for cop line of sight and mission checks.
export function lineClear(tiles, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return true;
  const step = TILE * 0.45;
  const n = Math.ceil(len / step);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solidAtPoint(tiles, ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}

// The distance a ray travels before it hits a solid tile, capped at maxLen.
export function rayCast(tiles, ax, ay, angle, maxLen) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const step = TILE * 0.4;
  for (let d = step; d < maxLen; d += step) {
    if (solidAtPoint(tiles, ax + c * d, ay + s * d)) return d;
  }
  return maxLen;
}

// A cheap bounding-box test used for bullets against cars and pedestrians.
export function circleHitsBox(px, py, r, cx, cy, angle, halfLen, halfWid) {
  const dx = px - cx;
  const dy = py - cy;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const nx = clamp(lx, -halfLen, halfLen);
  const ny = clamp(ly, -halfWid, halfWid);
  return dist2(lx, ly, nx, ny) <= r * r;
}

// Hex shade helper: lighten (amt>0) or darken a #rrggbb colour by a fraction.
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function pointInRect(x, y, r) {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

// A stable pseudo-random number for a pair of integers: texture, window lights and water shimmer use it so
// the city looks detailed but never changes between runs.
export function hash2(a, b) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}

export function noise1(n) {
  return hash2(n, n * 7 + 13);
}
