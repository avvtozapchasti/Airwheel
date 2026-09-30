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

// Фасад с окнами: цвет + emissive (светящиеся окна ночью).
export function windows({ lit = 0.45, seed = 71, tint = '#ffd9a0' } = {}) {
  return cached(`windows-${lit}-${seed}-${tint}`, () => {
    const W = 256, H = 512, cols = 8, rows = 16;
    const c = canvas(W, H), e = canvas(W, H);
    const ctx = c.getContext('2d'), ex = e.getContext('2d');
    ctx.fillStyle = '#8d9097';
    ctx.fillRect(0, 0, W, H);
    ex.fillStyle = '#000';
    ex.fillRect(0, 0, W, H);
    const r = rng(seed);
    const cw = W / cols, ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = r() < lit;
        ctx.fillStyle = on ? '#e8d7b0' : r() < 0.5 ? '#2b3440' : '#394452';
        ctx.fillRect(x * cw + 4, y * ch + 5, cw - 8, ch - 10);
        if (on) {
          ex.fillStyle = r() < 0.15 ? '#9fd4ff' : tint;
          ex.globalAlpha = 0.5 + r() * 0.5;
          ex.fillRect(x * cw + 4, y * ch + 5, cw - 8, ch - 10);
          ex.globalAlpha = 1;
        }
      }
    }
    return { map: toTexture(c), emissiveMap: toTexture(e) };
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

export function disposeAll() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v) for (const t of Object.values(v)) t?.dispose?.();
  }
  cache.clear();
}
