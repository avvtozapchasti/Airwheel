// Рельеф вокруг трассы: у дороги — ровные зоны вылета на её высоте, дальше — холмы и склоны.
// Высота вдали — гладкое среднее высот трассы (IDW) + шум + подъём к краям (горная долина).
// Возвращает меш и функцию heightAt(x, z) для расстановки окружения.
import * as THREE from 'three';
import * as TX from './textures.js';
import { smoothstep } from '../util/rng.js';

// Недорогой 2D-шум (value noise по хэшу) и fBm.
function hash(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
export function fbm2(x, z, oct = 4) {
  let v = 0, amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    v += noise2(x, z) * amp;
    tot += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return v / tot;
}

// Пространственный хэш выборок трассы: быстрый поиск ближайшей точки центра.
export class TrackGrid {
  constructor(track, cell = 24) {
    this.track = track;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < track.n; i++) {
      const k = this.key(Math.floor(track.x[i] / cell), Math.floor(track.z[i] / cell));
      let arr = this.map.get(k);
      if (!arr) this.map.set(k, (arr = []));
      arr.push(i);
    }
  }
  key(cx, cz) {
    return (cx + 32768) * 65536 + (cz + 32768); // без коллизий для |координат| < 780 км
  }
  // Ближайшая выборка в радиусе ~1.5 ячейки: {i, r, d} или null.
  nearest(x, z, out = {}) {
    const c = this.cell, t = this.track;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = -1, bd = Infinity;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const arr = this.map.get(this.key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = x - t.x[i], dz = z - t.z[i];
          const q = dx * dx + dz * dz;
          if (q < bd) {
            bd = q;
            best = i;
          }
        }
      }
    if (best < 0) return null;
    out.i = best;
    out.r = Math.sqrt(bd);
    out.d = (x - t.x[best]) * t.nx[best] + (z - t.z[best]) * t.nz[best];
    return out;
  }
  // Свободно ли место: дальше extra метров за ограждением от любой части трассы.
  clear(x, z, extra) {
    const q = this.nearest(x, z);
    if (!q) return true;
    const t = this.track;
    const wall = q.d > 0 ? t.wallL[q.i] : t.wallR[q.i];
    return Math.abs(q.d) > wall + extra && q.r > t.hw[q.i] + extra;
  }
}

export function buildTerrain(track, env, grid, { cell = 10 } = {}) {
  const T = env.terrain || {};
  const margin = T.margin ?? 800;
  const b = track.bounds;
  const x0 = b.minX - margin, z0 = b.minZ - margin;
  const nx = Math.ceil((b.maxX - b.minX + 2 * margin) / cell) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ + 2 * margin) / cell) + 1;

  // --- грубое поле (шаг 40 м): расстояние до трассы и гладкая высота (IDW) ---
  const C = 40;
  const cnx = Math.ceil((nx * cell) / C) + 2, cnz = Math.ceil((nz * cell) / C) + 2;
  const cDist = new Float32Array(cnx * cnz);
  const cH = new Float32Array(cnx * cnz);
  const step = Math.max(1, Math.round(8 / track.ds));
  for (let q = 0; q < cnz; q++) {
    for (let p = 0; p < cnx; p++) {
      const x = x0 + p * C, z = z0 + q * C;
      let dmin = Infinity, ws = 0, hs = 0;
      for (let i = 0; i < track.n; i += step) {
        const dx = x - track.x[i], dz = z - track.z[i];
        const d2 = dx * dx + dz * dz;
        if (d2 < dmin) dmin = d2;
        const w = 1 / ((d2 + 2500) * (d2 + 2500));
        ws += w;
        hs += w * track.y[i];
      }
      cDist[q * cnx + p] = Math.sqrt(dmin);
      cH[q * cnx + p] = hs / ws;
    }
  }
  const coarse = (arr, x, z) => {
    const fx = Math.max(0, Math.min(cnx - 1.001, (x - x0) / C));
    const fz = Math.max(0, Math.min(cnz - 1.001, (z - z0) / C));
    const p = Math.floor(fx), q = Math.floor(fz);
    const u = fx - p, v = fz - q;
    const a = arr[q * cnx + p], bb = arr[q * cnx + p + 1], c = arr[(q + 1) * cnx + p], d = arr[(q + 1) * cnx + p + 1];
    return a * (1 - u) * (1 - v) + bb * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };

  const amp = T.amp ?? 20, rise = T.rise ?? 0, sc = T.scale ?? 1 / 300;
  const flat = !!T.flat;
  const near = {};
  // высота рельефа в точке
  const heightFn = (x, z) => {
    const q = grid.nearest(x, z, near);
    let r, yRoad, wall;
    if (q) {
      r = q.r;
      const i = q.i;
      const hw = track.hw[i];
      wall = q.d > 0 ? track.wallL[i] : track.wallR[i];
      const dc = Math.max(-hw, Math.min(hw, q.d));
      yRoad = track.heightAt(i, 0, dc);
      const ad = Math.abs(q.d);
      if (ad < hw + 0.5) return yRoad - 0.35;
      if (ad < wall + 3) return yRoad - 0.06;
    } else {
      r = coarse(cDist, x, z);
      wall = 12;
      yRoad = coarse(cH, x, z);
    }
    const smoothH = coarse(cH, x, z);
    const k = smoothstep(wall + 3, wall + 70, r);
    let h = yRoad + (smoothH - yRoad) * k - 0.06;
    if (!flat) {
      const hills = (fbm2(x * sc, z * sc) - 0.45) * amp + Math.min(T.riseMax ?? 120, rise * Math.max(0, r - wall - 60) * smoothstep(wall + 60, wall + 500, r));
      h += hills * smoothstep(wall + 6, wall + 160, r);
    }
    return h;
  };

  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const heights = new Float32Array(nx * nz);
  const base = new THREE.Color(T.color ?? 0xffffff);
  const rockC = new THREE.Color(0x8a8278);
  for (let q = 0; q < nz; q++) {
    for (let p = 0; p < nx; p++) {
      const k = q * nx + p;
      const x = x0 + p * cell, z = z0 + q * cell;
      const h = heightFn(x, z);
      heights[k] = h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 24;
      uv[k * 2 + 1] = z / 24;
    }
  }
  // цвет: оттенки + скалы на крутых склонах
  for (let q = 0; q < nz; q++) {
    for (let p = 0; p < nx; p++) {
      const k = q * nx + p;
      const hx = heights[q * nx + Math.min(nx - 1, p + 1)] - heights[q * nx + Math.max(0, p - 1)];
      const hz = heights[Math.min(nz - 1, q + 1) * nx + p] - heights[Math.max(0, q - 1) * nx + p];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      const x = x0 + p * cell, z = z0 + q * cell;
      const v = 0.82 + fbm2(x / 90, z / 90, 3) * 0.36;
      const rk = T.rocky === false ? 0 : smoothstep(0.55, 1.0, slope);
      col[k * 3] = (base.r * v) * (1 - rk) + rockC.r * rk;
      col[k * 3 + 1] = (base.g * v) * (1 - rk) + rockC.g * rk;
      col[k * 3 + 2] = (base.b * v) * (1 - rk) + rockC.b * rk;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let q = 0; q < nz - 1; q++) {
    for (let p = 0; p < nx - 1; p++) {
      const a = q * nx + p, bb = a + 1, c = a + nx, d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = bb;
      idx[o++] = bb;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const tex = { grass: TX.grass, sand: TX.sand, concrete: TX.concrete, dry: TX.dryGrass }[env.ground || 'grass']();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // быстрая высота по сетке (билинейно) — для деревьев, камней, трибун
  const heightAt = (x, z) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / cell));
    const fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / cell));
    const p = Math.floor(fx), q = Math.floor(fz);
    const u = fx - p, v = fz - q;
    const a = heights[q * nx + p], bb = heights[q * nx + p + 1], c = heights[(q + 1) * nx + p], d = heights[(q + 1) * nx + p + 1];
    // та же диагональ, что в треугольниках
    return u + v < 1 ? a + (bb - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (bb - d) * (1 - v);
  };
  return { mesh, heightAt, bounds: { x0, z0, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell } };
}
