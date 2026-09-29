// Виртуальный руль: угол линии между запястьями → steer в [-1, 1].
import { OneEuroFilter, OneEuroFilter2D } from '../vision/filters.js';

export const DEAD_ZONE_DEG = 5;
export const MAX_ANGLE_DEG = 45;
export const CALIBRATION_SEC = 2;
const RETURN_SEC = 0.5; // за сколько руль возвращается в 0 при потере руки
const RAD2DEG = 180 / Math.PI;

// Нормализация угла в диапазон (-180, 180].
function wrapDeg(a) {
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
}

export function angleToSteer(relDeg) {
  const abs = Math.abs(relDeg);
  if (abs <= DEAD_ZONE_DEG) return 0;
  const k = Math.min(1, (abs - DEAD_ZONE_DEG) / (MAX_ANGLE_DEG - DEAD_ZONE_DEG));
  return Math.sign(relDeg) * k;
}

export class Wheel {
  constructor() {
    this.fL = new OneEuroFilter2D({ minCutoff: 1.5, beta: 0.8, dCutoff: 1.0 });
    this.fR = new OneEuroFilter2D({ minCutoff: 1.5, beta: 0.8, dCutoff: 1.0 });
    this.fAngle = new OneEuroFilter({ minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 });
    this.zeroDeg = 0;
    this.baseDist = 0.4; // до калибровки — типичное расстояние (доля ширины кадра)
    this.calibrated = false;
    this.steer = 0;
    this.relDeg = 0;
    this.angVel = 0; // град/с, по отфильтрованному углу
    this.dist = 0;
    this.calib = null;
  }

  // Абсолютный угол и расстояние между запястьями (x с поправкой на aspect).
  static measure(l, r, aspect) {
    const dx = (r.x - l.x) * aspect;
    const dy = r.y - l.y;
    return { deg: Math.atan2(dy, dx) * RAD2DEG, dist: Math.hypot(dx, dy) / aspect };
  }

  // --- калибровка: «возьми руль» и держи 2 секунды ---
  startCalibration() {
    this.calib = { t0: null, samples: [], done: false };
  }

  get calibrating() {
    return !!this.calib && !this.calib.done;
  }

  // Возвращает прогресс 0..1. Сбрасывается, если руки пропали или сильно сдвинулись.
  feedCalibration(m, tSec, bothVisible) {
    const c = this.calib;
    if (!c || c.done) return 1;
    if (!bothVisible) {
      c.t0 = null;
      c.samples = [];
      return 0;
    }
    if (c.samples.length) {
      const first = c.samples[0];
      const moved = Math.abs(wrapDeg(m.deg - first.deg)) > 12 || Math.abs(m.dist - first.dist) / first.dist > 0.25;
      if (moved) {
        c.t0 = null;
        c.samples = [];
      }
    }
    if (c.t0 === null) c.t0 = tSec;
    c.samples.push(m);
    const p = Math.min(1, (tSec - c.t0) / CALIBRATION_SEC);
    if (p >= 1) {
      // Средний угол через синус/косинус, чтобы не ломаться на ±180°.
      let s = 0, co = 0, d = 0;
      for (const q of c.samples) {
        s += Math.sin(q.deg / RAD2DEG);
        co += Math.cos(q.deg / RAD2DEG);
        d += q.dist;
      }
      this.zeroDeg = Math.atan2(s, co) * RAD2DEG;
      this.baseDist = d / c.samples.length;
      this.calibrated = true;
      c.done = true;
      this.fAngle.reset();
    }
    return p;
  }

  // Обе руки видны: считаем steer. tSec — секунды.
  update(lw, rw, aspect, tSec) {
    const l = this.fL.filter(lw, tSec);
    const r = this.fR.filter(rw, tSec);
    const m = Wheel.measure(l, r, aspect);
    this.dist = m.dist;
    // Фильтруем относительный угол (он около нуля — нет скачка через ±180°).
    const rel = wrapDeg(m.deg - this.zeroDeg);
    this.relDeg = this.fAngle.filter(rel, tSec);
    this.angVel = this.fAngle.dx;
    this.steer = angleToSteer(this.relDeg);
    return m;
  }

  // Рука пропала: плавно ведём руль к нулю за RETURN_SEC.
  release(dt) {
    const step = dt / RETURN_SEC;
    if (Math.abs(this.steer) <= step) this.steer = 0;
    else this.steer -= Math.sign(this.steer) * step;
    this.angVel = 0;
    this.fL.reset();
    this.fR.reset();
    this.fAngle.reset();
  }

  get distRatio() {
    return this.baseDist > 0 ? this.dist / this.baseDist : 1;
  }
}
