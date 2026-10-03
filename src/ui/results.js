// Экран итогов: таблица позиций (время/отставание/лучший круг/штрафы/пит-стопы и потери/очки/квала→финиш),
// время игрока по кругам, ошибки коуча по типам и главная ошибка заезда с советом.
import { formatTime, formatLap, esc } from '../util/format.js';
export { esc };

function errorsBlock(coach) {
  if (!coach || coach.total === 0) return '<p class="good">Ни одной ошибки. Чистый заезд!</p>';
  const rows = coach.items.map((e) => `<tr><td>${esc(e.title)}</td><td>${e.count}</td></tr>`).join('');
  return `
    <table class="errors">${rows}</table>
    <div class="main-error">
      <b>Главная ошибка заезда: ${esc(coach.main.title)}</b> (${coach.main.count})<br />
      ${esc(coach.main.advice)}
    </div>`;
}

function standingsTable(rows) {
  const delta = (r) => {
    if (r.grid == null) return '';
    const d = r.grid - r.pos;
    return d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '<span class="eq">•</span>';
  };
  const body = rows
    .map(
      (r) => `
      <tr class="${r.player ? 'me' : ''}">
        <td>${r.pos}</td>
        <td><i class="swatch" style="background:${r.color}"></i>${esc(r.name)}</td>
        <td>${r.pos === 1 ? formatTime(r.time) : esc(r.gapText)}</td>
        <td>${formatLap(r.bestLap)}</td>
        <td>${r.penalty ? `+${r.penalty.toFixed(0)} с` : ''}</td>
        <td>${r.pits ? `${r.pits} · ${r.pitLoss.toFixed(1)} с` : ''}</td>
        <td>${r.points || ''}</td>
        <td>${r.grid ?? ''} ${delta(r)}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="table-wrap"><table class="standings">
      <thead><tr><th>#</th><th>Пилот</th><th>Время</th><th>Лучший</th><th>Штраф</th><th>Пит-стопы</th><th>Очки</th><th>Старт</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// data: { subtitle, place, total, time, bestLap, lapTimes[], penalty, standings[], coach, keyboard, extra }
// handlers: { onRetry, onMenu }
export function showResults(root, data, { onRetry, onMenu }) {
  const medal = data.place === 1 ? '🥇' : data.place === 2 ? '🥈' : data.place === 3 ? '🥉' : '🏁';
  root.innerHTML = `
    <div class="card results wide">
      <p class="eyebrow">${esc(data.subtitle || '')}</p>
      <h1>${medal} ${data.total > 1 ? `${data.place}-е место из ${data.total}` : 'Финиш'}</h1>
      <div class="stats">
        <div><span>Время</span><b>${formatTime(data.time)}</b></div>
        <div><span>Лучший круг</span><b>${formatLap(data.bestLap)}</b></div>
        <div><span>Штрафы</span><b>${data.penalty ? `+${data.penalty.toFixed(0)} с` : '—'}</b></div>
        <div><span>Ошибок</span><b>${data.coach?.total ?? 0}</b></div>
      </div>
      <p>Круги: ${data.lapTimes.map((l) => (l.valid === false ? `<s>${formatLap(l.time)}</s>` : formatLap(l.time ?? l))).join(' · ')}</p>
      ${data.standings && data.standings.length > 1 ? `<h2>Итоговый протокол</h2>${standingsTable(data.standings)}` : ''}
      <h2>Ошибки ${data.keyboard ? 'езды' : 'управления'}</h2>
      ${errorsBlock(data.coach)}
      ${data.extra || ''}
      <div class="row">
        <button class="btn primary" data-act="retry">Ещё раз</button>
        ${onMenu ? '<button class="btn" data-act="menu">Другая трасса</button>' : ''}
      </div>
    </div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-act="retry"]').onclick = onRetry;
  if (onMenu) root.querySelector('[data-act="menu"]').onclick = onMenu;
}
