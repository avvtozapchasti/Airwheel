// Визуальные эффекты вокруг машины игрока: дым при торможении, пыль на обочине,
// линии скорости при нитро. Тряска при ударе делается в renderer.js.
import { MAX_SPEED } from './physics.js';

const MAX_PARTICLES = 120;

export class Effects {
  constructor() {
    this.particles = [];
    this.lines = [];
    this.nitroOn = false;
    this.player = null;
  }

  reset() {
    this.particles.length = 0;
  }

  update(dt, player) {
    this.player = player;
    this.nitroOn = player.nitroT > 0;
    const pct = player.speed / MAX_SPEED;
    const smoke = player.braking && pct > 0.2;
    const dust = player.offroad && pct > 0.1;
    if ((smoke || dust) && this.particles.length < MAX_PARTICLES) {
      const n = smoke ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.particles.push({
          x: side * (0.38 + Math.random() * 0.08), // в долях ширины машины
          y: 0,
          vx: side * (0.1 + Math.random() * 0.3),
          vy: -(0.3 + Math.random() * 0.4),
          life: 1,
          size: 0.035 + Math.random() * 0.04,
          color: smoke ? '220,220,225' : '150,120,80',
        });
      }
    }
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += dt * 0.18;
      p.life -= dt * 1.6;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // Рисуется поверх машины: cx, by — центр низа машины, cw — её ширина в пикселях.
  drawOverlay(ctx, w, h, cx, by, cw) {
    for (const p of this.particles) {
      ctx.fillStyle = `rgba(${p.color},${(p.life * 0.3).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx + p.x * cw, by + p.y * cw * 0.4, p.size * cw, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.nitroOn) this.drawSpeedLines(ctx, w, h);
  }

  drawSpeedLines(ctx, w, h) {
    const cx = w / 2, cy = h * 0.45;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, w / 700);
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = (0.35 + Math.random() * 0.3) * w;
      const r1 = r0 + (0.08 + Math.random() * 0.15) * w;
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6);
    }
    ctx.stroke();
    // лёгкая голубая виньетка
    const g = ctx.createRadialGradient(cx, cy, w * 0.3, cx, cy, w * 0.75);
    g.addColorStop(0, 'rgba(77,184,255,0)');
    g.addColorStop(1, 'rgba(77,184,255,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
