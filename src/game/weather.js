// Погода: «Сухо», «Дождь», «Переменная» (дождь начинается и заканчивается во время гонки).
// Всё детерминировано по seed и времени сессии — в мультиплеере хост рассылает seed и старт,
// и у всех игроков дождь начинается одновременно.
//
//  rainAt(t)    — сила дождя 0..1 (капли, брызги, видимость);
//  wetnessAt(t) — влажность трассы 0..1 (сцепление и вид асфальта): намокает за ~25 с,
//                 сохнет ~1.5 минуты — после дождя ещё круг-полтора выгоднее мокрые шины;
//  forecast(t)  — ближайшее событие для предупреждений («Дождь через 1 круг»).
import { rng, smoothstep, clamp } from '../util/rng.js';

export const WEATHER_MODES = { dry: 'Сухо', rain: 'Дождь', variable: 'Переменная' };
const GRID = 0.5; // с — шаг интегрирования влажности

export class Weather {
  // mode: 'dry' | 'rain' | 'variable'; seed — общий для всех игроков; lapTime — примерное время круга
  constructor(mode = 'dry', { seed = 1, lapTime = 80 } = {}) {
    this.mode = WEATHER_MODES[mode] ? mode : 'dry';
    this.seed = seed;
    this.lapTime = lapTime;
    const r = rng(Math.floor(seed) * 7919 + 13);
    if (this.mode === 'variable') {
      this.start = lapTime * (0.85 + r() * 0.6); // дождь начинается на 1–2 круге
      this.dur = lapTime * (1.3 + r() * 0.8);
      this.peak = 0.75 + r() * 0.25;
    } else {
      this.start = 0;
      this.dur = Infinity;
      this.peak = this.mode === 'rain' ? 0.85 : 0;
    }
    this.grid = [this.mode === 'rain' ? 0.9 : 0];
  }

  rainAt(t) {
    if (this.mode === 'dry') return 0;
    if (this.mode === 'rain') return this.peak;
    const a = smoothstep(this.start, this.start + 20, t);
    const b = 1 - smoothstep(this.start + this.dur - 25, this.start + this.dur, t);
    return this.peak * Math.min(a, b);
  }

  wetnessAt(t) {
    if (this.mode === 'dry') return 0;
    if (this.mode === 'rain') return 0.9;
    t = Math.max(0, t);
    const k = Math.floor(t / GRID);
    while (this.grid.length <= k + 1) {
      const i = this.grid.length - 1;
      const w = this.grid[i];
      const rain = this.rainAt(i * GRID);
      const dw = rain > 0.02 ? (Math.min(1, rain * 1.1) - w) / 25 : (-w * (0.5 + 0.5 * w)) / 70;
      this.grid.push(clamp(w + dw * GRID, 0, 1));
    }
    const f = t / GRID - k;
    return this.grid[k] + (this.grid[k + 1] - this.grid[k]) * f;
  }

  // {type: 'rain'|'stop', in: секунд} или null
  forecast(t) {
    if (this.mode !== 'variable') return null;
    if (t < this.start) return { type: 'rain', in: this.start - t };
    if (t < this.start + this.dur) return { type: 'stop', in: this.start + this.dur - t };
    return null;
  }

  // Подпись и значок для HUD.
  label(t) {
    const rain = this.rainAt(t), w = this.wetnessAt(t);
    if (rain > 0.5) return { icon: '🌧', text: 'Дождь' };
    if (rain > 0.05) return { icon: '🌦', text: 'Морось' };
    if (w > 0.15) return { icon: '💧', text: 'Мокро' };
    return { icon: '☀', text: 'Сухо' };
  }
}
