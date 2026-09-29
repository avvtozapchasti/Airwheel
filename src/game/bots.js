// Соперники. Простая, но живая логика:
//  - у каждого своя максимальная скорость (85–100% от игрока) и своя полоса;
//  - едут по центру полосы с небольшим случайным отклонением;
//  - притормаживают перед крутыми поворотами;
//  - если впереди медленная машина — перестраиваются или сбрасывают скорость;
//  - резиновая связь: подстраивают темп под игрока в пределах ±10%.
import { LANE_X, LAPS, ROAD_WIDTH } from './track.js';
import { MAX_SPEED } from './physics.js';
import { CAR_WIDTH } from './renderer.js';

const BOT_DEFS = [
  { name: 'Вихрь', color: '#2f7cf6', pct: 1.0, lane: 1 },
  { name: 'Гром', color: '#ffb000', pct: 0.95, lane: 2 },
  { name: 'Искра', color: '#9b4dff', pct: 0.9, lane: 0 },
  { name: 'Тень', color: '#18b89b', pct: 0.86, lane: 3 },
];

const ACCEL = MAX_SPEED / 5.5;
const CAR_X = CAR_WIDTH / ROAD_WIDTH; // ширина машины в долях полуширины дороги
const CAR_LEN = 300; // длина машины в мировых единицах
const LOOK = 1600; // насколько далеко бот смотрит вперёд

export function createBots() {
  // Стартовая решётка: боты по двое впереди, игрок стартует последним.
  const grid = [
    { z: 1400, x: -0.45 },
    { z: 1400, x: 0.45 },
    { z: 700, x: -0.45 },
    { z: 700, x: 0.45 },
  ];
  return BOT_DEFS.map((d, i) => ({
    ...d,
    x: grid[i].x,
    z: grid[i].z,
    distance: grid[i].z,
    speed: 0,
    // небольшой случайный разброс, чтобы заезды отличались
    maxSpeed: MAX_SPEED * d.pct * (0.98 + Math.random() * 0.04),
    phase: Math.random() * Math.PI * 2,
    wobble: 0.03 + Math.random() * 0.04,
    laneTimer: 1 + Math.random(),
    lap: 1,
    finished: false,
    finishTime: null,
    braking: false,
    hitCd: 0,
  }));
}

// Расстояние по трассе от a до b (b впереди — положительное), с учётом замкнутости круга.
function dz(track, fromZ, toZ) {
  let d = track.wrapZ(toZ) - track.wrapZ(fromZ);
  if (d > track.length / 2) d -= track.length;
  if (d < -track.length / 2) d += track.length;
  return d;
}

function laneBlocked(track, self, laneX, others) {
  for (const o of others) {
    if (o === self) continue;
    const d = dz(track, self.z, o.z);
    if (d > -CAR_LEN * 1.5 && d < LOOK * 0.8 && Math.abs(o.x - laneX) < CAR_X * 1.3) return true;
  }
  return false;
}

export function updateBots(bots, player, track, dt, raceTime) {
  const all = [...bots, player];
  for (const b of bots) {
    // 1) целевая скорость: притормозить перед крутым поворотом
    const curve = track.curveAhead(b.z, 30);
    const curveK = curve >= 4 ? 0.8 : curve >= 3 ? 0.87 : curve >= 2 ? 0.94 : 1;

    // 2) резиновая связь (±10%): игрок далеко впереди — боты чуть быстрее, отстал — медленнее
    const gap = player.distance - b.distance;
    const rubber = 1 + 0.1 * Math.max(-1, Math.min(1, gap / (track.length * 0.2)));

    let target = b.finished ? b.maxSpeed * 0.6 : b.maxSpeed * curveK * rubber;

    // 3) машина впереди в той же полосе
    let ahead = null, aheadD = Infinity;
    for (const o of all) {
      if (o === b) continue;
      const d = dz(track, b.z, o.z);
      if (d > 0 && d < LOOK && Math.abs(o.x - b.x) < CAR_X * 1.2 && d < aheadD) {
        ahead = o;
        aheadD = d;
      }
    }
    b.laneTimer -= dt;
    if (ahead && ahead.speed < target) {
      // пробуем перестроиться в соседнюю свободную полосу
      let moved = false;
      if (b.laneTimer <= 0) {
        const options = [b.lane - 1, b.lane + 1].filter((l) => l >= 0 && l < LANE_X.length);
        if (Math.random() < 0.5) options.reverse();
        for (const l of options) {
          if (!laneBlocked(track, b, LANE_X[l], all)) {
            b.lane = l;
            b.laneTimer = 2.5;
            moved = true;
            break;
          }
        }
      }
      if (!moved && aheadD < CAR_LEN * 3) target = Math.min(target, ahead.speed * 0.97);
    }

    // 4) разгон / торможение
    b.braking = b.speed > target + 300;
    if (b.speed < target) b.speed = Math.min(target, b.speed + ACCEL * dt);
    else b.speed = Math.max(target, b.speed - MAX_SPEED * 0.7 * dt);

    // 5) руление к центру своей полосы с лёгким «вилянием»
    b.phase += dt * 0.8;
    const targetX = LANE_X[b.lane] + Math.sin(b.phase) * b.wobble;
    const dx = targetX - b.x;
    b.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.9 * dt);

    // 6) движение и круги
    const move = b.speed * dt;
    b.z += move;
    b.distance += move;
    if (b.z >= track.length) b.z -= track.length;
    b.lap = Math.min(LAPS, 1 + Math.floor(b.distance / track.length));
    if (!b.finished && b.distance >= track.length * LAPS) {
      b.finished = true;
      b.finishTime = raceTime;
    }
    if (b.hitCd > 0) b.hitCd -= dt;
  }
}

// Столкновения игрока с ботами. Возвращает true, если был удар.
export function checkCollisions(player, bots, track) {
  let hit = false;
  for (const b of bots) {
    if (b.hitCd > 0) continue;
    const d = dz(track, player.z, b.z);
    if (Math.abs(d) > CAR_LEN || Math.abs(b.x - player.x) > CAR_X * 0.9) continue;
    if (d >= 0) {
      // въехали в бота сзади — теряем скорость
      player.speed = Math.min(player.speed, b.speed) * 0.7;
    } else {
      // бот въехал в нас — он теряет скорость, нас немного толкает
      b.speed = Math.min(b.speed, player.speed) * 0.8;
      player.speed *= 0.9;
    }
    player.x += Math.sign(player.x - b.x || 1) * 0.08;
    b.x -= Math.sign(player.x - b.x || 1) * 0.05;
    player.shake = 0.45;
    b.hitCd = 0.6;
    hit = true;
  }
  return hit;
}

// Позиция игрока в гонке (1 — первый).
export function racePosition(player, bots) {
  let pos = 1;
  for (const b of bots) {
    if (player.finished) {
      if (b.finished && b.finishTime !== null && b.finishTime < player.totalTime) pos++;
    } else if (b.distance > player.distance) pos++;
  }
  return pos;
}
