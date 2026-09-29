// Маленькое превью камеры: зеркальное видео, скелет рук (зелёный — ок, красный — проблемная рука),
// иконка руля, которая поворачивается по steer, и индикаторы жестов.
import { drawHands } from '../vision/hands.js';

const OK = '#33e07a';
const BAD = '#ff4d5e';

function drawWheelIcon(ctx, x, y, r, steer, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(steer * (Math.PI / 4));
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, r);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // метка «верх руля»
  ctx.fillStyle = '#ffcc33';
  ctx.fillRect(-r * 0.12, -r * 1.12, r * 0.24, r * 0.3);
  ctx.restore();
}

function badge(ctx, x, y, size, label, on, color) {
  ctx.fillStyle = on ? color : 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, size * 2.2, size, size * 0.3);
  ctx.fill();
  ctx.fillStyle = on ? '#08110a' : '#fff';
  ctx.font = `700 ${size * 0.55}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + size * 1.1, y + size * 0.52);
}

function ring(ctx, x, y, r, p, color) {
  ctx.lineWidth = r * 0.25;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  ctx.stroke();
}

// s: { video, cameraReady, hands, input, hint, keyboard }
export function drawPreview(canvas, ctx, s) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (s.cameraReady) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // зеркалим видео, как в зеркале
    ctx.drawImage(s.video, 0, 0, w, h);
    ctx.restore();
  }
  if (s.keyboard) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
  }

  const inp = s.input || {};
  const hint = s.hint;
  const bad = (side) => hint && (hint.hand === side || hint.hand === 'both');
  // Какая из найденных рук левая/правая — берём из gestures.js (по ссылке на массив точек).
  drawHands(ctx, s.hands || [], w, h, (i, hand) => {
    const side = hand.landmarks === inp.left ? 'L' : hand.landmarks === inp.right ? 'R' : null;
    return side && bad(side) ? BAD : OK;
  });

  // линия руля между запястьями
  if (inp.left && inp.right) {
    ctx.strokeStyle = hint?.hand === 'both' ? BAD : 'rgba(255,204,51,0.9)';
    ctx.lineWidth = Math.max(2, w / 120);
    ctx.setLineDash([w / 40, w / 60]);
    ctx.beginPath();
    ctx.moveTo(inp.left[0].x * w, inp.left[0].y * h);
    ctx.lineTo(inp.right[0].x * w, inp.right[0].y * h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const u = w / 280;
  drawWheelIcon(ctx, 26 * u, 26 * u, 15 * u, inp.steer || 0, s.keyboard ? '#9fb0d0' : '#fff');

  // индикаторы жестов: левая / правая рука
  const sz = 20 * u;
  const lbl = (present, fist) => (!present ? '—' : fist ? '✊' : '✋');
  badge(ctx, w - sz * 4.8, 8 * u, sz, `Л ${lbl(!!inp.left || s.keyboard, inp.fistL)}`, inp.fistL, OK);
  badge(ctx, w - sz * 2.4, 8 * u, sz, `П ${lbl(!!inp.right || s.keyboard, inp.fistR)}`, inp.fistR, OK);

  // прогресс удержаний: нитро, старт, калибровка
  if (inp.nitroHold > 0) ring(ctx, w / 2, h / 2, 22 * u, inp.nitroHold, '#ffcc33');
  if (inp.startHold > 0) ring(ctx, w / 2, h / 2, 30 * u, inp.startHold, OK);
}
