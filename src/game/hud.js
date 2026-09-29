// HUD поверх игрового canvas: спидометр, педали, нитро, круг, время, позиция, отсчёт.
import { KMH, MAX_SPEED, NITRO_TIME, NITRO_COOLDOWN } from './physics.js';
import { LAPS } from './track.js';

export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function panel(ctx, x, y, w, h, r) {
  ctx.fillStyle = 'rgba(8, 12, 24, 0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function text(ctx, str, x, y, size, color = '#fff', align = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

export function drawHud(ctx, w, h, s) {
  const u = Math.min(h / 720, w / 1100); // единица масштаба интерфейса
  const p = s.player;
  const pad = 16 * u;

  // --- позиция и круг (слева сверху) ---
  panel(ctx, pad, pad, 190 * u, 104 * u, 14 * u);
  text(ctx, 'ПОЗИЦИЯ', pad + 16 * u, pad + 20 * u, 13 * u, '#9fb0d0');
  text(ctx, `${s.position}`, pad + 16 * u, pad + 62 * u, 54 * u, '#ffcc33', 'left', 800);
  text(ctx, `/${s.total}`, pad + 16 * u + ctx.measureText(`${s.position}`).width + 4 * u, pad + 72 * u, 24 * u, '#fff');
  text(ctx, 'КРУГ', pad + 112 * u, pad + 20 * u, 13 * u, '#9fb0d0');
  text(ctx, `${Math.min(p.lap, LAPS)}/${LAPS}`, pad + 112 * u, pad + 62 * u, 30 * u, '#fff', 'left', 800);

  // --- время (по центру сверху) ---
  const tw = 300 * u;
  panel(ctx, w / 2 - tw / 2, pad, tw, 64 * u, 14 * u);
  text(ctx, formatTime(p.lapTime), w / 2, pad + 26 * u, 28 * u, '#fff', 'center', 800);
  text(ctx, `общее ${formatTime(p.totalTime)}   лучший ${formatTime(p.bestLap)}`, w / 2, pad + 50 * u, 13 * u, '#9fb0d0', 'center', 600);

  // --- спидометр (слева снизу) ---
  const r = 78 * u;
  const cx = pad + r + 10 * u;
  const cy = h - pad - r - 34 * u;
  panel(ctx, pad, cy - r - 14 * u, (r + 10 * u) * 2 + 120 * u, r * 2 + 62 * u, 18 * u);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.lineCap = 'round';
  ctx.lineWidth = 12 * u;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  const pct = Math.min(1.3, p.speed / MAX_SPEED) / 1.3;
  const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  grad.addColorStop(0, '#33e07a');
  grad.addColorStop(0.7, '#ffcc33');
  grad.addColorStop(1, '#ff4d5e');
  ctx.strokeStyle = p.nitroT > 0 ? '#4db8ff' : grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0.001, pct));
  ctx.stroke();
  text(ctx, `${Math.round(p.speed * KMH)}`, cx, cy - 4 * u, 44 * u, '#fff', 'center', 800);
  text(ctx, 'км/ч', cx, cy + 28 * u, 13 * u, '#9fb0d0', 'center');

  // --- педали: газ / тормоз / накат ---
  const pedal = s.input?.gas ? ['ГАЗ', '#33e07a'] : s.input?.brake ? ['ТОРМОЗ', '#ff4d5e'] : ['НАКАТ', '#9fb0d0'];
  const px = cx - r, py = cy + r + 4 * u;
  ctx.fillStyle = pedal[1];
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.roundRect(px, py - 14 * u, r * 2, 28 * u, 8 * u);
  ctx.fill();
  ctx.globalAlpha = 1;
  text(ctx, pedal[0], cx, py, 16 * u, pedal[1], 'center', 800);

  // --- кольцо нитро ---
  const nx = cx + r + 70 * u, ny = cy, nr = 40 * u;
  ctx.lineWidth = 9 * u;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(nx, ny, nr, 0, Math.PI * 2);
  ctx.stroke();
  let fill, color, label;
  if (p.nitroT > 0) {
    fill = p.nitroT / NITRO_TIME;
    color = '#4db8ff';
    label = 'NOS!';
  } else if (p.nitroCd > 0) {
    fill = 1 - p.nitroCd / NITRO_COOLDOWN;
    color = '#6b7a99';
    label = `${Math.ceil(p.nitroCd)} с`;
  } else {
    fill = s.input?.nitroHold || 0;
    color = '#ffcc33';
    label = fill > 0 ? 'ДЕРЖИ' : 'ГОТОВО';
  }
  if (fill > 0) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(nx, ny, nr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill);
    ctx.stroke();
  }
  text(ctx, 'НИТРО', nx, ny - 9 * u, 12 * u, '#9fb0d0', 'center');
  text(ctx, label, nx, ny + 10 * u, 15 * u, color, 'center', 800);
  text(ctx, s.keyboard ? 'Shift' : '👍 0,3 с', nx, ny + nr + 18 * u, 12 * u, '#9fb0d0', 'center', 600);

  // --- обратный отсчёт ---
  if (s.countdown != null) {
    const n = Math.ceil(s.countdown);
    const label2 = n > 0 ? String(n) : 'ВПЕРЁД!';
    const frac = s.countdown - Math.floor(s.countdown);
    const size = (n > 0 ? 180 : 110) * u * (1 + 0.25 * frac);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 20 * u;
    text(ctx, label2, w / 2, h * 0.4, size, n > 0 ? '#ffcc33' : '#33e07a', 'center', 900);
    ctx.restore();
  }

  // --- финиш ---
  if (p.finished) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 20 * u;
    text(ctx, 'ФИНИШ!', w / 2, h * 0.4, 120 * u, '#fff', 'center', 900);
    ctx.restore();
  }
}
