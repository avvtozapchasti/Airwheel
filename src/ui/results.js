// Экран итогов заезда.
import { formatTime } from '../game/hud.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// data: { place, total, time, bestLap, lapTimes }
export function showResults(root, data, { onRetry }) {
  const medal = data.place === 1 ? '🥇' : data.place === 2 ? '🥈' : data.place === 3 ? '🥉' : '🏁';
  root.innerHTML = `
    <div class="card results">
      <h1>${medal} ${data.place}-е место из ${data.total}</h1>
      <div class="stats">
        <div><span>Время</span><b>${formatTime(data.time)}</b></div>
        <div><span>Лучший круг</span><b>${formatTime(data.bestLap)}</b></div>
        <div><span>Круги</span><b>${data.lapTimes.map(formatTime).map(esc).join(' · ')}</b></div>
      </div>
      <div class="row">
        <button class="btn primary" data-act="retry">Ещё раз</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-act="retry"]').onclick = onRetry;
}
