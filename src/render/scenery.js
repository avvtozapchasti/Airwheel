// Окружение трассы через параметры: деревья, камни, горы, пальмы, дюны, здания, фонари.
// Всё массовое — InstancedMesh, разбитые на чанки по 400 м (отсечение по пирамиде видимости)
// с двумя уровнями детализации: рядом — подробная модель, вдали — упрощённая.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../util/rng.js';
import { fbm2 } from './terrain.js';
import * as TX from './textures.js';
import { buildExtraScenery } from './scenery2.js';

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
  const rockC = new THREE.Color(cfg.color ?? 0x5c6470), snowC = new THREE.Color(0xf4f7fb), haze = new THREE.Color(fogColor);
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

// --- город ---
// Материал зданий: окна тайлятся в мировых координатах (4 м × 3.5 м), поэтому одна текстура
// подходит зданиям любого размера; ночью окна светятся (emissive), крыши без окон.
function buildingMaterial(tex, night) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    emissiveMap: tex.emissiveMap,
    emissive: night ? 0xffffff : 0x000000,
    emissiveIntensity: night ? 0.85 : 0,
    roughness: 0.7,
    metalness: 0.15,
    envMapIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWinUv;\nvarying float vRoof;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wpB = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec3 wnB = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        float horiz = abs(wnB.x) > abs(wnB.z) ? wpB.z : wpB.x;
        vWinUv = vec2(horiz / 22.0, wpB.y / 48.0);
        vRoof = step(0.5, wnB.y);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWinUv;\nvarying float vRoof;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= mix(texture2D(map, vWinUv).rgb, vec3(0.35), vRoof);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D(emissiveMap, vWinUv).rgb * (1.0 - vRoof);');
  };
  return mat;
}

function buildCity(track, env, grid, heightAt, seaAt, r, density) {
  const group = new THREE.Group();
  group.name = 'city';
  const cfg = env.scenery.buildings;
  const night = env.time === 'night';
  const lights = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const sets = [TX.windows({ lit: cfg.lit ?? 0.45, seed: 71 }), TX.windows({ lit: cfg.lit ?? 0.45, seed: 17, tint: '#bfe1ff' })].map(
    (tex) => new ChunkedInstances('buildings', box, null, buildingMaterial(tex, night), { shadows: false }),
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const facades = []; // для неона
  const tu = track.tunnel;
  const inTunnel = (sAt) => tu && (((sAt - tu.s0) % track.length) + track.length) % track.length < tu.length + 30;
  const place = (i, side, dist, w, d, h) => {
    const nx = track.nx[i] * side, nz = track.nz[i] * side;
    const cx = track.x[i] + nx * (dist + d / 2), cz = track.z[i] + nz * (dist + d / 2);
    // все углы и центр должны быть свободны (не на другой части трассы и не в море)
    const tx = track.tx[i], tz = track.tz[i];
    for (const [a, b] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
      const x = cx + tx * a + nx * b, z = cz + tz * a + nz * b;
      if (!grid.clear(x, z, 1.5) || seaAt(x, z) > 0.01) return null;
    }
    const y = heightAt(cx, cz) - 0.5;
    q.setFromAxisAngle(up, Math.atan2(nx, nz));
    m.compose(p.set(cx, y, cz), q, sc.set(w, h + 0.5, d));
    const v = 0.55 + r() * 0.5;
    const set = sets[Math.floor(r() * sets.length)];
    set.add(m, col.setRGB(v, v * (0.95 + r() * 0.1), v * (0.95 + r() * 0.12)).clone());
    return { cx, cz, nx, nz, w, d, h, y, heading: Math.atan2(nx, nz) };
  };
  // первый ряд — вдоль трассы, плотно; второй — высокие здания подальше (силуэт города)
  const stepFront = Math.max(1, Math.round(20 / track.ds));
  for (let i = 0; i < track.n && !cfg.back; i += stepFront) {
    if (inTunnel(i * track.ds)) continue;
    for (const side of [1, -1]) {
      if (r() > 0.85 * density + 0.1) continue;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const w = 12 + r() * 14, d = 12 + r() * 10, h = cfg.height[0] + Math.pow(r(), 1.6) * (cfg.height[1] - cfg.height[0]) * 0.6;
      const f = place(i, side, wall + (cfg.near ?? 3) + r() * 5, w, d, h);
      if (f) facades.push(f);
    }
  }
  const backCount = Math.round((cfg.count ?? 300) * 0.5 * density);
  for (let k = 0; k < backCount; k++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const h = cfg.height[0] + Math.pow(r(), 1.3) * (cfg.height[1] - cfg.height[0]) * 1.4;
    place(i, side, wall + 30 + r() * (cfg.far ?? 150), 14 + r() * 20, 14 + r() * 20, h);
  }
  for (const set of sets) group.add(set.build());

  // --- неон на фасадах первого ряда ---
  const neonN = Math.min(facades.length, Math.round((env.scenery.neon?.count ?? 0) * density));
  if (neonN > 0) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const neon = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), neonN);
    const palette = [0xff2d95, 0x21e6ff, 0xb14dff, 0xff8a1f, 0x39ff88, 0xfff04d];
    const picked = [...facades].sort(() => r() - 0.5).slice(0, neonN);
    picked.forEach((f, k) => {
      const w = 3 + r() * 6, h = 0.8 + r() * 1.6;
      const y = f.y + 4 + r() * Math.min(18, f.h - 6);
      const off = f.d / 2 + 0.08;
      q.setFromAxisAngle(up, f.heading + Math.PI);
      m.compose(p.set(f.cx - f.nx * off, y, f.cz - f.nz * off), q, sc.set(w, h, 1));
      neon.setMatrixAt(k, m);
      const c = new THREE.Color(palette[k % palette.length]).multiplyScalar(night ? 2.6 : 1.2);
      neon.setColorAt(k, c);
    });
    neon.computeBoundingSphere();
    group.add(neon);
  }
  return { group, lights };
}

// Фонари вдоль трассы: столб + кронштейн, светящийся плафон и «лужа света» на мокром асфальте.
// Возвращает позиции плафонов для пула настоящих точечных огней.
function buildLamps(track, env, heightAt, seaAt, r) {
  const cfg = env.scenery.lamps;
  const group = new THREE.Group();
  group.name = 'lamps';
  const night = env.time === 'night';
  const step = Math.max(1, Math.round((cfg.spacing ?? 35) / track.ds));
  const spots = [];
  const tu = track.tunnel;
  let side = 1;
  for (let i = 0; i < track.n; i += step) {
    const sAt = i * track.ds;
    if (tu && (((sAt - tu.s0) % track.length) + track.length) % track.length < tu.length + 10) continue;
    side = -side;
    const both = env.scenery.promenade && Math.abs(track.kappa[i]) < 1 / 800 && r() < 0.3;
    for (const sd of both ? [1, -1] : [side]) {
      const wall = sd > 0 ? track.wallL[i] : track.wallR[i];
      const d = sd * (wall + 0.7);
      const x = track.x[i] + track.nx[i] * d, z = track.z[i] + track.nz[i] * d;
      const y = heightAt(x, z);
      spots.push({ i, side: sd, x, y, z, s: sAt });
    }
  }
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 7.6, 6);
  pole.translate(0, 3.8, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 2.3);
  arm.translate(0, 7.5, 1.05);
  const poleGeo = merged([tint(pole, 0x2e3238), tint(arm, 0x2e3238)]);
  const headGeo = new THREE.BoxGeometry(0.45, 0.12, 0.85);
  headGeo.translate(0, 7.38, 2.05);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 }), spots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd6a0).multiplyScalar(night ? 2.2 : 1.1), toneMapped: false }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const lights = [];
  spots.forEach((sp, k) => {
    // кронштейн смотрит на трассу
    const ax = -track.nx[sp.i] * sp.side, az = -track.nz[sp.i] * sp.side;
    q.setFromAxisAngle(up, Math.atan2(ax, az));
    m.compose(p.set(sp.x, sp.y, sp.z), q, one);
    poles.setMatrixAt(k, m);
    heads.setMatrixAt(k, m);
    lights.push({ x: sp.x + ax * 2.05, y: sp.y + 7.0, z: sp.z + az * 2.05, s: sp.s, color: 0xffcf96, power: 1 });
  });
  poles.computeBoundingSphere();
  heads.computeBoundingSphere();
  group.add(poles, heads);
  // «лужи света» на асфальте: мокрое покрытие отражает фонари вытянутыми бликами
  if (night) {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({
        map: TX.glow(),
        color: new THREE.Color(0xffc080).multiplyScalar(env.wet ? 0.32 : 0.2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        toneMapped: false,
      }),
      lights.length,
    );
    const sc = new THREE.Vector3();
    lights.forEach((l, k) => {
      const i = track.index(l.s);
      const q2 = new THREE.Quaternion().setFromAxisAngle(up, track.heading[i]);
      const pr = track.project(l.x, l.z, i);
      const y = track.heightAt(pr.i, pr.f, Math.max(-track.hw[i], Math.min(track.hw[i], pr.d))) + 0.03;
      m.compose(p.set(l.x, y, l.z), q2, sc.set(9, 1, env.wet ? 20 : 11));
      pools.setMatrixAt(k, m);
    });
    pools.computeBoundingSphere();
    pools.renderOrder = 2;
    group.add(pools);
  }
  return { group, lights };
}

// Море: большая гладкая плоскость с отражениями неба; ночью — огни яхт.
function buildSea(track, env, r) {
  const sea = env.sea;
  if (!sea || sea.shoreAlong == null) return null;
  const group = new THREE.Group();
  group.name = 'sea';
  const [dx, dz] = sea.dir;
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const along = cx * dx + cz * dz;
  const off = sea.shoreAlong - along + 2600;
  const night = env.time === 'night';
  const waterN = TX.water();
  const mat = new THREE.MeshStandardMaterial({
    color: night ? 0x061424 : 0x1b6a86,
    roughness: 0.12,
    metalness: 0.1,
    normalMap: waterN,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: night ? 1.4 : 1.1,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(5200, 8000), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.rotation.z = Math.atan2(dx, dz);
  plane.position.set(cx + dx * off, sea.level ?? -1.2, cz + dz * off);
  plane.receiveShadow = true;
  group.add(plane);
  group.userData.water = waterN;
  if (night) {
    const n = 46;
    const g = new THREE.BoxGeometry(1, 0.6, 3);
    const boats = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const tx = -dz, tz = dx;
    for (let k = 0; k < n; k++) {
      const a = 40 + r() * 700, t = (r() - 0.5) * 1800;
      p.set(cx + dx * (sea.shoreAlong - along + a) + tx * t, (sea.level ?? -1.2) + 0.6, cz + dz * (sea.shoreAlong - along + a) + tz * t);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(p, q, one);
      boats.setMatrixAt(k, m);
      boats.setColorAt(k, new THREE.Color(r() < 0.7 ? 0xffe2b0 : 0xff5060).multiplyScalar(2.5));
    }
    boats.computeBoundingSphere();
    group.add(boats);
  }
  return group;
}

// Построить окружение трассы. Возвращает { group, update(camPos), setShadows(on) }.
export function buildScenery(track, env, grid, heightAt, { density = 1, seaAt = () => 0 } = {}) {
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
      if (!pt || seaAt(pt.x, pt.z) > 0.01) continue;
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
    const mat = new THREE.MeshStandardMaterial({ color: sc.rocks.tint ?? 0x8f8a82, vertexColors: true, roughness: 0.9, flatShading: true });
    const set = new ChunkedInstances('rocks', rockGeo(3), null, mat, { shadows: true });
    const col = new THREE.Color();
    for (let k = 0; k < sc.rocks.count * density; k++) {
      const scale = 0.4 + Math.pow(r(), 3) * 3.2;
      const pt = sampleOutside(track, grid, r, 2 + scale, sc.rocks.far ?? 220, 1 + scale);
      if (!pt || seaAt(pt.x, pt.z) > 0.01) continue;
      q.setFromEuler(new THREE.Euler(r() * 0.4, r() * Math.PI * 2, r() * 0.4));
      m.compose(p.set(pt.x, heightAt(pt.x, pt.z) - scale * 0.25, pt.z), q, s.set(scale, scale, scale));
      const v = 0.7 + r() * 0.4;
      set.add(m, col.setRGB(v, v, v).clone());
    }
    group.add(set.build());
    lods.push(set);
  }

  if (sc.peaks) group.add(buildPeaks(track, sc.peaks, env.fog?.color ?? 0xbfd2e2));

  // город, фонари, море
  const lights = [];
  if (sc.buildings) group.add(buildCity(track, env, grid, heightAt, seaAt, r, density).group);
  if (sc.lamps) {
    const L = buildLamps(track, env, heightAt, seaAt, r);
    group.add(L.group);
    lights.push(...L.lights);
  }
  const seaGroup = buildSea(track, env, r);
  if (seaGroup) group.add(seaGroup);
  const water = seaGroup?.userData.water;
  // порт, каньон, Япония, эстакады (scenery2.js)
  const extra = buildExtraScenery(track, env, grid, heightAt, seaAt, density);
  group.add(extra.group);
  lights.push(...extra.lights);
  let clock = 0;

  return {
    group,
    lights,
    update(camPos, lodScale = 1, dt = 0) {
      clock += dt;
      for (const l of lods) l.update(camPos, lodScale);
      extra.update(camPos, lodScale, clock);
      if (water) {
        water.offset.x += dt * 0.004;
        water.offset.y += dt * 0.006;
      }
    },
    setShadows(on) {
      for (const l of lods) l.setShadows(on);
    },
  };
}
