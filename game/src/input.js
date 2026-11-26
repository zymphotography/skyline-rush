// Keyboard and mouse: the pilot's hands. Arrow keys (or WASD) fly the
// aircraft, W/S (or Shift/Ctrl) work the throttle, and a held mouse drag
// steers like a stick while the wheel works the throttle. The module only
// reports what is held; the flight model decides what it means.

const KEY_PITCH_UP = ['ArrowUp', 'KeyI'];
const KEY_PITCH_DOWN = ['ArrowDown', 'KeyK'];
const KEY_BANK_LEFT = ['ArrowLeft', 'KeyJ'];
const KEY_BANK_RIGHT = ['ArrowRight', 'KeyL'];
const KEY_THROTTLE_UP = ['KeyW', 'ShiftLeft', 'ShiftRight'];
const KEY_THROTTLE_DOWN = ['KeyS', 'ControlLeft', 'ControlRight'];

/** The live input state, attached once to the page. */
export function createInput(canvas) {
  const state = {
    keys: new Set(),
    throttle: 0.6,
    pointerDown: false,
    pointerX: 0,
    pointerY: 0,
    pressed: new Set(), // keys pressed since the last read, for menus
  };

  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) state.pressed.add(event.code);
    state.keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    state.keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.pointerDown = false;
  });

  canvas.addEventListener('pointerdown', (event) => {
    state.pointerDown = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    state.pointerDown = false;
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.throttle = Math.min(1, Math.max(0, state.throttle - Math.sign(event.deltaY) * 0.08));
  }, { passive: false });

  return state;
}

/** True if any of the codes is currently held. */
function held(state, codes) {
  return codes.some((code) => state.keys.has(code));
}

/**
 * The flight control for this frame: pitch and bank in [-1, 1], throttle in
 * [0, 1]. Keyboard and mouse agree: a held drag steers, keys trim the same
 * axes, and W/S (or the wheel) set the throttle.
 */
export function readControl(state, canvas) {
  let pitch = 0;
  let bank = 0;
  if (held(state, KEY_PITCH_UP)) pitch += 1;
  if (held(state, KEY_PITCH_DOWN)) pitch -= 1;
  if (held(state, KEY_BANK_LEFT)) bank -= 1;
  if (held(state, KEY_BANK_RIGHT)) bank += 1;
  if (state.pointerDown) {
    const rect = canvas.getBoundingClientRect();
    const nx = (state.pointerX - rect.left) / rect.width - 0.5;
    const ny = (state.pointerY - rect.top) / rect.height - 0.5;
    bank = Math.max(-1, Math.min(1, nx * 2.4));
    pitch = Math.max(-1, Math.min(1, -ny * 2.4));
  }
  if (held(state, KEY_THROTTLE_UP)) state.throttle = Math.min(1, state.throttle + 0.012);
  if (held(state, KEY_THROTTLE_DOWN)) state.throttle = Math.max(0, state.throttle - 0.012);
  return { pitch, bank, throttle: state.throttle };
}

/** True once if the key was pressed since the last call (menu keys). */
export function wasPressed(state, code) {
  if (state.pressed.has(code)) {
    state.pressed.delete(code);
    return true;
  }
  return false;
}

/** Clear the pressed set (called once per frame after menus read it). */
export function clearPressed(state) {
  state.pressed.clear();
}
