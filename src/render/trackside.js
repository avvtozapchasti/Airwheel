// Детали у трассы: рекламные щиты на опорах и баннеры на ограждении (вымышленные бренды из
// одного атласа), стопки шин у медленных поворотов, конусы на въезде в пит-лейн, посты
// маршалов с флагами, камеры видеонаблюдения, следы торможения и пятна масла на асфальте,
// табло-пилон с позициями у старта (обновляется раз в секунду).
// Всё — InstancedMesh или один объединённый меш на тип: ~12 draw calls на всю трассу.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { Geo, strip, edgeY } from './trackMesh.js';
import { rng } from '../util/rng.js';

const up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// Раскраска геометрии одним цветом (для слияния частей разного цвета в один меш).
function tint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) a.set([c.r, c.g, c.b], k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const part = (geo, color, x = 0, y = 0, z = 0) => tint(geo.translate(x, y, z), color);

// Материал рекламы: плитка атласа брендов — атрибут экземпляра aTile; ночью щиты подсвечены.
function adMaterial(night, { emissive = night ? 0.85 : 0.04 } = {}) {
  const tex = TX.brandAtlas();
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: emissive, roughness: 0.55, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          vec2 cell = vec2(mod(aTile, 4.0), 3.0 - floor(aTile / 4.0));
          vec2 tuv = (cell + clamp(uv, 0.004, 0.996)) / 4.0;
          vMapUv = tuv;
          vEmissiveMapUv = tuv;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ad-atlas';
  return mat;
}

function instanced(geo, mat, mats, { tiles = null, colors = null, shadows = false } = {}) {
  if (!mats.length) return null;
  if (tiles) geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(tiles), 1));
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, k) => im.setMatrixAt(k, m));
  if (colors) colors.forEach((c, k) => im.setColorAt(k, c));
  im.computeBoundingSphere();
  im.castShadow = shadows;
  im.receiveShadow = true;
  return im;
}

// Можно ли ставить объект у трассы в точке s на стороне side (не в пит-лейне/туннеле/на мосту).
function freeSide(track, s, side, margin = 30) {
  const pit = track.pit;
  if (pit && side === pit.side) {
    let u = pit.rel(s);
    if (u > track.length / 2) u -= track.length;
    if (u > -margin && u < pit.len + margin) return false;
  }
  const tu = track.tunnel;
  if (tu && ((((s - tu.s0) % track.length) + track.length) % track.length) < tu.length + margin) return false;
  if (track.onBridge?.(s)) return false;
  return true;
}

// Табло-пилон с позициями: canvas 256×1024 → текстура, обновление раз в секунду.
function timingTower() {
  const W = 256, H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let last = '';
  const draw = (rows) => {
    const key = rows.map((r) => r.code).join();
    if (key === last) return;
    last = key;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffcc33';
    ctx.font = '900 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AIRWHEEL', W / 2, 52);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.25;
    ctx.fillRect(16, 92, W - 32, 3);
    ctx.globalAlpha = 1;
    const list = rows.slice(0, 10);
    list.forEach((r, k) => {
      const y = 140 + k * 86;
      ctx.fillStyle = k % 2 ? '#0c111b' : '#111827';
      ctx.fillRect(10, y - 38, W - 20, 78);
      ctx.fillStyle = r.player ? '#ffcc33' : '#e8eef8';
      ctx.font = '900 44px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(k + 1), 22, y);
      ctx.fillStyle = r.color || '#888';
      ctx.fillRect(78, y - 24, 8, 48);
      ctx.fillStyle = r.player ? '#ffcc33' : '#ffffff';
      ctx.font = '800 46px system-ui, sans-serif';
      ctx.fillText(r.code, 100, y);
    });
    tex.needsUpdate = true;
  };
  draw([]);
  return { tex, draw };
}

export function buildTrackside(track, env, { heightAt = null, grid = null, night = false } = {}) {
  const group = new THREE.Group();
  group.name = 'trackside';
  const r = rng(track.id.length * 7919 + 13);
  const hAt = (x, z, fallback) => (heightAt ? heightAt(x, z) : fallback);
  const clear = (x, z, rad) => !grid || grid.clear(x, z, rad);
  const concrete = env.wall === 'concrete';
  const n = track.n;

  // --- рекламные щиты на опорах (на прямых, развёрнуты навстречу машинам) ---
  const boards = [], boardTiles = [], frames = [];
  let lastBoard = -1e9;
  for (let i = 0; i < n; i += Math.max(1, Math.round(10 / track.ds))) {
    const s = i * track.ds;
    if (s - lastBoard < 55 || Math.abs(track.kappa[i]) > 1 / 500) continue;
    const side = r() < 0.5 ? 1 : -1;
    if (!freeSide(track, s, side) || r() < 0.35) continue;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const d = side * (wall + 4.2);
    const x = track.x[i] + track.nx[i] * d, z = track.z[i] + track.nz[i] * d;
    if (!clear(x, z, 5)) continue;
    const y = hAt(x, z, track.y[i]);
    // лицом к подъезжающим машинам и чуть к трассе
    const th = track.heading[i] + Math.PI + side * 0.35;
    _q.setFromAxisAngle(up, th);
    boards.push(_m.compose(_p.set(x, y + 4.4, z), _q, _s.set(8, 4, 1)).clone());
    boardTiles.push(Math.floor(r() * 16));
    frames.push(_m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)).clone());
    lastBoard = s;
  }
  if (boards.length) {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0, 0.06);
    group.add(instanced(plane, adMaterial(night), boards, { tiles: boardTiles }));
    const fr = mergeGeometries([
      part(new THREE.BoxGeometry(8.3, 4.3, 0.1), 0x23262b, 0, 4.4, 0),
      part(new THREE.BoxGeometry(0.22, 2.4, 0.22), 0x3a3e45, -2.6, 1.2, -0.1),
      part(new THREE.BoxGeometry(0.22, 2.4, 0.22), 0x3a3e45, 2.6, 1.2, -0.1),
      part(new THREE.BoxGeometry(8.4, 0.12, 0.6), 0x3a3e45, 0, 2.2, 0.1),
    ]);
    group.add(instanced(fr, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), frames, { shadows: true }));
    if (night) {
      // прожекторы подсветки над щитами
      const lampGeo = new THREE.BoxGeometry(0.5, 0.15, 0.3);
      lampGeo.translate(0, 6.75, 0.6);
      group.add(instanced(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.9), toneMapped: false }), frames));
    }
  }

  // --- баннеры на ограждении вдоль прямых (рядами по 6–12) ---
  const banners = [], bannerTiles = [];
  const BW = 2.4, BH = 1.05;
  const stepB = Math.max(1, Math.round(BW / track.ds));
  for (const side of [1, -1]) {
    let run = 0, tile = Math.floor(r() * 16);
    for (let i = 0; i < n; i += stepB) {
      const s = i * track.ds;
      const straight = Math.abs(track.kappa[i]) < 1 / 350;
      if (!straight || !freeSide(track, s, side, 10)) {
        run = 0;
        continue;
      }
      if (run <= 0) {
        if (r() > 0.18) continue;
        run = 6 + Math.floor(r() * 7);
        tile = Math.floor(r() * 16);
      }
      run--;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const d = side * (wall - 0.07);
      const x = track.x[i] + track.nx[i] * d, z = track.z[i] + track.nz[i] * d;
      const y = edgeY(track, i, d) + (concrete ? 0.15 : -0.05) + BH / 2;
      _q.setFromAxisAngle(up, track.heading[i] + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
      banners.push(_m.compose(_p.set(x, y, z), _q, _s.set(BW, BH, 1)).clone());
      // в ряду — два бренда вперемешку (логотип / слоган)
      bannerTiles.push(run % 3 === 0 ? tile ^ 1 : tile);
    }
  }
  if (banners.length) group.add(instanced(new THREE.PlaneGeometry(1, 1), adMaterial(night, { emissive: night ? 0.55 : 0.03 }), banners, { tiles: bannerTiles }));

  // --- стопки шин у медленных поворотов (снаружи, от апекса до выхода) ---
  const tyreM = [], tyreC = [];
  const bands = [0xd42020, 0xf2f2f2, 0x1f5fd6, 0xffcc00];
  for (const c of track.corners) {
    if (!(c.type === 'hairpin' || c.radius < 45)) continue;
    const side = -c.dir;
    const i0 = track.wrap(c.apex - Math.round(10 / track.ds)), len = Math.min(90, Math.round(((((c.exit - c.apex) % n) + n) % n) * track.ds + 30));
    const band = bands[Math.floor(r() * bands.length)];
    for (let k = 0; k < len; k += 0.74) {
      const sk = track.wrapS(i0 * track.ds + k);
      const i = track.index(sk);
      if (!freeSide(track, sk, side, 5)) continue;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const d = side * (wall - 0.36);
      const { x, z } = track.pointAt(sk, d);
      const y = edgeY(track, i, d) - 0.05;
      _q.setFromAxisAngle(up, r() * 6.28);
      tyreM.push(_m.compose(_p.set(x, y, z), _q, _s.set(1, 0.9 + r() * 0.2, 1)).clone());
      tyreC.push(new THREE.Color(Math.round(k / 0.75) % 2 ? band : 0xffffff));
    }
  }
  if (tyreM.length) {
    // 4 шины в стопке; верхняя — цветная полоса (цвет экземпляра), сверху — «дырка» шины
    const tyreParts = [];
    for (let k = 0; k < 4; k++) {
      const t = new THREE.CylinderGeometry(k % 2 ? 0.35 : 0.36, k % 2 ? 0.35 : 0.36, 0.24, 9, 1, true);
      t.translate(0, 0.12 + k * 0.25, 0);
      tyreParts.push(tint(t, k === 3 ? 0xffffff : 0x1a1a1a));
    }
    const rim = new THREE.RingGeometry(0.17, 0.36, 9);
    rim.rotateX(-Math.PI / 2);
    rim.translate(0, 0.99, 0);
    tyreParts.push(tint(rim, 0x101010));
    const tg = mergeGeometries(tyreParts);
    tg.computeVertexNormals();
    group.add(instanced(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), tyreM, { colors: tyreC, shadows: true }));
  }

  // --- конусы-разделители на въезде в пит-лейн и на выезде ---
  const coneM = [];
  const pit = track.pit;
  if (pit) {
    const put = (u0, u1, dOf) => {
      for (let u = u0; u < u1; u += 3.2) {
        const s = track.wrapS(pit.sIn + u);
        const i = track.index(s);
        const d = dOf(s, u);
        const p = track.pointAt(s, d);
        coneM.push(_m.compose(_p.set(p.x, edgeY(track, i, d), p.z), _q.identity(), _s.set(1, 1, 1)).clone());
      }
    };
    put(6, pit.wallA, (s) => pit.side * (pit.hwAt(s) + 0.9));
    put(pit.wallB, pit.len - 4, (s) => pit.side * (pit.hwAt(s) + 0.9));
  }
  if (coneM.length) {
    const cone = mergeGeometries([
      part(new THREE.ConeGeometry(0.17, 0.55, 10), 0xff5a00, 0, 0.3, 0),
      part(new THREE.CylinderGeometry(0.105, 0.125, 0.09, 10), 0xf4f4f4, 0, 0.36, 0),
      part(new THREE.BoxGeometry(0.4, 0.04, 0.4), 0x1a1a1a, 0, 0.02, 0),
    ]);
    group.add(instanced(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), coneM, { shadows: true }));
  }

  // --- посты маршалов (будка + флаг) и камеры наблюдения ---
  const postM = [], camM = [];
  const placeBehind = (i, side, extra) => {
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const d = side * (wall + extra);
    const x = track.x[i] + track.nx[i] * d, z = track.z[i] + track.nz[i] * d;
    if (!clear(x, z, 2)) return null;
    _q.setFromAxisAngle(up, track.heading[i] + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
    return _m.compose(_p.set(x, hAt(x, z, track.y[i]), z), _q, _s.set(1, 1, 1)).clone();
  };
  let side = 1;
  for (let s = 120; s < track.length - 60; s += 330 + r() * 120) {
    side = -side;
    if (!freeSide(track, s, side)) side = -side;
    if (!freeSide(track, s, side)) continue;
    const m = placeBehind(track.index(s), side, 2.2);
    if (m) postM.push(m);
  }
  for (let s = 60; s < track.length; s += 240 + r() * 90) {
    const sd = r() < 0.5 ? 1 : -1;
    if (!freeSide(track, s, sd)) continue;
    const m = placeBehind(track.index(s), sd, 1.2);
    if (m) camM.push(m);
  }
  if (postM.length) {
    const flagCol = night ? 0x2fe06a : 0xffd21a;
    const post = mergeGeometries([
      part(new THREE.BoxGeometry(1.6, 2.3, 1.5), 0xf2f2f2, 0, 1.15, -0.6),
      part(new THREE.BoxGeometry(1.7, 0.12, 1.6), 0xff6a00, 0, 2.36, -0.6),
      part(new THREE.BoxGeometry(1.2, 0.7, 0.04), 0x2a3440, 0, 1.6, 0.16),
      part(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 5), 0x9aa0a8, 0.9, 1.7, 0.2),
      part(new THREE.BoxGeometry(0.02, 0.6, 0.9), flagCol, 0.9, 3.05, -0.25),
    ]);
    group.add(instanced(post, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), postM, { shadows: true }));
  }
  if (camM.length) {
    const cam = mergeGeometries([
      part(new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6), 0x5a6068, 0, 2.6, 0),
      part(new THREE.BoxGeometry(0.08, 0.08, 0.7), 0x5a6068, 0, 5.1, 0.3),
      part(new THREE.BoxGeometry(0.26, 0.24, 0.5), 0xe8e8e8, 0, 4.95, 0.65),
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateX(Math.PI / 2), 0x111111, 0, 4.95, 0.92),
    ]);
    group.add(instanced(cam, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), camM));
  }

  // --- следы торможения в зонах торможения и пятна масла ---
  const skid = new Geo();
  const line = track.racingLine?.offset;
  for (const c of track.corners) {
    if (c.type === 'turn' && c.radius > 140) continue;
    const len = c.type === 'hairpin' ? 110 : 75;
    const i0 = track.wrap(c.entry - Math.round(len / track.ds));
    const cnt = Math.round(len / track.ds);
    for (const lane of [-0.8, 0.8]) {
      for (const off of [0, (r() - 0.5) * 1.6]) {
        const center = (i) => (line ? line[i] : 0) + lane + off;
        strip(skid, track, i0, cnt, (i) => [center(i) + 0.13, center(i) - 0.13], {
          y: (i, d) => track.heightAt(i, 0, d) + 0.012,
          u: (c2) => c2,
          vLen: len,
        });
      }
    }
  }
  if (skid.count) {
    const sm = new THREE.Mesh(
      skid.build(),
      new THREE.MeshBasicMaterial({ map: skidTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    sm.renderOrder = 1;
    sm.name = 'skids';
    group.add(sm);
  }
  const oilM = [];
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(r() * n);
    const d = (r() - 0.5) * track.hw[i] * 1.6;
    const p = track.pointAt(i * track.ds, d);
    const sc = 0.8 + r() * 2.2;
    _q.setFromAxisAngle(up, r() * 6.28);
    oilM.push(_m.compose(_p.set(p.x, track.heightAt(i, 0, d) + 0.014, p.z), _q, _s.set(sc, 1, sc * (0.6 + r() * 0.8))).clone());
  }
  const oilGeo = new THREE.PlaneGeometry(1, 1);
  oilGeo.rotateX(-Math.PI / 2);
  const oil = instanced(oilGeo, new THREE.MeshBasicMaterial({ map: TX.glow(), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), oilM);
  oil.renderOrder = 1;
  group.add(oil);

  // --- табло-пилон с позициями у старта (на стороне без пит-лейна) ---
  let tower = null;
  {
    const sideT = pit ? -pit.side : 1;
    for (const s0 of [70, 110, 150, -60]) {
      const s = track.wrapS(s0);
      const i = track.index(s);
      const wall = sideT > 0 ? track.wallL[i] : track.wallR[i];
      const d = sideT * (wall + 3.5);
      const p = track.pointAt(s, d);
      if (!clear(p.x, p.z, 2.5)) continue;
      tower = timingTower();
      const g = new THREE.Group();
      g.position.set(p.x, hAt(p.x, p.z, p.y), p.z);
      g.rotation.y = track.heading[i] + Math.PI + sideT * 0.5;
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 11, 0.7), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.5, metalness: 0.4 }));
      body.position.y = 7.5;
      body.castShadow = true;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 8.6), new THREE.MeshBasicMaterial({ map: tower.tex, toneMapped: false, color: new THREE.Color(1, 1, 1).multiplyScalar(night ? 1.4 : 1.1) }));
      screen.position.set(0, 7.9, 0.36);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 0.5), body.material);
      leg.position.y = 1;
      g.add(body, screen, leg);
      group.add(g);
      group.userData.towerTex = tower.tex;
      break;
    }
  }

  return {
    group,
    // rows: [{ code, color, player }] по местам
    setStandings(rows) {
      tower?.draw(rows);
    },
  };
}

// Следы шин: тёмные полосы с рваными краями и затуханием к концам (альфа).
function skidTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 512;
  const ctx = c.getContext('2d');
  const r = rng(77);
  const img = ctx.createImageData(32, 512);
  for (let y = 0; y < 512; y++) {
    const t = y / 511;
    const env = Math.min(1, t * 6) * Math.pow(1 - t, 0.6); // нарастание в начале, затухание к концу
    for (let x = 0; x < 32; x++) {
      const edge = Math.min(x, 31 - x) / 6;
      const a = Math.min(1, edge) * env * (0.65 + r() * 0.35);
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // v = 0 — начало торможения (резкий след), v = 1 — у поворота (затухает)
  t.anisotropy = 4;
  return t;
}
