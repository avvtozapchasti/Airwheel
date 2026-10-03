// Пит-лейн: полотно с разметкой (полосы, линии 60 км/ч, боксы), стенка с сеткой между трассой
// и пит-лейном, боксы команд под навесом (один InstancedMesh на все модули), светофор выезда,
// механики (инстансинг) — во время пит-стопа выбегают к машине, домкраты, смена колёс.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Geo, strip, edgeY, roadQuad, decalMaterial } from './trackMesh.js';
import * as TX from './textures.js';
import { patchWet } from './rain.js';

const CREW = 6; // механиков на бокс
const up = new THREE.Vector3(0, 1, 0);

// Модуль бокса (локально: x — вдоль трассы, z — от пит-лейна вглубь, y — вверх; фасад при z = 0).
function garageModule(w, depth, h) {
  const parts = [];
  const add = (g, x, y, z) => {
    g.translate(x, y, z);
    parts.push(g);
  };
  add(new THREE.BoxGeometry(w, 0.4, depth + 3.2), 0, h, depth / 2 - 1.6); // крыша + навес над рабочей полосой
  add(new THREE.BoxGeometry(0.5, h, depth), -w / 2 + 0.25, h / 2, depth / 2); // простенок
  add(new THREE.BoxGeometry(w, h, 0.4), 0, h / 2, depth); // задняя стена
  add(new THREE.BoxGeometry(w, h - 4.2, 0.3), 0, 4.2 + (h - 4.2) / 2, 0.15); // над воротами
  add(new THREE.BoxGeometry(0.18, 0.18, 3.2), -w / 2 + 0.3, h - 0.3, -1.6); // стойки навеса
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return g;
}

function crewGeo() {
  const body = new THREE.CylinderGeometry(0.2, 0.22, 1.05, 8);
  body.translate(0, 0.95, 0);
  const legs = new THREE.CylinderGeometry(0.17, 0.15, 0.5, 6);
  legs.translate(0, 0.25, 0);
  const head = new THREE.SphereGeometry(0.17, 10, 8);
  head.translate(0, 1.66, 0);
  const g = mergeGeometries([body.toNonIndexed(), legs.toNonIndexed(), head.toNonIndexed()]);
  [body, legs, head].forEach((x) => x.dispose());
  return g;
}

export function buildPitLane(track, env = {}) {
  const L = track.pit;
  const group = new THREE.Group();
  group.name = 'pitlane';
  const side = L.side;
  const ds = track.ds;
  const i0 = track.index(L.sIn);
  const count = Math.round(L.len / ds);
  const night = env.time === 'night';
  const outer = L.outerD();

  // --- полотно пит-лейна ---
  const road = new Geo();
  strip(road, track, i0, count, (i) => (side > 0 ? [track.hw[i] + outer + 0.4, track.hw[i] - 0.05] : [-track.hw[i] + 0.05, -track.hw[i] - outer - 0.4]), {
    y: (i, d) => edgeY(track, i, d) + 0.004,
    u: (c) => c * 1.5,
    vLen: 14,
  });
  const asph = TX.asphalt({ lines: false });
  const roadMat = new THREE.MeshStandardMaterial({ map: asph.map, normalMap: asph.normalMap, roughnessMap: asph.roughnessMap, color: 0xb9bcc2, roughness: 1, normalScale: new THREE.Vector2(0.3, 0.3), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  roadMat.userData.road = true;
  patchWet(roadMat);
  const roadMesh = new THREE.Mesh(road.build(), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // --- разметка ---
  const at = (u) => L.sIn + u;
  const lines = [];
  const sd = (x) => side * x;
  const hw0 = track.hw[track.index(at(L.len / 2))];
  const inner = hw0 + L.gap + 0.3; // край пит-лейна у стенки
  const split = inner + 6; // граница быстрой и рабочей полос
  // сплошная у стенки и прерывистая между полосами
  lines.push(roadQuad(track, at(L.wallA), at(L.wallB), sd(inner + 0.25), sd(inner + 0.1), 0.03));
  for (let u = L.limA; u < L.limB; u += 6) lines.push(roadQuad(track, at(u), at(u + 3), sd(split + 0.08), sd(split - 0.08), 0.03));
  // линии ограничения скорости
  for (const u of [L.limA, L.limB]) lines.push(roadQuad(track, at(u - 0.25), at(u + 0.25), sd(inner + 12.2), sd(inner), 0.03));
  // разделительные «клинья» на въезде и выезде
  for (let k = 0; k < 10; k++) {
    const u = (L.wallA * k) / 10, u2 = L.len - L.wallA * 0.85 * (k / 10);
    const d = hw0 + 0.2 + (L.gap - 0.2) * (k / 10);
    lines.push(roadQuad(track, at(u), at(u + L.wallA / 10), sd(d + 0.15), sd(d), 0.03));
    lines.push(roadQuad(track, at(u2 - L.wallA * 0.085), at(u2), sd(d + 0.15), sd(d), 0.03));
  }
  // разметка боксов
  for (let k = 0; k < L.boxCount; k++) {
    const b = L.boxRel(k), w0 = split + 0.6, w1 = inner + 11.6;
    lines.push(roadQuad(track, at(b - 3.2), at(b - 3), sd(w1), sd(w0), 0.03));
    lines.push(roadQuad(track, at(b + 3), at(b + 3.2), sd(w1), sd(w0), 0.03));
  }
  const lineMesh = new THREE.Mesh(mergeGeometries(lines), decalMaterial({ color: 0xf0f0f0, roughness: 0.6 }));
  lines.forEach((g) => g.dispose());
  group.add(lineMesh);
  // «60» и PIT на асфальте
  const words = [
    ['60', L.limA - 9, 0xffffff, '#d42020'],
    ['60', L.limB + 5, 0xffffff, '#d42020'],
    ['PIT', L.wallA * 0.45, 0xffffff, '#1b1f2a'],
  ];
  for (const [txt, u, , bg] of words) {
    const tex = TX.board(txt, { bg, fg: '#ffffff', w: 256, h: 128 });
    const q = roadQuad(track, at(u - 2.2), at(u + 2.2), sd(inner + 5.2), sd(inner + 0.8), 0.035);
    group.add(new THREE.Mesh(q, decalMaterial({ map: tex, transparent: false })));
  }

  // --- стенка пит-лейна (бетон + сетка) ---
  const wg = new Geo();
  const iA = track.index(at(L.wallA)), nW = Math.round((L.wallB - L.wallA) / ds);
  const wd = (i) => side * (track.hw[i] + L.gap);
  const base = (i) => edgeY(track, i, wd(i)) - 0.1;
  for (const off of [-0.3, 0.3]) strip(wg, track, iA, nW, (i) => [wd(i) + side * off, wd(i) + side * off], { y: (i, d, c) => base(i) + (c === 0 ? 0 : 1.15), u: (c) => c, vLen: 6 });
  strip(wg, track, iA, nW, (i) => [wd(i) - side * 0.3, wd(i) + side * 0.3], { y: (i) => base(i) + 1.15, u: (c) => 0.9 + c * 0.1, vLen: 6 });
  const wallMesh = new THREE.Mesh(wg.build(), new THREE.MeshStandardMaterial({ map: TX.concreteWall(), roughness: 0.85, side: THREE.DoubleSide }));
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const fg = new Geo();
  strip(fg, track, iA, nW, (i) => [wd(i), wd(i)], { y: (i, d, c) => base(i) + 1.15 + (c === 0 ? 0 : 2.4), u: (c) => c, vLen: 3 });
  group.add(new THREE.Mesh(fg.build(), new THREE.MeshStandardMaterial({ map: TX.fence(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 })));

  // --- боксы под навесом ---
  const W = L.boxStep, DEPTH = 11, H = 6.2;
  const n = L.boxCount + 2; // по крайнему пустому модулю с каждой стороны
  const mod = new THREE.InstancedMesh(garageModule(W, DEPTH, H), new THREE.MeshStandardMaterial({ color: 0xd9dde4, roughness: 0.55, metalness: 0.25 }), n);
  const interiorGeo = new THREE.PlaneGeometry(W - 0.6, 4.1);
  interiorGeo.rotateY(Math.PI); // лицом к пит-лейну
  interiorGeo.translate(0, 2.05, 0.6);
  const interior = new THREE.InstancedMesh(interiorGeo, new THREE.MeshStandardMaterial({ color: 0x20242c, emissive: 0xfff1d6, emissiveIntensity: night ? 0.55 : 0.22, roughness: 0.9 }), n);
  const panelGeo = new THREE.PlaneGeometry(W - 0.4, 1.4);
  panelGeo.rotateY(Math.PI);
  panelGeo.translate(0, H - 1.1, -0.02);
  const panels = new THREE.InstancedMesh(panelGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: night ? 0.45 : 0.12, roughness: 0.4 }), n);
  const stripGeo = new THREE.BoxGeometry(W - 1, 0.08, 0.3);
  stripGeo.translate(0, H - 0.25, -2.6);
  const lightStrips = new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3dd).multiplyScalar(night ? 2.6 : 1.4), toneMapped: false }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const frames = [];
  for (let k = -1; k <= L.boxCount; k++) {
    const u = L.boxRel(Math.max(0, Math.min(L.boxCount - 1, k))) + (k < 0 ? -W : k >= L.boxCount ? W : 0);
    const s = at(u);
    const i = track.index(s);
    const pt = track.pointAt(s, side * (track.hw[i] + outer + 0.4));
    const h = track.headingAt(s);
    // локальный x — вдоль трассы, z — вглубь (от пит-лейна)
    q.setFromAxisAngle(up, h + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
    m.compose(p.set(pt.x, edgeY(track, i, side * track.hw[i]) - 0.05, pt.z), q, one);
    frames.push({ m: m.clone(), s, k });
  }
  frames.forEach((f, j) => {
    mod.setMatrixAt(j, f.m);
    interior.setMatrixAt(j, f.m);
    panels.setMatrixAt(j, f.m);
    lightStrips.setMatrixAt(j, f.m);
    panels.setColorAt(j, new THREE.Color(0x30343c));
  });
  for (const im of [mod, interior, panels, lightStrips]) {
    im.computeBoundingSphere();
    group.add(im);
  }
  mod.castShadow = true;
  mod.receiveShadow = true;
  // табличка «ТЫ» над боксом игрока
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.1), new THREE.MeshBasicMaterial({ map: TX.board('ТЫ', { bg: '#ffcc33', fg: '#1a1400', w: 256, h: 96 }), toneMapped: false }));
  sign.visible = false;
  group.add(sign);

  // --- светофор выезда ---
  const lu = L.limB + 2;
  const ls = at(lu), li = track.index(ls);
  const lp = track.pointAt(ls, side * (track.hw[li] + L.gap));
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 }));
  pole.position.set(lp.x, edgeY(track, li, side * track.hw[li]) + 2.75, lp.z);
  group.add(pole);
  const lampMat = [new THREE.MeshBasicMaterial({ color: 0x220404, toneMapped: false }), new THREE.MeshBasicMaterial({ color: 0x043004, toneMapped: false })];
  const lamps = lampMat.map((mat, k) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
    l.position.set(lp.x, pole.position.y + 1.45 - k * 0.38, lp.z);
    group.add(l);
    return l;
  });

  // --- механики ---
  const crew = new THREE.InstancedMesh(crewGeo(), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }), CREW * L.boxCount);
  crew.castShadow = true;
  const crewHome = [];
  for (let k = 0; k < L.boxCount; k++) {
    for (let c = 0; c < CREW; c++) {
      const u = L.boxRel(k) - 3 + (c % 3) * 3;
      const dd = inner + 12.6 + Math.floor(c / 3) * 0.9;
      crewHome.push({ u, d: side * dd });
    }
  }
  const crewState = crewHome.map((h) => ({ ...h, cu: h.u, cd: h.d }));
  const col = new THREE.Color();
  const setCrewColors = (colors = []) => {
    for (let k = 0; k < L.boxCount; k++) for (let c = 0; c < CREW; c++) crew.setColorAt(k * CREW + c, col.set(colors[k] || '#3a4150'));
    if (crew.instanceColor) crew.instanceColor.needsUpdate = true;
  };
  setCrewColors();
  group.add(crew);

  const lights = frames.filter((_, j) => j % 3 === 1).map((f) => {
    const i = track.index(f.s);
    const pt = track.pointAt(f.s, side * (track.hw[i] + outer - 2.2));
    return { x: pt.x, y: edgeY(track, i, side * track.hw[i]) + H - 0.6, z: pt.z, s: f.s, color: 0xfff1dd, power: 0.8 };
  });

  // работа механика c у машины: колёса и домкраты (локально относительно бокса)
  const SERVICE = [
    [-1.6, 1.3],
    [1.6, 1.3],
    [-1.6, -1.3],
    [1.6, -1.3],
    [3.2, 0],
    [-3.2, 0],
  ];

  return {
    group,
    lights,
    // Цвета команд по боксам и бокс игрока.
    setBoxes(colors, playerBox) {
      for (let k = 0; k < L.boxCount; k++) panels.setColorAt(k + 1, col.set(colors[k] || '#30343c'));
      panels.instanceColor.needsUpdate = true;
      setCrewColors(colors);
      const f = frames[playerBox + 1];
      if (f) {
        const i = track.index(f.s);
        const pt = track.pointAt(f.s, side * (track.hw[i] + outer + 0.2));
        sign.position.set(pt.x, edgeY(track, i, side * track.hw[i]) + H + 1.1, pt.z);
        sign.rotation.set(0, track.headingAt(f.s) + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
        sign.visible = true;
      }
    },
    // service: [{box, active}] — где сейчас идёт пит-стоп; red — красный на выезде.
    update(dt, { service = [], red = false } = {}) {
      lampMat[0].color.set(red ? new THREE.Color(5, 0.2, 0.1) : 0x220404);
      lampMat[1].color.set(red ? 0x043004 : new THREE.Color(0.2, 4, 0.4));
      const busy = new Map(service.filter((x) => x.active).map((x) => [x.box, x]));
      const k = Math.min(1, dt * 6);
      for (let b = 0; b < L.boxCount; b++) {
        const sv = busy.get(b);
        for (let c = 0; c < CREW; c++) {
          const st = crewState[b * CREW + c];
          let tu = st.u, td = st.d;
          if (sv) {
            const [lu2, ld] = SERVICE[c];
            tu = L.boxRel(b) + lu2;
            td = side * L.workD(at(L.boxRel(b))) + side * ld;
          }
          st.cu += (tu - st.cu) * k;
          st.cd += (td - st.cd) * k;
          const s = at(st.cu);
          const i = track.index(s);
          const pt = track.pointAt(s, st.cd);
          const bob = sv ? Math.abs(Math.sin(performance.now() / 90 + c)) * 0.05 : 0;
          q.setFromAxisAngle(up, track.headingAt(s) + (sv ? (SERVICE[c][1] > 0 ? -1 : 1) * side * Math.PI * 0.5 : side > 0 ? -Math.PI / 2 : Math.PI / 2));
          m.compose(p.set(pt.x, edgeY(track, i, side * track.hw[i]) + bob, pt.z), q, one);
          crew.setMatrixAt(b * CREW + c, m);
        }
      }
      crew.instanceMatrix.needsUpdate = true;
      crew.computeBoundingSphere();
    },
  };
}
