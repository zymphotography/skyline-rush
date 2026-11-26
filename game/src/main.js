// Skyline Rush: the game loop and the screen state machine. Title lets the
// pilot pick a mission; play flies it; a landing completes it and a crash
// ends it. With ?shot=start|play|land|end the page renders one staged frame
// instead, for screenshots.

import { FIELD, STEP, MISSIONS, BEST_KEY } from './tuning.js';
import { buildWorld } from './terrain.js';
import { createPlane, stepFlight, FLYING, LANDED, CRASHED } from './flight.js';
import { createInput, readControl, wasPressed, clearPressed } from './input.js';
import { createSound } from './sound.js';
import {
  drawScene,
  SCREEN_TITLE,
  SCREEN_PLAY,
  SCREEN_PAUSED,
  SCREEN_COMPLETE,
  SCREEN_CRASHED,
} from './render.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusLine = document.getElementById('status');

const input = createInput(canvas);
const sound = createSound();

const sim = {
  world: buildWorld(MISSIONS[0]),
  plane: null,
  mission: MISSIONS[0],
};
sim.plane = createPlane(sim.world);

let screen = SCREEN_TITLE;
let best = 0;
try {
  best = Number(window.localStorage.getItem(BEST_KEY) ?? 0) || 0;
} catch {
  best = 0;
}
let time = 0;
let lastRings = 0;
let lastStatus = FLYING;
let accumulator = 0;
let lastNow = performance.now();

/** Start the named mission from the runway threshold. */
function startMission(index) {
  const mission = MISSIONS[index];
  sim.mission = mission;
  sim.world = buildWorld(mission);
  sim.plane = createPlane(sim.world);
  screen = SCREEN_PLAY;
  lastRings = 0;
  lastStatus = FLYING;
  sound.unlock();
  statusLine.textContent = `${mission.name}: fly through ${mission.rings} rings, then land on the runway.`;
}

/** Back to the mission list, with the aircraft parked on the dawn strip. */
function backToTitle() {
  sim.mission = MISSIONS[0];
  sim.world = buildWorld(MISSIONS[0]);
  sim.plane = createPlane(sim.world);
  screen = SCREEN_TITLE;
  statusLine.textContent = 'Skyline Rush: pick a mission to fly.';
}

function saveBest() {
  if (sim.plane.score > best) {
    best = sim.plane.score;
    try {
      window.localStorage.setItem(BEST_KEY, String(best));
    } catch {
      // A browser that refuses storage still keeps the score for this visit.
    }
  }
}

function handleMenus() {
  if (screen === SCREEN_TITLE) {
    if (wasPressed(input, 'Digit1')) startMission(0);
    else if (wasPressed(input, 'Digit2')) startMission(1);
    else if (wasPressed(input, 'Digit3')) startMission(2);
    else if (input.pointerDown) {
      // Clicking a mission card starts it.
      const rect = canvas.getBoundingClientRect();
      const x = ((input.pointerX - rect.left) / rect.width) * FIELD.width;
      const y = ((input.pointerY - rect.top) / rect.height) * FIELD.height;
      const cardW = 340;
      const gap = 24;
      const totalW = cardW * 3 + gap * 2;
      const startX = (FIELD.width - totalW) / 2;
      for (let i = 0; i < 3; i += 1) {
        if (x >= startX + i * (cardW + gap) && x <= startX + i * (cardW + gap) + cardW && y >= 240 && y <= 348) {
          startMission(i);
          break;
        }
      }
      input.pointerDown = false;
    }
  } else if (screen === SCREEN_PLAY) {
    if (wasPressed(input, 'KeyP')) screen = SCREEN_PAUSED;
  } else if (screen === SCREEN_PAUSED) {
    if (wasPressed(input, 'KeyP') || wasPressed(input, 'Enter')) screen = SCREEN_PLAY;
  } else if (screen === SCREEN_COMPLETE || screen === SCREEN_CRASHED) {
    if (wasPressed(input, 'KeyR')) startMission(MISSIONS.indexOf(sim.mission));
    else if (wasPressed(input, 'Enter')) backToTitle();
  }
  clearPressed(input);
}

function frame(now) {
  const elapsed = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  time += elapsed;

  handleMenus();
  if (screen === SCREEN_PLAY) {
    sound.unlock();
    accumulator += elapsed;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      const control = readControl(input, canvas);
      stepFlight(sim.plane, control, sim.world, STEP);
      if (sim.plane.ringsPassed > lastRings) {
        lastRings = sim.plane.ringsPassed;
        sound.ring();
      }
      if (sim.plane.status !== lastStatus) {
        if (sim.plane.status === LANDED) {
          sound.land();
          saveBest();
          screen = SCREEN_COMPLETE;
          statusLine.textContent = `Mission complete. Score ${sim.plane.score}.`;
        } else if (sim.plane.status === CRASHED) {
          sound.crash();
          saveBest();
          screen = SCREEN_CRASHED;
          statusLine.textContent = 'Aircraft lost. Press R to try again.';
        }
        lastStatus = sim.plane.status;
      }
    }
    sound.engineNote(sim.plane.throttle, sim.plane.speed);
    if (sim.plane.messageTimer > 0 && sim.plane.fuel < 15) sound.warn();
  }

  // The canvas is the window; the game is a fixed 1280x720 field scaled in.
  const scale = Math.min(canvas.width / FIELD.width, canvas.height / FIELD.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawScene(ctx, sim, screen, time, best);
  requestAnimationFrame(frame);
}

function fitCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', fitCanvas);
fitCanvas();

// A staged screenshot (?shot=...&seed=...): one frame, no loop, no input.
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  const staged = stageShot(shot, sim);
  time = 12; // a midday sun angle for the staged frames
  const scale = Math.min(canvas.width / FIELD.width, canvas.height / FIELD.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawScene(ctx, sim, staged.screen, time, best);
  document.title = `Skyline Rush — ${shot}`;
} else {
  requestAnimationFrame(frame);
}
