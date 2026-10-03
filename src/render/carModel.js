// Модели машин GT3 и F1: загрузка GLB (meshopt-сжатие, /models/cars/*.glb) с запасными путями —
// несжатый GLB, затем процедурная генерация в браузере (carGen.js, тот же облик).
// Материалы PBR: лак с clearcoat и ливреей (canvas: цвет, полосы, номер, спонсоры), карбон с
// normal map, стекло, резина, металлические диски, тормозные диски светятся при торможении,
// фары, задние фонари и стоп-сигналы, дождевой огонь F1. Три уровня детализации (THREE.LOD):
// рядом ~15k треугольников, дальше ~4k, вдали ~0.7k; дальние — без теней и normal map.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCarScene } from './carGen.js';
import * as TX from './textures.js';

// --- окраски: 8 палитр (выбор в меню), у ботов — их цвет + случайный стиль ---
export const LIVERIES = [
  { id: 'amber', name: 'Янтарь', base: '#ffb000', accent: '#121417', stripe: '#ffffff', num: '#121417' },
  { id: 'scarlet', name: 'Алый', base: '#d7262e', accent: '#f2f2f2', stripe: '#121417', num: '#ffffff' },
  { id: 'midnight', name: 'Полночь', base: '#1f3d8f', accent: '#ff7a00', stripe: '#ffffff', num: '#ffffff' },
  { id: 'mint', name: 'Мята', base: '#16b8a0', accent: '#0d1b2a', stripe: '#e8fffb', num: '#0d1b2a' },
  { id: 'carbon', name: 'Карбон-неон', base: '#2a2d33', accent: '#39ff88', stripe: '#39ff88', num: '#39ff88' },
  { id: 'lemans', name: 'Ле-Ман', base: '#f2f2f2', accent: '#1d4ed8', stripe: '#e11d48', num: '#121417' },
  { id: 'amethyst', name: 'Аметист', base: '#6d28d9', accent: '#fbbf24', stripe: '#fbbf24', num: '#ffffff' },
  { id: 'gulf', name: 'Залив', base: '#7fc8e8', accent: '#ff7a1a', stripe: '#ff7a1a', num: '#0b2a3a' },
];
export const SPONSORS = ['NOVA ENERGY', 'APEX TIRES', 'QAZAQ MOTORS', 'VOLT DRIVE', 'ORBIT OIL', 'STEPPE FUEL', 'PULSE TELECOM', 'AURORA AIR', 'KHAN TENGRI', 'SKYLINE BANK'];

// --- загрузка GLB ---
const templates = {}; // id → Group (сцена машины из GLB)
let loadState = 'idle';

export async function preloadCars(ids = ['gt3', 'f1'], onProgress) {
  if (loadState !== 'idle') return;
  loadState = 'loading';
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env?.BASE_URL ?? './';
  let done = 0;
  await Promise.all(
    ids.map(async (id) => {
      for (const file of [`${id}.glb`, `${id}.raw.glb`]) {
        try {
          const gltf = await loader.loadAsync(`${base}models/cars/${file}`);
          templates[id] = prepareTemplate(gltf.scene);
          templates[id].userData.source = file;
          break;
        } catch (e) {
          console.warn(`[airwheel] модель ${file} не загрузилась`, e?.message || e);
        }
      }
      onProgress?.(++done / ids.length);
    }),
  );
  loadState = 'done';
}

export function carSource(id) {
  return templates[id]?.userData.source ?? 'procedural';
}

// --- общие материалы ---
let shared = null;
function sharedMats() {
  if (shared) return shared;
  shared = {
    carbon: new THREE.MeshPhysicalMaterial({ map: TX.carbon(), normalMap: TX.carbonNormal(), normalScale: new THREE.Vector2(0.35, 0.35), color: 0xffffff, roughness: 0.3, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.08 }),
    carbonLite: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.35, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x080b10, roughness: 0.03, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 }),
    glassLite: new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 0.1, metalness: 0.5, envMapIntensity: 1.4 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.15 }),
    grille: new THREE.MeshStandardMaterial({ map: TX.grille(), color: 0x9aa0a8, roughness: 0.6, metalness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.08, metalness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ map: TX.tyreSide(), color: 0xffffff, roughness: 0.88, metalness: 0 }),
    rubberLite: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.25, metalness: 0.9 }),
    rimSilver: new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 0.95 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xd4202a, roughness: 0.35, metalness: 0.3 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf2f6ff, emissiveIntensity: 2.4, roughness: 0.1 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.85 }),
  };
  return shared;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// --- ливрея на canvas ---
// Текстура: x — вдоль машины (0 корма → 1 нос), y — вокруг кузова (низ справа → крыша → низ слева).
export function liveryTexture(L, { number = 7, sponsor = 0, size = 1024, f1 = false } = {}) {
  const W = size, H = size / 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const vy = (v) => (1 - v) * H; // строка canvas для v (flipY)
  g.fillStyle = L.base;
  g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(0,0,0,0.18)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  gr.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // гоночные полосы по центру крыши/капота
  g.fillStyle = L.stripe;
  g.fillRect(0, vy(0.535), W, H * 0.022);
  g.fillRect(0, vy(0.485), W, H * 0.022);
  // боковые «стрелы» акцентного цвета
  g.fillStyle = L.accent;
  for (const side of [1, -1]) {
    const v0 = side > 0 ? 0.16 : 0.84;
    g.beginPath();
    g.moveTo(W * 0.05, vy(v0));
    g.lineTo(W * 0.62, vy(v0 + side * 0.12));
    g.lineTo(W * 0.98, vy(v0 + side * 0.16));
    g.lineTo(W * 0.98, vy(v0 + side * 0.05));
    g.lineTo(W * 0.05, vy(v0 - side * 0.05));
    g.closePath();
    g.fill();
  }
  // номер: справа — обычный текст, слева — повёрнут на 180°, на капоте — носом вверх
  const drawNum = (u, v, rot, s) => {
    g.save();
    g.translate(W * u, vy(v));
    g.rotate(rot);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(-H * 0.11 * s, -H * 0.1 * s, H * 0.22 * s, H * 0.2 * s, H * 0.03);
    g.fill();
    g.fillStyle = L.num === '#ffffff' ? '#121417' : L.num;
    g.font = `900 ${Math.round(H * 0.15 * s)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(number), 0, H * 0.01 * s);
    g.restore();
  };
  const doorU = f1 ? 0.62 : 0.5;
  drawNum(doorU, f1 ? 0.34 : 0.3, 0, 1);
  drawNum(doorU, f1 ? 0.66 : 0.7, Math.PI, 1);
  drawNum(f1 ? 0.86 : 0.8, 0.5, -Math.PI / 2, 0.8);
  // спонсоры (выдуманные бренды)
  const sp = (k) => SPONSORS[(sponsor + k) % SPONSORS.length];
  g.font = `800 ${Math.round(H * 0.045)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = (text, u, v, rot, color) => {
    g.save();
    g.translate(W * u, vy(v));
    g.rotate(rot);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  };
  const ac = L.accent === L.base ? L.stripe : L.accent;
  label(sp(0), 0.32, 0.4, 0, ac);
  label(sp(0), 0.32, 0.6, Math.PI, ac);
  label(sp(1), 0.72, 0.4, 0, L.stripe);
  label(sp(1), 0.72, 0.6, Math.PI, L.stripe);
  label(sp(2), 0.18, 0.5, -Math.PI / 2, L.stripe);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Ливрея бота: его цвет + стиль одной из палитр.
export function liveryFor(color, seed = 0) {
  const r = hashStr(String(color) + seed);
  const tmpl = LIVERIES[r % LIVERIES.length];
  const c = new THREE.Color(color);
  const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  return { ...tmpl, base: color, num: lum > 0.55 ? '#121417' : '#ffffff', stripe: lum > 0.55 ? '#121417' : tmpl.stripe };
}

// --- сборка модели ---
const DIST = { lod1: 26, lod2: 95 };

export function buildCarModel(spec, { color = 0xd81e2a, livery = null, number = 0, player = false, sponsor = 0 } = {}) {
  const S = sharedMats();
  const f1 = spec.id === 'f1';
  const hex = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
  let L = livery || liveryFor(hex, number);
  const num = number || 1 + (hashStr(hex) % 98);
  const liv = liveryTexture(L, { number: num, sponsor: sponsor || hashStr(hex) % SPONSORS.length, size: player ? 1024 : 512, f1 });
  // материалы этой машины
  const paint = new THREE.MeshPhysicalMaterial({ map: liv, color: 0xffffff, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 });
  const paintLite = new THREE.MeshStandardMaterial({ map: liv, color: 0xffffff, metalness: 0.3, roughness: 0.35, envMapIntensity: 1.1 });
  const accent = new THREE.MeshPhysicalMaterial({ color: L.accent, metalness: 0.3, roughness: 0.35, clearcoat: 1 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a12, emissiveIntensity: 0.8, roughness: 0.3 });
  const rain = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a12, emissiveIntensity: 0, roughness: 0.3 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.42, metalness: 0.85, emissive: 0xff5a10, emissiveIntensity: 0 });
  const helmet = new THREE.MeshPhysicalMaterial({ color: L.accent === '#121417' ? L.stripe : L.accent, roughness: 0.2, clearcoat: 1 });
  const byName = (name, lod) => {
    const lite = lod > 0;
    switch (name) {
      case 'paint':
        return lite ? paintLite : paint;
      case 'carbon':
        return lite ? S.carbonLite : S.carbon;
      case 'glass':
        return lite ? S.glassLite : S.glass;
      case 'rubber':
        return lite ? S.rubberLite : S.rubber;
      case 'rim':
        return f1 ? S.rim : S.rimSilver;
      case 'disc':
        return disc;
      case 'caliper':
        return S.caliper;
      case 'headlight':
        return S.headlight;
      case 'taillight':
        return tail;
      case 'rainlight':
        return rain;
      case 'helmet':
        return helmet;
      case 'accent':
        return accent;
      case 'chrome':
        return S.chrome;
      case 'interior':
        return S.interior;
      case 'grille':
        return S.grille;
      case 'dark':
        return darkMat();
      default:
        return S.black;
    }
  };

  const src = templates[spec.id] || (templates[spec.id] = procedural(spec));
  const scene = src.clone(true);
  const root = new THREE.Group();
  root.name = `car-${spec.id}`;
  root.rotation.order = 'YXZ';
  const lod = new THREE.LOD();
  root.add(lod);
  const levels = [];
  for (const n of [0, 1, 2]) {
    const g = scene.getObjectByName('LOD' + n);
    if (!g) continue;
    g.traverse((o) => {
      if (!o.isMesh) return;
      const names = Array.isArray(o.material) ? o.material.map((m) => m.name) : [o.material.name || o.name];
      const mats = names.map((nm) => byName(nm, n));
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.castShadow = player && n === 0;
      o.receiveShadow = n === 0;
    });
    const chassis = g.getObjectByName('chassis');
    const ws = [];
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const pivot = g.getObjectByName('steer_' + k);
      const wheel = g.getObjectByName('wheel_' + k);
      if (pivot && wheel) ws.push({ pivot, wheel, front: k[0] === 'F' });
    }
    levels.push({ chassis, ws });
    lod.addLevel(g, n === 0 ? 0 : n === 1 ? DIST.lod1 : DIST.lod2);
  }
  const lodBase = player ? [0, 250, 600] : [0, DIST.lod1, DIST.lod2];
  let discTemp = 0, blink = 0;

  const model = {
    root,
    lod,
    paint,
    tail,
    spec,
    get livery() {
      return L;
    },
    // обновление по состоянию: положение, крен/тангаж кузова, колёса, огни, тормозные диски.
    // env: { night, wet } — для огней и дождевого фонаря.
    update(state, alpha = 1, dt = 1 / 60, env = {}) {
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
      root.position.set(x, y + (state.lift || 0) * 0.09, z);
      root.rotation.set(0, psi, 0);
      // кузов на подвеске: крен, тангаж и лёгкая просадка; колёса остаются на дороге
      const pitch = state.pitch || 0, roll = state.roll || 0;
      const heave = (state.bounce || 0) - Math.abs(roll) * 0.25 - Math.max(0, pitch) * 0.25;
      for (const L2 of levels) {
        if (L2.chassis) {
          L2.chassis.rotation.set(pitch, 0, roll, 'YXZ');
          L2.chassis.position.y = heave;
        }
        for (const w of L2.ws) {
          w.wheel.rotation.x = state.spin || 0;
          if (w.front) w.pivot.rotation.y = state.delta || 0;
        }
      }
      const braking = state.brakeLight ?? state.brake > 0.2;
      model.braking = braking;
      tail.emissiveIntensity = braking ? 5.5 : env.night ? 1.3 : 0.55;
      blink += dt;
      rain.emissiveIntensity = env.wet ? (Math.sin(blink * 13) > 0 ? 6 : 0.3) : 0;
      const v = Math.abs(state.u ?? state.v ?? 0);
      discTemp += ((braking ? Math.min(1, v / 40) : 0) - discTemp) * Math.min(1, dt * (braking ? 1.2 : 0.35));
      disc.emissiveIntensity = Math.max(0, discTemp - 0.25) * 6;
    },
    setLodScale(k) {
      if (lod.levels[1]) lod.levels[1].distance = lodBase[1] * k;
      if (lod.levels[2]) lod.levels[2].distance = lodBase[2] * k;
    },
    // Сменить окраску (выбор в меню, цвет игрока в мультиплеере).
    setLivery(L3, n2 = num) {
      L = L3;
      const t = liveryTexture(L3, { number: n2, size: player ? 1024 : 512, f1 });
      paint.map?.dispose();
      paint.map = paintLite.map = t;
      accent.color.set(L3.accent);
      helmet.color.set(L3.accent === '#121417' ? L3.stripe : L3.accent);
    },
    setColor(c) {
      const hx = typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c;
      model.setLivery(liveryFor(hx, num));
    },
    dispose() {
      paint.map?.dispose();
      for (const m of [paint, paintLite, accent, tail, rain, disc, helmet]) m.dispose();
    },
  };
  model.setLodScale(1);
  return model;
}

// Общая освещённость фар (ночь — ярче). Вызывается раз в кадр.
export function setHeadlightLevel(night) {
  sharedMats().headlight.emissiveIntensity = night ? 3.6 : 1.4;
}

// Запасной путь: та же модель, сгенерированная в браузере.
function procedural(spec) {
  const g = prepareTemplate(buildCarScene(spec));
  g.userData.source = 'procedural';
  return g;
}

// --- подготовка шаблона: меньше вызовов отрисовки ---
// Геометрия каждого уровня сливается по материалам. Мелкие тёмные детали (чёрный пластик, хром,
// интерьер, суппорты) — один материал с цветами вершин. На LOD1/LOD2 колёса запекаются в кузов,
// а всё, кроме лака и огней, — тоже в «тёмный» материал: 4 вызова на машину вдали.
const DARK = { black: 0x0b0c0f, chrome: 0xc9ced4, interior: 0x1d2025, caliper: 0xc21c24, grille: 0x15171a, carbon: 0x17191d, glass: 0x0d121a, rubber: 0x151515, rim: 0x9aa1aa, disc: 0x55595f, helmet: 0xdddddd, accent: 0x222222, rainlight: 0x400000 };
const darkMat = () => (sharedMats().dark ||= new THREE.MeshStandardMaterial({ name: 'dark', vertexColors: true, roughness: 0.45, metalness: 0.45 }));

// Меш → плоская Float32-геометрия в системе координат root (атрибуты могут быть квантованы).
function bake(mesh, root, color = null, groupRange = null) {
  const src = mesh.geometry;
  let idx = src.index ? src.index.array : null;
  if (groupRange) idx = (idx || [...Array(src.attributes.position.count).keys()]).slice(groupRange.start, groupRange.start + groupRange.count);
  const n = idx ? idx.length : src.attributes.position.count;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name];
    const k = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(n * k);
    if (a) for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) arr[i * k + c] = a.getComponent(idx ? idx[i] : i, c);
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  mesh.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);
  const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  g.applyMatrix4(rel);
  if (!src.attributes.normal) g.computeVertexNormals();
  if (color != null) {
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

// Все меши узла с именами материалов: [{mesh, mat, group}]
function meshesOf(node) {
  const out = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.geometry.groups.forEach((gr) => out.push({ mesh: o, mat: o.material[gr.materialIndex].name, group: gr }));
    else out.push({ mesh: o, mat: o.material.name || o.name, group: null });
  });
  return out;
}

function mergeInto(parent, buckets, matFor) {
  for (const [key, list] of buckets) {
    if (!list.length) continue;
    const geo = mergeGeometries(list);
    list.forEach((g) => g.dispose());
    const m = new THREE.Mesh(geo, matFor(key));
    m.name = key;
    parent.add(m);
  }
}

function prepareTemplate(scene) {
  scene.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = scene.name;
  const placeholder = (name) => new THREE.MeshStandardMaterial({ name, vertexColors: name === 'dark' });
  for (const n of [0, 1, 2]) {
    const src = scene.getObjectByName('LOD' + n);
    if (!src) continue;
    const lvl = new THREE.Group();
    lvl.name = 'LOD' + n;
    const chassis = new THREE.Group();
    chassis.name = 'chassis';
    lvl.add(chassis);
    const buckets = new Map();
    const put = (key, g) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(g);
    };
    const chassisSrc = src.getObjectByName('chassis') || src;
    // кузов и детали
    for (const { mesh, mat, group } of meshesOf(chassisSrc)) {
      if (n === 0 && ['paint', 'carbon', 'glass', 'grille', 'helmet', 'accent', 'headlight', 'taillight', 'rainlight'].includes(mat)) put(mat, bake(mesh, src, null, group));
      else if (n > 0 && ['paint', 'headlight', 'taillight'].includes(mat)) put(mat, bake(mesh, src, null, group));
      else put('dark', bake(mesh, src, DARK[mat] ?? 0x111111, group));
    }
    // колёса: LOD0 — отдельно (вращение и поворот), дальше — запекаются в кузов
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const pivot = src.getObjectByName('steer_' + k);
      if (!pivot) continue;
      const wheel = pivot.getObjectByName('wheel_' + k);
      if (n === 0) {
        const p2 = new THREE.Group();
        p2.name = 'steer_' + k;
        p2.position.copy(pivot.position);
        const w2 = new THREE.Group();
        w2.name = 'wheel_' + k;
        p2.add(w2);
        lvl.add(p2);
        const wb = new Map();
        for (const { mesh, mat } of meshesOf(wheel)) {
          const key = mat === 'chrome' ? 'rim' : mat;
          if (!wb.has(key)) wb.set(key, []);
          wb.get(key).push(bake(mesh, wheel));
        }
        mergeInto(w2, wb, placeholder);
        // суппорты — в «тёмный» кузов
        for (const { mesh, mat } of meshesOf(pivot)) if (!wheel || !isDescendant(mesh, wheel)) put('dark', bake(mesh, src, DARK[mat] ?? 0x111111));
      } else {
        for (const { mesh, mat } of meshesOf(pivot)) put('dark', bake(mesh, src, DARK[mat] ?? 0x111111));
      }
    }
    mergeInto(chassis, buckets, placeholder);
    out.add(lvl);
  }
  return out;
}

function isDescendant(o, root) {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
}
