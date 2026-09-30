// Хронометраж одной машины: круги, сектора S1/S2/S3 с цветами, дельта к лучшему кругу.
// Всё считается по «прогрессу» — пройденной дистанции вдоль трассы (не зависит от срезок по s).
//
// Цвета секторов как в ТВ-графике: фиолетовый — лучший у всех, зелёный — личный лучший,
// жёлтый — медленнее личного лучшего.

const BIN = 10; // м — шаг сетки для дельты

export class LapTiming {
  constructor(length, { overall = null } = {}) {
    this.L = length;
    this.bounds = [length / 3, (2 * length) / 3, length];
    this.bins = Math.ceil(length / BIN) + 1;
    this.overall = overall; // общие лучшие сектора/круг (одни на всю сессию)
    this.reset();
  }

  reset() {
    this.lap = 1;
    this.lapStart = 0;
    this.sectorStart = 0;
    this.sector = 0;
    this.lapTimes = [];
    this.sectorTimes = [null, null, null]; // текущий круг
    this.lastSectors = [null, null, null]; // прошлый круг
    this.colors = [null, null, null];
    this.lastColors = [null, null, null];
    this.bestSectors = [Infinity, Infinity, Infinity];
    this.bestLap = null;
    this.ref = null; // Float32Array: время от начала круга в каждом бине для лучшего круга
    this.cur = new Float32Array(this.bins).fill(NaN);
    this.delta = null;
    this.valid = true; // круг не аннулирован (срезка в квалификации)
    this.finished = false;
    this.finishTime = null;
    this.lastBin = -1;
  }

  // progress — пройденная дистанция (может начинаться с минуса на решётке), time — время сессии.
  // Возвращает события: {type: 'sector', k, time, color} | {type: 'lap', time, best, valid}.
  update(progress, time) {
    const events = [];
    if (this.finished) return events;
    const lapIdx = Math.max(0, Math.floor(progress / this.L)); // 0 — первый круг
    const pos = progress - lapIdx * this.L;
    // сетка дельты
    if (progress >= 0) {
      const bin = Math.min(this.bins - 1, Math.floor(pos / BIN));
      if (bin !== this.lastBin && lapIdx + 1 === this.lap) {
        this.lastBin = bin;
        if (Number.isNaN(this.cur[bin])) this.cur[bin] = time - this.lapStart;
      }
      if (this.ref && lapIdx + 1 === this.lap) {
        const f = pos / BIN;
        const b0 = Math.min(this.bins - 2, Math.floor(f));
        const t0 = this.ref[b0], t1 = this.ref[b0 + 1];
        if (!Number.isNaN(t0) && !Number.isNaN(t1)) this.delta = time - this.lapStart - (t0 + (t1 - t0) * (f - b0));
      }
    }
    // сектора текущего круга
    while (this.sector < 3 && progress >= (this.lap - 1) * this.L + this.bounds[this.sector]) {
      const k = this.sector;
      const t = time - this.sectorStart;
      this.sectorTimes[k] = t;
      let color = 'yellow';
      if (this.valid && t < this.bestSectors[k]) {
        this.bestSectors[k] = t;
        color = 'green';
      }
      if (this.valid && this.overall && t <= this.overall.sectors[k]) {
        this.overall.sectors[k] = t;
        color = 'purple';
      }
      this.colors[k] = color;
      events.push({ type: 'sector', k, time: t, color });
      this.sectorStart = time;
      this.sector++;
      if (k === 2) events.push(this.completeLap(time));
    }
    return events;
  }

  completeLap(time) {
    const t = time - this.lapStart;
    const valid = this.valid;
    this.lapTimes.push({ time: t, valid });
    let best = false, overallBest = false;
    if (valid && (this.bestLap === null || t < this.bestLap)) {
      this.bestLap = t;
      best = true;
      // лучший круг становится опорным для дельты
      this.ref = this.cur;
      this.fillGaps(this.ref);
    }
    if (valid && this.overall && t <= (this.overall.lap ?? Infinity)) {
      this.overall.lap = t;
      overallBest = true;
    }
    this.cur = new Float32Array(this.bins).fill(NaN);
    this.lastSectors = this.sectorTimes;
    this.lastColors = this.colors;
    this.sectorTimes = [null, null, null];
    this.colors = [null, null, null];
    this.lap++;
    this.lapStart = time;
    this.sector = 0;
    this.lastBin = -1;
    this.valid = true;
    this.delta = null;
    return { type: 'lap', time: t, best, overallBest, valid, lap: this.lap - 1 };
  }

  fillGaps(arr) {
    let last = 0;
    for (let i = 0; i < arr.length; i++) {
      if (Number.isNaN(arr[i])) arr[i] = last;
      else last = arr[i];
    }
  }
}
