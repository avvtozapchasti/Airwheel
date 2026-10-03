// Физика машины: модель «по колёсам» с фиксированным шагом 120 Гц (STEP), отдельно от рендера.
//
//  - Нагрузка на каждое колесо: вес + прижимная сила (по аэробалансу) + перенос веса при
//    разгоне/торможении и в повороте. Сцепление каждого колеса — своё: покрытие под ним
//    (асфальт, поребрик, трава, гравий, песок, пит-лейн — surfaces.js), шины (tires.js),
//    влажность, штраф после удара о стену и чувствительность шины к нагрузке.
//  - Боковая сила — плавная кривая увода (упрощённая Magic Formula): растёт до пика при
//    угле увода ~6–8°, после пика мягко падает до 80–87% от пика, а не до нуля. Поэтому
//    при ошибке машина «плывёт», а не срывается в мгновенный занос.
//  - Круг трения: продольная сила (тяга, тормоз) забирает часть бокового сцепления.
//  - Контроль тяги (всегда): тяга не больше, чем колёса передают с проскальзыванием ≈0.15.
//    ABS (всегда): тормоз не больше остатка сцепления — колёса не блокируются, руль работает.
//  - Руль: фильтр дрожания рук + ограничение скорости поворота колёс; предельный угол колёс
//    уменьшается со скоростью (30° на месте → 3–5° на максималке).
//  - Помощь рулём (assist 0..1): удержание курса, не выпускать с асфальта, автоматическое
//    контр-руление и стабилизация (ESP) против избыточной поворачиваемости.
//  - На малой скорости — кинематическая модель и вязкое демпфирование бокового скольжения,
//    чтобы машина не «плыла» и не дрожала.
//  - Стены: импульс по нормали с отскоком e≈0.25, касательная скорость теряет 2–25% в
//    зависимости от угла удара; скользящий удар почти бесплатный, лобовой гасит большую
//    часть скорости, но не всю. Небольшой ограниченный разворот, выталкивание из стены.
//
// Оси кузова: u — скорость вперёд, v — вбок (влево +), r — рыскание (влево +).
// Курс ψ: вперёд = (sin ψ, cos ψ) в плоскости XZ, левая сторона = (cos ψ, −sin ψ).
// Колёса: 0 — переднее левое, 1 — переднее правое, 2 — заднее левое, 3 — заднее правое.
import { clamp, smoothstep, wrapAngle } from '../util/rng.js';
import { surfaceOf, surfaceGrip, surfaceRoll } from './surfaces.js';

export const STEP = 1 / 120;
export const KMH = 3.6;
const G = 9.81;

// --- кривая шины ---
// f(α) = sin(C·atan(B·α)): пик 1.0 при α = peak, при больших углах — sin(C·π/2) от пика.
function makeCurve(peak, C) {
  return { B: Math.tan(Math.PI / (2 * C)) / peak, C, peak, tail: Math.sin((C * Math.PI) / 2) };
}
const curveCache = new WeakMap();
export function tyreCurves(spec) {
  let c = curveCache.get(spec);
  if (!c) {
    const t = spec.tyre;
    c = { F: makeCurve(t.peakF, t.shapeF), R: makeCurve(t.peakR, t.shapeR) };
    curveCache.set(spec, c);
  }
  return c;
}
export const slipForce = (k, alpha) => Math.sin(k.C * Math.atan(k.B * alpha));

// Предельный угол передних колёс на скорости v (м/с): на месте — steerLock (~30°), дальше —
// кинематика радиуса, который держат шины (L·a/v²) с запасом steerOver, плюс небольшой
// угол увода steerMargin. На максимальной скорости получается 3–5°.
export function maxSteer(spec, v, mu = spec.grip, assist = 0.65) {
  const aLat = (mu * (spec.mass * G + spec.downforce * v * v)) / spec.mass;
  const over = spec.steerOver + (1 - assist) * 0.25;
  const kin = Math.atan((spec.wheelbase * over * aLat) / Math.max(v * v, 1));
  return Math.min(spec.steerLock, kin + spec.steerMargin);
}

// Насколько угол увода задних колёс превысил пик кривой (рад, 0 — зад держит).
function rearSlipExcess(car, C) {
  const aR = (Math.abs(car.wheels[2].slip) + Math.abs(car.wheels[3].slip)) / 2;
  return Math.max(0, aR - C.tyre.peakR * 1.05);
}

function makeWheels() {
  const out = [];
  for (let w = 0; w < 4; w++) out.push({ surface: 'asphalt', S: surfaceOf('asphalt'), mu: 1, load: 0, slip: 0, ratio: 0, fx: 0, fy: 0, grip: 1 });
  return out;
}

export function createCar(spec, track, { s = 0, d = 0 } = {}) {
  const car = {
    spec,
    x: 0,
    y: 0,
    z: 0,
    psi: 0,
    u: 0,
    v: 0,
    r: 0,
    delta: 0, // угол передних колёс, рад (влево +)
    steerF: 0, // отфильтрованный ввод руля
    steerIn: 0, // ввод руля после ограничения скорости поворота
    throttle: 0,
    brake: 0,
    reverse: false,
    reverseT: 0,
    gear: 0,
    rpm: spec.rpm.idle,
    shiftT: 0,
    ax: 0,
    axF: 0,
    ay: 0,
    ayF: 0,
    // трасса
    idx: 0,
    s: 0,
    d: 0,
    progress: 0,
    surfaces: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    wheels: makeWheels(),
    wheelsOut: 0,
    onKerb: false,
    surfaceMain: 'asphalt',
    rumble: 0,
    wallContact: 0,
    wallCd: 0,
    wallNx: 0,
    wallNz: 0,
    gripPenaltyT: 0,
    // шины (tires.js выставляет множитель сцепления по составу, износу и температуре)
    tireGrip: 1,
    tire: null,
    // визуальное
    roll: 0,
    pitch: 0,
    spin: 0,
    bounce: 0,
    shake: 0,
    // состояние шин и помощников
    under: 0, // 0..1 насколько «уплыл» перед
    over: 0, // 0..1 насколько «уплыл» зад
    beta: 0, // угол скольжения кузова, рад
    wheelspin: false,
    tc: false,
    abs: false,
    esp: false,
    // ускорение/ERS
    boostEnergy: 1,
    boostOn: false,
    // для интерполяции рендера
    prev: { x: 0, y: 0, z: 0, psi: 0 },
    stuckT: 0,
    wrongWayT: 0,
    time: 0,
  };
  placeCar(car, track, s, d);
  return car;
}

// Поставить машину на трассу (решётка, возврат на трассу).
export function placeCar(car, track, s, d = 0) {
  const p = track.pointAt(s, d);
  car.x = p.x;
  car.z = p.z;
  car.y = p.y;
  car.psi = track.headingAt(s);
  car.u = car.v = car.r = 0;
  car.delta = car.steerIn = car.steerF = car.throttle = car.brake = 0;
  car.ax = car.axF = car.ay = car.ayF = 0;
  car.reverse = false;
  car.reverseT = 0;
  car.gear = 0;
  car.shake = 0;
  car.gripPenaltyT = 0;
  const q = track.project(car.x, car.z, -1);
  car.idx = q.i;
  car.s = q.s;
  car.d = q.d;
  car.progress = s;
  savePrev(car);
}

export function savePrev(car) {
  car.prev.x = car.x;
  car.prev.y = car.y;
  car.prev.z = car.z;
  car.prev.psi = car.psi;
}

// Скорость машины по модулю (м/с).
export const speedOf = (car) => Math.hypot(car.u, car.v);

// Попытка включить ускорение (Boost / ERS). Возвращает true, если включилось.
export function tryBoost(car) {
  if (car.boostOn || car.boostEnergy < 0.25) return false;
  car.boostOn = true;
  return true;
}

const tmpProj = {};
const FZ = new Float64Array(4);
const MU = new Float64Array(4);
const CAP = new Float64Array(4);
const LX = new Float64Array(4);
const LY = new Float64Array(4);
const FX = new Float64Array(4);

// Один шаг физики. input: {steer ∈ [−1,1] (вправо +), gas, brake (bool или 0..1)}.
// opts: { assist: 0..1, wetness: 0..1, frozen, noReverse, limiter (м/с) } → массив событий.
export function stepCar(car, input, dt, track, opts = {}) {
  const C = car.spec;
  const events = [];
  savePrev(car);
  car.time += dt;
  const assist = opts.assist ?? 0.65;
  const wet = opts.wetness ?? 0;
  const frozen = !!opts.frozen;
  const m = C.mass;
  const L = C.wheelbase;
  const a = L * (1 - C.weightFront); // от ЦТ до передней оси
  const b = L * C.weightFront; // до задней
  const tw = C.dims.track / 2;
  const Iz = m * a * b * C.yawInertia;
  const K = tyreCurves(C);
  LX[0] = LX[1] = a;
  LX[2] = LX[3] = -b;
  LY[0] = LY[2] = tw;
  LY[1] = LY[3] = -tw;

  // --- ввод: газ нарастает за 0.25 с, тормоз за 0.1 с; руль — фильтр + скорость поворота ---
  const gasT = frozen ? 0 : clamp(+input.gas || 0, 0, 1);
  const brT = frozen ? 0 : clamp(+input.brake || 0, 0, 1);
  car.throttle += clamp(gasT - car.throttle, -dt / 0.08, dt / 0.25);
  car.brake += clamp(brT - car.brake, -dt / 0.08, dt / 0.1);
  let raw = frozen ? 0 : clamp(input.steer || 0, -1, 1);
  raw = Math.sign(raw) * Math.pow(Math.abs(raw), C.steerExpo); // мягче около центра
  car.steerF += (raw - car.steerF) * (1 - Math.exp(-dt / C.steerFilter));
  car.steerIn += clamp(car.steerF - car.steerIn, -C.steerRate * dt, C.steerRate * dt);

  // задний ход: стоим и держим тормоз > 0.6 с
  if (car.brake > 0.5 && car.throttle < 0.1 && Math.abs(car.u) < 0.4) car.reverseT += dt;
  else if (car.throttle > 0.3) {
    car.reverseT = 0;
    car.reverse = false;
  }
  if (car.reverseT > 0.6 && !opts.noReverse && !frozen) car.reverse = true;

  const speed0 = Math.abs(car.u);

  // --- покрытия под колёсами ---
  const sinP = Math.sin(car.psi), cosP = Math.cos(car.psi);
  const ci = car.idx;
  const nx = track.nx[ci], nz = track.nz[ci], tx = track.tx[ci], tz = track.tz[ci];
  let offCount = 0, kerbCount = 0, rumble = 0, rollSum = 0;
  for (let w = 0; w < 4; w++) {
    const ox = LX[w] * sinP + LY[w] * cosP, oz = LX[w] * cosP - LY[w] * sinP;
    const dw = car.d + ox * nx + oz * nz;
    const iw = track.wrap(ci + Math.round((ox * tx + oz * tz) / track.ds));
    const id = track.surfaceAt(iw, dw);
    const S = surfaceOf(id);
    const wh = car.wheels[w];
    wh.surface = id;
    wh.S = S;
    car.surfaces[w] = id;
    if (id === 'kerb') kerbCount++;
    else if (S.off) offCount++;
    rumble = Math.max(rumble, S.vib);
    rollSum += surfaceRoll(S, speed0);
  }
  car.wheelsOut = offCount;
  car.onKerb = kerbCount > 0;
  car.rumble = rumble;
  car.surfaceMain = car.wheels[2].surface === car.wheels[3].surface ? car.wheels[2].surface : car.wheels[0].surface;

  // --- передачи и обороты ---
  const gears = C.gears;
  if (car.shiftT > 0) car.shiftT -= dt;
  if (speed0 > gears[car.gear] * (C.rpm.shift / C.rpm.max) && car.gear < gears.length - 1 && car.shiftT <= 0) {
    car.gear++;
    car.shiftT = C.shiftTime;
    events.push({ type: 'shift', up: true });
  } else if (car.gear > 0 && speed0 < gears[car.gear - 1] * 0.72) {
    car.gear--;
    events.push({ type: 'shift', up: false });
  }
  const rpmTarget = Math.max(C.rpm.idle, (C.rpm.max * speed0) / gears[car.gear]) + (speed0 < 2 ? car.throttle * 3500 : 0);
  car.rpm += (Math.min(C.rpm.max, rpmTarget) - car.rpm) * Math.min(1, dt * 20);

  // --- ускорение (Boost / ERS) ---
  const B = C.boost;
  if (car.boostOn) {
    car.boostEnergy -= dt / B.time;
    if (car.boostEnergy <= 0 || car.brake > 0.5) {
      car.boostEnergy = Math.max(0, car.boostEnergy);
      car.boostOn = false;
    }
  } else {
    car.boostEnergy = Math.min(1, car.boostEnergy + dt * B.recharge + (B.harvest ? dt * B.harvest * car.brake * Math.min(1, speed0 / 30) : 0));
  }

  // --- запрос тяги двигателя ---
  const power = C.power * (car.boostOn ? B.power : 1);
  let demand = 0;
  if (car.reverse) demand = -car.brake * 4000;
  else if (car.throttle > 0.01) {
    demand = car.throttle * Math.min(C.maxForce * (car.boostOn ? B.power : 1), power / Math.max(speed0, 3));
    if (car.shiftT > 0) demand *= 0.3;
    // ограничитель скорости (пит-лейн): плавно снимает тягу у предела
    if (opts.limiter) demand *= clamp((opts.limiter + 0.4 - car.u) / 0.8, 0, 1);
  }

  // --- общий множитель сцепления: шины, влажность, штраф после удара ---
  if (car.gripPenaltyT > 0) car.gripPenaltyT = Math.max(0, car.gripPenaltyT - dt);
  const gripMul = (car.tireGrip ?? 1) * (car.gripPenaltyT > 0 ? 0.82 : 1);
  for (let w = 0; w < 4; w++) {
    const S = car.wheels[w].S;
    // мокрый асфальт учитывают шины (tireGrip), остальные покрытия — свой множитель
    car.wheels[w].grip = S.id === 'asphalt' || S.id === 'pit' ? S.grip : surfaceGrip(S, wet);
  }

  // --- руль: предельный угол по сцеплению и скорости + помощь ---
  const muRoad = C.grip * gripMul * (car.wheels[0].grip + car.wheels[1].grip) * 0.5;
  const deltaMax = maxSteer(C, speed0, muRoad, assist);
  let target = -car.steerIn * deltaMax;
  const beta = Math.atan2(car.v, Math.max(Math.abs(car.u), 1));
  car.beta = beta;
  if (assist > 0 && speed0 > 3 && !car.reverse && !frozen) {
    const headErr = wrapAngle(track.heading[ci] - car.psi);
    // мягкое удержание курса вдоль трассы, пока руль почти прямо: ПД-регулятор по курсу
    // (с демпфированием по скорости рыскания, чтобы машину не раскачивало)
    const hold = 1 - smoothstep(0.04, 0.1, Math.abs(car.steerF));
    if (hold > 0 && Math.abs(headErr) < 0.4) {
      const rTrack = car.u * track.kappa[ci];
      const pd = 0.25 * headErr + 0.45 * ((rTrack - car.r) * L) / Math.max(car.u, 5);
      target += hold * clamp(assist * pd, -0.15 * deltaMax, 0.15 * deltaMax);
    }
    // не выпускать с асфальта: мягкий доворот к центру у края
    const hw = track.hw[ci];
    const edge = smoothstep(hw - 1.6, hw + 1.2, Math.abs(car.d));
    if (edge > 0 && !opts.pitLane) {
      const outward = Math.sign(car.d) * Math.sin(car.psi - track.heading[ci]);
      target += -Math.sign(car.d) * assist * edge * 0.3 * deltaMax * (outward > -0.02 ? 1 : 0.3);
    }
    // автоматическое контр-руление, когда зад уже скользит (угол увода задних за пиком шины)
    const excess = rearSlipExcess(car, C);
    if (excess > 0) target += assist * 0.8 * Math.sign(beta) * excess;
  }
  // дрожь руля на поребрике и траве
  if (rumble > 0 && speed0 > 5) target += rumble * 0.006 * Math.sin(car.progress * 4.1) * Math.min(1, speed0 / 25);
  target = clamp(target, -C.steerLock, C.steerLock);
  car.delta += (target - car.delta) * Math.min(1, dt * 16);

  // --- динамика (на малой скорости — два подшага) ---
  const nSub = speed0 < 8 ? 2 : 1;
  const h = dt / nSub;
  let sumAx = 0;
  car.tc = false;
  car.abs = false;
  car.esp = false;
  let tcCut = 0;
  for (let sub = 0; sub < nSub; sub++) {
    const u = car.u, v = car.v, r = car.r;
    const speed = Math.abs(u);
    const dir = Math.sign(u) || 1;
    const down = C.downforce * u * u;
    const delta = car.delta;

    // нагрузки по колёсам
    const dLong = (m * car.axF * C.cgHeight * C.pitchTransfer) / L; // + на зад
    const latT = (m * car.ayF * C.cgHeight * C.rollTransfer) / C.dims.track; // ay > 0 (поворот налево) — грузит правые
    const sF = (m * G * C.weightFront + down * C.aeroFront) / 2;
    const sR = (m * G * (1 - C.weightFront) + down * (1 - C.aeroFront)) / 2;
    FZ[0] = sF - dLong / 2 - latT * C.rollFront;
    FZ[1] = sF - dLong / 2 + latT * C.rollFront;
    FZ[2] = sR + dLong / 2 - latT * (1 - C.rollFront);
    FZ[3] = sR + dLong / 2 + latT * (1 - C.rollFront);
    for (let w = 0; w < 4; w++) FZ[w] = Math.max(FZ[w], 0.06 * (w < 2 ? sF : sR));
    const avgF = (FZ[0] + FZ[1]) / 2, avgR = (FZ[2] + FZ[3]) / 2;
    for (let w = 0; w < 4; w++) {
      const avg = w < 2 ? avgF : avgR;
      // чувствительность к нагрузке: перегруженное колесо держит хуже на единицу веса
      const ls = clamp(1 - C.loadSens * (FZ[w] / avg - 1), 0.72, 1.15);
      MU[w] = C.grip * C.gripPhys * (w >= 2 ? C.rearGrip : 1) * car.wheels[w].grip * gripMul * ls;
      CAP[w] = MU[w] * FZ[w];
    }

    // тяга: задний привод. Контроль тяги держит проскальзывание ≈ 0.15 и оставляет запас
    // на боковую силу; если зад уже скользит — плавно снимает тягу (как ESP)
    const fx = FX;
    fx[0] = fx[1] = fx[2] = fx[3] = 0;
    if (demand !== 0) {
      const avail2 = Math.sqrt(Math.max(0, CAP[2] * CAP[2] - (1.15 * car.wheels[2].fy) ** 2));
      const avail3 = Math.sqrt(Math.max(0, CAP[3] * CAP[3] - (1.15 * car.wheels[3].fy) ** 2));
      const slide = rearSlipExcess(car, C) / (C.tyre.peakR * 0.5);
      const cut = car.reverse ? 1 : clamp(1 - slide * (C.tcSlide + assist * 0.6), 0.15, 1);
      const lim = (avail2 + avail3) * 0.94 * cut;
      let d = demand;
      if (Math.abs(d) > lim) {
        tcCut = Math.max(tcCut, Math.abs(d) / Math.max(lim, 1) - 1);
        d = Math.sign(d) * lim;
        car.tc = true;
      }
      // самоблок: что не передало одно колесо, передаёт другое
      let f2 = clamp(d / 2, -avail2, avail2);
      let f3 = clamp(d - f2, -avail3, avail3);
      f2 = clamp(d - f3, -avail2, avail2);
      fx[2] = f2;
      fx[3] = f3;
    }
    // тормоза с ABS: не больше остатка сцепления после боковой силы (с запасом — руль работает);
    // задние в повороте подтормаживают слабее, чтобы зад не сорвался при торможении в дуге
    if (!car.reverse && car.brake > 0.01 && speed > 0.2) {
      for (let w = 0; w < 4; w++) {
        const fyPrev = car.wheels[w].fy;
        const lat = Math.min(1, Math.abs(fyPrev) / Math.max(CAP[w], 1));
        const want = car.brake * C.brake * CAP[w] * (w < 2 ? 1 : C.brakeRear * (1 - 0.6 * lat * lat));
        const avail = 0.93 * Math.sqrt(Math.max(0, CAP[w] * CAP[w] - (1.08 * fyPrev) ** 2));
        const fb = Math.min(want, avail);
        if (want > avail * 1.02 && speed > 3) car.abs = true;
        fx[w] -= fb * dir;
      }
    }

    // боковые силы и суммирование в осях кузова
    const cd = Math.cos(delta), sd = Math.sin(delta);
    let Fx = 0, Fy = 0, Mz = 0;
    let aF = 0, aR = 0;
    for (let w = 0; w < 4; w++) {
      const front = w < 2;
      const vx = u - r * LY[w], vy = v + r * LX[w];
      let vl = vx, vt = vy;
      if (front) {
        vl = vx * cd + vy * sd;
        vt = -vx * sd + vy * cd;
      }
      const alpha = Math.atan2(vt, Math.max(Math.abs(vl), 1));
      const dLat = Math.sqrt(Math.max(0, CAP[w] * CAP[w] - fx[w] * fx[w]));
      const fy = -dLat * slipForce(front ? K.F : K.R, alpha);
      const wh = car.wheels[w];
      wh.fx = fx[w];
      wh.fy = fy;
      wh.slip = alpha;
      wh.load = FZ[w];
      wh.mu = MU[w];
      wh.ratio = clamp((0.15 * Math.abs(fx[w])) / Math.max(CAP[w] * 0.96, 1), 0, 0.15) * Math.sign(fx[w]);
      if (front) aF += Math.abs(alpha) / 2;
      else aR += Math.abs(alpha) / 2;
      let fbx = fx[w], fby = fy;
      if (front) {
        fbx = fx[w] * cd - fy * sd;
        fby = fx[w] * sd + fy * cd;
      }
      Fx += fbx;
      Fy += fby;
      Mz += LX[w] * fby - LY[w] * fbx;
    }
    car.under = clamp((aF - K.F.peak * 1.05) / (K.F.peak * 1.5), 0, 1);
    car.over = clamp((aR - K.R.peak * 1.05) / (K.R.peak * 1.5), 0, 1);

    // сопротивление: воздух, качение по покрытиям, уклон и наклон трассы
    const fDrag = C.drag * u * Math.abs(u);
    const fRoll = ((m * rollSum) / 4) * dir * Math.min(1, speed / 0.5);
    const grade = track.grade[ci] * Math.cos(wrapAngle(car.psi - track.heading[ci]));
    const bank = track.bank[ci];
    const bankLat = m * G * Math.sin(bank) * (Math.cos(car.psi) * nx - Math.sin(car.psi) * nz);
    Fx += -fDrag - fRoll - m * G * grade;
    Fy += bankLat;

    // ESP (при помощи): машину закручивает сильнее, чем просит руль, — момент против
    // вращения (подтормаживание отдельных колёс, немного гасит скорость)
    let espBrake = 0;
    if (assist > 0 && speed > 4 && !car.reverse) {
      const muAvg = (MU[0] + MU[1] + MU[2] + MU[3]) / 4;
      const aLat = (muAvg * (m * G + down)) / m;
      const rRef = clamp((u * Math.tan(delta)) / L, -aLat / speed, aLat / speed);
      const err = r - rRef;
      // избыточное вращение: в сторону вращения быстрее, чем просит руль (в т. ч. при контр-руле)
      if (err * Math.sign(r) > 0.04) {
        const lim = 0.6 * m * G * C.dims.track;
        const mzEsp = clamp(-assist * C.esp * Iz * (err - Math.sign(err) * 0.04), -lim, lim);
        Mz += mzEsp;
        espBrake = (Math.abs(mzEsp) / C.dims.track) * 0.5;
        car.esp = true;
      }
      // зад скользит (угол увода задних за пиком): плавно возвращаем нос по ходу движения
      const excess = rearSlipExcess(car, C);
      if (excess > 0) Mz += assist * 3.0 * Iz * Math.sign(beta) * Math.min(excess, 0.35) * Math.min(1, speed / 15);
    }

    // --- интегрирование ---
    const du = (Fx - espBrake * dir) / m + v * r;
    const dv = Fy / m - u * r;
    const dr = Mz / Iz;
    let nu = u + du * h;
    // тормоза не разгоняют назад: остановка в ноль
    if (!car.reverse && u >= 0 && nu < 0) nu = 0;
    if (car.reverse && nu < -6) nu = -6;
    if (car.reverse && nu > 0 && car.throttle < 0.1) nu = Math.min(nu, 0);
    let nv = v + dv * h;
    let nr = r + dr * h;
    // на малой скорости — кинематическая модель (без неустойчивости шин). Переход — по полной
    // скорости: машину, скользящую боком после удара, нельзя «остановить» обнулением v.
    const spd = Math.hypot(nu, nv);
    const kk = smoothstep(1.5, 5, spd);
    const rKin = (nu * Math.tan(delta)) / L;
    nr = rKin + (nr - rKin) * kk;
    nv = rKin * b + (nv - rKin * b) * kk;
    // вязкое демпфирование бокового скольжения на малой скорости — машина не «плывёт»
    const damp = C.latDamp * (1 - smoothstep(3, 14, spd));
    if (damp > 0) nv *= Math.exp(-damp * h);
    // защита от раскрутки: рыскание ограничено
    nr = clamp(nr, -3, 3);
    sumAx += (nu - u) / h;
    car.ay = dv + u * r;
    car.u = nu;
    car.v = nv;
    car.r = nr;
    // движение
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    car.x += (nu * sp + nv * cp) * h;
    car.z += (nu * cp - nv * sp) * h;
    car.psi = wrapAngle(car.psi + nr * h);
    car.axF += (car.ax - car.axF) * Math.min(1, h * 10);
    car.ayF += (car.ay - car.ayF) * Math.min(1, h * 10);
  }
  car.ax = sumAx / nSub;
  car.wheelspin = tcCut > 0.25 && car.throttle > 0.5;

  // --- положение на трассе ---
  const q = track.project(car.x, car.z, car.idx, tmpProj);
  const ds = track.deltaS(car.s, q.s);
  car.progress += ds;
  car.idx = q.i;
  car.s = q.s;
  car.d = q.d;

  // --- стены ---
  car.wallContact = Math.max(0, car.wallContact - dt);
  car.wallCd = Math.max(0, car.wallCd - dt);
  collideWalls(car, track, events, dt);

  // упёрся носом в стену и жмёт газ — доворачиваем вдоль трассы (машина «сползает» по стене),
  // чтобы не залипать: без этого из лобового упора выбраться можно было бы только задним ходом
  if (car.wallContact > 0 && !car.reverse && car.throttle > 0.3 && speedOf(car) < 4) {
    const fwdN = Math.sin(car.psi) * car.wallNx + Math.cos(car.psi) * car.wallNz;
    if (fwdN < -0.1) {
      const err = wrapAngle(track.heading[car.idx] - car.psi);
      car.psi = wrapAngle(car.psi + clamp(err * 3, -2.5, 2.5) * dt);
    }
  }

  car.y = track.heightAt(car.idx, q.f, clamp(car.d, -track.hw[car.idx] - 1, track.hw[car.idx] + 1));

  // --- визуальное: крен, тангаж, вращение колёс, вибрация на поребрике и траве ---
  const speed = Math.abs(car.u);
  car.roll += (clamp(car.ay * 0.004, -0.06, 0.06) - car.roll) * Math.min(1, dt * 8);
  car.pitch += (clamp(-car.ax * 0.0035, -0.04, 0.04) - car.pitch) * Math.min(1, dt * 8);
  car.spin += (car.u / C.dims.wheelR) * dt;
  car.bounce = (rumble * 0.018) * Math.sin(car.progress * 6) * Math.min(1, speed / 10);
  if (car.shake > 0) car.shake = Math.max(0, car.shake - dt * 1.8);

  // --- застрял / едет не туда ---
  const facing = Math.cos(wrapAngle(car.psi - track.heading[car.idx]));
  car.wrongWayT = facing < -0.3 && Math.abs(car.u) > 2 ? car.wrongWayT + dt : Math.max(0, car.wrongWayT - dt * 2);
  const stuck = speedOf(car) < 5 / KMH && (offCount >= 2 || car.wallContact > 0 || facing < 0);
  car.stuckT = stuck && !frozen && !opts.pitLane ? car.stuckT + dt : 0;

  return events;
}

// --- стены ---
// Точки кузова, которые проверяются на касание: углы и середины бортов.
const PROBES = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [0.4, 1],
  [0.4, -1],
  [-0.45, 1],
  [-0.45, -1],
];
const tmpQ = {};

// Ограничители по бокам в точке трассы: {L, R} — стены (d > 0 слева), pw — стенка пит-лейна.
function wallAt(track, q, out) {
  const i = q.i, j = (i + 1) % track.n, f = q.f;
  out.L = track.wallL[i] + (track.wallL[j] - track.wallL[i]) * f;
  out.R = track.wallR[i] + (track.wallR[j] - track.wallR[i]) * f;
  return out;
}
const wtmp = {};

// Удар о стену: выталкиваем по нормали, нормальная скорость гасится с отскоком e,
// касательная теряет 2–25% (по углу удара), лёгкий ограниченный разворот.
function collideWalls(car, track, events, dt) {
  const C = car.spec;
  const hl = C.dims.length / 2, hw = C.dims.width / 2;
  // далеко от стен — не проверяем
  const ci = car.idx;
  const reach = Math.hypot(hl, hw) + 0.5;
  const pit = track.pit;
  const nearPitWall = pit && track.nearPitWall(car.s, reach + 2);
  if (!nearPitWall && car.d + reach < track.wallL[ci] - 1.5 && -car.d + reach < track.wallR[ci] - 1.5) return;

  const sinP = Math.sin(car.psi), cosP = Math.cos(car.psi);
  let best = null;
  for (const [fx, fy] of PROBES) {
    const lx = fx * hl, ly = fy * hw;
    const ox = lx * sinP + ly * cosP, oz = lx * cosP - ly * sinP;
    const q = track.project(car.x + ox, car.z + oz, ci, tmpQ);
    const w = wallAt(track, q, wtmp);
    let pen = 0, nSign = 0;
    if (q.d > w.L) {
      pen = q.d - w.L;
      nSign = -1; // левая стена: нормаль внутрь трассы = −N
    } else if (q.d < -w.R) {
      pen = -w.R - q.d;
      nSign = 1;
    }
    // стенка пит-лейна — двусторонняя: выталкиваем на ту сторону, где центр машины
    if (nearPitWall) {
      const pw = track.pitWallAt(q.s);
      if (pw) {
        const dd = q.d * pit.side; // положительное — в сторону пит-лейна
        const carSide = car.d * pit.side > pw.d ? 1 : -1;
        const half = 0.3;
        let p2 = 0;
        if (carSide < 0 && dd > pw.d - half) p2 = dd - (pw.d - half);
        if (carSide > 0 && dd < pw.d + half) p2 = pw.d + half - dd;
        if (p2 > pen) {
          pen = p2;
          nSign = carSide > 0 ? pit.side : -pit.side;
        }
      }
    }
    if (pen > 0 && (!best || pen > best.pen)) best = { pen, nSign, i: q.i, f: q.f, ox, oz };
  }
  if (!best) return;
  const i = best.i, j = (i + 1) % track.n;
  let wx = (track.nx[i] + (track.nx[j] - track.nx[i]) * best.f) * best.nSign;
  let wz = (track.nz[i] + (track.nz[j] - track.nz[i]) * best.f) * best.nSign;
  const wl = Math.hypot(wx, wz) || 1;
  wx /= wl;
  wz /= wl;
  // выталкиваем из стены
  const push = Math.min(best.pen, 1.5) + 0.003;
  car.x += wx * push;
  car.z += wz * push;
  car.wallContact = 0.3;

  let vx = car.u * sinP + car.v * cosP;
  let vz = car.u * cosP - car.v * sinP;
  const vN = vx * wx + vz * wz; // < 0 — в стену
  const vn = -vN;
  const speed = Math.hypot(vx, vz);
  // сторона стены относительно машины: 1 — слева, −1 — справа (для искр и звука)
  const side = wx * cosP - wz * sinP > 0 ? -1 : 1;
  if (vn > 0) {
    const tvx = vx - vN * wx, tvz = vz - vN * wz;
    const vt = Math.hypot(tvx, tvz);
    const theta = Math.atan2(vn, vt); // 0 — вдоль стены, π/2 — лоб в лоб
    const e = vn > 2.5 ? C.wallBounce : 0;
    const impact = car.wallCd <= 0;
    // касательная: при ударе теряется 2–25% (по углу), при скольжении — трение ∝ прижатию
    const frac = impact ? 0.02 + 0.23 * smoothstep(0.14, 1.22, theta) : 0;
    const dvt = Math.min(vt, Math.max(vt * frac, Math.min(vt * 0.5, 0.25 * (1 + e) * vn * (impact ? 0 : 1))));
    const kt = vt > 1e-3 ? (vt - dvt) / vt : 0;
    vx = tvx * kt + wx * vn * e;
    vz = tvz * kt + wz * vn * e;
    // разворот от удара: момент от точки касания, ограничен
    const torque = best.oz * wx - best.ox * wz;
    car.r = car.r * (1 - 0.5 * smoothstep(1, 8, vn)) + clamp(0.03 * vn * torque, -0.7, 0.7);
    car.r = clamp(car.r, -2.5, 2.5);
    if (impact && vn > 1.2) {
      car.wallCd = 0.15;
      const strength = clamp(vn / 40, 0, 1);
      car.shake = Math.max(car.shake, Math.min(1, 0.12 + vn * 0.045));
      // короткий штраф: 0.5 с пониженного сцепления
      if (vn > 3) car.gripPenaltyT = 0.5 * smoothstep(3, 10, vn);
      events.push({ type: 'wall', speed: vn, side, total: speed, strength });
    }
    car.u = vx * sinP + vz * cosP;
    car.v = vx * cosP - vz * sinP;
    if (vt > 6) events.push({ type: 'scrape', side, speed: vt });
  } else if (speed > 6) {
    events.push({ type: 'scrape', side, speed });
  }
  car.wallNx = wx;
  car.wallNz = wz;
  const q = track.project(car.x, car.z, car.idx, tmpProj);
  car.progress += track.deltaS(car.s, q.s);
  car.idx = q.i;
  car.s = q.s;
  car.d = q.d;
}

// Вернуть машину на трассу (застряла, развернулась): по центру, по ходу движения.
export function respawn(car, track) {
  const progress = car.progress;
  const i = car.idx;
  placeCar(car, track, car.s, clamp(car.d * 0.3, -track.hw[i] * 0.4, track.hw[i] * 0.4));
  car.progress = progress; // круг не теряется и не засчитывается заново
  car.stuckT = car.wrongWayT = 0;
}
