// HUD гонки: DOM для текста (позиция, тайминг, башня лидеров, сообщения, огни старта)
// и два маленьких canvas — приборная панель и мини-карта. Текст в DOM обновляется,
// только если изменился, чтобы не нагружать браузер каждый кадр.
import { formatTime, formatDelta, formatLap } from '../util/format.js';

const SECTOR_COLORS = { purple: '#b44cff', green: '#2fd46d', yellow: '#ffcc33' };

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

function setText(e, t) {
  if (e._t !== t) {
    e._t = t;
    e.textContent = t;
  }
}

function setHtml(e, h) {
  if (e._h !== h) {
    e._h = h;
    e.innerHTML = h;
  }
}

function fitCanvas(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return dpr;
}

export class Hud {
  constructor(root) {
    this.root = root;
    root.classList.add('hud');
    // позиция и круг
    const pos = el('div', 'hud-pos', root);
    this.posEl = el('div', 'pos', pos);
    this.lapEl = el('div', 'lap', pos);
    // башня лидеров
    this.tower = el('div', 'hud-tower', root);
    // тайминг
    const tm = el('div', 'hud-timing', root);
    this.sessionEl = el('div', 'session', tm);
    this.timeEl = el('div', 'time', tm);
    this.deltaEl = el('div', 'delta', tm);
    const sec = el('div', 'sectors', tm);
    this.secEls = [0, 1, 2].map((k) => el('span', '', sec, `S${k + 1}`));
    this.bestEl = el('div', 'best', tm);
    // мини-карта и панель
    this.mapCanvas = el('canvas', 'hud-map', root);
    this.dashCanvas = el('canvas', 'hud-dash', root);
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.dashCtx = this.dashCanvas.getContext('2d');
    // сообщения и огни
    this.msgEl = el('div', 'hud-msg', root);
    this.lightsEl = el('div', 'hud-lights', root, '<i></i><i></i><i></i><i></i><i></i>');
    this.lights = [...this.lightsEl.children];
    this.bigEl = el('div', 'hud-big', root);
    this.msgT = 0;
    this.towerT = 0;
    this.track = null;
    this.visible = false;
    this.show(false);
  }

  show(on) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
  }

  // Мини-карта: заранее считаем контур трассы в долях.
  setTrack(track) {
    this.track = track;
    const b = track.bounds;
    const pts = [];
    for (let i = 0; i < track.n; i += 4) pts.push([track.x[i], track.z[i]]);
    this.mapPts = pts;
    this.mapBounds = b;
  }

  message(text, kind = 'info', sec = 2.2) {
    this.msgEl.textContent = text;
    this.msgEl.className = `hud-msg show ${kind}`;
    this.msgT = sec;
  }

  // Крупная надпись по центру (ФИНИШ, КВАЛИФИКАЦИЯ, отсчёт).
  big(text, kind = '') {
    setText(this.bigEl, text || '');
    this.bigEl.className = `hud-big ${text ? 'show' : ''} ${kind}`;
  }

  setLights(n, out = false) {
    this.lightsEl.classList.toggle('show', n > 0 || out);
    this.lightsEl.classList.toggle('out', out);
    this.lights.forEach((l, k) => l.classList.toggle('on', k < n && !out));
  }

  // s: { car, spec, input, timing, session, pos, total, lap, laps, tower[], cars[], keyboard, dt }
  update(s) {
    if (!this.visible) return;
    const dt = s.dt || 0.016;
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msgEl.classList.remove('show');
    }
    const t = s.timing;
    setHtml(this.posEl, s.pos ? `<small>P</small>${s.pos}<small>/${s.total}</small>` : '');
    setHtml(this.lapEl, s.laps ? `КРУГ <b>${Math.min(s.lap, s.laps)}/${s.laps}</b>` : s.lapLabel || '');
    setText(this.sessionEl, s.session || '');
    if (t) {
      const cur = s.lapTime ?? 0;
      setText(this.timeEl, formatTime(cur));
      const d = t.delta;
      if (d != null && t.bestLap) {
        setText(this.deltaEl, formatDelta(d));
        this.deltaEl.className = `delta ${d < 0 ? 'good' : 'bad'}`;
      } else {
        setText(this.deltaEl, '');
      }
      setText(this.bestEl, `лучший ${formatLap(t.bestLap)}${s.lastLap ? `  ·  прошлый ${formatLap(s.lastLap)}` : ''}`);
      // первые 3 с нового круга показываем цвета секторов прошлого
      const showLast = cur < 3 && t.lapTimes.length > 0 && t.sector === 0;
      for (let k = 0; k < 3; k++) {
        const c = showLast ? t.lastColors[k] : t.colors[k] || (t.sector > k ? 'yellow' : null);
        const e = this.secEls[k];
        const bg = c ? SECTOR_COLORS[c] : '';
        if (e._bg !== bg) {
          e._bg = bg;
          e.style.background = bg || 'rgba(255,255,255,0.12)';
          e.style.color = c ? '#111' : '#cfd8ea';
        }
      }
    }
    // башня лидеров — 4 раза в секунду
    this.towerT -= dt;
    if (this.towerT <= 0 && s.tower) {
      this.towerT = 0.25;
      const rows = s.tower
        .map(
          (r) =>
            `<div class="row${r.player ? ' me' : ''}${r.out ? ' out' : ''}"><span class="p">${r.pos}</span><i style="background:${r.color}"></i><span class="c">${r.code}</span><span class="g">${r.gap}</span></div>`,
        )
        .join('');
      setHtml(this.tower, rows);
    }
    this.drawDash(s);
    this.drawMap(s);
  }

  drawDash(s) {
    const c = this.dashCanvas, ctx = this.dashCtx;
    const dpr = fitCanvas(c);
    const W = c.width, H = c.height;
    const u = W / 340;
    ctx.clearRect(0, 0, W, H);
    const car = s.car, spec = s.spec;
    // подложка
    ctx.fillStyle = 'rgba(8,12,24,0.66)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 16 * u);
    ctx.fill();
    // тахометр: 20 сегментов
    const rpmK = Math.max(0, (car.rpm - spec.rpm.idle) / (spec.rpm.max - spec.rpm.idle));
    const shift = car.rpm > spec.rpm.shift * 0.97;
    const segs = 20;
    for (let k = 0; k < segs; k++) {
      const on = k / segs < rpmK;
      const f = k / segs;
      ctx.fillStyle = !on ? 'rgba(255,255,255,0.1)' : shift ? (Math.floor(performance.now() / 80) % 2 ? '#4db8ff' : '#ff3b4d') : f < 0.6 ? '#2fd46d' : f < 0.85 ? '#ffcc33' : '#ff3b4d';
      ctx.fillRect(14 * u + k * 11.2 * u, 12 * u, 9 * u, 10 * u);
    }
    // скорость и передача
    const kmh = Math.round(Math.hypot(car.u, car.v) * 3.6);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.font = `800 ${58 * u}px system-ui, sans-serif`;
    ctx.fillText(String(kmh), 150 * u, 88 * u);
    ctx.font = `600 ${13 * u}px system-ui, sans-serif`;
    ctx.fillStyle = '#9fb0d0';
    ctx.fillText('км/ч', 150 * u, 106 * u);
    // передача
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(162 * u, 36 * u, 48 * u, 62 * u, 10 * u);
    ctx.fill();
    ctx.fillStyle = shift ? '#ff3b4d' : '#ffcc33';
    ctx.textAlign = 'center';
    ctx.font = `800 ${42 * u}px system-ui, sans-serif`;
    const gear = car.reverse ? 'R' : Math.abs(car.u) < 0.5 && car.throttle < 0.1 ? 'N' : String(car.gear + 1);
    ctx.fillText(gear, 186 * u, 83 * u);
    // педали
    const inp = s.input || {};
    const chips = [
      ['ГАЗ', inp.gas && !car.reverse, '#2fd46d'],
      ['ТОРМОЗ', inp.brake, '#ff3b4d'],
      ['НАКАТ', !inp.gas && !inp.brake, '#9fb0d0'],
    ];
    ctx.font = `800 ${11 * u}px system-ui, sans-serif`;
    chips.forEach(([label, on, col], k) => {
      const x = 14 * u + k * 66 * u, y = 118 * u;
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(x, y, 60 * u, 22 * u, 6 * u);
      ctx.fill();
      ctx.fillStyle = on ? '#08110a' : '#9fb0d0';
      ctx.fillText(label, x + 30 * u, y + 15.5 * u);
    });
    // кольцо Boost / ERS
    const cx = 272 * u, cy = 72 * u, r = 40 * u;
    ctx.lineCap = 'round';
    ctx.lineWidth = 9 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const e = car.boostEnergy;
    const ready = e >= 0.25;
    ctx.strokeStyle = car.boostOn ? '#4db8ff' : ready ? '#ffcc33' : '#6b7a99';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, e));
    ctx.stroke();
    if (inp.nitroHold > 0 && !car.boostOn) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 10 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * inp.nitroHold);
      ctx.stroke();
    }
    ctx.fillStyle = '#9fb0d0';
    ctx.font = `700 ${12 * u}px system-ui, sans-serif`;
    ctx.fillText(spec.boost.name, cx, cy - 6 * u);
    ctx.fillStyle = car.boostOn ? '#4db8ff' : ready ? '#ffcc33' : '#6b7a99';
    ctx.font = `800 ${16 * u}px system-ui, sans-serif`;
    ctx.fillText(car.boostOn ? 'ВКЛ' : ready ? `${Math.round(e * 100)}%` : 'заряд', cx, cy + 14 * u);
    ctx.fillStyle = '#9fb0d0';
    ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
    ctx.fillText(s.keyboard ? 'Shift / N' : '👍 0,3 с', cx, cy + r + 20 * u);
    void dpr;
  }

  drawMap(s) {
    if (!this.mapPts) return;
    const c = this.mapCanvas, ctx = this.mapCtx;
    fitCanvas(c);
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const b = this.mapBounds;
    const pad = W * 0.08;
    const sc = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
    const mx = (x) => ox + (x - b.minX) * sc;
    const mz = (z) => oz + (z - b.minZ) * sc;
    ctx.fillStyle = 'rgba(8,12,24,0.55)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, W * 0.06);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(2, W / 45);
    ctx.beginPath();
    this.mapPts.forEach(([x, z], k) => (k ? ctx.lineTo(mx(x), mz(z)) : ctx.moveTo(mx(x), mz(z))));
    ctx.closePath();
    ctx.stroke();
    // старт/финиш
    const t = this.track;
    ctx.fillStyle = '#fff';
    ctx.fillRect(mx(t.x[0]) - W / 60, mz(t.z[0]) - W / 60, W / 30, W / 30);
    // машины: сначала соперники, потом игрок поверх
    const cars = s.cars || [];
    for (const pass of [false, true]) {
      for (const m of cars) {
        if (!!m.player !== pass) continue;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(mx(m.x), mz(m.z), (m.player ? W / 26 : W / 40), 0, Math.PI * 2);
        ctx.fill();
        if (m.player) {
          ctx.strokeStyle = '#111';
          ctx.lineWidth = W / 110;
          ctx.stroke();
        }
      }
    }
  }
}
