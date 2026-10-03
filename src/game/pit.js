// Пит-лейн и пит-стоп.
//
// Геометрия — в координатах трассы (s вдоль центра, d поперёк, d > 0 — слева):
//   въезд (сужение TAPER_IN) → линия ограничения 60 км/ч → боксы → линия → выезд (TAPER_OUT).
//   Между трассой и пит-лейном — стенка (двусторонняя, physics.js), снаружи — фасад боксов
//   (на этот участок стена трассы отодвигается). Покрытие в пит-лейне — 'pit'.
//
// Пит-стоп игрока (PlayerPit): игрок сам решает заехать (окно выбора шин в HUD), заезжает в
// пит-лейн, держит 60 км/ч (за превышение на линии — +3 с), останавливается в своём боксе
// (ладони) — машина удерживается, механики меняют шины 2.5–4 с, затем кулаки — выезд.
// С помощью рулём машину мягко ведёт к въезду и тормозит у бокса.
import { clamp, smoothstep } from '../util/rng.js';
import { fitTires, COMPOUNDS } from './tires.js';

export const PIT_LIMIT = 60 / 3.6; // м/с
export const PIT_LIMIT_KMH = 60;
const TAPER_IN = 75;
const TAPER_OUT = 65;
const GAP = 1.6; // от края асфальта до центра стенки пит-лейна, м
const LANE = 12; // ширина пит-лейна: быстрая полоса 6 м + рабочая 6 м
const BOX_STEP = 8; // шаг боксов, м

export class PitLane {
  // def: { side: 'left'|'right', from: м до линии старта (отрицательное), to: м после, boxes }
  constructor(track, def) {
    this.track = track;
    this.side = def.side === 'left' ? 1 : def.side === 'right' ? -1 : def.side || 1;
    this.len = (def.to ?? 200) - (def.from ?? -250);
    this.sIn = track.wrapS(def.from ?? -250);
    this.sOut = track.wrapS(this.sIn + this.len);
    this.wallA = TAPER_IN;
    this.wallB = this.len - TAPER_OUT;
    this.limA = TAPER_IN + 8; // линия ограничения скорости (въезд)
    this.limB = this.len - TAPER_OUT - 8; // линия (выезд)
    this.boxCount = def.boxes ?? 12;
    this.boxStep = Math.min(BOX_STEP, (this.limB - this.limA - 40) / this.boxCount);
    this.box0 = (this.limA + this.limB) / 2 - (this.boxStep * (this.boxCount - 1)) / 2;
    this.lane = LANE;
    this.gap = GAP;
    // отодвигаем стену трассы на стороне пит-лейна до фасада боксов (с плавным переходом)
    const n = track.n;
    const walls = this.side > 0 ? track.wallL : track.wallR;
    for (let i = 0; i < n; i++) {
      const s = i * track.ds;
      let u = this.rel(s);
      if (u > track.length / 2) u -= track.length; // до въезда — отрицательное
      const k = Math.min(smoothstep(-40, 0, u), 1 - smoothstep(this.len, this.len + 40, u));
      if (k <= 0) continue;
      const outer = track.hw[i] + this.outerD(i) + 0.4;
      walls[i] = Math.max(walls[i], walls[i] + (outer - walls[i]) * k);
    }
  }

  // Расстояние вдоль трассы от въезда (0..L).
  rel(s) {
    const L = this.track.length;
    return ((((s - this.sIn) % L) + L) % L);
  }

  inRange(s) {
    return this.rel(s) <= this.len;
  }

  hwAt(s) {
    return this.track.hw[this.track.index(s)];
  }

  // Поперечные границы (от края асфальта, в сторону пит-лейна).
  outerD() {
    return GAP + 0.3 + LANE;
  }

  wallD(s) {
    return this.hwAt(s) + GAP;
  }

  fastD(s) {
    return this.hwAt(s) + GAP + 0.3 + 3;
  }

  workD(s) {
    return this.hwAt(s) + GAP + 0.3 + 9;
  }

  // Центр пути по пит-лейну (со знаком d), с плавными съездом и возвратом. Перед въездом —
  // плавный переход с гоночной траектории к краю трассы со стороны пит-лейна.
  pathD(s) {
    const u = this.rel(s);
    const edge = this.hwAt(s) - 2.2;
    let x;
    if (u > this.len) {
      const line = (this.track.racingLine?.offset[this.track.index(s)] ?? 0) * this.side;
      x = line + (edge - line) * smoothstep(this.track.length - 260, this.track.length - 70, u);
    }
    else if (u < TAPER_IN) x = edge + (this.fastD(s) - edge) * smoothstep(0, TAPER_IN, u);
    else if (u > this.len - TAPER_OUT) x = edge + (this.fastD(s) - edge) * (1 - smoothstep(this.len - TAPER_OUT, this.len, u));
    else x = this.fastD(s);
    return this.side * x;
  }

  // Путь к боксу k: с быстрой полосы — в рабочую за 22 м до бокса и обратно после.
  boxPathD(s, k) {
    const u = this.rel(s), b = this.boxRel(k);
    const fast = this.fastD(s), work = this.workD(s);
    const into = smoothstep(b - 26, b - 6, u) * (1 - smoothstep(b + 8, b + 26, u));
    return this.side * (this.pathD(s) * this.side + (work - fast) * into);
  }

  boxRel(k) {
    return this.box0 + k * this.boxStep;
  }

  boxS(k) {
    return this.track.wrapS(this.sIn + this.boxRel(k));
  }

  // Покрытие 'pit' — между краем асфальта и фасадом боксов на участке пит-лейна.
  surfaceAt(i, d) {
    const s = i * this.track.ds;
    if (!this.inRange(s)) return false;
    const x = d * this.side;
    return x > this.track.hw[i] && x < this.track.hw[i] + this.outerD() + 0.3;
  }

  nearWall(s, reach) {
    let u = this.rel(s);
    if (u > this.track.length / 2) u -= this.track.length;
    return u >= this.wallA - reach && u <= this.wallB + reach;
  }

  // Стенка между трассой и пит-лейном: {d} — смещение её центра в сторону пит-лейна.
  wallAt(s) {
    const u = this.rel(s);
    if (u < this.wallA || u > this.wallB) return null;
    return { d: this.wallD(s) };
  }

  // Машина в пит-лейне (за линией стенки).
  inLane(s, d) {
    return this.inRange(s) && d * this.side > this.hwAt(s) + 0.8;
  }

  inLimitZone(s) {
    const u = this.rel(s);
    return u >= this.limA && u <= this.limB;
  }

  // Эталонное время проезда этого участка по трассе на скорости профиля (для «потерь в пит-лейне»).
  refTime(prof) {
    const tr = this.track;
    let t = 0;
    for (let u = 0; u < this.len; u += tr.ds) t += tr.ds / Math.max(10, prof.v[tr.index(this.sIn + u)]);
    return t;
  }
}

// Пит-стоп игрока: фазы, удержание, смена шин, время потерь. События — через emit({type, ...}).
export class PlayerPit {
  constructor(lane, box, { emit = () => {}, prof = null } = {}) {
    this.lane = lane;
    this.box = box; // номер бокса игрока
    this.emit = emit;
    this.phase = 'track'; // track | lane | service | release | exit
    this.request = null; // выбранный состав, если игрок решил заехать
    this.stops = []; // [{lap, compound, time, loss}]
    this.penalized = false;
    this.ref = lane && prof ? lane.refTime(prof) : 20;
    this.t = 0;
  }

  get active() {
    return this.phase !== 'track';
  }

  // Окно выбора шин показывается на подъезде к въезду.
  windowOpen(car) {
    if (!this.lane || this.phase !== 'track') return false;
    const L = this.lane.track.length;
    const toIn = (((this.lane.sIn - car.s) % L) + L) % L;
    return toIn > 25 && toIn < 750;
  }

  // Цикл выбора жестом «большой палец»: Soft → Medium → Мокрые → отмена.
  cycle(suggest) {
    const order = ['soft', 'medium', 'wet', null];
    if (!this.request) this.request = suggest || 'medium';
    else this.request = order[(order.indexOf(this.request) + 1) % order.length];
    return this.request;
  }

  // Шаг: car — машина игрока, input — ввод; возвращает { input, frozen, limiter, lift, progress }.
  // time — время сессии, lap — текущий круг, assist — помощь рулём, steerTo(d) — руль к пути.
  update(dt, car, input, { time, lap, assist = 0.65, steerTo = null } = {}) {
    const L = this.lane;
    const out = { input, frozen: false, limiter: 0, lift: 0, progress: 0, pitLane: false };
    if (!L) return out;
    const u = L.rel(car.s);
    const inLane = L.inLane(car.s, car.d);
    const speed = Math.hypot(car.u, car.v);
    const toIn = L.track.length - u; // метров до въезда (когда въезд впереди)

    // ведём к въезду, если игрок решил заезжать (с помощью рулём), и заранее сбрасываем
    // скорость к линии 60 км/ч
    const approach = this.phase === 'track' && this.request && (toIn < 220 || u < L.wallA + 10);
    if (approach && assist > 0 && steerTo) {
      const k = Math.min(1, assist * 1.25);
      const g = steerTo((s) => L.pathD(s));
      const toLine = (u > L.len ? toIn : -u) + L.limA;
      const want = Math.sqrt(PIT_LIMIT * PIT_LIMIT + 2 * 6 * Math.max(0, toLine - 6));
      out.input = {
        ...input,
        steer: input.steer * (1 - k) + g * k,
        gas: input.gas && speed < want - 1,
        brake: input.brake || speed > want + 1,
      };
    }

    switch (this.phase) {
      case 'track':
        if (inLane && u < L.wallA + 30) {
          this.phase = 'lane';
          this.tIn = time;
          this.penalized = false;
          this.emit({ type: 'pit-enter' });
        }
        break;
      case 'lane':
      case 'exit': {
        out.pitLane = true;
        // ограничитель: в зоне 60 км/ч газ снимается, а лишняя скорость гасится тормозом
        if (L.inLimitZone(car.s)) {
          out.limiter = PIT_LIMIT;
          if (speed > PIT_LIMIT + 0.5) out.input = { ...out.input, gas: false, brake: true };
        }
        // превышение на линии въезда — штраф один раз за заезд
        if (this.phase === 'lane' && !this.penalized && u >= L.limA && u < L.limA + 4 && speed > PIT_LIMIT + 5 / 3.6) {
          this.penalized = true;
          this.emit({ type: 'pit-speed', speed });
        }
        const bRel = L.boxRel(this.box);
        // с помощью рулём — держим машину на полосе пит-лейна (въезд, проезд, выезд)
        if (assist > 0 && steerTo && !(this.phase === 'lane' && u > bRel - 40 && u < bRel + 6)) {
          const k = Math.min(1, assist * 1.25);
          const g = steerTo((s) => (this.phase === 'exit' ? L.boxPathD(s, this.box) : L.pathD(s)));
          out.input = { ...out.input, steer: out.input.steer * (1 - k) + g * k };
        }
        // до линии 60 км/ч — сбрасываем скорость заранее (с помощью рулём)
        if (this.phase === 'lane' && assist > 0 && u < L.limA) {
          const want = Math.sqrt(PIT_LIMIT * PIT_LIMIT + 2 * 6 * Math.max(0, L.limA - u - 4));
          if (speed > want) out.input = { ...out.input, gas: false, brake: true };
          else if (speed > want - 1) out.input = { ...out.input, gas: false };
        }
        if (this.phase === 'lane') {
          // с помощью рулём — подводим к своему боксу и плавно тормозим у отметки
          if (assist > 0 && steerTo && u > bRel - 40 && u < bRel + 6) {
            const g = steerTo((s) => L.boxPathD(s, this.box));
            const dist = bRel - u;
            const want = dist > 0 ? Math.min(PIT_LIMIT, Math.sqrt(2 * 4 * Math.max(0, dist - 0.5)) + 0.3) : 0;
            out.input = {
              ...out.input,
              steer: out.input.steer * (1 - assist) + g * assist,
              gas: out.input.gas && speed < want - 0.5,
              brake: out.input.brake || speed > want + 0.3,
            };
          }
          // остановился в зоне своего бокса — пит-стоп
          if (Math.abs(u - bRel) < 4.5 && speed < 1.6 && Math.abs(car.d * L.side - L.workD(car.s)) < 4.5) {
            this.phase = 'service';
            this.t = 0;
            const from = car.tire?.compound;
            const to = this.request || from || 'medium';
            this.serviceTime = 2.5 + Math.random() * 0.9 + (COMPOUNDS[from]?.rain !== COMPOUNDS[to]?.rain ? 0.5 : 0);
            this.compound = to;
            this.emit({ type: 'pit-stop', compound: to, duration: this.serviceTime });
          }
        }
        if (!inLane && (u > L.len - 5 || !L.inRange(car.s))) this.finish(time, lap, false);
        break;
      }
      case 'service':
        this.t += dt;
        out.frozen = true;
        out.pitLane = true;
        out.progress = Math.min(1, this.t / this.serviceTime);
        out.lift = smoothstep(0, 0.25, this.t) * (1 - smoothstep(this.serviceTime - 0.3, this.serviceTime, this.t));
        if (this.t >= this.serviceTime) {
          fitTires(car, this.compound);
          this.phase = 'release';
          this.t = 0;
          this.emit({ type: 'pit-done', compound: this.compound });
        }
        break;
      case 'release':
        this.t += dt;
        out.frozen = !input.gas;
        out.pitLane = true;
        out.progress = 1;
        out.limiter = PIT_LIMIT;
        if (input.gas) {
          this.phase = 'exit';
          this.stopped = true;
          this.emit({ type: 'pit-release' });
        }
        break;
    }
    return out;
  }

  finish(time, lap, stoppedFlag) {
    const spent = time - (this.tIn ?? time);
    const stopped = this.phase === 'exit' || stoppedFlag;
    if (stopped) {
      const loss = Math.max(0, spent - this.ref);
      this.stops.push({ lap, compound: this.compound, time: spent, loss });
      this.emit({ type: 'pit-exit', loss, compound: this.compound });
    } else this.emit({ type: 'pit-exit', loss: 0, drive: true });
    this.phase = 'track';
    this.request = null;
  }

  get lossTotal() {
    return this.stops.reduce((a, s) => a + s.loss, 0);
  }
}

export { clamp };
