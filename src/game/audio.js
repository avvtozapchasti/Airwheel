// Звук целиком синтезируется через Web Audio API — никаких аудиофайлов.
//  - двигатель: два осциллятора + шум через фильтр, частота — от оборотов и передачи;
//    GT3 — низкий рык (субоктава), F1 — высокий визг (вторая гармоника и турбо-свист);
//  - переключение передач (провал и «подхват» оборотов), визг тормозов при работе ABS,
//    визг шин в заносе, ветер от скорости, вибрация поребрика, удары и скрежет о стену;
//  - ближайший соперник — отдельный голос со стерео-панорамой;
//  - сигналы старта, круга и финиша, кнопка mute.

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
    this.lastGear = 0;
  }

  // Вызывать из обработчика клика: браузеры не дают звук без жеста пользователя.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch(() => {});
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
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(comp);

    // общий буфер белого шума (2 с)
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = () => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start(0, Math.random() * 1.5);
      return s;
    };

    // --- двигатель ---
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 2.5;
    this.osc1 = c.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = c.createOscillator();
    this.osc2.type = 'square';
    this.osc2Gain = c.createGain();
    this.osc2Gain.gain.value = 0.5;
    this.rasp = c.createBiquadFilter();
    this.rasp.type = 'bandpass';
    this.rasp.Q.value = 3;
    this.raspGain = c.createGain();
    this.raspGain.gain.value = 0.25;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(this.osc2Gain).connect(this.engFilter);
    noiseSrc().connect(this.rasp).connect(this.raspGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    // турбо-свист (для F1)
    this.turbo = c.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = c.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();
    this.turbo.start();

    // --- шумы: ветер, тормоза, шины, поребрик ---
    const loop = (type, freq, q) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      noiseSrc().connect(f).connect(g).connect(this.master);
      return { f, g };
    };
    this.wind = loop('lowpass', 700, 0.7);
    this.squeal = loop('bandpass', 2600, 9);
    this.scrub = loop('bandpass', 1100, 3);
    this.rumble = c.createGain();
    this.rumble.gain.value = 0;
    const rOsc = c.createOscillator();
    rOsc.type = 'square';
    rOsc.frequency.value = 26;
    rOsc.connect(this.rumble).connect(this.master);
    rOsc.start();

    // --- соседняя машина ---
    this.botOsc = c.createOscillator();
    this.botOsc.type = 'sawtooth';
    this.botFilter = c.createBiquadFilter();
    this.botFilter.type = 'lowpass';
    this.botFilter.frequency.value = 900;
    this.botGain = c.createGain();
    this.botGain.gain.value = 0;
    this.botPan = c.createStereoPanner ? c.createStereoPanner() : null;
    this.botOsc.connect(this.botFilter).connect(this.botGain);
    if (this.botPan) this.botGain.connect(this.botPan).connect(this.master);
    else this.botGain.connect(this.master);
    this.botOsc.start();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORE_KEY, m ? '1' : '0');
    } catch {
      /* приватный режим */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  // Каждый кадр. s: { active, rpm, spec, throttle, speed, abs, slide, kerb, boost, gear, nearest: {dist, pan, speed} }
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const T = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);
    if (!s.active) {
      for (const g of [this.engGain.gain, this.wind.g.gain, this.squeal.g.gain, this.scrub.g.gain, this.rumble.gain, this.botGain.gain, this.turboGain.gain]) T(g, 0, 0.15);
      return;
    }
    const spec = s.spec;
    const f1 = spec.sound?.character === 'whine';
    const cyl = spec.sound?.cylinders ?? 6;
    const rpmK = (s.rpm - spec.rpm.idle) / (spec.rpm.max - spec.rpm.idle);
    // частота вспышек в цилиндрах: об/мин / 60 · (цилиндры / 2)
    const fire = (s.rpm / 60) * (cyl / 2) * (spec.sound?.base ?? 1);
    T(this.osc1.frequency, fire, 0.03);
    if (f1) {
      this.osc2.type = 'triangle';
      T(this.osc2.frequency, fire * 2, 0.03);
      T(this.osc2Gain.gain, 0.45);
      T(this.turbo.frequency, 2600 + rpmK * 3400, 0.08);
      T(this.turboGain.gain, 0.006 + s.throttle * 0.01 * rpmK);
    } else {
      this.osc2.type = 'square';
      T(this.osc2.frequency, fire / 2, 0.03);
      T(this.osc2Gain.gain, 0.6);
      T(this.turboGain.gain, 0);
    }
    T(this.rasp.frequency, fire * 3);
    T(this.engFilter.frequency, (f1 ? 700 : 350) + s.throttle * (f1 ? 3200 : 1800) + rpmK * (f1 ? 2500 : 1500), 0.06);
    T(this.engGain.gain, 0.035 + s.throttle * 0.05 + rpmK * 0.03 + (s.boost ? 0.02 : 0), 0.05);
    // переключение: короткий провал громкости
    if (s.gear !== this.lastGear) {
      if (s.gear > this.lastGear) {
        this.engGain.gain.cancelScheduledValues(t);
        this.engGain.gain.setValueAtTime(this.engGain.gain.value * 0.35, t);
        this.engGain.gain.setTargetAtTime(0.035 + s.throttle * 0.05, t + 0.05, 0.04);
        this.noiseBurst(0.06, 1800, 0.05, 'bandpass');
      }
      this.lastGear = s.gear;
    }
    const v = s.speed / (spec.vmax || 80);
    T(this.wind.g.gain, 0.12 * v * v, 0.1);
    T(this.wind.f.frequency, 400 + v * 900);
    T(this.squeal.g.gain, s.abs && s.speed > 10 ? 0.07 : 0, 0.04);
    T(this.scrub.g.gain, Math.min(0.09, s.slide * 0.12) * Math.min(1, s.speed / 15), 0.05);
    T(this.rumble.gain, s.kerb && s.speed > 5 ? 0.05 : 0, 0.03);
    // ближайший соперник
    const nb = s.nearest;
    if (nb && nb.dist < 60) {
      const k = 1 - nb.dist / 60;
      T(this.botGain.gain, 0.03 * k * k, 0.08);
      T(this.botOsc.frequency, (f1 ? 220 : 90) + (nb.speed / (spec.vmax || 80)) * (f1 ? 420 : 260), 0.08);
      if (this.botPan) T(this.botPan.pan, Math.max(-1, Math.min(1, nb.pan)), 0.08);
    } else T(this.botGain.gain, 0, 0.2);
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
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // Сигнал огня на старте; final — «огни погасли».
  countdownBeep(final) {
    this.tone(final ? 880 : 440, final ? 0.5 : 0.22, 'square', 0.16);
  }

  nitro() {
    this.noiseBurst(0.9, 400, 0.3, 'bandpass', 4000);
    this.tone(200, 0.8, 'sawtooth', 0.06, 0, 900);
  }

  // Удар: громкость и глубина — от скорости удара.
  crash(strength = 1) {
    const k = Math.max(0.3, Math.min(1.5, strength));
    this.noiseBurst(0.35 * k, 1400, 0.45 * k, 'lowpass', 150);
    this.tone(90, 0.3, 'sine', 0.45 * k, 0, 40);
  }

  scrape() {
    this.noiseBurst(0.12, 3200, 0.08, 'bandpass');
  }

  lap() {
    this.tone(660, 0.12, 'triangle', 0.18);
    this.tone(990, 0.2, 'triangle', 0.18, 0.12);
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.18, i * 0.12));
  }

  ok() {
    this.tone(880, 0.12, 'sine', 0.13);
  }
}
