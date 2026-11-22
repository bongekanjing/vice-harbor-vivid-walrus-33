// All of Vice Harbor's tuning in one place: map size, tile ids, dusk palette, speeds, wanted thresholds, car and weapon tables, district names.

export const TILE = 32;
export const MAP_W = 96;
export const MAP_H = 96;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;
export const STEP = 1 / 60;

// Tile ids. The city is a 96x96 byte grid of these.
export const T = { ROAD: 0, PAVEMENT: 1, BUILDING: 2, WATER: 3, DOCK: 4, GRASS: 5, PLAZA: 6 };

// A tile the player, a car or a cop cannot stand in.
export function tileIsSolid(id) {
  return id === T.BUILDING || id === T.WATER;
}

// Street grid: seven avenues north-south, seven streets east-west, plus the quay road
// that runs the whole waterfront. Roads are three tiles wide.
export const ROADS_X = [6, 18, 30, 42, 54, 66, 78];
export const ROADS_Y = [6, 18, 30, 42, 54, 66, 78];
export const QUAY_X = 84;
export const ROAD_HALF = 1;
export const LANE = 20; // pixels from a road's centre line to a lane's centre

// East of WATER_X and south of WATER_Y is harbour water; the piers reach into it.
export const WATER_X = 88;
export const WATER_Y = 90;
export const PIER_X0 = 86;
export const PIER_X1 = 87;
export const PIER_Y0 = 18;
export const PIER_Y1 = 84;

// The dusk palette. Pavements and docks are deliberately light so they read against the asphalt, and roofs sit
// above both: at a glance you should be able to tell road from footpath from rooftop.
export const PALETTE = {
  void: '#0e0c18',
  asphalt: '#2a2636',
  asphalt2: '#312c3e',
  roadLine: '#f0c87a',
  roadEdge: '#4a4358',
  pavement: '#8a7f96',
  pavement2: '#95899f',
  kerb: '#b6a9bd',
  building: '#5a4c62',
  grass: '#3f6449',
  grass2: '#4a7555',
  plaza: '#8d80a2',
  dock: '#a97c60',
  dock2: '#b98a6a',
  water: '#1d4a68',
  water2: '#2a6a88',
  glowWarm: '#ffb46b',
  glowCool: '#7fd3ff',
  duskTop: '#ffb279',
  duskBottom: '#2a2050',
  blood: '#70152a',
  neon: '#ff5f8d',
};

// What a car's paint can be: all invented, all warm dusk colours.
export const CAR_PAINTS = ['#c94f4f', '#d9983f', '#4c7fb8', '#5f9c79', '#c8c0b4', '#8a5fae', '#b8543f', '#3f6f7a'];

// Traffic weights pick which model a civilian drives.
export const CAR_MODELS = [
  { id: 'brantley', name: 'Brantley 88', len: 74, wid: 36, maxSpeed: 250, accel: 165, turn: 2.5, grip: 8.5, mass: 1.15, hp: 130, weight: 26 },
  { id: 'kestrel', name: 'Kestrel GT', len: 78, wid: 34, maxSpeed: 348, accel: 235, turn: 2.7, grip: 8.0, mass: 0.95, hp: 100, weight: 10 },
  { id: 'cormorant', name: 'Cormorant Van', len: 92, wid: 40, maxSpeed: 196, accel: 118, turn: 1.8, grip: 6.6, mass: 1.65, hp: 190, weight: 18 },
  { id: 'spitfire', name: 'Spitfire Coupe', len: 70, wid: 34, maxSpeed: 300, accel: 200, turn: 2.9, grip: 8.8, mass: 0.9, hp: 92, weight: 12 },
  { id: 'harbour', name: 'Harbour Cab', len: 80, wid: 37, maxSpeed: 236, accel: 150, turn: 2.3, grip: 8.2, mass: 1.2, hp: 140, weight: 22 },
  { id: 'saltpan', name: 'Saltpan Pickup', len: 86, wid: 38, maxSpeed: 214, accel: 135, turn: 2.0, grip: 7.0, mass: 1.45, hp: 170, weight: 12 },
];

export const POLICE_MODEL = {
  id: 'patrol', name: 'Marina Patrol', len: 84, wid: 38, maxSpeed: 306, accel: 215, turn: 2.6, grip: 8.4, mass: 1.3, hp: 210, weight: 0,
};

export function modelById(id) {
  if (id === POLICE_MODEL.id) return POLICE_MODEL;
  return CAR_MODELS.find((m) => m.id === id) ?? CAR_MODELS[0];
}

// Guns. Damage per bullet, seconds between shots, muzzle spread in radians, bullet speed.
export const WEAPONS = [
  { id: 'fist', name: 'Fists', dmg: 9, rate: 0.42, spread: 0, pellets: 1, bulletSpeed: 0, range: 26, ammo: Infinity },
  { id: 'pistol', name: 'Quayside 9mm', dmg: 21, rate: 0.26, spread: 0.04, pellets: 1, bulletSpeed: 1050, range: 620, ammo: 12 },
  { id: 'smg', name: 'Cannery SMG', dmg: 13, rate: 0.085, spread: 0.10, pellets: 1, bulletSpeed: 1120, range: 560, ammo: 40 },
  { id: 'shotgun', name: 'Dockmaster 12g', dmg: 11, rate: 0.78, spread: 0.20, pellets: 6, bulletSpeed: 900, range: 330, ammo: 8 },
];

export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

// Heat is 0..100; these are the floors for one to five stars.
export const STAR_HEAT = [0, 18, 40, 60, 80, 94];
export const HEAT_DECAY = 4.2;
export const HEAT_DECAY_DELAY = 7.5;
export const COP_CALM = 0.55; // seconds of calm before police stop shooting

export const PLAYER = {
  radius: 9,
  walk: 118,
  run: 196,
  accel: 1400,
  hp: 100,
  armour: 0,
  money: 350,
  fovSpread: 0.05,
};

export const TRAFFIC = {
  cars: 34,
  peds: 46,
  cruise: 0.42, // fraction of a model's top speed for a civilian on the road
  copCount: [0, 1, 2, 3, 4, 5],
};

// Named neighbourhoods, west to east and north to south, for the minimap's area readout.
export const DISTRICTS = [
  { name: 'Vesper Heights', x0: 0, y0: 0, x1: 48, y1: 30 },
  { name: 'Cannery Row', x0: 0, y0: 30, x1: 48, y1: 60 },
  { name: 'Old Salt Market', x0: 0, y0: 60, x1: 48, y1: 90 },
  { name: 'Cormorant Docks', x0: 48, y0: 0, x1: 88, y1: 42 },
  { name: 'Marlowe Quay', x0: 48, y0: 42, x1: 88, y1: 70 },
  { name: 'Pier Nine', x0: 48, y0: 70, x1: 88, y1: 90 },
  { name: 'The Spits', x0: 0, y0: 90, x1: 96, y1: 96 },
];

export const STORY = {
  city: 'Vice Harbor',
  hero: 'Rey Calloway',
  tagline: 'A harbour, two brothers, and one long night.',
  radio: 'Harbour FM 88.6',
};

// Colours for a pedestrian's clothes, cycled by the peds module.
export const PED_COLOURS = ['#d9b382', '#7a8fa8', '#b5566b', '#5f9c79', '#c9a04a', '#8a6fa8', '#6f8f9c', '#c47a4a'];
