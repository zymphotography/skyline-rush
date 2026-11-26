// Skyline Rush — every tuning number, colour and mission in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size. Distances are metres,
// speeds are metres per second, altitudes are metres (the HUD shows feet/knots).

export const FIELD = { width: 1280, height: 720 };

// The simulation's fixed step, in seconds: 60 updates a second whatever the
// display's rate.
export const STEP = 1 / 60;

// How far ahead the world is drawn, in metres; rings and the runway sit inside it.
export const DRAW_DISTANCE = 4200;

// The camera sits this far behind the aircraft and this high above it.
export const CAMERA = { behind: 30, above: 9 };

// The aircraft itself.
export const PLANE = {
  maxSpeed: 150, // m/s at full throttle, level flight
  stallSpeed: 30, // below this the nose drops and a STALL warning shows
  liftoffSpeed: 38, // the runway speed at which the wings lift the aircraft
  maxPitch: 0.38, // radians, nose up or down
  maxBank: 1.05, // radians of roll, left or right
  pitchRate: 1.6, // radians per second toward the commanded pitch
  bankRate: 2.6, // radians per second toward the commanded bank
  throttleRate: 0.55, // throttle units per second toward the commanded setting
  climbFactor: 0.85, // how much of speed * sin(pitch) becomes vertical speed
  turnFactor: 0.011, // heading change per second per radian of bank, scaled by speed
  fuelBurn: 0.3, // fuel units per second at full throttle
  ringRadius: 26, // metres: how close the aircraft must pass to a ring's centre
  ringScore: 100,
  landingScore: 500,
  maxSink: 9, // m/s: the hardest touchdown that still counts as a landing
  maxLandSpeed: 95, // m/s: the fastest touchdown that still counts
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// One palette per mission: sky, ground and haze share a single style so the
// terrain and the sky read as one place, not two pictures.
const DAWN = {
  skyTop: '#2e4a7a', skyMid: '#7fa3c8', horizon: '#f6c98a',
  sun: '#ffd9a0', sunGlow: 'rgba(255, 205, 140, 0.55)',
  groundLow: '#4e7a3d', groundMid: '#6d8f43', groundHigh: '#8a7a52',
  snow: '#e9eef2', haze: '#d9c39a', river: '#5f9cc4',
  ring: '#ffd34d', ringDim: '#7fa8d8', runway: '#3c4148',
};
const CANYON = {
  skyTop: '#274b63', skyMid: '#6f9db4', horizon: '#f2b06e',
  sun: '#ffe3b0', sunGlow: 'rgba(255, 214, 150, 0.5)',
  groundLow: '#9a6b43', groundMid: '#b07845', groundHigh: '#7d5a40',
  snow: '#e5d9c5', haze: '#e0b98a', river: '#4e8fb8',
  ring: '#ffb347', ringDim: '#7fa8d8', runway: '#3c4148',
};
const DUSK = {
  skyTop: '#1d2340', skyMid: '#5a4a7a', horizon: '#e07a4e',
  sun: '#ff9a5c', sunGlow: 'rgba(255, 140, 90, 0.5)',
  groundLow: '#3d4a35', groundMid: '#55603f', groundHigh: '#6e6250',
  snow: '#d8d2e0', haze: '#c98a72', river: '#4a6f96',
  ring: '#ff8a5c', ringDim: '#8fa8d8', runway: '#33373f',
};

// The three sorties. Each one is a different place and a different problem:
// open valleys with room to learn, a tight canyon that punishes wide turns,
// and a short runway at dusk with a crosswind that pushes the final approach.
export const MISSIONS = [
  {
    id: 'dawn',
    name: 'Dawn Patrol',
    tagline: 'Six rings over green valleys, then home to the strip.',
    palette: DAWN,
    seed: 11,
    rings: 6,
    fuel: 100,
    wind: 0,
    terrainAmp: 55,
    terrainFreq: 0.0016,
    canyon: 0,
    ringSpread: 170,
    ringHeight: 115,
    runwayLength: 420,
  },
  {
    id: 'canyon',
    name: 'Canyon Run',
    tagline: 'Eight rings down a rock canyon. Wide turns cost you the walls.',
    palette: CANYON,
    seed: 47,
    rings: 8,
    fuel: 88,
    wind: 2,
    terrainAmp: 95,
    terrainFreq: 0.0021,
    canyon: 1,
    ringSpread: 120,
    ringHeight: 105,
    runwayLength: 380,
  },
  {
    id: 'dusk',
    name: 'Dusk Landing',
    tagline: 'Five rings, then a short strip at dusk in a crosswind.',
    palette: DUSK,
    seed: 83,
    rings: 5,
    fuel: 80,
    wind: 6,
    terrainAmp: 70,
    terrainFreq: 0.0018,
    canyon: 0,
    ringSpread: 150,
    ringHeight: 110,
    runwayLength: 360,
  },
];

// Where the best score is kept between visits (this browser only).
export const BEST_KEY = 'skyline-rush.best';
