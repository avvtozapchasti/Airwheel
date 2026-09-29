// Псевдо-3D рендерер: проекция сегментов дороги, спрайты рисуются кодом (без ассетов).
import { SEGMENT_LENGTH, ROAD_WIDTH, LANES } from './track.js';

const FOV = 100;
export const CAMERA_HEIGHT = 1000;
export const CAMERA_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH; // расстояние от камеры до машины игрока
const DRAW_DISTANCE = 180;
const FOG_DENSITY = 4;
const FOG_COLOR = '#b9d3ea';
export const CAR_WIDTH = 520; // ширина машины в мировых единицах

const lerp = (a, b, p) => a + (b - a) * p;

function project(p, camX, camY, camZ, w, h) {
  p.camera.x = (p.world.x || 0) - camX;
  p.camera.y = p.world.y - camY;
  p.camera.z = p.world.z - camZ;
  const s = (p.screen.scale = CAMERA_DEPTH / p.camera.z);
  p.screen.x = Math.round(w / 2 + (s * p.camera.x * w) / 2);
  p.screen.y = Math.round(h / 2 - (s * p.camera.y * h) / 2);
  p.screen.w = Math.round((s * ROAD_WIDTH * w) / 2);
}

function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

// Машина вид сзади. cx, by — центр низа; w — ширина в пикселях.
export function drawCar(ctx, cx, by, w, color, opt = {}) {
  const h = w * 0.62;
  const lean = (opt.steer || 0) * w * 0.05;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, by - h * 0.02, w * 0.56, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // колёса
  ctx.fillStyle = '#151515';
  ctx.fillRect(cx - w * 0.5, by - h * 0.34, w * 0.2, h * 0.34);
  ctx.fillRect(cx + w * 0.3, by - h * 0.34, w * 0.2, h * 0.34);
  // кузов
  poly(ctx, [cx - w * 0.5, by - h * 0.12, cx + w * 0.5, by - h * 0.12, cx + w * 0.47, by - h * 0.58, cx - w * 0.47, by - h * 0.58], color);
  // кабина
  poly(ctx, [cx - w * 0.36, by - h * 0.56, cx + w * 0.36, by - h * 0.56, cx + w * 0.26 + lean, by - h, cx - w * 0.26 + lean, by - h], color);
  poly(ctx, [cx - w * 0.3, by - h * 0.6, cx + w * 0.3, by - h * 0.6, cx + w * 0.22 + lean, by - h * 0.93, cx - w * 0.22 + lean, by - h * 0.93], '#1d2a3a');
  // спойлер
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(cx - w * 0.46, by - h * 0.62, w * 0.92, h * 0.06);
  // бампер и номер
  ctx.fillStyle = '#222';
  ctx.fillRect(cx - w * 0.5, by - h * 0.18, w, h * 0.08);
  ctx.fillStyle = '#eee';
  ctx.fillRect(cx - w * 0.1, by - h * 0.34, w * 0.2, h * 0.1);
  // стоп-сигналы
  ctx.fillStyle = opt.brake ? '#ff3030' : '#8c1414';
  ctx.fillRect(cx - w * 0.44, by - h * 0.48, w * 0.2, h * 0.1);
  ctx.fillRect(cx + w * 0.24, by - h * 0.48, w * 0.2, h * 0.1);
  if (opt.brake) {
    ctx.fillStyle = 'rgba(255,40,40,0.25)';
    ctx.beginPath();
    ctx.arc(cx - w * 0.34, by - h * 0.43, w * 0.16, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.34, by - h * 0.43, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  // пламя нитро
  if (opt.nitro) {
    const fl = h * (0.25 + Math.random() * 0.2);
    poly(ctx, [cx - w * 0.3, by - h * 0.14, cx - w * 0.2, by - h * 0.14, cx - w * 0.25, by - h * 0.14 + fl], '#4db8ff');
    poly(ctx, [cx + w * 0.2, by - h * 0.14, cx + w * 0.3, by - h * 0.14, cx + w * 0.25, by - h * 0.14 + fl], '#4db8ff');
  }
}

// Спрайты окружения. s — пикселей на мировую единицу.
function drawSprite(ctx, type, x, y, s) {
  switch (type) {
    case 'pine': {
      const w = 700 * s, h = 1800 * s;
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(x - w * 0.07, y - h * 0.2, w * 0.14, h * 0.2);
      poly(ctx, [x - w / 2, y - h * 0.18, x + w / 2, y - h * 0.18, x, y - h * 0.62], '#1f6b35');
      poly(ctx, [x - w * 0.4, y - h * 0.45, x + w * 0.4, y - h * 0.45, x, y - h * 0.85], '#24803f');
      poly(ctx, [x - w * 0.28, y - h * 0.7, x + w * 0.28, y - h * 0.7, x, y - h], '#2c9449');
      break;
    }
    case 'tree': {
      const w = 900 * s, h = 1500 * s;
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(x - w * 0.07, y - h * 0.45, w * 0.14, h * 0.45);
      ctx.fillStyle = '#3c9a3a';
      ctx.beginPath();
      ctx.arc(x, y - h * 0.68, w * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4db14a';
      ctx.beginPath();
      ctx.arc(x - w * 0.12, y - h * 0.76, w * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bush': {
      const w = 600 * s, h = 350 * s;
      ctx.fillStyle = '#2f8a36';
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.45, w / 2, h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'post': {
      const w = 60 * s, h = 380 * s;
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.fillStyle = '#d8342c';
      ctx.fillRect(x - w / 2, y - h, w, h * 0.2);
      break;
    }
    case 'sign_left':
    case 'sign_right': {
      const w = 520 * s, h = 800 * s;
      ctx.fillStyle = '#444';
      ctx.fillRect(x - w * 0.04, y - h * 0.55, w * 0.08, h * 0.55);
      ctx.fillStyle = '#ffcc33';
      ctx.fillRect(x - w / 2, y - h, w, h * 0.48);
      ctx.fillStyle = '#111';
      const d = type === 'sign_right' ? 1 : -1;
      const cy = y - h * 0.76;
      for (let k = -1; k <= 1; k++) {
        const ox = x + k * w * 0.28;
        poly(ctx, [ox - d * w * 0.1, cy - h * 0.14, ox + d * w * 0.1, cy, ox - d * w * 0.1, cy + h * 0.14, ox - d * w * 0.02, cy], '#111');
      }
      break;
    }
    case 'gate': {
      const half = ROAD_WIDTH * 1.15 * s, h = 1700 * s, t = 120 * s;
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - half - t, y - h, t, h);
      ctx.fillRect(x + half, y - h, t, h);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(x - half - t, y - h - t * 2.5, half * 2 + t * 2, t * 3);
      // шахматка
      const cells = 16, cw = (half * 2 + t * 2) / cells;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < cells; i++) {
        ctx.fillRect(x - half - t + i * cw, y - h - t * 2.5 + (i % 2 ? 0 : t * 1.5), cw, t * 1.5);
      }
      break;
    }
    default:
      break;
  }
}

// Примерная экранная высота спрайта в мировых единицах (для отсечения).
const SPRITE_H = { pine: 1800, tree: 1500, bush: 350, post: 380, sign_left: 800, sign_right: 800, gate: 2000 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.quality = 1; // множитель разрешения, снижается при низком FPS
    this.skyOffset = 0;
    this.hillOffset = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * this.quality;
    this.width = Math.round(window.innerWidth * dpr);
    this.height = Math.round(window.innerHeight * dpr);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  drawBackground(ctx, w, h) {
    const horizon = h * 0.5;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#2a6fd6');
    sky.addColorStop(1, '#a9d4f5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // солнце
    ctx.fillStyle = 'rgba(255,240,180,0.9)';
    ctx.beginPath();
    ctx.arc(w * 0.78 - this.skyOffset * w * 0.05, horizon * 0.35, h * 0.06, 0, Math.PI * 2);
    ctx.fill();
    // два слоя гор с параллаксом
    this.drawRidge(ctx, w, h, horizon, this.skyOffset * 0.5, 0.2, '#7fa6c9', 7);
    this.drawRidge(ctx, w, h, horizon, this.hillOffset, 0.12, '#4c8a5a', 11);
  }

  drawRidge(ctx, w, h, horizon, offset, amp, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps + offset;
      const y =
        horizon -
        h * amp * (0.55 + 0.3 * Math.sin(u * 6.283 * 2 + seed) + 0.15 * Math.sin(u * 6.283 * 5 + seed * 3));
      ctx.lineTo((i / steps) * w, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  drawSegment(ctx, w, s, fog) {
    const { p1, p2, color } = s;
    const x1 = p1.screen.x, y1 = p1.screen.y, w1 = p1.screen.w;
    const x2 = p2.screen.x, y2 = p2.screen.y, w2 = p2.screen.w;
    ctx.fillStyle = color.grass;
    ctx.fillRect(0, y2, w, y1 - y2);
    const r1 = w1 / 8, r2 = w2 / 8;
    poly(ctx, [x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2], color.rumble);
    poly(ctx, [x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2], color.rumble);
    poly(ctx, [x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2], color.road);
    if (color.lane) {
      const l1 = w1 / 40, l2 = w2 / 40;
      const lw1 = (w1 * 2) / LANES, lw2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
        poly(ctx, [lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2], color.lane);
      }
    }
    if (fog > 0.01) {
      ctx.globalAlpha = fog;
      ctx.fillStyle = FOG_COLOR;
      ctx.fillRect(0, y2, w, y1 - y2);
      ctx.globalAlpha = 1;
    }
  }

  // state: { track, player, bots, shake, dt, fx }
  render(state) {
    const { track, player, bots = [] } = state;
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    const segs = track.segments;
    const N = segs.length;

    // параллакс фона зависит от кривизны и скорости
    const baseSeg = track.findSegment(player.z - PLAYER_Z);
    const speedPct = player.speed / (SEGMENT_LENGTH * 60);
    this.skyOffset = (this.skyOffset + 0.001 * baseSeg.curve * speedPct) % 1;
    this.hillOffset = (this.hillOffset + 0.002 * baseSeg.curve * speedPct) % 1;

    ctx.save();
    if (state.shake > 0) {
      const a = state.shake * h * 0.03;
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }
    this.drawBackground(ctx, w, h);

    const camZ = track.wrapZ(player.z - PLAYER_Z);
    const basePct = (camZ % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerSeg = track.findSegment(player.z);
    const playerPct = (track.wrapZ(player.z) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPct);

    let maxy = h;
    let x = 0;
    let dx = -(baseSeg.curve * basePct);

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const s = segs[(baseSeg.index + n) % N];
      s.looped = s.index < baseSeg.index;
      s.fog = 1 - Math.exp(-((n / DRAW_DISTANCE) ** 2) * FOG_DENSITY);
      s.clip = maxy;
      const cz = camZ - (s.looped ? track.length : 0);
      project(s.p1, player.x * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, cz, w, h);
      project(s.p2, player.x * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, cz, w, h);
      x += dx;
      dx += s.curve;
      s.visible = !(s.p1.camera.z <= CAMERA_DEPTH || s.p2.screen.y >= s.p1.screen.y || s.p2.screen.y >= maxy);
      if (!s.visible) continue;
      this.drawSegment(ctx, w, s, s.fog);
      maxy = s.p1.screen.y;
    }

    // Раскладываем ботов по сегментам для отрисовки сзади наперёд.
    const carsBySeg = new Map();
    for (const b of bots) {
      const idx = Math.floor(track.wrapZ(b.z) / SEGMENT_LENGTH) % N;
      if (!carsBySeg.has(idx)) carsBySeg.set(idx, []);
      carsBySeg.get(idx).push(b);
    }

    for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
      const s = segs[(baseSeg.index + n) % N];
      if (s.p1.camera.z <= CAMERA_DEPTH) continue;
      // спрайты окружения
      for (const sp of s.sprites) {
        const scale = s.p1.screen.scale;
        const px = (scale * w) / 2; // пикселей на мировую единицу
        const sx = s.p1.screen.x + scale * sp.offset * ROAD_WIDTH * (w / 2);
        const sy = s.p1.screen.y;
        this.clipped(ctx, w, sy, (SPRITE_H[sp.type] || 1000) * px, s.clip, () => drawSprite(ctx, sp.type, sx, sy, px));
      }
      // машины ботов
      const cars = carsBySeg.get(s.index);
      if (cars) {
        for (const car of cars) {
          const pct = (track.wrapZ(car.z) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
          const scale = lerp(s.p1.screen.scale, s.p2.screen.scale, pct);
          const cx = lerp(s.p1.screen.x, s.p2.screen.x, pct) + (scale * car.x * ROAD_WIDTH * w) / 2;
          const cy = lerp(s.p1.screen.y, s.p2.screen.y, pct);
          const cw = (scale * CAR_WIDTH * w) / 2;
          if (cw < 2) continue;
          this.clipped(ctx, w, cy, cw * 0.62, s.clip, () => drawCar(ctx, cx, cy, cw, car.color, { brake: car.braking }));
        }
      }
    }

    // машина игрока
    const pw = ((CAMERA_DEPTH / PLAYER_Z) * CAR_WIDTH * w) / 2;
    const bounce = player.speed > 0 ? (Math.random() - 0.5) * h * 0.003 * speedPct : 0;
    const py = h - h * 0.025 + bounce;
    if (state.fx) state.fx.drawUnderPlayer?.(ctx, w / 2, py, pw);
    drawCar(ctx, w / 2, py, pw, '#e8262c', { steer: player.steer, brake: player.braking, nitro: player.nitroT > 0 });
    if (state.fx) state.fx.drawOverlay?.(ctx, w, h, w / 2, py, pw);
    ctx.restore();
  }

  // Рисует объект с учётом того, что холм впереди может его частично закрывать.
  clipped(ctx, w, bottomY, height, clipY, draw) {
    if (bottomY - height >= clipY) return; // полностью за холмом
    if (bottomY <= clipY) {
      draw();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, clipY);
    ctx.clip();
    draw();
    ctx.restore();
  }
}
