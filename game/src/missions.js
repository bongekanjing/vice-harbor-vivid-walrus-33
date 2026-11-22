// The story: five named missions for Rey Calloway, each a state machine of objectives with markers, dialogue,
// rewards and fail/retry. The Cormorant Brothers want their harbour back and Rey is the one holding the receipts.

import { STORY } from './config.js';
import { dist, lineClear } from './geom.js';
import { makeCar } from './vehicles.js';

// Objective kinds: goto (drive or walk to a marker), kill (clear a set of hostiles), steal (take a named car to a
// drop), survive (hold out for a timer), collect (pick up crates), escape (lose the heat).
export const MISSIONS = [
  {
    id: 'm1',
    name: 'Last Call at the Cormorant',
    giver: 'Marla Vane',
    where: 'hotel',
    intro: [
      ['Marla Vane', 'Rey Calloway. You look like a man who still owes the Cormorants money.'],
      ['Rey', 'Everybody owes the Cormorants money. That is the business model.'],
      ['Marla Vane', 'They took my ledger out of the hotel safe. Twenty years of who-pays-who.'],
      ['Rey', 'And if I bring it back?'],
      ['Marla Vane', 'You keep your knees. And I pay.'],
    ],
    briefing: 'Marla Vane wants her ledger back from the Cormorant boys holding the old ice house on Cannery Lane.',
    objectives: [
      { text: 'Drive to the ice house on Cannery Lane', kind: 'goto', spot: 'alley', radius: 60 },
      { text: 'Deal with the Cormorant boys', kind: 'kill', count: 3 },
      { text: 'Pick up the ledger', kind: 'collect', spot: 'alley', radius: 40, item: 'ledger' },
      { text: 'Bring the ledger back to Marla at the hotel', kind: 'goto', spot: 'hotel', radius: 56 },
    ],
    reward: 900,
    heat: 12,
    lines: [
      ['Rey', 'Three of them, one door. Bad odds for the door.'],
      ['Marla Vane', 'The ledger. You actually brought it.'],
      ['Rey', 'I brought it. The knees are a bonus.'],
    ],
  },
  {
    id: 'm2',
    name: 'Pier Nine Shakedown',
    giver: 'Ossian Pike',
    where: 'pier',
    intro: [
      ['Ossian Pike', 'Every crate on Pier Nine pays me a tax. Lately they have stopped paying.'],
      ['Rey', 'Maybe they found religion.'],
      ['Ossian Pike', 'They found a shotgun. Go remind them about the tax.'],
    ],
    briefing: 'Ossian Pike taxes every crate in the harbour. The pier crew has stopped paying, and Pike wants a word.',
    objectives: [
      { text: 'Get to Pier Nine', kind: 'goto', spot: 'pier', radius: 64 },
      { text: 'Break up the pier crew', kind: 'kill', count: 4 },
      { text: 'Collect the unpaid tax', kind: 'collect', spot: 'pier', radius: 46, item: 'cash' },
      { text: 'Escape the Marina Patrol', kind: 'escape', stars: 0 },
    ],
    reward: 1400,
    heat: 26,
    lines: [
      ['Rey', 'The tax is paid. In instalments of bad decisions.'],
      ['Ossian Pike', 'Now you run, and you run quiet.'],
    ],
  },
  {
    id: 'm3',
    name: 'The Ice House Run',
    giver: 'Dovie Marsh',
    where: 'docks',
    intro: [
      ['Dovie Marsh', 'I need a car moved from the docks to the market. Uninspected.'],
      ['Rey', 'Uninspected how?'],
      ['Dovie Marsh', 'The kind of uninspected that gets you four stars if you stop.'],
      ['Rey', 'So do not stop.'],
    ],
    briefing: 'Dovie Marsh has a Kestrel GT full of contraband on the docks. Get it to the Old Salt Market without losing it.',
    objectives: [
      { text: 'Take the Kestrel from the docks', kind: 'steal', spot: 'docks', radius: 70, car: 'kestrel' },
      { text: 'Drive it to the Old Salt Market', kind: 'deliver', spot: 'plaza', radius: 70 },
      { text: 'Lose the patrol before they impound it', kind: 'escape', stars: 0 },
    ],
    reward: 2100,
    heat: 34,
    lines: [
      ['Dovie Marsh', 'The paint is scratched. The cargo is not. That is what matters.'],
      ['Rey', 'Tell the patrol I said hello. From a distance.'],
    ],
  },
  {
    id: 'm4',
    name: 'Cormorant Cull',
    giver: 'Marla Vane',
    where: 'warehouse',
    intro: [
      ['Marla Vane', 'The Cormorant Brothers are meeting in Warehouse Nine tonight. All of them.'],
      ['Rey', 'All of them is a lot of them.'],
      ['Marla Vane', 'Bring the SMG. Bring Dovie. Bring whatever you pray to.'],
    ],
    briefing: 'The Cormorant Brothers meet in Warehouse Nine. Marla says end it tonight, and she is not paying for mercy.',
    objectives: [
      { text: 'Reach Warehouse Nine before the meeting ends', kind: 'goto', spot: 'warehouse', radius: 70 },
      { text: 'Take out the Cormorant Brothers', kind: 'kill', count: 6, boss: true },
      { text: 'Survive the patrol response', kind: 'survive', seconds: 45 },
      { text: 'Get clear of the harbour', kind: 'escape', stars: 0 },
    ],
    reward: 3600,
    heat: 48,
    lines: [
      ['Rey', 'Meeting adjourned.'],
      ['Marla Vane', 'You made the news. The good kind. Well. The loud kind.'],
    ],
  },
  {
    id: 'm5',
    name: 'High Tide at the Quay',
    giver: 'Ossian Pike',
    where: 'park',
    intro: [
      ['Ossian Pike', 'Last job. The Cormorants kept a boat at the quay with the rest of the money on it.'],
      ['Rey', 'The rest of the money is a nice phrase.'],
      ['Ossian Pike', 'It is a nice boat. Take the Spitfire, take the money, and get to the park before the sun is up.'],
      ['Rey', 'And if the patrol disagrees?'],
      ['Ossian Pike', 'Then disagree back.'],
    ],
    briefing: 'Ossian Pike says the last of the Cormorant money is on a boat at the quay. Take it, and get to Vesper Green before dawn.',
    objectives: [
      { text: 'Drive to the quay in a Spitfire', kind: 'steal', spot: 'docks', radius: 80, car: 'spitfire' },
      { text: 'Take the money off the boat', kind: 'collect', spot: 'pier', radius: 60, item: 'cash' },
      { text: 'Reach Vesper Green with the money', kind: 'deliver', spot: 'park', radius: 70 },
    ],
    reward: 6000,
    heat: 0,
    lines: [
      ['Ossian Pike', 'High tide, and the harbour is ours again.'],
      ['Rey', 'Rey Calloway. Vice Harbor. Sounds like a business card.'],
    ],
  },
];

// A game's story state: which mission is live, what each objective has done, and the dialogue queue.
export function createMissions() {
  return {
    index: 0,
    active: null,
    state: 'available', // available | active | complete | failed
    objective: 0,
    counters: {},
    dialogue: null,
    dialogueIndex: 0,
    completed: [],
    markers: [],
    timer: 0,
    failedReason: '',
    briefOpen: false,
    checkoutCars: [],
    collected: false,
  };
}

// The mission available at this point in the story (or the one being retried).
export function currentMission(missions) {
  if (missions.active) return missions.active;
  return MISSIONS[Math.min(missions.index, MISSIONS.length - 1)];
}

// Starts a mission: marks the first objective, queues the intro dialogue, spawns any hostiles its objectives need.
export function startMission(ms, world, mission) {
  ms.active = mission;
  ms.state = 'active';
  ms.objective = 0;
  ms.counters = {};
  ms.failedReason = '';
  ms.timer = 0;
  ms.collected = false;
  ms.dialogue = mission.intro;
  ms.dialogueIndex = 0;
  ms.checkoutCars = [];
  buildMarkers(ms, world);
  world.events.push({ type: 'missionStart', mission });
}

// The marker list is rebuilt from the current objective so the HUD and renderer always agree.
export function buildMarkers(ms, world) {
  const m = ms.active;
  ms.markers = [];
  if (!m) {
    if (ms.index < MISSIONS.length) {
      const next = MISSIONS[ms.index];
      const spot = world.city.missionSpots[next.where];
      ms.markers.push({ x: spot.x, y: spot.y, tone: '#ffb46b', primary: true, kind: 'start', label: next.name });
    }
    return;
  }
  const obj = m.objectives[ms.objective];
  if (!obj) return;
  if (obj.spot) {
    const spot = world.city.missionSpots[obj.spot];
    ms.markers.push({ x: spot.x, y: spot.y, tone: '#ffd66b', primary: true, kind: obj.kind, label: obj.text });
  }
}

// Advances the objective when its win condition is met; called every step from main.
export function stepMissions(ms, world, dt) {
  const m = ms.active;
  if (m && ms.state === 'active') {
    const obj = m.objectives[ms.objective];
    if (!obj) return;
    if (obj.kind === 'goto') {
      const spot = world.city.missionSpots[obj.spot];
      if (dist(world.player.x, world.player.y, spot.x, spot.y) < obj.radius) advance(ms, world);
    } else if (obj.kind === 'kill') {
      const alive = world.hostiles.filter((h) => !h.dead).length;
      if (alive === 0) advance(ms, world);
    } else if (obj.kind === 'collect') {
      const spot = world.city.missionSpots[obj.spot];
      if (!ms.collected && dist(world.player.x, world.player.y, spot.x, spot.y) < obj.radius) {
        ms.collected = true;
        world.player.money += obj.item === 'cash' ? 400 : 0;
        world.events.push({ type: 'pickup', item: obj.item });
        advance(ms, world);
      }
    } else if (obj.kind === 'steal') {
      const car = world.player.inCar;
      if (car && car.model.id === obj.car && dist(car.x, car.y, world.city.missionSpots[obj.spot].x, world.city.missionSpots[obj.spot].y) < 700) advance(ms, world);
    } else if (obj.kind === 'deliver') {
      const car = world.player.inCar;
      const spot = world.city.missionSpots[obj.spot];
      const near = car ? dist(car.x, car.y, spot.x, spot.y) : dist(world.player.x, world.player.y, spot.x, spot.y);
      if (near < obj.radius) advance(ms, world);
    } else if (obj.kind === 'survive') {
      ms.timer += dt;
      if (ms.timer >= obj.seconds) advance(ms, world);
    } else if (obj.kind === 'escape') {
      if (world.police.stars <= obj.stars) advance(ms, world);
    }
    // Failing: dying ends the mission, and so does losing a mission car that had to be delivered.
    if (world.player.dead) failMission(ms, world, 'You went down.');
  }
}

// One objective done: queue the next line, then either move on or complete the mission.
function advance(ms, world) {
  const m = ms.active;
  ms.objective++;
  ms.timer = 0;
  ms.collected = false;
  if (ms.objective >= m.objectives.length) {
    completeMission(ms, world);
    return;
  }
  const obj = m.objectives[ms.objective];
  if (obj.kind === 'kill') spawnHostiles(world, ms, obj);
  if (obj.kind === 'steal') ensureCheckoutCar(world, ms, obj);
  if (ms.dialogue) {
    // Let the story breathe: the next line lands a beat after the objective ticks over.
    ms.dialogue = [...ms.dialogue, ['Rey', obj.text]];
  }
  buildMarkers(ms, world);
  world.events.push({ type: 'objective', text: obj.text });
}

// Pay the reward, mark it done, and put the next mission's marker on the map.
function completeMission(ms, world) {
  const m = ms.active;
  ms.state = 'complete';
  world.player.money += m.reward;
  ms.completed.push(m.id);
  ms.index++;
  ms.dialogue = m.lines;
  ms.dialogueIndex = 0;
  ms.markers = [];
  world.events.push({ type: 'missionComplete', mission: m, reward: m.reward });
  ms.active = null;
  buildMarkers(ms, world);
}

// Fail: the mission stays available, the player keeps the story but loses this attempt's progress.
export function failMission(ms, world, reason) {
  if (!ms.active || ms.state !== 'active') return;
  const m = ms.active;
  ms.state = 'failed';
  ms.failedReason = reason;
  for (const h of world.hostiles) h.dead = true;
  world.hostiles.length = 0;
  ms.markers = [];
  world.events.push({ type: 'missionFailed', mission: m, reason });
}

// Retry puts the player back at the giver with the mission reset.
export function retryMission(ms, world) {
  const m = ms.active;
  if (!m) {
    ms.state = 'available';
    return;
  }
  const spot = world.city.missionSpots[m.where];
  world.player.x = spot.x;
  world.player.y = spot.y + 30;
  world.player.inCar = null;
  world.player.dead = false;
  world.player.hp = world.player.maxHp;
  startMission(ms, world, m);
}

// Advance dialogue: `world.advanceDialogue` is set by input and cleared here once a line is consumed.
export function advanceDialogue(ms) {
  if (!ms.dialogue) return;
  ms.dialogueIndex++;
  if (ms.dialogueIndex >= ms.dialogue.length) {
    ms.dialogue = null;
    ms.dialogueIndex = 0;
  }
}

// The line currently on the HUD, or null.
export function currentLine(ms) {
  if (!ms.dialogue) return null;
  const entry = ms.dialogue[Math.min(ms.dialogueIndex, ms.dialogue.length - 1)];
  return entry ? { speaker: entry[0], text: entry[1] } : null;
}

// The mission the player meets at their current spot, if any (a marker you can press E on).
export function missionAtPlayer(ms, world) {
  if (ms.active) return null;
  if (ms.index >= MISSIONS.length) return null;
  const m = MISSIONS[ms.index];
  const spot = world.city.missionSpots[m.where];
  if (dist(world.player.x, world.player.y, spot.x, spot.y) < 90) return m;
  return null;
}

// Enemy shooters for a kill objective: positioned around the objective spot, with SMGs.
export function spawnHostiles(world, ms, obj) {
  const m = ms.active;
  const spot = world.city.missionSpots[m.objectives[ms.objective - 1]?.spot ?? m.where];
  const count = obj.count ?? 3;
  const rng = world.rng;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.5;
    const r = 40 + rng() * 70;
    let x = spot.x + Math.cos(a) * r;
    let y = spot.y + Math.sin(a) * r;
    if (!lineClear(world.city.tiles, spot.x, spot.y, x, y)) {
      x = spot.x + 40;
      y = spot.y;
    }
    world.hostiles.push({
      id: world.hostiles.length + 1,
      x,
      y,
      angle: Math.atan2(spot.y - y, spot.x - x),
      hp: obj.boss ? 130 : 55,
      maxHp: obj.boss ? 130 : 55,
      cooldown: 0.5 + rng() * 0.8,
      dead: false,
      walkPhase: 0,
      strafe: rng() < 0.5 ? 1 : -1,
      think: 1 + rng(),
      boss: !!obj.boss,
      name: obj.boss ? 'Cormorant Brother' : 'Cormorant boy',
    });
  }
}

// Put a mission car where the player can find it, if the city has none of that model handy.
function ensureCheckoutCar(world, ms, obj) {
  const spot = world.city.missionSpots[obj.spot];
  const found = world.cars.find((c) => c.model.id === obj.car && !c.dead && dist(c.x, c.y, spot.x, spot.y) < 400);
  if (found) {
    ms.checkoutCars.push(found.id);
    return;
  }
  const car = makeCar(obj.car, spot.x + 44, spot.y + 20, -0.4, { locked: false, driver: null });
  car.missionCar = true;
  world.cars.push(car);
  ms.checkoutCars.push(car.id);
}

// Hostile shooting is the mirror of the cops': close in, strafe, fire in bursts.
export function stepHostiles(world, dt) {
  const p = world.player;
  for (const h of world.hostiles) {
    if (h.dead) continue;
    h.cooldown -= dt;
    h.think -= dt;
    const d = dist(h.x, h.y, p.x, p.y);
    const see = d < 500 && lineClear(world.city.tiles, h.x, h.y, p.x, p.y);
    const want = Math.atan2(p.y - h.y, p.x - h.x);
    h.angle = want;
    if (d > 190) {
      h.x += Math.cos(want) * 95 * dt;
      h.y += Math.sin(want) * 95 * dt;
      h.walkPhase += dt * 8;
    } else if (d < 110) {
      h.x -= Math.cos(want) * 55 * dt;
      h.y -= Math.sin(want) * 55 * dt;
      h.walkPhase += dt * 6;
    } else {
      const s = want + (Math.PI / 2) * h.strafe;
      h.x += Math.cos(s) * 40 * dt;
      h.y += Math.sin(s) * 40 * dt;
      if (h.think <= 0) {
        h.strafe *= -1;
        h.think = 1.2 + world.rng() * 1.6;
      }
    }
    if (see && h.cooldown <= 0) {
      const a = want + (world.rng() - 0.5) * 0.2;
      world.bullets.push({
        x: h.x + Math.cos(a) * 12,
        y: h.y + Math.sin(a) * 12,
        angle: a,
        speed: 880,
        dmg: h.boss ? 11 : 8,
        life: 0.6,
        from: 'hostile',
        tone: '#ff7a5a',
      });
      world.flashes.push({ x: h.x + Math.cos(a) * 14, y: h.y + Math.sin(a) * 14, angle: a, life: 0.05, maxLife: 0.05 });
      h.cooldown = 0.7 + world.rng() * 0.7;
    }
  }
  // Kills during a mission heat the patrol up, so the story always ends in a chase.
  const m = world.missions.active;
  if (m && world.missions.objective > 0) {
    const obj = m.objectives[world.missions.objective - 1];
    if (obj && obj.kind === 'kill' && world.hostiles.some((h) => h.dead) && world.time - (world.lastKillHeat ?? 0) > 6) {
      world.lastKillHeat = world.time;
      world.pendingHeat = (world.pendingHeat ?? 0) + 6;
    }
  }
}

// A mission the player can start right now: they are near the giver and not already in one.
export function canStartMission(ms, world) {
  if (ms.active || ms.index >= MISSIONS.length) return false;
  const m = MISSIONS[ms.index];
  const spot = world.city.missionSpots[m.where];
  return dist(world.player.x, world.player.y, spot.x, spot.y) < 80;
}

// The mission briefing panel's data: name, giver, objectives and reward, for the HUD to draw.
export function briefingFor(mission) {
  return {
    name: mission.name,
    giver: mission.giver,
    summary: mission.briefing,
    objectives: mission.objectives.map((o) => o.text),
    reward: mission.reward,
    city: STORY.city,
  };
}
