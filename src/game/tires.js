// Шины — данные и упрощённая модель: состав, износ, температура.
// Итоговый множитель сцепления car.tireGrip = состав(влажность) × износ × температура,
// физика (physics.js) умножает на него μ каждого колеса на асфальте.
//
//  dry / wet  — сцепление на сухой и на полностью мокрой трассе (между ними — линейно по влажности).
//               Сухая шина в дождь — ~0.65 и скользит; мокрая на сухом — ~0.85, быстро греется и
//               изнашивается. Точка, где мокрые выгоднее, — влажность ≈ 0.35.
//  life       — сколько секунд «быстрой» езды до полного износа;
//  wearLoss   — сколько сцепления теряет полностью изношенная шина (10–25%);
//  tOpt       — оптимальная температура, °C (±10° — без потерь, дальше до −12%).

export const COMPOUNDS = {
  soft: { id: 'soft', name: 'Soft', title: 'Сухие · Soft', short: 'S', color: '#ff3b4d', dry: 1.035, wet: 0.62, life: 260, wearLoss: 0.24, tOpt: 95, rain: false },
  medium: { id: 'medium', name: 'Medium', title: 'Сухие · Medium', short: 'M', color: '#ffd23f', dry: 1.0, wet: 0.65, life: 470, wearLoss: 0.16, tOpt: 100, rain: false },
  wet: { id: 'wet', name: 'Мокрые', title: 'Мокрые', short: 'W', color: '#3ba7ff', dry: 0.85, wet: 0.9, life: 420, wearLoss: 0.2, tOpt: 70, rain: true },
};
export const COMPOUND_IDS = Object.keys(COMPOUNDS);

export function createTire(compound = 'medium') {
  const C = COMPOUNDS[compound] || COMPOUNDS.medium;
  return { compound: C.id, wear: 0, temp: C.tOpt - 12, grip: 1, laps: 0 };
}

// Сцепление состава при влажности w ∈ [0, 1] (без износа и температуры).
export function compoundGrip(compound, w) {
  const C = COMPOUNDS[compound] || COMPOUNDS.medium;
  return C.dry + (C.wet - C.dry) * w;
}

// Множитель сцепления от износа.
export function wearGrip(compound, wear) {
  const C = COMPOUNDS[compound] || COMPOUNDS.medium;
  return 1 - C.wearLoss * Math.pow(Math.min(1, wear), 1.6);
}

// Множитель от температуры: в окне ±10° — 1, дальше плавно до 0.88.
export function tempGrip(compound, temp) {
  const C = COMPOUNDS[compound] || COMPOUNDS.medium;
  const k = Math.min(1, Math.max(0, (Math.abs(temp - C.tOpt) - 10) / 30));
  return 1 - 0.12 * k * k;
}

// Шаг шин игрока: износ от нагрузки на колёса и скорости, температура, итоговый tireGrip.
export function updateTire(car, dt, wetness = 0) {
  const T = car.tire;
  if (!T) {
    car.tireGrip = 1;
    return;
  }
  const C = COMPOUNDS[T.compound];
  // насколько шины работают: доля использованного сцепления (0..1), среднее по колёсам
  let usage = 0;
  for (const w of car.wheels) {
    const cap = Math.max(1, w.mu * w.load);
    usage += Math.min(1, Math.hypot(w.fx, w.fy) / cap) / 4;
  }
  const v = Math.hypot(car.u, car.v);
  const slide = Math.max(car.over, car.under * 0.6);
  // мокрая шина на сухом асфальте перегревается и стирается в разы быстрее
  const dryAbuse = C.rain ? 1 + 2.4 * (1 - wetness) : 1 + 0.4 * wetness;
  const rate = ((0.25 + 0.75 * usage + slide * 0.8) * Math.min(1.4, v / 45) * dryAbuse) / C.life;
  T.wear = Math.min(1, T.wear + rate * dt);
  // температура: нагрев от работы и скорости, вода охлаждает
  const target = 52 + 58 * usage + 0.32 * v - 30 * wetness + (C.rain ? 22 * (1 - wetness) : 0) + slide * 25;
  const k = target > T.temp ? 1 / 6 : 1 / 10;
  T.temp += (target - T.temp) * Math.min(1, dt * k);
  T.grip = compoundGrip(T.compound, wetness) * wearGrip(T.compound, T.wear) * tempGrip(T.compound, T.temp);
  car.tireGrip = T.grip;
}

// Поменять шины (пит-стоп): новый состав, износ 0, прогретые одеяла.
export function fitTires(car, compound) {
  car.tire = createTire(compound);
  car.tire.temp = COMPOUNDS[car.tire.compound].tOpt - 8;
}

// Рекомендуемый состав для влажности и оставшихся кругов.
export function suggestCompound(wetness, lapsLeft = 3, rainSoon = false) {
  if (wetness > 0.33 || (rainSoon && wetness > 0.15)) return 'wet';
  return lapsLeft <= 3 ? 'soft' : 'medium';
}
