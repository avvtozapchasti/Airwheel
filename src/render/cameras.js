// Камеры: за машиной (по умолчанию: пружина, запаздывание в поворотах, FOV от скорости, тряска),
// капот/кокпит, телекамера сбоку. Плюс служебные: облёт решётки и облёт подиума.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'hood', 'tv'];
export const CAMERA_NAMES = { chase: 'За машиной', hood: 'Капот', tv: 'ТВ-камера' };

const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
const acc = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 62;
    this.t = 0;
    this.snap = true;
    this.tvIndex = -1;
    this.tvPos = new THREE.Vector3();
    this.script = null; // облёт решётки и т. п.
    this.vel = new THREE.Vector3();
    this.rel = new THREE.Vector3();
    this.yaw = 0;
    this.zoom = 0;
  }

  setMode(mode) {
    this.mode = mode;
    this.snap = true;
    this.tvIndex = -1;
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  // target: { pos: Vector3, heading, pitch, roll, speed, vmax, shake, dims: {length, height} }
  // track — для ТВ-камер.
  update(dt, target, track) {
    this.t += dt;
    const cam = this.cam;
    const v = Math.max(0, target.speed);
    const k = Math.min(1.2, v / (target.vmax || 80));
    fwd.set(Math.sin(target.heading), 0, Math.cos(target.heading));

    if (this.script) {
      this.script.update(dt, cam);
      this.snap = true;
      return;
    }

    let fovTarget = 62;
    if (this.mode === 'chase') {
      // Chase-камера: ниже и ближе к машине, пружина с демпфированием, запаздывание по курсу
      // в поворотах, приближение при торможении, отъезд при разгоне и ускорении,
      // FOV 60° → 85° от скорости.
      const L = target.dims?.length ?? 4.6;
      const f1 = L > 5;
      if (this.snap) {
        this.yaw = target.heading;
        this.zoom = 0;
        this.vel.set(0, 0, 0);
      }
      // курс камеры догоняет курс машины с задержкой — в повороте машина «уходит» вбок
      let dy = target.heading - this.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaw += dy * (1 - Math.exp(-dt * (5.5 + k * 3)));
      const cf = Math.sin(this.yaw), cfz = Math.cos(this.yaw);
      // торможение — ближе, разгон/ускорение — дальше (плавно)
      const ax = target.ax ?? 0;
      const zoomT = Math.max(-1, Math.min(1, -ax / 14)) * 0.55 - (target.boost ? 0.7 : 0);
      this.zoom += (zoomT - this.zoom) * (1 - Math.exp(-dt * 3));
      const dist = (f1 ? 6.9 : 6.3) + k * 1.0 - this.zoom;
      const height = (f1 ? 1.5 : 1.68) + k * 0.12;
      // пружина — на смещении камеры относительно машины: скорость не даёт отставания,
      // а повороты курса и прыжки по высоте сглаживаются
      tmp.set(-cf * dist, height, -cfz * dist);
      if (this.snap) this.rel.copy(tmp);
      else {
        const kS = 70, cS = 2 * Math.sqrt(kS);
        acc.copy(tmp).sub(this.rel).multiplyScalar(kS).addScaledVector(this.vel, -cS);
        this.vel.addScaledVector(acc, dt);
        this.rel.addScaledVector(this.vel, dt);
      }
      this.pos.copy(target.pos).add(this.rel);
      this.pos.y = Math.max(this.pos.y, target.pos.y + 1.0);
      tmp.copy(target.pos);
      tmp.x += Math.sin(target.heading) * (5 + k * 6);
      tmp.z += Math.cos(target.heading) * (5 + k * 6);
      tmp.y += 0.75;
      this.look.lerp(tmp, this.snap ? 1 : 1 - Math.exp(-dt * 12));
      fovTarget = 60 + 25 * Math.pow(Math.min(1, k), 1.3) + (target.boost ? 4 : 0);
    } else if (this.mode === 'hood') {
      const L = target.dims?.length ?? 4.6;
      tmp.copy(target.pos).addScaledVector(fwd, target.dims?.hood ?? L * 0.08);
      tmp.y += target.dims?.eye ?? 1.1;
      this.pos.copy(tmp);
      tmp.copy(target.pos).addScaledVector(fwd, 30);
      tmp.y += (target.dims?.eye ?? 1.1) - 0.3 + Math.tan(target.pitch || 0) * 30;
      this.look.copy(tmp);
      fovTarget = 68 + 12 * k * k;
    } else if (this.mode === 'tv' && track) {
      // ближайшая «вышка» впереди-сбоку; меняем, когда машина уехала далеко
      const step = 160;
      const sNow = target.s ?? 0;
      const idx = Math.floor((sNow + step * 0.6) / step);
      if (idx !== this.tvIndex) {
        this.tvIndex = idx;
        const s = idx * step;
        const side = idx % 2 ? 1 : -1;
        const i = track.index(s);
        const off = side * (track.hw[i] + 12);
        const p = track.pointAt(s, off);
        this.tvPos.set(p.x, p.y + 5 + (idx % 3), p.z);
      }
      this.pos.copy(this.tvPos);
      tmp.copy(target.pos);
      tmp.y += 0.6;
      this.look.lerp(tmp, this.snap ? 1 : 1 - Math.exp(-dt * 10));
      const dist = this.pos.distanceTo(target.pos);
      fovTarget = THREE.MathUtils.clamp((2 * Math.atan(9 / Math.max(10, dist)) * 180) / Math.PI, 8, 55);
    }
    this.snap = false;

    // тряска: микротряска от скорости, вибрация на поребрике и траве, сильная короткая при ударе
    const rumble = (target.rumble || 0) * Math.min(1, v / 12);
    const shake = target.shake || 0;
    cam.position.copy(this.pos);
    const t = this.t;
    const micro = 0.006 * k * k, vib = rumble * 0.025, hit = shake * shake * 0.35;
    if (micro + vib + hit > 0.0005) {
      cam.position.x += Math.sin(t * 37.1) * micro + Math.sin(t * 71.3) * vib + Math.sin(t * 23.7) * hit;
      cam.position.y += Math.sin(t * 43.7 + 1.3) * micro + Math.sin(t * 89.1 + 0.7) * vib * 1.4 + Math.sin(t * 29.3 + 1.1) * hit;
      cam.position.z += Math.sin(t * 31.3 + 2.1) * micro + Math.sin(t * 19.9 + 2.4) * hit * 0.6;
    }
    cam.up.set(0, 1, 0);
    if (this.mode === 'hood') {
      // крен вместе с машиной
      cam.up.set(Math.cos(target.heading) * Math.sin(-(target.roll || 0)), 1, -Math.sin(target.heading) * Math.sin(-(target.roll || 0))).normalize();
    }
    cam.lookAt(this.look);
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}

// Облёт: камера движется по ключевым точкам [{pos, look, t}] с плавной интерполяцией.
export class FlyScript {
  constructor(keys, { loop = false, onEnd = null } = {}) {
    this.keys = keys;
    this.t = 0;
    this.loop = loop;
    this.onEnd = onEnd;
    this.duration = keys[keys.length - 1].t;
    this.done = false;
  }

  update(dt, cam) {
    this.t += dt;
    let t = this.t;
    if (t >= this.duration) {
      if (this.loop) t = this.t = t % this.duration;
      else {
        t = this.duration;
        if (!this.done) {
          this.done = true;
          this.onEnd?.();
        }
      }
    }
    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && k[i + 1].t < t) i++;
    const a = k[i], b = k[i + 1] || a;
    const f = b.t > a.t ? THREE.MathUtils.smoothstep(t, a.t, b.t) : 1;
    cam.position.lerpVectors(a.pos, b.pos, f);
    tmp.lerpVectors(a.look, b.look, f);
    cam.up.set(0, 1, 0);
    cam.lookAt(tmp);
    const fov = (a.fov ?? 55) + ((b.fov ?? 55) - (a.fov ?? 55)) * f;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
