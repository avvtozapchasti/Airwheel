// Покрытия — только данные. Физика (physics.js) берёт отсюда сцепление и сопротивление для
// каждого колеса отдельно, частицы — тип пыли, камера и руль — вибрацию.
//
//  grip  — множитель сцепления шины на этом покрытии (асфальт = 1);
//  wet   — дополнительный множитель на мокром (асфальт и поребрик считаются через шины, tires.js);
//  roll  — сопротивление качению как замедление a = c0 + c1·min(v, 35) (м/с², v в м/с), у каждого
//          колеса своя четверть. На траве a ≈ 0.5 + 0.11·v: на 30 м/с — 3.8 м/с² (≈14 км/ч в секунду),
//          выше — не растёт (мягкий предел скорости, а не «стена»), а с места — всего 0.5 м/с²,
//          поэтому разогнаться и выехать обратно можно всегда;
//  vib   — вибрация (0..1): тряска камеры, дрожь руля, подпрыгивание кузова;
//  off   — «вне трассы» (для коуча, срезок и автоматического возврата);
//  dust  — тип частиц из-под колёс (null — без пыли).
export const SURFACES = {
  asphalt: { id: 'asphalt', name: 'асфальт', grip: 1.0, wet: 1, roll: [0.15, 0], vib: 0, off: false, dust: null },
  pit: { id: 'pit', name: 'пит-лейн', grip: 1.0, wet: 1, roll: [0.15, 0], vib: 0, off: false, dust: null },
  kerb: { id: 'kerb', name: 'поребрик', grip: 0.95, wet: 0.9, roll: [0.25, 0.004], vib: 0.6, off: false, dust: null },
  runoff: { id: 'runoff', name: 'зона вылета', grip: 0.9, wet: 0.92, roll: [0.25, 0.01], vib: 0.15, off: true, dust: null },
  grass: { id: 'grass', name: 'трава', grip: 0.65, wet: 0.82, roll: [0.5, 0.11], vib: 0.7, off: true, dust: 'dust' },
  gravel: { id: 'gravel', name: 'гравий', grip: 0.5, wet: 0.95, roll: [0.9, 0.15], vib: 1.0, off: true, dust: 'gravel' },
  sand: { id: 'sand', name: 'песок', grip: 0.5, wet: 0.95, roll: [1.0, 0.16], vib: 0.8, off: true, dust: 'sand' },
};

export const surfaceOf = (id) => SURFACES[id] || SURFACES.grass;

// Сцепление покрытия с учётом влажности трассы w ∈ [0, 1].
export function surfaceGrip(S, w) {
  return S.grip * (1 + (S.wet - 1) * w);
}

// Сопротивление качению покрытия на скорости v (м/с), м/с².
export function surfaceRoll(S, v) {
  return S.roll[0] + S.roll[1] * Math.min(v, 35);
}
