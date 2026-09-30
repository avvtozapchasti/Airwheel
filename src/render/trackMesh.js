// Геометрия трассы из выборки сплайна: дорога с UV, поребрики, ограждения/стены, старт-финиш
// с порталом и огнями, стартовая решётка, тормозные таблички 100/50 м, DRS, трибуны.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const ROAD_COLS = 8; // поперечных делений дороги

// Сборщик геометрии: вершины + UV (+ цвета) + индексы.
class Geo {
  constructor(colors = false) {
    this.pos = [];
    this.uv = [];
    this.col = colors ? [] : null;
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  v(x, y, z, u, w, c) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    if (this.col) this.col.push(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1);
    return this.count - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Полоса вдоль трассы по выборкам [i0, i0+count] (count = n — замкнутое кольцо).
// offs(i) → смещения d слева направо (по убыванию d); y(i, d, c) → высота; u(c) → координата u.
// vLen — метров на один повтор текстуры вдоль.
function strip(geo, track, i0, count, offs, { y, u, vLen = 10, color = null }) {
  const closed = count >= track.n;
  const rows = closed ? track.n + 1 : count + 1;
  const reps = closed ? Math.max(1, Math.round(track.length / vLen)) : 0;
  const base = geo.count;
  let cols = 0;
  for (let r = 0; r < rows; r++) {
    const i = track.wrap(i0 + r);
    const ds = offs(i);
    cols = ds.length;
    const vv = closed ? (r / track.n) * reps : (r * track.ds) / vLen;
    for (let c = 0; c < cols; c++) {
      const d = ds[c];
      geo.v(track.x[i] + track.nx[i] * d, y(i, d, c), track.z[i] + track.nz[i] * d, u(c, cols), vv, color?.(i, d, c));
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = base + r * cols + c, b = a + cols;
      geo.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

// Отрезки подряд идущих выборок, где pred(i) истинно: [[i0, count], ...].
function runs(track, pred) {
  const n = track.n;
  const out = [];
  let start = -1;
  // начинаем с места, где условие ложно, чтобы не разрезать отрезок через шов
  let s0 = 0;
  while (s0 < n && pred(s0)) s0++;
  if (s0 === n) return [[0, n]];
  for (let k = 0; k <= n; k++) {
    const i = (s0 + k) % n;
    const on = k < n && pred(i);
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      out.push([(s0 + start) % n, k - start]);
      start = -1;
    }
  }
  return out;
}

// Высота «продолжения» дороги за краем (зоны вылета ровные, на уровне кромки).
const edgeY = (track, i, d) => track.heightAt(i, 0, Math.max(-track.hw[i], Math.min(track.hw[i], d)));

export function buildRoad(track, { wet = false, rubber = null } = {}) {
  const tex = TX.asphalt({ wet });
  const geo = new Geo(true);
  strip(
    geo,
    track,
    0,
    track.n,
    (i) => {
      const hw = track.hw[i];
      const out = [];
      for (let c = 0; c <= ROAD_COLS; c++) out.push(hw - (2 * hw * c) / ROAD_COLS);
      return out;
    },
    {
      y: (i, d) => track.heightAt(i, 0, d),
      u: (c, n) => c / (n - 1),
      vLen: 16,
      // «резина» на траектории — темнее
      color: (i, d) => {
        if (!rubber) return [1, 1, 1];
        const k = Math.exp(-((d - rubber[i]) ** 2) / 3.5);
        const v = 1 - 0.28 * k;
        return [v, v, v];
      },
    },
  );
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    roughnessMap: tex.roughnessMap,
    vertexColors: true,
    roughness: wet ? 0.35 : 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: wet ? 1.6 : 0.3,
  });
  const mesh = new THREE.Mesh(geo.build(), mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

function buildKerbs(track) {
  const geo = new Geo();
  const on = (i) => track.kerb[i] > 0;
  for (const [i0, count] of runs(track, on)) {
    for (const side of [1, -1]) {
      strip(
        geo,
        track,
        i0,
        count,
        (i) => {
          const hw = track.hw[i], kw = track.kerb[i] || 1.2;
          return side > 0 ? [hw + kw, hw + kw * 0.5, hw] : [-hw, -hw - kw * 0.5, -hw - kw];
        },
        {
          y: (i, d) => edgeY(track, i, d) + (Math.abs(d) <= track.hw[i] + 0.01 ? 0.012 : Math.abs(d) >= track.hw[i] + (track.kerb[i] || 1.2) - 0.01 ? 0.03 : 0.06),
          u: (c, n) => c / (n - 1),
          vLen: 4,
        },
      );
    }
  }
  const mat = new THREE.MeshStandardMaterial({ map: TX.kerb(), roughness: 0.7, envMapIntensity: 0.4 });
  const mesh = new THREE.Mesh(geo.build(), mat);
  mesh.receiveShadow = true;
  mesh.name = 'kerbs';
  return mesh;
}

// Ограждения: armco (металл), бетон (городская), с верхней гранью и сеткой для бетонных.
function buildWalls(track, kind) {
  const group = new THREE.Group();
  group.name = 'walls';
  const concrete = kind === 'concrete';
  const H = concrete ? 1.15 : 0.8;
  const geo = new Geo();
  for (const side of [1, -1]) {
    const wd = (i) => (side > 0 ? track.wallL[i] : -track.wallR[i]);
    const base = (i) => edgeY(track, i, wd(i)) - 0.25;
    if (concrete) {
      // внутренняя грань, верх, внешняя грань (толщина 0.5 м)
      const th = 0.5 * side;
      strip(geo, track, 0, track.n, (i) => (side > 0 ? [wd(i), wd(i)] : [wd(i), wd(i)]), {
        y: (i, d, c) => (side > 0 ? (c === 0 ? base(i) + H + 0.25 : base(i)) : c === 0 ? base(i) : base(i) + H + 0.25),
        u: (c) => c,
        vLen: 6,
      });
      strip(geo, track, 0, track.n, (i) => (side > 0 ? [wd(i) + th, wd(i)] : [wd(i), wd(i) + th]), {
        y: (i) => base(i) + H + 0.25,
        u: (c) => c * 0.1,
        vLen: 6,
      });
    } else {
      strip(geo, track, 0, track.n, (i) => [wd(i), wd(i)], {
        y: (i, d, c) => (c === 0 ? base(i) : base(i) + H + 0.25),
        u: (c) => c,
        vLen: 4,
      });
    }
  }
  const tex = concrete ? TX.concreteWall() : TX.armco();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: concrete ? 0.85 : 0.35,
    metalness: concrete ? 0 : 0.55,
    side: THREE.DoubleSide,
    envMapIntensity: concrete ? 0.3 : 0.9,
  });
  const walls = new THREE.Mesh(geo.build(), mat);
  walls.receiveShadow = true;
  walls.castShadow = false;
  group.add(walls);

  if (!concrete) {
    // стойки armco — один InstancedMesh
    const step = Math.max(1, Math.round(4 / track.ds));
    const cnt = Math.ceil(track.n / step) * 2;
    const post = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    post.translate(0, 0.25, 0);
    const posts = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.5, roughness: 0.5 }), cnt);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < track.n; i += step) {
      for (const side of [1, -1]) {
        const d = side > 0 ? track.wallL[i] + 0.1 : -track.wallR[i] - 0.1;
        m.makeTranslation(track.x[i] + track.nx[i] * d, edgeY(track, i, d) - 0.3, track.z[i] + track.nz[i] * d);
        posts.setMatrixAt(k++, m);
      }
    }
    posts.count = k;
    posts.computeBoundingSphere();
    group.add(posts);
  } else {
    // сетка-забор над бетонной стеной
    const fg = new Geo();
    for (const side of [1, -1]) {
      const wd = (i) => (side > 0 ? track.wallL[i] + 0.25 : -track.wallR[i] - 0.25);
      strip(fg, track, 0, track.n, (i) => [wd(i), wd(i)], {
        y: (i, d, c) => edgeY(track, i, wd(i)) + H + (c === 0 ? 0 : 2.6),
        u: (c) => c,
        vLen: 3,
      });
    }
    const fence = new THREE.Mesh(
      fg.build(),
      new THREE.MeshStandardMaterial({ map: TX.fence(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }),
    );
    fence.name = 'fence';
    group.add(fence);
  }
  return group;
}

// Плоский прямоугольник на дороге между s0 и s1, по d от dL до dR (dL > dR).
function roadQuad(track, s0, s1, dL, dR, lift = 0.02) {
  const g = new Geo();
  const pts = [
    [s0, dL],
    [s0, dR],
    [s1, dL],
    [s1, dR],
  ].map(([s, d]) => track.pointAt(s, d));
  g.v(pts[0].x, pts[0].y + lift, pts[0].z, 0, 0);
  g.v(pts[1].x, pts[1].y + lift, pts[1].z, 1, 0);
  g.v(pts[2].x, pts[2].y + lift, pts[2].z, 0, 1);
  g.v(pts[3].x, pts[3].y + lift, pts[3].z, 1, 1);
  g.idx.push(0, 1, 2, 1, 3, 2);
  return g.build();
}

function decalMaterial(opts) {
  return new THREE.MeshStandardMaterial({
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...opts,
  });
}

// Старт-финиш: клетчатая линия, портал с огнями и баннером, разметка решётки.
function buildStart(track, name) {
  const group = new THREE.Group();
  group.name = 'start';
  const hw0 = track.hw[0];
  const line = new THREE.Mesh(roadQuad(track, -0.6, 0.6, hw0, -hw0, 0.025), decalMaterial({ map: TX.checker() }));
  line.receiveShadow = true;
  group.add(line);

  // разметка решётки
  const parts = [];
  for (let k = 0; k < 12; k++) {
    const { s, d } = track.gridSlot(k);
    const f = s + 2.9;
    parts.push(roadQuad(track, f - 0.15, f + 0.15, d + 1.35, d - 1.35, 0.022));
    parts.push(roadQuad(track, f - 1.3, f, d + 1.35, d + 1.15, 0.022));
    parts.push(roadQuad(track, f - 1.3, f, d - 1.15, d - 1.35, 0.022));
  }
  const grid = new THREE.Mesh(mergeGeometries(parts), decalMaterial({ color: 0xf2f2f2 }));
  grid.receiveShadow = true;
  group.add(grid);
  parts.forEach((p) => p.dispose());

  // портал: две опоры, балка, панель огней, баннер
  const p = track.pointAt(0, 0);
  const th = track.heading[0];
  const portal = new THREE.Group();
  portal.position.set(p.x, p.y, p.z);
  portal.rotation.y = th;
  const span = hw0 + 1.4;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.4 });
  const pillarGeo = new THREE.BoxGeometry(0.7, 8, 0.7);
  for (const sx of [span, -span]) {
    const pl = new THREE.Mesh(pillarGeo, metal);
    pl.position.set(sx, 4, 0);
    pl.castShadow = true;
    portal.add(pl);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 1.3, 0.8), metal);
  beam.position.set(0, 7.4, 0);
  beam.castShadow = true;
  portal.add(beam);
  const banner = TX.board(`AIRWHEEL · ${name.toUpperCase()}`, { bg: '#0b0f1a', fg: '#ffcc33', w: 1024, h: 96 });
  for (const sz of [0.41, -0.41]) {
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 1, 1.0), new THREE.MeshStandardMaterial({ map: banner, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.25 }));
    bn.position.set(0, 7.4, sz);
    if (sz < 0) bn.rotation.y = Math.PI;
    portal.add(bn);
  }
  // огни: 5 колонок × 2 ряда, смотрят навстречу машинам (−z портала)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 }));
  panel.position.set(0, 6.15, -0.45);
  portal.add(panel);
  const lampGeo = new THREE.CircleGeometry(0.22, 14);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 10);
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4().makeRotationY(Math.PI);
  for (let c = 0; c < 5; c++)
    for (let r = 0; r < 2; r++) {
      m.makeTranslation(-1.6 + c * 0.8, 6.4 - r * 0.5, -0.64).multiply(rot);
      lamps.setMatrixAt(c * 2 + r, m);
      lamps.setColorAt(c * 2 + r, new THREE.Color(0x220404));
    }
  portal.add(lamps);
  group.add(portal);

  const off = new THREE.Color(0x220404), red = new THREE.Color(6, 0.15, 0.1);
  group.userData.setLights = (n) => {
    for (let c = 0; c < 5; c++) for (let r = 0; r < 2; r++) lamps.setColorAt(c * 2 + r, c < n ? red : off);
    lamps.instanceColor.needsUpdate = true;
  };
  return group;
}

// Тормозные таблички 100/50 м перед поворотами (снаружи) и табличка DRS на главной прямой.
function buildBoards(track) {
  const group = new THREE.Group();
  group.name = 'boards';
  const sets = { 100: [], 50: [], DRS: [] };
  const posts = [];
  const place = (key, s, side) => {
    const i = track.index(s);
    const d = side * (track.hw[i] + track.kerb[i] + 2.2);
    const p = track.pointAt(s, d);
    const th = track.headingAt(s);
    const panel = new THREE.PlaneGeometry(1.3, 0.9);
    panel.rotateY(th + Math.PI);
    panel.translate(p.x, p.y + 1.55, p.z);
    sets[key].push(panel);
    const post = new THREE.BoxGeometry(0.1, 1.2, 0.1);
    post.translate(p.x, p.y + 0.6, p.z);
    posts.push(post);
  };
  for (const c of track.corners) {
    if (c.type === 'turn' && c.radius > 60) continue;
    const side = -c.dir; // снаружи поворота
    place(100, c.sEntry - 100, side);
    place(50, c.sEntry - 50, side);
  }
  place('DRS', 40, track.corners[0]?.dir ?? 1);
  for (const [key, arr] of Object.entries(sets)) {
    if (!arr.length) continue;
    const tex = TX.board(String(key), key === 'DRS' ? { bg: '#0d4fd6', fg: '#fff' } : { bg: '#fff', fg: '#111' });
    const mesh = new THREE.Mesh(mergeGeometries(arr), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05 }));
    group.add(mesh);
    arr.forEach((g) => g.dispose());
  }
  const pm = new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.4, roughness: 0.5 }));
  group.add(pm);
  posts.forEach((g) => g.dispose());
  return group;
}

// Трибуны: ступени со зрителями + крыша. Два InstancedMesh на все трибуны трассы.
function buildGrandstands(track, defs, heightAt) {
  const group = new THREE.Group();
  group.name = 'grandstands';
  const U = 24; // длина секции, м
  const mats = [];
  for (const g of defs || []) {
    const s0 = (((g.t - (track.tShift || 0)) % 1 + 1) % 1) * track.length;
    for (let k = 0; k < g.count; k++) {
      const s = s0 + (k - (g.count - 1) / 2) * (U + 2);
      const i = track.index(s);
      let side = g.side === 'left' ? 1 : g.side === 'right' ? -1 : 0;
      if (!side) {
        // «снаружи» ближайшего поворота
        side = -Math.sign(track.kappa[i]) || 1;
      }
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const p = track.pointAt(s, side * (wall + 5));
      const th = track.headingAt(s);
      const y = heightAt ? Math.min(heightAt(p.x, p.z), p.y) : p.y;
      const m = new THREE.Matrix4()
        .makeTranslation(p.x, y, p.z)
        .multiply(new THREE.Matrix4().makeRotationY(th + (side > 0 ? Math.PI / 2 : -Math.PI / 2)));
      mats.push(m);
    }
  }
  if (!mats.length) return group;
  // секция: 8 ступеней, уходящих назад (+z локально) и вверх
  const steps = [];
  for (let k = 0; k < 8; k++) {
    const b = new THREE.BoxGeometry(U, 0.55 + k * 0.55, 0.95);
    b.translate(0, (0.55 + k * 0.55) / 2, 0.5 + k * 0.95);
    steps.push(b);
  }
  const standGeo = mergeGeometries(steps);
  steps.forEach((b) => b.dispose());
  const roofParts = [new THREE.BoxGeometry(U + 1, 0.2, 9)];
  roofParts[0].rotateX(-0.12);
  roofParts[0].translate(0, 7.4, 4.2);
  for (const x of [-U / 2 + 0.3, 0, U / 2 - 0.3]) {
    const c = new THREE.BoxGeometry(0.3, 7.2, 0.3);
    c.translate(x, 3.6, 8.2);
    roofParts.push(c);
  }
  const roofGeo = mergeGeometries(roofParts);
  roofParts.forEach((b) => b.dispose());
  const crowd = TX.crowd();
  const stand = new THREE.InstancedMesh(standGeo, new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }), mats.length);
  const roof = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.5, metalness: 0.2 }), mats.length);
  mats.forEach((m, k) => {
    stand.setMatrixAt(k, m);
    roof.setMatrixAt(k, m);
  });
  stand.computeBoundingSphere();
  roof.computeBoundingSphere();
  stand.receiveShadow = roof.castShadow = true;
  group.add(stand, roof);
  return group;
}

// Вся трасса целиком. env — окружение трассы, heightAt — высота рельефа.
export function buildTrackGroup(track, env, { heightAt = null, rubber = null } = {}) {
  const group = new THREE.Group();
  group.name = 'track';
  group.add(buildRoad(track, { wet: !!env.wet, rubber }));
  group.add(buildKerbs(track));
  group.add(buildWalls(track, env.wall || 'armco'));
  const start = buildStart(track, track.name);
  group.add(start);
  group.add(buildBoards(track));
  group.add(buildGrandstands(track, track.def.grandstands, heightAt));
  group.userData.setStartLights = start.userData.setLights;
  return group;
}

// Освобождение GPU-ресурсов группы (при смене трассы). Текстуры из кэша живут дальше.
export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  group.removeFromParent();
}
