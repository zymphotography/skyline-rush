// The world a mission flies over: a heightfield of rolling ground, the ring
// course, the runway home, and the trees, clouds and river that make the
// ground recognisable. Everything is placed from the mission's seed, so the
// same mission always builds the same world.

import { seededRandom, range } from './random.js';

// How far the ground is sampled sideways when a ring course is laid out.
const COURSE_HALF_WIDTH = 260;

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build one mission's world. Returns the height function and the objects the
 * renderer and the flight model read: rings, runway, trees, clouds.
 */
export function buildWorld(mission) {
  const random = seededRandom(mission.seed);
  const amp = mission.terrainAmp;
  const freq = mission.terrainFreq;

  // Four seeded phases, so each mission's hills fall in different places.
  const p1 = random() * Math.PI * 2;
  const p2 = random() * Math.PI * 2;
  const p3 = random() * Math.PI * 2;
  const p4 = random() * Math.PI * 2;

  /** Ground height in metres at world (x, z). */
  function heightAt(x, z) {
    let h = amp * 0.55 * Math.sin(x * freq * 1.1 + p1) * Math.sin(z * freq * 0.9 + p2);
    h += amp * 0.3 * Math.sin(x * freq * 2.3 + p3) * Math.sin(z * freq * 1.7 + p4);
    h += amp * 0.08 * Math.sin((x + z) * freq * 3.1 + p1 + p2);
    h += 12; // the valleys sit a little above zero
    if (mission.canyon) {
      // Canyon walls: the ground climbs steeply outside the corridor, so a
      // wide turn meets rock. Inside the corridor the floor stays low.
      const outside = Math.abs(x) - 300;
      h += smoothstep(0, 260, outside) * 120;
    }
    return h;
  }

  /** The river's centre line: a slow S-curve the ground dips toward. */
  function riverX(z) {
    return 210 * Math.sin(z * 0.00042 + p3) + 60 * Math.sin(z * 0.0011 + p1);
  }

  // The ring course: a wandering line down the valley, each ring high enough
  // above the ground below it that a careful pilot threads it level. The
  // first ring sits far enough out that the aircraft can climb to its height
  // after takeoff before it gets there.
  const rings = [];
  let ringX = 0;
  let ringZ = 900;
  for (let i = 0; i < mission.rings; i += 1) {
    ringX += range(random, -mission.ringSpread, mission.ringSpread);
    ringX = Math.max(-COURSE_HALF_WIDTH, Math.min(COURSE_HALF_WIDTH, ringX));
    const ground = heightAt(ringX, ringZ);
    const y = ground + range(random, mission.ringHeight * 0.75, mission.ringHeight * 1.25);
    rings.push({ x: ringX, y, z: ringZ, passed: false });
    ringZ += range(random, 430, 560);
  }

  // The runway sits past the last ring, aligned with the course, on ground
  // flattened for its length: home is a straight strip, not a hillside.
  const runwayX = Math.max(-120, Math.min(120, ringX * 0.4));
  const runwayZ = ringZ + 620;
  const runwayGround = heightAt(runwayX, runwayZ);
  const runway = {
    x: runwayX,
    z0: runwayZ,
    z1: runwayZ + mission.runwayLength,
    width: 26,
    ground: runwayGround,
    heading: 0,
  };

  // The departure strip sits at the start of the course, where the aircraft
  // begins: the pilot takes off into the rings and lands on the runway home.
  const startGround = heightAt(0, 0);
  const startStrip = {
    x: 0,
    z0: -60,
    z1: 360,
    width: 26,
    ground: startGround,
    heading: 0,
  };

  // Trees dot the valleys, never on either strip or under a ring. Most grow
  // in forest clumps; a few stand alone. A tree carries a shade value so
  // the canopy reads in two greens.
  const trees = [];
  const nearStrip = (x, z) =>
    (Math.abs(x - runwayX) < 40 && z > runway.z0 - 380 && z < runway.z1 + 80) ||
    (Math.abs(x) < 40 && z > -140 && z < 440);
  const underRing = (x, z) => rings.some((r) => Math.hypot(x - r.x, z - r.z) < 70);
  for (let c = 0; c < 11; c += 1) {
    const cx = range(random, -650, 650);
    const cz = range(random, 150, runwayZ + 400);
    const count = Math.floor(range(random, 10, 20));
    const spread = range(random, 45, 95);
    for (let i = 0; i < count; i += 1) {
      const x = cx + range(random, -spread, spread);
      const z = cz + range(random, -spread, spread);
      if (nearStrip(x, z) || underRing(x, z)) continue;
      trees.push({ x, y: heightAt(x, z), z, size: range(random, 7, 14), shade: random() });
    }
  }
  for (let i = 0; i < 70; i += 1) {
    const x = range(random, -700, 700);
    const z = range(random, 150, runwayZ + 500);
    if (nearStrip(x, z) || underRing(x, z)) continue;
    const y = heightAt(x, z);
    trees.push({ x, y, z, size: range(random, 7, 13), shade: random() });
  }

  // Lakes: still water away from the course and both strips, so the ground
  // has blue to break the green and brown.
  const lakes = [];
  for (let i = 0; i < 12 && lakes.length < 3; i += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * range(random, 380, 620);
    const z = range(random, 350, runwayZ - 100);
    if (Math.abs(x - runwayX) < 160 && z > runway.z0 - 400 && z < runway.z1 + 100) continue;
    if (rings.some((r) => Math.hypot(x - r.x, z - r.z) < 150)) continue;
    lakes.push({ x, z, rx: range(random, 70, 150), rz: range(random, 45, 95) });
  }

  // Clouds drift above the course, high enough to fly under, low enough to
  // read as weather rather than wallpaper.
  const clouds = [];
  for (let i = 0; i < 34; i += 1) {
    clouds.push({
      x: range(random, -900, 900),
      y: range(random, 330, 520),
      z: range(random, 200, runwayZ + 800),
      size: range(random, 60, 170),
    });
  }

  // High cirrus streaks, thin and far above the course.
  const cirrus = [];
  for (let i = 0; i < 9; i += 1) {
    cirrus.push({
      x: range(random, -1200, 1200),
      y: range(random, 560, 700),
      z: range(random, 400, runwayZ + 1200),
      size: range(random, 180, 380),
    });
  }

  return {
    mission,
    heightAt,
    riverX,
    rings,
    runway,
    startStrip,
    trees,
    clouds,
    cirrus,
    lakes,
    courseEnd: runwayZ + mission.runwayLength,
  };
}

/** The ground height under either strip is flattened, and so is the clear
 * approach before the landing runway: a pilot must be able to descend onto
 * the strip from level ground, not over a hillside that stands above it. */
export function groundUnder(world, x, z) {
  const runway = world.runway;
  if (Math.abs(x - runway.x) < 30 && z >= runway.z0 - 300 && z <= runway.z1 + 10) {
    return runway.ground;
  }
  const strip = world.startStrip;
  if (Math.abs(x - strip.x) < 30 && z >= strip.z0 - 100 && z <= strip.z1 + 10) {
    return strip.ground;
  }
  return world.heightAt(x, z);
}
