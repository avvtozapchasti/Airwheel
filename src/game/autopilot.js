// Автопилот для тестов и отладки (?autopilot в адресе): pure pursuit по гоночной линии,
// газ/тормоз по профилю скорости. Выдаёт тот же объект ввода, что руки или клавиатура.
export function autopilotInput(car, track, prof, spec, { assist = 0.65, pace = 0.97, offset = 0 } = {}) {
  const line = track.racingLine;
  const la = Math.max(10, car.u * 0.9);
  const i = track.index(car.s + la);
  const p = track.pointAt(car.s + la, line.offset[i] + offset);
  let err = Math.atan2(p.x - car.x, p.z - car.z) - car.psi;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const Ld = Math.hypot(p.x - car.x, p.z - car.z);
  const dReq = Math.atan((spec.wheelbase * 2 * Math.sin(err)) / Ld);
  const spd = Math.max(Math.abs(car.u), 1);
  const aLat = (spec.grip * (spec.mass * 9.81 + spec.downforce * car.u * car.u)) / spec.mass;
  const dMax = Math.min(spec.steerLock, Math.atan((spec.wheelbase * (spec.steerOver + (1 - assist) * 0.5) * aLat) / (spd * spd)));
  const vT = prof.v[track.index(car.s + car.u * 0.25)] * pace;
  return {
    steer: Math.max(-1, Math.min(1, -dReq / dMax)),
    gas: car.u < vT - 0.5,
    brake: car.u > vT + 1.5,
    nitro: false,
    handsVisible: 2,
    errors: [],
  };
}
