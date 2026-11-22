// The camera: follows a target with look-ahead in the direction of travel, zooms out with speed, shakes on
// impacts, and exposes the world-to-screen transform plus the minimap viewport.

import { clamp, lerp, smoothstep } from './geom.js';
import { WORLD_W, WORLD_H } from './config.js';

export function createCamera() {
  return {
    x: WORLD_W * 0.5,
    y: WORLD_H * 0.5,
    zoom: 1,
    targetZoom: 1,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    leadX: 0,
    leadY: 0,
    w: 1280,
    h: 720,
  };
}

// Keeps the camera inside the map, then stores the frame's screen box.
export function resizeCamera(cam, w, h) {
  cam.w = w;
  cam.h = h;
}

// A shake impulse on a hit; additive but capped so a pile-up does not spin the frame.
export function addShake(cam, amount) {
  cam.shake = Math.min(26, cam.shake + amount);
}

// Follow a target. `look` is a heading (radians) and `speed` in px/s, used for lead and zoom.
export function updateCamera(cam, target, look, speed, dt, rng) {
  const lookX = Math.cos(look) * clamp(speed * 0.24, 0, 130);
  const lookY = Math.sin(look) * clamp(speed * 0.24, 0, 130);
  cam.leadX = lerp(cam.leadX, lookX, 1 - Math.exp(-2.6 * dt));
  cam.leadY = lerp(cam.leadY, lookY, 1 - Math.exp(-2.6 * dt));
  const desiredX = clamp(target.x + cam.leadX, 0, WORLD_W);
  const desiredY = clamp(target.y + cam.leadY, 0, WORLD_H);
  const k = 1 - Math.exp(-6.5 * dt);
  cam.x = lerp(cam.x, desiredX, k);
  cam.y = lerp(cam.y, desiredY, k);

  // At rest, sit close; at full tilt, pull back so the road ahead fits.
  const fast = smoothstep(clamp((speed - 60) / 300, 0, 1));
  cam.targetZoom = lerp(1.06, 0.72, fast);
  cam.zoom = lerp(cam.zoom, cam.targetZoom, 1 - Math.exp(-3.2 * dt));

  cam.shake = Math.max(0, cam.shake - dt * 42);
  const s = cam.shake;
  cam.shakeX = (rng() - 0.5) * s;
  cam.shakeY = (rng() - 0.5) * s;
}

// Instant placement, used when loading a save, respawning and posing screenshots.
export function snapCamera(cam, x, y, zoom = 1) {
  cam.x = clamp(x, 0, WORLD_W);
  cam.y = clamp(y, 0, WORLD_H);
  cam.zoom = zoom;
  cam.targetZoom = zoom;
  cam.leadX = 0;
  cam.leadY = 0;
  cam.shake = 0;
}

// The transform for this frame: world space to canvas pixels, centred on the camera.
export function cameraTransform(cam) {
  const z = cam.zoom;
  return {
    z,
    ox: cam.w / 2 - (cam.x + cam.shakeX) * z,
    oy: cam.h / 2 - (cam.y + cam.shakeY) * z,
    toScreen(x, y) {
      return { x: x * z + this.ox, y: y * z + this.oy };
    },
    toWorld(sx, sy) {
      return { x: (sx - this.ox) / z, y: (sy - this.oy) / z };
    },
  };
}

// The world rectangle the frame covers, padded so nothing pops at the edges.
export function visibleBounds(cam) {
  const z = cam.zoom;
  const hw = cam.w / (2 * z) + 40;
  const hh = cam.h / (2 * z) + 40;
  return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
}
