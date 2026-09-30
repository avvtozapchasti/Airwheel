// Трасса = данные (контрольные точки, профили ширины/высоты/наклона) → выборка через каждые 2 м.
// Центральная линия — замкнутый сплайн CatmullRom. Всё, что нужно физике, ботам и рендеру,
// считается здесь один раз при загрузке: позиции, касательные, кривизна, ширина, стены, поребрики.
//
// Система координат: Y вверх, трасса лежит в XZ. Направление движения — рост s.
// Курс (heading) θ: вперёд = (sin θ, cos θ). Левая нормаль N = (cos θ, −sin θ).
// Боковое смещение d > 0 — левее центра. Кривизна κ > 0 — поворот налево.
import { CatmullRomCurve3, Vector3 } from 'three';
import { wrapAngle } from '../util/rng.js';

export const SAMPLE_M = 2; // шаг выборки, м

// Профиль по трассе: число или ключи [[t, value], ...], t ∈ [0, 1).
// Линейная периодическая интерполяция + сглаживание скользящим средним (дважды).
export function sampleProfile(keys, n, smooth = 0) {
  const out = new Float32Array(n);
  if (typeof keys === 'number' || keys == null) {
    out.fill(keys ?? 0);
    return out;
  }
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let j = -1;
    for (let q = 0; q < k.length; q++) if (k[q][0] <= t) j = q;
    const a = j < 0 ? [k[k.length - 1][0] - 1, k[k.length - 1][1]] : k[j];
    const bRaw = k[(j + 1) % k.length];
    const b = j + 1 >= k.length ? [bRaw[0] + 1, bRaw[1]] : bRaw;
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    out[i] = a[1] + (b[1] - a[1]) * f;
  }
  if (smooth > 0) {
    boxSmooth(out, smooth);
    boxSmooth(out, smooth);
  }
  return out;
}

// Периодическое скользящее среднее с полуокном w.
export function boxSmooth(arr, w) {
  const n = arr.length;
  const src = Float64Array.from(arr);
  let sum = 0;
  for (let k = -w; k <= w; k++) sum += src[((k % n) + n) % n];
  const cnt = 2 * w + 1;
  for (let i = 0; i < n; i++) {
    arr[i] = sum / cnt;
    sum += src[(i + w + 1) % n] - src[(((i - w) % n) + n) % n];
  }
  return arr;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;

    // --- центральная линия ---
    const pts = def.points.map(([x, z]) => new Vector3(x, 0, z));
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = pts.length * 80;
    const approx = curve.getLength();
    const n = (this.n = Math.max(64, Math.round(approx / SAMPLE_M)));
    const P = curve.getSpacedPoints(n);
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    let len = 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = P[i].x;
      this.z[i] = P[i].z;
      const q = P[(i + 1) % n];
      len += Math.hypot(q.x - P[i].x, q.z - P[i].z);
    }
    this.length = len;
    this.ds = len / n;

    // --- касательные, курс, нормали ---
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.heading = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.wrap(i - 1), b = this.wrap(i + 1);
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = dz;
      this.nz[i] = -dx;
      this.heading[i] = Math.atan2(dx, dz);
    }

    // --- кривизна (со знаком), сглаженная по ±6 м ---
    this.kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = wrapAngle(this.heading[this.wrap(i + 1)] - this.heading[this.wrap(i - 1)]);
      this.kappa[i] = d / (2 * this.ds);
    }
    boxSmooth(this.kappa, 3);

    // --- профили ---
    const m = (meters) => Math.max(1, Math.round(meters / this.ds));
    this.hw = sampleProfile(def.width ?? 13, n, m(30)).map((w) => w / 2);
    this.y = sampleProfile(def.height ?? 0, n, m(45));
    this.bank = sampleProfile(def.bank ?? 0, n, m(30)).map((deg) => (deg * Math.PI) / 180);
    const runL = sampleProfile(def.runoffLeft ?? def.runoff ?? 10, n, m(20));
    const runR = sampleProfile(def.runoffRight ?? def.runoff ?? 10, n, m(20));
    this.wallL = new Float32Array(n);
    this.wallR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.wallL[i] = this.hw[i] + runL[i];
      this.wallR[i] = this.hw[i] + runR[i];
    }

    // --- поребрики: там, где радиус < kerbRadius, плюс запас до и после ---
    const kerbW = def.kerbWidth ?? 1.2;
    const kerbR = def.kerbRadius ?? 260;
    const flag = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (Math.abs(this.kappa[i]) > 1 / kerbR) flag[i] = 1;
    const pad = m(14);
    this.kerb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!flag[i]) continue;
      for (let k = -pad; k <= pad; k++) this.kerb[this.wrap(i + k)] = kerbW;
    }

    // --- уклон вдоль трассы (для тангажа камеры и машины) ---
    this.grade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.grade[i] = (this.y[this.wrap(i + 1)] - this.y[this.wrap(i - 1)]) / (2 * this.ds);
    }

    // сектора S1/S2/S3 — три равные части круга
    this.sectors = [0, len / 3, (2 * len) / 3];
    this.bounds = this.computeBounds();
  }

  wrap(i) {
    const n = this.n;
    return ((i % n) + n) % n;
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Разница по трассе от a до b (b впереди — положительная), с учётом замкнутости.
  deltaS(a, b) {
    let d = this.wrapS(b) - this.wrapS(a);
    const h = this.length / 2;
    if (d > h) d -= this.length;
    if (d < -h) d += this.length;
    return d;
  }

  index(s) {
    return this.wrap(Math.floor(this.wrapS(s) / this.ds));
  }

  computeBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]);
      maxZ = Math.max(maxZ, this.z[i]);
      minY = Math.min(minY, this.y[i]);
      maxY = Math.max(maxY, this.y[i]);
    }
    return { minX, maxX, minZ, maxZ, minY, maxY };
  }

  // Точка трассы по s и боковому смещению d. out = {x, y, z}.
  pointAt(s, d = 0, out = {}) {
    s = this.wrapS(s);
    const f0 = s / this.ds;
    const i = Math.floor(f0) % this.n;
    const j = (i + 1) % this.n;
    const f = f0 - Math.floor(f0);
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * f;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * f;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * f + nx * d;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * f + nz * d;
    out.y = this.heightAt(i, f, d);
    return out;
  }

  // Высота поверхности дороги (с учётом наклона) на индексе i + f и смещении d.
  heightAt(i, f, d) {
    const j = (i + 1) % this.n;
    const y = this.y[i] + (this.y[j] - this.y[i]) * f;
    const b = this.bank[i] + (this.bank[j] - this.bank[i]) * f;
    return y - d * Math.sin(b);
  }

  headingAt(s) {
    s = this.wrapS(s);
    const f0 = s / this.ds;
    const i = Math.floor(f0) % this.n;
    const j = (i + 1) % this.n;
    return this.heading[i] + wrapAngle(this.heading[j] - this.heading[i]) * (f0 - Math.floor(f0));
  }

  // Проекция точки мира на трассу. hint — индекс с прошлого шага (локальный поиск),
  // -1 — полный перебор. Возвращает out = {i, f, s, d}.
  project(x, z, hint = -1, out = {}) {
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < this.n; i++) {
        const dx = x - this.x[i], dz = z - this.z[i];
        const q = dx * dx + dz * dz;
        if (q < bd) {
          bd = q;
          best = i;
        }
      }
    } else {
      for (let k = -30; k <= 30; k++) {
        const i = this.wrap(hint + k);
        const dx = x - this.x[i], dz = z - this.z[i];
        const q = dx * dx + dz * dz;
        if (q < bd) {
          bd = q;
          best = i;
        }
      }
    }
    // уточнение на отрезке [i, i+1] (или [i-1, i])
    let i = best;
    let j = this.wrap(i + 1);
    let ex = this.x[j] - this.x[i], ez = this.z[j] - this.z[i];
    let f = ((x - this.x[i]) * ex + (z - this.z[i]) * ez) / (ex * ex + ez * ez);
    if (f < 0) {
      i = this.wrap(best - 1);
      j = best;
      ex = this.x[j] - this.x[i];
      ez = this.z[j] - this.z[i];
      f = ((x - this.x[i]) * ex + (z - this.z[i]) * ez) / (ex * ex + ez * ez);
    }
    f = Math.max(0, Math.min(1, f));
    const px = this.x[i] + ex * f, pz = this.z[i] + ez * f;
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * f;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * f;
    out.i = i;
    out.f = f;
    out.s = (i + f) * this.ds;
    out.d = (x - px) * nx + (z - pz) * nz;
    return out;
  }

  // Поверхность под точкой с боковым смещением d на индексе i.
  surfaceAt(i, d) {
    const a = Math.abs(d);
    if (a <= this.hw[i]) return 'asphalt';
    if (a <= this.hw[i] + this.kerb[i]) return 'kerb';
    return this.def.offSurface?.(i, this) ?? 'grass';
  }
}
