// Физика машины: упрощённая «велосипедная» модель с ограничением по сцеплению.
//  - боковые силы шин насыщаются: |Fy| ≤ μ·нагрузка (нагрузка = вес + прижимная сила ~ v²);
//    при превышении машина скользит — недоворот (перед) или снос (зад);
//  - продольные силы: тяга (ограничена мощностью и сцеплением задней оси — перегазовка
//    «съедает» боковое сцепление), сопротивление воздуха ~ v², качению, торможение с ABS;
//  - покрытия: асфальт, поребрик (95% и вибрация), трава/гравий (сильно хуже и замедляет), стена;
//  - руль зависит от скорости: угол колёс ограничен пределом сцепления (speed-sensitive steering),
//    иначе руками на скорости не проехать. Помощь рулём — мягкое удержание и антиснос.
// Шаг фиксированный — 120 Гц (STEP), отдельно от рендера.
//
// Оси кузова: u — скорость вперёд, v — вбок (влево +), r — рыскание (влево +).
// Курс ψ: вперёд = (sin ψ, cos ψ) в плоскости XZ, левая сторона = (cos ψ, −sin ψ).
import { clamp, smoothstep, wrapAngle } from '../util/rng.js';

export const STEP = 1 / 120;
export const KMH = 3.6;
const G = 9.81;

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
    delta: 0, // угол передних колёс
    steerIn: 0, // сглаженный ввод руля
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
    fyR: 0,
    fyF: 0,
    // трасса
    idx: 0,
    s: 0,
    d: 0,
    progress: 0,
    surfaces: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
    wheelsOut: 0,
    onKerb: false,
    wallContact: 0,
    // визуальное
    roll: 0,
    pitch: 0,
    spin: 0,
    bounce: 0,
    shake: 0,
    // состояние шин
    under: 0, // 0..1 насколько «уплыл» перед
    over: 0, // 0..1 насколько «уплыл» зад
    wheelspin: false,
    abs: false,
    // ускорение/ERS
    boostEnergy: 1,
    boostOn: false,
    // для интерполяции рендера
    prev: { x: 0, y: 0, z: 0, psi: 0 },
    stuckT: 0,
    wrongWayT: 0,
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
  car.delta = car.steerIn = car.throttle = car.brake = 0;
  car.reverse = false;
  car.gear = 0;
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

// Один шаг физики. input: {steer ∈ [−1,1] (вправо +), gas, brake (bool или 0..1)}.
// opts: { assist: 0..1, frozen: bool } → массив событий [{type, ...}].
export function stepCar(car, input, dt, track, opts = {}) {
  const C = car.spec;
  const events = [];
  savePrev(car);
  const assist = opts.assist ?? 0.6;
  const m = C.mass;
  const L = C.wheelbase;
  const a = L * (1 - C.weightFront); // от ЦТ до передней оси
  const b = L * C.weightFront; // до задней
  const Iz = m * a * b * C.yawInertia;

  // --- ввод: газ нарастает за 0.2 с, тормоз за 0.1 с ---
  const gasT = opts.frozen ? 0 : +input.gas || 0;
  const brT = opts.frozen ? 0 : +input.brake || 0;
  car.throttle += clamp(gasT - car.throttle, -dt / 0.1, dt / 0.2);
  car.brake += clamp(brT - car.brake, -dt / 0.08, dt / 0.1);
  const steerTarget = clamp(input.steer || 0, -1, 1);
  car.steerIn += clamp(steerTarget - car.steerIn, -C.steerRate * dt, C.steerRate * dt);

  // задний ход: стоим и держим тормоз > 0.6 с
  if (car.brake > 0.5 && car.throttle < 0.1 && Math.abs(car.u) < 0.4) car.reverseT += dt;
  else if (car.throttle > 0.3) {
    car.reverseT = 0;
    car.reverse = false;
  }
  if (car.reverseT > 0.6) car.reverse = true;

  const u = car.u;
  const speed = Math.abs(u);
  const down = C.downforce * u * u;
  const Fz = m * G + down;

  // --- покрытия под колёсами (FL, FR, RL, RR) ---
  const sinP = Math.sin(car.psi), cosP = Math.cos(car.psi);
  const nx = track.nx[car.idx], nz = track.nz[car.idx];
  const hwTrack = C.dims.track / 2;
  let gripF = 0, gripR = 0, offCount = 0, kerbCount = 0;
  for (let w = 0; w < 4; w++) {
    const lx = w < 2 ? a : -b;
    const ly = w % 2 === 0 ? hwTrack : -hwTrack;
    const ox = lx * sinP + ly * cosP, oz = lx * cosP - ly * sinP;
    const dw = car.d + ox * nx + oz * nz;
    const sf = track.surfaceAt(car.idx, dw);
    car.surfaces[w] = sf;
    const k = sf === 'asphalt' ? 1 : sf === 'kerb' ? C.kerbGrip : C.offGrip;
    if (sf === 'kerb') kerbCount++;
    else if (sf !== 'asphalt') offCount++;
    if (w < 2) gripF += k / 2;
    else gripR += k / 2;
  }
  car.wheelsOut = offCount;
  car.onKerb = kerbCount > 0;
  // --- нагрузка по осям с переносом веса при разгоне/торможении ---
  car.axF += (car.ax - car.axF) * Math.min(1, dt * 12);
  const dF = (m * car.axF * C.cgHeight) / L;
  const FzfN = Fz * C.weightFront, FzrN = Fz * (1 - C.weightFront);
  const Fzf = Math.max(0.2 * Fz, FzfN - dF);
  const Fzr = Math.max(0.2 * Fz, FzrN + dF);
  // чувствительность шины к нагрузке: перегруженная ось держит хуже на единицу веса
  const lsF = clamp(1 - 0.22 * (Fzf / FzfN - 1), 0.8, 1.15);
  const lsR = clamp(1 - 0.22 * (Fzr / FzrN - 1), 0.8, 1.15);
  const muF = C.grip * gripF * lsF, muR = C.grip * (C.rearGrip ?? 1) * gripR * lsR;
  const cs = C.corneringStiffness;

  // --- руль: предел угла по сцеплению (зависит от скорости) + помощь ---
  // угол = кинематика предельного радиуса (L·κ) + угол увода шины у предела сцепления
  const aLat = (Math.min(muF, muR) * Fz) / m;
  const over = C.steerOver + (1 - assist) * 0.5;
  const alphaKnee = (1.15 * muF) / cs;
  const deltaGrip = Math.atan((L * over * aLat) / Math.max(speed * speed, 1)) + alphaKnee * over;
  const deltaMax = Math.min(C.steerLock, deltaGrip);
  let target = -car.steerIn * deltaMax;
  if (assist > 0 && speed > 3 && !car.reverse) {
    const ti = car.idx;
    const headErr = wrapAngle(track.heading[ti] - car.psi);
    // мягкое удержание курса, пока руль почти прямо
    if (Math.abs(steerTarget) < 0.15 && Math.abs(headErr) < 0.4) {
      target += clamp(assist * 0.5 * headErr, -0.25 * deltaMax, 0.25 * deltaMax);
    }
    // не выпускать с асфальта: мягкий доворот к центру у края
    const hw = track.hw[ti];
    const edge = smoothstep(hw - 1.6, hw + 1.2, Math.abs(car.d));
    if (edge > 0) {
      const outward = Math.sign(car.d) * Math.sin(car.psi - track.heading[ti]);
      target += -Math.sign(car.d) * assist * edge * 0.3 * deltaMax * (outward > -0.02 ? 1 : 0.3);
    }
    // антиснос: подруливание против заноса
    const beta = Math.atan2(car.v, Math.max(speed, 1));
    if (Math.abs(beta) > 0.04) target += assist * 0.6 * (beta - Math.sign(beta) * 0.04);
  }
  target = clamp(target, -C.steerLock, C.steerLock);
  car.delta += (target - car.delta) * Math.min(1, dt * 18);
  const delta = car.delta;

  // --- передачи и обороты ---
  const gears = C.gears;
  if (car.shiftT > 0) car.shiftT -= dt;
  const top = gears[car.gear];
  if (speed > top * (C.rpm.shift / C.rpm.max) && car.gear < gears.length - 1 && car.shiftT <= 0) {
    car.gear++;
    car.shiftT = C.shiftTime;
    events.push({ type: 'shift', up: true });
  } else if (car.gear > 0 && speed < gears[car.gear - 1] * 0.72) {
    car.gear--;
    events.push({ type: 'shift', up: false });
  }
  const rpmTarget = Math.max(C.rpm.idle, (C.rpm.max * speed) / gears[car.gear]) + (speed < 2 ? car.throttle * 3500 : 0);
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
    car.boostEnergy = Math.min(1, car.boostEnergy + dt * B.recharge + (B.harvest ? dt * B.harvest * car.brake * Math.min(1, speed / 30) : 0));
  }

  // --- продольные силы ---
  const power = C.power * (car.boostOn ? B.power : 1);
  let fxDrive = 0;
  let wheelspin = false;
  const rearCap = muR * Fzr;
  if (car.reverse) {
    fxDrive = -car.brake * 4000;
  } else if (car.throttle > 0.01) {
    let demand = car.throttle * Math.min(C.maxForce * (car.boostOn ? B.power : 1), power / Math.max(speed, 3));
    if (car.shiftT > 0) demand *= 0.3;
    // контроль тяги (при помощи) оставляет запас на боковую силу
    if (assist > 0.2) demand = Math.min(demand, 0.9 * Math.sqrt(Math.max(0, rearCap * rearCap - car.fyR * car.fyR)) + 200);
    if (demand > rearCap * C.traction) {
      wheelspin = true;
      fxDrive = rearCap * 0.75;
    } else fxDrive = demand;
  }
  car.wheelspin = wheelspin;

  // тормоза с ABS: не больше, чем осталось сцепления после боковой силы
  let fbF = 0, fbR = 0;
  car.abs = false;
  if (!car.reverse && car.brake > 0.01 && speed > 0.3) {
    // EBD: тормозное усилие делится по фактической нагрузке осей, зад — с запасом,
    // чтобы при торможении в повороте задняя ось не теряла боковое сцепление
    const want = car.brake * C.brake * (muF * Fzf + muR * Fzr);
    const wantF = (want * Fzf) / (Fzf + Fzr);
    const wantR = ((want * Fzr) / (Fzf + Fzr)) * 0.85;
    const capF = 0.95 * Math.sqrt(Math.max(0, (muF * Fzf) ** 2 - car.fyF * car.fyF));
    const capR = 0.8 * Math.sqrt(Math.max(0, (muR * Fzr) ** 2 - car.fyR * car.fyR));
    fbF = Math.min(wantF, capF);
    fbR = Math.min(wantR, capR);
    car.abs = wantF > capF * 1.02 || wantR > capR * 1.02;
  }
  const dir = Math.sign(u) || 1;
  const fDrag = C.drag * u * Math.abs(u);
  const fRoll = C.rolling * m * G * Math.sign(u);
  const fOff = (offCount / 4) * C.offDrag * m * G * Math.sign(u) * Math.min(1, speed / 3);

  // --- боковые силы шин ---
  const uu = Math.max(speed, 0.5);
  const alphaF = Math.atan2(car.v + a * car.r, uu) - delta * dir;
  const alphaR = Math.atan2(car.v - b * car.r, uu);
  const capF = Math.sqrt(Math.max(0, (muF * Fzf) ** 2 - fbF * fbF));
  let capR = Math.sqrt(Math.max(0, (muR * Fzr) ** 2 - (fxDrive - fbR) ** 2));
  if (wheelspin) capR *= 0.8; // буксующая шина держит вбок хуже
  const fyF = capF > 1 ? -capF * Math.tanh((cs * Fzf * alphaF) / capF) : 0;
  const fyR = capR > 1 ? -capR * Math.tanh((cs * (C.rearStiffness ?? 1) * Fzr * alphaR) / capR) : 0;
  car.fyF = fyF;
  car.fyR = fyR;
  const peakF = muF / cs, peakR = muR / (cs * (C.rearStiffness ?? 1));
  car.under = clamp((Math.abs(alphaF) - peakF * 1.1) / (peakF * 1.5), 0, 1);
  car.over = clamp((Math.abs(alphaR) - peakR * 1.1) / (peakR * 1.5), 0, 1);

  // наклон трассы помогает в повороте: проекция веса на поперечную ось
  const bank = track.bank[car.idx];
  const tLeftX = nx, tLeftZ = nz;
  const leftX = cosP, leftZ = -sinP;
  const bankLat = m * G * Math.sin(bank) * (leftX * tLeftX + leftZ * tLeftZ);
  // уклон вдоль трассы: подъём тормозит, спуск разгоняет
  const grade = track.grade[car.idx] * Math.cos(wrapAngle(car.psi - track.heading[car.idx]));
  const fGrade = -m * G * grade;

  // --- динамика ---
  const cosD = Math.cos(delta), sinD = Math.sin(delta);
  const fxF = -fbF * dir;
  const fxR = fxDrive - fbR * dir;
  const sumX = fxR + fxF * cosD - fyF * sinD - fDrag - fRoll - fOff + fGrade;
  const sumY = fyR + fyF * cosD + fxF * sinD + bankLat;
  let mz = a * (fyF * cosD + fxF * sinD) - b * fyR;

  // ESP (при помощи): если машину закручивает сильнее, чем просит руль, —
  // подтормаживание отдельных колёс даёт момент против вращения (и немного гасит скорость)
  let espBrake = 0;
  car.esp = false;
  if (assist > 0 && speed > 5 && !car.reverse) {
    const rRef = clamp((u * Math.tan(delta)) / L, -aLat / speed, aLat / speed);
    const err = car.r - rRef;
    if (Math.abs(car.r) > Math.abs(rRef) + 0.03 && Math.sign(err) === Math.sign(car.r)) {
      const lim = 0.35 * m * G * C.dims.track;
      const mzEsp = clamp(-assist * 3 * Iz * err, -lim, lim);
      mz += mzEsp;
      espBrake = Math.abs(mzEsp) / C.dims.track;
      car.esp = true;
    }
  }

  let du = (sumX - espBrake * dir * 0.5) / m + car.v * car.r;
  const dv = sumY / m - u * car.r;
  const dr = mz / Iz;
  let nu = u + du * dt;
  // тормоза не разгоняют назад: остановка в ноль
  if (!car.reverse && u >= 0 && nu < 0) nu = 0;
  if (car.reverse && nu < -6) nu = -6;
  if (car.reverse && nu > 0 && car.throttle < 0.1) nu = Math.min(nu, 0);
  let nv = car.v + dv * dt;
  let nr = car.r + dr * dt;
  // на малой скорости — кинематическая модель (без неустойчивости шин)
  const k = smoothstep(1.5, 5, Math.abs(nu));
  const rKin = (nu * Math.tan(delta)) / L;
  nr = rKin + (nr - rKin) * k;
  nv = rKin * b + (nv - rKin * b) * k;
  car.ax = (nu - u) / dt;
  car.ay = dv + u * car.r;
  car.u = nu;
  car.v = nv;
  car.r = nr;

  // --- движение ---
  const vx = nu * sinP + nv * cosP;
  const vz = nu * cosP - nv * sinP;
  car.x += vx * dt;
  car.z += vz * dt;
  car.psi = wrapAngle(car.psi + nr * dt);

  // --- положение на трассе ---
  const q = track.project(car.x, car.z, car.idx, tmpProj);
  const ds = track.deltaS(car.s, q.s);
  car.progress += ds;
  car.idx = q.i;
  car.s = q.s;
  car.d = q.d;

  // --- стены ---
  car.wallContact = Math.max(0, car.wallContact - dt);
  collideWalls(car, track, events);

  car.y = track.heightAt(car.idx, q.f, clamp(car.d, -track.hw[car.idx], track.hw[car.idx]));

  // --- визуальное: крен, тангаж, вращение колёс, вибрация на поребрике ---
  car.roll += (clamp(car.ay * 0.004, -0.06, 0.06) - car.roll) * Math.min(1, dt * 8);
  car.pitch += (clamp(-car.ax * 0.0035, -0.04, 0.04) - car.pitch) * Math.min(1, dt * 8);
  car.spin += (nu / C.dims.wheelR) * dt;
  const rumble = (car.onKerb ? 0.012 : 0) + (offCount ? 0.02 : 0);
  car.bounce = rumble * Math.sin(car.progress * 6) * Math.min(1, speed / 10);
  if (car.shake > 0) car.shake = Math.max(0, car.shake - dt * 1.8);

  // --- застрял / едет не туда ---
  const facing = Math.cos(wrapAngle(car.psi - track.heading[car.idx]));
  car.wrongWayT = facing < -0.3 && Math.abs(nu) > 2 ? car.wrongWayT + dt : Math.max(0, car.wrongWayT - dt * 2);
  const stuck = speed < 1.5 && (offCount >= 2 || car.wallContact > 0 || facing < 0);
  car.stuckT = stuck && !opts.frozen ? car.stuckT + dt : 0;

  return events;
}

// Столкновение с ограждением: выталкиваем, гасим нормальную скорость (отскок),
// теряем скорость вдоль стены, разворачиваем от стены.
function collideWalls(car, track, events) {
  const C = car.spec;
  const i = car.idx;
  const nx = track.nx[i], nz = track.nz[i];
  const sinP = Math.sin(car.psi), cosP = Math.cos(car.psi);
  const hl = C.dims.length / 2, hw = C.dims.width / 2;
  let maxD = -Infinity, minD = Infinity;
  for (const [lx, ly] of [
    [hl, hw],
    [hl, -hw],
    [-hl, hw],
    [-hl, -hw],
  ]) {
    const ox = lx * sinP + ly * cosP, oz = lx * cosP - ly * sinP;
    const dd = car.d + ox * nx + oz * nz;
    if (dd > maxD) maxD = dd;
    if (dd < minD) minD = dd;
  }
  let side = 0, pen = 0;
  if (maxD > track.wallL[i]) {
    side = 1;
    pen = maxD - track.wallL[i];
  } else if (minD < -track.wallR[i]) {
    side = -1;
    pen = -track.wallR[i] - minD;
  }
  if (!side) return;
  // нормаль стены смотрит внутрь трассы: для левой стены — −N
  const wx = -side * nx, wz = -side * nz;
  car.x += wx * pen;
  car.z += wz * pen;
  car.d -= side * pen;
  let vx = car.u * sinP + car.v * cosP;
  let vz = car.u * cosP - car.v * sinP;
  const vn = -(vx * wx + vz * wz); // скорость «в стену»
  const speed = Math.hypot(vx, vz);
  if (vn > 0) {
    const e = 0.25;
    vx += wx * vn * (1 + e);
    vz += wz * vn * (1 + e);
    const loss = clamp(0.06 + vn * 0.045, 0, 0.6);
    vx *= 1 - loss;
    vz *= 1 - loss;
    car.r = car.r * 0.5 - side * Math.min(1.2, vn * 0.06);
    if (vn > 1.5 && car.wallContact <= 0.3) {
      events.push({ type: 'wall', speed: vn, side, total: speed });
      car.shake = Math.min(1, 0.25 + vn * 0.06);
    }
  } else {
    // скольжение вдоль стены — трение
    vx *= 0.995;
    vz *= 0.995;
  }
  car.u = vx * sinP + vz * cosP;
  car.v = vx * cosP - vz * sinP;
  car.wallContact = 0.5;
  if (speed > 6) events.push({ type: 'scrape', side, speed });
}

// Вернуть машину на трассу (застряла, развернулась): по центру, по ходу движения.
export function respawn(car, track) {
  const progress = car.progress;
  const i = car.idx;
  placeCar(car, track, car.s, clamp(car.d * 0.3, -track.hw[i] * 0.4, track.hw[i] * 0.4));
  car.progress = progress; // круг не теряется и не засчитывается заново
  car.stuckT = car.wrongWayT = 0;
}
