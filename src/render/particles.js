// Частицы: дым из-под колёс (торможение, занос, пробуксовка), искры (днище F1, стена),
// пыль на траве/песке, брызги на мокром асфальте. Две системы Points (обычная и аддитивная)
// с кольцевым буфером — без выделения памяти в кадре.
import * as THREE from 'three';
import * as TX from './textures.js';

const TYPES = {
  smoke: { life: 1.6, size: [1.2, 5.5], color: [0.82, 0.82, 0.84], alpha: 0.35, drag: 1.4, lift: 0.9, add: false },
  dust: { life: 1.3, size: [1.0, 4.5], color: [0.62, 0.5, 0.36], alpha: 0.4, drag: 1.2, lift: 0.5, add: false },
  sand: { life: 1.3, size: [1.0, 4.5], color: [0.86, 0.74, 0.52], alpha: 0.4, drag: 1.2, lift: 0.5, add: false },
  gravel: { life: 1.0, size: [0.8, 3.2], color: [0.58, 0.55, 0.5], alpha: 0.45, drag: 1.0, lift: -2.0, add: false },
  spray: { life: 0.6, size: [0.35, 2.0], color: [0.74, 0.79, 0.86], alpha: 0.13, drag: 2.6, lift: 0.1, add: false },
  spark: { life: 0.45, size: [0.18, 0.05], color: [3.2, 1.9, 0.6], alpha: 1, drag: 0.4, lift: -9.8, add: true },
};

function makeSystem(max, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: TX.glow() }, scale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float scale;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return { pts, pos, col, size, alpha, geo };
}

export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ t: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, type: null });
    this.head = 0;
    this.normal = makeSystem(max, false);
    this.additive = makeSystem(Math.round(max / 3), true);
    scene.add(this.normal.pts, this.additive.pts);
    this.budget = 1;
  }

  // Плотность частиц (0..1) — по пресету графики.
  setBudget(k) {
    this.budget = k;
  }

  emit(type, x, y, z, vx = 0, vy = 0, vz = 0, spread = 1) {
    if (Math.random() > this.budget) return;
    const p = this.p[this.head];
    this.head = (this.head + 1) % this.max;
    const T = TYPES[type];
    p.type = T;
    p.t = 0;
    p.life = T.life * (0.7 + Math.random() * 0.6);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx + (Math.random() - 0.5) * spread;
    p.vy = vy + Math.random() * spread * 0.5;
    p.vz = vz + (Math.random() - 0.5) * spread;
  }

  clear() {
    for (const p of this.p) p.life = 0;
  }

  update(dt) {
    let n = 0, a = 0;
    const N = this.normal, A = this.additive;
    const aMax = A.size.length;
    for (const p of this.p) {
      if (p.life <= 0) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.life = 0;
        continue;
      }
      const T = p.type;
      const k = Math.exp(-T.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k + T.lift * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const f = p.t / p.life;
      const S = T.add ? A : N;
      const i = T.add ? a++ : n++;
      if (T.add && i >= aMax) continue;
      S.pos[i * 3] = p.x;
      S.pos[i * 3 + 1] = p.y;
      S.pos[i * 3 + 2] = p.z;
      S.col[i * 3] = T.color[0];
      S.col[i * 3 + 1] = T.color[1];
      S.col[i * 3 + 2] = T.color[2];
      S.size[i] = T.size[0] + (T.size[1] - T.size[0]) * f;
      S.alpha[i] = T.alpha * (T.add ? 1 - f : Math.sin(Math.PI * Math.min(1, f * 1.4)) * (1 - f));
    }
    for (const [S, cnt] of [
      [N, n],
      [A, Math.min(a, aMax)],
    ]) {
      S.geo.setDrawRange(0, cnt);
      for (const k of ['position', 'color', 'size', 'alpha']) S.geo.attributes[k].needsUpdate = true;
    }
  }

  setViewport(height) {
    const s = height * 0.9;
    this.normal.pts.material.uniforms.scale.value = s;
    this.additive.pts.material.uniforms.scale.value = s;
  }
}

// Эмиссия от машины игрока по её состоянию (за кадр dt).
export function emitFromCar(fx, car, track, dt, { wet = false, offType = 'dust', f1 = false } = {}) {
  const spec = car.spec;
  const v = Math.hypot(car.u, car.v);
  const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
  const a = spec.wheelbase * (1 - spec.weightFront), b = spec.wheelbase * spec.weightFront;
  const tw = spec.dims.track / 2;
  const wheel = (w) => {
    const lx = w < 2 ? a : -b, ly = w % 2 === 0 ? tw : -tw;
    return [car.x + lx * sp + ly * cp, car.y + 0.25, car.z + lx * cp - ly * sp];
  };
  const back = [-sp * v * 0.15, 0.4, -cp * v * 0.15];
  // дым: блокировка/ABS на скорости, занос, пробуксовка
  const slide = Math.max(car.over, car.under * 0.7);
  const smokeRate = (car.abs && v > 12 ? 40 : 0) + (slide > 0.35 ? 60 * slide : 0) + (car.wheelspin ? 50 : 0);
  if (smokeRate > 0 && v > 3) {
    const n = smokeRate * dt;
    for (let k = 0; k < n + (Math.random() < n % 1 ? 1 : 0); k++) {
      const w = car.wheelspin || car.over > 0.3 ? 2 + (k % 2) : k % 4;
      const [x, y, z] = wheel(w);
      fx.emit('smoke', x, y, z, back[0], back[1], back[2], 1.5);
    }
  }
  // пыль, песок, камешки из-под колёс вне трассы (тип — из покрытия, surfaces.js)
  for (let w = 0; w < 4; w++) {
    const dust = car.wheels?.[w]?.S?.dust;
    if (!dust || v < 4) continue;
    if (Math.random() < dt * (dust === 'gravel' ? 40 : 30)) {
      const [x, y, z] = wheel(w);
      const type = dust === 'dust' ? offType : dust;
      fx.emit(type, x, y, z, back[0], back[1] + 0.6, back[2], 2);
    }
  }
  // брызги на мокром асфальте — из-под задних колёс, назад
  if (wet && v > 16) {
    const n = dt * v * 0.5;
    for (let k = 0; k < n; k++) {
      const [x, y, z] = wheel(2 + (k % 2));
      fx.emit('spray', x, y - 0.1, z, back[0] * 1.5, 0.8, back[2] * 1.5, 1.2);
    }
  }
  // искры от днища F1 на большой скорости (прижим сажает машину на планку)
  if (f1 && v > 70 && Math.abs(track.kappa[car.idx]) < 1 / 500 && Math.random() < dt * 14) {
    for (let k = 0; k < 6; k++) fx.emit('spark', car.x - sp * 1.8, car.y + 0.05, car.z - cp * 1.8, -sp * v * 0.4, 1.5, -cp * v * 0.4, 3);
  }
}

// Искры при скрежете о стену: side — сторона стены (1 левая, −1 правая).
export function emitWallSparks(fx, car, side, speed) {
  const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
  const lx = cp * side, lz = -sp * side;
  const n = Math.min(14, 3 + speed * 0.4);
  for (let k = 0; k < n; k++) {
    const along = (Math.random() - 0.5) * 3;
    fx.emit('spark', car.x + lx * 1.0 + sp * along, car.y + 0.4, car.z + lz * 1.0 + cp * along, -sp * speed * 0.3 + lx * 2, 2 + Math.random() * 3, -cp * speed * 0.3 + lz * 2, 4);
  }
}
