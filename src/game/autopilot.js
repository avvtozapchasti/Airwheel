// Автопилот для тестов и отладки (?autopilot в адресе): регулятор по гоночной линии —
// упреждение по кривизне линии впереди + поворот к линии за ~0.5 с с демпфированием рыскания;
// газ/тормоз по профилю скорости. Выдаёт тот же объект ввода, что руки или клавиатура.
// Также им пользуются боты по сети, когда игрок отключился.
import { maxSteer } from './physics.js';

const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// react — задержка водителя (с): упреждение смотрит дальше, поправки мягче (как у человека).
export function autopilotInput(car, track, prof, spec, { assist = 0.65, pace = 0.97, offset = 0, lineOffset = null, react = 0 } = {}) {
  const line = track.racingLine;
  const u = Math.max(Math.abs(car.u), 1);
  const i = car.idx;
  const off = (k) => (lineOffset ? lineOffset(k) : line.offset[k]) + offset;
  // ошибка положения: где машина относительно линии (влево +)
  const e = car.d - off(i);
  // курс линии в этой точке (с учётом изменения смещения вдоль трассы)
  const j = track.wrap(i + 2);
  const lineHead = track.heading[i] + Math.atan2(off(j) - off(i), 2 * track.ds);
  const headErr = wrap(lineHead - car.psi);
  // упреждение: кривизна линии чуть впереди (реакция машины ~0.15 с)
  const ia = track.index(car.s + u * (0.15 + react) + 2);
  const kappa = line.kappa?.[ia] ?? track.kappa[ia];
  const L = spec.wheelbase;
  // упреждение: кинематика радиуса + запас на недостаточную поворачиваемость (usK, рад/(м/с²))
  const ff = Math.atan(L * kappa) + (spec.usK ?? 0) * u * u * kappa;
  // желаемый курс: на линию через точку в la метрах впереди; поворот к нему за ~0.5 с
  const la = Math.max(8, u * (0.7 + react * 2));
  const psiErr = headErr - Math.atan(e / la);
  const delta = ff + (L / (u * (0.5 + react * 2))) * psiErr - 0.3 * ((car.r - u * kappa) * L) / u;
  const dMax = maxSteer(spec, Math.abs(car.u), spec.grip * (car.tireGrip ?? 1), assist);
  const vT = prof.v[track.index(car.s + car.u * (0.25 + react))] * pace;
  // физика смягчает руль около центра (|s|^expo) — здесь обратное преобразование
  const k = Math.max(-1, Math.min(1, -delta / dMax));
  return {
    steer: Math.sign(k) * Math.pow(Math.abs(k), 1 / (spec.steerExpo ?? 1)),
    gas: car.u < vT - 0.5,
    brake: car.u > vT + 1.5,
    nitro: false,
    handsVisible: 2,
    errors: [],
  };
}
