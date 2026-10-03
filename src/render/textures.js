// Процедурные текстуры на canvas: никаких файлов, всё генерируется при загрузке.
// Асфальт (цвет + normal + roughness), трава, песок, гравий, бетон, поребрик, карбон,
// окна зданий (emissive), табло, клетчатая полоса, мягкое пятно света.
import * as THREE from 'three';
import { rng } from '../util/rng.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Тайлящийся value noise: сетка случайных значений с периодом period.
function makeNoise(period, seed) {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1];
    const c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// fBm на size×size, тайлится. Возвращает Float32Array значений ~0..1.
function fbm(size, baseCells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const nz = makeNoise(cells, seed + o * 17);
    const k = cells / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] += nz(x * k, y * k) * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Normal map из карты высот (Собель), тайлится.
function normalFromHeight(h, size, strength) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (-dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// Асфальт: u — поперёк дороги (края = белые линии), v — вдоль.
// wet — мокрое покрытие: темнее и глаже.
export function asphalt({ wet = false, lines = true } = {}) {
  return cached(`asphalt-${wet}-${lines}`, () => {
    const S = 512;
    const hgt = fbm(S, 8, 6, 11);
    const grain = rng(5);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const rough = canvas(S);
    const rctx = rough.getContext('2d');
    const rimg = rctx.createImageData(S, S);
    const base = wet ? 34 : 50;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const g = grain();
        hgt[i] = hgt[i] * 0.7 + g * 0.3;
        let v = base + (hgt[i] - 0.5) * 34 + (g > 0.985 ? 30 : 0) - (g < 0.02 ? 14 : 0);
        const u = x / S;
        let line = false;
        if (lines && ((u > 0.012 && u < 0.03) || (u > 0.97 && u < 0.988))) line = true;
        let r = v, gg = v + 1, b = v + 4;
        if (line) {
          const w = 205 + (g - 0.5) * 30;
          r = gg = b = wet ? w * 0.8 : w;
        }
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = gg;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
        // roughness: мокрый асфальт гладкий, сухой — шершавый
        const ro = wet ? 40 + hgt[i] * 70 : 200 + (hgt[i] - 0.5) * 60;
        rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = line ? ro * 0.7 : ro;
        rimg.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    // пятна-заплатки
    const pr = rng(9);
    ctx.globalAlpha = 0.05;
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = pr() < 0.5 ? '#000' : '#888';
      ctx.fillRect(pr() * S * 0.8 + S * 0.08, pr() * S, 20 + pr() * 60, 30 + pr() * 90);
    }
    ctx.globalAlpha = 1;
    return {
      map: toTexture(c),
      normalMap: toTexture(normalFromHeight(hgt, S, 2.2), { srgb: false }),
      roughnessMap: toTexture(rough, { srgb: false }),
    };
  });
}

// Крупный мягкий шум (тайлится): пятна разного износа асфальта — ломает повтор текстуры.
export function macroNoise() {
  return cached('macro', () => {
    const S = 128, h = fbm(S, 4, 4, 23);
    const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.round(h[i] * 255);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false, aniso: 2 });
  });
}

// Цветной шум с палитрой (трава, песок, гравий, бетон, скалы).
function paletteNoise(key, S, cells, oct, seed, colorFn) {
  return cached(key, () => {
    const h = fbm(S, cells, oct, seed);
    const r = rng(seed + 1);
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const [R, G, B] = colorFn(h[i], r());
      img.data[i * 4] = R;
      img.data[i * 4 + 1] = G;
      img.data[i * 4 + 2] = B;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, S, 3), { srgb: false }) };
  });
}

export const grass = () =>
  paletteNoise('grass', 256, 8, 5, 21, (v, g) => {
    const k = 0.75 + v * 0.5 + (g - 0.5) * 0.25;
    return [52 * k, 92 * k, 34 * k];
  });

export const dryGrass = () =>
  paletteNoise('dryGrass', 256, 8, 5, 23, (v, g) => {
    const k = 0.8 + v * 0.45 + (g - 0.5) * 0.2;
    return [128 * k, 122 * k, 70 * k];
  });

export const sand = () =>
  paletteNoise('sand', 256, 6, 5, 31, (v, g) => {
    const k = 0.85 + v * 0.3 + (g - 0.5) * 0.12;
    return [214 * k, 190 * k, 142 * k];
  });

// Красный песок пустыни: рябь дюн и камешки.
export const desertSand = () =>
  paletteNoise('desertSand', 256, 6, 5, 33, (v, g) => {
    const k = 0.82 + v * 0.32 + (g - 0.5) * 0.12;
    return [222 * k, 150 * k, 100 * k];
  });

export const gravel = () =>
  paletteNoise('gravel', 256, 16, 3, 41, (v, g) => {
    const k = 0.7 + v * 0.3 + (g - 0.5) * 0.5;
    return [178 * k, 164 * k, 138 * k];
  });

export const concrete = () =>
  paletteNoise('concrete', 256, 8, 5, 51, (v, g) => {
    const k = 0.8 + v * 0.3 + (g - 0.5) * 0.1;
    return [150 * k, 150 * k, 146 * k];
  });

export const rock = () =>
  paletteNoise('rock', 256, 6, 6, 61, (v, g) => {
    const k = 0.6 + v * 0.6 + (g - 0.5) * 0.1;
    return [118 * k, 112 * k, 104 * k];
  });

// Поребрик: красно-белые полосы вдоль v (4 полосы на текстуру).
export function kerb() {
  return cached('kerb', () => {
    const c = canvas(64, 256);
    const ctx = c.getContext('2d');
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k % 2 ? '#f2f2f2' : '#d42020';
      ctx.fillRect(0, k * 64, 64, 64);
    }
    // лёгкий износ
    const r = rng(3);
    ctx.globalAlpha = 0.15;
    for (let k = 0; k < 400; k++) {
      ctx.fillStyle = r() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(r() * 64, r() * 256, 2, 2);
    }
    return toTexture(c);
  });
}

// Карбон: диагональное плетение «ёлочкой».
export function carbon() {
  return cached('carbon', () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#111316';
    ctx.fillRect(0, 0, S, S);
    const cell = 8;
    for (let y = 0; y < S; y += cell) {
      for (let x = 0; x < S; x += cell) {
        const odd = ((x + y) / cell) % 2;
        const g = ctx.createLinearGradient(x, y, x + (odd ? cell : 0), y + (odd ? 0 : cell));
        g.addColorStop(0, '#1d2127');
        g.addColorStop(0.5, '#3a3f47');
        g.addColorStop(1, '#16191d');
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }
    const t = toTexture(c);
    t.repeat.set(4, 4);
    return t;
  });
}

// Normal map карбонового плетения: наклон волокон чередуется по клеткам.
export function carbonNormal() {
  return cached('carbonNormal', () => {
    const S = 128, cell = 8;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const fx = (x % cell) / cell, fy = (y % cell) / cell;
        const odd = (cx + cy) % 2;
        h[y * S + x] = odd ? Math.sin(Math.PI * fx) * 0.9 : Math.sin(Math.PI * fy) * 0.9;
      }
    const t = toTexture(normalFromHeight(h, S, 1.6), { srgb: false });
    t.repeat.set(4, 4);
    return t;
  });
}

// Сетка воздухозаборника (соты).
export function grille() {
  return cached('grille', () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#3a3f46';
    ctx.lineWidth = 2;
    const r = 8;
    for (let y = 0; y < S + r; y += r * 1.5)
      for (let x = 0; x < S + r; x += r * Math.sqrt(3)) {
        const ox = (Math.round(y / (r * 1.5)) % 2) * (r * Math.sqrt(3)) / 2;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          ctx.lineTo(x + ox + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
        }
        ctx.closePath();
        ctx.stroke();
      }
    const t = toTexture(c);
    t.repeat.set(6, 6);
    return t;
  });
}

// Шина: резина с надписью на боковине (u — вокруг колеса, v — по профилю).
export function tyreSide() {
  return cached('tyreSide', () => {
    const W = 1024, H = 64, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);
    // протектор (середина профиля) чуть темнее и с полосами износа
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, H * 0.32, W, H * 0.36);
    ctx.fillStyle = '#e6e6e6';
    ctx.font = `800 ${Math.round(H * 0.16)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      ctx.fillText('APEX TIRES · RACING SLICK', (W / 3) * k + 20, H * 0.12);
      ctx.save();
      ctx.translate((W / 3) * k + 20, H * 0.88);
      ctx.scale(1, -1);
      ctx.fillText('APEX TIRES · RACING SLICK', 0, 0);
      ctx.restore();
    }
    const t = toTexture(c, { aniso: 4 });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// Клетчатая полоса старта/финиша.
export function checker() {
  return cached('checker', () => {
    const c = canvas(256, 32), ctx = c.getContext('2d');
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 16; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    return toTexture(c);
  });
}

// Мягкое круглое пятно (частицы, свечения, лужи света).
export function glow() {
  return cached('glow', () => {
    const S = 64, c = canvas(S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c, { repeat: false });
  });
}

// Табличка с текстом (тормозные маркеры 100/50, DRS, названия).
export function board(text, { bg = '#ffffff', fg = '#111111', w = 256, h = 128, font = 800 } = {}) {
  return cached(`board-${text}-${bg}-${fg}-${w}x${h}`, () => {
    const c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `${font} ${Math.round(h * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + h * 0.04);
    return toTexture(c, { repeat: false });
  });
}

// Ограждение armco: оцинкованный металл с двумя волнами профиля (u — по высоте).
export function armco() {
  return cached('armco', () => {
    const c = canvas(64, 128), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    const stops = [[0, '#6f757c'], [0.2, '#c9ced4'], [0.35, '#8c9299'], [0.5, '#d7dbe0'], [0.65, '#8c9299'], [0.8, '#c9ced4'], [1, '#6f757c']];
    // полоса профиля только в верхней части (u 0.55..0.95), ниже — стойки/тень
    ctx.fillStyle = '#3c4146';
    ctx.fillRect(0, 0, 64, 128);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g;
    ctx.fillRect(34, 0, 26, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 128; y += 32) ctx.fillRect(34, y, 26, 2);
    return toTexture(c);
  });
}

// Бетонный блок с красно-белой полосой сверху (u — по высоте стены).
export function concreteWall() {
  return cached('concreteWall', () => {
    const c = canvas(64, 256), ctx = c.getContext('2d');
    const r = rng(81);
    ctx.fillStyle = '#b8b8b2';
    ctx.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 900; k++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      ctx.fillRect(r() * 64, r() * 256, 2, 2);
    }
    for (let y = 0; y < 256; y += 64) {
      ctx.fillStyle = (y / 64) % 2 ? '#d61f1f' : '#f4f4f4';
      ctx.fillRect(52, y, 12, 64);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, y, 64, 1);
    }
    return toTexture(c);
  });
}

// Сетка забора (альфа-тест).
export function fence() {
  return cached('fence', () => {
    const c = canvas(64), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = '#c8ccd2';
    ctx.lineWidth = 2;
    for (let k = -64; k < 128; k += 16) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 64, 64);
      ctx.moveTo(k + 64, 0);
      ctx.lineTo(k, 64);
      ctx.stroke();
    }
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillRect(0, 60, 64, 4);
    const t = toTexture(c);
    t.repeat.set(1, 1);
    return t;
  });
}

// Зрители на трибунах: цветные точки на тёмных сиденьях.
export function crowd() {
  return cached('crowd', () => {
    const c = canvas(256), ctx = c.getContext('2d');
    const r = rng(91);
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(0, 0, 256, 256);
    const cols = ['#e63946', '#f1faee', '#ffcc33', '#1d3557', '#2a9d8f', '#f4a261', '#ffffff', '#e76f51', '#8ecae6'];
    for (let k = 0; k < 2600; k++) {
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      const x = r() * 256, y = r() * 256;
      ctx.fillRect(x, y, 3, 4);
      ctx.fillStyle = '#e0b89a';
      ctx.fillRect(x + 0.5, y - 2, 2, 2);
    }
    const t = toTexture(c);
    t.repeat.set(4, 1);
    return t;
  });
}

// Нормали воды: мелкая рябь (тайлится).
export function water() {
  return cached('water', () => {
    const S = 256;
    const h = fbm(S, 8, 5, 101);
    const t = toTexture(normalFromHeight(h, S, 5), { srgb: false });
    t.repeat.set(160, 160);
    return t;
  });
}

// Шинное ограждение: ряды шин, сверху — красно-белая полоса (u — по высоте).
export function tyres() {
  return cached('tyres', () => {
    const c = canvas(64, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 128; y += 16) {
      for (let x = 0; x < 50; x += 12) {
        ctx.fillStyle = '#262626';
        ctx.beginPath();
        ctx.ellipse(x + 6, y + 8, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b0b0b';
        ctx.beginPath();
        ctx.ellipse(x + 6, y + 8, 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let y = 0; y < 128; y += 32) {
      ctx.fillStyle = (y / 32) % 2 ? '#e8e8e8' : '#d42020';
      ctx.fillRect(48, y, 16, 32);
    }
    return toTexture(c);
  });
}

// --- город ---
// Фасады: массив текстур (4 стиля, без «протекания» мип-уровней между стилями).
// Слой: 8 окон × 16 этажей (одна ячейка ≈ 2.75 × 3 м). Цвет: RGB + альфа = маска стекла
// (стекло глянцевое). Свечение: цвет каждого окна, «горит ли окно» решает шейдер.
//   0 — жилой дом (тёплый свет, балконы), 1 — офис (сетка, холодный свет),
//   2 — ленточное остекление, 3 — стеклянный фасад (тёмно-синее стекло, импосты)
export const FACADE_STYLES = 4;
export function facadeLayers() {
  return cached('facades', () => {
    const W = 256, H = 512, cols = 8, rows = 16, cw = W / cols, ch = H / rows;
    const color = new Uint8Array(W * H * 4 * FACADE_STYLES), emis = new Uint8Array(W * H * 4 * FACADE_STYLES);
    const styles = [
      { wall: '#a49c90', glass: ['#26303b', '#2f3a46', '#1f2731'], lit: ['#ffd49a', '#ffc27a', '#ffe2b8', '#ffb98a'], win: [20, 19, 6] },
      { wall: '#7d8592', glass: ['#1f2a36', '#25313f'], lit: ['#e4f1ff', '#cfe6ff', '#f4f8ff'], win: [27, 22, 5] },
      { wall: '#c9c6bf', glass: ['#223040', '#1b2633'], lit: ['#f2f6ff', '#ffe0b0', '#d6ecff'], ribbon: true },
      { wall: '#1b2735', glass: ['#203246', '#1a2a3c', '#26394f'], lit: ['#bfe0ff', '#e8f4ff', '#9fd0ff'], curtain: true },
    ];
    styles.forEach((st, layer) => {
      const r = rng(311 + layer * 37);
      const c = canvas(W, H), e = canvas(W, H), m = canvas(W, H);
      const cx = c.getContext('2d'), ex = e.getContext('2d'), mx = m.getContext('2d');
      cx.fillStyle = st.wall;
      cx.fillRect(0, 0, W, H);
      ex.fillStyle = '#000';
      ex.fillRect(0, 0, W, H);
      mx.fillStyle = '#000';
      mx.fillRect(0, 0, W, H);
      // фактура стены: пятна и межэтажные пояса
      for (let k = 0; k < 1400; k++) {
        cx.fillStyle = `rgba(0,0,0,${r() * 0.07})`;
        cx.fillRect(r() * W, r() * H, 2 + r() * 4, 2 + r() * 4);
      }
      const pick = (arr) => arr[Math.floor(r() * arr.length)];
      const win = (x, y, w, h) => {
        cx.fillStyle = pick(st.glass);
        cx.fillRect(x, y, w, h);
        // блик на стекле (верхняя часть светлее)
        cx.fillStyle = 'rgba(255,255,255,0.06)';
        cx.fillRect(x, y, w, h * 0.35);
        mx.fillStyle = '#fff';
        mx.fillRect(x, y, w, h);
        const col = pick(st.lit);
        ex.fillStyle = col;
        ex.globalAlpha = 0.55 + r() * 0.45;
        ex.fillRect(x, y, w, h);
        // шторы/жалюзи — часть окна темнее
        if (r() < 0.35) {
          ex.globalAlpha = 0.5;
          ex.fillStyle = '#000';
          ex.fillRect(x, y, w, h * (0.2 + r() * 0.5));
        }
        ex.globalAlpha = 1;
      };
      if (st.ribbon || st.curtain) {
        for (let y = 0; y < rows; y++) {
          const y0 = y * ch + (st.curtain ? 2 : 7), hh = st.curtain ? ch - 4 : ch - 13;
          // сплошная лента стекла с импостами
          for (let x = 0; x < cols * 2; x++) win(x * (cw / 2) + 1, y0, cw / 2 - 2, hh);
          cx.fillStyle = st.curtain ? '#3a4d63' : '#9da3aa';
          cx.fillRect(0, y * ch, W, st.curtain ? 2 : 6);
        }
      } else {
        const [ww, wh, myp] = st.win;
        for (let y = 0; y < rows; y++) {
          // межэтажный пояс
          cx.fillStyle = 'rgba(0,0,0,0.12)';
          cx.fillRect(0, y * ch + ch - 3, W, 3);
          for (let x = 0; x < cols; x++) {
            const x0 = x * cw + (cw - ww) / 2, y0 = y * ch + myp;
            win(x0, y0, ww, wh);
            // откосы
            cx.fillStyle = 'rgba(0,0,0,0.25)';
            cx.fillRect(x0 - 1, y0 - 1, ww + 2, 2);
            if (layer === 0 && r() < 0.18) {
              // балкон
              cx.fillStyle = '#6f6a62';
              cx.fillRect(x0 - 3, y0 + wh, ww + 6, 4);
            }
          }
        }
      }
      const ci = cx.getImageData(0, 0, W, H).data, ei = ex.getImageData(0, 0, W, H).data, mi = mx.getImageData(0, 0, W, H).data;
      const off = layer * W * H * 4;
      for (let k = 0; k < W * H; k++) {
        color[off + k * 4] = ci[k * 4];
        color[off + k * 4 + 1] = ci[k * 4 + 1];
        color[off + k * 4 + 2] = ci[k * 4 + 2];
        color[off + k * 4 + 3] = mi[k * 4];
        emis[off + k * 4] = ei[k * 4];
        emis[off + k * 4 + 1] = ei[k * 4 + 1];
        emis[off + k * 4 + 2] = ei[k * 4 + 2];
        emis[off + k * 4 + 3] = 255;
      }
    });
    const mk = (data) => {
      const t = new THREE.DataArrayTexture(data, W, H, FACADE_STYLES);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    return { map: mk(color), emissive: mk(emis) };
  });
}

// Вымышленные бренды для рекламы (щиты у трассы, LED-экраны, вывески на крышах).
// Атлас 4×4 плитки 512×256: 8 брендов × 2 варианта (логотип / слоган).
export const BRANDS = [
  { name: 'AIRWHEEL', slogan: 'Рули руками', bg: ['#0b0f1a', '#1b2233'], fg: '#ffcc33', mark: 'wheel' },
  { name: 'FISTBUMP', sub: 'COLA', slogan: 'Газ — кулаком!', bg: ['#c8102e', '#7a0a1c'], fg: '#ffffff', mark: 'fizz' },
  { name: 'TACHYON', sub: 'TYRES', slogan: 'Сцепление на пределе', bg: ['#111111', '#2a2a2a'], fg: '#ffd400', mark: 'chevron' },
  { name: 'PALMA', sub: 'FUEL', slogan: 'Ладонь — тормоз, бак — полный', bg: ['#0f7a3d', '#064d26'], fg: '#e9ffe9', mark: 'drop' },
  { name: 'NEONIX', slogan: 'Светим ярче', bg: ['#3a0ca3', '#7209b7'], fg: '#4cf2ff', mark: 'bolt' },
  { name: 'GESTURA', sub: 'MOBILE', slogan: 'Связь без кнопок', bg: ['#0a58ca', '#06357a'], fg: '#ffffff', mark: 'wave' },
  { name: 'KITSUNE', sub: 'RAMEN', slogan: 'Горячо, как шины', bg: ['#ff7a00', '#c2410c'], fg: '#fff7ed', mark: 'bowl' },
  { name: 'CHRONOLAP', slogan: 'Каждая тысячная', bg: ['#0b1d3a', '#13294b'], fg: '#e8eef8', mark: 'clock' },
];
function drawMark(ctx, kind, x, y, s, fg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'wheel') {
    ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.42, 0);
    ctx.lineTo(s * 0.42, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s * 0.42);
    ctx.stroke();
  } else if (kind === 'fizz') {
    for (const [bx, by, br] of [[0, 0.1, 0.3], [0.25, -0.25, 0.14], [-0.22, -0.3, 0.1]]) {
      ctx.moveTo(bx * s + br * s, by * s);
      ctx.arc(bx * s, by * s, br * s, 0, Math.PI * 2);
    }
    ctx.stroke();
  } else if (kind === 'chevron') {
    for (const o of [-0.25, 0.1]) {
      ctx.moveTo(o * s - 0.15 * s, -0.4 * s);
      ctx.lineTo(o * s + 0.2 * s, 0);
      ctx.lineTo(o * s - 0.15 * s, 0.4 * s);
    }
    ctx.stroke();
  } else if (kind === 'drop') {
    ctx.moveTo(0, -0.45 * s);
    ctx.quadraticCurveTo(0.4 * s, 0.05 * s, 0, 0.42 * s);
    ctx.quadraticCurveTo(-0.4 * s, 0.05 * s, 0, -0.45 * s);
    ctx.fill();
  } else if (kind === 'bolt') {
    ctx.moveTo(0.1 * s, -0.48 * s);
    ctx.lineTo(-0.22 * s, 0.05 * s);
    ctx.lineTo(0.02 * s, 0.05 * s);
    ctx.lineTo(-0.1 * s, 0.48 * s);
    ctx.lineTo(0.24 * s, -0.08 * s);
    ctx.lineTo(0, -0.08 * s);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'wave') {
    for (const rr of [0.15, 0.3, 0.45]) {
      ctx.moveTo(Math.cos(-0.8) * rr * s - 0.2 * s, Math.sin(-0.8) * rr * s + 0.2 * s);
      ctx.arc(-0.2 * s, 0.2 * s, rr * s, -0.8 - 0.0, -0.8 + 0.9 + 0.0);
    }
    ctx.stroke();
  } else if (kind === 'bowl') {
    ctx.arc(0, 0, s * 0.38, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    for (const o of [-0.15, 0, 0.15]) {
      ctx.moveTo(o * s, -0.08 * s);
      ctx.quadraticCurveTo(o * s + 0.1 * s, -0.25 * s, o * s, -0.42 * s);
    }
    ctx.stroke();
  } else if (kind === 'clock') {
    ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s * 0.28);
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.2, 0);
    ctx.stroke();
  }
  ctx.restore();
}
export function brandAtlas() {
  return cached('brands', () => {
    const TW = 512, TH = 256, c = canvas(TW * 4, TH * 4), ctx = c.getContext('2d');
    BRANDS.forEach((b, k) => {
      for (let v = 0; v < 2; v++) {
        const t = k * 2 + v, x0 = (t % 4) * TW, y0 = Math.floor(t / 4) * TH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, TW, TH);
        ctx.clip();
        const g = ctx.createLinearGradient(x0, y0, x0 + TW, y0 + TH);
        g.addColorStop(0, v ? b.bg[1] : b.bg[0]);
        g.addColorStop(1, v ? b.bg[0] : b.bg[1]);
        ctx.fillStyle = g;
        ctx.fillRect(x0, y0, TW, TH);
        // диагональные полосы-акценты
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = b.fg;
        for (let s = -TH; s < TW; s += 70) {
          ctx.beginPath();
          ctx.moveTo(x0 + s, y0 + TH);
          ctx.lineTo(x0 + s + 26, y0 + TH);
          ctx.lineTo(x0 + s + 26 + TH, y0);
          ctx.lineTo(x0 + s + TH, y0);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.fg;
        ctx.textBaseline = 'middle';
        if (v === 0) {
          drawMark(ctx, b.mark, x0 + 92, y0 + TH / 2, 120, b.fg);
          ctx.textAlign = 'left';
          const fs = b.name.length > 8 ? 70 : 84;
          ctx.font = `900 ${fs}px system-ui, sans-serif`;
          ctx.fillText(b.name, x0 + 170, y0 + TH / 2 - (b.sub ? 22 : 0), TW - 190);
          if (b.sub) {
            ctx.font = '700 40px system-ui, sans-serif';
            ctx.globalAlpha = 0.85;
            ctx.fillText(b.sub, x0 + 172, y0 + TH / 2 + 48);
            ctx.globalAlpha = 1;
          }
        } else {
          ctx.textAlign = 'center';
          ctx.font = '900 58px system-ui, sans-serif';
          ctx.fillText(b.name, x0 + TW / 2, y0 + 78, TW - 40);
          ctx.font = '600 34px system-ui, sans-serif';
          ctx.fillText(b.slogan, x0 + TW / 2, y0 + 170, TW - 40);
        }
        // рамка
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 6;
        ctx.strokeRect(x0 + 3, y0 + 3, TW - 6, TH - 6);
        ctx.restore();
      }
    });
    const t = toTexture(c, { repeat: false });
    t.anisotropy = 8;
    return t;
  });
}

// Неоновые вывески-«лезвия» (вертикальные, перпендикулярно фасаду): 8 штук 128×512 в ряд.
export const NEON_SIGNS = [
  ['ОТЕЛЬ', '#ff2d95'],
  ['БАР', '#21e6ff'],
  ['КАФЕ', '#ffb020'],
  ['24/7', '#39ff88'],
  ['РАМЕН', '#ff4d4d'],
  ['КЛУБ', '#b14dff'],
  ['ТАКСИ', '#fff04d'],
  ['КИНО', '#4da3ff'],
];
export function neonAtlas() {
  return cached('neon', () => {
    const TW = 128, TH = 512, c = canvas(TW * NEON_SIGNS.length, TH), ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, TH);
    NEON_SIGNS.forEach(([text, col], k) => {
      const x0 = k * TW;
      ctx.fillStyle = '#07080c';
      ctx.fillRect(x0 + 6, 6, TW - 12, TH - 12);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.strokeRect(x0 + 14, 14, TW - 28, TH - 28);
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 18;
      const chars = [...text];
      const fs = Math.min(84, (TH - 70) / chars.length);
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chars.forEach((ch, j) => {
        const y = 35 + (j + 0.5) * ((TH - 70) / chars.length);
        ctx.fillStyle = col;
        ctx.fillText(ch, x0 + TW / 2, y);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.shadowBlur = 0;
        ctx.fillText(ch, x0 + TW / 2, y);
        ctx.shadowBlur = 18;
      });
      ctx.shadowBlur = 0;
    });
    return toTexture(c, { repeat: false });
  });
}

// Вертолётная площадка: круг с «H».
export function helipad() {
  return cached('helipad', () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#3b3f45';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '900 140px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', S / 2, S / 2 + 8);
    return toTexture(c, { repeat: false });
  });
}

export function disposeAll() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v) for (const t of Object.values(v)) t?.dispose?.();
  }
  cache.clear();
}
