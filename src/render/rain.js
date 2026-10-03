// Дождь и мокрый асфальт.
//  - RainSystem: капли-штрихи в объёме вокруг камеры (один LineSegments, кольцевое обновление
//    в шейдере по времени — без работы CPU на каждую каплю), наклон по скорости машины.
//  - WET: общие uniforms влажности. patchWet(material) добавляет материалу дороги лужи по
//    шумовой маске, тёмный мокрый цвет и низкую шероховатость — отражения окружения и огней
//    берутся из PMREM-карты (без дорогих SSR).
import * as THREE from 'three';
import * as TX from './textures.js';

export const WET = {
  uWet: { value: 0 }, // 0..1 влажность (визуальная)
  uPuddle: { value: null }, // шумовая маска луж (тайлится в мировых координатах)
  uTime: { value: 0 },
};

// Маска луж: мягкий шум, лужи — в низинах шума.
function puddleMask() {
  if (WET.uPuddle.value) return WET.uPuddle.value;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  // value noise на сетке 8×8 + 16×16, тайлится
  const grid = (n, seed) => {
    const g = new Float32Array(n * n);
    let a = seed;
    for (let i = 0; i < g.length; i++) {
      a = (a * 1664525 + 1013904223) >>> 0;
      g[i] = a / 4294967296;
    }
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
      const a0 = at(xi, yi), b0 = at(xi + 1, yi), c0 = at(xi, yi + 1), d0 = at(xi + 1, yi + 1);
      return a0 + (b0 - a0) * sx + (c0 - a0) * sy + (a0 - b0 - c0 + d0) * sx * sy;
    };
  };
  const n1 = grid(6, 7), n2 = grid(16, 11);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = n1((x / S) * 6, (y / S) * 6) * 0.7 + n2((x / S) * 16, (y / S) * 16) * 0.3;
      const k = Math.max(0, Math.min(1, (0.56 - v) / 0.12)); // лужи — где шум ниже порога
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(k * 255);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  WET.uPuddle.value = t;
  return t;
}

// Мокрый материал дороги: в лужах почти зеркало, вокруг — тёмный глянцевый асфальт.
export function patchWet(material, { puddles = true, darken = 0.55 } = {}) {
  puddleMask();
  material.userData.wet = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uWet = WET.uWet;
    sh.uniforms.uPuddle = WET.uPuddle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform sampler2D uPuddle;\nvarying vec3 vWetPos;\nfloat wetMask;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float pud = ${puddles ? 'texture2D(uPuddle, vWetPos.xz / 23.0).r * 0.8 + texture2D(uPuddle, vWetPos.xz / 7.3 + 0.37).r * 0.2' : '0.0'};
        wetMask = clamp(uWet * 1.25 - 0.1, 0.0, 1.0);
        float pudK = smoothstep(0.35, 0.75, pud) * smoothstep(0.25, 0.8, uWet);
        diffuseColor.rgb *= mix(1.0, ${darken.toFixed(2)}, wetMask) * mix(1.0, 0.75, pudK);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, wetMask);
        roughnessFactor = mix(roughnessFactor, 0.03, pudK);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), pudK * 0.9));`,
      );
  };
  material.needsUpdate = true;
  return material;
}

// Капли: N штрихов в кубе вокруг камеры, позиция по времени в шейдере (ничего не считаем на CPU).
export class RainSystem {
  constructor(scene, count = 5000) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    for (let k = 0; k < count; k++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let e = 0; e < 2; e++) {
        const o = (k * 2 + e) * 3;
        seed[o] = x;
        seed[o + 1] = y;
        seed[o + 2] = z;
        pos[o + 1] = e; // 0 — голова, 1 — хвост
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3() },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0xaabbd0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 seed;
        uniform vec3 uCam, uWind;
        uniform float uTime;
        varying float vA;
        const float BOX = 34.0;
        void main() {
          float fall = 15.0 + seed.x * 6.0;
          vec3 p = seed * BOX;
          p.y -= uTime * fall;
          p.xz += uWind.xz * uTime;
          // кольцевой перенос в кубе вокруг камеры
          vec3 rel = mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5;
          vec3 wp = uCam + rel;
          vec3 vel = vec3(uWind.x, -fall, uWind.z);
          wp -= vel * 0.028 * position.y;
          vA = (1.0 - position.y) * (1.0 - smoothstep(10.0, 17.0, length(rel)));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uColor;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor, vA * uAlpha); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.count = count;
    scene.add(this.mesh);
  }

  // rain 0..1, camPos, carVel {x,z} — на скорости капли летят навстречу (наклон).
  update(dt, rain, camPos, carVel = null, night = false) {
    this.mesh.visible = rain > 0.02;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camPos);
    u.uWind.value.set(-(carVel?.x ?? 0) * 0.9 + 1.5, 0, -(carVel?.z ?? 0) * 0.9 + 0.8);
    u.uAlpha.value = Math.min(0.5, rain * 0.55) * (night ? 0.75 : 0.55);
    u.uColor.value.set(night ? 0x8fa6c8 : 0xc4d0de);
    this.mesh.geometry.setDrawRange(0, Math.round(this.count * 2 * Math.min(1, 0.25 + rain)));
  }

  setBudget(k) {
    this.budget = k;
  }
}

export { TX };
