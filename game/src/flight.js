// The aircraft and how it flies: throttle, pitch and bank into speed,
// altitude and heading, with stall, fuel, rings, landings and crashes.
// One fixed step of physics per call; the renderer only ever reads state.

import { PLANE, STEP } from './tuning.js';
import { groundUnder } from './terrain.js';

export const FLYING = 'flying';
export const LANDED = 'landed';
export const CRASHED = 'crashed';

/** A fresh aircraft, sitting on the departure strip, engine idling. */
export function createPlane(world) {
  const strip = world.startStrip;
  return {
    x: strip.x,
    y: strip.ground + 1.5,
    z: strip.z0 + 40,
    heading: 0, // radians, 0 is straight down the runway (+z)
    pitch: 0,
    bank: 0,
    speed: 0,
    throttle: 0,
    fuel: world.mission.fuel,
    verticalSpeed: 0,
    score: 0,
    ringsPassed: 0,
    ringsTotal: world.rings.length,
    status: FLYING,
    onGround: true,
    message: '',
    messageTimer: 0,
    time: 0,
    landedBonus: 0,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDifference(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Show a short message on the HUD (a ring, a warning, a landing). */
function announce(plane, text, seconds) {
  plane.message = text;
  plane.messageTimer = seconds;
}

/**
 * One physics step. `control` is { pitch, bank, throttle } with pitch and
 * bank in [-1, 1] and throttle in [0, 1]; the aircraft eases toward them,
 * so the controls answer at every speed but never snap.
 */
export function stepFlight(plane, control, world, dt = STEP) {
  if (plane.status !== FLYING) return plane;
  const mission = world.mission;
  plane.time += dt;

  // Throttle: the lever moves toward the commanded setting; an empty tank
  // forces it shut and the aircraft glides.
  const wantThrottle = plane.fuel > 0 ? clamp(control.throttle, 0, 1) : 0;
  const throttleStep = PLANE.throttleRate * dt;
  plane.throttle += clamp(wantThrottle - plane.throttle, -throttleStep, throttleStep);
  // A full tank lasts about five minutes at full throttle, longer at part
  // throttle: fuel is a decision, not a countdown.
  plane.fuel = Math.max(0, plane.fuel - plane.throttle * PLANE.fuelBurn * dt);

  // Pitch and bank ease toward the commanded attitude.
  const wantPitch = clamp(control.pitch, -1, 1) * PLANE.maxPitch;
  const wantBank = clamp(control.bank, -1, 1) * PLANE.maxBank;
  plane.pitch += clamp(wantPitch - plane.pitch, -PLANE.pitchRate * dt, PLANE.pitchRate * dt);
  plane.bank += clamp(wantBank - plane.bank, -PLANE.bankRate * dt, PLANE.bankRate * dt);

  // Speed: the engine pulls toward throttle * maxSpeed; climbing bleeds it,
  // diving feeds it; drag grows with the square of speed.
  const stalled = plane.speed < PLANE.stallSpeed && plane.y > groundUnder(world, plane.x, plane.z) + 4;
  const targetSpeed = plane.throttle * PLANE.maxSpeed;
  let accel = (targetSpeed - plane.speed) * 0.28;
  accel -= Math.sin(plane.pitch) * 22; // climbing costs speed, diving pays it back
  accel -= plane.speed * plane.speed * 0.0011; // drag
  if (stalled) accel -= 14; // a stalled wing gives up
  plane.speed = Math.max(0, plane.speed + accel * dt);

  // A stall drops the nose: the aircraft answers the stick less and sinks.
  if (stalled) {
    plane.pitch += (0 - plane.pitch) * 0.4 * dt * 4 - 0.25 * dt;
  }

  // Heading: bank turns the aircraft — banking right (positive bank) turns
  // right, toward +x, so the heading grows with the bank.
  const turnRate = plane.bank * PLANE.turnFactor * plane.speed;
  plane.heading += turnRate * dt;

  // Vertical speed comes from pitch and speed; a stalled wing sinks hard.
  // On the runway the wings cannot lift the aircraft until it is fast
  // enough: below liftoff speed the roll stays on the ground.
  plane.verticalSpeed = plane.speed * Math.sin(plane.pitch) * PLANE.climbFactor;
  if (stalled) plane.verticalSpeed -= 3;
  if (plane.onGround && plane.speed < PLANE.liftoffSpeed) plane.verticalSpeed = 0;
  plane.y += plane.verticalSpeed * dt;

  // Forward motion, plus the mission's crosswind pushing the aircraft
  // sideways: a steady drift the pilot must correct for on final approach.
  const windSpeed = mission.wind * 1.2; // m/s, across the runway
  const forwardX = Math.sin(plane.heading);
  const forwardZ = Math.cos(plane.heading);
  plane.x += (forwardX * plane.speed + windSpeed) * dt;
  plane.z += forwardZ * plane.speed * dt;

  // Ground contact: only a touchdown is judged — the moment the aircraft
  // meets the ground from the air. Rolling along the strip on takeoff, or
  // taxiing after a landing, is not a crash.
  const ground = groundUnder(world, plane.x, plane.z);
  const wasOnGround = plane.onGround;
  plane.onGround = plane.y <= ground + 1.6;
  if (plane.messageTimer > 0) plane.messageTimer -= dt;

  // Rings: flying through the next ring scores and lights the one after it.
  const nextRing = world.rings[plane.ringsPassed];
  if (nextRing) {
    const dz = plane.z - nextRing.z;
    if (Math.abs(dz) < 14) {
      const dx = plane.x - nextRing.x;
      const dy = plane.y - nextRing.y;
      if (Math.hypot(dx, dy) < PLANE.ringRadius) {
        nextRing.passed = true;
        plane.ringsPassed += 1;
        plane.score += PLANE.ringScore;
        announce(plane, `RING ${plane.ringsPassed}/${plane.ringsTotal}  +${PLANE.ringScore}`, 1.6);
        if (plane.ringsPassed === plane.ringsTotal) {
          announce(plane, 'ALL RINGS — LAND ON THE RUNWAY', 3);
        }
      }
    }
    // A ring missed by flying past it stays missed: the course goes on.
    if (dz > 14 && !nextRing.passed) {
      nextRing.passed = false;
      nextRing.missed = true;
      plane.ringsPassed += 1;
      announce(plane, `RING MISSED — ${plane.ringsTotal - plane.ringsPassed} LEFT`, 1.6);
      if (plane.ringsPassed === plane.ringsTotal) {
        announce(plane, 'COURSE DONE — LAND ON THE RUNWAY', 3);
      }
    }
  }

  // Low fuel and stall warnings, while there is still time to act on them.
  if (plane.fuel > 0 && plane.fuel < 15 && plane.messageTimer <= 0) {
    announce(plane, 'LOW FUEL', 1.2);
  }
  if (stalled && plane.messageTimer <= 0) {
    announce(plane, 'STALL — NOSE DOWN, ADD POWER', 1.2);
  }

  // Touching the ground: a landing on the strip, a crash anywhere else.
  // Only a fresh touchdown is judged; rolling on a strip is just rolling.
  // A touchdown that is not a landing is judged by how it happened, and a
  // gentle roll onto the strip after the course is a landing too.
  if (plane.onGround && plane.status === FLYING) {
    const runway = world.runway;
    const onStrip =
      Math.abs(plane.x - runway.x) < runway.width / 2 &&
      plane.z >= runway.z0 - 10 &&
      plane.z <= runway.z1 + 10;
    const nearStrip =
      Math.abs(plane.x - runway.x) < 80 && plane.z > runway.z0 - 300 && plane.z < runway.z1 + 300;
    const headingError = Math.abs(angleDifference(runway.heading, plane.heading));
    const gentle = Math.abs(plane.verticalSpeed) < PLANE.maxSink;
    const slowEnough = plane.speed < PLANE.maxLandSpeed;
    const level = Math.abs(plane.bank) < 0.25 && headingError < 0.18;
    const landable = onStrip && gentle && slowEnough && level && plane.speed > 12 && courseDone(plane);
    if (landable) {
      plane.status = LANDED;
      plane.y = ground + 1.5;
      const fuelBonus = Math.round(plane.fuel * 2);
      const timeBonus = Math.max(0, Math.round(600 - plane.time));
      plane.landedBonus = fuelBonus + timeBonus;
      plane.score += PLANE.landingScore + plane.landedBonus;
      announce(plane, `LANDED  +${PLANE.landingScore}  BONUS +${plane.landedBonus}`, 4);
    } else if (!wasOnGround) {
      // A fresh touchdown that is not a landing.
      if (onStrip && gentle && level && slowEnough) {
        // A touch-and-go: the wheels kiss the strip and the sortie goes on.
        plane.y = ground + 1.5;
        announce(plane, 'TOUCH AND GO', 1.2);
      } else if (!onStrip && gentle && plane.speed <= 12) {
        // A slow roll onto the grass: embarrassing, not fatal.
        plane.y = ground + 1.5;
      } else {
        // Too fast, too hard, off the strip, or sideways: the aircraft is lost.
        plane.status = CRASHED;
        plane.y = ground + 1.5;
        const reason = !onStrip
          ? nearStrip
            ? 'OFF THE RUNWAY — AIRCRAFT LOST'
            : 'TERRAIN STRIKE — AIRCRAFT LOST'
          : !gentle
            ? 'TOO HARD — AIRCRAFT LOST'
            : !slowEnough
              ? 'TOO FAST — AIRCRAFT LOST'
              : 'NOT LEVEL — AIRCRAFT LOST';
        announce(plane, reason, 4);
      }
    }
    if (plane.status === FLYING && plane.verticalSpeed <= 0) {
      // Rolling on the ground: stay on it until the wings lift the aircraft.
      // (When the vertical speed is positive the aircraft is leaving, and the
      // ground must not snap it back down.)
      plane.y = ground + 1.5;
    }
  }

  // Flying past the end of the world with no runway left is a long walk home.
  if (plane.z > world.courseEnd + 400 && plane.status === FLYING) {
    plane.status = CRASHED;
    announce(plane, 'OUT OF FUEL RANGE — DITCHED', 4);
  }
  return plane;
}

/** The next ring the pilot should aim for, or null once the course is done. */
export function nextRing(plane, world) {
  return world.rings[plane.ringsPassed] ?? null;
}

/** True once every ring is passed or missed and the runway is the goal. */
export function courseDone(plane) {
  return plane.ringsPassed >= plane.ringsTotal;
}
