// Progress that survives a closed tab: save and load to localStorage with a try/catch fallback to an in-memory
// snapshot, the title screen's "continue" and a version guard so an old save never breaks a new build.

const KEY = 'vice-harbor-save-v1';
const VERSION = 3;
let fallback = null;

// Everything worth keeping: where Rey is, what he owns, what he has done, and how hot the harbour is.
export function snapshot(world) {
  const p = world.player;
  return {
    version: VERSION,
    savedAt: world.time,
    money: p.money,
    hp: p.hp,
    armour: p.armour,
    weapon: p.weapon,
    ammo: { ...p.ammo },
    x: Math.round(p.x),
    y: Math.round(p.y),
    kills: p.kills,
    storyIndex: world.missions.index,
    completed: [...world.missions.completed],
    objective: world.missions.active ? world.missions.objective : 0,
    missionId: world.missions.active ? world.missions.active.id : null,
    heat: world.police.heat,
    track: world.radioTrack,
    muted: world.muted,
    playSeconds: Math.round(world.time),
  };
}

// Write the snapshot; returns true when it landed in localStorage, false when only in memory.
export function saveGame(world) {
  const data = snapshot(world);
  const text = JSON.stringify(data);
  try {
    window.localStorage.setItem(KEY, text);
    fallback = text;
    return true;
  } catch (err) {
    fallback = text;
    return false;
  }
}

export function hasSave() {
  try {
    const text = window.localStorage.getItem(KEY);
    if (text) return true;
  } catch (err) {
    /* storage blocked: fall through to the in-memory copy */
  }
  return fallback !== null;
}

// The raw saved object, validated; null when there is nothing usable.
export function loadRaw() {
  let text = null;
  try {
    text = window.localStorage.getItem(KEY);
  } catch (err) {
    text = fallback;
  }
  if (!text) text = fallback;
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== VERSION) return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Apply a save to a live world: position, stats, story index and heat.
export function applySave(world, data) {
  const p = world.player;
  p.money = Number(data.money) || 0;
  p.hp = Math.min(p.maxHp, Number(data.hp) || p.maxHp);
  p.armour = Math.min(p.maxArmour, Number(data.armour) || 0);
  p.weapon = data.weapon ?? 'pistol';
  p.ammo = { pistol: 24, smg: 0, shotgun: 0, ...(data.ammo ?? {}) };
  p.x = Number(data.x) || p.x;
  p.y = Number(data.y) || p.y;
  p.inCar = null;
  p.dead = false;
  p.kills = Number(data.kills) || 0;
  world.missions.index = Math.min(Number(data.storyIndex) || 0, 5);
  world.missions.completed = Array.isArray(data.completed) ? data.completed.slice(0, 5) : [];
  world.missions.active = null;
  world.missions.state = 'available';
  world.missions.objective = 0;
  world.police.heat = Number(data.heat) || 0;
  world.radioTrack = typeof data.track === 'string' ? data.track : world.radioTrack;
  world.time = Number(data.playSeconds) || 0;
}

export function clearSave() {
  fallback = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch (err) {
    /* nothing to do: the fallback is already clear */
  }
}
