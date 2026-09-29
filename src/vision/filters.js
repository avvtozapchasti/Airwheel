// One Euro Filter (Casiez, Roussel, Vogel, 2012).
// Адаптивный фильтр низких частот: при медленном движении сильно сглаживает
// дрожание, при быстром — уменьшает задержку. Частота среза растёт со скоростью:
//   cutoff = minCutoff + beta * |скорость|

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null; // последнее отфильтрованное значение
    this.dx = 0; // отфильтрованная производная (ед/с)
    this.t = null;
  }

  // value — новое измерение, tSec — время в секундах.
  filter(value, tSec) {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.dx = 0;
      this.t = tSec;
      return value;
    }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// Удобный фильтр для 2D-точки.
export class OneEuroFilter2D {
  constructor(opts) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
  filter(p, tSec) {
    return { x: this.fx.filter(p.x, tSec), y: this.fy.filter(p.y, tSec) };
  }
}
