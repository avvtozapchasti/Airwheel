// Окружение новых трасс (всё массовое — InstancedMesh, геометрии собираются один раз):
//  - порт (Neon Harbor): штабели контейнеров, портальные краны у причала, склады, эстакада над
//    трассой, мачты освещения, контейнеровоз у причала;
//  - каньон (Desert Canyon): месы и останцы с красными слоями, скальные стены вдоль каньона,
//    каменная арка над трассой, кактусы, валуны;
//  - Япония (Sakura Touge): цветущая сакура, бамбуковые рощи, тории над дорогой, каменные фонари.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../util/rng.js';
import { fbm2 } from './terrain.js';
import { ChunkedInstances } from './scenery.js';
import * as TX from './textures.js';

const up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function tint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) arr.set([c.r, c.g, c.b], k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merged(parts, keepUv = false) {
  const ni = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ni) {
    if (!keepUv && g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.normal) g.deleteAttribute('normal');
  }
  const out = mergeGeometries(ni);
  parts.forEach((g) => g.dispose());
  out.computeVertexNormals();
  return out;
}

const box = (w, h, d, x, y, z, color) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return color != null ? tint(g, color) : g;
};

// Точка за ограждением трассы: i — индекс выборки, side ±1, dist — от центра.
function outside(track, i, side, dist) {
  return { x: track.x[i] + track.nx[i] * side * dist, z: track.z[i] + track.nz[i] * side * dist };
}

// ===================================================================================
// ПОРТ
// ===================================================================================
function containerTexture() {
  // гофра: вертикальные полосы + рамка, тайлится по u
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 6) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, 0, 2, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 3, 0, 1, 64);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 128, 3);
  ctx.fillRect(0, 61, 128, 3);
  const r = rng(77);
  for (let k = 0; k < 90; k++) {
    ctx.fillStyle = `rgba(90,50,20,${r() * 0.15})`;
    ctx.fillRect(r() * 128, r() * 64, 2 + r() * 6, 1 + r() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Портальный кран у причала (STS): ноги, ригель, стрела над водой, кабина, огни.
function craneGeo() {
  const parts = [];
  const col = 0xd9452b, col2 = 0xf0f0f0;
  for (const x of [-9, 9])
    for (const z of [-7, 7]) {
      parts.push(box(1.2, 44, 1.2, x, 22, z, z > 0 ? col : col2));
    }
  parts.push(box(20, 1.6, 1.4, 0, 44, -7, col), box(20, 1.6, 1.4, 0, 44, 7, col));
  parts.push(box(1.4, 1.6, 15.4, -9, 30, 0, col), box(1.4, 1.6, 15.4, 9, 30, 0, col));
  // стрела: вперёд над водой (+z) и назад
  parts.push(box(3.2, 2.2, 80, 0, 46, 22, col));
  parts.push(box(2.2, 10, 2.2, 0, 52, -6, col));
  parts.push(box(6, 3, 5, 0, 43, 40, 0x2b2f36)); // кабина-тележка
  for (let k = -1; k <= 1; k += 2) {
    const g = new THREE.CylinderGeometry(0.15, 0.15, 44, 4);
    g.rotateX(Math.atan2(36, 10) * k * 0 + Math.PI / 2 - Math.atan2(6, 40));
    g.translate(0, 52, 18);
    parts.push(tint(g, 0x888888));
  }
  return merged(parts);
}

function warehouseMaterial() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7c838c';
  ctx.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, 0, 2, 128);
  }
  ctx.fillStyle = '#3d434b';
  ctx.fillRect(0, 96, 256, 32);
  // ворота и окна под крышей
  ctx.fillStyle = '#2a2f36';
  ctx.fillRect(30, 40, 60, 88);
  ctx.fillRect(160, 40, 60, 88);
  ctx.fillStyle = '#ffd690';
  for (let x = 12; x < 256; x += 32) ctx.fillRect(x, 10, 18, 8);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const e = document.createElement('canvas');
  e.width = 256;
  e.height = 128;
  const ex = e.getContext('2d');
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, 256, 128);
  ex.fillStyle = '#ffcf8a';
  for (let x = 12; x < 256; x += 32) ex.fillRect(x, 10, 18, 8);
  ex.fillStyle = '#3a2a10';
  ex.fillRect(30, 40, 60, 88);
  const em = new THREE.CanvasTexture(e);
  em.wrapS = em.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.7, metalness: 0.3 });
  // текстура по фасаду в мировых метрах (как у зданий)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWh;\nvarying float vTop;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wpW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec3 wnW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        vWh = vec2((abs(wnW.x) > abs(wnW.z) ? wpW.z : wpW.x) / 32.0, wpW.y / 16.0);
        vTop = step(0.5, wnW.y);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWh;\nvarying float vTop;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= mix(texture2D(map, vWh).rgb, vec3(0.32, 0.34, 0.37), vTop);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D(emissiveMap, vWh).rgb * (1.0 - vTop);');
  };
  return mat;
}

function buildPort(track, env, grid, heightAt, seaAt, r, density) {
  const cfg = env.scenery.port || {};
  const group = new THREE.Group();
  group.name = 'port';
  const lights = [];
  const night = env.time === 'night';

  // --- контейнеры: кластеры-«дворы», ряды по сетке ---
  const cont = new THREE.BoxGeometry(12.2, 2.6, 2.45);
  cont.translate(0, 1.3, 0);
  // UV — по длине контейнера тайлится гофра
  const uv = cont.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 3);
  const contMat = new THREE.MeshStandardMaterial({ map: containerTexture(), roughness: 0.6, metalness: 0.35, envMapIntensity: 0.6 });
  const contSet = new ChunkedInstances('containers', cont, null, contMat, { shadows: true });
  const palette = [0xb7352b, 0x2d5fa8, 0x3a8a4a, 0xd98a2b, 0xd8d8d8, 0x6b6f75, 0x7a4a2c, 0x1f7f84, 0xc9b23a];
  const col = new THREE.Color();
  const total = Math.round((cfg.containers ?? 800) * density);
  let placed = 0, guard = 0;
  while (placed < total && guard++ < 400) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c0 = outside(track, i, side, wall + 14 + r() * 140);
    if (seaAt(c0.x, c0.z) > 0.01) continue;
    const ang = track.heading[i] + (r() < 0.5 ? 0 : Math.PI / 2);
    const fx = Math.sin(ang), fz = Math.cos(ang), lx = Math.cos(ang), lz = -Math.sin(ang);
    const rows = 2 + Math.floor(r() * 5), cols = 2 + Math.floor(r() * 4);
    for (let a = 0; a < rows; a++)
      for (let b = 0; b < cols; b++) {
        const x = c0.x + fx * (a * 13) + lx * (b * 2.8), z = c0.z + fz * (a * 13) + lz * (b * 2.8);
        if (!grid.clear(x, z, 9) || seaAt(x, z) > 0.01) continue;
        const h = 1 + Math.floor(Math.pow(r(), 0.7) * 4);
        const y0 = heightAt(x, z);
        for (let k = 0; k < h && placed < total; k++) {
          _q.setFromAxisAngle(up, ang + Math.PI / 2 + (r() - 0.5) * 0.02);
          _m.compose(_p.set(x, y0 + k * 2.6, z), _q, _s.set(1, 1, 1));
          const v = 0.75 + r() * 0.35;
          contSet.add(_m, col.set(palette[Math.floor(r() * palette.length)]).multiplyScalar(v).clone());
          placed++;
        }
      }
  }
  group.add(contSet.build());

  // --- портальные краны вдоль причала (сторона моря) ---
  const sea = env.sea;
  if (sea && cfg.cranes) {
    const crane = new THREE.InstancedMesh(craneGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), cfg.cranes);
    const warn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.2), toneMapped: false }), cfg.cranes * 2);
    const [dx, dz] = sea.dir;
    let k = 0;
    for (let c = 0; c < cfg.cranes; c++) {
      // точки трассы, ближайшие к берегу — вдоль главной прямой
      const s = track.wrapS(-260 + c * 110);
      const i = track.index(s);
      const along = sea.shoreAlong;
      const px = track.x[i], pz = track.z[i];
      const cur = px * dx + pz * dz;
      const x = px + dx * (along - cur - 6), z = pz + dz * (along - cur - 6);
      _q.setFromAxisAngle(up, Math.atan2(dx, dz));
      _m.compose(_p.set(x, -1, z), _q, _s.set(1, 1, 1));
      crane.setMatrixAt(c, _m);
      for (const h of [55, 47]) {
        _m.compose(_p.set(x + dx * (h === 55 ? 0 : 60), h, z + dz * (h === 55 ? 0 : 60)), _q, _s.set(1, 1, 1));
        warn.setMatrixAt(k++, _m);
      }
      lights.push({ x: x - dx * 8, y: 30, z: z - dz * 8, s, color: 0xffe2b8, power: 1.4 });
    }
    crane.computeBoundingSphere();
    warn.computeBoundingSphere();
    crane.castShadow = true;
    group.add(crane, warn);
    group.userData.blink = warn;

    // контейнеровоз у причала: корпус + палуба контейнеров
    const shipParts = [box(36, 12, 220, 0, 0, 0, 0x1d2733), box(34, 2, 216, 0, 6.5, 0, 0x7a2b22), box(30, 16, 20, 0, 14, -92, 0xe8e8e8)];
    const shipGeo = merged(shipParts);
    const ship = new THREE.Mesh(shipGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    const s0 = track.wrapS(60), i0 = track.index(s0);
    const cur0 = track.x[i0] * dx + track.z[i0] * dz;
    ship.position.set(track.x[i0] + dx * (sea.shoreAlong - cur0 + 26), -1, track.z[i0] + dz * (sea.shoreAlong - cur0 + 26));
    ship.rotation.y = track.heading[i0];
    group.add(ship);
    const deck = new THREE.InstancedMesh(cont, contMat, 160);
    let n = 0;
    for (let a = 0; a < 14; a++)
      for (let b = 0; b < 11 && n < 160; b++) {
        const h = Math.floor(r() * 3);
        for (let c2 = 0; c2 <= h && n < 160; c2++) {
          const lz = -70 + a * 13, lx = -13 + b * 2.6;
          _p.set(lx, 7.5 + c2 * 2.6, lz).applyAxisAngle(up, ship.rotation.y).add(ship.position);
          _q.setFromAxisAngle(up, ship.rotation.y + Math.PI / 2);
          _m.compose(_p, _q, _s.set(1, 1, 1));
          deck.setMatrixAt(n, _m);
          deck.setColorAt(n, col.set(palette[Math.floor(r() * palette.length)]));
          n++;
        }
      }
    deck.count = n;
    deck.computeBoundingSphere();
    group.add(deck);
  }

  // --- склады вдоль трассы ---
  const wh = new ChunkedInstances('warehouses', box(1, 1, 1, 0, 0.5, 0), null, warehouseMaterial(), { shadows: false });
  const nW = Math.round((cfg.warehouses ?? 20) * density);
  for (let k = 0, g2 = 0; k < nW && g2 < 400; g2++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const w = 40 + r() * 50, d = 24 + r() * 20, h = 9 + r() * 7;
    const c = outside(track, i, side, wall + 8 + d / 2 + r() * 30);
    let ok = true;
    for (const [a, b] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
      const x = c.x + track.tx[i] * a + track.nx[i] * side * b, z = c.z + track.tz[i] * a + track.nz[i] * side * b;
      if (!grid.clear(x, z, 3) || seaAt(x, z) > 0.01) ok = false;
    }
    if (!ok) continue;
    _q.setFromAxisAngle(up, track.heading[i]);
    _m.compose(_p.set(c.x, heightAt(c.x, c.z) - 0.2, c.z), _q, _s.set(d, h, w));
    wh.add(_m, col.setRGB(0.8 + r() * 0.3, 0.8 + r() * 0.3, 0.85 + r() * 0.2).clone());
    k++;
  }
  group.add(wh.build());

  // --- мачты освещения (прожекторы) ---
  const mastN = Math.round(16 * density);
  const mastGeo = merged([box(0.6, 32, 0.6, 0, 16, 0, 0x3a3f46), box(5, 1.2, 1.2, 0, 32, 0, 0x3a3f46)]);
  const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), mastN);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(4.6, 0.6, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(night ? 3 : 1.2), toneMapped: false }), mastN);
  let mk = 0;
  for (let g3 = 0; mk < mastN && g3 < 300; g3++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c = outside(track, i, side, wall + 6 + r() * 20);
    if (!grid.clear(c.x, c.z, 3) || seaAt(c.x, c.z) > 0.01) continue;
    _q.setFromAxisAngle(up, track.heading[i]);
    const y = heightAt(c.x, c.z);
    _m.compose(_p.set(c.x, y, c.z), _q, _s.set(1, 1, 1));
    masts.setMatrixAt(mk, _m);
    _m.compose(_p.set(c.x, y + 31.2, c.z), _q, _s.set(1, 1, 1));
    heads.setMatrixAt(mk, _m);
    lights.push({ x: c.x, y: y + 28, z: c.z, s: i * track.ds, color: 0xfff0d0, power: 1.6 });
    mk++;
  }
  masts.count = heads.count = mk;
  masts.computeBoundingSphere();
  heads.computeBoundingSphere();
  group.add(masts, heads);

  return { group, lights };
}

// Эстакада над трассой: настил через всю ширину и дальше, опоры за ограждением, огни.
export function buildOverpass(track, tList, night) {
  const group = new THREE.Group();
  group.name = 'overpass';
  const lights = [];
  const sh = track.tShift || 0;
  const mat = new THREE.MeshStandardMaterial({ map: TX.concrete().map, color: 0xa9a59e, roughness: 0.85 });
  for (const t of tList) {
    const s = ((((t - sh) % 1) + 1) % 1) * track.length;
    const i = track.index(s);
    const L = track.wallL[i] + track.wallR[i] + 120;
    const center = track.pointAt(s, (track.wallL[i] - track.wallR[i]) / 2);
    const h = track.heading[i];
    const y0 = track.y[i] + 8.5;
    const parts = [box(L, 1.4, 14, 0, 0, 0), box(L, 1.1, 0.4, 0, 1.25, 6.8), box(L, 1.1, 0.4, 0, 1.25, -6.8)];
    for (const x of [-(track.wallR[i] + 6), track.wallL[i] + 6, -(track.wallR[i] + 40), track.wallL[i] + 40]) parts.push(box(2.4, 9, 6, x, -5.2, 0));
    const g = merged(parts, false);
    const m = new THREE.Mesh(g, mat);
    m.position.set(center.x, y0, center.z);
    // настил поперёк трассы: локальный x — вдоль левой нормали
    m.rotation.y = h + Math.PI / 2;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    // огни на парапетах
    const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd6a0).multiplyScalar(night ? 3 : 1.2), toneMapped: false }), 40);
    let k = 0;
    for (let a = -L / 2 + 4; a < L / 2 && k < 40; a += 12)
      for (const z of [6.8, -6.8]) {
        _p.set(a, 2, z).applyAxisAngle(up, m.rotation.y).add(m.position);
        _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
        lamp.setMatrixAt(k++, _m);
      }
    lamp.count = k;
    lamp.computeBoundingSphere();
    group.add(lamp);
    // неоновая вывеска на эстакаде
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), new THREE.MeshBasicMaterial({ map: TX.board('NOVA ENERGY · AIRWHEEL', { bg: '#0b0f1a', fg: '#33e3ff', w: 1024, h: 128 }), toneMapped: false, side: THREE.DoubleSide }));
    sign.position.copy(m.position).add(new THREE.Vector3(0, -1.6, 0));
    sign.rotation.y = h;
    sign.translateZ(-7.3);
    group.add(sign);
    lights.push({ x: center.x, y: y0 - 1, z: center.z, s, color: 0xffd6a0, power: 1.2 });
  }
  return { group, lights };
}

// ===================================================================================
// КАНЬОН
// ===================================================================================
const REDS = [0x9c4a2f, 0xb35c37, 0xc97a4a, 0x8a3f2a, 0xd59a6a, 0xa8553a];

// Месa/останец: столб с шумовыми стенками, слоистая окраска по высоте, плоская вершина.
function mesaGeo(seed, flat = 0.9) {
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 16, 10, false);
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const a = Math.atan2(z, x);
    const t = y + 0.5;
    const n = fbm2(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + t * 3, 3);
    const rad = 1 + (n - 0.5) * 0.5 + (t > flat ? 0 : (Math.sin(t * 22 + seed) * 0.03));
    p.setXYZ(k, x * rad, y, z * rad);
    const band = Math.floor(t * 9 + n * 2) % REDS.length;
    c.set(REDS[band]).multiplyScalar(0.85 + n * 0.3);
    cols.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// Скальная стена вдоль участка трассы: вертикальная лента с шумом, слоистая окраска.
function canyonWall(track, i0, count, side, heightAt) {
  const rows = count + 1, cols = 8;
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let r0 = 0; r0 < rows; r0++) {
    const i = track.wrap(i0 + r0);
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const base = wall + 3.5;
    const fade = Math.min(1, r0 / 12, (rows - 1 - r0) / 12);
    const H = (18 + fbm2(i * 0.02, side * 7, 3) * 26) * Math.max(0.15, fade);
    for (let k = 0; k < cols; k++) {
      const t = k / (cols - 1);
      const n = fbm2(i * 0.05 + t * 2, side * 3 + t * 5, 3);
      const out = base + t * t * 14 + (n - 0.5) * 6;
      const x = track.x[i] + track.nx[i] * side * out, z = track.z[i] + track.nz[i] * side * out;
      const y = heightAt(x, z) - 0.5 + t * H;
      pos.push(x, y, z);
      const band = Math.floor(t * 6 + n * 3 + i * 0.002) % REDS.length;
      c.set(REDS[band]).multiplyScalar(0.8 + n * 0.35);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r0 = 0; r0 < rows - 1; r0++)
    for (let k = 0; k < cols - 1; k++) {
      const a = r0 * cols + k, b = a + cols;
      if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function cactusGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.32, 0.38, 6, 8);
  trunk.translate(0, 3, 0);
  parts.push(tint(trunk, 0x3f6b3a));
  for (const [sx, h, y0] of [[1, 2.2, 2.4], [-1, 1.6, 3.2]]) {
    const arm = new THREE.CylinderGeometry(0.22, 0.24, 1.2, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(sx * 0.8, y0, 0);
    const up2 = new THREE.CylinderGeometry(0.2, 0.24, h, 6);
    up2.translate(sx * 1.35, y0 + h / 2, 0);
    parts.push(tint(arm, 0x3b6536), tint(up2, 0x3f6b3a));
  }
  return merged(parts);
}

function buildCanyon(track, env, grid, heightAt, seaAt, r, density) {
  const cfg = env.scenery.canyon || {};
  const group = new THREE.Group();
  group.name = 'canyon';
  const sh = track.tShift || 0;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  // --- скальные стены вдоль каньона ---
  if (cfg.walls && track.def.canyon) {
    const [t0, t1] = track.def.canyon;
    const s0 = ((((t0 - sh) % 1) + 1) % 1) * track.length, s1 = ((((t1 - sh) % 1) + 1) % 1) * track.length;
    const i0 = track.index(s0);
    const count = Math.round(((((s1 - s0) % track.length) + track.length) % track.length) / track.ds);
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(canyonWall(track, i0, count, side, heightAt), mat);
      w.receiveShadow = true;
      w.castShadow = true;
      group.add(w);
    }
    // каменная арка над трассой в середине каньона
    const si = track.wrap(i0 + Math.round(count * 0.45));
    const span = track.wallL[si] + track.wallR[si] + 12;
    const arch = new THREE.TorusGeometry(span / 2, 3.2, 8, 24, Math.PI);
    const p = arch.attributes.position;
    const cols = new Float32Array(p.count * 3);
    const cc = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = fbm2(x * 0.1, y * 0.1 + z * 0.3, 3);
      p.setXYZ(k, x * (1 + (n - 0.5) * 0.08), y * (1 + (n - 0.5) * 0.1) * 0.75, z * (1.4 + (n - 0.5) * 0.6));
      cc.set(REDS[Math.floor(y * 0.25 + n * 4) % REDS.length]);
      cols.set([cc.r, cc.g, cc.b], k * 3);
    }
    arch.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    arch.deleteAttribute('uv');
    arch.computeVertexNormals();
    const am = new THREE.Mesh(arch, mat);
    const center = track.pointAt(si * track.ds, (track.wallL[si] - track.wallR[si]) / 2);
    am.position.set(center.x, track.y[si] + 9, center.z);
    am.rotation.y = track.heading[si] + Math.PI / 2;
    am.castShadow = true;
    group.add(am);
  }
  // --- месы и останцы ---
  const geos = [mesaGeo(1.3, 0.9), mesaGeo(7.7, 0.8), mesaGeo(4.1, 0.95)];
  const nM = Math.round((cfg.mesas ?? 20) * density);
  const per = Math.ceil(nM / geos.length);
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  geos.forEach((g, gi) => {
    const im = new THREE.InstancedMesh(g, mat, per);
    let k = 0;
    for (let a = 0; a < per * 6 && k < per; a++) {
      const ang = r() * Math.PI * 2;
      const dist = R * (0.4 + r() * 1.6) + 120;
      const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      if (!grid.clear(x, z, 60)) continue;
      const rad = 25 + r() * 70, h = 40 + r() * 110;
      _q.setFromAxisAngle(up, r() * 6.28);
      _m.compose(_p.set(x, heightAt(x, z) - 4, z), _q, _s.set(rad, h, rad * (0.6 + r() * 0.6)));
      im.setMatrixAt(k++, _m);
    }
    im.count = k;
    im.computeBoundingSphere();
    im.castShadow = gi === 0;
    group.add(im);
  });
  // --- кактусы и валуны ---
  const cact = new ChunkedInstances('cacti', cactusGeo(), null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), { shadows: true });
  const col = new THREE.Color();
  for (let k = 0; k < (cfg.cacti ?? 300) * density; k++) {
    const i = Math.floor(r() * track.n), side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c = outside(track, i, side, wall + 4 + Math.pow(r(), 1.5) * 220);
    if (!grid.clear(c.x, c.z, 2)) continue;
    const sc = 0.6 + r() * 0.8;
    _q.setFromAxisAngle(up, r() * 6.28);
    _m.compose(_p.set(c.x, heightAt(c.x, c.z) - 0.2, c.z), _q, _s.set(sc, sc * (0.8 + r() * 0.5), sc));
    cact.add(_m, col.setRGB(0.85 + r() * 0.3, 0.9 + r() * 0.2, 0.85).clone());
  }
  group.add(cact.build());
  return { group, lights: [], lods: [cact] };
}

// ===================================================================================
// ЯПОНИЯ
// ===================================================================================
function sakuraGeo(lod) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.4, 3.6, lod === 'lo' ? 4 : 6);
  trunk.translate(0, 1.8, 0);
  parts.push(tint(trunk, 0x3b2a24));
  const blobs = lod === 'lo' ? [[0, 4.6, 0, 2.8]] : [[0, 4.8, 0, 2.2], [1.5, 4.2, 0.4, 1.6], [-1.4, 4.4, -0.3, 1.7], [0.3, 5.6, -1.2, 1.5], [-0.4, 4.1, 1.5, 1.5], [0.9, 5.4, 1.1, 1.3]];
  blobs.forEach(([x, y, z, s], k) => {
    const b = new THREE.IcosahedronGeometry(s, lod === 'lo' ? 0 : 1);
    b.translate(x, y, z);
    parts.push(tint(b, k % 2 ? 0xf6c1d4 : 0xf2a9c3));
  });
  if (lod !== 'lo') {
    for (const [x, z] of [[1, 0.3], [-1, -0.2]]) {
      const br = new THREE.CylinderGeometry(0.08, 0.14, 2.2, 4);
      br.rotateZ(x * 0.8);
      br.translate(x * 0.7, 3.6, z);
      parts.push(tint(br, 0x3b2a24));
    }
  }
  return merged(parts);
}

function bambooGeo() {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const h = 9 + (k % 3) * 2.5;
    const c = new THREE.CylinderGeometry(0.07, 0.09, h, 5);
    c.translate(Math.cos(k * 2.4) * 0.7, h / 2, Math.sin(k * 2.4) * 0.7);
    parts.push(tint(c, k % 2 ? 0x6f9a3a : 0x86ad49));
    const leaf = new THREE.ConeGeometry(0.9, 3, 5);
    leaf.translate(Math.cos(k * 2.4) * 0.7, h - 0.6, Math.sin(k * 2.4) * 0.7);
    parts.push(tint(leaf, 0x4f7d2f));
  }
  return merged(parts);
}

function toriiGeo(width) {
  const parts = [];
  const red = 0xc8361c, black = 0x1a1a1a;
  for (const x of [-width / 2, width / 2]) {
    const p = new THREE.CylinderGeometry(0.42, 0.5, 9, 10);
    p.translate(x, 4.5, 0);
    parts.push(tint(p, red));
    parts.push(box(1.2, 0.6, 1.2, x, 0.3, 0, black));
  }
  parts.push(box(width + 1.6, 0.6, 0.9, 0, 7.4, 0, red)); // нуки
  parts.push(box(width + 4.4, 0.7, 1.3, 0, 9.2, 0, red)); // касаги
  parts.push(box(width + 5, 0.35, 1.5, 0, 9.7, 0, black));
  parts.push(box(0.5, 1.8, 0.5, 0, 8.3, 0, red));
  return merged(parts);
}

function lanternGeo() {
  return merged([
    box(0.9, 0.3, 0.9, 0, 0.15, 0, 0x8d8d86),
    tint(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6).translate(0, 0.9, 0), 0x8d8d86),
    box(0.8, 0.25, 0.8, 0, 1.6, 0, 0x8d8d86),
    box(1.3, 0.3, 1.3, 0, 2.45, 0, 0x7c7c75),
    tint(new THREE.ConeGeometry(0.25, 0.4, 4).translate(0, 2.8, 0), 0x7c7c75),
  ]);
}

function buildJapan(track, env, grid, heightAt, seaAt, r, density) {
  const cfg = env.scenery.japan || {};
  const group = new THREE.Group();
  group.name = 'japan';
  const lights = [];
  const lods = [];
  const col = new THREE.Color();
  const dusk = env.time !== 'day';
  // --- сакура: у дороги гуще ---
  const sak = new ChunkedInstances('sakura', sakuraGeo('hi'), sakuraGeo('lo'), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), { shadows: true, lodDist: 240 });
  for (let k = 0; k < (cfg.sakura ?? 400) * density; k++) {
    const i = Math.floor(r() * track.n), side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c = outside(track, i, side, wall + 3 + Math.pow(r(), 2) * 120);
    if (!grid.clear(c.x, c.z, 2.5)) continue;
    const sc = 0.8 + r() * 0.7;
    _q.setFromAxisAngle(up, r() * 6.28);
    _m.compose(_p.set(c.x, heightAt(c.x, c.z) - 0.2, c.z), _q, _s.set(sc, sc * (0.85 + r() * 0.3), sc));
    const v = 0.9 + r() * 0.2;
    sak.add(_m, col.setRGB(v, v * (0.92 + r() * 0.1), v).clone());
  }
  group.add(sak.build());
  lods.push(sak);
  // --- бамбуковые рощи (кластерами) ---
  const bam = new ChunkedInstances('bamboo', bambooGeo(), null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }), { shadows: false });
  const nB = (cfg.bamboo ?? 600) * density;
  for (let k = 0; k < nB; ) {
    const i = Math.floor(r() * track.n), side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c0 = outside(track, i, side, wall + 4 + r() * 40);
    const cluster = 10 + Math.floor(r() * 25);
    for (let j = 0; j < cluster; j++, k++) {
      const x = c0.x + (r() - 0.5) * 18, z = c0.z + (r() - 0.5) * 18;
      if (!grid.clear(x, z, 2)) continue;
      _q.setFromAxisAngle(up, r() * 6.28);
      const sc = 0.8 + r() * 0.5;
      _m.compose(_p.set(x, heightAt(x, z) - 0.1, z), _q, _s.set(sc, sc, sc));
      bam.add(_m, col.setRGB(0.9 + r() * 0.2, 0.95 + r() * 0.1, 0.9).clone());
    }
  }
  group.add(bam.build());
  lods.push(bam);
  // --- тории над дорогой ---
  const nT = cfg.torii ?? 5;
  const sh = track.tShift || 0;
  const corners = track.corners;
  for (let k = 0; k < nT; k++) {
    // перед поворотами — как ворота в следующую часть подъёма
    const c = corners[k % corners.length];
    const s = c.sEntry - 70 - k * 9;
    const i = track.index(s);
    const width = track.wallL[i] + track.wallR[i] + 3;
    const g = new THREE.Mesh(toriiGeo(width), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    const p = track.pointAt(s, (track.wallL[i] - track.wallR[i]) / 2);
    g.position.set(p.x, Math.min(heightAt(p.x, p.z), p.y) - 0.1, p.z);
    g.rotation.y = track.heading[i] + Math.PI / 2;
    g.castShadow = true;
    group.add(g);
  }
  void sh;
  // --- каменные фонари у обочины (тёплый свет) ---
  const nL = Math.round((cfg.lanterns ?? 60) * density);
  const lan = new THREE.InstancedMesh(lanternGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), nL);
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb35a).multiplyScalar(dusk ? 3.2 : 1.4), toneMapped: false }), nL);
  let n = 0;
  const step = Math.max(1, Math.floor(track.n / Math.max(1, nL)));
  for (let i = 0; i < track.n && n < nL; i += step) {
    const side = n % 2 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const c = outside(track, i, side, wall + 1.6);
    const y = heightAt(c.x, c.z);
    _q.setFromAxisAngle(up, track.heading[i]);
    _m.compose(_p.set(c.x, y, c.z), _q, _s.set(1, 1, 1));
    lan.setMatrixAt(n, _m);
    _m.compose(_p.set(c.x, y + 2.05, c.z), _q, _s.set(1, 1, 1));
    glow.setMatrixAt(n, _m);
    if (n % 3 === 0) lights.push({ x: c.x, y: y + 2.2, z: c.z, s: i * track.ds, color: 0xffb35a, power: 0.6 });
    n++;
  }
  lan.count = glow.count = n;
  lan.computeBoundingSphere();
  glow.computeBoundingSphere();
  group.add(lan, glow);
  return { group, lights, lods };
}

// Окружение по параметрам env.scenery (то, что не строит scenery.js).
export function buildExtraScenery(track, env, grid, heightAt, seaAt, density) {
  const sc = env.scenery || {};
  const r = rng(track.id.length * 7919 + 13);
  const group = new THREE.Group();
  group.name = 'scenery2';
  const lights = [];
  const lods = [];
  let blink = null;
  const night = env.time === 'night';
  for (const [key, fn] of [
    ['port', buildPort],
    ['canyon', buildCanyon],
    ['japan', buildJapan],
  ]) {
    if (!sc[key]) continue;
    const res = fn(track, env, grid, heightAt, seaAt, r, density);
    group.add(res.group);
    lights.push(...(res.lights || []));
    lods.push(...(res.lods || []));
    blink ||= res.group.userData.blink;
  }
  if (track.def.overpass?.length) {
    const o = buildOverpass(track, track.def.overpass, night);
    group.add(o.group);
    lights.push(...o.lights);
  }
  return {
    group,
    lights,
    update(camPos, lodScale, t = 0) {
      for (const l of lods) l.update(camPos, lodScale);
      if (blink) blink.visible = Math.sin(t * 3.2) > -0.2; // авиационные огни мигают
    },
  };
}
