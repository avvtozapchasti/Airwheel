// Окружение трассы через параметры: деревья, камни, горы, пальмы, дюны, здания, фонари.
// Всё массовое — InstancedMesh, разбитые на чанки по 400 м (отсечение по пирамиде видимости)
// с двумя уровнями детализации: рядом — подробная модель, вдали — упрощённая.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../util/rng.js';
import { fbm2 } from './terrain.js';

const CHUNK = 400;

// Раскрасить геометрию одним цветом (vertex colors), чтобы сливать части разного цвета.
function tint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    arr[k * 3] = c.r;
    arr[k * 3 + 1] = c.g;
    arr[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merged(parts) {
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of nonIndexed) if (g.attributes.uv) g.deleteAttribute('uv');
  const out = mergeGeometries(nonIndexed);
  parts.forEach((g) => g.dispose());
  nonIndexed.forEach((g) => g.dispose());
  out.computeVertexNormals();
  return out;
}

// --- модели ---
export function spruceGeo(lod) {
  if (lod === 'lo') {
    const cone = new THREE.ConeGeometry(2.0, 8.6, 5);
    cone.translate(0, 5.0, 0);
    return merged([tint(cone, 0x1f4a2a)]);
  }
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, 2.4, 5);
  trunk.translate(0, 1.2, 0);
  const c1 = new THREE.ConeGeometry(2.3, 3.8, 8);
  c1.translate(0, 3.4, 0);
  const c2 = new THREE.ConeGeometry(1.75, 3.3, 8);
  c2.translate(0, 5.4, 0);
  const c3 = new THREE.ConeGeometry(1.1, 2.9, 7);
  c3.translate(0, 7.3, 0);
  return merged([tint(trunk, 0x4a3322), tint(c1, 0x1d4527), tint(c2, 0x22502d), tint(c3, 0x285a33)]);
}

export function palmGeo(lod) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 8, lod === 'lo' ? 4 : 6, 4);
  // лёгкий изгиб ствола
  const p = trunk.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k) + 4;
    p.setX(k, p.getX(k) + 0.02 * y * y);
  }
  trunk.translate(0, 4, 0);
  parts.push(tint(trunk, 0x7a5a3a));
  const leaves = lod === 'lo' ? 5 : 8;
  for (let k = 0; k < leaves; k++) {
    const leaf = new THREE.PlaneGeometry(1.1, 4.2, 1, lod === 'lo' ? 1 : 3);
    leaf.translate(0, 2.1, 0);
    leaf.rotateX(-1.0 - (k % 2) * 0.35);
    leaf.rotateY((k / leaves) * Math.PI * 2);
    leaf.translate(1.3, 8, 0);
    parts.push(tint(leaf, k % 2 ? 0x2f7a35 : 0x3b8c3a));
  }
  return merged(parts);
}

function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const r = rng(seed);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const f = 0.75 + fbm2(x * 1.7 + seed, z * 1.7 + y, 2) * 0.5 + r() * 0.08;
    p.setXYZ(k, x * f * 1.3, y * f * 0.8, z * f);
  }
  g.translate(0, 0.35, 0);
  return merged([tint(g, 0xffffff)]);
}

// --- чанки с LOD ---
export class ChunkedInstances {
  constructor(name, hiGeo, loGeo, material, { lodDist = 260, shadows = false } = {}) {
    this.name = name;
    this.hiGeo = hiGeo;
    this.loGeo = loGeo;
    this.material = material;
    this.lodDist = lodDist;
    this.shadows = shadows;
    this.items = new Map(); // key -> {mats: [], colors: []}
    this.chunks = [];
    this.group = new THREE.Group();
    this.group.name = name;
  }

  add(matrix, color) {
    const e = matrix.elements;
    const key = `${Math.floor(e[12] / CHUNK)},${Math.floor(e[14] / CHUNK)}`;
    let c = this.items.get(key);
    if (!c) this.items.set(key, (c = { mats: [], colors: [] }));
    c.mats.push(matrix.clone());
    c.colors.push(color);
  }

  build() {
    for (const [, c] of this.items) {
      const mk = (geo) => {
        const im = new THREE.InstancedMesh(geo, this.material, c.mats.length);
        c.mats.forEach((m, k) => {
          im.setMatrixAt(k, m);
          if (c.colors[k]) im.setColorAt(k, c.colors[k]);
        });
        im.computeBoundingSphere();
        im.castShadow = this.shadows;
        im.receiveShadow = false;
        return im;
      };
      const hi = mk(this.hiGeo);
      const lo = this.loGeo ? mk(this.loGeo) : null;
      if (lo) lo.visible = false;
      const center = hi.boundingSphere.center.clone();
      this.group.add(hi);
      if (lo) this.group.add(lo);
      this.chunks.push({ hi, lo, center, radius: hi.boundingSphere.radius });
    }
    this.items.clear();
    return this.group;
  }

  // Переключение LOD по расстоянию до камеры (с запасом на размер чанка).
  update(camPos, lodScale = 1) {
    const lim = this.lodDist * lodScale;
    for (const c of this.chunks) {
      if (!c.lo) continue;
      const near = camPos.distanceTo(c.center) - c.radius * 0.6 < lim;
      c.hi.visible = near;
      c.lo.visible = !near;
    }
  }

  setShadows(on) {
    for (const c of this.chunks) c.hi.castShadow = on && this.shadows;
  }
}

// Случайная точка за ограждением: вдоль трассы, по обе стороны, плотнее у дороги.
function sampleOutside(track, grid, r, near, far, extra = 3) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const dist = wall + near + (far - near) * Math.pow(r(), 1.6);
    const along = (r() - 0.5) * 20;
    const x = track.x[i] + track.nx[i] * side * dist + track.tx[i] * along;
    const z = track.z[i] + track.nz[i] * side * dist + track.tz[i] * along;
    if (grid.clear(x, z, extra)) return { x, z, i, dist };
  }
  return null;
}

// Горы на горизонте: кольцо конусов с шумом и снежными шапками, одним мешем.
function buildPeaks(track, cfg, fogColor) {
  const r = rng(404);
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const parts = [];
  const rockC = new THREE.Color(0x5c6470), snowC = new THREE.Color(0xf4f7fb), haze = new THREE.Color(fogColor);
  for (let k = 0; k < cfg.count; k++) {
    const a = (k / cfg.count) * Math.PI * 2 + r() * 0.3;
    const dist = cfg.dist[0] + r() * (cfg.dist[1] - cfg.dist[0]);
    const h = cfg.height[0] + r() * (cfg.height[1] - cfg.height[0]);
    const g = new THREE.ConeGeometry(h * (1.1 + r() * 0.5), h, 14, 8);
    const p = g.attributes.position;
    const cols = new Float32Array(p.count * 3);
    const seed = r() * 100;
    const c = new THREE.Color();
    for (let q = 0; q < p.count; q++) {
      const x = p.getX(q), y = p.getY(q), z = p.getZ(q);
      const t = (y + h / 2) / h; // 0 низ .. 1 вершина
      const n = fbm2(x / 90 + seed, z / 90 + y / 120, 3);
      const k2 = 1 + (n - 0.5) * 0.5 * (1 - t);
      p.setXYZ(q, x * k2, y + (n - 0.5) * h * 0.12, z * k2);
      const snow = cfg.snow ? THREE.MathUtils.smoothstep(t + (n - 0.5) * 0.25, 0.55, 0.7) : 0;
      c.copy(rockC).lerp(snowC, snow).lerp(haze, 0.28);
      cols[q * 3] = c.r;
      cols[q * 3 + 1] = c.g;
      cols[q * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.translate(cx + Math.cos(a) * dist, h / 2 - 60, cz + Math.sin(a) * dist);
    parts.push(g);
  }
  const geo = merged(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  // дальние горы — туман слабее, чтобы вершины читались на горизонте
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'vFogDepth = -mvPosition.z * 0.42;');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'peaks';
  return mesh;
}

// Построить окружение трассы. Возвращает { group, update(camPos), setShadows(on) }.
export function buildScenery(track, env, grid, heightAt, { density = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const sc = env.scenery || {};
  const lods = [];
  const r = rng(track.id.length * 1000 + 7);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // деревья: ели или пальмы
  for (const kind of ['trees', 'palms']) {
    const cfg = sc[kind];
    if (!cfg) continue;
    const isPalm = kind === 'palms' || cfg.kind === 'palm';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: isPalm ? THREE.DoubleSide : THREE.FrontSide });
    const set = new ChunkedInstances(kind, isPalm ? palmGeo('hi') : spruceGeo('hi'), isPalm ? palmGeo('lo') : spruceGeo('lo'), mat, {
      lodDist: cfg.lod ?? 260,
      shadows: true,
    });
    const count = Math.round(cfg.count * density);
    const col = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const pt = sampleOutside(track, grid, r, cfg.near ?? 6, cfg.far ?? 300, 2.5);
      if (!pt) continue;
      const y = heightAt(pt.x, pt.z);
      const scale = (cfg.scale ?? 1) * (0.7 + r() * 0.7);
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      m.compose(p.set(pt.x, y - 0.2, pt.z), q, s.set(scale, scale * (0.85 + r() * 0.3), scale));
      const v = 0.8 + r() * 0.35;
      set.add(m, col.setRGB(v, v * (0.95 + r() * 0.1), v).clone());
    }
    group.add(set.build());
    lods.push(set);
  }

  // камни
  if (sc.rocks) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f8a82, vertexColors: true, roughness: 0.9, flatShading: true });
    const set = new ChunkedInstances('rocks', rockGeo(3), null, mat, { shadows: true });
    const col = new THREE.Color();
    for (let k = 0; k < sc.rocks.count * density; k++) {
      const scale = 0.4 + Math.pow(r(), 3) * 3.2;
      const pt = sampleOutside(track, grid, r, 2 + scale, sc.rocks.far ?? 220, 1 + scale);
      if (!pt) continue;
      q.setFromEuler(new THREE.Euler(r() * 0.4, r() * Math.PI * 2, r() * 0.4));
      m.compose(p.set(pt.x, heightAt(pt.x, pt.z) - scale * 0.25, pt.z), q, s.set(scale, scale, scale));
      const v = 0.7 + r() * 0.4;
      set.add(m, col.setRGB(v, v, v).clone());
    }
    group.add(set.build());
    lods.push(set);
  }

  if (sc.peaks) group.add(buildPeaks(track, sc.peaks, env.fog?.color ?? 0xbfd2e2));

  return {
    group,
    update(camPos, lodScale = 1) {
      for (const l of lods) l.update(camPos, lodScale);
    },
    setShadows(on) {
      for (const l of lods) l.setShadows(on);
    },
  };
}
