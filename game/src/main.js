// Boot and the frame loop for Vice Harbor: builds the world, wires input, audio, the HUD and the renderer, runs a
// fixed 60 Hz simulation with interpolation, and owns the state machine (title, briefing, playing, paused, busted,
// complete, failed). Also answers ?shot=<name> by posing one deterministic frame and freezing.

import { STEP, STORY, TILE } from './config.js';
import { createWorld, stepWorld, drainEvents } from './world.js';
import { createInput, moveAxis } from './input.js';
import { createRenderer, renderFrame, drawObjectiveArrow } from './render.js';
import { createCamera, resizeCamera, updateCamera, snapCamera, cameraTransform } from './camera.js';
import { createHud, drawHud } from './hud.js';
import { createAudio, unlockAudio, updateEngine, silenceEngine, updateSiren, playShot, playCrash, playExplosion, playHorn, playFootstep, playSting, playWantedSting, playSquawk, playSkid, startRadio, setMuted, RADIO_TRACKS } from './audio.js';
import { saveGame, hasSave, loadRaw, applySave } from './save.js';
import { poseNamed, settleShot } from './shots.js';
import { aimAtPointer, tryEnterExit, playerAim, startReload, selectWeapon } from './player.js';
import { clamp } from './geom.js';
import { startMission, MISSIONS, retryMission, advanceDialogue, briefingFor } from './missions.js';
import { releaseFromCustody } from './police.js';

const canvas = document.getElementById('view');
const hudCanvas = document.getElementById('hud');
const boot = document.getElementById('boot');

const world = createWorld(20261122);
const camera = createCamera();
world.camera = camera;
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const audio = createAudio();
const hud = createHud(hudCanvas, world.city);

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
let mode = 'title';
let acc = 0;
let last = 0;
let frame = 0;
let shotDone = false;
let pausedFrom = 'playing';

world.hooks = makeHooks();
world.hasSave = hasSave();
installAudioUnlock();

// All the callbacks world.js calls: each one is one sound or one small state change, and nothing more.
function makeHooks() {
  return {
    shotSound(kind) {
      playShot(audio, kind);
    },
    drySound() {
      playFootstep(audio, true);
    },
    punchSound() {
      playCrash(audio, 0.4);
    },
    copShotSound() {
      playShot(audio, 'pistol');
    },
    crashSound(strength) {
      playCrash(audio, strength);
    },
    explosionSound() {
      playExplosion(audio);
    },
    hornSound() {
      playHorn(audio);
    },
    stepSound(running) {
      playFootstep(audio, running);
    },
    engineSound(car) {
      updateEngine(audio, car);
    },
    hurtSound() {
      playCrash(audio, 0.5);
    },
    deathSound() {
      playSting(audio, 'fail');
    },
    enterSound() {
      playCrash(audio, 0.25);
    },
    exitSound() {
      playCrash(audio, 0.2);
    },
    stealSound() {
      playSting(audio, 'start');
    },
    lockSound() {
      playSkid(audio);
    },
    scare(ped, x, y, strength) {
      if (audio.started && Math.abs(ped.x - world.player.x) < 500 && strength > 1) playFootstep(audio, true);
    },
  };
}

// The browser needs a gesture before any oscillator may sound; the first key or click does it.
function installAudioUnlock() {
  const unlock = () => {
    unlockAudio(audio);
    if (audio.started) {
      startRadio(audio);
      setMuted(audio, world.muted);
    }
  };
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('mousedown', unlock, { once: true });
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(640, Math.floor(window.innerWidth));
  const h = Math.max(360, Math.floor(window.innerHeight));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  hudCanvas.width = canvas.width;
  hudCanvas.height = canvas.height;
  resizeCamera(camera, canvas.width, canvas.height);
}

window.addEventListener('resize', resize);
resize();

// Input: presses that are not movement are dispatched here, once per event.
input.state.onKey = (code) => {
  if (mode === 'title') return titleKey(code);
  if (mode === 'briefing') return briefingKey(code);
  if (mode === 'busted') return bustedKey(code);
  if (mode === 'complete') return completeKey(code);
  if (mode === 'failed') return failedKey(code);
  if (mode === 'paused') return pausedKey(code);
  if (mode !== 'playing') return;
  playingKey(code);
};

function titleKey(code) {
  if (code === 'ArrowUp' || code === 'KeyW') world.titleChoice = (world.titleChoice + 2) % 3;
  if (code === 'ArrowDown' || code === 'KeyS') world.titleChoice = (world.titleChoice + 1) % 3;
  if (code === 'Enter' || code === 'Space') {
    unlockAudio(audio);
    if (audio.started) startRadio(audio);
    if (world.titleChoice === 0) beginNight();
    else if (world.titleChoice === 1) continueSaved();
    else world.hudEvents.push({ type: 'toast', text: 'W A S D move · mouse aim · E cars · F horn · Esc pause' });
  }
}

// New night: fresh story, fresh patrol, Rey at the hotel.
function beginNight() {
  mode = 'playing';
  world.mode = 'playing';
  world.hasSave = hasSave();
  boot?.classList.add('gone');
  world.hudEvents.push({ type: 'card', card: 'VICE HARBOR', time: 2.4 });
  world.hudEvents.push({ type: 'toast', text: 'Meet ' + MISSIONS[0].giver + ' at the Cormorant Hotel.' });
}

function continueSaved() {
  const data = loadRaw();
  if (!data) {
    world.hudEvents.push({ type: 'toast', text: 'No saved night to continue.' });
    return;
  }
  applySave(world, data);
  snapCamera(camera, world.player.x, world.player.y, 1);
  mode = 'playing';
  world.mode = 'playing';
  boot?.classList.add('gone');
  world.hudEvents.push({ type: 'card', card: 'NIGHT RESUMED', time: 2 });
}

function briefingKey(code) {
  if (code === 'Enter') {
    world.briefing = null;
    const m = world.pendingMission;
    world.pendingMission = null;
    if (m) startMission(world.missions, world, m);
    mode = 'playing';
    world.mode = 'playing';
  } else if (code === 'Escape') {
    world.briefing = null;
    world.pendingMission = null;
    mode = 'playing';
    world.mode = 'playing';
  }
}

function bustedKey(code) {
  if (code === 'Enter' || code === 'Escape') {
    releaseFromCustody(world, null);
    snapCamera(camera, world.player.x, world.player.y, 1);
    mode = 'playing';
    world.mode = 'playing';
  }
}

function completeKey(code) {
  if (code === 'Enter' || code === 'Escape') {
    mode = 'playing';
    world.mode = 'playing';
  }
}

function failedKey(code) {
  if (code === 'Enter') {
    retryMission(world.missions, world);
    snapCamera(camera, world.player.x, world.player.y, 1);
    mode = 'playing';
    world.mode = 'playing';
  } else if (code === 'Escape') {
    world.missions.state = 'available';
    mode = 'playing';
    world.mode = 'playing';
  }
}

function pausedKey(code) {
  if (code === 'Escape') {
    mode = pausedFrom;
    world.mode = mode;
  } else if (code === 'KeyQ') {
    mode = 'title';
    world.mode = 'title';
  } else if (code === 'F5') {
    const ok = saveGame(world);
    world.hudEvents.push({ type: 'toast', text: ok ? 'Night saved.' : 'Saved in memory only: storage is blocked.' });
    world.hasSave = true;
    mode = pausedFrom;
  } else if (code === 'F9') {
    const data = loadRaw();
    if (data) {
      applySave(world, data);
      snapCamera(camera, world.player.x, world.player.y, 1);
      world.hudEvents.push({ type: 'toast', text: 'Night loaded.' });
      mode = 'playing';
      world.mode = 'playing';
    }
  }
}

function playingKey(code) {
  if (code === 'Escape') {
    mode = 'paused';
    world.mode = 'paused';
    pausedFrom = 'playing';
    silenceEngine(audio);
    return;
  }
  if (code === 'F5') {
    const ok = saveGame(world);
    world.hudEvents.push({ type: 'toast', text: ok ? 'Night saved.' : 'Saved in memory only.' });
    world.hasSave = true;
    return;
  }
  if (code === 'F9') {
    const data = loadRaw();
    if (data) {
      applySave(world, data);
      snapCamera(camera, world.player.x, world.player.y, 1);
    }
    return;
  }
  if (code === 'KeyM') {
    world.muted = !world.muted;
    setMuted(audio, world.muted);
    if (world.muted) world.hudEvents.push({ type: 'toast', text: 'Radio off.' });
    else nextTrack();
    return;
  }
  if (code === 'KeyN') {
    nextTrack();
    return;
  }
  if (code === 'KeyE') {
    if (world.missions.dialogue) {
      advanceDialogue(world.missions);
      return;
    }
    if (world.briefing) {
      mode = 'briefing';
      return;
    }
    tryEnterExit(world.player, world, STEP, enterHooks());
    if (world.briefing) mode = 'briefing';
    return;
  }
  if (code === 'KeyR') {
    startReloadSafe();
    return;
  }
  const weaponKeys = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
  if (weaponKeys[code] !== undefined) {
    selectWeaponSafe(weaponKeys[code]);
  }
  if (code === 'KeyF' && world.player.inCar) {
    world.player.inCar.horn = 0.8;
    playHorn(audio);
  }
}

function nextTrack() {
  const i = RADIO_TRACKS.indexOf(world.radioTrack);
  world.radioTrack = RADIO_TRACKS[(i + 1) % RADIO_TRACKS.length];
  world.hudEvents.push({ type: 'toast', text: STORY.radio + ': ' + world.radioTrack });
}

function enterHooks() {
  return {
    onEnterCar(car) {
      world.hudEvents.push({ type: 'toast', text: 'You slide into the ' + car.model.name + '.' });
      playCrash(audio, 0.25);
    },
    onExitCar() {
      silenceEngine(audio);
      playCrash(audio, 0.2);
    },
    onSteal(car) {
      world.hudEvents.push({ type: 'toast', text: 'Lock popped. The ' + car.model.name + ' is yours.' });
      world.pendingHeat += 6;
      playSting(audio, 'start');
    },
    onLockBreak() {
      playSkid(audio);
    },
    onInteract() {
      const m = world.missions.active ? null : MISSIONS[world.missions.index];
      if (m) {
        const spot = world.city.missionSpots[m.where];
        if (Math.hypot(world.player.x - spot.x, world.player.y - spot.y) < 92) {
          world.pendingMission = m;
          world.briefing = briefingFor(m);
          mode = 'briefing';
        }
      }
    },
  };
}

function startReloadSafe() {
  startReload(world.player);
}

function selectWeaponSafe(index) {
  selectWeapon(world.player, index);
}

// The simulation step, shared by the live loop and the shot settling.
function simStep(dt) {
  // Keep the mouse aim in world space for the player module.
  const tf = cameraTransform(camera);
  if (!world.player.inCar) {
    world.mouseAim = aimAtPointer(world.player, tf, { x: input.state.mouseX, y: input.state.mouseY });
  } else {
    world.mouseAim = null;
  }
  world.moveAxis = moveAxis(input);
  stepWorld(world, input, dt);
  handleGameEvents();
  input.endStep();
}

// Story and patrol events that change the game's state rather than just playing a sound.
function handleGameEvents() {
  const events = drainEvents(world, {
    wanted(stars) {
      playWantedSting(audio, stars);
      if (stars > 0) playSquawk(audio);
    },
    sting(kind) {
      playSting(audio, kind);
    },
    kill() {
      playSting(audio, 'start');
    },
    pickup() {
      playSting(audio, 'complete');
    },
  });
  for (const e of events) {
    if (e.type === 'busted') {
      mode = 'busted';
      world.mode = 'busted';
      silenceEngine(audio);
      playSting(audio, 'fail');
    } else if (e.type === 'complete') {
      mode = 'complete';
      world.mode = 'complete';
      world.completeTitle = e.mission.name;
      world.completeReward = e.reward;
      playSting(audio, 'complete');
      world.hudEvents.push({ type: 'toast', text: e.mission.name + ' — passed. +$' + e.reward });
    } else if (e.type === 'failed') {
      mode = 'failed';
      world.mode = 'failed';
      world.completeTitle = e.reason;
      world.hudEvents.push({ type: 'toast', text: 'Mission failed: ' + e.reason });
    } else if (e.type === 'briefing') {
      mode = 'briefing';
      world.mode = 'briefing';
    }
  }
}

// The render half: world, then the HUD in screen space, then the objective arrow.
function draw(dt) {
  renderFrame(renderer, world, dt);
  const ctx = hudCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  const sx = hudCanvas.width / canvas.width;
  ctx.save();
  ctx.scale(sx, sx);
  drawHud(hud, world, mode, dt);
  if (mode === 'playing') drawObjectiveArrow(ctx, world, hudCanvas);
  ctx.restore();
}

function loop(now) {
  requestAnimationFrame(loop);
  if (shotName && shotDone) return;
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  if (mode === 'playing' || mode === 'paused' || mode === 'briefing' || mode === 'busted' || mode === 'complete' || mode === 'failed') {
    // A briefing, a bust or a completed mission holds the world still; the camera still eases.
    if (mode === 'playing') {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        simStep(STEP);
        acc -= STEP;
        steps++;
      }
    } else {
      acc = 0;
    }
    const target = world.player.inCar ?? world.player;
    const speed = world.player.inCar ? Math.abs(world.player.inCar.speed) : world.player.speed;
    updateCamera(camera, target, playerAim(world), speed, dt, world.rng);
    world.camera.shake = Math.max(world.camera.shake, world.pendingShake ?? 0);
    world.pendingShake = 0;
    updateEngine(audio, world.player.inCar ?? { speed: 0, model: { maxSpeed: 300 }, dead: true });
    if (!world.player.inCar) silenceEngine(audio);
    updateSiren(audio, world.police, world.player);
    frame++;
  } else {
    // The title screen still shows the city living behind it.
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 3) {
      world.time += STEP;
      for (const car of world.cars) {
        if (car.ai) {
          car.x += Math.cos(car.angle) * 60 * STEP;
          car.y += Math.sin(car.angle) * 60 * STEP;
        }
      }
      updateCamera(camera, { x: 60 * TILE + Math.sin(world.time * 0.07) * 420, y: 40 * TILE + Math.cos(world.time * 0.05) * 260 }, Math.PI * 0.2, 40, STEP, world.rng);
      acc -= STEP;
      steps++;
    }
  }
  draw(dt);
  if (shotName && !shotDone && frame > 4) shotDone = true;
}

// ?shot=<name>: pose the world, freeze the loop and leave one frame on the canvas for the capture to take.
function runShot(name) {
  resizeCamera(camera, canvas.width, canvas.height);
  poseNamed(world, name);
  // The mission pose is the briefing over a paused world, so it renders in that state rather than in play.
  mode = name === 'mission' ? 'briefing' : 'playing';
  world.mode = mode;
  settleShot(world, (w, inp, dt) => {
    w.moveAxis = { x: 0, y: 0, len: 0 };
    stepWorld(w, { anyDown: () => false, state: { mouseDown: false, mouseClicked: false } }, dt);
    drainEvents(w, {});
  }, input, name === 'mission' ? 2 : 6);
  if (mode === 'playing') {
    updateCamera(camera, world.player.inCar ?? world.player, world.player.inCar ? world.player.inCar.angle : world.player.aim, 0, 0.016, world.rng);
  }
  draw(1 / 60);
  // One more frame so the HUD's transient timers settle with the posed dialogue already in place.
  draw(1 / 60);
  shotDone = true;
  boot?.classList.add('gone');
  window.__viceReady = true;
}

if (shotName) {
  // Shots do not need a live loop; they render exactly once, which also keeps the PNG deterministic.
  runShot(shotName);
} else {
  requestAnimationFrame((t) => {
    last = t;
    boot?.classList.add('gone');
    requestAnimationFrame(loop);
  });
}

// A read-only handle for QA and the capture harness: lets a tool ask where the camera and the cast actually are.
window.__vice = {
  world,
  camera,
  get mode() {
    return mode;
  },
  inspect() {
    const p = world.player;
    const tf = cameraTransform(camera);
    const s = tf.toScreen(p.x, p.y);
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    return {
      mode,
      player: { x: Math.round(p.x), y: Math.round(p.y), tile: world.city.tiles[ty * world.city.width + tx], screen: { x: Math.round(s.x), y: Math.round(s.y) } },
      camera: { x: Math.round(camera.x), y: Math.round(camera.y), zoom: Number(camera.zoom.toFixed(2)) },
      cars: world.cars.length,
      peds: world.peds.length,
      cops: world.police.officers.length,
      copCars: world.police.cars.length,
      stars: world.police.stars,
      heli: !!world.police.heli,
      mission: world.missions.active ? world.missions.active.name : null,
      objective: world.objectiveText,
    };
  },
};
