// The screenshot scenes behind ?shot=start|play|land|end. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered
// by a simple autopilot (bank toward the next ring, pitch toward its height,
// throttle up on the way out and back on final), so the frame is what a
// short game really looks like and the same seed always gives the same frame.

import { STEP, MISSIONS } from './tuning.js';
import { buildWorld, groundUnder } from './terrain.js';
import { createPlane, stepFlight, FLYING, LANDED, CRASHED, nextRing } from './flight.js';
import { SCREEN_TITLE, SCREEN_PLAY, SCREEN_COMPLETE, SCREEN_CRASHED } from './render.js';

const START_SECONDS = 4;
const PLAY_SECONDS = 24;
const LAND_LIMIT_SECONDS = 600;
const SAMPLE = STEP;

function angleDifference(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * The autopilot's memory: the terrain floor it is holding, smoothed so the
 * hills passing underneath do not yank the pitch up and down.
 */
function createAutopilotState() {
  return { floorY: null };
}

/**
 * Steer toward a point in the world: bank into the turn, pitch toward its
 * height, and hold a cruise throttle — or ease off on final approach. The
 * bank term is damped hard against the bank already held, so the autopilot
 * rolls out of a turn instead of wagging across the centreline. On final
 * the pitch is capped shallow, so the descent stays gentle enough to land on.
 */
function autopilot(plane, target, finalApproach, world) {
  const desiredHeading = Math.atan2(target.x - plane.x, target.z - plane.z);
  // Crab into the crosswind: the wind pushes the aircraft sideways, so the
  // nose must point a little into it or the track drifts off the centreline.
  const windSpeed = world.mission.wind * 1.2;
  const crab = Math.asin(Math.min(0.9, windSpeed / Math.max(30, plane.speed)));
  const headingError = angleDifference(desiredHeading - crab, plane.heading);
  const bank = Math.max(-1, Math.min(1, headingError * 2.0 - plane.bank * 0.8));
  const heightError = target.y - plane.y;
  const pitchGain = finalApproach ? 0.03 : 0.012;
  const pitchLimit = finalApproach ? 0.45 : 0.8;
  const pitch = Math.max(-pitchLimit, Math.min(pitchLimit, heightError * pitchGain - plane.pitch * 0.4));
  const throttle = target.goAround ? 0.65 : finalApproach ? 0.32 : 0.78;
  return { pitch, bank, throttle };
}

/**
 * The final-approach target: a gate 800m ahead on the extended centreline,
 * on a gentle glide slope that never dips below the terrain under the
 * aircraft. The terrain floor is smoothed, so it moves like a hill, not a
 * step. Over the strip itself the floor drops away, so the aircraft can
 * settle onto the runway. Overshoot the strip and the target moves behind
 * for a go-around: climb, turn back, and rejoin the approach.
 */
function approachTarget(plane, world, ap) {
  const runway = world.runway;
  if (plane.z > runway.z1 + 50) {
    return { x: runway.x, y: runway.ground + 120, z: runway.z0 - 800, goAround: true };
  }
  // In the landing zone — lined up over the strip, near the threshold — the
  // target drops just below the strip, so the aircraft commits to the
  // touchdown instead of floating a few metres above it forever.
  const landingZone =
    Math.abs(plane.x - runway.x) < 30 && plane.z > runway.z0 - 300 && plane.z < runway.z1 + 50;
  if (landingZone) {
    return { x: runway.x, y: runway.ground - 3, z: plane.z + 500, goAround: false };
  }
  const distanceToThreshold = runway.z0 - plane.z;
  const slopeY = runway.ground + Math.max(1.5, distanceToThreshold * 0.1);
  const overStrip =
    Math.abs(plane.x - runway.x) < 30 && plane.z > runway.z0 - 100 && plane.z < runway.z1 + 100;
  const rawFloor = overStrip ? runway.ground + 2 : groundUnder(world, plane.x, plane.z) + 25;
  // The floor may move at most 0.1m a step (6 m/s): the hills pass smoothly.
  if (ap.floorY === null) ap.floorY = rawFloor;
  else ap.floorY += Math.max(-0.1, Math.min(0.1, rawFloor - ap.floorY));
  return { x: runway.x, y: Math.max(slopeY, ap.floorY), z: plane.z + 500, goAround: false };
}

export { autopilot, createAutopilotState, approachTarget, flyForward };
export { angleDifference };

/** Run the simulation forward until the plane lands, crashes, or time runs out. */
function flyForward(plane, world, seconds, targetFn) {
  const steps = Math.floor(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    if (plane.status !== FLYING) break;
    const control = targetFn(plane, world);
    stepFlight(plane, control, world, SAMPLE);
  }
}

/**
 * Set `sim` to the named scene (start, play, land or end; any other name is
 * start) in the given mission (0 Dawn, 1 Canyon, 2 Dusk; default Dawn) and
 * return the screen to draw over it.
 */
export function stageShot(name, sim, missionIndex = 0) {
  const mission = MISSIONS[Math.max(0, Math.min(MISSIONS.length - 1, missionIndex))];
  const world = buildWorld(mission);
  const plane = createPlane(world);
  sim.world = world;
  sim.plane = plane;
  sim.mission = mission;

  if (name !== 'play' && name !== 'land' && name !== 'end') {
    // Title: the Skylark sits on the strip at dawn, engine idling.
    for (let i = 0; i < START_SECONDS / SAMPLE; i += 1) {
      stepFlight(plane, { pitch: 0, bank: 0, throttle: 0.12 }, world, SAMPLE);
    }
    return { screen: SCREEN_TITLE };
  }

  // Take off, then chase the rings with the autopilot.
  const ap = createAutopilotState();
  flyForward(plane, world, PLAY_SECONDS, (p, w) => {
    const ring = nextRing(p, w);
    if (ring) return autopilot(p, { x: ring.x, y: ring.y, z: ring.z }, false, w);
    const target = approachTarget(p, w, ap);
    return autopilot(p, target, true, w);
  });
  if (name === 'play') {
    return { screen: SCREEN_PLAY };
  }

  // Keep flying until the sortie ends: a landing on the strip, or a crash.
  if (name === 'land') {
    // The land scene is the final approach itself: stop the replay once the
    // aircraft is lined up on the threshold, low over the strip.
    const steps = Math.floor(LAND_LIMIT_SECONDS / SAMPLE);
    for (let i = 0; i < steps; i += 1) {
      if (plane.status !== FLYING) break;
      const ring = nextRing(plane, world);
      const control = ring
        ? autopilot(plane, { x: ring.x, y: ring.y, z: ring.z }, false, world)
        : autopilot(plane, approachTarget(plane, world, ap), true, world);
      stepFlight(plane, control, world, SAMPLE);
      const onFinal =
        plane.ringsPassed >= plane.ringsTotal &&
        plane.z > world.runway.z0 - 260 &&
        plane.z < world.runway.z0 + 40 &&
        plane.y < world.runway.ground + 55;
      if (onFinal) break;
    }
    return { screen: SCREEN_PLAY };
  }
  flyForward(plane, world, LAND_LIMIT_SECONDS, (p, w) => {
    const ring = nextRing(p, w);
    if (ring) return autopilot(p, { x: ring.x, y: ring.y, z: ring.z }, false, w);
    return autopilot(p, approachTarget(p, w, ap), true, w);
  });
  return {
    screen: plane.status === LANDED ? SCREEN_COMPLETE : plane.status === CRASHED ? SCREEN_CRASHED : SCREEN_PLAY,
  };
}
