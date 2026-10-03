// Чужая машина по сети: буфер снимков по времени хоста, интерполяция с задержкой ~100 мс
// (без телепортаций), экстраполяция по скорости до 250 мс при потере пакетов, мягкий
// визуальный толчок при контакте. Интерфейс для рендера — как у бота (x, y, z, psi, prev…).
import { COMPOUND_IDS } from '../game/tires.js';

export const INTERP_MS = 100;
const EXTRAP_MS = 250;
const PIT_PHASES = ['track', 'lane', 'service', 'release', 'exit'];

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Состояние машины → компактный массив (≈20 чисел, ~150 байт JSON).
export function encodeCar(car, entry) {
  return [
    r2(car.x),
    r2(car.y),
    r2(car.z),
    r3(car.psi),
    r2(Math.hypot(car.u, car.v)),
    r3(car.delta),
    car.brake > 0.2 ? 1 : 0,
    car.boostOn ? 1 : 0,
    r2(car.progress),
    r2(car.d),
    entry?.finished ? 1 : 0,
    r2(entry?.finishTime ?? 0),
    r2(car.lift || 0),
    r3(car.pitch || 0),
    r3(car.roll || 0),
    Math.max(0, COMPOUND_IDS.indexOf(car.tire?.compound ?? 'medium')),
    PIT_PHASES.indexOf(entry?.pit?.phase ?? 'track'),
    entry?.penalty ?? 0,
    r2(car.tire?.wear ?? 0),
  ];
}

// Бот (на хосте) → тот же формат.
export function encodeBot(b, entry) {
  return [
    r2(b.x),
    r2(b.y),
    r2(b.z),
    r3(b.psi),
    r2(b.v),
    r3(b.delta),
    b.brake ? 1 : 0,
    0,
    r2(b.progress),
    r2(b.d),
    entry?.finished ? 1 : 0,
    r2(entry?.finishTime ?? 0),
    b.pit?.phase === 'service' ? 1 : 0,
    r3(b.pitch || 0),
    r3(b.roll || 0),
    Math.max(0, COMPOUND_IDS.indexOf(b.tire?.compound ?? 'medium')),
    PIT_PHASES.indexOf(b.pit?.phase ?? 'track'),
    entry?.penalty ?? 0,
    r2(b.tire?.wear ?? 0),
  ];
}

export function decodeCar(a) {
  return {
    x: a[0],
    y: a[1],
    z: a[2],
    psi: a[3],
    v: a[4],
    delta: a[5],
    brake: a[6],
    boost: a[7],
    progress: a[8],
    d: a[9],
    finished: !!a[10],
    finishTime: a[11],
    lift: a[12],
    pitch: a[13],
    roll: a[14],
    compound: COMPOUND_IDS[a[15]] ?? 'medium',
    pit: PIT_PHASES[a[16]] ?? 'track',
    penalty: a[17] ?? 0,
    wear: a[18] ?? 0,
  };
}

const wrapA = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export class RemoteCar {
  constructor(spec, track) {
    this.spec = spec;
    this.track = track;
    this.buf = []; // [{t, st}]
    this.x = this.y = this.z = this.psi = 0;
    this.v = 0;
    this.u = 0;
    this.delta = 0;
    this.brake = 0;
    this.pitch = this.roll = this.bounce = 0;
    this.spin = 0;
    this.lift = 0;
    this.progress = 0;
    this.s = 0;
    this.d = 0;
    this.idx = 0;
    this.prev = { x: 0, y: 0, z: 0, psi: 0 };
    this.push = { x: 0, z: 0 }; // визуальное смещение после контакта (затухает)
    this.last = null; // последний полученный снимок
    this.lastT = -Infinity;
    this.tire = { compound: 'medium', wear: 0 };
    this.pit = { phase: 'track' };
    this.inBox = false;
    this.hitCd = 0;
    this.ready = false;
    this.isRemote = true;
  }

  // t — время хоста (мс), когда снимок сделан; st — decodeCar(...)
  add(t, st) {
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return; // старый/повтор
    this.buf.push({ t, st });
    if (this.buf.length > 30) this.buf.shift();
    this.last = st;
    this.lastT = t;
    if (!this.ready) {
      this.ready = true;
      this.apply(st, 1, st, 0);
      this.savePrev();
    }
  }

  savePrev() {
    this.prev.x = this.x;
    this.prev.y = this.y;
    this.prev.z = this.z;
    this.prev.psi = this.psi;
  }

  apply(a, k, b, extraSec) {
    const L = (p, q) => p + (q - p) * k;
    this.x = L(a.x, b.x);
    this.y = L(a.y, b.y);
    this.z = L(a.z, b.z);
    this.psi = a.psi + wrapA(b.psi - a.psi) * k;
    this.v = L(a.v, b.v);
    this.delta = L(a.delta, b.delta);
    this.pitch = L(a.pitch, b.pitch);
    this.roll = L(a.roll, b.roll);
    this.lift = L(a.lift, b.lift);
    this.progress = L(a.progress, b.progress);
    this.d = L(a.d, b.d);
    if (extraSec > 0) {
      // экстраполяция: вперёд по курсу со скоростью последнего снимка
      this.x += Math.sin(this.psi) * this.v * extraSec;
      this.z += Math.cos(this.psi) * this.v * extraSec;
      this.progress += this.v * extraSec;
    }
    const st = k < 0.5 ? a : b;
    this.brake = st.brake;
    this.tire.compound = st.compound;
    this.tire.wear = st.wear;
    this.pit.phase = st.pit;
    this.inBox = st.pit === 'service';
  }

  // Положение на момент tRender (время хоста, мс). dt — для вращения колёс и затухания толчка.
  sample(tRender, dt) {
    if (!this.buf.length) return;
    this.savePrev();
    const B = this.buf;
    let i = B.length - 1;
    while (i > 0 && B[i - 1].t > tRender) i--;
    if (tRender >= B[B.length - 1].t) {
      const last = B[B.length - 1];
      const ex = Math.min(EXTRAP_MS, tRender - last.t) / 1000;
      this.apply(last.st, 1, last.st, ex);
    } else if (i === 0 || tRender <= B[0].t) {
      this.apply(B[0].st, 1, B[0].st, 0);
    } else {
      const a = B[i - 1], b = B[i];
      const k = (tRender - a.t) / Math.max(1, b.t - a.t);
      this.apply(a.st, Math.max(0, Math.min(1, k)), b.st, 0);
    }
    // визуальный толчок после контакта
    this.x += this.push.x;
    this.z += this.push.z;
    const f = Math.exp(-dt * 4);
    this.push.x *= f;
    this.push.z *= f;
    this.u = this.v;
    this.spin += (this.v / (this.spec.dims.wheelR || 0.34)) * dt;
    const tr = this.track;
    this.s = tr.wrapS(this.progress);
    this.idx = tr.index(this.s);
    if (this.hitCd > 0) this.hitCd -= dt;
  }

  // Сколько мс нет данных (для пометки «связь потеряна»).
  staleMs(hostNow) {
    return hostNow - this.lastT;
  }
}
