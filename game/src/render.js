// The renderer: a pseudo-3D chase view drawn on a 2D canvas. The world is
// projected from the camera behind the aircraft, the ground is drawn as
// receding bands of real terrain, rings and the runway are projected
// objects, and the HUD is drawn flat on top. Screens are TITLE, PLAY,
// PAUSED, COMPLETE and CRASHED.

import { FIELD, FONT, CAMERA, DRAW_DISTANCE, PLANE, MISSIONS } from './tuning.js';
import { groundUnder } from './terrain.js';
import { FLYING, LANDED, CRASHED, nextRing, courseDone } from './flight.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_COMPLETE = 'complete';
export const SCREEN_CRASHED = 'crashed';

// --- small colour helpers -------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// A deterministic wobble for ground texture, from two integers.
function hash2(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// --- projection -----------------------------------------------------------

function makeProjector(plane, time) {
  const heading = plane.heading;
  const focal = FIELD.height * 1.15;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const camX = plane.x - forwardX * CAMERA.behind;
  const camY = plane.y + CAMERA.above;
  const camZ = plane.z - forwardZ * CAMERA.behind;
  // The horizon slides with pitch: nose up looks at sky, nose down at ground.
  const horizonY = FIELD.height * 0.46 - Math.tan(plane.pitch) * focal * 0.55;
  const cx = FIELD.width / 2;

  function project(x, y, z) {
    const rx = x - camX;
    const ry = y - camY;
    const rz = z - camZ;
    const fwd = rx * forwardX + rz * forwardZ;
    if (fwd < 6) return null;
    const lat = rx * rightX + rz * rightZ;
    const scale = focal / fwd;
    return {
      sx: cx + lat * scale,
      sy: horizonY - ry * scale,
      scale,
      fwd,
    };
  }

  return { project, horizonY, cx, focal, camX, camY, camZ, forwardX, forwardZ };
}

// --- terrain colour -------------------------------------------------------

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbString(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** The ground's colour at one place: height picks the band, the river cuts a blue line, distance hazes it toward the sky. Returns [r, g, b]. */
function groundColour(world, palette, x, z, h, distance) {
  const low = hexToRgb(palette.groundLow);
  const mid = hexToRgb(palette.groundMid);
  const high = hexToRgb(palette.groundHigh);
  const snow = hexToRgb(palette.snow);
  const river = hexToRgb(palette.river);
  const hazeRgb = hexToRgb(palette.haze);
  let base;
  if (h < 30) base = low;
  else if (h < 80) base = mixRgb(low, mid, (h - 30) / 50);
  else if (h < 120) base = mixRgb(mid, high, (h - 80) / 40);
  else base = mixRgb(high, snow, Math.min(1, (h - 120) / 50));
  if (Math.abs(x - world.riverX(z)) < 18) base = mixRgb(base, river, 0.85);
  const haze = Math.min(0.62, (distance / DRAW_DISTANCE) * 0.9);
  return mixRgb(base, hazeRgb, haze);
}

/** Brighten or darken a [r, g, b] colour by a factor, as a canvas colour. */
function shadeRgb(rgb, factor) {
  return rgbString([
    Math.min(255, Math.round(rgb[0] * factor)),
    Math.min(255, Math.round(rgb[1] * factor)),
    Math.min(255, Math.round(rgb[2] * factor)),
  ]);
}

// --- the scene ------------------------------------------------------------

const SLICES = 44;
const SAMPLES = 36;

/** Draw sky, sun, clouds, terrain bands, trees, runway and rings. */
function drawWorld(ctx, sim, time) {
  const { plane, world } = sim;
  const palette = world.mission.palette;
  const proj = makeProjector(plane, time);

  // The whole 3D scene banks with the aircraft; the HUD is drawn flat after.
  ctx.save();
  ctx.translate(proj.cx, proj.horizonY);
  ctx.rotate(-plane.bank);
  ctx.translate(-proj.cx, -proj.horizonY);

  // Sky: a vertical gradient and a low sun the pilot flies toward.
  const sky = ctx.createLinearGradient(0, -200, 0, proj.horizonY + 60);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(0.55, palette.skyMid);
  sky.addColorStop(1, palette.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(-FIELD.width, -FIELD.height, FIELD.width * 3, FIELD.height * 2);
  const sun = proj.project(plane.x + Math.sin(plane.heading) * 3000, 420, plane.z + Math.cos(plane.heading) * 3000);
  if (sun) {
    const glow = ctx.createRadialGradient(sun.sx, sun.sy, 4, sun.sx, sun.sy, 130);
    glow.addColorStop(0, palette.sunGlow);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sun.sx - 140, sun.sy - 140, 280, 280);
    ctx.fillStyle = palette.sun;
    ctx.beginPath();
    ctx.arc(sun.sx, sun.sy, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distant ridges: craggy silhouettes that give the horizon its shape. They
  // are drawn before the ground bands, whose farthest band covers their feet.
  for (const ridge of [
    { dist: 3400, lift: 95, haze: 0.55 },
    { dist: 2400, lift: 60, haze: 0.35 },
  ]) {
    const points = [];
    for (let j = 0; j <= 24; j += 1) {
      const lat = -1900 + (3800 * j) / 24;
      const wx = proj.camX + proj.forwardX * ridge.dist + Math.cos(plane.heading) * lat;
      const wz = proj.camZ + proj.forwardZ * ridge.dist - Math.sin(plane.heading) * lat;
      const h = world.heightAt(wx, wz) * 1.7 + ridge.lift;
      const p = proj.project(wx, h, wz);
      if (p) points.push(p);
    }
    if (points.length > 2) {
      ctx.fillStyle = mixHex(palette.groundHigh, palette.haze, ridge.haze);
      ctx.beginPath();
      ctx.moveTo(points[0].sx, points[0].sy);
      for (const p of points) ctx.lineTo(p.sx, p.sy);
      ctx.lineTo(points[points.length - 1].sx, proj.horizonY + 160);
      ctx.lineTo(points[0].sx, proj.horizonY + 160);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Ground: receding bands, each a row of quads whose colour is the real
  // terrain height at that place, hazed with distance.
  const lines = [];
  for (let i = 0; i < SLICES; i += 1) {
    const d = 26 * Math.pow(1.13, i);
    if (d > DRAW_DISTANCE) break;
    const halfW = (d / proj.focal) * (FIELD.width / 2) * 1.3 + 30;
    const centreX = proj.camX + proj.forwardX * d;
    const centreZ = proj.camZ + proj.forwardZ * d;
    const line = [];
    for (let j = 0; j < SAMPLES; j += 1) {
      const lat = -halfW + (2 * halfW * j) / (SAMPLES - 1);
      const wx = centreX + Math.cos(plane.heading) * lat;
      const wz = centreZ - Math.sin(plane.heading) * lat;
      // Flattened on the runway strip, so the strip sits on the ground.
      const h = groundUnder(world, wx, wz);
      const p = proj.project(wx, h, wz);
      line.push(p ? { ...p, wx, wz, h, d } : null);
    }
    lines.push(line);
  }
  // Farthest band first: from its line down to the bottom of the screen.
  const bottom = FIELD.height + 80;
  for (let k = lines.length - 1; k >= 0; k -= 1) {
    const near = lines[k];
    const far = k === lines.length - 1 ? null : lines[k + 1];
    for (let j = 0; j < SAMPLES - 1; j += 1) {
      const a = near[j];
      const b = near[j + 1];
      if (!a || !b) continue;
      const c = far ? far[j + 1] : { sx: b.sx, sy: bottom };
      const d2 = far ? far[j] : { sx: a.sx, sy: bottom };
      if (!far && (!c || !d2)) continue;
      if (far && (!c || !d2)) continue;
      const bright = 0.99 + hash2(k, j) * 0.02;
      ctx.fillStyle = shadeRgb(groundColour(world, palette, a.wx, a.wz, a.h, a.d), bright);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.lineTo(c.sx, c.sy);
      ctx.lineTo(d2.sx, d2.sy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // The near cap: the ground below the nearest band, down to the bottom of
  // the screen, in the nearest band's own colours.
  const nearest = lines[0];
  if (nearest) {
    for (let j = 0; j < SAMPLES - 1; j += 1) {
      const a = nearest[j];
      const b = nearest[j + 1];
      if (!a || !b) continue;
      const bright = 0.99 + hash2(0, j) * 0.02;
      ctx.fillStyle = shadeRgb(groundColour(world, palette, a.wx, a.wz, a.h, a.d), bright);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.lineTo(b.sx, bottom);
      ctx.lineTo(a.sx, bottom);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Clouds, drifting above the course.
  for (const cloud of world.clouds) {
    const p = proj.project(cloud.x, cloud.y, cloud.z);
    if (!p || p.fwd > DRAW_DISTANCE) continue;
    const r = cloud.size * p.scale;
    if (r < 2) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, r, r * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(p.sx - r * 0.55, p.sy + r * 0.08, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
    ctx.ellipse(p.sx + r * 0.55, p.sy + r * 0.08, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trees on the valleys below.
  const visibleTrees = [];
  for (const tree of world.trees) {
    const p = proj.project(tree.x, tree.y, tree.z);
    if (!p || p.fwd > 1700 || p.sx < -40 || p.sx > FIELD.width + 40) continue;
    visibleTrees.push({ ...p, size: tree.size });
  }
  visibleTrees.sort((a, b) => b.fwd - a.fwd);
  for (const tree of visibleTrees) {
    const h = tree.size * tree.scale;
    if (h < 1.5) continue;
    ctx.fillStyle = '#2c4a26';
    ctx.beginPath();
    ctx.moveTo(tree.sx, tree.sy - h);
    ctx.lineTo(tree.sx - h * 0.55, tree.sy);
    ctx.lineTo(tree.sx + h * 0.55, tree.sy);
    ctx.closePath();
    ctx.fill();
  }

  drawRunway(ctx, sim, proj, time);
  drawRunway(ctx, sim, proj, time, world.startStrip);
  drawRings(ctx, sim, proj, time);

  // The aircraft's shadow on the ground below it.
  if (plane.status === FLYING) {
    const ground = groundUnder(world, plane.x, plane.z);
    if (plane.y - ground > 4) {
      const shadow = proj.project(plane.x, ground + 0.4, plane.z);
      if (shadow) {
        ctx.fillStyle = 'rgba(10, 14, 20, 0.28)';
        ctx.beginPath();
        ctx.ellipse(shadow.sx, shadow.sy, 30 * shadow.scale, 7 * shadow.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

/** A runway strip: asphalt, centreline dashes, threshold bars, edge lights. */
function drawRunway(ctx, sim, proj, time, strip = null) {
  const { world } = sim;
  const runway = strip ?? world.runway;
  const palette = world.mission.palette;
  if (runway.z1 < proj.camZ) return;
  const SEGMENTS = 12;
  const half = runway.width / 2;
  for (let s = 0; s < SEGMENTS; s += 1) {
    const zA = runway.z0 + ((runway.z1 - runway.z0) * s) / SEGMENTS;
    const zB = runway.z0 + ((runway.z1 - runway.z0) * (s + 1)) / SEGMENTS;
    const aL = proj.project(runway.x - half, runway.ground, zA);
    const aR = proj.project(runway.x + half, runway.ground, zA);
    const bL = proj.project(runway.x - half, runway.ground, zB);
    const bR = proj.project(runway.x + half, runway.ground, zB);
    if (!aL || !aR || !bL || !bR) continue;
    const haze = Math.min(0.55, (aL.fwd / DRAW_DISTANCE) * 0.9);
    ctx.fillStyle = mixHex(palette.runway, palette.haze, haze);
    ctx.beginPath();
    ctx.moveTo(aL.sx, aL.sy);
    ctx.lineTo(aR.sx, aR.sy);
    ctx.lineTo(bR.sx, bR.sy);
    ctx.lineTo(bL.sx, bL.sy);
    ctx.closePath();
    ctx.fill();
    // Centreline dash on every other segment.
    if (s % 2 === 0) {
      const cA = proj.project(runway.x - 0.8, runway.ground + 0.15, zA + 4);
      const cB = proj.project(runway.x + 0.8, runway.ground + 0.15, zA + 4);
      const cC = proj.project(runway.x + 0.8, runway.ground + 0.15, zB - 4);
      const cD = proj.project(runway.x - 0.8, runway.ground + 0.15, zB - 4);
      if (cA && cB && cC && cD) {
        ctx.fillStyle = 'rgba(240, 240, 230, 0.9)';
        ctx.beginPath();
        ctx.moveTo(cA.sx, cA.sy);
        ctx.lineTo(cB.sx, cB.sy);
        ctx.lineTo(cC.sx, cC.sy);
        ctx.lineTo(cD.sx, cD.sy);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Edge lights, warm and steady, so the strip reads at dusk. Small by
    // design: a light right beside the camera would otherwise fill the view.
    for (const side of [-half, half]) {
      const light = proj.project(runway.x + side, runway.ground + 0.6, zA);
      if (!light || light.fwd > 2400) continue;
      ctx.fillStyle = 'rgba(255, 200, 110, 0.95)';
      ctx.beginPath();
      ctx.arc(light.sx, light.sy, Math.max(1, Math.min(6, 1.1 * light.scale)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The ring course: the next ring glows gold and pulses; passed rings green. */
function drawRings(ctx, sim, proj, time) {
  const { plane, world } = sim;
  const palette = world.mission.palette;
  const rings = world.rings
    .map((ring, index) => ({ ring, index, p: proj.project(ring.x, ring.y, ring.z) }))
    .filter((entry) => entry.p && entry.p.fwd < DRAW_DISTANCE);
  rings.sort((a, b) => b.p.fwd - a.p.fwd);
  for (const { ring, index, p } of rings) {
    const radius = PLANE.ringRadius * p.scale;
    if (radius < 2) continue;
    // A ring seen head-on is a circle; seen at an angle it flattens, by the
    // cosine between the view direction and the ring's facing.
    const dx = ring.x - proj.camX;
    const dy = ring.y - proj.camY;
    const dz = ring.z - proj.camZ;
    const dist3d = Math.hypot(dx, dy, dz);
    const cosA = Math.min(1, p.fwd / Math.max(1, dist3d));
    const rx = radius * Math.max(0.3, cosA);
    let colour = palette.ringDim;
    let alpha = 0.55;
    if (ring.passed) {
      colour = '#7ddc7d';
      alpha = 0.7;
    } else if (ring.missed) {
      colour = '#c96a5a';
      alpha = 0.45;
    } else if (index === plane.ringsPassed) {
      colour = palette.ring;
      alpha = 0.7 + 0.3 * Math.sin(time * 4);
    }
    ctx.globalAlpha = alpha * 0.3;
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(3, radius * 0.24);
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rx, radius, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.5, radius * 0.07);
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rx, radius, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (index === plane.ringsPassed && p.fwd < 900) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.max(11, Math.min(18, radius * 0.28))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(p.fwd)}m`, p.sx, p.sy - radius - 10);
    }
  }
}

// --- the aircraft ---------------------------------------------------------

function drawPlane(ctx, plane, time) {
  const px = FIELD.width / 2 + plane.bank * 26;
  const py = FIELD.height * 0.66 + plane.pitch * 130;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(plane.bank);
  // Wings: broad, a shallow V of dihedral, red tips, panel lines.
  ctx.fillStyle = '#dfe6ec';
  ctx.strokeStyle = '#5a6672';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-10, 12);
  ctx.lineTo(-118, -2);
  ctx.lineTo(-112, 20);
  ctx.lineTo(-10, 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, 12);
  ctx.lineTo(118, -2);
  ctx.lineTo(112, 20);
  ctx.lineTo(10, 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-118, -2);
  ctx.lineTo(-100, -0.5);
  ctx.lineTo(-96, 18);
  ctx.lineTo(-112, 20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(118, -2);
  ctx.lineTo(100, -0.5);
  ctx.lineTo(96, 18);
  ctx.lineTo(112, 20);
  ctx.closePath();
  ctx.fill();
  // Fuselage: short and tapered — seen from behind, the nose is foreshortened
  // away from the viewer. Red cheatline, glass canopy catching the sky.
  const body = ctx.createLinearGradient(-9, 0, 9, 0);
  body.addColorStop(0, '#b9c4cd');
  body.addColorStop(0.5, '#f2f5f7');
  body.addColorStop(1, '#aeb9c2');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#5a6672';
  ctx.beginPath();
  ctx.moveTo(-9, 30);
  ctx.lineTo(-7, -36);
  ctx.quadraticCurveTo(0, -48, 7, -36);
  ctx.lineTo(9, 30);
  ctx.quadraticCurveTo(0, 36, -9, 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c23b2e';
  ctx.fillRect(-8, -6, 16, 4);
  ctx.fillStyle = '#274b63';
  ctx.beginPath();
  ctx.ellipse(0, -28, 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(-2, -31, 2, 5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Tail: fin and stabiliser below the wings.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-4, 30);
  ctx.lineTo(0, 54);
  ctx.lineTo(4, 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#dfe6ec';
  ctx.strokeStyle = '#5a6672';
  ctx.beginPath();
  ctx.moveTo(-34, 34);
  ctx.lineTo(34, 34);
  ctx.lineTo(28, 42);
  ctx.lineTo(-28, 42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Navigation lights: red port, green starboard, white tail blinking.
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.arc(-114, 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4dff88';
  ctx.beginPath();
  ctx.arc(114, 8, 3, 0, Math.PI * 2);
  ctx.fill();
  if (Math.floor(time * 1.6) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 52, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- the HUD --------------------------------------------------------------

function drawHud(ctx, sim, time) {
  const { plane, world } = sim;
  const palette = world.mission.palette;
  const knots = Math.round(plane.speed * 1.944);
  const feet = Math.round(plane.y * 3.281);
  const vsFpm = Math.round(plane.verticalSpeed * 196.85);
  const headingDeg = ((plane.heading * 57.2958) % 360 + 360) % 360;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Top-left instrument block: speed, altitude, vertical speed, throttle.
  ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
  roundRect(ctx, 14, 14, 208, 108, 10);
  ctx.fill();
  ctx.fillStyle = '#eef1f5';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(`${knots} kt`, 28, 46);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = '#b8c2cc';
  ctx.fillText('SPEED', 28, 66);
  ctx.fillStyle = '#eef1f5';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(`${feet} ft`, 128, 46);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = '#b8c2cc';
  ctx.fillText('ALTITUDE', 128, 66);
  ctx.fillStyle = vsFpm >= 0 ? '#8fd6a0' : '#f2a35e';
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText(`${vsFpm >= 0 ? '+' : ''}${vsFpm} ft/min`, 28, 96);
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(`HDG ${String(Math.round(headingDeg)).padStart(3, '0')}°`, 128, 96);

  // Top-centre compass tape.
  const tapeW = 380;
  const tapeX = FIELD.width / 2 - tapeW / 2;
  ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
  roundRect(ctx, tapeX, 14, tapeW, 44, 10);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(tapeX, 14, tapeW, 44);
  ctx.clip();
  const pxPerDeg = tapeW / 120;
  for (let d = -60; d <= 60; d += 5) {
    const deg = Math.round((headingDeg + d) / 5) * 5;
    const norm = ((deg % 360) + 360) % 360;
    const x = FIELD.width / 2 + (d - (headingDeg - Math.round(headingDeg / 5) * 5)) * pxPerDeg;
    if (x < tapeX - 10 || x > tapeX + tapeW + 10) continue;
    const major = norm % 45 === 0;
    ctx.strokeStyle = major ? '#eef1f5' : '#8b93a3';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.lineTo(x, major ? 38 : 31);
    ctx.stroke();
    if (major) {
      const label = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[norm];
      ctx.fillStyle = '#eef1f5';
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, 52);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.moveTo(FIELD.width / 2 - 6, 14);
  ctx.lineTo(FIELD.width / 2 + 6, 14);
  ctx.lineTo(FIELD.width / 2, 24);
  ctx.closePath();
  ctx.fill();

  // Top-right: score, rings, fuel, mission, time.
  ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
  roundRect(ctx, FIELD.width - 222, 14, 208, 126, 10);
  ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd34d';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(`${plane.score}`, FIELD.width - 28, 46);
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText('SCORE', FIELD.width - 28, 66);
  const ring = nextRing(plane, world);
  ctx.fillStyle = '#eef1f5';
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(
    courseDone(plane) ? 'LAND ON THE RUNWAY' : `RINGS ${plane.ringsPassed}/${plane.ringsTotal}`,
    FIELD.width - 28,
    94,
  );
  // Fuel bar, with its number beside the label instead of over the bar.
  const fuelW = 180;
  const fuelX = FIELD.width - 28 - fuelW;
  const fuelY = 116;
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`FUEL ${Math.round(plane.fuel)}`, fuelX, fuelY - 5);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, fuelX, fuelY, fuelW, 10, 5);
  ctx.fill();
  ctx.fillStyle = plane.fuel < 15 ? '#e5534b' : '#7ddc7d';
  const fuelFrac = Math.max(0, plane.fuel / world.mission.fuel);
  if (fuelFrac > 0) {
    roundRect(ctx, fuelX, fuelY, fuelW * fuelFrac, 10, 5);
    ctx.fill();
  }

  // Bottom-left: throttle lever.
  ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
  roundRect(ctx, 14, FIELD.height - 112, 46, 98, 10);
  ctx.fill();
  const thrH = 58;
  const thrY = FIELD.height - 86;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(32, thrY, 10, thrH);
  ctx.fillStyle = '#ffd34d';
  const thrFill = thrH * plane.throttle;
  ctx.fillRect(32, thrY + thrH - thrFill, 10, thrFill);
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('THR', 37, FIELD.height - 22);
  ctx.fillText(`${Math.round(plane.throttle * 100)}%`, 37, FIELD.height - 8);

  // Bottom-right: artificial horizon.
  const ahX = FIELD.width - 60;
  const ahY = FIELD.height - 55;
  const ahR = 42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ahX, ahY, ahR, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(ahX, ahY);
  ctx.rotate(-plane.bank);
  ctx.translate(0, plane.pitch * 90);
  ctx.fillStyle = '#5f9cc4';
  ctx.fillRect(-ahR - 4, -ahR - 4, ahR * 2 + 8, ahR + 4);
  ctx.fillStyle = '#7a5a38';
  ctx.fillRect(-ahR - 4, 0, ahR * 2 + 8, ahR + 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-ahR - 4, -1, ahR * 2 + 8, 2);
  ctx.restore();
  ctx.strokeStyle = '#eef1f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ahX, ahY, ahR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.moveTo(ahX - 12, ahY);
  ctx.lineTo(ahX + 12, ahY);
  ctx.lineTo(ahX, ahY + 5);
  ctx.closePath();
  ctx.fill();

  // Centre message.
  if (plane.messageTimer > 0 && plane.message) {
    ctx.textAlign = 'center';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
    const w = ctx.measureText(plane.message).width + 36;
    roundRect(ctx, FIELD.width / 2 - w / 2, 84, w, 46, 10);
    ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(plane.message, FIELD.width / 2, 116);
  }

  // Warnings: terrain ahead, low fuel, stall.
  const ground = groundUnder(world, plane.x, plane.z);
  const warnings = [];
  if (plane.status === FLYING && plane.y - ground < 28 && plane.verticalSpeed < -1) warnings.push('PULL UP');
  if (plane.fuel > 0 && plane.fuel < 15) warnings.push('LOW FUEL');
  if (plane.speed < PLANE.stallSpeed && plane.y - ground > 6) warnings.push('STALL');
  if (warnings.length > 0 && Math.floor(time * 3) % 2 === 0) {
    ctx.textAlign = 'center';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = '#ff5a4d';
    ctx.fillText(warnings.join('  ·  '), FIELD.width / 2, FIELD.height - 24);
  }

  // Off-screen next-ring pointer: an arrow at the screen edge toward it.
  if (ring && plane.status === FLYING) {
    const proj = makeProjector(plane, time);
    const p = proj.project(ring.x, ring.y, ring.z);
    if (p && (p.sx < 40 || p.sx > FIELD.width - 40 || p.sy < 80 || p.sy > FIELD.height - 80)) {
      const ex = Math.max(50, Math.min(FIELD.width - 50, p.sx));
      const ey = Math.max(90, Math.min(FIELD.height - 90, p.sy));
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(Math.atan2(p.sy - ey, p.sx - ex));
      ctx.fillStyle = palette.ring;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = palette.ring;
      ctx.font = `700 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(p.fwd)}m`, ex, ey + 26);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- screens --------------------------------------------------------------

function drawTitle(ctx, sim, time, best) {
  const { world } = sim;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.45)';
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText('SKYLINE RUSH', FIELD.width / 2, 150);
  ctx.fillStyle = '#ffd34d';
  ctx.font = `600 21px ${FONT}`;
  ctx.fillText('Fly the rings. Mind the fuel. Bring her home.', FIELD.width / 2, 186);
  const cardW = 340;
  const cardH = 108;
  const gap = 24;
  const totalW = cardW * 3 + gap * 2;
  const startX = (FIELD.width - totalW) / 2;
  MISSIONS.forEach((mission, i) => {
    const x = startX + i * (cardW + gap);
    const y = 240;
    ctx.fillStyle = 'rgba(10, 16, 26, 0.72)';
    roundRect(ctx, x, y, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 211, 77, 0.65)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, cardW, cardH, 12);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd34d';
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(`${i + 1} · ${mission.name}`, x + 18, y + 34);
    ctx.fillStyle = '#dfe6ec';
    ctx.font = `400 14px ${FONT}`;
    wrapText(ctx, mission.tagline, x + 18, y + 58, cardW - 36, 18);
    ctx.fillStyle = '#8b93a3';
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(`${mission.rings} rings · ${mission.fuel} fuel · ${mission.runwayLength}m strip`, x + 18, y + 92);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#eef1f5';
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText('Press 1, 2 or 3 — or click a mission — to fly', FIELD.width / 2, 400);
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText('↑ ↓ pitch · ← → bank · W / S throttle · drag mouse to steer · wheel for throttle', FIELD.width / 2, 432);
  ctx.fillText('Fly through every ring, then land gently on the runway. Mind the terrain.', FIELD.width / 2, 456);
  if (best > 0) {
    ctx.fillStyle = '#ffd34d';
    ctx.font = `700 17px ${FONT}`;
    ctx.fillText(`Best score: ${best}`, FIELD.width / 2, 500);
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawEndPanel(ctx, sim, title, lines, hint, time) {
  const { plane } = sim;
  ctx.fillStyle = 'rgba(8, 14, 24, 0.55)';
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  const w = 560;
  const h = 300;
  const x = (FIELD.width - w) / 2;
  const y = (FIELD.height - h) / 2;
  ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 211, 77, 0.7)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = title.includes('COMPLETE') ? '#7ddc7d' : '#ff8a7a';
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(title, FIELD.width / 2, y + 62);
  ctx.fillStyle = '#eef1f5';
  ctx.font = `600 19px ${FONT}`;
  lines.forEach((line, i) => {
    ctx.fillText(line, FIELD.width / 2, y + 108 + i * 30);
  });
  ctx.fillStyle = '#ffd34d';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(`SCORE  ${plane.score}`, FIELD.width / 2, y + 108 + lines.length * 30 + 12);
  ctx.fillStyle = '#b8c2cc';
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText(hint, FIELD.width / 2, y + h - 26);
}

/** Draw one frame: the world, the aircraft, the HUD and the screen on top. */
export function drawScene(ctx, sim, screen, time, best) {
  ctx.clearRect(0, 0, FIELD.width, FIELD.height);
  drawWorld(ctx, sim, time);
  drawPlane(ctx, sim.plane, time);
  if (screen === SCREEN_TITLE) {
    drawTitle(ctx, sim, time, best);
  } else if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) {
    drawHud(ctx, sim, time);
    if (screen === SCREEN_PAUSED) {
      ctx.fillStyle = 'rgba(8, 14, 24, 0.5)';
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 44px ${FONT}`;
      ctx.fillText('PAUSED', FIELD.width / 2, FIELD.height / 2 - 8);
      ctx.font = `400 17px ${FONT}`;
      ctx.fillStyle = '#b8c2cc';
      ctx.fillText('Press P to keep flying', FIELD.width / 2, FIELD.height / 2 + 28);
    }
  } else if (screen === SCREEN_COMPLETE) {
    drawHud(ctx, sim, time);
    const { plane } = sim;
    drawEndPanel(
      ctx,
      sim,
      'MISSION COMPLETE',
      [
        `Rings flown: ${plane.ringsPassed}/${plane.ringsTotal}`,
        `Landing bonus: +${PLANE.landingScore}  ·  Fuel & time bonus: +${plane.landedBonus}`,
        `Flight time: ${Math.round(plane.time)}s`,
      ],
      'R — fly again · Enter — back to missions',
      time,
    );
  } else if (screen === SCREEN_CRASHED) {
    drawHud(ctx, sim, time);
    const { plane } = sim;
    drawEndPanel(
      ctx,
      sim,
      'AIRCRAFT LOST',
      [
        plane.message || 'The Skylark did not make it home.',
        `Rings flown: ${plane.ringsPassed}/${plane.ringsTotal}`,
        `Flight time: ${Math.round(plane.time)}s`,
      ],
      'R — try again · Enter — back to missions',
      time,
    );
  }
}
