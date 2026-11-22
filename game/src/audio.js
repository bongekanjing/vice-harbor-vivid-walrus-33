// Everything you hear, synthesised at runtime with WebAudio: an engine that tracks the car's speed, gunshots,
// shotgun blasts, sirens, horns, footsteps, impacts, explosions, the mission sting and Harbour FM's jingle. No
// audio files exist in the project; every sound is oscillators and noise from a buffer.

import { clamp } from './geom.js';

export function createAudio() {
  return {
    ctx: null,
    master: null,
    music: null,
    engine: null,
    siren: null,
    started: false,
    muted: false,
    noiseBuffer: null,
    listeners: [],
  };
}

// Chrome will not start audio until a user gesture: main calls this from the first key or click.
export function unlockAudio(audio) {
  if (audio.started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  const music = ctx.createGain();
  music.gain.value = 0.22;
  music.connect(master);
  audio.ctx = ctx;
  audio.master = master;
  audio.music = music;
  audio.noiseBuffer = makeNoise(ctx);
  audio.started = true;
  audio.engine = makeEngine(ctx, master);
  audio.siren = makeSiren(ctx, master);
}

// Two seconds of white noise, reused by every percussive sound.
function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (s / 0x3fffffff - 1) * 0.9;
  }
  return buf;
}

// The car engine: two detuned sawtooths and a lowpass; pitch and gain follow the speed.
function makeEngine(ctx, out) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc1.type = 'sawtooth';
  osc2.type = 'square';
  osc1.frequency.value = 60;
  osc2.frequency.value = 90;
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  gain.gain.value = 0;
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  osc1.start();
  osc2.start();
  return { osc1, osc2, filter, gain };
}

// The siren: a triangle sweeping between two tones, with its own gain so it can fade in and out.
function makeSiren(ctx, out) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 700;
  lfo.frequency.value = 0.7;
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(out);
  osc.start();
  lfo.start();
  return { osc, gain };
}

// Engine pitch from the speed; 0 speed means silence.
export function updateEngine(audio, car) {
  if (!audio.started || !audio.engine) return;
  const t = audio.ctx.currentTime;
  const frac = clamp(Math.abs(car.speed) / car.model.maxSpeed, 0, 1);
  const base = 52 + frac * 118;
  audio.engine.osc1.frequency.setTargetAtTime(base, t, 0.08);
  audio.engine.osc2.frequency.setTargetAtTime(base * 1.49, t, 0.08);
  audio.engine.filter.frequency.setTargetAtTime(320 + frac * 900, t, 0.1);
  audio.engine.gain.gain.setTargetAtTime(car.dead ? 0 : 0.05 + frac * 0.075, t, 0.15);
}

export function silenceEngine(audio) {
  if (!audio.started || !audio.engine) return;
  audio.engine.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.12);
}

// The siren's volume tracks the nearest patrol car; it is silent with no heat.
export function updateSiren(audio, police, player) {
  if (!audio.started || !audio.siren) return;
  const t = audio.ctx.currentTime;
  let near = 0;
  for (const c of police.cars) {
    const d = Math.hypot(c.x - player.x, c.y - player.y);
    near = Math.max(near, clamp(1 - d / 1100, 0, 1));
  }
  const vol = police.stars > 0 ? near * 0.075 : 0;
  audio.siren.gain.gain.setTargetAtTime(vol, t, 0.2);
}

// A gunshot: a filtered noise burst plus a body thump.
export function playShot(audio, kind = 'pistol') {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = kind === 'shotgun' ? 500 : 900;
  const gain = ctx.createGain();
  const dur = kind === 'shotgun' ? 0.26 : 0.11;
  const peak = kind === 'shotgun' ? 0.5 : kind === 'smg' ? 0.22 : 0.32;
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  src.start(t);
  src.stop(t + dur + 0.02);
  // The low thump under the crack.
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(kind === 'shotgun' ? 120 : 190, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + dur);
  og.gain.setValueAtTime(peak * 0.8, t);
  og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(og);
  og.connect(audio.master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A tyre-squeal hiss for a handbrake drift.
export function playSkid(audio) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1900;
  filter.Q.value = 8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(0.09, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  src.start(t);
  src.stop(t + 0.55);
}

// A crash: broadband noise and a low boom, louder with the impact speed.
export function playCrash(audio, strength = 1) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const s = clamp(strength, 0.2, 2);
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.16 * s, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.32);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  src.start(t);
  src.stop(t + 0.35);
}

// An explosion: a long noise roar with a falling sine underneath and a crack on top.
export function playExplosion(audio) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + 0.9);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.55, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 1.1);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  src.start(t);
  src.stop(t + 1.15);
  const sub = ctx.createOscillator();
  const sg = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, t);
  sub.frequency.exponentialRampToValueAtTime(30, t + 0.8);
  sg.gain.setValueAtTime(0.5, t);
  sg.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
  sub.connect(sg);
  sg.connect(audio.master);
  sub.start(t);
  sub.stop(t + 0.95);
}

// The car horn: a two-tone blast.
export function playHorn(audio) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  for (const f of [392, 494]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.02);
    g.gain.setValueAtTime(0.075, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t);
    osc.stop(t + 0.45);
  }
}

// A soft thud on each footfall.
export function playFootstep(audio, running = false) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = running ? 520 : 340;
  const g = ctx.createGain();
  g.gain.setValueAtTime(running ? 0.05 : 0.03, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
  src.connect(filter);
  filter.connect(g);
  g.connect(audio.master);
  src.start(t);
  src.stop(t + 0.1);
}

// The mission sting: a rising minor arpeggio with a bell on the last note.
export function playSting(audio, kind = 'start') {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const notes = kind === 'fail' ? [392, 349, 294, 233] : kind === 'complete' ? [392, 494, 587, 784] : [294, 349, 440, 587];
  notes.forEach((f, i) => {
    const t = ctx.currentTime + i * 0.12;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = kind === 'complete' ? 'triangle' : 'sawtooth';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g);
    g.connect(audio.music ?? audio.master);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

// Wanted-level change: a two-note brass jab, higher with more stars.
export function playWantedSting(audio, stars) {
  if (!audio.started || stars <= 0) return;
  const ctx = audio.ctx;
  const base = 220 + stars * 40;
  [base, base * 1.5].forEach((f, i) => {
    const t = ctx.currentTime + i * 0.14;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

// Harbour FM's jingle: a four-bar synth loop scheduled a little ahead, in C minor, with a soft pad.
const JINGLE_ROOT = [261.63, 233.08, 207.65, 196.0];
const JINGLE_MELODY = [0, 3, 7, 10, 7, 3, 0, -2, 0, 3, 8, 12, 8, 3, 0, -2];

export function startRadio(audio) {
  if (!audio.started || audio.radioTimer) return;
  audio.radioStep = 0;
  audio.radioNext = audio.ctx.currentTime + 0.2;
  audio.radioTimer = setInterval(() => scheduleRadio(audio), 240);
}

function scheduleRadio(audio) {
  if (!audio.started || audio.muted) return;
  const ctx = audio.ctx;
  const stepDur = 0.26;
  while (audio.radioNext < ctx.currentTime + 0.6) {
    const step = audio.radioStep % 32;
    const bar = Math.floor(step / 8) % 4;
    const root = JINGLE_ROOT[bar];
    const semi = JINGLE_MELODY[step % JINGLE_MELODY.length];
    const t = audio.radioNext;
    // The melody: a plucked triangle.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = root * Math.pow(2, semi / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + stepDur * 0.9);
    osc.connect(g);
    g.connect(audio.music);
    osc.start(t);
    osc.stop(t + stepDur);
    // The bass on every other step.
    if (step % 4 === 0) {
      const bass = ctx.createOscillator();
      const bg = ctx.createGain();
      bass.type = 'sine';
      bass.frequency.value = root / 2;
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.07, t + 0.03);
      bg.gain.exponentialRampToValueAtTime(0.0004, t + stepDur * 1.8);
      bass.connect(bg);
      bg.connect(audio.music);
      bass.start(t);
      bass.stop(t + stepDur * 2);
    }
    // A brushed hat from the noise buffer, off the beat.
    if (step % 2 === 1) {
      const hat = ctx.createBufferSource();
      hat.buffer = audio.noiseBuffer;
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 6000;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.02, t);
      hg.gain.exponentialRampToValueAtTime(0.0004, t + 0.06);
      hat.connect(hf);
      hf.connect(hg);
      hg.connect(audio.music);
      hat.start(t);
      hat.stop(t + 0.08);
    }
    audio.radioStep++;
    audio.radioNext += stepDur;
  }
}

// The radio's track list, shown in the HUD strip and cycled with the mute key.
export const RADIO_TRACKS = [
  'The Quayside Four — "Salt and Neon"',
  'Dovie Marsh — "Low Tide Lover"',
  'Cannery Choir — "Nine Hours of Rain"',
  'The Cormorant Brothers — "Pay What You Owe"',
  'Marla Vane — "Last Call"',
];

export function setMuted(audio, muted) {
  audio.muted = muted;
  if (!audio.started) return;
  audio.master.gain.setTargetAtTime(muted ? 0 : 0.55, audio.ctx.currentTime, 0.1);
}

// A distant police radio squawk when a patrol spots you, used on the wanted sting.
export function playSquawk(audio) {
  if (!audio.started) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.setValueAtTime(860, t + 0.07);
  osc.frequency.setValueAtTime(1400, t + 0.13);
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  osc.connect(g);
  g.connect(audio.master);
  osc.start(t);
  osc.stop(t + 0.22);
}
