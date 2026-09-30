// Гонка: 12 машин (игрок + 11 ботов), решётка, огни старта, хронометраж всех машин,
// позиции и разрывы, штрафы, финиш и итоговый протокол с очками.
// События наружу (звук, сообщения, HUD) — через колбэк onEvent({type, ...}).
import { createCar, stepCar, respawn, speedOf } from './physics.js';
import { LapTiming } from './timing.js';
import { updateBots, collidePlayer } from './bots.js';

export const PENALTY = { wall: 2, cut: 3, jump: 5 };
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const WALL_PENALTY_SPEED = 4.5; // м/с поперечной скорости — «удар», а не касание
const CUT_SEC = 1.0; // все 4 колеса за линией трассы дольше — срезка
const GAP_BIN = 10; // м — шаг отметок для разрывов

function entryBase(extra) {
  return {
    penalty: 0,
    penalties: [],
    cutT: 0,
    wallCd: 0,
    finished: false,
    finishTime: null,
    passTimes: [],
    lastBin: -1,
    ...extra,
  };
}

export class RaceSession {
  // opts: { track, spec, laps, assist, bots[], grid (порядок: массив id), player: {name, code, color}, onEvent }
  constructor(opts) {
    this.opts = opts;
    this.track = opts.track;
    this.spec = opts.spec;
    this.laps = opts.laps ?? 3;
    this.assist = opts.assist ?? 0.65;
    this.onEvent = opts.onEvent || (() => {});
    this.overall = { sectors: [Infinity, Infinity, Infinity], lap: Infinity };
    this.fastest = null; // {entry, time}
    this.state = 'idle';
    this.time = 0;
    this.lastPos = null;
    this.posCd = 0;
  }

  emit(e) {
    this.onEvent(e);
  }

  // order — массив записей {id: 'player' | bot-объект} в порядке решётки (P1 первым).
  start(order) {
    const tr = this.track;
    const pOpts = this.opts.player || {};
    this.entries = [];
    order.forEach((who, k) => {
      const slot = tr.gridSlot(k);
      if (who === 'player') {
        const car = createCar(this.spec, tr, slot);
        this.player = entryBase({
          id: 'player',
          isPlayer: true,
          name: pOpts.name || 'Ты',
          code: (pOpts.code || 'ТЫ').slice(0, 3).toUpperCase(),
          color: pOpts.color || '#ffb000',
          car,
          grid: k + 1,
          slot,
          timing: new LapTiming(tr.length, { overall: this.overall }),
        });
        this.entries.push(this.player);
      } else {
        who.place(slot.s, slot.d);
        this.entries.push(
          entryBase({
            id: who.code,
            isPlayer: false,
            name: who.name,
            code: who.code,
            color: who.color,
            bot: who,
            grid: k + 1,
            timing: new LapTiming(tr.length, { overall: this.overall }),
          }),
        );
      }
    });
    this.bots = this.entries.filter((e) => e.bot).map((e) => e.bot);
    this.time = 0;
    this.phaseT = -(this.opts.intro ?? 3.4); // панорама решётки до огней
    this.lights = 0;
    this.holdT = 0.4 + Math.random() * 1.2; // пауза перед «огни погасли»
    this.jumped = false;
    this.state = 'grid';
    this.lastPos = this.player.grid;
  }

  get playerCar() {
    return this.player?.car;
  }

  progressOf(e) {
    return e.isPlayer ? e.car.progress : e.bot.progress;
  }

  lapTimeOf(e) {
    if (this.state === 'grid') return 0;
    return e.finished ? e.timing.lapTimes.at(-1)?.time ?? 0 : this.time - e.timing.lapStart;
  }

  // Решётка: 5 красных огней по одному в секунду, пауза, огни гаснут — старт.
  // Сдвинулся с места раньше — фальстарт +5 с.
  stepGrid(dt, input) {
    this.phaseT += dt;
    const n = Math.min(5, Math.floor(this.phaseT));
    if (n !== this.lights && n > 0) {
      this.lights = n;
      this.emit({ type: 'light', n });
    }
    const p = this.player;
    stepCar(p.car, input, dt, this.track, { assist: this.assist, frozen: this.phaseT < 0, noReverse: true });
    if (!this.jumped && p.car.progress - p.slot.s > 1.0) {
      this.jumped = true;
      this.addPenalty(p, PENALTY.jump, 'jump');
    }
    updateBots(this.bots, { dt, player: p.car, raceTime: 0, started: false });
    if (this.phaseT >= 5 + this.holdT) {
      this.state = 'race';
      this.lights = 0;
      this.emit({ type: 'go' });
    }
  }

  step(dt, input) {
    if (this.state === 'grid') return this.stepGrid(dt, input);
    if (this.state !== 'race' && this.state !== 'finished') return;
    this.time += dt;
    const p = this.player;
    const control = p.finished ? { steer: 0, gas: false, brake: 0.4 } : input;
    const events = stepCar(p.car, control, dt, this.track, { assist: this.assist });
    updateBots(this.bots, { dt, player: p.car, raceTime: this.time, started: true });
    for (const ev of collidePlayer(p.car, this.bots, this.track)) events.push(ev);
    this.lastPhysics = events;
    for (const e of events) this.emit({ ...e, entry: p });
    if (!p.finished) this.judge(p, events, dt);
    for (const e of this.entries) {
      this.updateTiming(e);
      this.recordPass(e);
    }
    if (p.car.stuckT > 3 || p.car.wrongWayT > 4) {
      respawn(p.car, this.track);
      this.emit({ type: 'respawn', entry: p });
    }
    this.watchPosition(dt);
    if (this.state === 'finished') {
      this.finishT -= dt;
      if (this.finishT <= 0) this.complete();
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
    if (Math.abs(car.d) > limit && car.wheelsOut === 4) {
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
    if (e.finished) return;
    for (const ev of e.timing.update(this.progressOf(e), this.time)) {
      if (ev.type === 'lap' && ev.valid && (!this.fastest || ev.time < this.fastest.time)) {
        this.fastest = { entry: e, time: ev.time };
        if (!e.isPlayer && this.time > 5) this.emit({ type: 'fastest', entry: e, time: ev.time });
      }
      if (e.isPlayer) this.emit({ ...ev, entry: e, fastest: this.fastest?.entry === e });
      if (ev.type === 'lap' && e.timing.lapTimes.length >= this.laps) this.finishEntry(e);
    }
  }

  finishEntry(e) {
    e.finished = true;
    e.finishTime = this.time;
    e.timing.finished = true;
    if (e.bot) e.bot.finishedCoast = true;
    if (e.isPlayer) {
      this.state = 'finished';
      this.finishT = 3.5;
      this.emit({ type: 'finish', entry: e });
    }
  }

  // Отметки времени через каждые 10 м — из них считаются разрывы.
  recordPass(e) {
    const bin = Math.floor(this.progressOf(e) / GAP_BIN);
    if (bin > e.lastBin && bin >= 0) {
      for (let k = Math.max(0, e.lastBin + 1); k <= bin; k++) e.passTimes[k] = this.time;
      e.lastBin = bin;
    }
  }

  // Разрыв «a позади b» в секундах (или кругах).
  gap(a, b) {
    const L = this.track.length;
    const dp = this.progressOf(b) - this.progressOf(a);
    if (b.finished && a.finished) return { sec: a.finishTime + a.penalty - (b.finishTime + b.penalty), laps: 0 };
    if (dp >= L) return { sec: null, laps: Math.floor(dp / L) };
    const k = a.lastBin;
    const tb = b.passTimes[k];
    if (k < 0 || tb == null || a.passTimes[k] == null) {
      // ещё не пересекли линию старта — оценка по расстоянию
      return { sec: Math.max(0, dp) / Math.max(10, this.speedOf(a)), laps: 0 };
    }
    return { sec: Math.max(0, a.passTimes[k] - tb), laps: 0 };
  }

  // Порядок: финишировавшие по времени (+ штрафы), остальные по дистанции.
  standings() {
    const list = [...this.entries];
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime + a.penalty - (b.finishTime + b.penalty);
      if (a.finished !== b.finished) {
        // финишировавший впереди того, кто ещё на том же круге или позади
        const f = a.finished ? a : b, o = a.finished ? b : a;
        const before = this.progressOf(o) < this.laps * this.track.length;
        if (before) return a.finished ? -1 : 1;
      }
      return this.progressOf(b) - this.progressOf(a);
    });
    return list;
  }

  positionOf(e) {
    return this.standings().indexOf(e) + 1;
  }

  // «Обгон!» — позиция игрока выросла и держится 0.5 с.
  watchPosition(dt) {
    if (this.time < 4 || this.player.finished) return;
    const pos = this.positionOf(this.player);
    if (pos !== this.pendingPos) {
      this.pendingPos = pos;
      this.posCd = 0.5;
    } else if (this.posCd > 0) {
      this.posCd -= dt;
      if (this.posCd <= 0 && pos !== this.lastPos) {
        this.emit({ type: pos < this.lastPos ? 'overtake' : 'overtaken', pos, from: this.lastPos });
        this.lastPos = pos;
      }
    }
  }

  // Башня лидеров для HUD.
  tower() {
    const st = this.standings();
    const leader = st[0];
    return st.map((e, k) => {
      let gap = '';
      if (k === 0) gap = e.finished ? 'ФИН' : 'Лидер';
      else {
        const g = this.gap(e, leader);
        gap = g.laps ? `+${g.laps} кр` : `+${g.sec.toFixed(1)}`;
      }
      return { pos: k + 1, code: e.code, color: e.color, gap, player: e.isPlayer, out: false };
    });
  }

  // Разрывы игрока до машины спереди и сзади.
  neighbours() {
    const st = this.standings();
    const i = st.indexOf(this.player);
    const out = {};
    if (i > 0) out.ahead = { entry: st[i - 1], ...this.gap(this.player, st[i - 1]) };
    if (i < st.length - 1) out.behind = { entry: st[i + 1], ...this.gap(st[i + 1], this.player) };
    return out;
  }

  // Игрок финишировал: остальным досчитываем время по их среднему темпу.
  complete() {
    const L = this.track.length, total = this.laps * L;
    for (const e of this.entries) {
      if (e.finished) continue;
      const prog = this.progressOf(e);
      const avg = Math.max(10, prog / Math.max(1, this.time));
      e.finishTime = this.time + Math.max(0, total - prog) / avg;
      e.finished = true;
      e.estimated = true;
      // лучший круг не быстрее среднего темпа этой машины
      if (!e.timing.bestLap) e.timing.bestLap = (e.finishTime / this.laps) * (0.985 + Math.random() * 0.01);
    }
    this.state = 'done';
    this.emit({ type: 'done' });
  }

  // Итоговый протокол.
  results() {
    const st = this.standings();
    const winner = st[0];
    const wTotal = winner.finishTime + winner.penalty;
    return st.map((e, k) => {
      const total = e.finishTime + e.penalty;
      return {
        pos: k + 1,
        name: e.name,
        code: e.code,
        color: e.color,
        player: e.isPlayer,
        time: total,
        gapText: k === 0 ? '' : `+${(total - wTotal).toFixed(3)}`,
        bestLap: e.timing.bestLap,
        penalty: e.penalty,
        points: POINTS[k] || 0,
        grid: e.grid,
        fastest: this.fastest?.entry === e,
        entry: e,
      };
    });
  }

  speedOf(e) {
    return e.isPlayer ? speedOf(e.car) : e.bot.v;
  }
}
