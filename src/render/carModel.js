// Процедурные модели машин (без файлов): кузов строится «лофтом» по поперечным сечениям,
// детали — из примитивов. Материалы: кузов — MeshPhysicalMaterial (лак, металлик),
// карбон (canvas-плетение), стекло, резина, диски, светящиеся фары и стоп-сигналы.
// У каждой машины два уровня детализации (THREE.LOD): рядом — полная, вдали — упрощённая.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

// --- общие материалы (одни на все машины) ---
let shared = null;
function sharedMats() {
  if (shared) return shared;
  const carbonTex = TX.carbon();
  shared = {
    carbon: new THREE.MeshStandardMaterial({ map: carbonTex, color: 0xffffff, roughness: 0.32, metalness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.55, metalness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080c, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.4), toneMapped: false }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 }),
    wheelLo: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }),
  };
  return shared;
}

// Лофт по сечениям. sections: [{z, hw, hwLow, yb, yLow, ySh, yt, hwTop}] (z — от кормы к носу).
// Каждое сечение — замкнутый контур из 14 точек: низ, «полка» над колёсами, плечо, крыша.
function ring(sec) {
  const { hw, yb, ySh, yt } = sec;
  const hwLow = sec.hwLow ?? hw * 0.9;
  const yLow = sec.yLow ?? yb + (ySh - yb) * 0.45;
  const hwTop = sec.hwTop ?? hw * 0.8;
  const r = Math.min(0.08, (yt - ySh) * 0.4);
  const half = [
    [0, yb],
    [hwLow * 0.92, yb],
    [hwLow, yb + 0.05],
    [hwLow, yLow],
    [hw, yLow + 0.07],
    [hw, ySh],
    [hw * 0.97, ySh + 0.04],
    [hwTop, yt - r],
    [hwTop * 0.82, yt],
    [0, yt + 0.01],
  ];
  // полный контур: правая половина снизу вверх, затем левая сверху вниз
  const pts = half.map(([x, y]) => [x, y]);
  for (let k = half.length - 2; k >= 1; k--) pts.push([-half[k][0], half[k][1]]);
  return pts; // 18 точек, [0] — низ по центру
}

function loft(sections) {
  const rings = sections.map(ring);
  const M = rings[0].length;
  const pos = [], idx = [];
  sections.forEach((sec, k) => {
    for (const [x, y] of rings[k]) pos.push(x, y, sec.z);
  });
  for (let k = 0; k < sections.length - 1; k++) {
    for (let j = 0; j < M; j++) {
      const a = k * M + j, b = k * M + ((j + 1) % M), c = a + M, d = b + M;
      idx.push(a, b, c, b, d, c);
    }
  }
  // торцы
  const cap = (k, flip) => {
    const center = pos.length / 3;
    const sec = sections[k];
    const cy = (sec.yb + sec.yt) / 2;
    pos.push(0, cy, sec.z);
    for (let j = 0; j < M; j++) {
      const a = k * M + j, b = k * M + ((j + 1) % M);
      if (flip) idx.push(center, a, b);
      else idx.push(center, b, a);
    }
  };
  cap(0, false);
  cap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Открытая «лента» стекла по сечениям: линия окон → крыша → линия окон.
function glassLoft(sections, e = 0.012) {
  const rows = sections.map((sec) => {
    const hwTop = sec.hwTop ?? sec.hw * 0.8;
    const r = Math.min(0.08, (sec.yt - sec.ySh) * 0.4);
    const y0 = sec.ySh + 0.04, y1 = sec.yt - r;
    const yLine = Math.min(y1 - 0.02, sec.ySh + 0.1);
    const f = (yLine - y0) / Math.max(0.01, y1 - y0);
    const wLine = sec.hw * 0.97 + (hwTop - sec.hw * 0.97) * f;
    const half = [
      [wLine + e, yLine],
      [hwTop + e, y1],
      [hwTop * 0.82, sec.yt + e],
      [0, sec.yt + 0.01 + e],
    ];
    const pts = [...half];
    for (let k = half.length - 2; k >= 0; k--) pts.push([-half[k][0], half[k][1]]);
    return pts.map(([x, y]) => [x, y, sec.z]);
  });
  const M = rows[0].length;
  const pos = [], idx = [];
  for (const r of rows) for (const p of r) pos.push(...p);
  for (let k = 0; k < rows.length - 1; k++)
    for (let j = 0; j < M - 1; j++) {
      const a = k * M + j, b = a + 1, c = a + M, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function colorize(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function mergeAll(parts) {
  const clean = parts.map((g) => {
    const q = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) q.deleteAttribute(k);
    return q;
  });
  const hasUv = clean.every((g) => g.attributes.uv);
  const hasColor = clean.every((g) => g.attributes.color);
  for (const g of clean) {
    if (!hasUv && g.attributes.uv) g.deleteAttribute('uv');
    if (!hasColor && g.attributes.color) g.deleteAttribute('color');
  }
  const out = mergeGeometries(clean);
  out.computeVertexNormals();
  return out;
}

// Колесо: шина + диск со спицами + тормозной диск, одним мешем с цветами вершин. Ось — X.
const wheelCache = new Map();
function wheelGeo(r, w, spokes = 5, rimColor = 0x9aa1aa) {
  const key = `${r}-${w}-${spokes}-${rimColor}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const parts = [];
  const tire = new THREE.CylinderGeometry(r, r, w, 22, 1, true);
  parts.push(colorize(tire, 0x18181a));
  const side = new THREE.RingGeometry(r * 0.7, r, 22);
  side.rotateX(-Math.PI / 2);
  const s1 = side.clone();
  s1.translate(0, w / 2, 0);
  const s2 = side.clone();
  s2.rotateX(Math.PI);
  s2.translate(0, -w / 2, 0);
  parts.push(colorize(s1, 0x202024), colorize(s2, 0x202024));
  side.dispose();
  const rim = new THREE.CylinderGeometry(r * 0.7, r * 0.7, w * 0.2, 20);
  rim.translate(0, w * 0.36, 0);
  parts.push(colorize(rim, 0x2a2d31));
  for (let k = 0; k < spokes; k++) {
    const sp = new THREE.BoxGeometry(r * 0.12, w * 0.12, r * 1.3);
    sp.rotateY((k / spokes) * Math.PI * 2);
    sp.translate(0, w * 0.47, 0);
    parts.push(colorize(sp, rimColor));
  }
  const hub = new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 0.14, 10);
  hub.translate(0, w * 0.5, 0);
  parts.push(colorize(hub, 0xcfd3d8));
  const disc = new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.03, 18);
  disc.translate(0, w * 0.18, 0);
  parts.push(colorize(disc, 0x5b5f66));
  const g = mergeAll(parts);
  g.rotateZ(Math.PI / 2); // ось вращения — X; «лицо» диска смотрит в +X
  wheelCache.set(key, g);
  return g;
}

// ---------------- GT3 ----------------
const GT3_SECTIONS = [
  { z: -2.3, hw: 0.9, yb: 0.3, ySh: 0.72, yt: 0.86, hwTop: 0.78, yLow: 0.5 },
  { z: -2.12, hw: 0.99, yb: 0.2, ySh: 0.84, yt: 0.95, hwTop: 0.86, hwLow: 0.84, yLow: 0.6 },
  { z: -1.7, hw: 1.0, yb: 0.16, ySh: 0.9, yt: 1.02, hwTop: 0.72, hwLow: 0.84, yLow: 0.62 },
  { z: -1.2, hw: 0.99, yb: 0.14, ySh: 0.9, yt: 1.14, hwTop: 0.64, hwLow: 0.9, yLow: 0.55 },
  { z: -0.55, hw: 0.95, yb: 0.13, ySh: 0.86, yt: 1.25, hwTop: 0.6, hwLow: 0.92, yLow: 0.5 },
  { z: 0.15, hw: 0.95, yb: 0.13, ySh: 0.84, yt: 1.23, hwTop: 0.6, hwLow: 0.92, yLow: 0.5 },
  { z: 0.72, hw: 0.97, yb: 0.13, ySh: 0.8, yt: 0.94, hwTop: 0.84, hwLow: 0.9, yLow: 0.55 },
  { z: 1.3, hw: 0.99, yb: 0.14, ySh: 0.74, yt: 0.82, hwTop: 0.9, hwLow: 0.83, yLow: 0.58 },
  { z: 1.9, hw: 0.97, yb: 0.15, ySh: 0.64, yt: 0.7, hwTop: 0.86, hwLow: 0.84, yLow: 0.5 },
  { z: 2.3, hw: 0.86, yb: 0.2, ySh: 0.46, yt: 0.52, hwTop: 0.74, yLow: 0.36 },
];

function gt3Parts(dims) {
  const body = loft(GT3_SECTIONS);
  // стекло: полоса от линии окон через крышу, чуть снаружи кузова (окна, лобовое, заднее)
  const glass = glassLoft(GT3_SECTIONS.slice(2, 7));
  // карбон: сплиттер, диффузор, пороги, антикрыло, зеркала
  const carbonParts = [
    box(1.86, 0.04, 0.4, 0, 0.12, 2.2),
    box(1.6, 0.05, 0.5, 0, 0.2, -2.25, 0.3),
    box(0.06, 0.14, 2.3, 0.93, 0.18, 0.1),
    box(0.06, 0.14, 2.3, -0.93, 0.18, 0.1),
    box(1.96, 0.05, 0.36, 0, 1.3, -2.05, 0.08),
    box(0.03, 0.32, 0.5, 0.98, 1.22, -2.05),
    box(0.03, 0.32, 0.5, -0.98, 1.22, -2.05),
    box(0.05, 0.36, 0.14, 0.42, 1.08, -2.02, 0.2),
    box(0.05, 0.36, 0.14, -0.42, 1.08, -2.02, 0.2),
    box(0.16, 0.08, 0.1, 0.99, 0.98, 0.6),
    box(0.16, 0.08, 0.1, -0.99, 0.98, 0.6),
    box(1.2, 0.02, 0.5, 0, 0.83, 1.55), // вентиляция капота
  ];
  // фары и стоп-сигналы
  const heads = [box(0.4, 0.07, 0.1, 0.62, 0.6, 2.2, 0, -0.35), box(0.4, 0.07, 0.1, -0.62, 0.6, 2.2, 0, 0.35)];
  const tails = [box(0.5, 0.06, 0.05, 0.6, 0.8, -2.31), box(0.5, 0.06, 0.05, -0.6, 0.8, -2.31), box(0.9, 0.025, 0.04, 0, 0.84, -2.31)];
  const black = [box(0.9, 0.12, 0.06, 0, 0.36, 2.29), box(0.1, 0.1, 0.12, 0.35, 0.3, -2.4), box(0.1, 0.1, 0.12, -0.35, 0.3, -2.4)];
  return { body, glass, carbon: mergeAll(carbonParts), heads: mergeAll(heads), tails: mergeAll(tails), black: mergeAll(black) };
}

// ---------------- F1 ----------------
// Нос → монокок → понтоны → капот двигателя с воздухозаборником; открытые колёса.
const F1_BODY = [
  { z: -2.45, hw: 0.2, yb: 0.2, ySh: 0.5, yt: 0.58, hwTop: 0.14, hwLow: 0.2, yLow: 0.3 },
  { z: -2.0, hw: 0.28, yb: 0.12, ySh: 0.55, yt: 0.68, hwTop: 0.16, hwLow: 0.28, yLow: 0.3 },
  { z: -1.5, hw: 0.5, yb: 0.08, ySh: 0.5, yt: 0.78, hwTop: 0.18, hwLow: 0.5, yLow: 0.3 },
  { z: -0.9, hw: 0.8, yb: 0.07, ySh: 0.55, yt: 0.92, hwTop: 0.22, hwLow: 0.8, yLow: 0.3 },
  { z: -0.4, hw: 0.84, yb: 0.07, ySh: 0.58, yt: 1.06, hwTop: 0.2, hwLow: 0.84, yLow: 0.3 },
  { z: -0.05, hw: 0.8, yb: 0.07, ySh: 0.58, yt: 0.78, hwTop: 0.36, hwLow: 0.8, yLow: 0.3 },
  { z: 0.35, hw: 0.4, yb: 0.08, ySh: 0.58, yt: 0.72, hwTop: 0.34, hwLow: 0.4, yLow: 0.3 },
  { z: 0.9, hw: 0.32, yb: 0.12, ySh: 0.5, yt: 0.6, hwTop: 0.26, hwLow: 0.32, yLow: 0.3 },
  { z: 1.8, hw: 0.2, yb: 0.16, ySh: 0.36, yt: 0.44, hwTop: 0.16, hwLow: 0.2, yLow: 0.24 },
  { z: 2.6, hw: 0.1, yb: 0.13, ySh: 0.2, yt: 0.25, hwTop: 0.08, hwLow: 0.1, yLow: 0.16 },
  { z: 2.78, hw: 0.05, yb: 0.14, ySh: 0.17, yt: 0.2, hwTop: 0.04, hwLow: 0.05, yLow: 0.15 },
];

function cyl(r, _len, a, b) {
  // тонкий цилиндр от точки a до точки b (рычаги подвески, halo)
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 6);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.applyMatrix4(m);
  const mid = A.add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function f1Parts(dims) {
  const body = loft(F1_BODY);
  const zf = (dims.cgZ ?? 0) + 3.6 * 0.55, zr = (dims.cgZ ?? 0) - 3.6 * 0.45;
  const tw = dims.track / 2;
  const carbonParts = [
    box(1.5, 0.04, 3.4, 0, 0.05, -0.4), // днище
    box(1.1, 0.14, 0.5, 0, 0.18, -2.45, -0.35), // диффузор
    // переднее антикрыло: два элемента и боковины
    box(1.9, 0.03, 0.34, 0, 0.1, 2.62, -0.06),
    box(1.7, 0.025, 0.22, 0, 0.19, 2.46, -0.35),
    box(0.03, 0.26, 0.56, 0.95, 0.17, 2.55),
    box(0.03, 0.26, 0.56, -0.95, 0.17, 2.55),
    // заднее антикрыло: основной элемент, закрылок, боковины, пилон
    box(1.0, 0.04, 0.3, 0, 0.84, -2.62, 0.12),
    box(1.0, 0.03, 0.22, 0, 0.98, -2.72, 0.45),
    box(0.03, 0.62, 0.66, 0.51, 0.78, -2.62),
    box(0.03, 0.62, 0.66, -0.51, 0.78, -2.62),
    box(0.06, 0.5, 0.12, 0, 0.55, -2.45, 0.25),
    // «акулий плавник» на капоте
    box(0.03, 0.26, 1.1, 0, 0.95, -1.35, 0.12),
    // зеркала
    box(0.14, 0.06, 0.05, 0.55, 0.78, 0.2),
    box(0.14, 0.06, 0.05, -0.55, 0.78, 0.2),
    cyl(0.012, 0.28, [0.5, 0.62, 0.22], [0.55, 0.76, 0.2]),
    cyl(0.012, 0.28, [-0.5, 0.62, 0.22], [-0.55, 0.76, 0.2]),
  ];
  // подвеска: верхние и нижние рычаги к ступицам
  for (const side of [1, -1]) {
    const x = side * (tw - 0.12);
    carbonParts.push(cyl(0.022, 1, [side * 0.28, 0.45, zf + 0.25], [x, 0.46, zf]));
    carbonParts.push(cyl(0.022, 1, [side * 0.28, 0.45, zf - 0.3], [x, 0.46, zf]));
    carbonParts.push(cyl(0.022, 1, [side * 0.3, 0.22, zf + 0.25], [x, 0.26, zf]));
    carbonParts.push(cyl(0.022, 1, [side * 0.3, 0.22, zf - 0.3], [x, 0.26, zf]));
    carbonParts.push(cyl(0.022, 1, [side * 0.45, 0.5, zr + 0.3], [x, 0.5, zr]));
    carbonParts.push(cyl(0.022, 1, [side * 0.45, 0.24, zr + 0.3], [x, 0.26, zr]));
  }
  // halo: дуга над кокпитом и центральная стойка
  const halo = new THREE.TorusGeometry(0.34, 0.032, 6, 18, Math.PI);
  halo.rotateX(Math.PI / 2); // дуга лежит горизонтально и выгнута вперёд
  halo.translate(0, 0.96, -0.12);
  carbonParts.push(halo, cyl(0.035, 1, [0, 0.72, 0.42], [0, 0.96, 0.22]));
  carbonParts.push(cyl(0.03, 1, [0.34, 0.78, -0.2], [0.34, 0.96, -0.12]), cyl(0.03, 1, [-0.34, 0.78, -0.2], [-0.34, 0.96, -0.12]));
  // шлем пилота и воздухозаборник (чёрные)
  const helmet = new THREE.SphereGeometry(0.15, 12, 10);
  helmet.translate(0, 0.86, -0.2);
  const intake = box(0.26, 0.22, 0.1, 0, 0.98, -0.42);
  // стоп-сигнал (дождевой фонарь) сзади
  const tails = [box(0.12, 0.08, 0.03, 0, 0.42, -2.52)];
  const heads = [box(0.01, 0.01, 0.01, 0, 0.2, 2.7)];
  // крыло в цвет акцента: торцы антикрыльев
  const accent = [box(0.035, 0.12, 0.3, 0.955, 0.3, 2.55), box(0.035, 0.12, 0.3, -0.955, 0.3, 2.55), box(0.035, 0.2, 0.3, 0.515, 1.02, -2.62), box(0.035, 0.2, 0.3, -0.515, 1.02, -2.62)];
  return {
    body,
    glass: helmet,
    carbon: mergeAll(carbonParts),
    heads: mergeAll(heads),
    tails: mergeAll(tails),
    black: mergeAll([intake]),
    accent: mergeAll(accent),
  };
}

// --- сборка модели ---
const partsCache = new Map();

export function buildCarModel(spec, { color = 0xd81e2a, accent = 0x111111, number = 0, player = false } = {}) {
  const S = sharedMats();
  const dims = spec.dims;
  if (!partsCache.has(spec.id)) partsCache.set(spec.id, spec.id === 'f1' ? f1Parts(dims) : gt3Parts(dims));
  const P = partsCache.get(spec.id);

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.25,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.2,
  });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.02, 0.02), toneMapped: false });

  const root = new THREE.Group();
  root.name = `car-${spec.id}`;
  root.rotation.order = 'YXZ';
  const lod = new THREE.LOD();
  root.add(lod);

  // --- ближний уровень ---
  const hi = new THREE.Group();
  const bodyMesh = new THREE.Mesh(P.body, paint);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = player;
    hi.add(m);
    return m;
  };
  bodyMesh.castShadow = player;
  hi.add(bodyMesh);
  add(P.glass, spec.id === 'f1' ? new THREE.MeshPhysicalMaterial({ color: accent === 0x111111 ? 0xf2f2f2 : accent, roughness: 0.2, clearcoat: 1 }) : S.glass);
  add(P.carbon, S.carbon);
  add(P.heads, S.head);
  add(P.tails, tail);
  if (P.black) add(P.black, S.black);
  if (P.accent) add(P.accent, new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.4, roughness: 0.35, clearcoat: 1 }));

  // колёса: поворотный узел (руль) → колесо (вращение)
  const wg = wheelGeo(dims.wheelR, dims.wheelW, spec.id === 'f1' ? 8 : 5, spec.id === 'f1' ? 0x2b2d31 : 0xa4abb4);
  const wheels = [];
  const a = spec.wheelbase * (1 - spec.weightFront), b = spec.wheelbase * spec.weightFront;
  const cgZ = (dims.cgZ ?? 0);
  for (const [zf, front] of [[cgZ + a, true], [cgZ - b, false]]) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * dims.track / 2, dims.wheelR, zf);
      const w = new THREE.Mesh(wg, S.wheel);
      if (side > 0) w.rotation.y = Math.PI; // диск наружу
      w.castShadow = player;
      pivot.add(w);
      hi.add(pivot);
      wheels.push({ pivot, mesh: w, front, side });
    }
  }
  lod.addLevel(hi, 0);

  // --- дальний уровень: только кузов и простые колёса ---
  const lo = new THREE.Group();
  lo.add(new THREE.Mesh(P.body, paint));
  if (!P.loWheels) {
    const parts = [];
    for (const [zf] of [[cgZ + a], [cgZ - b]])
      for (const side of [1, -1]) {
        const c = new THREE.CylinderGeometry(dims.wheelR, dims.wheelR, dims.wheelW, 10);
        c.rotateZ(Math.PI / 2);
        c.translate((side * dims.track) / 2, dims.wheelR, zf);
        parts.push(c);
      }
    P.loWheels = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
  }
  lo.add(new THREE.Mesh(P.loWheels, S.wheelLo));
  lod.addLevel(lo, player ? 400 : 70);

  const model = {
    root,
    lod,
    wheels,
    paint,
    tail,
    spec,
    // обновление по состоянию машины: положение, повороты, колёса, стоп-сигналы
    update(state, alpha = 1) {
      const p = state.prev;
      const x = p ? p.x + (state.x - p.x) * alpha : state.x;
      const y = p ? p.y + (state.y - p.y) * alpha : state.y;
      const z = p ? p.z + (state.z - p.z) * alpha : state.z;
      let psi = state.psi;
      if (p) {
        let d = state.psi - p.psi;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        psi = p.psi + d * alpha;
      }
      root.position.set(x, y + (state.bounce || 0), z);
      root.rotation.set(state.pitch || 0, psi, state.roll || 0);
      for (const w of wheels) {
        w.mesh.rotation.x = state.spin || 0;
        if (w.front) w.pivot.rotation.y = state.delta || 0;
      }
      const brake = state.brakeLight ?? state.brake > 0.2;
      const k = brake ? 3.2 : 0.55;
      tail.color.setRGB(k, k * 0.03, k * 0.03);
    },
    dispose() {
      paint.dispose();
      tail.dispose();
    },
  };
  return model;
}

