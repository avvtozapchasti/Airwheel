// Рекорды и настройки в localStorage: лучший круг, лучшая квалификация и лучший финиш
// для каждой пары «трасса + класс». Если хранилище недоступно (приватный режим) — просто не сохраняем.
import { formatLap } from '../util/format.js';

const KEY = 'airwheel.v2.records';
const SETTINGS_KEY = 'airwheel.v2.settings';

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* хранилище недоступно */
  }
}

export function getRecord(trackId, cls) {
  return load(KEY, {})[`${trackId}/${cls}`] || null;
}

// Обновить рекорд. Возвращает список того, что улучшено: ['lap', 'quali', 'finish'].
export function saveRecord(trackId, cls, { lap = null, quali = null, finish = null, time = null, laps = null } = {}) {
  const all = load(KEY, {});
  const k = `${trackId}/${cls}`;
  const r = all[k] || {};
  const improved = [];
  if (lap && (!r.lap || lap < r.lap)) {
    r.lap = lap;
    improved.push('lap');
  }
  if (quali && (!r.quali || quali < r.quali)) {
    r.quali = quali;
    improved.push('quali');
  }
  if (finish && (!r.finish || finish < r.finish || (finish === r.finish && time && laps === r.laps && time < r.time))) {
    r.finish = finish;
    r.time = time;
    r.laps = laps;
    improved.push('finish');
  }
  r.date = Date.now();
  all[k] = r;
  save(KEY, all);
  return improved;
}

export function recordLine(trackId, cls) {
  const r = getRecord(trackId, cls);
  if (!r) return 'рекордов пока нет';
  const parts = [];
  if (r.lap) parts.push(`круг ${formatLap(r.lap)}`);
  if (r.finish) parts.push(`финиш P${r.finish}`);
  return parts.join(' · ') || 'рекордов пока нет';
}

export function loadSettings(defaults) {
  return { ...defaults, ...load(SETTINGS_KEY, {}) };
}

export function saveSettings(s) {
  save(SETTINGS_KEY, s);
}

// Короткая таблица рекордов по всем трассам (для онбординга).
export function recordsTable() {
  const all = load(KEY, {});
  const rows = Object.entries(all)
    .filter(([, r]) => r.lap)
    .slice(0, 6)
    .map(([k, r]) => `<tr><td>${k.replace('/', ' · ').toUpperCase()}</td><td>${formatLap(r.lap)}</td></tr>`)
    .join('');
  return rows ? `<table class="records">${rows}</table>` : '<p>Рекордов пока нет — стань первым!</p>';
}
