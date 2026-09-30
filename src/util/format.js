// Форматирование времени для HUD, таблиц и итогов.

export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// Короткое время круга без минут, если их нет: 58.412 / 1:02.300.
export function formatLap(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  return sec < 60 ? sec.toFixed(3) : formatTime(sec);
}

// Разрыв: +1.234 / +1 круг.
export function formatGap(sec, laps = 0) {
  if (laps > 0) return `+${laps} ${laps === 1 ? 'круг' : laps < 5 ? 'круга' : 'кругов'}`;
  if (sec == null || !isFinite(sec)) return '—';
  return `+${sec.toFixed(3)}`;
}

// Дельта со знаком: −0.214 / +0.530.
export function formatDelta(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const sign = sec < 0 ? '−' : '+';
  return `${sign}${Math.abs(sec).toFixed(3)}`;
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
