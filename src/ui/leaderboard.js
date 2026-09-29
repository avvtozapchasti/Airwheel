// Таблица рекордов в localStorage: топ-5 по времени заезда.
import { formatTime } from '../game/hud.js';
import { esc } from './results.js';

const KEY = 'airwheel.records';
const NAME_KEY = 'airwheel.name';
export const TOP_N = 5;

export function loadRecords() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.time === 'number').slice(0, TOP_N) : [];
  } catch {
    return [];
  }
}

export function qualifies(time) {
  const list = loadRecords();
  return list.length < TOP_N || time < list[list.length - 1].time;
}

// Возвращает индекс новой записи в таблице (или -1).
export function addRecord(name, time, extra = {}) {
  const list = loadRecords();
  const rec = { name: String(name).trim().slice(0, 16) || 'Игрок', time, date: Date.now(), ...extra };
  list.push(rec);
  list.sort((a, b) => a.time - b.time);
  const top = list.slice(0, TOP_N);
  try {
    localStorage.setItem(KEY, JSON.stringify(top));
    localStorage.setItem(NAME_KEY, rec.name);
  } catch {
    /* localStorage недоступен — просто не сохраняем */
  }
  return top.indexOf(rec);
}

export function lastName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function recordsTable(highlight = -1) {
  const list = loadRecords();
  if (!list.length) return '<p>Рекордов пока нет — стань первым!</p>';
  const rows = list
    .map(
      (r, i) =>
        `<tr class="${i === highlight ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${
          r.mode === 'keyboard' ? '⌨️' : '🖐'
        }</td><td>${formatTime(r.time)}</td></tr>`,
    )
    .join('');
  return `<table class="records">${rows}</table>`;
}
