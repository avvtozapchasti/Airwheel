// Камеры: за машиной (по умолчанию, динамический FOV и лёгкая тряска от скорости),
// капот/кокпит, телекамера сбоку. Плюс служебные: облёт решётки и облёт подиума.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'hood', 'tv'];
export const CAMERA_NAMES = { chase: 'За машиной', hood: 'Капот', tv: 'ТВ-камера' };

const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();

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
      const L = target.dims?.length ?? 4.6;
      const dist = L * 1.25 + 2.6 + k * 1.2;
      const height = 1.9 + L * 0.08;
      tmp.copy(target.pos).addScaledVector(fwd, -dist);
      tmp.y += height;
      // камера не проваливается под дорогу на спусках
      tmp.y = Math.max(tmp.y, target.pos.y + 1.2);
      const stiff = this.snap ? 1 : 1 - Math.exp(-dt * (8 + k * 6));
      this.pos.lerp(tmp, stiff);
      tmp.copy(target.pos).addScaledVector(fwd, 6 + k * 6);
      tmp.y += 0.9;
      this.look.lerp(tmp, this.snap ? 1 : 1 - Math.exp(-dt * 14));
      fovTarget = 60 + 16 * k * k;
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

    // тряска: лёгкая от скорости + удары
    const shakeAmp = 0.012 * k * k + (target.shake || 0) * 0.25;
    cam.position.copy(this.pos);
    if (shakeAmp > 0.0005) {
      const t = this.t;
      cam.position.x += Math.sin(t * 37.1) * shakeAmp;
      cam.position.y += Math.sin(t * 43.7 + 1.3) * shakeAmp;
      cam.position.z += Math.sin(t * 31.3 + 2.1) * shakeAmp;
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
