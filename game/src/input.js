// Keyboard and mouse state for Vice Harbor: held keys, one-frame presses, pointer aim in screen pixels, and the binding table the start screen prints.

export const BINDINGS = [
  ['W A S D / arrows', 'walk, and drive'],
  ['Shift', 'sprint / handbrake'],
  ['Mouse', 'aim'],
  ['Left click', 'fire'],
  ['E', 'enter or leave a car'],
  ['F', 'horn'],
  ['1 2 3 4', 'fists, 9mm, SMG, shotgun'],
  ['R', 'reload'],
  ['Esc', 'pause'],
  ['M', 'mute radio'],
  ['F5 / F9', 'save / load'],
];

const CAPTURED = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyF', 'KeyM', 'F5', 'F9']);

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const state = {
    keys: held,
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    mouseClicked: false,
    wheel: 0,
    onKey: null,
  };

  const down = (e) => {
    if (CAPTURED.has(e.code)) e.preventDefault();
    if (!held.has(e.code)) pressed.add(e.code);
    held.add(e.code);
    if (state.onKey) state.onKey(e.code, e);
  };
  const up = (e) => {
    held.delete(e.code);
  };
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    state.mouseX = ((e.clientX - r.left) / r.width) * canvas.width;
    state.mouseY = ((e.clientY - r.top) / r.height) * canvas.height;
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => held.clear());
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.mouseDown = true;
      state.mouseClicked = true;
    }
    move(e);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseDown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.wheel += Math.sign(e.deltaY);
  }, { passive: false });

  return {
    state,
    isDown: (code) => held.has(code),
    anyDown: (...codes) => codes.some((c) => held.has(c)),
    pressed: (code) => pressed.has(code),
    // Clear the one-frame edges; main calls this at the end of every fixed step.
    endStep() {
      pressed.clear();
      state.mouseClicked = false;
      state.wheel = 0;
    },
  };
}

// Which way the movement keys point, as a unit-ish vector; diagonal is normalised so running is never faster on a slant.
export function moveAxis(input) {
  let x = 0;
  let y = 0;
  if (input.anyDown('KeyA', 'ArrowLeft')) x -= 1;
  if (input.anyDown('KeyD', 'ArrowRight')) x += 1;
  if (input.anyDown('KeyW', 'ArrowUp')) y -= 1;
  if (input.anyDown('KeyS', 'ArrowDown')) y += 1;
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len, len: 1 } : { x: 0, y: 0, len: 0 };
}
