// Квалификация: игрок один на трассе, две попытки быстрого круга подряд с разгонного отрезка.
// Сектора и дельта — в реальном времени; цвета секторов сравниваются с временами ботов,
// которые генерируются заранее (идеальный круг бота ±1.5% по его «мастерству»).
// Срезка (все 4 колеса за линией > 1 с) аннулирует круг.
import { createCar, stepCar, respawn } from './physics.js';
import { LapTiming } from './timing.js';
import { qualiTime } from './bots.js';

const OUT_LAP = 420; // м разгона до линии
const CUT_SEC = 1.0;

// Доли секторов в круге по профилю скорости.
function sectorFractions(track, prof) {
  const t = [0, 0, 0];
  const seg = track.racingLine.segLen;
  for (let i = 0; i < track.n; i++) {
    const k = Math.min(2, Math.floor((i * track.ds) / (track.length / 3)));
    t[k] += seg[i] / Math.max(1, prof.v[i]);
  }
  const sum = t[0] + t[1] + t[2];
  return t.map((x) => x / sum);
}

export class QualiSession {
  // opts: { track, spec, bots, assist, attempts, player: {name, code, color}, onEvent }
  constructor(opts) {
    this.opts = opts;
    this.track = opts.track;
    this.spec = opts.spec;
    this.bots = opts.bots;
    this.assist = opts.assist ?? 0.65;
    this.attempts = opts.attempts ?? 2;
    this.onEvent = opts.onEvent || (() => {});
    this.state = 'idle';
  }

  emit(e) {
    this.onEvent(e);
  }

  start() {
    const tr = this.track;
    // времена ботов и их сектора
    this.overall = { sectors: [Infinity, Infinity, Infinity], lap: Infinity };
    for (const b of this.bots) {
      b.qualiTime = qualiTime(b, b.rng);
      const fr = sectorFractions(tr, b.prof);
      b.qualiSectors = fr.map((f) => f * b.qualiTime);
      b.qualiSectors.forEach((x, k) => (this.overall.sectors[k] = Math.min(this.overall.sectors[k], x)));
      this.overall.lap = Math.min(this.overall.lap, b.qualiTime);
    }
    // игрок — с разгона, уже на скорости
    const s0 = -OUT_LAP;
    const car = createCar(this.spec, tr, { s: s0, d: tr.racingLine.offset[tr.index(s0)] });
    car.u = this.opts.prof.v[tr.index(s0)] * 0.7;
    car.gear = Math.max(0, this.spec.gears.findIndex((g) => g > car.u * 1.05));
    this.player = {
      isPlayer: true,
      name: this.opts.player?.name || 'Ты',
      code: this.opts.player?.code || 'ТЫ',
      color: this.opts.player?.color || '#ffb000',
      car,
      timing: new LapTiming(tr.length, { overall: this.overall }),
      cutT: 0,
    };
    this.time = 0;
    this.attempt = 0; // сколько попыток начато
    this.state = 'outlap';
    this.best = null;
  }

  get playerCar() {
    return this.player.car;
  }

  lapTimeOf() {
    return this.state === 'timed' ? this.time - this.player.timing.lapStart : 0;
  }

  step(dt, input) {
    if (this.state === 'done') return;
    this.time += dt;
    const p = this.player, car = p.car;
    const finishing = this.state === 'finishing';
    const events = stepCar(car, finishing ? { steer: 0, gas: false, brake: 0.3 } : input, dt, this.track, { assist: this.assist });
    this.lastPhysics = events;
    for (const e of events) this.emit({ ...e, entry: p });
    if (car.stuckT > 3 || car.wrongWayT > 4) {
      respawn(car, this.track);
      this.emit({ type: 'respawn' });
    }
    if (this.state === 'outlap' && car.progress >= 0) {
      // пересекли линию — пошла первая попытка
      this.state = 'timed';
      this.attempt = 1;
      p.timing.lapStart = p.timing.sectorStart = this.time;
      this.emit({ type: 'attempt', n: 1 });
    }
    if (this.state === 'timed') {
      this.judge(p, dt);
      for (const ev of p.timing.update(car.progress, this.time)) {
        this.emit({ ...ev, entry: p });
        if (ev.type === 'lap') {
          if (ev.valid && (!this.best || ev.time < this.best)) this.best = ev.time;
          if (this.attempt >= this.attempts) {
            this.state = 'finishing';
            this.finishT = 2.5;
            this.emit({ type: 'quali-end', best: this.best });
          } else {
            this.attempt++;
            this.emit({ type: 'attempt', n: this.attempt });
          }
        }
      }
    }
    if (finishing) {
      this.finishT -= dt;
      if (this.finishT <= 0) this.end();
    }
  }

  judge(p, dt) {
    const car = p.car, i = car.idx;
    const limit = this.track.hw[i] + this.track.kerb[i] + this.spec.dims.width / 2;
    if (Math.abs(car.d) > limit && car.wheelsOut === 4) {
      p.cutT += dt;
      if (p.cutT > CUT_SEC && p.timing.valid) {
        p.timing.valid = false;
        this.emit({ type: 'invalid' });
      }
    } else p.cutT = 0;
  }

  // Досрочно завершить (из паузы).
  end() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.emit({ type: 'done' });
  }

  // Итог: бота по времени, игрок со своим лучшим (без времени — последним).
  results() {
    const rows = this.bots.map((b) => ({ name: b.name, code: b.code, color: b.color, time: b.qualiTime, bot: b }));
    rows.push({ name: this.player.name, code: this.player.code, color: this.player.color, time: this.best, player: true });
    rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    const pole = rows[0].time;
    return rows.map((r, k) => ({ ...r, pos: k + 1, gap: r.time != null && k > 0 ? r.time - pole : null }));
  }

  // Предварительная позиция игрока (по лучшему кругу).
  position() {
    if (!this.best) return null;
    return 1 + this.bots.filter((b) => b.qualiTime < this.best).length;
  }
}
