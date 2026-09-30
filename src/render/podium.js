// Подиум после гонки: отдельная маленькая сцена (тот же WebGL-контекст) — три блока,
// машины призёров, прожекторы, конфетти и медленный облёт камеры.
import * as THREE from 'three';
import { buildCarModel } from './carModel.js';
import * as TX from './textures.js';

export class Podium {
  constructor() {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0b0f1a);
    scene.fog = new THREE.Fog(0x0b0f1a, 30, 80);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.t = 0;
    this.models = [];

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.7, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // блоки: 2 — 1 — 3
    this.blocks = [];
    const H = [1.6, 1.1, 0.75];
    const X = [0, -5.6, 5.6];
    const colors = [0xffcc33, 0xc7ced9, 0xd08a4a];
    for (let k = 0; k < 3; k++) {
      const tex = TX.board(String(k + 1), { bg: '#1b2233', fg: '#' + colors[k].toString(16).padStart(6, '0'), w: 256, h: 256 });
      const mats = [
        new THREE.MeshStandardMaterial({ color: 0x232b3d, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0x232b3d, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: colors[k], roughness: 0.3, metalness: 0.6 }),
        new THREE.MeshStandardMaterial({ color: 0x232b3d }),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0x232b3d }),
      ];
      const b = new THREE.Mesh(new THREE.BoxGeometry(5, H[k], 5.2), mats);
      b.position.set(X[k], H[k] / 2, 0);
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
      this.blocks.push({ x: X[k], h: H[k] });
    }

    scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x101018, 0.6));
    const spot = new THREE.SpotLight(0xffffff, 900, 60, 0.55, 0.5, 1.6);
    spot.position.set(0, 18, 10);
    spot.target.position.set(0, 1, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    scene.add(spot, spot.target);
    for (const [x, c] of [
      [-14, 0xff4d8d],
      [14, 0x4db8ff],
    ]) {
      const s = new THREE.SpotLight(c, 500, 50, 0.5, 0.6, 1.5);
      s.position.set(x, 10, 6);
      s.target.position.set(0, 0, 0);
      scene.add(s, s.target);
    }

    // конфетти
    const N = 500;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    this.vel = new Float32Array(N);
    const palette = [0xffcc33, 0xff4d8d, 0x4db8ff, 0x33e07a, 0xffffff].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
      this.vel[i] = 1 + Math.random() * 1.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, toneMapped: false }));
    scene.add(this.confetti);
  }

  // top3: [{spec, color}] — призёры по местам.
  show(top3, environment) {
    this.clear();
    this.scene.environment = environment || null;
    top3.forEach((c, k) => {
      if (!c) return;
      const m = buildCarModel(c.spec, { color: c.color, player: true });
      const b = this.blocks[k];
      m.update({ x: b.x, y: b.h, z: 0, psi: Math.PI * 0.85 + (k === 1 ? 0.25 : k === 2 ? -0.25 : 0), pitch: 0, roll: 0, spin: 0, delta: 0.2, brake: 0 });
      this.scene.add(m.root);
      this.models.push(m);
    });
    this.t = 0;
  }

  clear() {
    for (const m of this.models) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.models = [];
  }

  update(dt, aspect) {
    this.t += dt;
    const a = Math.sin(this.t * 0.18) * 0.45;
    const r = 24;
    // подиум — в левой части кадра, справа от него карточка итогов
    const wide = aspect > 1.3;
    const off = wide ? 10 * Math.min(1.4, aspect / 1.78) : 0;
    this.camera.position.set(Math.sin(a) * r + off, 6 + Math.sin(this.t * 0.3) * 0.4, Math.cos(a) * r);
    this.camera.lookAt(off, 1.6, 0);
    if (Math.abs(this.camera.aspect - aspect) > 0.001) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const p = this.confetti.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - this.vel[i] * dt;
      if (y < 0) y += 14;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(this.t * 2 + i) * 0.004);
    }
    p.needsUpdate = true;
  }
}
