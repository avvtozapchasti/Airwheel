// Классы машин — только данные. Физика (physics.js) и боты (bots.js) читают отсюда всё,
// поэтому разница между классами — в числах, а не в коде.
//
// Единицы: кг, Вт, м, м/с, Н. Сопротивление воздуха F = drag·v², прижимная сила F = downforce·v².
// grip — коэффициент сцепления шин μ; boundary: боковая сила ≤ μ·(m·g + downforce·v²).

const KMH = 1 / 3.6;

export const CARS = {
  gt3: {
    id: 'gt3',
    name: 'GT3',
    title: 'GT3 — купе',
    description: 'Тяжелее и мягче: прощает ошибки, но сносит при перегазовке на выходе.',
    mass: 1300,
    power: 404e3, // ≈ 550 л.с.
    vmax: 280 * KMH, // справочно; фактически — из мощности и сопротивления
    drag: 0.83,
    rolling: 0.015,
    downforce: 1.0, // умеренная: +50% веса на 280 км/ч
    grip: 1.32,
    brake: 0.92, // доля сцепления, доступная на торможение
    brakeBias: 0.6,
    wheelbase: 2.65,
    weightFront: 0.46,
    cgHeight: 0.46,
    yawInertia: 1.35, // Iz = m · a · b · yawInertia
    corneringStiffness: 16, // на единицу нагрузки, 1/рад
    rearGrip: 1.1, // задняя ось держит лучше — лёгкая недостаточная поворачиваемость, стабильность
    rearStiffness: 1.25,
    steerLock: 0.5, // рад на малой скорости
    steerRate: 3.0, // насколько быстро руль доходит до цели, 1/с
    steerOver: 1.1, // запас руля сверх предела сцепления (с помощью)
    offGrip: 0.42, // трава/гравий
    offDrag: 0.26, // замедление на траве, доли g
    kerbGrip: 0.95,
    maxForce: 12500, // тяга на низких передачах ограничена моментом двигателя, Н
    traction: 1.0,
    gears: [20.5, 31, 42, 53, 64, 80], // верх каждой передачи, м/с
    rpm: { idle: 1300, max: 8800, shift: 8500 },
    shiftTime: 0.08,
    boost: { name: 'Boost', time: 3.0, power: 1.22, recharge: 1 / 12, harvest: 0 },
    dims: { length: 4.6, width: 2.0, height: 1.25, track: 1.66, wheelR: 0.345, wheelW: 0.31, eye: 1.08, hood: 1.05 },
    sound: { cylinders: 6, base: 0.5, character: 'growl' },
  },
};

CARS.f1 = {
  id: 'f1',
  name: 'F1',
  title: 'F1 — формула',
  description: 'Лёгкая и злая: огромная прижимная сила, тормозит позже, но не прощает ошибок руля и травы.',
  mass: 800,
  power: 750e3, // ≈ 1000 л.с. с гибридом
  vmax: 340 * KMH,
  drag: 0.878,
  rolling: 0.015,
  downforce: 2.6, // ~3 веса машины на 340 км/ч: в быстрых поворотах намного быстрее GT3
  grip: 1.55,
  brake: 0.95,
  brakeBias: 0.58,
  wheelbase: 3.6,
  weightFront: 0.45,
  cgHeight: 0.3,
  yawInertia: 1.2,
  corneringStiffness: 20, // жёсткие слики — острая реакция
  rearGrip: 1.05, // запас зада меньше, чем у GT3 — строже к ошибкам
  rearStiffness: 1.12,
  steerLock: 0.4,
  steerRate: 4.6,
  steerOver: 1.03,
  offGrip: 0.3, // на траве днище и слики почти не держат
  offDrag: 0.42,
  kerbGrip: 0.9,
  maxForce: 11500,
  traction: 1.0,
  gears: [23, 33, 43, 53, 63, 74, 85, 98],
  rpm: { idle: 4000, max: 12500, shift: 12000 },
  shiftTime: 0.03,
  boost: { name: 'ERS', time: 4.0, power: 1.21, recharge: 1 / 45, harvest: 0.22 }, // заряд — при торможении
  dims: { length: 5.6, width: 2.0, height: 0.95, track: 1.62, wheelR: 0.36, wheelW: 0.38, eye: 1.3, hood: -0.35, cgZ: -0.3 },
  sound: { cylinders: 6, base: 1, character: 'whine' },
};

export const CLASS_IDS = Object.keys(CARS);
