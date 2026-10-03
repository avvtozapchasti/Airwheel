// 3D-основа: один WebGL2-контекст, сцена, камера, солнце с тенью, небо (дневное Sky или ночное
// со звёздами), окружение для отражений (PMREM), туман, постобработка:
// Bloom, радиальное размытие на скорости, виньетка, ACES tone mapping, sRGB, FXAA/SMAA.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const DEG = Math.PI / 180;

// Ночное небо: градиент, свечение города у горизонта, звёзды, луна.
function nightSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(0x2b2238) },
      zenith: { value: new THREE.Color(0x03050d) },
      moonDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
      stars: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // всегда на дальней плоскости
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon, zenith, moonDir;
      uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
        col += horizon * 0.7 * exp(-max(h, 0.0) * 14.0);
        vec3 g = floor(d * 300.0);
        float st = step(0.9975, hash(g)) * smoothstep(0.04, 0.25, h) * stars;
        col += vec3(st) * (0.5 + 0.8 * hash(g + 1.7));
        float m = max(dot(d, moonDir), 0.0);
        col += vec3(0.9, 0.93, 1.0) * (smoothstep(0.99935, 0.9996, m) * 3.0 + pow(m, 300.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// Финальный проход: радиальное размытие по краям на скорости + виньетка (в линейном цвете).
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    blur: { value: 0 },
    vignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float blur, vignette;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5, 0.52);
      float d = length(dir);
      vec4 col = texture2D(tDiffuse, vUv);
      if (blur > 0.001) {
        float k = blur * smoothstep(0.18, 0.75, d);
        vec4 acc = col;
        for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - dir * k * float(i) * 0.03);
        col = acc / 6.0;
      }
      col.rgb *= mix(1.0, smoothstep(1.0, 0.3, d), vignette);
      gl_FragColor = col;
    }`,
};

// Пресеты графики. density/terrainCell применяются при загрузке трассы, остальное — сразу.
export function presets() {
  const dpr = window.devicePixelRatio || 1;
  return {
    low: { id: 'low', name: 'Низкая', pixelRatio: 1, shadows: 0, post: false, bloom: false, aa: 'msaa', motionBlur: false, lodScale: 0.55, density: 0.45, terrainCell: 16, realLights: 2, farScale: 0.7 },
    medium: { id: 'medium', name: 'Средняя', pixelRatio: Math.min(1.25, dpr), shadows: 1024, post: true, bloom: true, aa: 'fxaa', motionBlur: false, lodScale: 0.8, density: 0.75, terrainCell: 12, realLights: 4, farScale: 0.85 },
    high: { id: 'high', name: 'Высокая', pixelRatio: Math.min(2, dpr), shadows: 2048, post: true, bloom: true, aa: 'smaa', motionBlur: true, lodScale: 1, density: 1, terrainCell: 10, realLights: 6, farScale: 1 },
  };
}

export class Graphics {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false; // считаем draw calls за весь кадр (с постобработкой)

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2500);
    this.scene.add(this.camera);

    // --- свет ---
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a38, 0.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // --- небо: дневное (Sky) и ночное ---
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.material.fog = false;
    this.scene.add(this.sky);
    this.nightSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), nightSkyMaterial());
    this.nightSky.scale.setScalar(15000);
    this.nightSky.frustumCulled = false;
    this.nightSky.visible = false;
    this.scene.add(this.nightSky);
    this.night = false;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envRT = null;

    // --- постобработка ---
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.9);
    this.final = new ShaderPass(FinalShader);
    this.output = new OutputPass();
    this.fxaa = new ShaderPass(FXAAShader);
    this.smaa = new SMAAPass(1, 1);
    for (const p of [this.renderPass, this.bloom, this.final, this.output, this.fxaa, this.smaa]) this.composer.addPass(p);
    this.speedBlur = 0;

    this.setQuality(presets().high);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Пресет качества: пиксели, тени, bloom, сглаживание, размытие.
  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    const shadows = q.shadows > 0;
    if (this.sun.castShadow !== shadows) {
      this.sun.castShadow = shadows;
      // смена числа теневых источников — перекомпиляция шейдеров
      this.scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    if (shadows && this.sun.shadow.mapSize.x !== q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.bloom.enabled = q.bloom;
    this.fxaa.enabled = q.aa === 'fxaa';
    this.smaa.enabled = q.aa === 'smaa';
    this.resize();
  }

  // env: { time, sky: {…} | {night, horizon, zenith, stars}, sun, hemi, fog, exposure, envIntensity, far, bloom }
  setEnvironment(env) {
    const s = env.sky || {};
    this.night = !!s.night;
    this.sky.visible = !this.night;
    this.nightSky.visible = this.night;
    const phi = (90 - (env.sun?.elevation ?? s.elevation ?? 35)) * DEG;
    const theta = (env.sun?.azimuth ?? s.azimuth ?? 150) * DEG;
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    if (this.night) {
      const u = this.nightSky.material.uniforms;
      u.horizon.value.set(s.horizon ?? 0x2b2238);
      u.zenith.value.set(s.zenith ?? 0x03050d);
      u.stars.value = s.stars ?? 1;
      u.moonDir.value.copy(this.sunDir);
    } else {
      const u = this.sky.material.uniforms;
      u.turbidity.value = s.turbidity ?? 6;
      u.rayleigh.value = s.rayleigh ?? 1.5;
      u.mieCoefficient.value = s.mie ?? 0.005;
      u.mieDirectionalG.value = s.mieG ?? 0.8;
      u.sunPosition.value.copy(this.sunDir);
      this.skyBase = u.rayleigh.value;
    }
    this.sun.color.set(env.sun?.color ?? 0xffffff);
    this.sun.intensity = env.sun?.intensity ?? 3;
    this.hemi.color.set(env.hemi?.sky ?? 0xcfe3ff);
    this.hemi.groundColor.set(env.hemi?.ground ?? 0x4a5a38);
    this.hemi.intensity = env.hemi?.intensity ?? 0.7;
    const f = env.fog || {};
    this.fogBase = { near: f.near ?? 300, far: f.far ?? 2200 };
    this.scene.fog = new THREE.Fog(f.color ?? 0xc8d8e8, this.fogBase.near, this.fogBase.far);
    this.renderer.toneMappingExposure = env.exposure ?? 1;
    this.scene.environmentIntensity = env.envIntensity ?? 0.4;
    this.farBase = env.far ?? 2500;
    this.applyFar();
    const b = env.bloom || {};
    // днём небо в HDR ярче 1 — порог высокий, светятся только блики и фары
    this.bloom.strength = b.strength ?? (this.night ? 0.6 : 0.22);
    this.bloom.radius = b.radius ?? (this.night ? 0.5 : 0.35);
    this.bloom.threshold = b.threshold ?? (this.night ? 0.85 : 2.2);
    this.final.uniforms.vignette.value = this.night ? 0.45 : 0.3;
    this.bakeEnvironment();
    // базовые значения для «дождевого» настроения (setRainMood)
    this.moodBase = {
      sun: this.sun.intensity,
      hemi: this.hemi.intensity,
      fogColor: this.scene.fog.color.clone(),
      fogNear: this.fogBase.near,
      fogFar: this.fogBase.far,
      exposure: this.renderer.toneMappingExposure,
      env: this.scene.environmentIntensity,
    };
    this.rainMood = -1;
    this.setRainMood(0);
  }

  // Дождь: солнце слабее, туман плотнее и серее, небо приглушено. k — сила дождя 0..1.
  setRainMood(k) {
    const B = this.moodBase;
    if (!B || Math.abs(k - this.rainMood) < 0.01) return;
    this.rainMood = k;
    this.sun.intensity = B.sun * (1 - 0.65 * k);
    this.hemi.intensity = B.hemi * (1 + 0.3 * k);
    const grey = this.night ? new THREE.Color(0x10131c) : new THREE.Color(0x8a96a4);
    this.scene.fog.color.copy(B.fogColor).lerp(grey, 0.7 * k);
    this.fogBase.near = B.fogNear * (1 - 0.6 * k);
    this.fogBase.far = B.fogFar * (1 - 0.55 * k);
    this.applyFar();
    this.renderer.toneMappingExposure = B.exposure * (1 - 0.12 * k);
    this.scene.environmentIntensity = B.env * (1 + 0.4 * k);
    if (this.sky.visible) this.sky.material.uniforms.rayleigh.value = (this.skyBase ?? (this.skyBase = this.sky.material.uniforms.rayleigh.value)) * (1 - 0.5 * k);
    // окружение для отражений перепекаем только при заметной смене (дорого, но редко)
    const oc = k > 0.25 ? 1 : 0;
    if (!this.night && oc !== (this.envOvercast ? 1 : 0)) this.bakeEnvironment(oc);
  }

  applyFar() {
    const k = this.quality?.farScale ?? 1;
    this.camera.far = this.farBase * k;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog && this.fogBase) this.scene.fog.far = this.fogBase.far * Math.max(0.8, k);
  }

  // Environment map для отражений на кузове и мокром асфальте — из неба через PMREM.
  // Ночью добавляем «огни города» вокруг, чтобы в лаке и лужах отражался свет.
  bakeEnvironment(overcast = 0) {
    const envScene = new THREE.Scene();
    const disposables = [];
    this.envOvercast = overcast;
    if (this.night) {
      const m = nightSkyMaterial();
      m.uniforms.horizon.value.copy(this.nightSky.material.uniforms.horizon.value);
      m.uniforms.zenith.value.copy(this.nightSky.material.uniforms.zenith.value);
      const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), m);
      envScene.add(sky);
      disposables.push(sky.geometry, m);
      const colors = [0xffc27a, 0xffe0b0, 0x9fd4ff, 0xff4d9d, 0x46e0ff, 0xffb060];
      for (let k = 0; k < 26; k++) {
        const a = (k / 26) * Math.PI * 2;
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[k % colors.length]).multiplyScalar(2.2) });
        const box = new THREE.Mesh(new THREE.BoxGeometry(3 + (k % 3), 2 + (k % 4) * 2, 1), mat);
        box.position.set(Math.cos(a) * 30, 1 + (k % 5), Math.sin(a) * 30);
        box.lookAt(0, 0, 0);
        envScene.add(box);
        disposables.push(box.geometry, mat);
      }
      // «фонари» сверху
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(30, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.5), side: THREE.DoubleSide }));
      lamp.position.set(0, 18, 0);
      lamp.rotation.x = Math.PI / 2;
      envScene.add(lamp);
      disposables.push(lamp.geometry, lamp.material);
    } else {
      const sky = new Sky();
      sky.scale.setScalar(50);
      const src = this.sky.material.uniforms, dst = sky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) dst[k].value = src[k].value;
      dst.sunPosition.value.copy(src.sunPosition.value);
      envScene.add(sky);
      disposables.push(sky.geometry, sky.material);
      // пасмурно: серый купол поверх неба — в мокром асфальте отражаются облака, а не синее небо
      if (overcast > 0) {
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(40, 24, 12),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aa5b2).multiplyScalar(0.9), side: THREE.BackSide, transparent: true, opacity: 0.85 * overcast, depthWrite: false, fog: false }),
        );
        envScene.add(dome);
        disposables.push(dome.geometry, dome.material);
      }
    }
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    for (const d of disposables) d.dispose();
  }

  // Солнце (луна) и его теневая камера следуют за машиной игрока.
  followSun(pos) {
    this.sun.position.set(pos.x + this.sunDir.x * 150, pos.y + this.sunDir.y * 150, pos.z + this.sunDir.z * 150);
    this.sun.target.position.copy(pos);
    this.sun.target.updateMatrixWorld();
  }

  // Сила радиального размытия (0..1) — от скорости, только на высоком пресете.
  setSpeedBlur(k) {
    this.speedBlur = this.quality.motionBlur ? k : 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  render(scene = this.scene, camera = this.camera) {
    this.renderer.info.reset();
    if (!this.quality.post) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.final.uniforms.blur.value = scene === this.scene ? this.speedBlur : 0;
    this.composer.render();
  }
}
