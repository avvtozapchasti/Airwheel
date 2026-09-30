// Экран итогов заезда: место, время, круги, ошибки по типам и главная ошибка с советом.
import { formatTime } from '../util/format.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function errorsBlock(coach, keyboard) {
  if (keyboard) return '<p>Заезд с клавиатуры — режим «Ошибка» работает только с камерой.</p>';
  if (!coach || coach.total === 0) return '<p class="good">Ни одной ошибки управления. Чистый заезд!</p>';
  const rows = coach.items.map((e) => `<tr><td>${esc(e.title)}</td><td>${e.count}</td></tr>`).join('');
  return `
    <table class="errors">${rows}</table>
    <div class="main-error">
      <b>Главная ошибка заезда: ${esc(coach.main.title)}</b> (${coach.main.count})<br />
      ${esc(coach.main.advice)}
    </div>`;
}

// data: { place, total, time, bestLap, lapTimes, coach, keyboard }
// extra — HTML-блок (например, таблица рекордов), вставляется перед кнопками.
export function showResults(root, data, { onRetry, onRecalibrate, extra = '' }) {
  const medal = data.place === 1 ? '🥇' : data.place === 2 ? '🥈' : data.place === 3 ? '🥉' : '🏁';
  root.innerHTML = `
    <div class="card results">
      <h1>${medal} ${data.place}-е место из ${data.total}</h1>
      <div class="stats">
        <div><span>Время</span><b>${formatTime(data.time)}</b></div>
        <div><span>Лучший круг</span><b>${formatTime(data.bestLap)}</b></div>
        <div><span>Ошибок</span><b>${data.keyboard ? '—' : data.coach?.total ?? 0}</b></div>
      </div>
      <p>Круги: ${data.lapTimes.map(formatTime).join(' · ')}</p>
      <h2>Ошибки управления</h2>
      ${errorsBlock(data.coach, data.keyboard)}
      ${extra}
      <div class="row">
        <button class="btn primary" data-act="retry">Ещё раз</button>
        ${onRecalibrate ? '<button class="btn" data-act="recal">Перекалибровать руль</button>' : ''}
      </div>
    </div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-act="retry"]').onclick = onRetry;
  if (onRecalibrate) root.querySelector('[data-act="recal"]').onclick = onRecalibrate;
}
