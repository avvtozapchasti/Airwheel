// Гоночная траектория и профиль скорости — считаются один раз при загрузке трассы.
//
// Траектория (racing line): смещение от центра d(s), минимизирующее кривизну — классическое
// «снаружи — внутрь — наружу». Итерационное сглаживание по вторым разностям (бигармоническое)
// с ограничением шириной дороги, сначала на грубой сетке (длинные дуги), потом на мелкой.
//
// Профиль скорости: в каждой точке v ≤ sqrt(μ·g / (|κ| − μ·k_down/m)) (с прижимной силой),
// затем проход назад (торможение) и вперёд (разгон) — так получаются зоны торможения.
import { boxSmooth } from './track.js';
import { wrapAngle } from '../util/rng.js';

const G = 9.81;

function relax(cx, cz, nx, nz, lim, off, iters) {
  const N = off.length;
  const px = new Float64Array(N), pz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = cx[i] + nx[i] * off[i];
    pz[i] = cz[i] + nz[i] * off[i];
  }
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i - 1 + N) % N, c = (i + 1) % N, d = (i + 2) % N;
      const tx = (-px[a] + 4 * px[b] + 4 * px[c] - px[d]) / 6;
      const tz = (-pz[a] + 4 * pz[b] + 4 * pz[c] - pz[d]) / 6;
      const want = (tx - cx[i]) * nx[i] + (tz - cz[i]) * nz[i];
      let o = off[i] + (want - off[i]) * 0.6;
      if (o > lim[i]) o = lim[i];
      else if (o < -lim[i]) o = -lim[i];
      off[i] = o;
      px[i] = cx[i] + nx[i] * o;
      pz[i] = cz[i] + nz[i] * o;
    }
  }
}

function level(track, stepM, margin) {
  const step = Math.max(1, Math.round(stepM / track.ds));
  const N = Math.floor(track.n / step);
  const idx = new Int32Array(N);
  const cx = new Float64Array(N), cz = new Float64Array(N), nx = new Float64Array(N), nz = new Float64Array(N), lim = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const i = Math.round((k * track.n) / N) % track.n;
    idx[k] = i;
    cx[k] = track.x[i];
    cz[k] = track.z[i];
    nx[k] = track.nx[i];
    nz[k] = track.nz[i];
    lim[k] = Math.max(0, track.hw[i] - margin);
  }
  return { N, idx, cx, cz, nx, nz, lim };
}

// Интерполяция смещений с грубой сетки на выборки трассы.
function toFine(track, lv, off) {
  const out = new Float32Array(track.n);
  for (let i = 0; i < track.n; i++) {
    const f = (i * lv.N) / track.n;
    const k = Math.floor(f) % lv.N, k2 = (k + 1) % lv.N;
    const t = f - Math.floor(f);
    out[i] = off[k] + (off[k2] - off[k]) * t;
  }
  return out;
}

function sampleAt(arr, n, N) {
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const f = (k * n) / N;
    const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
    out[k] = arr[i] + (arr[j] - arr[i]) * t;
  }
  return out;
}

export function computeRacingLine(track, { margin = track.def?.lineMargin ?? 1.5 } = {}) {
  // грубо (24 м) → средне (8 м) → по выборкам трассы (2 м)
  const L1 = level(track, 24, margin);
  const o1 = new Float64Array(L1.N);
  relax(L1.cx, L1.cz, L1.nx, L1.nz, L1.lim, o1, 3000);
  const f1 = toFine(track, L1, o1);
  const L2 = level(track, 8, margin);
  const o2 = sampleAt(f1, track.n, L2.N);
  relax(L2.cx, L2.cz, L2.nx, L2.nz, L2.lim, o2, 1500);
  const off = toFine(track, L2, o2);
  boxSmooth(off, 2);
  for (let i = 0; i < track.n; i++) {
    const lim = Math.max(0, track.hw[i] - margin);
    off[i] = Math.max(-lim, Math.min(lim, off[i]));
  }
  return withGeometry(track, off);
}

// Точки линии, длины отрезков и кривизна (по реальной длине вдоль линии).
export function withGeometry(track, off) {
  const n = track.n;
  const x = new Float32Array(n), z = new Float32Array(n), segLen = new Float32Array(n), kappa = new Float32Array(n), heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = track.x[i] + track.nx[i] * off[i];
    z[i] = track.z[i] + track.nz[i] * off[i];
  }
  let len = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segLen[i] = Math.hypot(x[j] - x[i], z[j] - z[i]);
    len += segLen[i];
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    heading[i] = Math.atan2(x[b] - x[a], z[b] - z[a]);
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    kappa[i] = wrapAngle(heading[b] - heading[a]) / (segLen[a] + segLen[i]);
  }
  boxSmooth(kappa, 3);
  return { offset: off, x, z, segLen, kappa, heading, length: len };
}

// Максимальная скорость класса на прямой (мощность = сопротивление).
export function topSpeed(spec, powerK = 1) {
  let v = 10;
  for (let k = 0; k < 60; k++) {
    const f = (spec.power * powerK) / v - spec.drag * v * v - spec.rolling * spec.mass * G;
    v += f / (spec.mass * 2);
    v = Math.max(5, v);
  }
  return v;
}

// Разгон/торможение класса на скорости v (м/с²), μ — сцепление.
export function accelAt(spec, v, mu = spec.grip) {
  const m = spec.mass;
  const traction = mu * (m * G * (1 - spec.weightFront) + spec.downforce * v * v * 0.55);
  const drive = Math.min(spec.power / Math.max(v, 6), traction);
  return (drive - spec.drag * v * v - spec.rolling * m * G) / m;
}
export function brakeAt(spec, v, mu = spec.grip) {
  const m = spec.mass;
  return (spec.brake * mu * (m * G + spec.downforce * v * v) + spec.drag * v * v) / m;
}

// Профиль скорости по линии: {v: Float32Array, lapTime}. gripK < 1 — запас для ботов.
export function speedProfile(track, line, spec, { gripK = 1, brakeK = 0.85 } = {}) {
  const n = track.n;
  const mu = spec.grip * gripK;
  const vTop = topSpeed(spec);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(line.kappa[i]);
    const denom = k - (mu * spec.downforce) / spec.mass;
    v[i] = denom <= 1e-6 ? vTop : Math.min(vTop, Math.sqrt((mu * G) / denom));
  }
  // проход назад (торможение) и вперёд (разгон), дважды — круг замкнут
  for (let pass = 0; pass < 2; pass++) {
    // уклон: на спуске тормозить хуже, на подъёме разгоняться хуже;
    // круг трения: если шина занята поворотом, на торможение и разгон остаётся меньше
    const circle = (i, vv) => {
      const lat = vv * vv * Math.abs(line.kappa[i]);
      const cap = (mu * (spec.mass * G + spec.downforce * vv * vv)) / spec.mass;
      return Math.sqrt(Math.max(0.12, 1 - (lat / cap) ** 2));
    };
    for (let k = 2 * n - 1; k >= 0; k--) {
      const i = k % n, j = (i + 1) % n;
      const a = Math.max(1, brakeAt(spec, v[j], mu) * brakeK * circle(i, v[j]) + G * (track.grade?.[i] ?? 0));
      const lim = Math.sqrt(v[j] * v[j] + 2 * a * line.segLen[i]);
      if (v[i] > lim) v[i] = lim;
    }
    for (let k = 0; k < 2 * n; k++) {
      const i = k % n, j = (i + 1) % n;
      const a = Math.max(0.2, accelAt(spec, v[i], mu) * Math.max(0.35, circle(i, v[i])) - G * (track.grade?.[i] ?? 0));
      const lim = Math.sqrt(v[i] * v[i] + 2 * a * line.segLen[i]);
      if (v[j] > lim) v[j] = lim;
    }
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += line.segLen[i] / Math.max(1, (v[i] + v[(i + 1) % n]) / 2);
  return { v, lapTime: t, vTop };
}

// Точки торможения: где профиль начинает падать перед поворотом (для коуча и ботов).
export function brakingPoints(track, prof) {
  const n = track.n;
  const out = [];
  for (const c of track.corners) {
    // минимум скорости около вершины
    let iMin = c.apex, vMin = prof.v[c.apex];
    for (let k = -40; k <= 40; k++) {
      const i = track.wrap(c.apex + k);
      if (prof.v[i] < vMin) {
        vMin = prof.v[i];
        iMin = i;
      }
    }
    // назад, пока скорость растёт — это зона торможения
    // назад от минимума: запоминаем максимум скорости; мелкие провалы профиля у входа
    // в поворот пропускаем, останавливаемся, когда скорость заметно ниже максимума
    let i = iMin, best = iMin, vBest = prof.v[iMin];
    const maxBack = Math.round(900 / track.ds);
    for (let k = 0; k < maxBack; k++) {
      const p = track.wrap(i - 1);
      if (prof.v[p] > vBest) {
        vBest = prof.v[p];
        best = p;
      }
      if (prof.v[p] < vBest - 4) break;
      i = p;
    }
    i = best;
    out.push({ corner: c, iBrake: i, iMin, vMin, vEntry: prof.v[i], sBrake: i * track.ds, sMin: iMin * track.ds });
  }
  return out;
}
