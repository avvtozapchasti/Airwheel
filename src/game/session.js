// Гоночная сессия: машины, отсчёт, хронометраж, штрафы, финиш, итоговый протокол.
// События наружу (звук, сообщения, HUD) — через колбэк onEvent({type, ...}).
import { createCar, stepCar, respawn, speedOf } from './physics.js';
import { LapTiming } from './timing.js';

export const PENALTY = { wall: 2, cut: 3, jump: 5 };
const WALL_PENALTY_SPEED = 4.5; // м/с поперечной скорости — «удар», а не касание
const CUT_SEC = 1.0; // все 4 колеса за линией трассы дольше — срезка

export class RaceSession {
  // opts: { track, spec, laps, assist, playerName, playerColor, onEvent }
  constructor(opts) {
    this.opts = opts;
    this.track = opts.track;
    this.spec = opts.spec;
    this.laps = opts.laps ?? 3;
    this.assist = opts.assist ?? 0.65;
    this.onEvent = opts.onEvent || (() => {});
    this.overall = { sectors: [Infinity, Infinity, Infinity], lap: Infinity };
    this.entries = [];
    this.state = 'idle';
    this.time = 0;
  }

  emit(e) {
    this.onEvent(e);
  }

  // Поставить игрока на решётку (слот grid) и начать отсчёт 3-2-1.
  start({ grid = 0 } = {}) {
    const tr = this.track;
    const slot = tr.gridSlot(grid);
    const car = createCar(this.spec, tr, slot);
    this.player = {
      id: 'player',
      isPlayer: true,
      name: this.opts.playerName || 'Ты',
      code: (this.opts.playerCode || 'ТЫ').slice(0, 3).toUpperCase(),
      color: this.opts.playerColor || '#ffc21a',
      car,
      timing: new LapTiming(tr.length, { overall: this.overall }),
      penalty: 0,
      penalties: [],
      cutT: 0,
      wallCd: 0,
      finished: false,
      finishTime: null,
      grid: grid + 1,
    };
    this.entries = [this.player];
    this.time = 0;
    this.countdown = 3;
    this.lastBeep = 4;
    this.state = 'countdown';
  }

  get playerCar() {
    return this.player?.car;
  }

  // Прогресс круга игрока для HUD.
  lapTimeOf(e) {
    return this.state === 'countdown' ? 0 : e.finished ? e.timing.lapTimes.at(-1)?.time ?? 0 : this.time - e.timing.lapStart;
  }

  step(dt, input) {
    const p = this.player;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastBeep) {
        this.lastBeep = n;
        this.emit({ type: 'beep', final: n <= 0, n });
      }
      stepCar(p.car, input, dt, this.track, { assist: this.assist, frozen: true });
      if (this.countdown <= 0) {
        this.state = 'race';
        this.emit({ type: 'go' });
      }
      return;
    }
    if (this.state !== 'race' && this.state !== 'finished') return;
    this.time += dt;
    const control = p.finished ? { steer: 0, gas: false, brake: 0.4 } : input;
    const events = stepCar(p.car, control, dt, this.track, { assist: this.assist });
    this.lastPhysics = events;
    for (const e of events) this.emit({ ...e, entry: p });
    if (!p.finished) this.judge(p, events, dt);
    this.updateTiming(p);
    // застрял или едет не туда — возвращаем на трассу
    if (p.car.stuckT > 3 || p.car.wrongWayT > 4) {
      respawn(p.car, this.track);
      this.emit({ type: 'respawn', entry: p });
    }
    if (this.state === 'finished') {
      this.finishT -= dt;
      if (this.finishT <= 0) {
        this.state = 'done';
        this.emit({ type: 'done' });
      }
    }
  }

  // Штрафы игрока: удар о стену и срезка (все 4 колеса за линией трассы > 1 с).
  judge(e, events, dt) {
    e.wallCd = Math.max(0, e.wallCd - dt);
    for (const ev of events) {
      if (ev.type === 'wall' && ev.speed > WALL_PENALTY_SPEED && e.wallCd <= 0) {
        e.wallCd = 2;
        this.addPenalty(e, PENALTY.wall, 'wall');
      }
    }
    const car = e.car;
    const i = car.idx;
    const limit = this.track.hw[i] + this.track.kerb[i] + this.spec.dims.width / 2;
    const out = Math.abs(car.d) > limit && car.wheelsOut === 4;
    if (out) {
      e.cutT += dt;
      if (e.cutT > CUT_SEC && !e.cutGiven) {
        e.cutGiven = true;
        this.addPenalty(e, PENALTY.cut, 'cut');
      }
    } else {
      e.cutT = 0;
      e.cutGiven = false;
    }
  }

  addPenalty(e, sec, reason) {
    e.penalty += sec;
    e.penalties.push({ sec, reason, time: this.time });
    if (e.isPlayer) this.emit({ type: 'penalty', sec, reason });
  }

  updateTiming(e) {
    for (const ev of e.timing.update(e.car.progress, this.time)) {
      if (e.isPlayer) this.emit({ ...ev, entry: e });
      if (ev.type === 'lap' && e.timing.lapTimes.length >= this.laps && !e.finished) {
        e.finished = true;
        e.finishTime = this.time;
        e.timing.finished = true;
        if (e.isPlayer) {
          this.state = 'finished';
          this.finishT = 3;
          this.emit({ type: 'finish', entry: e });
        }
      }
    }
  }

  // Протокол: по числу кругов, дистанции, времени финиша (+ штрафы).
  standings() {
    const rows = this.entries.map((e) => ({
      entry: e,
      total: e.finished ? e.finishTime + e.penalty : null,
      progress: e.car.progress,
    }));
    rows.sort((a, b) => {
      if (a.total != null && b.total != null) return a.total - b.total;
      if (a.total != null) return -1;
      if (b.total != null) return 1;
      return b.progress - a.progress;
    });
    return rows.map((r, k) => ({ ...r, pos: k + 1 }));
  }

  speedOf(e) {
    return speedOf(e.car);
  }
}
