// Звук целиком синтезируется через Web Audio API — никаких аудиофайлов.
// Двигатель (высота зависит от скорости), визг тормозов, нитро, удар, сигналы старта.

const STORE_KEY = 'airwheel.muted';

function loadMuted() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
  }

  // Вызывать из обработчика клика: браузеры не дают звук без жеста пользователя.
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(c.destination);

    // двигатель: пила + квадрат на октаву ниже через фильтр
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.osc1 = c.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = c.createOscillator();
    this.osc2.type = 'square';
    this.osc1.connect(this.engineFilter);
    const sub = c.createGain();
    sub.gain.value = 0.5;
    this.osc2.connect(sub).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // общий буфер белого шума
    this.noise = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // визг/шум тормозов — постоянный источник, громкость управляется
    this.skidGain = c.createGain();
    this.skidGain.gain.value = 0;
    const skidSrc = c.createBufferSource();
    skidSrc.buffer = this.noise;
    skidSrc.loop = true;
    const skidBp = c.createBiquadFilter();
    skidBp.type = 'bandpass';
    skidBp.frequency.value = 2400;
    skidBp.Q.value = 6;
    skidSrc.connect(skidBp).connect(this.skidGain).connect(this.master);
    skidSrc.start();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORE_KEY, m ? '1' : '0');
    } catch {
      /* приватный режим */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  // Каждый кадр: speedPct 0..1.3, braking, nitro, active — идёт ли гонка.
  update(speedPct, braking, nitro, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 42 + speedPct * 150 + (nitro ? 25 : 0);
    this.osc1.frequency.setTargetAtTime(base, t, 0.05);
    this.osc2.frequency.setTargetAtTime(base / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(350 + speedPct * 2200, t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + 0.07 * Math.min(1, speedPct) : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(active && braking && speedPct > 0.2 ? 0.08 : 0, t, 0.05);
  }

  tone(freq, dur, type = 'square', vol = 0.2, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, freq, vol, type = 'lowpass', sweepTo = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  countdownBeep(final) {
    this.tone(final ? 880 : 440, final ? 0.6 : 0.25, 'square', 0.18);
  }

  nitro() {
    this.noiseBurst(0.9, 400, 0.35, 'bandpass', 4000);
    this.tone(200, 0.8, 'sawtooth', 0.08, 0, 900);
  }

  crash() {
    this.noiseBurst(0.35, 1200, 0.5, 'lowpass', 200);
    this.tone(90, 0.3, 'sine', 0.5, 0, 40);
  }

  lap() {
    this.tone(660, 0.12, 'triangle', 0.2);
    this.tone(990, 0.2, 'triangle', 0.2, 0.12);
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, i * 0.12));
  }

  ok() {
    this.tone(880, 0.12, 'sine', 0.15);
  }
}
