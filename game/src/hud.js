// The HUD: health and armour bars, money, wanted stars, the minimap with blips and a viewport cone, the mission
// objective line and dialogue box, weapon and ammo, the speedometer while driving, the busted risk bar, the title
// screen, the pause menu, the briefing panel and the busted/complete cards.

import { STORY, PALETTE, TILE, MAP_W, MAP_H, T, weaponById, STAR_HEAT } from './config.js';
import { clamp, rgba, shade, hash2 } from './geom.js';
import { districtAt } from './city.js';
import { currentLine } from './missions.js';

// A pre-computed minimap of the city drawn once into its own canvas: it never changes, so it is cheap per frame.
export function bakeMinimap(city, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const s = size / MAP_W;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const id = city.tiles[ty * MAP_W + tx];
      let fill = '#1a1724';
      if (id === T.ROAD) fill = '#3a3648';
      else if (id === T.PAVEMENT) fill = '#2b2739';
      else if (id === T.BUILDING) fill = '#4a3d4e';
      else if (id === T.WATER) fill = '#12293a';
      else if (id === T.DOCK) fill = '#453529';
      else if (id === T.GRASS) fill = '#243a2c';
      else if (id === T.PLAZA) fill = '#3f3648';
      g.fillStyle = fill;
      g.fillRect(tx * s, ty * s, Math.ceil(s), Math.ceil(s));
    }
  }
  return { canvas: c, scale: s };
}

export function createHud(canvas, city) {
  return {
    canvas,
    minimap: bakeMinimap(city, 168),
    toast: null,
    toastTime: 0,
    bigCard: null,
    bigTime: 0,
    areaName: '',
    areaTimer: 0,
  };
}

// The whole HUD for one frame, in screen space. `mode` is the game's state machine (title, playing, paused...).
export function drawHud(hud, world, mode, dt) {
  const ctx = hud.canvas.getContext('2d');
  hud.toastTime = Math.max(0, hud.toastTime - dt);
  hud.bigTime = Math.max(0, hud.bigTime - dt);
  hud.areaTimer = Math.max(0, hud.areaTimer - dt);

  for (const e of world.hudEvents) {
    if (e.type === 'toast') {
      hud.toast = e.text;
      hud.toastTime = 3.4;
    } else if (e.type === 'card') {
      hud.bigCard = e.card;
      hud.bigTime = e.time ?? 2.6;
    }
  }
  world.hudEvents.length = 0;

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const p = world.player;

  if (mode === 'playing' || mode === 'paused' || mode === 'busted') {
    drawStatusBars(ctx, p);
    drawMoney(ctx, p, W);
    drawWantedStars(ctx, world.police, W);
    drawMinimap(ctx, hud, world, W, H);
    drawObjective(ctx, hud, world, W, H);
    drawWeapon(ctx, world, W, H);
    if (p.inCar) drawSpeedometer(ctx, p.inCar, W, H);
    if (world.police.bustRisk > 0.02) drawBustRisk(ctx, world, W, H);
    drawDialogue(ctx, world, W, H);
    drawPrompt(ctx, world, W, H);
    drawToast(ctx, hud, W, H);
    drawRadio(ctx, world, W, H);
  }
  if (mode === 'paused') drawPauseMenu(ctx, world, W, H);
  if (mode === 'title') drawTitle(ctx, world, W, H);
  if (mode === 'briefing') drawBriefing(ctx, world, W, H);
  if (mode === 'busted') drawBusted(ctx, world, W, H);
  if (mode === 'complete') drawComplete(ctx, world, W, H);
  if (hud.bigTime > 0 && hud.bigCard) drawBigCard(ctx, hud, W, H);
  if (world.rain > 0) drawRainTint(ctx, W, H, world.rain);
}

// Health and armour as two stacked bars, with the numbers on them.
function drawStatusBars(ctx, p) {
  const x = 22;
  const y = 26;
  const w = 208;
  ctx.save();
  ctx.fillStyle = 'rgba(10,8,16,0.62)';
  ctx.fillRect(x - 6, y - 6, w + 12, 44);
  bar(ctx, x, y, w, 13, p.hp / p.maxHp, p.hp < 30 ? '#ff4f5e' : '#5fd39a', 'HEALTH');
  bar(ctx, x, y + 19, w, 9, p.armour / p.maxArmour, '#6fb8ff', 'ARMOUR');
  ctx.restore();
}

function bar(ctx, x, y, w, h, frac, tone, label) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = tone;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 8px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 3, y + h - 3);
}

function drawMoney(ctx, p, W) {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fe3a8';
  ctx.font = 'bold 22px ui-monospace, monospace';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText('$' + p.money.toLocaleString('en-US'), W - 24, 46);
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(230,225,240,0.55)';
  ctx.fillText('REY CALLOWAY', W - 24, 60);
  ctx.restore();
}

// Five stars, lit up to the current wanted level, with a pulse on the newest one.
function drawWantedStars(ctx, police, W) {
  const lit = clamp(police.stars, 0, 5);
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const x = W - 32 - (4 - i) * 26;
    const y = 78;
    starPath(ctx, x, y, 10);
    if (i < lit) {
      const pulse = 1 + Math.sin(performance.now() / 160 + i) * 0.08;
      ctx.fillStyle = lit >= 4 ? '#ff5b66' : '#ffd45e';
      ctx.shadowColor = lit >= 4 ? 'rgba(255,60,80,0.9)' : 'rgba(255,200,90,0.8)';
      ctx.shadowBlur = 10 * pulse;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (police.heat > 0) {
    ctx.fillStyle = 'rgba(10,8,16,0.55)';
    ctx.fillRect(W - 160, 92, 136, 5);
    ctx.fillStyle = police.stars >= 4 ? '#ff5b66' : '#ffd45e';
    ctx.fillRect(W - 160, 92, (136 * police.heat) / 100, 5);
  }
  ctx.restore();
}

function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// The minimap: the baked city, then blips for the player, cops, mission markers and nearby traffic, clipped to a circle.
function drawMinimap(ctx, hud, world, W, H) {
  const size = 168;
  const x = W - size - 24;
  const y = 110;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;
  const map = hud.minimap;
  const zoom = 1.9;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 6.283);
  ctx.clip();
  ctx.fillStyle = '#100e18';
  ctx.fillRect(x, y, size, size);
  // Camera-centred slice of the baked map.
  const srcW = size / zoom;
  const sx = (world.player.x / (MAP_W * TILE)) * size - srcW / 2;
  const sy = (world.player.y / (MAP_H * TILE)) * size - srcW / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map.canvas, sx, sy, srcW, srcW, x, y, size, size);

  // Blips: cops red, traffic grey, peds faint, mission gold.
  const toMap = (wx, wy) => ({
    x: cx + ((wx - world.player.x) / (MAP_W * TILE)) * size * zoom,
    y: cy + ((wy - world.player.y) / (MAP_H * TILE)) * size * zoom,
  });
  for (const ped of world.peds) {
    if (ped.dead) continue;
    const b = toMap(ped.x, ped.y);
    ctx.fillStyle = 'rgba(220,220,240,0.35)';
    ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
  }
  for (const car of world.cars) {
    if (car.dead) continue;
    const b = toMap(car.x, car.y);
    ctx.fillStyle = car.police ? '#ff5b66' : 'rgba(200,200,220,0.5)';
    ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
  }
  for (const c of world.police.cars) {
    const b = toMap(c.x, c.y);
    const blink = Math.sin(performance.now() / 120) > 0 ? '#ff4d5e' : '#6f8dff';
    ctx.fillStyle = blink;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, 6.283);
    ctx.fill();
  }
  for (const m of world.markers) {
    const b = toMap(m.x, m.y);
    ctx.fillStyle = m.tone;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4.5, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (world.heli && world.heli.active) {
    const b = toMap(world.heli.x, world.heli.y);
    ctx.strokeStyle = 'rgba(255,240,180,0.8)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, 6.283);
    ctx.stroke();
  }
  // The player: a wedge pointing where he looks, with the camera's view cone drawn ahead.
  const aim = world.player.inCar ? world.player.inCar.angle : world.player.aim;
  const coneGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
  coneGrad.addColorStop(0, 'rgba(255,230,160,0.30)');
  coneGrad.addColorStop(1, 'rgba(255,230,160,0)');
  ctx.fillStyle = coneGrad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 46, aim - 0.5, aim + 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(aim);
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // Frame and the district name under it.
  ctx.strokeStyle = 'rgba(255,220,160,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, 6.283);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(10,8,16,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, 6.283);
  ctx.stroke();
  const area = districtAt(world.player.x, world.player.y);
  ctx.fillStyle = 'rgba(10,8,16,0.62)';
  ctx.fillRect(x + 10, y + size - 18, size - 20, 14);
  ctx.fillStyle = '#e8dcc8';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(area.toUpperCase(), cx, y + size - 8);
}

// The current mission name and objective, bottom left above the weapon, with the story's flavour on the right.
function drawObjective(ctx, hud, world, W, H) {
  const ms = world.missions;
  ctx.save();
  ctx.textAlign = 'left';
  const x = 24;
  const y = H - 116;
  ctx.fillStyle = 'rgba(10,8,16,0.55)';
  ctx.fillRect(x - 8, y - 18, 430, 54);
  ctx.fillStyle = '#ffd45e';
  ctx.font = 'bold 10px ui-monospace, monospace';
  const m = ms.active;
  const label = m ? m.name.toUpperCase() : ms.index < 5 ? 'NEXT JOB — ' + world.nextMissionName.toUpperCase() : 'THE HARBOUR IS QUIET';
  ctx.fillText(label, x, y - 5);
  ctx.fillStyle = '#f2ece0';
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
  const text = world.objectiveText ?? '';
  ctx.fillText(clipText(ctx, text, 400), x, y + 15);
  if (m) {
    ctx.fillStyle = 'rgba(232,220,200,0.55)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('OBJECTIVE ' + (ms.objective + 1) + ' OF ' + m.objectives.length, x, y + 30);
  }
  ctx.restore();
}

function clipText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

// Weapon, its magazine and reserve, and the four-slot wheel. The count is drawn after its label is measured so the
// two never overlap.
function drawWeapon(ctx, world, W, H) {
  const p = world.player;
  const w = weaponById(p.weapon);
  ctx.save();
  const x = W - 24;
  const y = H - 30;
  ctx.fillStyle = 'rgba(10,8,16,0.58)';
  ctx.fillRect(x - 236, y - 34, 236, 48);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f2ece0';
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.fillText(w.name.toUpperCase(), x - 10, y - 16);
  if (w.id !== 'fist') {
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,220,200,0.5)';
    const reserve = '/ ' + w.ammo;
    ctx.fillText(reserve, x - 10, y + 8);
    const rw = ctx.measureText(reserve).width;
    ctx.fillStyle = '#ffd45e';
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillText(String(p.ammo[w.id] ?? 0), x - 18 - rw, y + 8);
  } else {
    ctx.fillStyle = 'rgba(232,220,200,0.6)';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillText('MELEE', x - 10, y + 6);
  }
  ctx.restore();
}

// Speedometer dial while driving: an arc that fills with speed, with km/h and the gear.
function drawSpeedometer(ctx, car, W, H) {
  const cx = W - 96;
  const cy = H - 108;
  const r = 54;
  const frac = clamp(Math.abs(car.speed) / car.model.maxSpeed, 0, 1);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, 6.283);
  ctx.fillStyle = 'rgba(10,8,16,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5);
  ctx.stroke();
  ctx.strokeStyle = frac > 0.8 ? '#ff6b5e' : '#8fe3a8';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * frac);
  ctx.stroke();
  ctx.fillStyle = '#f2ece0';
  ctx.font = 'bold 24px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(Math.abs(car.speed) * 0.72)), cx, cy + 6);
  ctx.font = 'bold 8px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(232,220,200,0.55)';
  ctx.fillText('KM/H', cx, cy + 20);
  ctx.fillStyle = frac > 0.7 ? '#ffd45e' : 'rgba(232,220,200,0.6)';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.fillText(car.speed < -4 ? 'R' : frac > 0.75 ? 'GEAR 4' : frac > 0.45 ? 'GEAR 3' : frac > 0.2 ? 'GEAR 2' : 'GEAR 1', cx, cy + 34);
  ctx.restore();
}

// The arrest meter: a red bar creeping across the top centre while officers have you cornered.
function drawBustRisk(ctx, world, W, H) {
  const w = 240;
  const x = W / 2 - w / 2;
  const y = 30;
  ctx.save();
  ctx.fillStyle = 'rgba(10,8,16,0.7)';
  ctx.fillRect(x - 6, y - 6, w + 12, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = world.police.bustRisk > 0.66 ? '#ff4f5e' : '#ffb44a';
  ctx.fillRect(x, y, w * clamp(world.police.bustRisk, 0, 1), 10);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('BUSTED', W / 2, y + 9);
  ctx.restore();
}

// The dialogue box: speaker in gold, line in cream, a little prompt to advance.
function drawDialogue(ctx, world, W, H) {
  const line = currentLine(world.missions);
  if (!line) return;
  const w = Math.min(720, W - 160);
  const x = W / 2 - w / 2;
  const y = H - 186;
  ctx.save();
  ctx.fillStyle = 'rgba(8,6,14,0.80)';
  ctx.fillRect(x, y, w, 54);
  ctx.strokeStyle = 'rgba(255,212,94,0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 53);
  ctx.fillStyle = '#ffd45e';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(line.speaker.toUpperCase(), x + 14, y + 18);
  ctx.fillStyle = '#f2ece0';
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(clipText(ctx, line.text, w - 60), x + 14, y + 37);
  ctx.fillStyle = 'rgba(232,220,200,0.4)';
  ctx.font = 'bold 8px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('E ▸', x + w - 12, y + 48);
  ctx.restore();
}

// A one-line contextual prompt: "E — steal the Brantley 88", "E — talk to Marla Vane".
function drawPrompt(ctx, world, W, H) {
  if (!world.prompt) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px ui-monospace, monospace';
  const tw = ctx.measureText(world.prompt).width;
  ctx.fillStyle = 'rgba(8,6,14,0.7)';
  ctx.fillRect(W / 2 - tw / 2 - 12, H - 210, tw + 24, 24);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(world.prompt, W / 2, H - 194);
  ctx.restore();
}

function drawToast(ctx, hud, W, H) {
  if (hud.toastTime <= 0 || !hud.toast) return;
  const a = clamp(hud.toastTime, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px ui-monospace, monospace';
  const tw = ctx.measureText(hud.toast).width;
  ctx.fillStyle = 'rgba(8,6,14,0.82)';
  ctx.fillRect(W / 2 - tw / 2 - 16, 96, tw + 32, 30);
  ctx.strokeStyle = 'rgba(255,212,94,0.5)';
  ctx.strokeRect(W / 2 - tw / 2 - 16.5, 96.5, tw + 33, 29);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(hud.toast, W / 2, 116);
  ctx.restore();
}

// The radio strip: station name and the current track, sitting under the status bars on the left.
function drawRadio(ctx, world, W, H) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(8,6,14,0.45)';
  ctx.fillRect(16, 78, 216, 30);
  ctx.fillStyle = 'rgba(255,212,94,0.9)';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.fillText(STORY.radio.toUpperCase(), 24, 90);
  ctx.fillStyle = 'rgba(232,220,200,0.65)';
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  const track = world.radioTrack.length > 30 ? world.radioTrack.slice(0, 29) + '…' : world.radioTrack;
  ctx.fillText(track + (world.muted ? '  · muted' : ''), 24, 102);
  // A little equaliser that moves with the music, if it is on.
  if (!world.muted) {
    const t = performance.now() / 220;
    for (let i = 0; i < 6; i++) {
      const h = 3 + Math.abs(Math.sin(t + i * 1.3)) * 8;
      ctx.fillStyle = 'rgba(143,227,168,0.7)';
      ctx.fillRect(192 + i * 6, 100 - h, 3, h);
    }
  }
  ctx.restore();
}

// Title screen: the city behind, the name, the tagline and the controls.
function drawTitle(ctx, world, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,6,14,0.62)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,180,107,0.9)';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillText('MAKE.FUN PRESENTS · A HARBOUR CRIME STORY', cx, H * 0.28 - 46);
  ctx.shadowColor = 'rgba(255,95,141,0.65)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#ffe9c9';
  ctx.font = 'bold 76px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('VICE HARBOR', cx, H * 0.28 + 18);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,212,150,0.85)';
  ctx.font = 'italic 17px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(STORY.tagline, cx, H * 0.28 + 52);

  // The story's chapter card.
  ctx.fillStyle = 'rgba(232,220,200,0.72)';
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Rey Calloway has one night, one harbour, and the Cormorant Brothers on his back.', cx, H * 0.28 + 86);

  const items = [
    ['ENTER', 'drive out of the harbour'],
    ['C', world.hasSave ? 'continue a saved night' : 'no saved night yet'],
    ['H', 'the controls'],
  ];
  for (let i = 0; i < items.length; i++) {
    const y = H * 0.55 + i * 34;
    ctx.fillStyle = i === world.titleChoice ? 'rgba(255,212,94,0.16)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(cx - 190, y - 20, 380, 28);
    ctx.strokeStyle = i === world.titleChoice ? 'rgba(255,212,94,0.8)' : 'rgba(255,255,255,0.12)';
    ctx.strokeRect(cx - 190.5, y - 20.5, 381, 29);
    ctx.fillStyle = i === world.titleChoice ? '#ffe9a8' : 'rgba(232,220,200,0.55)';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(items[i][0], cx - 24, y);
    ctx.textAlign = 'left';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(items[i][1], cx - 8, y);
    ctx.textAlign = 'center';
  }
  ctx.fillStyle = 'rgba(232,220,200,0.35)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('VICE HARBOR · ' + STORY.radio + ' · a dusk that never quite ends', cx, H - 26);
  ctx.restore();
}

// The briefing panel: mission name, giver, objectives, reward, over the dimmed world.
function drawBriefing(ctx, world, W, H) {
  const b = world.briefing;
  if (!b) return;
  ctx.save();
  ctx.fillStyle = 'rgba(6,5,12,0.62)';
  ctx.fillRect(0, 0, W, H);
  const w = Math.min(660, W - 120);
  const x = W / 2 - w / 2;
  const y = H / 2 - 190;
  ctx.fillStyle = 'rgba(16,12,24,0.94)';
  ctx.fillRect(x, y, w, 380);
  ctx.strokeStyle = 'rgba(255,180,107,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, 378);
  ctx.fillStyle = 'rgba(255,95,141,0.85)';
  ctx.fillRect(x, y, w, 4);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,180,107,0.9)';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.fillText('MISSION BRIEFING · ' + b.city.toUpperCase(), x + 30, y + 38);
  ctx.fillStyle = '#ffe9c9';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(b.name, x + 30, y + 76);
  ctx.fillStyle = 'rgba(232,220,200,0.6)';
  ctx.font = 'italic 13px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Giver: ' + b.giver, x + 30, y + 98);
  ctx.fillStyle = 'rgba(232,220,200,0.82)';
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
  wrapText(ctx, b.summary, x + 30, y + 126, w - 60, 19);

  ctx.fillStyle = 'rgba(255,212,94,0.9)';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.fillText('OBJECTIVES', x + 30, y + 196);
  for (let i = 0; i < b.objectives.length; i++) {
    const oy = y + 218 + i * 26;
    ctx.fillStyle = 'rgba(255,212,94,0.75)';
    ctx.beginPath();
    ctx.arc(x + 36, oy - 4, 4, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = 'rgba(242,236,224,0.92)';
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(b.objectives[i], x + 52, oy);
  }
  ctx.fillStyle = 'rgba(143,227,168,0.95)';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.fillText('REWARD  $' + b.reward.toLocaleString('en-US'), x + 30, y + 340);
  ctx.fillStyle = 'rgba(232,220,200,0.55)';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('ENTER  ACCEPT        ESC  WALK AWAY', x + w - 30, y + 340);
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line === '' ? word : line + ' ' + word;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else {
      line = test;
    }
  }
  if (line !== '') ctx.fillText(line, x, yy);
  return yy;
}

// Pause: a compact menu with the controls on the right.
function drawPauseMenu(ctx, world, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,5,12,0.66)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9c9';
  ctx.font = 'bold 40px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('PAUSED', W / 2, H * 0.3);
  ctx.fillStyle = 'rgba(255,180,107,0.85)';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.fillText(STORY.city.toUpperCase() + ' · ' + STORY.radio, W / 2, H * 0.3 + 24);
  const rows = ['ESC  back to the harbour', 'F5  save the night', 'F9  load the night', 'Q  quit to the title'];
  for (let i = 0; i < rows.length; i++) {
    ctx.fillStyle = 'rgba(232,220,200,0.75)';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(rows[i], W / 2, H * 0.46 + i * 28);
  }
  ctx.restore();
}

// Busted: the patrol wins this round.
function drawBusted(ctx, world, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(30,6,10,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff8a90';
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('BUSTED', W / 2, H / 2 - 10);
  ctx.fillStyle = 'rgba(242,236,224,0.85)';
  ctx.font = '15px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('The Marina Patrol takes Rey in. The harbour keeps his cash.', W / 2, H / 2 + 26);
  ctx.fillStyle = 'rgba(255,212,94,0.85)';
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillText('ENTER  BACK TO THE QUAY', W / 2, H / 2 + 62);
  ctx.restore();
}

// Mission complete: the reward card.
function drawComplete(ctx, world, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,20,14,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8fe3a8';
  ctx.font = 'bold 52px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('MISSION PASSED', W / 2, H / 2 - 20);
  ctx.fillStyle = '#ffe9c9';
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.fillText(world.completeTitle ?? '', W / 2, H / 2 + 22);
  ctx.fillStyle = 'rgba(255,212,94,0.9)';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.fillText('+$' + (world.completeReward ?? 0).toLocaleString('en-US'), W / 2, H / 2 + 54);
  ctx.restore();
}

// A big transient card, e.g. "WANTED LEVEL 4".
function drawBigCard(ctx, hud, W, H) {
  const a = clamp(hud.bigTime, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(8,6,14,0.7)';
  ctx.fillRect(0, H * 0.2 - 30, W, 62);
  ctx.fillStyle = '#ffd45e';
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(hud.bigCard, W / 2, H * 0.2 + 12);
  ctx.restore();
}

function drawRainTint(ctx, W, H, amount) {
  ctx.save();
  ctx.fillStyle = `rgba(40,70,110,${0.10 * amount})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// A small helper other modules use to draw a chip of text in the game's own type.
export function drawChip(ctx, x, y, text, tone = '#ffd45e') {
  ctx.save();
  ctx.font = 'bold 10px ui-monospace, monospace';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = rgba(tone, 0.14);
  ctx.fillRect(x, y - 12, w, 18);
  ctx.strokeStyle = rgba(tone, 0.5);
  ctx.strokeRect(x + 0.5, y - 11.5, w - 1, 17);
  ctx.fillStyle = tone;
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 8, y);
  ctx.restore();
}
