// Пресеты графики и автоподбор.
//  Низкая: без теней и bloom, pixelRatio 1, меньше объектов и огней.
//  Средняя: тени 1024, bloom, FXAA.  Высокая: тени 2048, bloom, SMAA, размытие на скорости.
// Авто: стартуем с высокой (на слабых устройствах — со средней) и понижаем, если средний FPS
// за 3 секунды ниже 45. Цель — 60 FPS вместе с распознаванием рук.
import { presets } from './scene.js';

const ORDER = ['low', 'medium', 'high'];
const WINDOW = 3; // с
const MIN_FPS = 45;

export function weakDevice() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || mem <= 4 || cores <= 4;
}

export class QualityManager {
  // apply(preset) — применить пресет к рендеру/миру; onAuto(preset, fps) — сообщить о понижении
  constructor({ apply, onAuto }) {
    this.apply = apply;
    this.onAuto = onAuto;
    this.mode = 'auto';
    this.current = null;
    this.frames = 0;
    this.time = 0;
    this.cooldown = 0;
  }

  // mode: 'auto' | 'low' | 'medium' | 'high'
  setMode(mode) {
    this.mode = mode;
    const id = mode === 'auto' ? (weakDevice() ? 'medium' : 'high') : mode;
    this.set(id);
  }

  set(id) {
    const p = presets()[id];
    this.current = p;
    this.frames = 0;
    this.time = 0;
    this.cooldown = WINDOW;
    this.apply(p);
  }

  // Каждый кадр во время езды. active — идёт гонка/квала (в меню не меряем).
  update(dt, active) {
    if (this.mode !== 'auto' || !active || document.hidden) {
      this.frames = 0;
      this.time = 0;
      return;
    }
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    this.frames++;
    this.time += dt;
    if (this.time < WINDOW) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    const k = ORDER.indexOf(this.current.id);
    if (fps < MIN_FPS && k > 0) {
      this.set(ORDER[k - 1]);
      this.onAuto?.(this.current, fps);
    }
  }
}
