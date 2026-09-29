// Запасное управление с клавиатуры (стрелки / WASD) и тач-кнопки.
// Отдаёт тот же объект, что и gestures.js, поэтому игре всё равно, чем управляют.

export class KeyboardControl {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false };
    this.steer = 0;
    this.nitroQueued = false;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if ((k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyN') && !this.keys.has(k)) this.nitroQueued = true;
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  queueNitro() {
    this.nitroQueued = true;
  }

  update(dt) {
    const left = this.has('ArrowLeft', 'KeyA') || this.touch.left;
    const right = this.has('ArrowRight', 'KeyD') || this.touch.right;
    const gas = this.has('ArrowUp', 'KeyW') || this.touch.gas;
    const brake = this.has('ArrowDown', 'KeyS') || this.touch.brake;
    // Руль с клавиатуры нарастает плавно, как у настоящей машины.
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 6 : 4;
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    const nitro = this.nitroQueued;
    this.nitroQueued = false;
    return {
      steer: this.steer,
      gas: gas && !brake,
      brake,
      nitro,
      handsVisible: 2,
      fistL: gas,
      fistR: gas,
      errors: [],
      coast: !gas && !brake,
      nitroHold: nitro ? 1 : 0,
    };
  }
}
