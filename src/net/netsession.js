// Сетевая гонка: та же RaceSession, но часть машин — RemoteCar (другие игроки и, у клиентов,
// боты хоста). Своя машина симулируется локально; финиш других игроков — по их отчёту;
// итоговый протокол собирает хост (хост-авторитетная модель для старта, времени и итогов).
import { RaceSession } from '../game/session.js';
import { createBots } from '../game/bots.js';

export class NetRaceSession extends RaceSession {
  constructor(opts) {
    super(opts);
    this.isHost = !!opts.isHost;
    this.waiting = false;
  }

  step(dt, input) {
    // данные из снимков: штрафы и финиш других игроков (по их часам гонки)
    for (const e of this.remotes || []) {
      const st = e.remote.last;
      if (!st) continue;
      if (e.human) e.penalty = st.penalty;
      if (st.finished && !e.finished && this.state !== 'grid') {
        e.finished = true;
        e.finishTime = st.finishTime;
        e.timing.finished = true;
      }
    }
    super.step(dt, input);
  }

  // Финиш машины по сети определяет её владелец (см. step), не локальный хронометраж.
  finishEntry(e) {
    if (e.remote && e.human) return;
    super.finishEntry(e);
  }

  // Свой финиш: ждём итогов от хоста (гонка у остальных продолжается).
  onFinishWait() {
    if (this.waiting) return;
    this.waiting = true;
    this.finishT = Infinity;
    const p = this.player;
    this.emit({
      type: 'net-finish',
      report: { time: p.finishTime, bestLap: p.timing.bestLap, penalty: p.penalty, pits: p.pit.stops.length, pitLoss: p.pit.lossTotal },
    });
  }

  // Хост: отключившийся игрок — его машину дальше ведёт бот (с того же места и с той же скоростью).
  convertToBot(entry, { seed = 1, difficulty = 'medium', bps = [] } = {}) {
    if (!this.isHost || !entry?.remote) return null;
    const rc = entry.remote;
    const [bot] = createBots(1, this.spec, this.track, { seed, difficulty, bps });
    bot.name = `${entry.name} (бот)`;
    bot.code = entry.code;
    bot.color = entry.color;
    bot.place(rc.progress, rc.d);
    bot.v = rc.v;
    bot.pit.box = this.entries.indexOf(entry);
    bot.tire = { compound: rc.tire.compound, wear: rc.tire.wear, grip: 1 };
    entry.bot = bot;
    entry.remote = null;
    entry.isRemote = false;
    entry.human = false;
    entry.name = bot.name;
    entry.timing.finished = entry.finished;
    this.bots.push(bot);
    this.remotes = this.entries.filter((e) => e.remote);
    return bot;
  }

  // Хост: итоговый протокол — отчёты игроков, свои данные, оценка для недоехавших.
  finalRows(reports) {
    const L = this.track.length, total = this.laps * L;
    for (const e of this.entries) {
      const rep = e.id && reports.get(e.id);
      if (rep) {
        e.report = rep;
        e.finished = true;
        e.finishTime = rep.time;
        e.penalty = rep.penalty;
        e.timing.bestLap = rep.bestLap ?? e.timing.bestLap;
      }
      if (e.finished) continue;
      const prog = this.progressOf(e);
      const avg = Math.max(10, prog / Math.max(1, this.time));
      e.finishTime = this.time + Math.max(0, total - prog) / avg;
      e.finished = true;
      e.estimated = true;
      if (!e.timing.bestLap) e.timing.bestLap = (e.finishTime / this.laps) * (0.985 + Math.random() * 0.01);
    }
    return this.results().map((r) => ({
      pos: r.pos,
      id: r.entry.id,
      name: r.name,
      code: r.code,
      color: r.color,
      human: !!(r.entry.isPlayer || r.entry.human || r.entry.report),
      time: r.time,
      gapText: r.gapText,
      bestLap: r.bestLap,
      penalty: r.penalty,
      pits: r.pits,
      pitLoss: r.pitLoss,
      points: r.points,
      grid: r.grid,
      fastest: r.fastest,
    }));
  }
}
