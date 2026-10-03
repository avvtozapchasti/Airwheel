// Соперники. Лёгкие в вычислении: кинематика вдоль трассы (прогресс + боковое смещение),
// без полной физики, но с честными ограничениями того же класса машины:
//  - едут по гоночной траектории (снаружи — внутрь — наружу), скорость — из профиля
//    торможения/разгона, поэтому тормозят в тех же зонах, что должен тормозить игрок;
//  - «мастерство» 0.93–1.0 масштабирует скорость в поворотах, характер (агрессивный /
//    аккуратный) — желание обгонять и частоту ошибок; ошибки — поздний тормоз и вынос наружу;
//  - обгон: если сзади ближе 15 м на прямой — смещаются на свободную сторону;
//    в поворотах и узких местах едут следом;
//  - резиновая связь ±5%: лидеры чуть медленнее, если игрок сильно отстал, и наоборот.
//  - шины и пит-стопы: износ по составу и стилю, сцепление по влажности (профиль скорости
//    смешивается между «сухим» и «мокрым»); решение о пит-стопе — на подходе к въезду
//    (износ, дождь, сохнущая трасса), в пит-лейне — тот же лимит 60 км/ч и честная остановка
//    в боксе 2.5–4 с, без «читов» по времени.
import { accelAt, brakeAt, topSpeed, speedProfile } from './profile.js';
import { clamp, smoothstep, rng as makeRng } from '../util/rng.js';
import { COMPOUNDS, compoundGrip, wearGrip, suggestCompound } from './tires.js';
import { PIT_LIMIT } from './pit.js';

const WET_GRIP = 0.64; // сцепление «мокрого» профиля бота относительно сухого
// износ за круг по составу (стиль «агрессивный» — +25%)
const WEAR_PER_LAP = { soft: 0.24, medium: 0.13, wet: 0.15 };

export const DRIVERS = [
  { name: 'Вихрь', code: 'ВИХ', color: '#2f7cf6' },
  { name: 'Гром', code: 'ГРО', color: '#ff7a00' },
  { name: 'Искра', code: 'ИСК', color: '#9b4dff' },
  { name: 'Тень', code: 'ТЕН', color: '#18b89b' },
  { name: 'Комета', code: 'КОМ', color: '#e63946' },
  { name: 'Буря', code: 'БУР', color: '#2a9d8f' },
  { name: 'Сокол', code: 'СОК', color: '#e9ecef' },
  { name: 'Лёд', code: 'ЛЁД', color: '#8ecae6' },
  { name: 'Ракета', code: 'РАК', color: '#ff4d8d' },
  { name: 'Барс', code: 'БАР', color: '#6c757d' },
  { name: 'Шторм', code: 'ШТО', color: '#3a0ca3' },
];

// Сложность соперников: множитель к скорости в поворотах поверх «мастерства».
export const DIFFICULTY = { easy: 0.8, medium: 0.87, hard: 0.94 };

export class Bot {
  constructor(def, spec, track, prof, { skill, style, seed }) {
    // prof — собственный профиль скорости бота (см. createBots)
    this.def = def;
    this.name = def.name;
    this.code = def.code;
    this.color = def.color;
    this.spec = spec;
    this.track = track;
    this.prof = prof;
    this.skill = skill;
    this.style = style; // 'aggressive' | 'careful'
    this.rng = makeRng(seed);
    this.vTop = topSpeed(spec);
    // состояние
    this.progress = 0;
    this.s = 0;
    this.d = 0;
    this.dVel = 0;
    this.v = 0;
    this.pass = 0; // смещение для обгона
    this.passT = 0;
    this.mistake = null;
    this.react = 0.15 + this.rng() * 0.35; // реакция на старте
    this.idx = 0;
    // для рендера (тот же интерфейс, что у машины игрока)
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.psi = 0;
    this.pitch = 0;
    this.roll = 0;
    this.spin = 0;
    this.delta = 0;
    this.brake = 0;
    this.bounce = 0;
    this.prev = { x: 0, y: 0, z: 0, psi: 0 };
    this.hitCd = 0;
    this.lastBrakeZone = -1;
    // шины и пит-стоп
    this.tire = { compound: 'medium', wear: 0, grip: 1 };
    this.pit = { phase: 'track', plan: null, t: 0, decided: -1, box: 0, tIn: 0 };
    this.pitStops = [];
    this.inBox = false;
  }

  place(s, d) {
    this.progress = s;
    this.s = this.track.wrapS(s);
    this.d = d;
    this.dVel = 0;
    this.v = 0;
    this.pose(0);
    this.savePrev();
  }

  savePrev() {
    this.prev.x = this.x;
    this.prev.y = this.y;
    this.prev.z = this.z;
    this.prev.psi = this.psi;
  }

  pose(ax) {
    const tr = this.track;
    const p = tr.pointAt(this.s, this.d);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    const i = (this.idx = tr.index(this.s));
    const slip = Math.atan2(this.dVel, Math.max(this.v, 3));
    this.psi = tr.headingAt(this.s) + slip;
    const kLine = tr.racingLine.kappa[i];
    const ay = this.v * this.v * kLine;
    this.roll += (clamp(ay * 0.004, -0.06, 0.06) - this.roll) * 0.1;
    this.pitch += (clamp(-ax * 0.0035, -0.04, 0.04) - this.pitch) * 0.1;
    this.delta = clamp(Math.atan(this.spec.wheelbase * kLine) * 1.2 + slip * 0.5, -0.4, 0.4);
  }

  get u() {
    return this.v;
  }
}

// Поле соперников: 11 ботов с разным мастерством и характером, в случайном порядке.
export function createBots(count, spec, track, opts = {}) {
  const { seed = Date.now() % 100000, difficulty = 'medium' } = opts;
  const r = makeRng(seed);
  const defs = [...DRIVERS].sort(() => r() - 0.5).slice(0, count);
  const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  return defs.map((def, k) => {
    const skill = 0.93 + r() * 0.07;
    const style = r() < 0.5 ? 'aggressive' : 'careful';
    const pace = skill * diff;
    // свой профиль: сцепление × темп² → скорость в поворотах × темп, торможение раньше,
    // а на прямой — та же машина, что у игрока
    const own = speedProfile(track, track.racingLine, spec, { gripK: pace * pace });
    const b = new Bot(def, spec, track, own, { skill, style, seed: seed + k * 97 });
    // «мокрый» профиль: тот же темп при сцеплении шин ×0.64 (сухие на мокром)
    b.profWet = speedProfile(track, track.racingLine, spec, { gripK: pace * pace * WET_GRIP });
    b.pace = pace;
    b.bps = opts.bps || [];
    return b;
  });
}

// Квалификационное время бота: его идеальный круг, ±1.5% разброса по мастерству.
// wetness — средняя влажность сессии: в дождь круг медленнее (на подходящих шинах).
export function qualiTime(bot, r = Math.random, wetness = 0) {
  const g = compoundGrip(wetness > 0.33 ? 'wet' : 'medium', wetness);
  const f = clamp((1 - g) / (1 - WET_GRIP), -0.1, 1.2);
  const lap = bot.prof.lapTime + ((bot.profWet?.lapTime ?? bot.prof.lapTime) - bot.prof.lapTime) * f;
  return lap * (1 + (r() * 2 - 1) * 0.015);
}

// Стартовые шины ботов по погоде.
export function botStartTires(bots, weatherMode, laps) {
  for (const b of bots) {
    const compound = weatherMode === 'rain' ? 'wet' : laps <= 3 && b.style === 'aggressive' ? 'soft' : 'medium';
    b.tire = { compound, wear: 0, grip: 1 };
    b.pit = { phase: 'track', plan: null, t: 0, decided: -1, box: b.pit.box, tIn: 0 };
    b.pitStops = [];
    b.inBox = false;
  }
}

// Скорость бота по профилю с учётом шин: смесь сухого и мокрого профиля по сцеплению.
function profileSpeed(b, i) {
  const g = b.tire.grip;
  const f = clamp((1 - g) / (1 - WET_GRIP), -0.1, 1.2);
  const dry = b.prof.v[i];
  return b.profWet ? dry + (b.profWet.v[i] - dry) * f : dry * Math.sqrt(g);
}

// Все машины на трассе в едином виде для логики соседей.
function carsView(bots, player) {
  const list = bots.map((b) => ({ ref: b, progress: b.progress, d: b.d, v: b.v, bot: true }));
  if (player) list.push({ ref: player, progress: player.progress, d: player.d, v: Math.max(0, player.u), bot: false });
  return list;
}

// Шины бота: износ по пройденному пути, сцепление по влажности.
function wearBot(b, ds, wetness) {
  const T = b.tire;
  const C = COMPOUNDS[T.compound];
  const L = b.track.length;
  const abuse = C.rain ? 1 + 1.6 * (1 - wetness) : 1 + 0.3 * wetness;
  T.wear = Math.min(1, T.wear + ((WEAR_PER_LAP[T.compound] * (b.style === 'aggressive' ? 1.25 : 1) * abuse) * ds) / L);
  T.grip = compoundGrip(T.compound, wetness) * wearGrip(T.compound, T.wear);
}

// Стратегия: решение о пит-стопе — один раз за круг, за 600 м до въезда в пит-лейн.
function decidePit(b, ctx) {
  const lane = b.track.pit;
  if (!lane || b.pit.phase !== 'track' || b.finishedCoast) return;
  const u = lane.rel(b.s);
  const lap = Math.floor(b.progress / b.track.length);
  if (u < b.track.length - 600 || b.pit.decided === lap) return;
  b.pit.decided = lap;
  const lapsLeft = (ctx.laps ?? 3) - lap - 1;
  if (lapsLeft < 1) return;
  const w = ctx.wetness ?? 0;
  const rainSoon = ctx.forecast?.type === 'rain' && ctx.forecast.in < (ctx.lapTime ?? 90) * 0.6;
  const wantWet = w > 0.36 || (rainSoon && w > 0.1);
  const onWet = COMPOUNDS[b.tire.compound].rain;
  let plan = null;
  if (wantWet && !onWet) plan = 'wet';
  else if (!wantWet && onWet && w < 0.22 && lapsLeft >= 1) plan = suggestCompound(w, lapsLeft);
  else if (b.tire.wear > 0.7 && lapsLeft >= 1) plan = onWet ? 'wet' : suggestCompound(w, lapsLeft);
  b.pit.plan = plan;
}

// Бот в пит-лейне: ведём по пути пит-лейна, лимит 60 км/ч, остановка в боксе, смена шин.
function stepBotPit(b, dt, ctx) {
  const lane = b.track.pit;
  const P = b.pit;
  const u = lane.rel(b.s);
  const acc = accelAt(b.spec, b.v), dec = brakeAt(b.spec, b.v) * 0.8;
  const bRel = lane.boxRel(P.box);
  let vT = profileSpeed(b, b.idx);
  if (lane.inLimitZone(b.s) || (u > lane.limA - 140 && u < lane.limA)) {
    // к линии въезда — уже на 60 км/ч
    const toLine = Math.max(0, lane.limA - u);
    vT = Math.min(vT, u >= lane.limA ? PIT_LIMIT : Math.sqrt(PIT_LIMIT * PIT_LIMIT + 2 * dec * 0.8 * toLine));
  }
  if (P.phase === 'lane') {
    const toBox = bRel - u;
    if (toBox > -0.5) vT = Math.min(vT, Math.sqrt(2 * 4 * Math.max(0, toBox - 0.3)));
    if (toBox < 0.6 && b.v < 0.8) {
      P.phase = 'service';
      P.t = 0;
      P.time = 2.6 + b.rng() * 0.9 + (COMPOUNDS[P.plan].rain !== COMPOUNDS[b.tire.compound].rain ? 0.4 : 0);
      b.v = 0;
      b.inBox = true;
    }
  }
  if (P.phase === 'service') {
    P.t += dt;
    b.v = 0;
    b.brake = 1;
    b.d = lane.side * lane.workD(b.s);
    b.pose(0);
    if (P.t >= P.time) {
      b.tire = { compound: P.plan, wear: 0, grip: compoundGrip(P.plan, ctx.wetness ?? 0) };
      P.phase = 'exit';
      b.inBox = false;
    }
    return;
  }
  let nv = b.v < vT ? Math.min(vT, b.v + acc * dt) : Math.max(vT, b.v - dec * dt);
  nv = Math.max(0, nv);
  const ax = (nv - b.v) / dt;
  b.brake = ax < -2 ? 1 : 0;
  // поперечное положение — прямо по пути (кинематика, без пружины): в стенку не врезаемся
  const target = P.phase === 'lane' || P.phase === 'exit' ? lane.boxPathD(b.s, P.box) : lane.pathD(b.s);
  b.dVel = ((target - b.d) * Math.min(1, dt * 6)) / dt; // moveBot сдвинет d на dVel·dt
  moveBot(b, nv, ax, dt);
  if (u > lane.len - 2 || !lane.inRange(b.s)) {
    // выехал на трассу
    if (P.phase === 'exit') b.pitStops.push({ lap: Math.floor(b.progress / b.track.length), compound: b.tire.compound, time: ctx.raceTime - P.tIn, loss: Math.max(0, ctx.raceTime - P.tIn - (ctx.pitRef ?? 20)) });
    P.phase = 'track';
    P.plan = null;
  }
}

// Шаг всех ботов. ctx: { player (машина игрока), raceTime, started, dt, wetness, laps, forecast, lapTime, pitRef }
export function updateBots(bots, ctx) {
  const { dt, player } = ctx;
  if (!bots.length) return;
  const tr = bots[0].track;
  const view = carsView(bots, player);
  const w = ctx.wetness ?? 0;
  for (const b of bots) {
    b.savePrev();
    const p0 = b.progress;
    if (b.finishedCoast) {
      // после финиша — спокойно катится
      moveBot(b, Math.max(0, b.v - 4 * dt), 0, dt);
      continue;
    }
    // пит-лейн: решение, въезд, остановка
    if (ctx.started && tr.pit) {
      decidePit(b, ctx);
      if (b.pit.phase === 'track' && b.pit.plan && tr.pit.rel(b.s) < 30 && tr.pit.inRange(b.s)) {
        b.pit.phase = 'lane';
        b.pit.tIn = ctx.raceTime;
        b.pass = 0;
        b.passT = 0;
        b.mistake = null;
      }
      if (b.pit.phase !== 'track') {
        stepBotPit(b, dt, ctx);
        wearBot(b, b.progress - p0, w);
        continue;
      }
    }
    if (!ctx.started) {
      b.pose(0);
      continue;
    }
    if (ctx.raceTime < b.react) {
      b.pose(0);
      continue;
    }
    const i = tr.index(b.s);
    const line = tr.racingLine;
    const hw = tr.hw[i];

    // --- целевая скорость: свой профиль торможения/разгона × резиновая связь ---
    let rubber = 1;
    if (player) {
      // ±5%: игрок далеко позади — лидеры сбавляют; игрок далеко впереди — поджимают
      const gap = b.progress - player.progress;
      rubber = 1 - 0.05 * smoothstep(150, 600, gap) + 0.05 * smoothstep(150, 600, -gap);
    }
    let vT = profileSpeed(b, tr.index(b.s + b.v * 0.1)) * rubber;
    // едет на пит-стоп: заранее тормозит к линии 60 км/ч и смещается к въезду
    let pitShift = 0;
    if (b.pit.plan && tr.pit) {
      const lane = tr.pit;
      const u = lane.rel(b.s);
      const toLine = (u > lane.len ? tr.length - u : -u) + lane.limA;
      vT = Math.min(vT, Math.sqrt(PIT_LIMIT * PIT_LIMIT + 2 * brakeAt(b.spec, b.v) * 0.6 * Math.max(0, toLine)));
      if (u > lane.len) pitShift = smoothstep(tr.length - 450, tr.length - 120, u);
    }

    // --- ошибки: поздний тормоз → вынос наружу ---
    const zoneAhead = nearestZone(b, tr);
    if (zoneAhead && zoneAhead.k !== b.lastBrakeZone && zoneAhead.dist < 30) {
      b.lastBrakeZone = zoneAhead.k;
      const chance = (b.style === 'aggressive' ? 0.07 : 0.03) * (1.6 - b.skill);
      if (b.rng() < chance) b.mistake = { t: 3, out: -zoneAhead.bp.corner.dir, late: 1.12 };
    }
    if (b.mistake) {
      b.mistake.t -= dt;
      if (b.mistake.t > 2) vT = Math.max(vT, b.v); // тормозит позже
      else vT *= 0.9;
      if (b.mistake.t <= 0) b.mistake = null;
    }

    // --- соседи: следование и обгон ---
    let ahead = null, aheadGap = Infinity;
    for (const o of view) {
      if (o.ref === b) continue;
      const gap = tr.deltaS(b.s, tr.wrapS(o.progress));
      if (gap > 0 && gap < 35 && Math.abs(o.d - b.d) < 2.4 && gap < aheadGap) {
        ahead = o;
        aheadGap = gap;
      }
    }
    const straight = Math.abs(line.kappa[i]) < 1 / 350 && Math.abs(line.kappa[tr.index(b.s + 80)]) < 1 / 350;
    const wide = hw >= 5.2;
    const wantPass = b.style === 'aggressive' ? 15 : 11;
    if (ahead && ahead.v < vT - 0.5) {
      if (straight && wide && aheadGap < wantPass && b.passT <= 0) {
        // обгон: в сторону, где больше места
        const roomL = hw - ahead.d, roomR = hw + ahead.d;
        const side = roomL > roomR ? 1 : -1;
        const target = clamp(ahead.d + side * 3.3, -(hw - 1.3), hw - 1.3);
        b.pass = target - line.offset[i];
        b.passT = 3.5;
      } else if (b.passT <= 0) {
        // едем следом, держим дистанцию
        const keep = b.style === 'aggressive' ? 6 : 9;
        vT = Math.min(vT, ahead.v + (aheadGap - keep) * 0.6);
      }
    }
    if (b.passT > 0) {
      b.passT -= dt;
      // обгон закончен или стало тесно — возвращаемся на траекторию
      if (b.passT <= 0 || !wide) b.passT = 0;
    }
    if (b.passT <= 0) b.pass *= Math.exp(-dt * 0.8);

    // --- продольная динамика: ограничения того же класса ---
    const acc = accelAt(b.spec, b.v) * Math.min(1, 0.85 + b.skill * 0.15);
    const dec = brakeAt(b.spec, b.v) * 0.95;
    let nv = b.v < vT ? Math.min(vT, b.v + acc * dt) : Math.max(vT, b.v - dec * dt);
    nv = Math.max(0, nv);
    const ax = (nv - b.v) / dt;
    b.brake = ax < -3 ? 1 : 0;

    // --- боковое движение: пружина к цели ---
    let target = line.offset[i] + b.pass;
    if (pitShift > 0) target += (tr.pit.side * (hw - 2.2) - target) * pitShift;
    if (b.mistake) target += b.mistake.out * (hw - Math.abs(line.offset[i])) * (b.mistake.t > 2 ? 0.2 : 1.0);
    target = clamp(target, -(hw + (b.mistake ? 1.2 : -0.9)), hw + (b.mistake ? 1.2 : -0.9));
    // не наезжать сбоку на машину рядом
    for (const o of view) {
      if (o.ref === b) continue;
      if (Math.abs(tr.deltaS(b.s, tr.wrapS(o.progress))) < 5.5 && Math.abs(o.d - target) < 2.4) {
        target = o.d + (b.d >= o.d ? 2.4 : -2.4);
      }
    }
    const kSpring = 2.2, damp = 2.6;
    b.dVel += (kSpring * (target - b.d) - damp * b.dVel) * dt;
    const maxLat = Math.min(5, 0.12 * nv + 0.5);
    b.dVel = clamp(b.dVel, -maxLat, maxLat);
    moveBot(b, nv, ax, dt);
    if (b.hitCd > 0) b.hitCd -= dt;
    wearBot(b, b.progress - p0, w);
  }
}

function moveBot(b, nv, ax, dt) {
  const tr = b.track;
  b.v = nv;
  b.d += b.dVel * dt;
  const i = tr.index(b.s);
  // по внутренней стороне поворота путь короче: прогресс вдоль центра быстрее
  const k = clamp(1 - tr.kappa[i] * b.d, 0.6, 1.4);
  const ds = (b.v * dt) / k;
  b.progress += ds;
  b.s = tr.wrapS(b.progress);
  b.spin += (b.v / b.spec.dims.wheelR) * dt;
  b.pose(ax);
}

function nearestZone(b, tr) {
  let best = null;
  const bps = b.bps || [];
  for (let k = 0; k < bps.length; k++) {
    const dist = tr.deltaS(b.s, bps[k].sBrake);
    if (dist > -5 && (!best || dist < best.dist)) best = { k, dist, bp: bps[k] };
  }
  return best;
}

// --- столкновения: OBB (SAT) в плоскости XZ ---
function obb(x, z, psi, hl, hw) {
  const fx = Math.sin(psi), fz = Math.cos(psi); // вперёд
  const lx = Math.cos(psi), lz = -Math.sin(psi); // влево
  return { x, z, fx, fz, lx, lz, hl, hw };
}

function overlap(A, B) {
  // оси: вперёд/влево каждой коробки
  const axes = [
    [A.fx, A.fz],
    [A.lx, A.lz],
    [B.fx, B.fz],
    [B.lx, B.lz],
  ];
  const dx = B.x - A.x, dz = B.z - A.z;
  let best = Infinity, bestAx = null;
  for (const [ax, az] of axes) {
    const ra = A.hl * Math.abs(A.fx * ax + A.fz * az) + A.hw * Math.abs(A.lx * ax + A.lz * az);
    const rb = B.hl * Math.abs(B.fx * ax + B.fz * az) + B.hw * Math.abs(B.lx * ax + B.lz * az);
    const dist = dx * ax + dz * az;
    const pen = ra + rb - Math.abs(dist);
    if (pen <= 0) return null;
    if (pen < best) {
      best = pen;
      bestAx = [ax * Math.sign(dist || 1), az * Math.sign(dist || 1)];
    }
  }
  return { pen: best, nx: bestAx[0], nz: bestAx[1] }; // нормаль от A к B
}

// Игрок против ботов: мягкое OBB-взаимодействие. Машины разводятся по нормали контакта,
// обмениваются импульсом по массам (упругость e = 0.3) — без потери скорости «в ноль»:
// догнал сзади — сам чуть замедлился, бот чуть ускорился; толкнул сбоку — оба смещаются.
// Возвращает события.
export function collidePlayer(player, bots, track) {
  const events = [];
  const D = player.spec.dims;
  for (const b of bots) {
    if (b.inBox) continue; // стоит в боксе за стенкой пит-лейна
    if (Math.abs(track.deltaS(player.s, b.s)) > 8) continue;
    const A = obb(player.x, player.z, player.psi, D.length / 2, D.width / 2);
    const bd = b.spec.dims;
    const B = obb(b.x, b.z, b.psi, bd.length / 2, bd.width / 2);
    const hit = overlap(A, B);
    if (!hit) continue;
    const res = pushApart(player, hit, b.spec.mass, { vx: b.v * Math.sin(b.psi) + b.dVel * track.nx[b.idx], vz: b.v * Math.cos(b.psi) + b.dVel * track.nz[b.idx] });
    // бот: смещение и импульс раскладываем вдоль трассы (прогресс, скорость) и поперёк (d, dVel)
    const lx = track.nx[b.idx], lz = track.nz[b.idx], fx = track.tx[b.idx], fz = track.tz[b.idx];
    b.d += (hit.nx * lx + hit.nz * lz) * res.otherShift;
    b.progress += (hit.nx * fx + hit.nz * fz) * res.otherShift;
    b.s = track.wrapS(b.progress);
    if (res.j > 0) {
      b.v = Math.max(0, b.v + res.otherDvx * Math.sin(b.psi) + res.otherDvz * Math.cos(b.psi));
      b.dVel = clamp(b.dVel + res.otherDvx * lx + res.otherDvz * lz, -5, 5);
      if (b.hitCd <= 0) {
        events.push({ type: 'contact', bot: b, speed: res.rel });
        b.hitCd = 0.5;
      }
    }
  }
  return events;
}

// Разведение машины игрока и другой машины (бот или соперник по сети) по нормали контакта
// hit = {nx, nz (от игрока к другой), pen} и обмен импульсом по массам.
// Игроку изменения применяются сразу, для другой машины возвращаются: смещение и Δv.
export function pushApart(car, hit, otherMass, other) {
  const mA = car.spec.mass, mB = otherMass;
  const wA = mB / (mA + mB), wB = mA / (mA + mB);
  car.x -= hit.nx * hit.pen * wA;
  car.z -= hit.nz * hit.pen * wA;
  const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
  let vx = car.u * sp + car.v * cp, vz = car.u * cp - car.v * sp;
  const rel = (vx - other.vx) * hit.nx + (vz - other.vz) * hit.nz; // > 0 — сближаемся
  const out = { j: 0, rel: Math.max(0, rel), otherShift: hit.pen * wB, otherDvx: 0, otherDvz: 0 };
  if (rel <= 0) return out;
  const e = 0.3;
  const J = ((1 + e) * rel) / (1 / mA + 1 / mB);
  vx -= (J / mA) * hit.nx;
  vz -= (J / mA) * hit.nz;
  // немного трения по касательной (5% относительной скорости) и лёгкий ограниченный разворот
  const tx = -hit.nz, tz = hit.nx;
  const relT = (vx - other.vx) * tx + (vz - other.vz) * tz;
  vx -= relT * 0.05 * tx;
  vz -= relT * 0.05 * tz;
  car.u = vx * sp + vz * cp;
  car.v = vx * cp - vz * sp;
  const lateral = cp * hit.nx - sp * hit.nz; // удар слева (+) или справа (−)
  const fwd = sp * hit.nx + cp * hit.nz; // удар спереди (+) или сзади (−)
  car.r = clamp(car.r - lateral * Math.sign(fwd || 1) * Math.min(0.35, rel * 0.03), -2.5, 2.5);
  car.shake = Math.max(car.shake, Math.min(0.8, 0.2 + rel * 0.04));
  out.j = J;
  out.otherDvx = (J / mB) * hit.nx;
  out.otherDvz = (J / mB) * hit.nz;
  return out;
}

export { obb, overlap };
