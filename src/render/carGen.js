// Процедурная генерация моделей машин GT3 и F1 (только геометрия three.js, без DOM):
// используется скриптом tools/build-cars.mjs (экспорт в GLB) и в браузере как запасной путь,
// если GLB не загрузился. Детали названы по ролям материалов — при загрузке им назначаются
// общие PBR-материалы (лак с clearcoat, карбон, стекло, резина, диски, огни).
//
// Узлы модели:  car → LOD0 / LOD1 / LOD2 → body (кузов и детали, мультиматериал),
//               steer_FL / steer_FR (поворот колеса) → wheel_* (вращение) + caliper.
// Ось: +z — вперёд, +y — вверх, +x — влево; начало — центр масс на уровне земли.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MAT = ['paint', 'carbon', 'glass', 'black', 'chrome', 'rubber', 'rim', 'disc', 'caliper', 'headlight', 'taillight', 'rainlight', 'interior', 'helmet', 'accent', 'grille'];

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Кусочно-линейная интерполяция ключей [[z, v], ...] (z по возрастанию), сглаженная.
function keys(k) {
  return (z) => {
    if (z <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (z <= k[i][0]) {
        const t = smooth(k[i - 1][0], k[i][0], z);
        return lerp(k[i - 1][1], k[i][1], t);
      }
    }
    return k[k.length - 1][1];
  };
}

// Catmull-Rom по ломаной: n точек на выходе.
function resample(pts, n) {
  const out = [];
  const seg = pts.length - 1;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * seg;
    const i = Math.min(seg - 1, Math.floor(t));
    const f = t - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(seg, i + 2)];
    const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f * f + (-a + 3 * b - 3 * c2 + d) * f * f * f);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

// Симметричный лофт: sections [{z, pts}] — правая половина от низа (x=0) до верха (x=0).
// matOf(z, ringFrac, x, y) → имя материала для четырёхугольника. Возвращает геометрию с группами.
function loftSym(sections, matOf, { capEnds = true } = {}) {
  const half = sections[0].pts.length;
  const M = half * 2 - 2; // кольцо без дубликатов верха и низа
  const pos = [], uv = [];
  const zMin = sections[0].z, zMax = sections[sections.length - 1].z;
  for (const s of sections) {
    for (let j = 0; j < M; j++) {
      const p = j < half ? s.pts[j] : s.pts[M - j]; // вторая половина — зеркально
      const x = j < half ? -p[0] : p[0];
      pos.push(x, p[1], s.z);
      uv.push((s.z - zMin) / (zMax - zMin), j / M);
    }
  }
  const byMat = new Map();
  const quad = (mat, a, b, c, d) => {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(a, c, b, b, c, d);
  };
  for (let k = 0; k < sections.length - 1; k++) {
    for (let j = 0; j < M; j++) {
      const a = k * M + j, b = k * M + ((j + 1) % M), c = a + M, d = b + M;
      const zm = (sections[k].z + sections[k + 1].z) / 2;
      const jm = (j + 0.5) / M;
      const px = (pos[a * 3] + pos[d * 3]) / 2, py = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2;
      quad(matOf(zm, jm, px, py), a, b, c, d);
    }
  }
  if (capEnds) {
    for (const [k, flip] of [
      [0, false],
      [sections.length - 1, true],
    ]) {
      const center = pos.length / 3;
      const s = sections[k];
      let cy = 0;
      for (const p of s.pts) cy += p[1] / s.pts.length;
      pos.push(0, cy, s.z);
      uv.push(k ? 1 : 0, 0.5);
      for (let j = 0; j < M; j++) {
        const a = k * M + j, b = k * M + ((j + 1) % M);
        const mat = matOf(s.z, (j + 0.5) / M, 0, cy, true);
        if (!byMat.has(mat)) byMat.set(mat, []);
        if (flip) byMat.get(mat).push(center, b, a);
        else byMat.get(mat).push(center, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx = [];
  const mats = [];
  for (const [mat, list] of byMat) {
    g.addGroup(idx.length, list.length, mats.length);
    mats.push(mat);
    for (const v of list) idx.push(v);
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.mats = mats;
  return g;
}

// --- примитивы деталей (с ролью материала) ---
function part(geo, mat) {
  geo.userData.mat = mat;
  return geo;
}
function bx(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return part(g, mat);
}
function cyl(mat, r0, r1, len, seg, x, y, z, axis = 'y') {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return part(g, mat);
}
function tube(mat, a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return part(g, mat);
}
const mirror = (g) => {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  // зеркало выворачивает треугольники — меняем порядок обхода
  const idx = m.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) {
    const t = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, t);
  }
  m.computeVertexNormals();
  m.userData.mat = g.userData.mat;
  return m;
};
const both = (g) => [g, mirror(g)];

// Профиль крыла (симметричный NACA-подобный) вытянут по x: span, chord, толщина, угол атаки.
function wing(mat, span, chord, thick, x, y, z, aoa = 0, seg = 14) {
  const pts = [];
  for (let k = 0; k <= seg; k++) {
    const t = k / seg;
    const zt = 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
    pts.push([t, zt + 0.06 * thick * Math.sin(Math.PI * t) * 4]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(chord * 0.5, 0);
  for (const [t, h] of pts) shape.lineTo(chord * (0.5 - t), h * chord);
  for (let k = pts.length - 1; k >= 0; k--) shape.lineTo(chord * (0.5 - pts[k][0]), -pts[k][1] * chord * 0.55);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  g.rotateY(Math.PI / 2); // размах — по x, хорда — по z
  g.rotateX(aoa);
  g.translate(x, y, z);
  return part(g, mat);
}

// Тело вращения вокруг оси x: profile [[r, xOff], ...].
function revolveX(mat, profile, seg) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateZ(-Math.PI / 2); // ось лейта (y) → x
  return part(g, mat);
}

// ===================================================================================
// Колесо: шина + диск со спицами + тормозной диск (вращается), суппорт — отдельно.
// ===================================================================================
function wheelParts(R, W, { lod = 0, spokes = 5, rimR = 0.68, f1 = false } = {}) {
  const seg = lod === 0 ? 40 : lod === 1 ? 18 : 10;
  const hw = W / 2;
  const rr = R * rimR;
  const spin = [];
  // шина: протектор, плечи, боковины
  const tireProfile = [
    [rr * 0.99, -hw * 0.92],
    [rr + (R - rr) * 0.25, -hw],
    [R * 0.97, -hw * 0.98],
    [R, -hw * 0.82],
    [R, hw * 0.82],
    [R * 0.97, hw * 0.98],
    [rr + (R - rr) * 0.25, hw],
    [rr * 0.99, hw * 0.92],
  ];
  spin.push(revolveX('rubber', lod === 2 ? [tireProfile[0], tireProfile[3], tireProfile[4], tireProfile[7]] : tireProfile, seg));
  if (lod === 2) {
    spin.push(cyl('rim', rr, rr, 0.02, seg, hw * 0.55, 0, 0, 'x'));
    return { spin, fixed: [] };
  }
  // обод и спицы
  spin.push(revolveX('rim', [[rr, -hw * 0.9], [rr * 1.02, -hw * 0.85], [rr * 1.02, hw * 0.75], [rr * 0.97, hw * 0.82], [rr * 0.9, hw * 0.7]], seg));
  const face = hw * 0.62;
  if (f1 && lod === 0) {
    // аэродинамическая крышка диска F1
    spin.push(cyl('rim', rr * 0.92, rr * 0.92, 0.015, seg, face + 0.02, 0, 0, 'x'));
    spin.push(cyl('chrome', rr * 0.2, rr * 0.2, 0.05, 12, face + 0.04, 0, 0, 'x'));
  } else {
    const nsp = lod === 0 ? spokes * 2 : spokes;
    for (let k = 0; k < nsp; k++) {
      const a = (k / nsp) * Math.PI * 2 + (lod === 0 && k % 2 ? 0.12 : 0);
      const sp = new THREE.BoxGeometry(0.03, rr * 0.82, R * 0.07);
      sp.translate(0, rr * 0.47, 0);
      sp.rotateX(a);
      sp.translate(face, 0, 0);
      spin.push(part(sp, 'rim'));
    }
    spin.push(cyl('rim', rr * 0.22, rr * 0.26, 0.06, lod === 0 ? 16 : 8, face, 0, 0, 'x'));
    if (lod === 0) spin.push(cyl('chrome', rr * 0.09, rr * 0.09, 0.07, 6, face + 0.03, 0, 0, 'x'));
  }
  // тормозной диск (светится при торможении)
  spin.push(cyl('disc', rr * 0.8, rr * 0.8, 0.032, lod === 0 ? 28 : 12, hw * 0.05, 0, 0, 'x'));
  // суппорт — не вращается, сверху спереди диска
  const fixed = [];
  if (lod === 0) {
    const cal = new THREE.BoxGeometry(0.07, rr * 0.34, rr * 0.62);
    cal.translate(hw * 0.12, rr * 0.66, 0);
    cal.rotateX(-0.6);
    fixed.push(part(cal, 'caliper'));
  }
  return { spin, fixed };
}

// ===================================================================================
// GT3
// ===================================================================================
export function gt3Layout(spec) {
  const a = spec.wheelbase * (1 - spec.weightFront), b = spec.wheelbase * spec.weightFront;
  return { zf: a, zr: -b, track: spec.dims.track, R: spec.dims.wheelR, W: spec.dims.wheelW, len: spec.dims.length };
}

function gt3Body(spec, lod) {
  const { zf, zr, R, W, track } = gt3Layout(spec);
  const Z0 = -2.3, Z1 = 2.32;
  const wellX = track / 2 - W / 2 - 0.04;
  const yb = keys([[-2.3, 0.3], [-1.9, 0.16], [-1.5, 0.11], [1.8, 0.11], [2.1, 0.13], [2.32, 0.2]]);
  const ySh = keys([[-2.3, 0.8], [-2.05, 0.9], [-1.2, 0.9], [-0.9, 0.88], [0.0, 0.84], [0.7, 0.8], [1.25, 0.73], [1.8, 0.64], [2.1, 0.55], [2.32, 0.42]]);
  const cab = (z) => smooth(-1.25, -0.45, z) * (1 - smooth(0.2, 0.92, z));
  const yRoof = 1.19;
  const hwOf = (z) => {
    let w = 0.92 + 0.075 * Math.exp(-(((z - zf) / 0.48) ** 2)) + 0.085 * Math.exp(-(((z - zr) / 0.52) ** 2));
    w *= lerp(1, 0.84, smooth(1.85, 2.32, z));
    w *= lerp(1, 0.9, smooth(-1.95, -2.3, z));
    return w;
  };
  const archR = R + 0.06;
  const archY = (z) => {
    for (const za of [zf, zr]) {
      const dz = z - za;
      if (Math.abs(dz) < archR) return R + Math.sqrt(archR * archR - dz * dz) * 0.95;
    }
    return -1;
  };
  const nS = lod === 0 ? 96 : lod === 1 ? 30 : 10;
  const nP = lod === 0 ? 26 : lod === 1 ? 12 : 7;
  const sections = [];
  for (let k = 0; k < nS; k++) {
    // плотнее у носа и кормы
    const t = k / (nS - 1);
    const z = Z0 + (Z1 - Z0) * (0.5 - 0.5 * Math.cos(Math.PI * t)) * 0.18 + (Z1 - Z0) * t * 0.82;
    const hw = hwOf(z), b0 = yb(z), sh = ySh(z), c = cab(z);
    const cw = 0.66 * lerp(0.9, 1, smooth(-1.2, -0.3, z));
    const yLow = b0 + (sh - b0) * 0.42;
    const top = sh + 0.075 + c * (yRoof - sh);
    let pts = [
      [0, b0],
      [hw * 0.8, b0],
      [hw * 0.97, b0 + 0.05],
      [hw, b0 + 0.17],
      [hw, yLow],
      [hw * 0.995, sh - 0.1],
      [hw * 0.965, sh - 0.01],
      [hw * 0.89, sh + 0.03],
      [lerp(hw * 0.8, cw * 1.05, c), sh + 0.045 + c * 0.03],
      [lerp(hw * 0.7, cw, c), sh + 0.055 + c * (yRoof - sh) * 0.45],
      [lerp(hw * 0.55, cw * 0.86, c), sh + 0.065 + c * (yRoof - sh) * 0.86],
      [lerp(hw * 0.33, cw * 0.5, c), sh + 0.072 + c * (yRoof - sh) * 0.985],
      [0, top],
    ];
    // нос и корма: скругляем торцы
    const endF = smooth(2.12, 2.32, z), endR = smooth(-2.18, -2.3, z);
    if (endF > 0 || endR > 0) {
      const e = Math.max(endF, endR);
      const mid = (b0 + sh) / 2;
      pts = pts.map(([x, y]) => [x * (1 - 0.35 * e), lerp(y, mid, 0.35 * e)]);
    }
    pts = resample(pts, nP);
    // колёсные арки: всё, что ниже арки, уходит внутрь (колёсная ниша)
    const ay = archY(z);
    if (ay > 0) pts = pts.map(([x, y]) => (y < ay && x > wellX ? [lerp(x, wellX, smooth(ay - 0.02, ay - 0.12, y)), y] : [x, y]));
    sections.push({ z, pts });
  }
  const isGlass = (z, f, x, y) => {
    const c = cab(z);
    if (c < 0.35 || y < ySh(z) + 0.05) return false;
    const ring = Math.abs(f - 0.5) * 2; // 0 — верх, 1 — низ
    if (z > 0.25) return ring < 0.62 && !(z < 0.4 && ring > 0.5); // лобовое
    if (z < -0.5) return ring < 0.55 && z > -1.18; // заднее
    // боковые окна со стойками
    return ring > 0.22 && ring < 0.6 && z < 0.5 && z > -0.62 && Math.abs(z - (-0.08)) > 0.05;
  };
  const matOf = (z, f, x, y, cap) => {
    if (cap) return z > 0 ? 'grille' : 'black';
    const ring = Math.abs(f - 0.5) * 2;
    if (ring > 0.93) return 'black'; // днище
    if (Math.abs(x) < wellX + 0.02 && y < (archY(z) > 0 ? archY(z) : -1) && ring > 0.5) return 'black'; // ниша
    if (z > 2.12 && y < 0.36 && ring > 0.6) return 'grille'; // нижний воздухозаборник
    if (z < -2.18 && y < 0.7 && ring > 0.55) return 'black'; // корма — диффузор
    if (isGlass(z, f, x, y)) return 'glass';
    return 'paint';
  };
  return { geo: loftSym(sections, matOf), ySh, hwOf, cab, yb, yRoof };
}

function gt3Details(spec, B, lod) {
  const P = [];
  const { zf, zr } = gt3Layout(spec);
  if (lod === 2) {
    P.push(bx('headlight', 1.3, 0.06, 0.04, 0, 0.6, 2.2), bx('taillight', 1.6, 0.06, 0.04, 0, 0.82, -2.28), bx('carbon', 1.8, 0.04, 0.3, 0, 1.28, -2.0));
    return P;
  }
  const sh = B.ySh;
  // сплиттер, канарды, пороги, диффузор
  P.push(bx('carbon', 1.92, 0.035, 0.42, 0, 0.085, 2.12));
  P.push(...both(bx('carbon', 0.28, 0.02, 0.22, 0.86, 0.36, 2.0, 0, 0.3, 0.25)));
  P.push(...both(bx('carbon', 0.05, 0.12, 2.0, 0.99, 0.16, (zf + zr) / 2)));
  for (const x of [-0.5, -0.17, 0.17, 0.5]) P.push(bx('carbon', 0.025, 0.2, 0.45, x, 0.2, -2.1, -0.35));
  P.push(bx('carbon', 1.4, 0.02, 0.5, 0, 0.17, -2.08, -0.33));
  // антикрыло на «лебединых шеях»
  if (lod === 0) {
    P.push(wing('carbon', 1.84, 0.36, 0.12, 0, 1.31, -2.02, -0.12));
    P.push(wing('carbon', 1.84, 0.16, 0.1, 0, 1.4, -2.2, -0.55));
    P.push(...both(bx('carbon', 0.025, 0.34, 0.6, 0.93, 1.3, -2.06)));
    for (const x of [0.38, -0.38]) {
      P.push(tube('carbon', [x, sh(-1.75) + 0.02, -1.72], [x, 1.2, -1.85], 0.025));
      P.push(tube('carbon', [x, 1.2, -1.85], [x, 1.33, -2.0], 0.025));
    }
  } else P.push(bx('carbon', 1.84, 0.05, 0.36, 0, 1.31, -2.02), ...both(bx('carbon', 0.03, 0.3, 0.5, 0.93, 1.28, -2.05)));
  // фары: стреловидные линзы на крыльях, корпус, стоп-сигналы — световая полоса
  P.push(...both(bx('headlight', 0.36, 0.06, 0.16, 0.6, sh(2.05) - 0.01, 2.06, 0.25, -0.5, 0.12)));
  P.push(...both(bx('black', 0.42, 0.04, 0.2, 0.6, sh(2.05) - 0.04, 2.04, 0.25, -0.5, 0.12)));
  P.push(bx('taillight', 1.5, 0.045, 0.03, 0, 0.84, -2.29));
  P.push(...both(bx('taillight', 0.24, 0.1, 0.05, 0.7, 0.8, -2.27, 0, 0.2)));
  P.push(bx('rainlight', 0.14, 0.07, 0.03, 0, 0.5, -2.3));
  // зеркала, воздухозаборник на крыше, жалюзи капота, выхлоп
  for (const s of [1, -1]) {
    P.push(tube('black', [s * 0.86, sh(0.62) + 0.04, 0.6], [s * 1.0, sh(0.62) + 0.08, 0.58], 0.018));
    P.push(bx('paint', 0.16, 0.08, 0.13, s * 1.04, sh(0.62) + 0.09, 0.56));
  }
  P.push(bx('paint', 0.3, 0.08, 0.32, 0, B.yRoof + 0.035, 0.05));
  P.push(bx('black', 0.26, 0.05, 0.03, 0, B.yRoof + 0.04, 0.21));
  if (lod === 0) {
    for (const x of [0.3, -0.3]) for (let k = 0; k < 6; k++) P.push(bx('black', 0.28, 0.012, 0.03, x, sh(1.5 - k * 0.07) + 0.06, 1.5 - k * 0.07, -0.12));
    P.push(cyl('chrome', 0.045, 0.045, 0.14, 10, 0.22, 0.32, -2.32, 'z'), cyl('chrome', 0.045, 0.045, 0.14, 10, -0.22, 0.32, -2.32, 'z'));
    // интерьер: сиденье, каркас, руль, шлем пилота
    P.push(bx('interior', 1.3, 0.25, 1.6, 0, 0.42, -0.2));
    P.push(bx('interior', 0.5, 0.55, 0.12, 0.3, 0.75, -0.55, -0.15));
    P.push(tube('interior', [0.55, 0.6, -0.6], [0.55, 1.12, -0.5], 0.025), tube('interior', [-0.55, 0.6, -0.6], [-0.55, 1.12, -0.5], 0.025));
    P.push(tube('interior', [0.55, 1.12, -0.5], [-0.55, 1.12, -0.5], 0.025));
    P.push(cyl('black', 0.16, 0.16, 0.03, 16, 0.3, 0.86, 0.22, 'z'));
    const helm = new THREE.SphereGeometry(0.14, 16, 12);
    helm.translate(0.3, 1.0, -0.38);
    P.push(part(helm, 'helmet'));
  }
  return P;
}

// ===================================================================================
// F1
// ===================================================================================
function f1Body(spec, lod) {
  const cz = spec.dims.cgZ ?? 0;
  const a = spec.wheelbase * (1 - spec.weightFront), b = spec.wheelbase * spec.weightFront;
  const zf = cz + a, zr = cz - b;
  // монокок + нос + капот двигателя (узкий лофт), понтоны — отдельно
  const nS = lod === 0 ? 70 : lod === 1 ? 24 : 8;
  const nP = lod === 0 ? 20 : lod === 1 ? 10 : 6;
  const Z0 = -2.35, Z1 = 2.72;
  const hw = keys([[-2.35, 0.14], [-1.9, 0.2], [-1.2, 0.3], [-0.6, 0.36], [0.0, 0.38], [0.6, 0.34], [1.0, 0.26], [1.6, 0.16], [2.3, 0.09], [2.72, 0.05]]);
  const yb = keys([[-2.35, 0.2], [-2.0, 0.12], [1.2, 0.1], [2.0, 0.16], [2.72, 0.17]]);
  const yt = keys([[-2.35, 0.45], [-1.8, 0.62], [-1.0, 0.82], [-0.45, 0.96], [-0.25, 0.86], [0.1, 0.7], [0.6, 0.66], [1.2, 0.58], [1.9, 0.42], [2.72, 0.24]]);
  const sections = [];
  for (let k = 0; k < nS; k++) {
    const z = Z0 + ((Z1 - Z0) * k) / (nS - 1);
    const w = hw(z), b0 = yb(z), t = yt(z);
    // кокпит: вырез сверху (ниже край), шлем видно
    const cock = smooth(-0.55, -0.35, z) * (1 - smooth(0.25, 0.45, z));
    let pts = [
      [0, b0],
      [w * 0.85, b0],
      [w, b0 + (t - b0) * 0.25],
      [w * 0.98, b0 + (t - b0) * 0.6],
      [w * 0.82, t - 0.05 - cock * 0.12],
      [w * 0.5, t - cock * 0.2],
      [0, t + 0.01 - cock * 0.22],
    ];
    pts = resample(pts, nP);
    sections.push({ z, pts });
  }
  const matOf = (z, f, x, y, cap) => {
    if (cap) return 'carbon';
    const ring = Math.abs(f - 0.5) * 2;
    if (ring > 0.88) return 'carbon';
    if (z > -0.5 && z < 0.4 && ring < 0.25) return 'black'; // кокпит
    return 'paint';
  };
  const body = loftSym(sections, matOf);
  return { geo: body, zf, zr, yt, hw, yb };
}

function f1Details(spec, B, lod) {
  const P = [];
  const { zf, zr } = B;
  const tw = spec.dims.track / 2;
  if (lod === 2) {
    P.push(bx('carbon', 1.9, 0.04, 0.4, 0, 0.12, 2.55), bx('carbon', 1.0, 0.05, 0.35, 0, 0.92, -2.55), bx('paint', 1.4, 0.4, 1.6, 0, 0.32, -0.3), bx('rainlight', 0.12, 0.08, 0.04, 0, 0.45, -2.45));
    return P;
  }
  // понтоны (sidepods) с подрезом и воздухозаборниками
  const nS = lod === 0 ? 24 : 10;
  const pod = [];
  for (let k = 0; k < nS; k++) {
    const z = -1.3 + (1.75 * k) / (nS - 1);
    const t = (z + 1.3) / 1.75;
    const w = lerp(0.34, 0.72, smooth(0, 0.6, t));
    const h = lerp(0.36, 0.56, smooth(0, 0.75, t)) * lerp(1, 0.9, smooth(0.9, 1, t));
    const under = lerp(0.12, 0.2, smooth(0.4, 1, t));
    pod.push({ z, pts: resample([[0.2, under], [w * 0.92, under], [w, (under + h) * 0.45], [w * 0.95, h * 0.95], [w * 0.6, h], [0.25, h * 0.9]], lod === 0 ? 10 : 6) });
  }
  // половинка понтона (не симметричный лофт — правый борт), затем зеркало
  const podGeo = loftSym(pod.map((s) => ({ z: s.z, pts: [[0, s.pts[0][1]], ...s.pts, [0, s.pts[s.pts.length - 1][1]]] })), (z, f, x, y, cap) => (cap && z > 0 ? 'black' : 'paint'));
  P.push(part(podGeo, 'paint'));
  // днище с крылышками, диффузор
  P.push(bx('carbon', 1.42, 0.03, 3.4, 0, 0.06, -0.45));
  P.push(...both(bx('carbon', 0.04, 0.12, 2.6, 0.71, 0.1, -0.45)));
  for (const x of [-0.45, -0.15, 0.15, 0.45]) P.push(bx('carbon', 0.02, 0.24, 0.5, x, 0.18, -2.3, -0.45));
  P.push(bx('carbon', 1.0, 0.02, 0.55, 0, 0.2, -2.3, -0.45));
  // переднее антикрыло: основной элемент + закрылки + торцы, пилоны к носу
  P.push(wing('carbon', 1.95, 0.32, 0.1, 0, 0.1, 2.58, 0.05));
  if (lod === 0) {
    P.push(wing('accent', 1.7, 0.18, 0.1, 0, 0.17, 2.48, -0.3));
    P.push(wing('carbon', 1.55, 0.13, 0.1, 0, 0.24, 2.4, -0.55));
  }
  P.push(...both(bx('accent', 0.03, 0.28, 0.62, 0.98, 0.2, 2.52)));
  P.push(...both(bx('carbon', 0.02, 0.12, 0.3, 0.22, 0.17, 2.55)));
  // заднее антикрыло: основной + DRS-закрылок, торцы, пилон, балка
  P.push(wing('carbon', 1.0, 0.3, 0.12, 0, 0.84, -2.55, -0.12));
  P.push(wing('paint', 1.0, 0.2, 0.1, 0, 0.98, -2.66, -0.6));
  P.push(...both(bx('accent', 0.025, 0.66, 0.72, 0.51, 0.8, -2.56)));
  P.push(bx('carbon', 0.05, 0.45, 0.12, 0, 0.6, -2.45, 0.2));
  if (lod === 0) P.push(wing('carbon', 0.8, 0.16, 0.12, 0, 0.42, -2.42, -0.2));
  // плавник, воздухозаборник над головой, halo, зеркала
  P.push(bx('paint', 0.025, 0.24, 1.0, 0, 0.92, -1.35, 0.12));
  P.push(bx('black', 0.22, 0.2, 0.08, 0, 1.0, -0.42));
  if (lod === 0) {
    const halo = new THREE.TorusGeometry(0.33, 0.028, 8, 22, Math.PI);
    halo.rotateX(Math.PI / 2);
    halo.translate(0, 0.94, -0.12);
    P.push(part(halo, 'carbon'));
    P.push(tube('carbon', [0, 0.72, 0.42], [0, 0.94, 0.21], 0.032));
    P.push(tube('carbon', [0.33, 0.78, -0.2], [0.33, 0.94, -0.12], 0.026), tube('carbon', [-0.33, 0.78, -0.2], [-0.33, 0.94, -0.12], 0.026));
    for (const s of [1, -1]) {
      P.push(tube('carbon', [s * 0.42, 0.62, 0.16], [s * 0.56, 0.76, 0.2], 0.012));
      P.push(bx('paint', 0.15, 0.06, 0.06, s * 0.58, 0.79, 0.2));
    }
    const helm = new THREE.SphereGeometry(0.15, 16, 12);
    helm.translate(0, 0.84, -0.2);
    P.push(part(helm, 'helmet'));
    P.push(cyl('black', 0.13, 0.13, 0.02, 12, 0, 0.72, 0.12, 'z'));
  }
  // подвеска: рычаги к ступицам (передние и задние)
  const xs = tw - 0.12;
  for (const s of [1, -1]) {
    P.push(tube('carbon', [s * 0.28, 0.44, zf + 0.25], [s * xs, 0.46, zf], 0.022), tube('carbon', [s * 0.28, 0.44, zf - 0.3], [s * xs, 0.46, zf], 0.022));
    P.push(tube('carbon', [s * 0.3, 0.2, zf + 0.25], [s * xs, 0.25, zf], 0.022), tube('carbon', [s * 0.3, 0.2, zf - 0.3], [s * xs, 0.25, zf], 0.022));
    P.push(tube('carbon', [s * 0.4, 0.5, zr + 0.3], [s * xs, 0.5, zr], 0.022), tube('carbon', [s * 0.4, 0.24, zr + 0.3], [s * xs, 0.26, zr], 0.022));
    if (lod === 0) P.push(tube('carbon', [s * 0.3, 0.6, zf - 0.1], [s * xs, 0.28, zf], 0.016));
  }
  // дождевой огонь и задние фонари
  P.push(bx('rainlight', 0.12, 0.08, 0.035, 0, 0.44, -2.5));
  P.push(...both(bx('taillight', 0.04, 0.3, 0.02, 0.52, 0.8, -2.93 + 0.0)));
  P.push(bx('headlight', 0.01, 0.01, 0.01, 0, 0.2, 2.7));
  return P;
}

// ===================================================================================
// Сборка: группа car с уровнями LOD0..LOD2.
// ===================================================================================
export function makePlaceholderMaterials() {
  const m = {};
  const pbr = {
    paint: [0xd81e2a, 0.3, 0.3],
    carbon: [0x15171a, 0.35, 0.35],
    glass: [0x0a0e14, 0.05, 0.2],
    black: [0x0c0d10, 0.6, 0.1],
    chrome: [0xe0e0e0, 0.1, 1],
    rubber: [0x161616, 0.85, 0],
    rim: [0x9aa1aa, 0.3, 0.8],
    disc: [0x5b5f66, 0.4, 0.8],
    caliper: [0xd4202a, 0.35, 0.2],
    headlight: [0xffffff, 0.1, 0],
    taillight: [0xff1010, 0.2, 0],
    rainlight: [0xff1010, 0.2, 0],
    interior: [0x22252a, 0.8, 0.1],
    helmet: [0xffffff, 0.2, 0.1],
    accent: [0x111111, 0.3, 0.4],
    grille: [0x08090b, 0.7, 0.2],
  };
  for (const name of MAT) {
    const [c, r, mt] = pbr[name];
    m[name] = new THREE.MeshStandardMaterial({ name, color: c, roughness: r, metalness: mt });
  }
  return m;
}

// Объединить детали одного материала в один меш (меньше draw calls).
function meshesByMat(parts, mats) {
  const by = new Map();
  for (const g of parts) {
    const k = g.userData.mat;
    if (!by.has(k)) by.set(k, []);
    const ni = g.index ? g.toNonIndexed() : g;
    for (const a of Object.keys(ni.attributes)) if (!['position', 'normal', 'uv'].includes(a)) ni.deleteAttribute(a);
    if (!ni.attributes.uv) ni.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ni.attributes.position.count * 2), 2));
    if (!ni.attributes.normal) ni.computeVertexNormals();
    by.get(k).push(ni);
  }
  const out = [];
  for (const [k, list] of by) {
    const g = mergeGeometries(list);
    const mesh = new THREE.Mesh(g, mats[k]);
    mesh.name = k;
    out.push(mesh);
  }
  return out;
}

function lodGroup(spec, lod, mats) {
  const f1 = spec.id === 'f1';
  const g = new THREE.Group();
  g.name = 'LOD' + lod;
  const B = f1 ? f1Body(spec, lod) : gt3Body(spec, lod);
  // кузов: мультиматериальный меш с группами
  const body = new THREE.Mesh(B.geo, B.geo.userData.mats.map((n) => mats[n]));
  body.name = 'body';
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'chassis';
  bodyGroup.add(body);
  for (const m of meshesByMat(f1 ? f1Details(spec, B, lod) : gt3Details(spec, B, lod), mats)) bodyGroup.add(m);
  g.add(bodyGroup);
  // колёса
  const cz = spec.dims.cgZ ?? 0;
  const a = spec.wheelbase * (1 - spec.weightFront), b = spec.wheelbase * spec.weightFront;
  const R = spec.dims.wheelR;
  const Wf = f1 ? spec.dims.wheelW * 0.8 : spec.dims.wheelW, Wr = spec.dims.wheelW;
  for (const [name, z, x, W] of [
    ['FL', cz + a, spec.dims.track / 2, Wf],
    ['FR', cz + a, -spec.dims.track / 2, Wf],
    ['RL', cz - b, spec.dims.track / 2, Wr],
    ['RR', cz - b, -spec.dims.track / 2, Wr],
  ]) {
    const { spin, fixed } = wheelParts(R, W, { lod, spokes: f1 ? 6 : 5, rimR: f1 ? 0.64 : 0.68, f1 });
    const pivot = new THREE.Group();
    pivot.name = 'steer_' + name;
    pivot.position.set(x, R, z);
    const wheel = new THREE.Group();
    wheel.name = 'wheel_' + name;
    for (const m of meshesByMat(spin, mats)) wheel.add(m);
    // диск наружу: для правых колёс зеркалим по x
    if (x < 0) wheel.scale.x = -1;
    pivot.add(wheel);
    for (const m of meshesByMat(fixed, mats)) {
      if (x < 0) m.scale.x = -1;
      pivot.add(m);
    }
    g.add(pivot);
  }
  return g;
}

// Сцена машины: car → LOD0, LOD1, LOD2.
export function buildCarScene(spec, mats = makePlaceholderMaterials()) {
  const root = new THREE.Group();
  root.name = 'car-' + spec.id;
  for (const lod of [0, 1, 2]) root.add(lodGroup(spec, lod, mats));
  return root;
}

// Треугольники в группе (для проверки бюджета LOD).
export function countTriangles(obj) {
  let t = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    t += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(t);
}
