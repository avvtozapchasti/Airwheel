// Трасса из сегментов (классический псевдо-3D подход «OutRun»).
// Каждый сегмент — отрезок дороги длиной SEGMENT_LENGTH с кривизной и высотой.

export const SEGMENT_LENGTH = 200;
export const RUMBLE_LENGTH = 3; // сегментов в одной «полосе» бордюра
export const ROAD_WIDTH = 2000; // половина ширины дороги в мировых единицах
export const LANES = 4;
export const LAPS = 3;

// Центры полос в долях половины ширины дороги (-1..1).
export const LANE_X = [-0.75, -0.25, 0.25, 0.75];

const COLORS = {
  light: { road: '#6b6b73', grass: '#3fae4a', rumble: '#f2f2f2', lane: '#f2f2f2' },
  dark: { road: '#646470', grass: '#379c42', rumble: '#d8342c', lane: null },
  start: { road: '#f2f2f2', grass: '#3fae4a', rumble: '#f2f2f2', lane: null },
  finish: { road: '#141414', grass: '#379c42', rumble: '#141414', lane: null },
};

const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

// Детерминированный генератор случайных чисел — трасса одинаковая при каждом запуске.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Track {
  constructor() {
    this.segments = [];
    this.build();
    this.length = this.segments.length * SEGMENT_LENGTH;
  }

  lastY() {
    return this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0;
  }

  addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: { world: { y: this.lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
      curve,
      sprites: [],
      color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.dark : COLORS.light,
      clip: 0,
      looped: false,
    });
  }

  // enter/hold/leave — число сегментов на въезд, середину и выезд; hill — высота в сегментах.
  addRoad(enter, hold, leave, curve, hill = 0) {
    const startY = this.lastY();
    const endY = startY + hill * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }

  build() {
    const S = 20, M = 40, L = 80;
    this.addRoad(S, S, S, 0, 0); // старт — прямая
    this.addRoad(M, M, M, 0, 10);
    this.addRoad(M, M, M, 2, 0); // плавный правый
    this.addRoad(S, S, S, 0, -10);
    this.addRoad(M, L, M, -3, 20); // длинный левый в горку
    this.addRoad(S, M, S, 0, 0);
    // «змейка»
    this.addRoad(S, S, S, -2, 0);
    this.addRoad(S, S, S, 3, 10);
    this.addRoad(S, S, S, 2, 0);
    this.addRoad(S, S, S, -2, -10);
    this.addRoad(S, S, S, -3, 0);
    this.addRoad(L, L, L, 0, -15); // длинная прямая вниз
    this.addRoad(M, M, M, 4, 0); // крутой правый — нужно притормозить
    this.addRoad(S, S, S, 0, 5);
    this.addRoad(M, M, M, -2, -10);
    this.addRoad(M, M, M, 0, 0);
    this.addRoad(M, M, M, 3, 5);
    // плавно возвращаемся на уровень старта
    this.addRoad(M, M, M, 0, -this.lastY() / SEGMENT_LENGTH);

    // старт/финиш
    for (let n = 0; n < RUMBLE_LENGTH; n++) this.segments[n + 2].color = COLORS.start;
    for (let n = 0; n < 2; n++) this.segments[n].color = COLORS.finish;

    this.placeSprites();
  }

  placeSprites() {
    const rand = rng(42);
    const n = this.segments.length;
    // ворота старта
    this.segments[3].sprites.push({ type: 'gate', offset: 0 });
    for (let i = 10; i < n - 5; i += 3 + Math.floor(rand() * 4)) {
      const side = rand() < 0.5 ? -1 : 1;
      const kind = rand();
      const type = kind < 0.45 ? 'pine' : kind < 0.8 ? 'tree' : 'bush';
      this.segments[i].sprites.push({ type, offset: side * (1.35 + rand() * 1.6) });
      if (rand() < 0.35) this.segments[i].sprites.push({ type: 'pine', offset: -side * (1.5 + rand() * 2) });
    }
    // предупреждающие знаки перед крутыми поворотами
    for (let i = 20; i < n; i++) {
      const s = this.segments[i];
      const prev = this.segments[i - 1];
      if (Math.abs(s.curve) >= 3 && Math.abs(prev.curve) < 3 && i - 40 > 0) {
        const sign = this.segments[i - 40];
        sign.sprites.push({ type: s.curve > 0 ? 'sign_right' : 'sign_left', offset: s.curve > 0 ? 1.3 : -1.3 });
      }
    }
    // столбики вдоль дороги
    for (let i = 0; i < n; i += 20) {
      this.segments[i].sprites.push({ type: 'post', offset: 1.12 });
      this.segments[i].sprites.push({ type: 'post', offset: -1.12 });
    }
  }

  wrapZ(z) {
    const L = this.length;
    return ((z % L) + L) % L;
  }

  findSegment(z) {
    return this.segments[Math.floor(this.wrapZ(z) / SEGMENT_LENGTH) % this.segments.length];
  }

  // Максимальная |кривизна| на count сегментов вперёд.
  curveAhead(z, count) {
    const start = this.findSegment(z).index;
    let max = 0;
    for (let i = 0; i < count; i++) {
      const c = Math.abs(this.segments[(start + i) % this.segments.length].curve);
      if (c > max) max = c;
    }
    return max;
  }
}
