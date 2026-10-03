// Город (ночные трассы): здания разной формы, фасады 4 стилей с разным числом горящих окон,
// витрины первых этажей, детали на крышах, вертолётные площадки, мигающие авиационные огни,
// LED-экраны с рекламой (смена роликов в шейдере), неоновые вывески-«лезвия», вывески на
// крышах, провода с гирляндами через улицу, пар из люков и дальний силуэт города (skyline).
//
// Производительность: одна геометрия «три яруса» на все здания — форма задаётся атрибутом
// экземпляра (aShape), стиль фасада — слоем массива текстур (aStyle). Здания разбиты на чанки
// по 400 м (отсечение по пирамиде видимости). Мелочи — общие InstancedMesh/Points:
// весь город — ~20–30 draw calls, ни одного отдельного Mesh на окно или вывеску.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const CHUNK = 400;
const up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// Общие для города униформы: время (анимации) и масштаб точек (пиксели на метр на 1 м дистанции).
export const CITY_U = { uTime: { value: 0 }, uScale: { value: 800 } };

// --- здания ---
function tierGeometry() {
  const parts = [];
  for (let t = 0; t < 3; t++) {
    const b = new THREE.BoxGeometry(1, 1, 1);
    b.translate(0, 0.5, 0);
    b.deleteAttribute('uv');
    b.setAttribute('aTier', new THREE.BufferAttribute(new Float32Array(b.attributes.position.count).fill(t), 1));
    parts.push(b);
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

// Материал зданий. fogScale < 1 — туман слабее (дальний силуэт города читается на горизонте).
export function buildingMaterial(night, { fogScale = 1, far = false } = {}) {
  const tex = TX.facadeLayers();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: night ? 0xffffff : 0x000000,
    emissiveIntensity: night ? (far ? 0.6 : 1.05) : 0,
    roughness: 0.8,
    metalness: 0.06,
    envMapIntensity: far ? 0.25 : 0.8,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tFacade = { value: tex.map };
    sh.uniforms.tFacadeE = { value: tex.emissive };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aTier;
        attribute vec4 aShape;
        attribute vec2 aStyle;
        varying vec2 vWinUv;
        varying float vRoof;
        varying float vH;
        flat varying vec2 vStyle;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // ярусы: [0, y1] полный, [y1, y2] с отступом s1, [y2, 1] с отступом s2
          float yA = aTier < 0.5 ? 0.0 : (aTier < 1.5 ? aShape.x : aShape.y);
          float yB = aTier < 0.5 ? aShape.x : (aTier < 1.5 ? aShape.y : 1.0);
          float sc = aTier < 0.5 ? 1.0 : (aTier < 1.5 ? aShape.z : aShape.w);
          sc *= step(0.002, yB - yA);
          transformed.xz *= sc;
          transformed.y = mix(yA, yB, position.y);
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          // окна — в метрах вдоль грани (от центра здания) и по высоте от основания
          float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz), sz = length(instanceMatrix[2].xyz);
          float along = abs(objectNormal.z) > 0.5 ? transformed.x * sx : transformed.z * sz;
          vH = transformed.y * sy;
          vWinUv = vec2(along / 22.0 + 0.5, vH / 48.0) + vec2(floor(aStyle.y * 8.0) / 8.0, floor(fract(aStyle.y * 7.0) * 16.0) / 16.0);
          vRoof = step(0.5, objectNormal.y);
          vStyle = aStyle;
        }`,
      );
    if (fogScale !== 1) sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', `#ifdef USE_FOG\n vFogDepth = -mvPosition.z * ${fogScale.toFixed(3)};\n#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tFacade;
        uniform sampler2DArray tFacadeE;
        varying vec2 vWinUv;
        varying float vRoof;
        varying float vH;
        flat varying vec2 vStyle;
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 fac = texture(tFacade, vec3(vWinUv, vStyle.x));
        float wallK = 1.0 - vRoof;
        // первый этаж — витрины (сегменты по 3.2 м)
        float shop = step(vH, 4.4) * wallK;
        float segX = vWinUv.x * 22.0 / 3.2;
        float seg = floor(segX);
        float pane = step(0.07, fract(segX)) * step(fract(segX), 0.93) * step(0.5, vH) * step(vH, 3.5);
        vec3 facCol = mix(fac.rgb, mix(vec3(0.2), vec3(0.05, 0.06, 0.07), pane), shop);
        diffuseColor.rgb *= mix(facCol, vec3(0.3), vRoof);
        float glassK = mix(fac.a, pane, shop) * wallK;`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${far ? '0.6' : '0.1'}, glassK);`)
      .replace(
        '#include <emissivemap_fragment>',
        `{
          vec3 em = texture(tFacadeE, vec3(vWinUv, vStyle.x)).rgb;
          // какие окна горят — своё у каждого здания; вдали — средняя яркость (без мерцания)
          vec2 cell = floor(vWinUv * vec2(8.0, 16.0));
          float litFrac = 0.12 + 0.5 * fract(vStyle.y * 13.37);
          float on = step(hash12(cell + vStyle.y * 117.0), litFrac);
          float fw = fwidth(vWinUv.x * 8.0) + fwidth(vWinUv.y * 16.0);
          on = mix(on, litFrac * 0.8, smoothstep(0.25, 0.9, fw));
          float shopOn = step(0.45, hash12(vec2(seg * 1.7, vStyle.y * 9.0)));
          vec3 shopE = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.88, 1.0), step(0.6, hash12(vec2(seg, vStyle.y * 31.0)))) * pane * shopOn * (0.2 + 0.35 * hash12(vec2(seg, 3.0)));
          totalEmissiveRadiance *= mix(em * on, shopE, shop) * wallK;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `city-bld-${fogScale}-${far}`;
  return mat;
}

// Чанки зданий: InstancedMesh на чанк, у каждого свои атрибуты экземпляров (форма, стиль).
class ChunkedBuildings {
  constructor(geo, mat) {
    this.geo = geo;
    this.mat = mat;
    this.items = new Map();
    this.group = new THREE.Group();
    this.group.name = 'buildings';
  }

  add(matrix, color, shape, style) {
    const e = matrix.elements;
    const key = `${Math.floor(e[12] / CHUNK)},${Math.floor(e[14] / CHUNK)}`;
    let c = this.items.get(key);
    if (!c) this.items.set(key, (c = []));
    c.push({ m: matrix.clone(), color: color.clone(), shape, style });
  }

  build() {
    for (const list of this.items.values()) {
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(this.geo.attributes)) g.setAttribute(name, attr);
      g.setIndex(this.geo.index);
      const shape = new Float32Array(list.length * 4), style = new Float32Array(list.length * 2);
      list.forEach((it, k) => {
        shape.set(it.shape, k * 4);
        style.set(it.style, k * 2);
      });
      g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
      g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 2));
      const im = new THREE.InstancedMesh(g, this.mat, list.length);
      list.forEach((it, k) => {
        im.setMatrixAt(k, it.m);
        im.setColorAt(k, it.color);
      });
      im.computeBoundingSphere();
      this.group.add(im);
    }
    this.items.clear();
    return this.group;
  }
}

// Форма здания по высоте: коробка, башня на подиуме, ступенчатая башня, башня с «короной».
function pickShape(h, r) {
  if (h > 42) {
    const k = r();
    if (k < 0.4) {
      const y1 = 0.5 + r() * 0.2, s1 = 0.72 + r() * 0.12;
      return [y1, y1 + (1 - y1) * (0.55 + r() * 0.25), s1, s1 * (0.7 + r() * 0.15)];
    }
    if (k < 0.7) return [0.9 + r() * 0.04, 1, 0.82, 0.82];
    if (k < 0.85) return [0.22 + r() * 0.1, 1, 0.68 + r() * 0.12, 1];
    return [1, 1, 1, 1];
  }
  if (h > 22 && r() < 0.35) return [0.25 + r() * 0.12, 1, 0.7 + r() * 0.15, 1];
  return [1, 1, 1, 1];
}

// Стиль фасада: 0 жилой, 1 офис, 2 ленточный, 3 стеклянный.
function pickStyle(h, r) {
  const k = r();
  if (h > 42) return k < 0.45 ? 3 : k < 0.8 ? 1 : 2;
  if (h > 22) return k < 0.4 ? 0 : k < 0.75 ? 1 : 2;
  return k < 0.75 ? 0 : 2;
}

// Верхняя площадка крыши (масштаб отступа последнего яруса).
function topScale(shape) {
  const [y1, y2, s1, s2] = shape;
  if (y2 < 0.999) return s2;
  if (y1 < 0.999) return s1;
  return 1;
}

// --- точки: огни, гирлянды, авиаогни (мигание в шейдере) ---
// Материал светящихся точек: атрибуты color (RGB × яркость) и blink (фаза, период, доля
// «включено», размер в метрах). streak > 0 — горизонтальный блик (фары).
export function glowPointsMaterial({ streak = 0, maxPx = 96 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: CITY_U.uTime, uScale: CITY_U.uScale, uStreak: { value: streak } },
    vertexShader: `
      attribute vec3 color;
      attribute vec4 blink;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      varying float vOn;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float ph = fract(uTime / max(blink.y, 0.001) + blink.x);
        vOn = blink.y <= 0.0 ? 1.0 : smoothstep(blink.z, blink.z - 0.06, ph);
        float px = blink.w * uScale / max(-mvPosition.z, 0.1);
        gl_PointSize = clamp(px, 2.0, ${maxPx.toFixed(1)});
        // слишком мелкие точки — тусклее, а не меньше (без мерцания вдали)
        vOn *= clamp(px / 2.0, 0.25, 1.0);
        vColor = color;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uStreak;
      varying vec3 vColor;
      varying float vOn;
      #include <fog_pars_fragment>
      void main() {
        vec2 c = (gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, length(c));
        a *= a;
        a += uStreak * exp(-abs(c.y) * 26.0) * (1.0 - abs(c.x)) * 0.6;
        float f = 1.0;
        #ifdef USE_FOG
          f = 1.0 - 0.85 * smoothstep(fogNear, fogFar * 1.8, vFogDepth);
        #endif
        gl_FragColor = vec4(vColor * a * vOn * f, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

function lightPoints(items) {
  const n = items.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), blink = new Float32Array(n * 4);
  items.forEach((it, k) => {
    pos.set([it.x, it.y, it.z], k * 3);
    const c = new THREE.Color(it.color).multiplyScalar(it.power ?? 1);
    col.set([c.r, c.g, c.b], k * 3);
    blink.set([it.phase ?? 0, it.period ?? 0, it.duty ?? 1, it.size ?? 0.6], k * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('blink', new THREE.BufferAttribute(blink, 4));
  const pts = new THREE.Points(g, glowPointsMaterial());
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}

// Пар из люков и вентиляции: частицы поднимаются и тают (анимация целиком в шейдере).
function steamPoints(sources) {
  const PER = 14;
  const n = sources.length * PER;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  sources.forEach((s, k) => {
    for (let j = 0; j < PER; j++) {
      const i = k * PER + j;
      pos.set([s.x, s.y, s.z], i * 3);
      seed.set([j / PER, s.strength ?? 1], i * 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: CITY_U.uTime, uScale: CITY_U.uScale, map: { value: TX.glow() } },
    vertexShader: `
      attribute vec2 seed;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime * 0.22 + seed.x);
        float h = fract(sin(dot(position.xz + seed.x, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 p = position + vec3(sin(seed.x * 37.0 + uTime * 0.7) * 0.6 * age + age * 1.2, age * 5.5 * seed.y, cos(seed.x * 23.0) * 0.6 * age);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((0.8 + age * 3.2) * seed.y * uScale / max(-mvPosition.z, 0.1), 1.0, 220.0);
        vA = sin(age * 3.14159) * 0.22 * (0.7 + h * 0.3);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying float vA;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA;
        float f = 1.0;
        #ifdef USE_FOG
          f = 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor = vec4(vec3(0.62, 0.64, 0.7), a * f);
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

// --- вывески из атласа: LED-экраны (смена роликов), неон (мерцание), статичные ---
// items: [{ m: Matrix4, tile, mode, seed, color }]; mode: 0 — статичная, 1 — LED, 2 — неон.
function atlasPlanes(tex, cols, rows, items, { night, side = THREE.FrontSide } = {}) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const n = items.length;
  const tile = new Float32Array(n * 4);
  items.forEach((it, k) => tile.set([it.tile, it.mode, it.seed ?? 0, 0], k * 4));
  plane.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 4));
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side, fog: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = CITY_U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTile;\nflat varying vec4 vTile;\nvarying vec2 vUv0;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile;\nvUv0 = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nflat varying vec4 vTile;\nvarying vec2 vUv0;\nconst vec2 GRID = vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});`)
      .replace(
        '#include <map_fragment>',
        `{
          float total = GRID.x * GRID.y;
          float t = uTime / 7.0 + vTile.z * 13.0;
          float slot = floor(t), ph = fract(t);
          float tile = vTile.x;
          if (vTile.y > 0.5 && vTile.y < 1.5) {
            // LED: каждые 7 с — следующий ролик, переход «шторкой» слева направо
            float cur = mod(vTile.x + slot * 3.0, total), prev = mod(vTile.x + (slot - 1.0) * 3.0, total);
            tile = (ph < 0.1 && vUv0.x > ph * 10.0) ? prev : cur;
          }
          vec2 cell = vec2(mod(tile, GRID.x), GRID.y - 1.0 - floor(tile / GRID.x));
          vec4 tc = texture2D(map, (cell + clamp(vUv0, 0.004, 0.996)) / GRID);
          diffuseColor *= tc;
          if (vTile.y > 0.5 && vTile.y < 1.5) {
            // светодиодная сетка и лёгкая строчная развёртка
            vec2 g = fract(vUv0 * vec2(160.0, 80.0));
            float led = 0.6 + 0.4 * smoothstep(0.55, 0.15, length(g - 0.5));
            float fw = fwidth(vUv0.x * 160.0);
            diffuseColor.rgb *= mix(led, 0.8, smoothstep(0.3, 1.0, fw)) * (0.94 + 0.06 * sin(vUv0.y * 40.0 - uTime * 6.0));
          } else if (vTile.y > 1.5) {
            // неон: у части вывесок — неисправная лампа (редкие провалы)
            float h = fract(sin(vTile.z * 91.3 + floor(uTime * 14.0)) * 43758.5);
            float broken = step(0.82, fract(vTile.z * 7.7));
            diffuseColor.rgb *= 1.0 - broken * step(0.86, h) * 0.85;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => `city-atlas-${cols}x${rows}`;
  const im = new THREE.InstancedMesh(plane, mat, n);
  const c = new THREE.Color();
  items.forEach((it, k) => {
    im.setMatrixAt(k, it.m);
    im.setColorAt(k, c.set(0xffffff).multiplyScalar(it.bright ?? (night ? 1.6 : 1)));
  });
  im.computeBoundingSphere();
  return im;
}

// --- детали крыш ---
function roofDetails(blds, r, night) {
  const group = new THREE.Group();
  group.name = 'roofs';
  const ac = [], tanks = [], masts = [], pads = [], lights = [];
  for (const b of blds) {
    const ts = topScale(b.shape);
    const fw = b.w * ts, fd = b.d * ts, top = b.top;
    const local = (lx, lz) => ({ x: b.cx + b.tx * lx + b.nx * lz, z: b.cz + b.tz * lx + b.nz * lz });
    // вертолётная площадка — на широких высоких башнях
    const pad = b.h > 44 && Math.min(fw, fd) > 15 && r() < 0.6;
    if (pad) {
      pads.push({ x: b.cx, y: top + 0.25, z: b.cz, s: Math.min(fw, fd) * 0.8, rot: b.heading });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, rr = Math.min(fw, fd) * 0.4;
        const p = local(Math.cos(a) * rr, Math.sin(a) * rr);
        lights.push({ x: p.x, y: top + 0.4, z: p.z, color: 0x46ff8a, power: night ? 2.2 : 0, size: 0.45 });
      }
    } else {
      // кондиционеры и вентиляция
      const cnt = 1 + Math.floor(r() * (fw * fd > 300 ? 4 : 2));
      for (let k = 0; k < cnt; k++) {
        const p = local((r() - 0.5) * fw * 0.7, (r() - 0.5) * fd * 0.7);
        ac.push({ x: p.x, y: top, z: p.z, sx: 1.2 + r() * 2.4, sy: 0.8 + r() * 1.2, sz: 1 + r() * 2, rot: b.heading + (r() < 0.5 ? 0 : Math.PI / 2) });
      }
      if (b.style === 0 && b.h < 40 && r() < 0.3) {
        const p = local((r() - 0.5) * fw * 0.5, (r() - 0.5) * fd * 0.5);
        tanks.push({ x: p.x, y: top, z: p.z, s: 1.4 + r() * 0.8 });
      }
    }
    // мачта-антенна на самых высоких
    if (b.h > 50 && !pad && r() < 0.7) {
      const mh = 6 + r() * 12;
      masts.push({ x: b.cx, y: top, z: b.cz, h: mh });
      lights.push({ x: b.cx, y: top + mh + 0.3, z: b.cz, color: 0xff2a1a, power: 3.5, size: 1.1, period: 1.6, duty: 0.3, phase: r() });
    }
    // авиационные огни по углам крыши у высоких зданий
    if (b.h > 30) {
      const ph = r();
      for (const [sx, sz] of [[0.5, 0.5], [-0.5, -0.5]]) {
        const p = local(sx * fw * 0.96, sz * fd * 0.96);
        lights.push({ x: p.x, y: top + 0.5, z: p.z, color: 0xff2a1a, power: 2.6, size: 0.9, period: 1.8, duty: 0.35, phase: ph });
      }
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.55, metalness: 0.5 });
  const inst = (geo, mat, list, mk) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => im.setMatrixAt(k, mk(it)));
    im.computeBoundingSphere();
    group.add(im);
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  inst(box, metal, ac, (a) => _m.compose(_p.set(a.x, a.y, a.z), _q.setFromAxisAngle(up, a.rot), _s.set(a.sx, a.sy, a.sz)));
  const tank = mergeGeometries([new THREE.CylinderGeometry(1, 1, 1.6, 10).translate(0, 2.2, 0), new THREE.ConeGeometry(1.05, 0.6, 10).translate(0, 3.3, 0), new THREE.BoxGeometry(1.6, 1.4, 1.6).translate(0, 0.7, 0)]);
  inst(tank, new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.85 }), tanks, (t) => _m.compose(_p.set(t.x, t.y, t.z), _q.identity(), _s.set(t.s, t.s, t.s)));
  const mast = new THREE.CylinderGeometry(0.12, 0.22, 1, 5);
  mast.translate(0, 0.5, 0);
  inst(mast, metal, masts, (a) => _m.compose(_p.set(a.x, a.y, a.z), _q.identity(), _s.set(1, a.h, 1)));
  const padGeo = new THREE.PlaneGeometry(1, 1);
  padGeo.rotateX(-Math.PI / 2);
  inst(padGeo, new THREE.MeshStandardMaterial({ map: TX.helipad(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), pads, (a) =>
    _m.compose(_p.set(a.x, a.y, a.z), _q.setFromAxisAngle(up, a.rot), _s.set(a.s, 1, a.s)),
  );
  return { group, lights };
}

// Построить город. Возвращает { group, lights (кандидаты для пула огней), update(dt) }.
export function buildCity(track, env, grid, heightAt, seaAt, r, density) {
  const group = new THREE.Group();
  group.name = 'city';
  const cfg = env.scenery.buildings;
  const night = env.time === 'night';
  const geo = tierGeometry();
  const mat = buildingMaterial(night);
  const set = new ChunkedBuildings(geo, mat);
  const col = new THREE.Color();
  const blds = []; // все здания (для крыш)
  const front = []; // первый ряд (вывески, провода, пар)
  const tu = track.tunnel;
  const inTunnel = (sAt) => tu && (((sAt - tu.s0) % track.length) + track.length) % track.length < tu.length + 30;

  const place = (i, side, dist, w, d, h, isFront) => {
    const nx = track.nx[i] * side, nz = track.nz[i] * side;
    const tx = track.tx[i], tz = track.tz[i];
    const cx = track.x[i] + nx * (dist + d / 2), cz = track.z[i] + nz * (dist + d / 2);
    for (const [a, b] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
      const x = cx + tx * a + nx * b, z = cz + tz * a + nz * b;
      if (!grid.clear(x, z, 1.5) || seaAt(x, z) > 0.01) return null;
    }
    const y = heightAt(cx, cz) - 0.5;
    const heading = Math.atan2(nx, nz);
    _q.setFromAxisAngle(up, heading);
    _m.compose(_p.set(cx, y, cz), _q, _s.set(w, h + 0.5, d));
    const shape = pickShape(h, r);
    const style = pickStyle(h, r);
    const v = style === 3 ? 0.9 + r() * 0.15 : 0.6 + r() * 0.45;
    set.add(_m, col.setRGB(v, v * (0.95 + r() * 0.08), v * (0.95 + r() * 0.1)), shape, [style, r()]);
    // локальные оси здания: x — вдоль фасада (tx), z — от трассы (nx)
    const lx = Math.cos(heading), lz = -Math.sin(heading);
    const b = { i, side, cx, cz, nx, nz, tx: lx, tz: lz, w, d, h, y, top: y + h + 0.5, heading, shape, style, s: i * track.ds, front: isFront };
    blds.push(b);
    if (isFront) front.push(b);
    return b;
  };

  // первый ряд — вдоль трассы, плотно; второй — высокие здания подальше
  const stepFront = Math.max(1, Math.round(20 / track.ds));
  for (let i = 0; i < track.n && !cfg.back; i += stepFront) {
    if (inTunnel(i * track.ds)) continue;
    for (const side of [1, -1]) {
      if (r() > 0.85 * density + 0.1) continue;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const w = 12 + r() * 14, d = 12 + r() * 10, h = cfg.height[0] + Math.pow(r(), 1.6) * (cfg.height[1] - cfg.height[0]) * 0.6;
      place(i, side, wall + (cfg.near ?? 3) + r() * 5, w, d, h, true);
    }
  }
  const backCount = Math.round((cfg.count ?? 300) * 0.5 * density);
  for (let k = 0; k < backCount; k++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const h = cfg.height[0] + Math.pow(r(), 1.3) * (cfg.height[1] - cfg.height[0]) * 1.4;
    const dist = wall + (cfg.back ? cfg.near ?? 30 : 30) + r() * (cfg.far ?? 150);
    place(i, side, dist, 14 + r() * 20, 14 + r() * 20, h, !!cfg.back && dist < wall + 90);
  }
  group.add(set.build());

  // дальний силуэт города: кольцо башен за пределами трассы (туман слабее)
  const sky = buildSkyline(track, seaAt, r, density, night, geo);
  if (sky) group.add(sky);

  const roofs = roofDetails(blds, r, night);
  group.add(roofs.group);
  const points = [...roofs.lights];
  const poolLights = [];

  // --- вывески на фасадах первого ряда ---
  const neonN = Math.min(front.length, Math.round((env.scenery.neon?.count ?? 0) * density));
  const picked = [...front].sort(() => r() - 0.5);
  const led = [], neon = [], roofSigns = [];
  const ledColors = TX.BRANDS.map((b) => new THREE.Color(b.bg[0]));
  for (const f of picked.slice(0, neonN)) {
    const lowTop = f.h * f.shape[0]; // верх нижнего яруса (вывески — только на нём)
    const off = f.d / 2 + 0.12;
    const fx = f.cx - f.nx * off, fz = f.cz - f.nz * off; // центр фасада, обращённого к трассе
    const k = r();
    if (k < 0.4 && lowTop > 14 && f.w > 12) {
      // большой LED-экран
      const w = Math.min(f.w * 0.7, 9 + r() * 7), h = w / 2;
      const y = f.y + 6 + r() * Math.max(0, Math.min(lowTop - h - 8, 18)) + h / 2;
      _q.setFromAxisAngle(up, f.heading + Math.PI);
      const tile = Math.floor(r() * 16);
      led.push({ m: _m.compose(_p.set(fx, y, fz), _q, _s.set(w, h, 1)).clone(), tile, mode: 1, seed: r() });
      // экран подсвечивает улицу — кандидат для пула настоящих огней
      poolLights.push({ x: fx - f.nx * 4, y: y - h * 0.3, z: fz - f.nz * 4, s: f.s, color: ledColors[Math.floor(tile / 2)].clone().lerp(new THREE.Color(1, 1, 1), 0.35).getHex(), power: 0.8 });
    } else {
      // неоновое «лезвие» у края фасада, перпендикулярно стене (две стороны)
      const along = (r() < 0.5 ? -1 : 1) * (f.w / 2 - 1.5);
      const hh = 5 + r() * 3, y = f.y + 4 + hh / 2 + r() * Math.max(0, Math.min(lowTop - hh - 6, 10));
      const bx = fx + f.tx * along - f.nx * 0.9, bz = fz + f.tz * along - f.nz * 0.9;
      const tile = Math.floor(r() * TX.NEON_SIGNS.length);
      const seed = r();
      for (const flip of [0, Math.PI]) {
        _q.setFromAxisAngle(up, f.heading + Math.PI / 2 + flip);
        neon.push({ m: _m.compose(_p.set(bx, y, bz), _q, _s.set(1.4, hh, 1)).clone(), tile, mode: 2, seed, bright: night ? 2.4 : 1.2 });
      }
      if (r() < 0.35) poolLights.push({ x: bx - f.nx * 2, y, z: bz - f.nz * 2, s: f.s, color: new THREE.Color(TX.NEON_SIGNS[tile][1]).getHex(), power: 0.55 });
    }
  }
  // вывески-бренды на крышах невысоких зданий
  for (const f of front) {
    if (roofSigns.length >= 14 * density || f.h > 34 || f.shape[0] < 0.999 || r() > 0.25) continue;
    const w = Math.min(f.w * 0.8, 12), h = w / 2;
    const off = f.d / 2 - 2;
    _q.setFromAxisAngle(up, f.heading + Math.PI);
    roofSigns.push({ m: _m.compose(_p.set(f.cx - f.nx * off, f.top + h / 2 + 0.6, f.cz - f.nz * off), _q, _s.set(w, h, 1)).clone(), tile: Math.floor(r() * 16), mode: 0, seed: r(), bright: night ? 1.3 : 1 });
  }
  if (led.length) group.add(atlasPlanes(TX.brandAtlas(), 4, 4, led, { night }));
  if (roofSigns.length) group.add(atlasPlanes(TX.brandAtlas(), 4, 4, roofSigns, { night, side: THREE.DoubleSide }));
  if (neon.length) group.add(atlasPlanes(TX.neonAtlas(), TX.NEON_SIGNS.length, 1, neon, { night }));

  // --- провода с гирляндами через улицу (между фасадами по разные стороны) ---
  const wires = [];
  const bySide = { 1: front.filter((f) => f.side > 0), '-1': front.filter((f) => f.side < 0) };
  let lastWire = -1e9;
  for (const a of bySide[1]) {
    if (a.s - lastWire < 45 || Math.abs(track.kappa[a.i]) > 1 / 300 || inTunnel(a.s)) continue;
    const b = bySide[-1].find((x) => Math.abs(track.deltaS(a.s, x.s)) < 14);
    if (!b) continue;
    lastWire = a.s;
    const ha = Math.min(a.h * a.shape[0] - 1, 8 + r() * 4), hb = Math.min(b.h * b.shape[0] - 1, ha + (r() - 0.5) * 2);
    if (ha < 6 || hb < 6) continue;
    const pa = new THREE.Vector3(a.cx - a.nx * (a.d / 2), a.y + ha, a.cz - a.nz * (a.d / 2));
    const pb = new THREE.Vector3(b.cx - b.nx * (b.d / 2), b.y + hb, b.cz - b.nz * (b.d / 2));
    wires.push({ pa, pb, sag: 0.8 + r() * 1.2, bulbs: r() < 0.6 });
  }
  if (wires.length) {
    const seg = [];
    const SEG = 12;
    const at = (w, t) => new THREE.Vector3().lerpVectors(w.pa, w.pb, t).add(new THREE.Vector3(0, -w.sag * 4 * t * (1 - t), 0));
    for (const w of wires) {
      for (let k = 0; k < SEG; k++) seg.push(at(w, k / SEG), at(w, (k + 1) / SEG));
      if (w.bulbs) {
        const n = Math.max(4, Math.round(w.pa.distanceTo(w.pb) / 1.3));
        const warm = r() < 0.7;
        for (let k = 1; k < n; k++) {
          const p = at(w, k / n);
          const c = warm ? 0xffc06a : [0xff5aa0, 0x5ad8ff, 0xffe45a, 0x7dff8a][k % 4];
          points.push({ x: p.x, y: p.y - 0.15, z: p.z, color: c, power: night ? 1.7 : 0.4, size: 0.42 });
        }
      }
    }
    const lg = new THREE.BufferGeometry().setFromPoints(seg);
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x15171c }));
    lines.name = 'wires';
    group.add(lines);
  }

  // --- пар из люков у тротуара и с крыш ---
  const steam = [];
  for (const f of front) {
    if (r() < 0.1) {
      const k = 2.5 + r() * 2;
      steam.push({ x: f.cx - f.nx * (f.d / 2 + k), y: f.y + 0.6, z: f.cz - f.nz * (f.d / 2 + k), strength: 0.9 + r() * 0.4 });
    }
  }
  for (const b of blds) if (b.h > 25 && r() < 0.05) steam.push({ x: b.cx, y: b.top + 1.5, z: b.cz, strength: 1.5 + r() });
  if (steam.length) group.add(steamPoints(steam.slice(0, Math.round(40 * density) + 4)));

  if (points.length) group.add(lightPoints(points));
  return { group, lights: poolLights, buildings: blds };
}

// Дальний силуэт города: высокие башни кольцом вокруг трассы, одна InstancedMesh.
function buildSkyline(track, seaAt, r, density, night, geo) {
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const R0 = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 220;
  const n = Math.round(170 * density);
  const items = [];
  for (let k = 0; k < n * 2 && items.length < n; k++) {
    const a = r() * Math.PI * 2, dist = R0 + Math.pow(r(), 0.8) * 700;
    const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
    if (seaAt(x, z) > 0.01) continue;
    const h = 45 + Math.pow(r(), 1.5) * 190;
    const w = 22 + r() * 30, d = 22 + r() * 30;
    items.push({ x, z, h, w, d, rot: r() * Math.PI });
  }
  if (!items.length) return null;
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
  g.setIndex(geo.index);
  const shape = new Float32Array(items.length * 4), style = new Float32Array(items.length * 2);
  const im = new THREE.InstancedMesh(g, buildingMaterial(night, { fogScale: 0.38, far: true }), items.length);
  const c = new THREE.Color();
  items.forEach((it, k) => {
    shape.set(pickShape(it.h, r), k * 4);
    style.set([pickStyle(it.h, r), r()], k * 2);
    _m.compose(_p.set(it.x, -2, it.z), _q.setFromAxisAngle(up, it.rot), _s.set(it.w, it.h, it.d));
    im.setMatrixAt(k, _m);
    const v = 0.5 + r() * 0.4;
    im.setColorAt(k, c.setRGB(v, v, v * 1.05));
  });
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
  g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 2));
  im.computeBoundingSphere();
  im.name = 'skyline';
  return im;
}
