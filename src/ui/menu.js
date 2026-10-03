// Меню гоночного уик-энда: трасса, класс, число кругов, помощь рулём, соперники, графика,
// погода и стартовые шины.
// Старт — кнопкой, Enter или поднятыми ладонями (1 с).
import { recordLine } from './leaderboard.js';
import { esc } from '../util/format.js';

export const ASSIST = { off: 0, low: 0.35, medium: 0.65, high: 1 };

const OPTIONS = {
  laps: [
    [2, '2'],
    [3, '3'],
    [5, '5'],
  ],
  assist: [
    ['off', 'Выкл'],
    ['low', 'Низкая'],
    ['medium', 'Средняя'],
    ['high', 'Высокая'],
  ],
  difficulty: [
    ['easy', 'Лёгкие'],
    ['medium', 'Средние'],
    ['hard', 'Сильные'],
  ],
  graphics: [
    ['auto', 'Авто'],
    ['low', 'Низкая'],
    ['medium', 'Средняя'],
    ['high', 'Высокая'],
  ],
  weather: [
    ['dry', 'Сухо'],
    ['rain', 'Дождь'],
    ['variable', 'Переменная'],
  ],
  tires: [
    ['soft', 'Soft'],
    ['medium', 'Medium'],
    ['wet', 'Мокрые'],
  ],
};

// Контур трассы для карточки (SVG), по контрольным точкам.
function outline(def) {
  const pts = def.points;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = 84 / Math.max(maxX - minX, maxZ - minZ);
  const ox = (100 - (maxX - minX) * sc) / 2, oz = (100 - (maxZ - minZ) * sc) / 2;
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${(ox + (p[0] - minX) * sc).toFixed(1)},${(oz + (p[1] - minZ) * sc).toFixed(1)}`).join('') + 'Z';
  return `<svg viewBox="0 0 100 100" class="outline"><path d="${d}"/></svg>`;
}

export class Menu {
  // h: { tracks, classes, onStart(mode: 'weekend'|'race'), onCalibrate, onCamera, onChange(settings) }
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.active = false;
  }

  show(settings, { keyboard = false, message = '' } = {}) {
    this.s = settings;
    this.keyboard = keyboard;
    this.active = true;
    const { tracks, classes } = this.h;
    const seg = (key) =>
      `<div class="seg" data-key="${key}">${OPTIONS[key]
        .map(([v, label]) => `<button class="${String(settings[key]) === String(v) ? 'on' : ''}" data-v="${v}">${label}</button>`)
        .join('')}</div>`;
    this.root.innerHTML = `
      <div class="card menu">
        <div class="menu-head">
          <h1>🏎️ AirWheel</h1>
          <p class="lead">Гоночный уик-энд: квалификация → решётка → гонка. Руль — твои руки.</p>
        </div>
        ${message ? `<p class="msg">${esc(message)}</p>` : ''}
        <h2>Трасса</h2>
        <div class="choices">${tracks
          .map(
            (t) => `
          <button class="choice ${t.id === settings.trackId ? 'on' : ''} ${t.locked ? 'locked' : ''}" data-track="${t.id}" ${t.locked ? 'disabled' : ''}>
            ${outline(t)}
            <b>${esc(t.name)}</b><span>${esc(t.subtitle || '')}</span>
            <em>${t.locked ? 'скоро' : esc(recordLine(t.id, settings.cls))}</em>
          </button>`,
          )
          .join('')}</div>
        <h2>Класс</h2>
        <div class="choices classes">${classes
          .map(
            (c) => `
          <button class="choice ${c.id === settings.cls ? 'on' : ''} ${c.locked ? 'locked' : ''}" data-cls="${c.id}" ${c.locked ? 'disabled' : ''}>
            <b>${esc(c.title)}</b><span>${esc(c.description)}</span>
            <em>${Math.round(c.vmax * 3.6)} км/ч · ${c.mass} кг</em>
          </button>`,
          )
          .join('')}</div>
        <div class="opts">
          <label>Круги ${seg('laps')}</label>
          <label>Помощь рулём ${seg('assist')}</label>
          <label>Соперники ${seg('difficulty')}</label>
          <label>Графика ${seg('graphics')}</label>
          <label>Погода ${seg('weather')}</label>
          <label>Шины на старте ${seg('tires')}</label>
        </div>
        ${keyboard ? '' : '<div class="meter"><span>Старт 🙌</span><div class="bar"><b id="mn-start"></b></div><em>ладони 1 с</em></div>'}
        <div class="row">
          <button class="btn primary" id="mn-weekend">▶ Квалификация и гонка</button>
          <button class="btn" id="mn-race">Сразу гонка</button>
          <button class="btn" id="mn-mp">👥 Мультиплеер</button>
          ${keyboard ? '<button class="btn" id="mn-cam">📷 Камера</button>' : '<button class="btn" id="mn-cal">Перекалибровать</button>'}
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    const q = (sel) => this.root.querySelector(sel);
    this.root.querySelectorAll('[data-track]').forEach((b) => (b.onclick = () => this.set('trackId', b.dataset.track)));
    this.root.querySelectorAll('[data-cls]').forEach((b) => (b.onclick = () => this.set('cls', b.dataset.cls)));
    this.root.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const key = g.dataset.key;
          const v = key === 'laps' ? +b.dataset.v : b.dataset.v;
          this.set(key, v);
        };
      });
    });
    q('#mn-weekend').onclick = () => this.h.onStart('weekend');
    q('#mn-race').onclick = () => this.h.onStart('race');
    q('#mn-mp').onclick = () => this.h.onMultiplayer?.();
    if (q('#mn-cam')) q('#mn-cam').onclick = () => this.h.onCamera();
    if (q('#mn-cal')) q('#mn-cal').onclick = () => this.h.onCalibrate();
  }

  set(key, v) {
    this.s[key] = v;
    this.h.onChange?.(this.s);
    this.show(this.s, { keyboard: this.keyboard });
  }

  hide() {
    this.active = false;
  }

  // Каждый кадр: прогресс «ладони подняты» и старт.
  update(input) {
    if (!this.active) return;
    const b = this.root.querySelector('#mn-start');
    if (b) b.style.width = `${Math.round((input.startHold || 0) * 100)}%`;
    if (input.startTrigger) this.h.onStart('weekend');
  }
}
