// A tiny seeded random generator: the same seed always builds the same world,
// which is what makes the missions and the screenshot scenes repeatable.
// (mulberry32: a well-known public-domain 32-bit generator, written here in
// this file's own form.)

/** Return a function that yields a deterministic stream of numbers in [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a number in [min, max) from a seeded stream. */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** Pick one item from a list, by a seeded stream. */
export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}
