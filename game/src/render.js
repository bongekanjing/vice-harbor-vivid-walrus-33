// The world renderer: tiles, water shimmer, road markings, extruded buildings with lit windows, docks and
// cranes, then the entity sprites (cars, people, cops, the helicopter), muzzle flashes, tracers, explosions and
// the dusk light pass. Everything is drawn with canvas primitives; there are no image files.

import { TILE, T, MAP_W, WORLD_W, WORLD_H, PALETTE, STORY, LANE } from './config.js';
import { clamp, lerp, shade, rgba, hash2 } from './geom.js';
import { visibleBounds, cameraTransform } from './camera.js';
import { districtAt } from './city.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  return { canvas, ctx, time: 0, glow: null };
}

// A small pre-rendered radial glow, reused for lamps, headlights, neons and the searchlight: cheap and soft.
function glowSprite(r) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,210,1)');
  grad.addColorStop(0.35, 'rgba(255,214,150,0.5)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// One frame. `world` holds camera, city, player, cars, peds, cops, helicopter, effects and the missions overlay.
export function renderFrame(r, world, dt) {
  const { ctx, canvas } = r;
  r.time += dt;
  if (r.glow === null) r.glow = glowSprite();
  const cam = world.camera;
  const tf = cameraTransform(cam);
  const view = visibleBounds(cam);

  drawDuskSky(ctx, canvas);
  ctx.save();
  ctx.translate(tf.ox, tf.oy);
  ctx.scale(tf.z, tf.z);

  drawGround(r, world, view);
  drawRoadMarkings(r, world, view);
  drawWaterShimmer(r, world, view);
  drawLots(r, world, view);
  drawBuildingShadows(r, world, view);
  drawBuildingBodies(r, world, view);
  drawCranes(r, world, view);
  drawProps(r, world, view);

  drawSkidMarks(r, world);
  drawMissionMarkers(r, world);
  drawCars(r, world, view);
  drawCorpses(r, world);
  drawPeds(r, world);
  drawPlayer(r, world);
  drawPolice(r, world);
  drawHelicopter(r, world);
  drawBullets(r, world);
  drawSpeedStreaks(r, world, view);
  drawParticles(r, world);
  drawSelectionRings(r, world);

  ctx.restore();

  drawLightPass(r, world, view);
  drawScreenEffects(r, world);
}

// A dusk sky behind everything, so the map edge reads as a horizon rather than a bug.
function drawDuskSky(ctx, canvas) {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#1b1630');
  g.addColorStop(0.45, '#3a2a45');
  g.addColorStop(1, '#0d0c18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Which tiles are on screen: an index box, so a 96x96 city costs only what the camera sees.
function tileWindow(view) {
  return {
    x0: clamp(Math.floor(view.x0 / TILE), 0, MAP_W - 1),
    y0: clamp(Math.floor(view.y0 / TILE), 0, MAP_W - 1),
    x1: clamp(Math.ceil(view.x1 / TILE), 0, MAP_W),
    y1: clamp(Math.ceil(view.y1 / TILE), 0, MAP_W),
  };
}

function drawGround(r, world, view) {
  const { ctx } = r;
  const tiles = world.city.tiles;
  const w = tileWindow(view);

  // Everything past the map edge is harbour: flood the frame with water first so the world never floats in a void.
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

  // Asphalt and pavement first, batched by colour to keep the path count sane.
  for (const [id, fill] of [[T.ROAD, PALETTE.asphalt], [T.PAVEMENT, PALETTE.pavement], [T.DOCK, PALETTE.dock], [T.PLAZA, PALETTE.plaza], [T.GRASS, PALETTE.grass]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let ty = w.y0; ty < w.y1; ty++) {
      let run = -1;
      for (let tx = w.x0; tx <= w.x1; tx++) {
        const on = tx < w.x1 && tiles[ty * MAP_W + tx] === id;
        if (on && run < 0) run = tx;
        if (!on && run >= 0) {
          ctx.rect(run * TILE, ty * TILE, (tx - run) * TILE + 0.5, TILE + 0.5);
          run = -1;
        }
      }
    }
    ctx.fill();
  }

  // Grain and puddle-ish mottling on the asphalt, deterministic per tile.
  for (let ty = w.y0; ty < w.y1; ty++) {
    for (let tx = w.x0; tx < w.x1; tx++) {
      const id = tiles[ty * MAP_W + tx];
      if (id !== T.ROAD) continue;
      const n = hash2(tx, ty);
      if (n > 0.72) {
        ctx.fillStyle = n > 0.9 ? 'rgba(120,150,180,0.055)' : 'rgba(0,0,0,0.10)';
        ctx.fillRect(tx * TILE + (n * 21) % 14, ty * TILE + (n * 37) % 14, 12, 7);
      }
    }
  }
  // Kerb lines where pavement meets road.
  ctx.strokeStyle = PALETTE.kerb;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let ty = w.y0; ty < w.y1; ty++) {
    for (let tx = w.x0; tx < w.x1; tx++) {
      if (tiles[ty * MAP_W + tx] !== T.PAVEMENT) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (ty > 0 && tiles[(ty - 1) * MAP_W + tx] === T.ROAD) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + TILE, y);
      }
      if (ty < MAP_W - 1 && tiles[(ty + 1) * MAP_W + tx] === T.ROAD) {
        ctx.moveTo(x, y + TILE);
        ctx.lineTo(x + TILE, y + TILE);
      }
      if (tx > 0 && tiles[ty * MAP_W + tx - 1] === T.ROAD) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + TILE);
      }
      if (tx < MAP_W - 1 && tiles[ty * MAP_W + tx + 1] === T.ROAD) {
        ctx.moveTo(x + TILE, y);
        ctx.lineTo(x + TILE, y + TILE);
      }
    }
  }
  ctx.stroke();
}

// Dashed centre lines and the zebra bars at each crossing: the visual grammar that says "street".
function drawRoadMarkings(r, world, view) {
  const { ctx } = r;
  const tiles = world.city.tiles;
  const w = tileWindow({ x0: view.x0 - 60, y0: view.y0 - 60, x1: view.x1 + 60, y1: view.y1 + 60 });
  ctx.strokeStyle = rgba(PALETTE.roadLine, 0.55);
  ctx.lineWidth = 2.5;
  ctx.setLineDash([16, 18]);
  ctx.beginPath();
  for (let ty = w.y0; ty < w.y1; ty++) {
    for (let tx = w.x0; tx < w.x1; tx++) {
      if (tiles[ty * MAP_W + tx] !== T.ROAD) continue;
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      const isMidX = tiles[ty * MAP_W + tx - 1] === T.ROAD && tiles[ty * MAP_W + tx + 1] === T.ROAD;
      const isMidY = tiles[(ty - 1) * MAP_W + tx] === T.ROAD && tiles[(ty + 1) * MAP_W + tx] === T.ROAD;
      if (isMidX && !isMidY) {
        ctx.moveTo(cx, cy - TILE / 2);
        ctx.lineTo(cx, cy + TILE / 2);
      }
      if (isMidY && !isMidX) {
        ctx.moveTo(cx - TILE / 2, cy);
        ctx.lineTo(cx + TILE / 2, cy);
      }
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Crossing bars: a short ladder on the roadway just off each junction.
  ctx.fillStyle = 'rgba(228,220,200,0.16)';
  for (let ty = w.y0; ty < w.y1; ty++) {
    for (let tx = w.x0; tx < w.x1; tx++) {
      if (tiles[ty * MAP_W + tx] !== T.ROAD) continue;
      const up = ty > 0 && tiles[(ty - 1) * MAP_W + tx] !== T.ROAD;
      const left = tx > 0 && tiles[ty * MAP_W + tx - 1] !== T.ROAD;
      if (up) ctx.fillRect(tx * TILE + 3, ty * TILE + 2, TILE - 6, 5);
      if (left) ctx.fillRect(tx * TILE + 2, ty * TILE + 3, 5, TILE - 6);
    }
  }
}

// Slow vertical bands of light on the harbour, plus the pier reflections.
function drawWaterShimmer(r, world, view) {
  const { ctx } = r;
  const t = r.time;
  const w = tileWindow({ x0: view.x0 - TILE, y0: view.y0 - TILE, x1: view.x1 + TILE, y1: view.y1 + TILE });
  ctx.fillStyle = PALETTE.water;
  ctx.beginPath();
  for (let ty = w.y0; ty < w.y1; ty++) {
    let run = -1;
    for (let tx = w.x0; tx <= w.x1; tx++) {
      const on = tx < w.x1 && world.city.tiles[ty * MAP_W + tx] === T.WATER;
      if (on && run < 0) run = tx;
      if (!on && run >= 0) {
        ctx.rect(run * TILE, ty * TILE, (tx - run) * TILE + 0.5, TILE + 0.5);
        run = -1;
      }
    }
  }
  ctx.fill();

  // Shimmer: rows of soft highlights marching in from the west, with the sun's colour on them.
  for (let ty = w.y0; ty < w.y1; ty++) {
    for (let tx = w.x0; tx < w.x1; tx++) {
      if (world.city.tiles[ty * MAP_W + tx] !== T.WATER) continue;
      const n = hash2(tx * 7, ty * 13);
      const ph = (t * 0.42 + n * 6.28) % 6.28;
      const a = Math.max(0, Math.sin(ph)) * 0.5;
      if (a < 0.06) continue;
      ctx.fillStyle = `rgba(255,186,132,${a * 0.3})`;
      ctx.fillRect(tx * TILE + 2, ty * TILE + 6 + n * 16, TILE - 8, 2);
      ctx.fillStyle = `rgba(150,220,255,${a * 0.16})`;
      ctx.fillRect(tx * TILE + 6, ty * TILE + 18 + n * 8, TILE - 14, 1.5);
    }
  }
}

// Empty lots: the courtyards between buildings, with a fenced park and the plaza's posts so no district is bare.
function drawLots(r, world, view) {
  const { ctx } = r;
  const spots = world.city.missionSpots;
  if (spots.park.x > view.x0 - 260 && spots.park.x < view.x1 + 260) {
    ctx.strokeStyle = 'rgba(180,200,170,0.20)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(spots.park.x - 4.5 * TILE, spots.park.y - 4.5 * TILE, 9 * TILE, 9 * TILE);
    ctx.strokeStyle = 'rgba(150,120,90,0.25)';
    ctx.beginPath();
    ctx.moveTo(spots.park.x - 4.5 * TILE, spots.park.y);
    ctx.lineTo(spots.park.x + 4.5 * TILE, spots.park.y);
    ctx.moveTo(spots.park.x, spots.park.y - 4.5 * TILE);
    ctx.lineTo(spots.park.x, spots.park.y + 4.5 * TILE);
    ctx.stroke();
  }
  // Market stalls on the plaza: striped awnings on posts.
  if (spots.plaza.x > view.x0 - 340 && spots.plaza.x < view.x1 + 340) {
    for (let i = 0; i < 5; i++) {
      const sx = spots.plaza.x - 110 + i * 56;
      const sy = spots.plaza.y + ((i % 2) * 2 - 1) * 30;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(214,96,96,0.75)' : 'rgba(96,138,180,0.7)';
      ctx.fillRect(sx - 13, sy - 12, 26, 12);
      ctx.fillStyle = 'rgba(230,226,220,0.55)';
      ctx.fillRect(sx - 13, sy - 8, 26, 3);
      ctx.fillStyle = 'rgba(60,44,36,0.9)';
      ctx.fillRect(sx - 12, sy, 2, 8);
      ctx.fillRect(sx + 10, sy, 2, 8);
    }
  }
}

// Long dusk shadows cast west by every building: the single cheapest trick that sells height. Kept light so the
// streets stay legible; the depth comes from the roof offset, not from a black smear.
function drawBuildingShadows(r, world, view) {
  const { ctx } = r;
  const sun = { x: -0.55, y: 0.84 };
  ctx.fillStyle = 'rgba(12,8,22,0.17)';
  ctx.beginPath();
  for (const b of world.city.buildings) {
    if (b.x > view.x1 + 200 || b.x + b.wx < view.x0 - 200) continue;
    if (b.y > view.y1 + 200 || b.y + b.wy < view.y0 - 200) continue;
    const len = b.height * 0.85;
    const ox = sun.x * len;
    const oy = sun.y * len;
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + b.wx, b.y);
    ctx.lineTo(b.x + b.wx + ox, b.y + b.wy + oy);
    ctx.lineTo(b.x + ox, b.y + b.wy + oy);
    ctx.closePath();
  }
  ctx.fill();
}

// The buildings themselves: a base slab, a lit roof plate offset by height, and the west/south faces in between.
function drawBuildingBodies(r, world, view) {
  const { ctx } = r;
  const t = r.time;
  const sorted = world.city.buildings.filter(
    (b) => !(b.x > view.x1 + 240 || b.x + b.wx < view.x0 - 240 || b.y > view.y1 + 240 || b.y + b.wy < view.y0 - 240),
  );
  sorted.sort((a, b) => a.y + a.wy - (b.y + b.wy));

  for (const b of sorted) {
    // Height in screen space: a taller building's roof sits further "up" the screen (negative y).
    const lift = b.height * 0.34;
    const face = shade(b.tone, 0.06);
    const faceSide = shade(b.tone, -0.24);
    const roof = shade(b.tone, 0.34);

    // The two visible walls.
    ctx.fillStyle = faceSide;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - 0);
    ctx.lineTo(b.x, b.y + b.wy);
    ctx.lineTo(b.x, b.y + b.wy - lift);
    ctx.lineTo(b.x, b.y - lift);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.wy);
    ctx.lineTo(b.x + b.wx, b.y + b.wy);
    ctx.lineTo(b.x + b.wx, b.y + b.wy - lift);
    ctx.lineTo(b.x, b.y + b.wy - lift);
    ctx.closePath();
    ctx.fill();

    // Roof plate, inset a little so the parapet reads.
    ctx.fillStyle = roof;
    ctx.fillRect(b.x, b.y - lift, b.wx, b.wy);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y - lift + 1, b.wx - 2, b.wy - 2);

    // Lit windows on the roof plate: a grid of warm and cold dots, deterministic by seed.
    const cols = Math.max(1, Math.floor(b.wx / 16));
    const rows = Math.max(1, Math.floor(b.wy / 16));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const n = hash2(b.seed + x * 13, y * 7 + 3);
        if (n > b.lit + 0.34) continue;
        const warm = n > 0.3;
        const flick = Math.sin(t * 1.7 + n * 21) * 0.1 + 0.9;
        ctx.fillStyle = warm ? rgba('#ffc07a', 0.5 * flick) : rgba('#9adcff', 0.4 * flick);
        ctx.fillRect(b.x + 6 + x * (b.wx / cols), b.y - lift + 6 + y * (b.wy / rows), 5, 4);
      }
    }

    // Rooftop clutter: a water tank on warehouses, an aerial on towers.
    if (b.kind === 'warehouse' && b.wx > 70) {
      ctx.fillStyle = 'rgba(30,24,20,0.9)';
      ctx.fillRect(b.x + b.wx * 0.3, b.y - lift + b.wy * 0.3, 16, 14);
    } else if (b.kind === 'tower') {
      ctx.strokeStyle = 'rgba(200,190,220,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x + b.wx * 0.5, b.y - lift - 2);
      ctx.lineTo(b.x + b.wx * 0.5, b.y - lift - 22);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,90,90,0.75)';
      ctx.beginPath();
      ctx.arc(b.x + b.wx * 0.5, b.y - lift - 23, 2.2 + Math.sin(t * 3) * 0.8, 0, 6.283);
      ctx.fill();
    }

    // The neon over the door, on the south face so the camera reads it.
    if (b.sign) {
      const sw = Math.max(40, b.sign.length * 8);
      const sx = b.x + b.wx * 0.5;
      const sy = b.y + b.wy - lift * 0.62;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rgba(b.signTone, 0.16);
      ctx.fillRect(sx - sw / 2 - 3, sy - 9, sw + 6, 16);
      ctx.fillStyle = b.signTone;
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.sign, sx, sy + 3);
      ctx.restore();
    }
  }
}

// Four container cranes along the harbour wall: tall lattice booms with a load hanging.
function drawCranes(r, world, view) {
  const { ctx } = r;
  const t = r.time;
  for (const c of world.city.cranes) {
    if (c.x < view.x0 - 260 || c.x > view.x1 + 260 || c.y < view.y0 - 260 || c.y > view.y1 + 260) continue;
    const baseY = c.y;
    const topY = c.y - 150;
    ctx.strokeStyle = '#2b2b38';
    ctx.lineWidth = 5;
    // Legs.
    ctx.beginPath();
    ctx.moveTo(c.x - 18, baseY);
    ctx.lineTo(c.x - 8, topY);
    ctx.moveTo(c.x + 18, baseY);
    ctx.lineTo(c.x + 8, topY);
    ctx.stroke();
    // Lattice cross-braces.
    ctx.strokeStyle = 'rgba(90,90,110,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const y0 = baseY - i * 25;
      const y1 = baseY - (i + 1) * 25;
      ctx.moveTo(c.x - 16 + i * 1.6, y0);
      ctx.lineTo(c.x + 15 - i * 1.4, y1);
      ctx.moveTo(c.x + 16 - i * 1.6, y0);
      ctx.lineTo(c.x - 15 + i * 1.4, y1);
    }
    ctx.stroke();
    // Boom, swinging slowly.
    const swing = Math.sin(t * 0.28 + c.y * 0.01) * 0.12 + c.angle;
    ctx.save();
    ctx.translate(c.x, topY);
    ctx.rotate(swing);
    ctx.strokeStyle = '#3a3a4c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-30, 0);
    ctx.lineTo(c.reach, -10);
    ctx.stroke();
    ctx.fillStyle = '#c9a04a';
    ctx.fillRect(-8, -12, 20, 16);
    // The hanging container.
    const hangY = 60 + Math.sin(t * 0.6 + c.x) * 12;
    ctx.strokeStyle = 'rgba(20,20,28,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.reach - 20, -6);
    ctx.lineTo(c.reach - 20, hangY);
    ctx.stroke();
    ctx.fillStyle = '#8a4a3c';
    ctx.fillRect(c.reach - 44, hangY, 48, 22);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(c.reach - 44, hangY, 48, 22);
    ctx.restore();
    // A warning lamp on the mast.
    ctx.fillStyle = `rgba(255,80,80,${0.5 + Math.sin(t * 2.4 + c.y) * 0.4})`;
    ctx.beginPath();
    ctx.arc(c.x, topY - 6, 3, 0, 6.283);
    ctx.fill();
  }
}

// Street furniture: lamps with pools of light, palms, crates and market awnings.
function drawProps(r, world, view) {
  const { ctx } = r;
  const p = world.city.props;
  for (const l of p.lamps) {
    if (l.x < view.x0 - 40 || l.x > view.x1 + 40 || l.y < view.y0 - 40 || l.y > view.y1 + 40) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(l.x - 1, l.y - 2, 4, 12);
    ctx.fillStyle = 'rgba(255,206,150,0.85)';
    ctx.fillRect(l.x - 2.5, l.y - 6, 5, 5);
  }
  for (const pl of p.palms) {
    if (pl.x < view.x0 - 60 || pl.x > view.x1 + 60 || pl.y < view.y0 - 60 || pl.y > view.y1 + 60) continue;
    const sway = Math.sin(r.time * 0.9 + pl.x * 0.03) * 3;
    ctx.strokeStyle = '#4a3a2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y + 8);
    ctx.quadraticCurveTo(pl.x + sway * 0.5, pl.y - 14, pl.x + sway, pl.y - 30);
    ctx.stroke();
    ctx.strokeStyle = '#2f5a3c';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.283 + 0.4;
      ctx.beginPath();
      ctx.moveTo(pl.x + sway, pl.y - 30);
      ctx.quadraticCurveTo(pl.x + sway + Math.cos(a) * 12, pl.y - 36, pl.x + sway + Math.cos(a) * 20, pl.y - 30 + Math.sin(a) * 9);
      ctx.stroke();
    }
  }
  for (const c of p.crates) {
    if (c.x < view.x0 - 30 || c.x > view.x1 + 30 || c.y < view.y0 - 30 || c.y > view.y1 + 30) continue;
    ctx.fillStyle = c.tone;
    ctx.fillRect(c.x - c.s / 2, c.y - c.s / 2 - 4, c.s, c.s);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(c.x - c.s / 2, c.y - c.s / 2 - 4, c.s, c.s);
  }
  for (const s of p.signs) {
    if (s.x < view.x0 - 50 || s.x > view.x1 + 50 || s.y < view.y0 - 50 || s.y > view.y1 + 50) continue;
    ctx.fillStyle = rgba(s.tone, 0.14);
    ctx.fillRect(s.x - 18, s.y - 26, 36, 12);
    ctx.fillStyle = s.tone;
    ctx.font = 'bold 7px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(s.text, s.x, s.y - 17.5);
  }
}

// Tyre marks left by handbrake turns and hard drift.
function drawSkidMarks(r, world) {
  const { ctx } = r;
  ctx.strokeStyle = 'rgba(12,10,16,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const m of world.skids) {
    ctx.moveTo(m.x0, m.y0);
    ctx.lineTo(m.x1, m.y1);
  }
  ctx.stroke();
}

// The pulsing cylinder over a mission objective, and the arrow that points at it when it is off screen.
function drawMissionMarkers(r, world) {
  const { ctx } = r;
  const t = r.time;
  for (const m of world.markers) {
    const pulse = 0.55 + Math.sin(t * 3 + (m.phase ?? 0)) * 0.25;
    const g = ctx.createLinearGradient(m.x, m.y - 70, m.x, m.y + 10);
    g.addColorStop(0, rgba(m.tone, 0));
    g.addColorStop(0.55, rgba(m.tone, 0.20 * pulse));
    g.addColorStop(1, rgba(m.tone, 0.5 * pulse));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(m.x - 16, m.y);
    ctx.lineTo(m.x + 16, m.y);
    ctx.lineTo(m.x + 9, m.y - 70);
    ctx.lineTo(m.x - 9, m.y - 70);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(m.tone, 0.9 * pulse + 0.1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 18 + pulse * 3, 8 + pulse * 2, 0, 0, 6.283);
    ctx.stroke();
  }
}

// A car drawn from primitives: body, cabin, wheels, headlight cones, brake lights, the light bar on a police car.
function drawCarShape(ctx, car, t) {
  const m = car.model;
  const hl = m.len / 2;
  const hw = m.wid / 2;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(-2, 5, hl * 1.02, hw * 1.02, 0, 0, 6.283);
  ctx.fill();
  // Wheels.
  ctx.fillStyle = '#15131a';
  for (const sx of [-hl * 0.55, hl * 0.55]) {
    ctx.fillRect(sx - 7, -hw - 2, 14, 5);
    ctx.fillRect(sx - 7, hw - 3, 14, 5);
  }
  // Body.
  const paint = car.paint;
  const grad = ctx.createLinearGradient(0, -hw, 0, hw);
  grad.addColorStop(0, shade(paint, 0.24));
  grad.addColorStop(0.5, paint);
  grad.addColorStop(1, shade(paint, -0.3));
  ctx.fillStyle = grad;
  roundRect(ctx, -hl, -hw, hl * 2, hw * 2, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Cabin.
  ctx.fillStyle = car.police ? '#1a2434' : 'rgba(24,32,46,0.92)';
  roundRect(ctx, -hl * 0.22, -hw * 0.74, hl * 0.62, hw * 1.48, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,200,230,0.20)';
  roundRect(ctx, -hl * 0.12, -hw * 0.6, hl * 0.34, hw * 1.2, 3);
  ctx.fill();
  // Lights.
  ctx.fillStyle = '#fff0c8';
  ctx.fillRect(hl - 4, -hw + 3, 3.5, 5);
  ctx.fillRect(hl - 4, hw - 8, 3.5, 5);
  const braking = car.brake > 0 || car.speed < -6;
  ctx.fillStyle = braking ? '#ff5240' : 'rgba(150,50,40,0.75)';
  ctx.fillRect(-hl + 0.5, -hw + 3, 3, 5);
  ctx.fillRect(-hl + 0.5, hw - 8, 3, 5);
  if (car.police) {
    // The light bar sits across the roof, flashing red and blue, and always reads from any heading.
    const flash = Math.sin(t * 22) > 0;
    const barW = m.wid * 0.78;
    ctx.fillStyle = '#0b1220';
    roundRect(ctx, -7, -barW / 2, 14, barW, 2);
    ctx.fill();
    const glowA = 0.55 + Math.abs(Math.sin(t * 11)) * 0.45;
    ctx.fillStyle = flash ? '#ff3448' : '#5a0f1c';
    ctx.fillRect(-6, -barW / 2 + 1, 12, barW / 2 - 1.5);
    ctx.fillStyle = flash ? '#10245e' : '#2a52ff';
    ctx.globalAlpha = flash ? 0.55 : 1;
    ctx.fillRect(-6, 0.5, 12, barW / 2 - 1.5);
    ctx.globalAlpha = 1;
    // Halo around the bar so the lights read at a distance.
    const hg = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    hg.addColorStop(0, flash ? 'rgba(255,60,80,0.55)' : 'rgba(70,110,255,0.55)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg;
    ctx.globalAlpha = glowA;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
    // A white door panel with a badge stripe, so the body reads as a patrol car, not a red saloon.
    ctx.fillStyle = 'rgba(232,238,248,0.92)';
    ctx.fillRect(-hl * 0.3, -hw, hl * 0.52, 3.2);
    ctx.fillRect(-hl * 0.3, hw - 3.2, hl * 0.52, 3.2);
    ctx.fillStyle = 'rgba(60,120,220,0.85)';
    ctx.fillRect(-hl * 0.3, -hw + 3.2, hl * 0.52, 1.6);
    ctx.fillRect(-hl * 0.3, hw - 4.8, hl * 0.52, 1.6);
    // "MARINA PATROL" on the roof in tiny letters.
    ctx.save();
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(220,232,255,0.55)';
    ctx.font = 'bold 5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PATROL', 0, 2);
    ctx.restore();
  }
  // Damage: soot patches and a crumpled bonnet once the health is low.
  if (car.damage > 0.35) {
    ctx.fillStyle = `rgba(18,14,14,${clamp(car.damage, 0, 0.85)})`;
    ctx.beginPath();
    ctx.ellipse(hl * 0.4, 0, hl * 0.5, hw * 0.8, 0.3, 0, 6.283);
    ctx.fill();
  }
  ctx.restore();
}

// Speed streaks: at real pace the road smears past. Deterministic from the camera and time, so a posed frame is
// reproducible, and density follows the car's speed.
function drawSpeedStreaks(r, world, view) {
  const car = world.player.inCar;
  if (!car) return;
  const frac = clamp((Math.abs(car.speed) - 150) / 200, 0, 1);
  if (frac <= 0.02) return;
  const { ctx } = r;
  ctx.save();
  ctx.strokeStyle = `rgba(255,240,220,${0.16 * frac})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const n = hash2(i * 31, 7);
    const n2 = hash2(i * 17, 91);
    // Streaks radiate out from the car's direction of travel, long at the edges of the frame.
    const ang = car.angle + Math.PI + (n - 0.5) * 2.5;
    const rad = 130 + n2 * 620;
    const sx = car.x + Math.cos(ang) * rad;
    const sy = car.y + Math.sin(ang) * rad;
    const len = 34 + frac * 130 * (0.4 + n2);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
  }
  ctx.stroke();
  // A faint chromatic wash at the frame edge, like light dragging past the lens.
  const g = ctx.createRadialGradient(car.x, car.y, 120, car.x, car.y, 520);
  g.addColorStop(0, 'rgba(255,220,180,0)');
  g.addColorStop(1, `rgba(255,200,150,${0.10 * frac})`);
  ctx.fillStyle = g;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawCars(r, world, view) {
  const { ctx } = r;
  const t = r.time;
  const list = world.cars.filter((c) => c.x > view.x0 - 120 && c.x < view.x1 + 120 && c.y > view.y0 - 120 && c.y < view.y1 + 120 && !c.dead);
  list.sort((a, b) => a.y - b.y);
  for (const car of list) {
    // Headlight cones on the road ahead, drawn under the body.
    if (!car.police || car.siren) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      const g = ctx.createLinearGradient(car.model.len / 2, 0, car.model.len / 2 + 110, 0);
      g.addColorStop(0, 'rgba(255,235,190,0.22)');
      g.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(car.model.len / 2 - 2, -6);
      ctx.lineTo(car.model.len / 2 + 120, -44);
      ctx.lineTo(car.model.len / 2 + 120, 44);
      ctx.lineTo(car.model.len / 2 - 2, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    drawCarShape(ctx, car, t);
    if (car.police) {
      // Siren wash on the road around the car: a strong red/blue pool that pulses.
      const flash = Math.sin(t * 22) > 0;
      const rg = ctx.createRadialGradient(car.x, car.y, 4, car.x, car.y, 96);
      rg.addColorStop(0, flash ? 'rgba(255,50,70,0.42)' : 'rgba(50,90,255,0.42)');
      rg.addColorStop(0.55, flash ? 'rgba(255,40,60,0.14)' : 'rgba(40,80,255,0.14)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 96, 0, 6.283);
      ctx.fill();
    }
    // Fire on a burning wreck.
    if (car.burning) {
      for (let i = 0; i < 5; i++) {
        const a = t * 5 + i * 1.7;
        const rr = 6 + Math.sin(a) * 3;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,150,60,0.7)' : 'rgba(255,90,40,0.5)';
        ctx.beginPath();
        ctx.ellipse(car.x + Math.cos(a) * 10, car.y + Math.sin(a * 0.8) * 8 - 6, rr, rr * 1.3, 0, 0, 6.283);
        ctx.fill();
      }
    }
  }
}

// Wrecks that have already burned out stay on the road as charred shells.
function drawCorpses(r, world) {
  const { ctx } = r;
  for (const c of world.wrecks) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(24,20,22,0.92)';
    roundRect(ctx, -c.model.len / 2, -c.model.wid / 2, c.model.len, c.model.wid, 6);
    ctx.fill();
    ctx.restore();
  }
  for (const d of world.deadPeds) {
    ctx.fillStyle = 'rgba(60,20,26,0.7)';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, 12, 6, d.angle, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,150,150,0.35)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, 4, 0, 6.283);
    ctx.fill();
  }
}

// A person from above: a soft shadow, a coat, a head, and a facing tick. Drawn a size and a half up so they read
// clearly at the play zoom and still look like people, not dots.
function drawPerson(ctx, p, colour, skin, opts = {}) {
  const s = (opts.scale ?? 1) * 1.45;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(2, 3, 9 * s, 6.5 * s, 0, 0, 6.283);
  ctx.fill();
  ctx.rotate(p.angle ?? 0);
  // Limbs swing while walking.
  const step = Math.sin(p.walkPhase ?? 0) * 3.4 * s;
  ctx.strokeStyle = shade(colour, -0.34);
  ctx.lineWidth = 3 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-1, -3 * s);
  ctx.lineTo(-5 * s, -3.5 * s + step);
  ctx.moveTo(-1, 3 * s);
  ctx.lineTo(-5 * s, 3.5 * s - step);
  ctx.stroke();
  // Torso: a rounded coat with a highlight down the spine.
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(-0.4 * s, 0, 6.8 * s, 5.6 * s, 0, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = shade(colour, 0.22);
  ctx.beginPath();
  ctx.ellipse(-1.6 * s, 0, 3.4 * s, 4.4 * s, 0, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(-0.4 * s, 0, 6.8 * s, 5.6 * s, 0, 0, 6.283);
  ctx.stroke();
  // Head and hair.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(2 * s, 0, 3.3 * s, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = 'rgba(24,18,22,0.9)';
  ctx.beginPath();
  ctx.arc(1.1 * s, 0, 3.2 * s, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(2.6 * s, 0, 2.4 * s, 0, 6.283);
  ctx.fill();
  if (opts.gun) {
    ctx.strokeStyle = '#22222c';
    ctx.lineWidth = 2.4 * s;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(4 * s, 2.6 * s);
    ctx.lineTo(11.5 * s, 2.6 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPeds(r, world) {
  for (const p of world.peds) {
    if (p.dead) continue;
    if (p.x < world.camera.x - 900 || p.x > world.camera.x + 900) continue;
    if (p.y < world.camera.y - 700 || p.y > world.camera.y + 700) continue;
    drawPerson(r.ctx, p, p.colour, p.skin ?? '#d8a882');
    if (p.fleeing) {
      // A little exclamation pip over a panicking civilian.
      r.ctx.fillStyle = 'rgba(255,220,120,0.85)';
      r.ctx.font = 'bold 10px ui-monospace, monospace';
      r.ctx.textAlign = 'center';
      r.ctx.fillText('!', p.x, p.y - 14);
    }
  }
}

function drawPlayer(r, world) {
  const { ctx } = r;
  const p = world.player;
  if (p.inCar) return;
  // A soft gold marker under Rey so the eye always finds him in a crowd.
  const pulse = 0.5 + Math.sin(r.time * 2.4) * 0.08;
  const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
  g.addColorStop(0, 'rgba(255,224,150,0.30)');
  g.addColorStop(1, 'rgba(255,224,150,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,232,170,${pulse})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 4, 17, 10, 0, 0, 6.283);
  ctx.stroke();
  drawPerson(ctx, p, p.colour ?? '#7d5468', '#e0b48c', { gun: p.weapon !== 'fist', scale: 1.12 });
  // Aim line: a thin tracer-coloured guide from the shoulder along the aim.
  const len = 30;
  ctx.strokeStyle = 'rgba(255,240,200,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(p.aim) * 10, p.y + Math.sin(p.aim) * 10);
  ctx.lineTo(p.x + Math.cos(p.aim) * len, p.y + Math.sin(p.aim) * len);
  ctx.stroke();
  if (p.hitFlash > 0) {
    ctx.strokeStyle = `rgba(255,70,70,${p.hitFlash})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 17, 0, 6.283);
    ctx.stroke();
  }
}

function drawPolice(r, world) {
  const { ctx } = r;
  for (const c of world.cops) {
    if (c.dead) continue;
    drawPerson(ctx, c, '#22324e', '#c99a74', { gun: true });
    ctx.fillStyle = '#7fd3ff';
    ctx.fillRect(c.x - 3, c.y - 9, 2.5, 2.5);
  }
}

// The helicopter: a body, a spinning rotor disc, and a searchlight cone it sweeps over the streets.
function drawHelicopter(r, world) {
  const h = world.heli;
  if (!h || !h.active) return;
  const { ctx } = r;
  const t = r.time;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(h.x + 40, h.y + 70, 34, 20, 0, 0, 6.283);
  ctx.fill();
  // Searchlight: a long warm cone on the ground.
  const beamLen = 200;
  const bx = h.x + Math.cos(h.beamAngle) * beamLen;
  const by = h.y + 70 + Math.sin(h.beamAngle) * beamLen * 0.6;
  const g = ctx.createRadialGradient(bx, by, 2, bx, by, 74);
  g.addColorStop(0, 'rgba(255,248,214,0.34)');
  g.addColorStop(0.55, 'rgba(255,240,190,0.14)');
  g.addColorStop(1, 'rgba(255,230,150,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(bx, by, 74, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,250,220,0.10)';
  ctx.beginPath();
  ctx.moveTo(h.x, h.y + 6);
  ctx.lineTo(bx - 22, by);
  ctx.lineTo(bx + 22, by);
  ctx.closePath();
  ctx.fill();
  // Body.
  ctx.fillStyle = '#1d2230';
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 20, 13, 0, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = '#2f3a52';
  ctx.fillRect(h.x - 30, h.y - 3, 26, 6);
  ctx.fillStyle = '#101828';
  ctx.beginPath();
  ctx.ellipse(h.x + 15, h.y, 8, 6, 0, 0, 6.283);
  ctx.fill();
  // Rotor blur.
  ctx.strokeStyle = 'rgba(190,200,220,0.20)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 34 + Math.sin(t * 40) * 3, 34, 0, 0, 6.283);
  ctx.stroke();
  // Nav lights.
  ctx.fillStyle = Math.sin(t * 10) > 0 ? '#ff4455' : '#442028';
  ctx.beginPath();
  ctx.arc(h.x - 28, h.y, 2.4, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = '#66ff99';
  ctx.beginPath();
  ctx.arc(h.x + 22, h.y - 2, 1.8, 0, 6.283);
  ctx.fill();
  ctx.restore();
}

// Tracers in flight, each a short tapered streak in its own colour.
function drawBullets(r, world) {
  const { ctx } = r;
  for (const b of world.bullets) {
    const trail = 16;
    const tx = b.x - Math.cos(b.angle) * trail;
    const ty = b.y - Math.sin(b.angle) * trail;
    const g = ctx.createLinearGradient(b.x, b.y, tx, ty);
    g.addColorStop(0, rgba(b.tone, 0.95));
    g.addColorStop(1, rgba(b.tone, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,248,220,0.95)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.6, 0, 6.283);
    ctx.fill();
  }
}

// Spark, smoke, glass and blood particles; explosion rings; muzzle flashes.
function drawParticles(r, world) {
  const { ctx } = r;
  for (const p of world.particles) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(70,66,74,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - a), 0, 6.283);
      ctx.fill();
    } else if (p.kind === 'spark') {
      ctx.fillStyle = rgba(p.tone, a);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    } else if (p.kind === 'blood') {
      ctx.fillStyle = rgba(PALETTE.blood, a * 0.85);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = rgba(p.tone, a * 0.8);
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + (1 - a) * 3), 0, 6.283);
      ctx.stroke();
    } else if (p.kind === 'debris') {
      ctx.fillStyle = rgba(p.tone, a);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin ?? 0);
      ctx.fillRect(-2, -1, 4, 2);
      ctx.restore();
    }
  }
  for (const f of world.flashes) {
    const a = clamp(f.life / f.maxLife, 0, 1);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.fillStyle = `rgba(255,232,170,${a})`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(16, -5);
    ctx.lineTo(22, 0);
    ctx.lineTo(16, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawSelectionRings(r, world) {
  const { ctx } = r;
  for (const car of world.cars) {
    if (!car.offerEnter || car.dead) continue;
    ctx.strokeStyle = 'rgba(255,220,140,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.ellipse(car.x, car.y, car.model.len * 0.62, car.model.wid * 0.9, car.angle, 0, 6.283);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// The dusk pass: a warm-to-cool colour wash, a soft vignette, then every light source's bloom. Kept gentle so the
// street reads at a glance; the darkness lives in the vignette and the shadows, not in a flat multiply.
function drawLightPass(r, world, view) {
  const { ctx, canvas } = r;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, '#fff1de');
  g.addColorStop(0.45, '#eddae4');
  g.addColorStop(1, '#c3cbe4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Warm sun on the western third of the frame; a cool wash on the harbour side.
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  const sun = ctx.createLinearGradient(0, 0, canvas.width * 0.8, canvas.height);
  sun.addColorStop(0, 'rgba(255,170,96,0.30)');
  sun.addColorStop(0.5, 'rgba(255,120,150,0.10)');
  sun.addColorStop(1, 'rgba(40,90,160,0.18)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // A vignette so the frame sits down and the lights read.
  ctx.save();
  const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.42, canvas.width / 2, canvas.height / 2, canvas.height * 1.0);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8,6,20,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Additive light: lamps, neon, headlights and the searchlight all bloom through the same sprite.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const tf = cameraTransform(world.camera);
  const drawGlow = (wx, wy, size, alpha, tint) => {
    const sx = wx * tf.z + tf.ox;
    const sy = wy * tf.z + tf.oy;
    if (sx < -size || sy < -size || sx > canvas.width + size || sy > canvas.height + size) return;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = tint === 'cool' ? 'screen' : 'lighter';
    ctx.drawImage(r.glow, sx - size / 2, sy - size / 2, size, size);
  };
  for (const l of world.city.props.lamps) {
    if (l.x < view.x0 - 80 || l.x > view.x1 + 80 || l.y < view.y0 - 80 || l.y > view.y1 + 80) continue;
    drawGlow(l.x, l.y - 4, 130, 0.30);
  }
  for (const b of world.city.buildings) {
    if (!b.sign) continue;
    if (b.x > view.x1 || b.x + b.wx < view.x0) continue;
    drawGlow(b.x + b.wx / 2, b.y + b.wy - b.height * 0.2, 150, 0.22);
  }
  for (const c of world.cars) {
    if (c.dead) continue;
    if (c.x < view.x0 - 150 || c.x > view.x1 + 150) continue;
    drawGlow(c.x + Math.cos(c.angle) * (c.model.len / 2 + 10), c.y + Math.sin(c.angle) * (c.model.len / 2 + 10), 90, 0.16);
  }
  if (world.heli && world.heli.active) {
    const bx = world.heli.x + Math.cos(world.heli.beamAngle) * 200;
    const by = world.heli.y + 70 + Math.sin(world.heli.beamAngle) * 120;
    drawGlow(bx, by, 220, 0.20);
  }
  ctx.restore();
}

// Full-screen reactions: the red edge when hurt, the "busted" flash, and the mission-complete wash.
function drawScreenEffects(r, world) {
  const { ctx, canvas } = r;
  const v = world.vignette;
  if (v && v.alpha > 0.01) {
    const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, rgba(v.tone ?? '#7a0d20', clamp(v.alpha, 0, 0.85)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (world.flashWhite > 0.01) {
    ctx.fillStyle = `rgba(255,240,220,${clamp(world.flashWhite, 0, 1) * 0.6})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // Rain: thin diagonal strokes drifting across the frame during the storm beat.
  if (world.rain > 0) {
    ctx.strokeStyle = `rgba(190,210,240,${0.10 * world.rain})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const t = r.time;
    for (let i = 0; i < 120; i++) {
      const x = ((i * 137 + t * 320) % (canvas.width + 120)) - 60;
      const y = (i * 71 + t * 900) % canvas.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 18);
    }
    ctx.stroke();
  }
}

// Off-screen arrows pointing at the current mission marker, drawn in screen space by main.js.
export function drawObjectiveArrow(ctx, world, canvas) {
  const m = world.markers.find((mk) => mk.primary);
  if (!m) return;
  const tf = cameraTransform(world.camera);
  const sx = m.x * tf.z + tf.ox;
  const sy = m.y * tf.z + tf.oy;
  const pad = 54;
  if (sx > pad && sx < canvas.width - pad && sy > pad && sy < canvas.height - pad) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const ang = Math.atan2(sy - cy, sx - cx);
  const rx = canvas.width / 2 - pad;
  const ry = canvas.height / 2 - pad;
  const t = Math.min(Math.abs(rx / Math.cos(ang)), Math.abs(ry / Math.sin(ang)));
  const ax = cx + Math.cos(ang) * t;
  const ay = cy + Math.sin(ang) * t;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(255,214,120,0.92)';
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, -8);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
