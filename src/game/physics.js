// Простая аркадная физика машины игрока.
// Вход — абстрактный объект управления {steer, gas, brake, nitro}: игре всё равно,
// откуда он пришёл (руки, клавиатура, тач).
import { SEGMENT_LENGTH, LAPS } from './track.js';

export const STEP = 1 / 60; // фиксированный шаг симуляции
export const MAX_SPEED = SEGMENT_LENGTH / STEP; // 12000 ед/с ≈ 240 км/ч на спидометре
export const KMH = 240 / MAX_SPEED;
export const NITRO_TIME = 2;
export const NITRO_COOLDOWN = 8;
const NITRO_MULT = 1.3;

const ACCEL = MAX_SPEED / 5;
const BRAKING = -MAX_SPEED;
const DECEL = -MAX_SPEED / 5; // накат
const OFFROAD_DECEL = -MAX_SPEED / 1.6;
const OFFROAD_LIMIT = MAX_SPEED / 4;
const CENTRIFUGAL = 0.3; // снос на поворотах, пропорционален скорости и кривизне
const STEER_RATE = 2.2;
const SOLID = new Set(['pine', 'tree', 'post', 'sign_left', 'sign_right']);

export function createPlayer() {
  return {
    x: 0, // смещение от центра дороги, -1..1 — край асфальта
    z: 0, // позиция на круге
    speed: 0,
    lap: 1,
    lapTime: 0,
    totalTime: 0,
    lapTimes: [],
    bestLap: null,
    distance: 0, // общая пройденная дистанция (для позиции в гонке)
    nitroT: 0, // сколько ещё действует нитро
    nitroCd: 0, // откат нитро
    shake: 0,
    offroad: false,
    finished: false,
    steer: 0,
    braking: false,
    gas: false,
  };
}

export function tryNitro(p) {
  if (p.nitroT > 0 || p.nitroCd > 0 || p.finished) return false;
  p.nitroT = NITRO_TIME;
  return true;
}

// Один шаг симуляции. Возвращает список событий ('lap', 'finish').
// running = false — таймеры гонки стоят (меню, обратный отсчёт).
export function stepPlayer(p, input, dt, track, running = true) {
  const events = [];
  const seg = track.findSegment(p.z);
  const speedPct = p.speed / MAX_SPEED;
  const nitro = p.nitroT > 0;
  const maxSpeed = nitro ? MAX_SPEED * NITRO_MULT : MAX_SPEED;

  // таймеры нитро
  if (p.nitroT > 0) {
    p.nitroT -= dt;
    if (p.nitroT <= 0) {
      p.nitroT = 0;
      p.nitroCd = NITRO_COOLDOWN;
    }
  } else if (p.nitroCd > 0) p.nitroCd = Math.max(0, p.nitroCd - dt);

  const control = p.finished ? { steer: 0, gas: false, brake: true } : input;
  p.steer = control.steer || 0;
  p.gas = !!control.gas;
  p.braking = !!control.brake && p.speed > 0;

  // поворот и центробежный снос
  const dx = dt * STEER_RATE * Math.min(1, speedPct);
  p.x += dx * p.steer;
  p.x -= dx * speedPct * seg.curve * CENTRIFUGAL;

  // газ / тормоз / накат
  if (nitro && !p.finished && !control.brake) p.speed += ACCEL * 2.5 * dt;
  else if (control.gas) p.speed += ACCEL * (1 - 0.4 * speedPct) * dt;
  else if (control.brake) p.speed += BRAKING * dt;
  else p.speed += DECEL * dt;

  // съезд с дороги замедляет
  p.offroad = Math.abs(p.x) > 1;
  if (p.offroad && p.speed > OFFROAD_LIMIT) p.speed += OFFROAD_DECEL * dt;
  if (p.speed > maxSpeed) p.speed = Math.max(maxSpeed, p.speed + DECEL * 2 * dt);
  p.speed = Math.max(0, p.speed);
  p.x = Math.max(-2.2, Math.min(2.2, p.x));

  // удар о дерево, столб или знак на обочине
  if (p.offroad && p.speed > OFFROAD_LIMIT * 0.5) {
    for (const sp of seg.sprites) {
      if (!SOLID.has(sp.type) || Math.abs(p.x - sp.offset) > 0.3) continue;
      p.speed = Math.min(p.speed, MAX_SPEED * 0.15);
      p.x -= Math.sign(p.x) * 0.15;
      p.shake = 0.5;
      events.push('crash');
      break;
    }
  }

  // движение и круги
  if (running && !p.finished) {
    p.totalTime += dt;
    p.lapTime += dt;
  }
  const move = p.speed * dt;
  p.z += move;
  p.distance += move;
  if (p.z >= track.length) {
    p.z -= track.length;
    if (!p.finished) {
      p.lapTimes.push(p.lapTime);
      if (p.bestLap === null || p.lapTime < p.bestLap) p.bestLap = p.lapTime;
      p.lapTime = 0;
      if (p.lap >= LAPS) {
        p.finished = true;
        events.push('finish');
      } else {
        p.lap++;
        events.push('lap');
      }
    }
  }

  if (p.shake > 0) p.shake = Math.max(0, p.shake - dt);
  return events;
}
