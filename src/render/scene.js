// 3D-основа: один WebGL2-контекст, сцена, камера, солнце с тенью, небо, окружение (PMREM), туман.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const DEG = Math.PI / 180;

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
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    r.setPixelRatio(this.pixelRatio);

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

    // --- небо ---
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.material.fog = false;
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envRT = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // env: { sky: {turbidity, rayleigh, mie, mieG, elevation, azimuth}, sun: {color, intensity},
  //        hemi: {sky, ground, intensity}, fog: {color, near, far}, exposure, far }
  setEnvironment(env) {
    const s = env.sky || {};
    const u = this.sky.material.uniforms;
    u.turbidity.value = s.turbidity ?? 6;
    u.rayleigh.value = s.rayleigh ?? 1.5;
    u.mieCoefficient.value = s.mie ?? 0.005;
    u.mieDirectionalG.value = s.mieG ?? 0.8;
    const phi = (90 - (s.elevation ?? 35)) * DEG;
    const theta = (s.azimuth ?? 150) * DEG;
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky.visible = true;

    this.sun.color.set(env.sun?.color ?? 0xffffff);
    this.sun.intensity = env.sun?.intensity ?? 3;
    this.hemi.color.set(env.hemi?.sky ?? 0xcfe3ff);
    this.hemi.groundColor.set(env.hemi?.ground ?? 0x4a5a38);
    this.hemi.intensity = env.hemi?.intensity ?? 0.7;
    const f = env.fog || {};
    this.scene.fog = new THREE.Fog(f.color ?? 0xc8d8e8, f.near ?? 300, f.far ?? 2200);
    this.renderer.toneMappingExposure = env.exposure ?? 1;
    this.camera.far = env.far ?? 2500;
    this.camera.updateProjectionMatrix();
    this.bakeEnvironment();
  }

  // Environment map для отражений на кузове — из того же неба через PMREM.
  bakeEnvironment() {
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(50);
    const src = this.sky.material.uniforms, dst = sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) dst[k].value = src[k].value;
    dst.sunPosition.value.copy(src.sunPosition.value);
    envScene.add(sky);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    sky.geometry.dispose();
    sky.material.dispose();
  }

  // Солнце и его теневая камера следуют за машиной игрока.
  followSun(pos) {
    this.sun.position.set(pos.x + this.sunDir.x * 150, pos.y + this.sunDir.y * 150, pos.z + this.sunDir.z * 150);
    this.sun.target.position.copy(pos);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
