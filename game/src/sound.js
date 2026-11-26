// Sound, synthesised live with WebAudio: no audio files ship with the game.
// An engine drone that follows the throttle, a chime for a ring, a warning
// beep, a thud for a crash and a short fanfare for a landing. Everything
// starts on the first user gesture, so browsers never block it.

/** The sound board; call unlock() from the first key or pointer gesture. */
export function createSound() {
  const board = { ctx: null, engine: null, engineGain: null, muted: false };

  board.unlock = function unlock() {
    if (board.ctx) {
      if (board.ctx.state === 'suspended') board.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      board.ctx = new Ctx();
      // Engine: two detuned sawtooth oscillators through a low-pass filter.
      const oscA = board.ctx.createOscillator();
      const oscB = board.ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscB.type = 'sawtooth';
      oscA.frequency.value = 62;
      oscB.frequency.value = 93;
      const filter = board.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      board.engineGain = board.ctx.createGain();
      board.engineGain.gain.value = 0.0;
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(board.engineGain);
      board.engineGain.connect(board.ctx.destination);
      oscA.start();
      oscB.start();
      board.engine = { oscA, oscB, filter };
    } catch {
      board.ctx = null; // no audio on this browser: the game stays silent
    }
  };

  /** Follow the throttle: louder and higher as the lever goes forward. */
  board.engineNote = function engineNote(throttle, speed) {
    if (!board.ctx || !board.engine) return;
    const level = 0.02 + throttle * 0.05 + Math.min(0.02, speed * 0.0001);
    board.engineGain.gain.setTargetAtTime(level, board.ctx.currentTime, 0.1);
    const base = 55 + throttle * 55 + speed * 0.12;
    board.engine.oscA.frequency.setTargetAtTime(base, board.ctx.currentTime, 0.1);
    board.engine.oscB.frequency.setTargetAtTime(base * 1.5, board.ctx.currentTime, 0.1);
  };

  function tone(freq, seconds, type, level, when = 0) {
    if (!board.ctx) return;
    const t0 = board.ctx.currentTime + when;
    const osc = board.ctx.createOscillator();
    const gain = board.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.connect(gain);
    gain.connect(board.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.05);
  }

  board.ring = function ring() {
    tone(880, 0.35, 'sine', 0.16);
    tone(1318, 0.4, 'sine', 0.12, 0.07);
  };

  board.warn = function warn() {
    tone(440, 0.18, 'square', 0.06);
  };

  board.crash = function crash() {
    tone(90, 0.5, 'sawtooth', 0.2);
    tone(55, 0.7, 'sine', 0.22, 0.05);
  };

  board.land = function land() {
    [523, 659, 784, 1046].forEach((freq, i) => tone(freq, 0.4, 'sine', 0.12, i * 0.11));
  };

  return board;
}
