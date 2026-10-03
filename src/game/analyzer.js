// Анализ езды для режима «Ошибка»: превращает состояние машины и данные трассы
// (зоны торможения, безопасная скорость в каждой точке, кривизна) в «сырые» ошибки,
// которые дальше разбирает coach.js — так же, как ошибки жестов из gestures.js.
//
//   brake_zone     — подъезжаешь к зоне торможения быстрее безопасного и не тормозишь
//   corner_fast    — в повороте с газом на скорости выше предельной
//   understeer     — машина не доворачивает и уходит на внешнюю сторону
//   jerky_speed    — резкий руль на большой скорости
//   wall_hit       — удар о стену
//   grass          — колёса на траве
//   brake_straight — тормозишь на прямой без причины
//   coast_straight — не держишь газ на свободной прямой
//   pit_speed      — в пит-лейне быстрее 60 км/ч (или летишь к линии въезда без торможения)
export const CORNER_WORD = { hairpin: 'шпилька', turn90: 'поворот 90°', chicane: 'шикана', turn: 'поворот' };

export class DriveAnalyzer {
  constructor(track, prof, brakePoints, spec) {
    this.track = track;
    this.prof = prof;
    this.bps = brakePoints;
    this.spec = spec;
    this.prevSteer = 0;
    this.wallUntil = -1;
    this.t = 0;
  }

  // Минимальная безопасная скорость на ближайших dist метрах.
  minAhead(s, dist) {
    const tr = this.track;
    const n = Math.ceil(dist / tr.ds);
    const i0 = tr.index(s);
    let m = Infinity;
    for (let k = 0; k <= n; k += 2) m = Math.min(m, this.prof.v[tr.wrap(i0 + k)]);
    return m;
  }

  // ctx: { car, input, dt, events, aheadGap, keyboard }
  update({ car, input, dt, events = [], aheadGap = Infinity, keyboard = false }) {
    this.t += dt;
    const tr = this.track, errors = [];
    const u = car.u;
    const i = car.idx;
    const kappa = tr.kappa[i];
    const inCorner = Math.abs(kappa) > 1 / 300;
    const vSafe = this.prof.v[i];

    // удар о стену — «залипает» на 2.5 с
    for (const e of events) if (e.type === 'wall' && e.speed > 1.5) this.wallUntil = this.t + 2.5;
    if (this.t < this.wallUntil) errors.push({ id: 'wall_hit', hand: null });

    // зона торможения: через ~0.6 с (реакция + жест) скорость будет выше профиля торможения
    const sAhead = car.s + Math.max(0, u) * 0.6;
    const vLimit = this.prof.v[tr.index(sAhead)];
    if (car.brake < 0.3 && u > vLimit * 1.03 + 1) {
      let near = null;
      for (const bp of this.bps) {
        const toMin = tr.deltaS(car.s, bp.sMin);
        if (toMin > 2 && toMin < tr.deltaS(bp.sBrake, bp.sMin) + 220 && (!near || toMin < near.toMin)) near = { bp, toMin };
      }
      if (near && u > near.bp.vMin * 1.08) errors.push({ id: 'brake_zone', hand: null, name: CORNER_WORD[near.bp.corner.type] || 'поворот' });
    }

    // в повороте с газом и слишком быстро
    if (inCorner && input.gas && u > vSafe * 1.06 && u > 12) errors.push({ id: 'corner_fast', hand: null });

    // недоворот: перед «уплыл», машину несёт наружу поворота
    const latVel = u * Math.sin(car.psi - tr.heading[i]) + car.v * Math.cos(car.psi - tr.heading[i]);
    const outward = -Math.sign(kappa) * latVel;
    if (inCorner && car.under > 0.35 && outward > 0.6) errors.push({ id: 'understeer', hand: null });

    // резкий руль на скорости (только руки — клавиатура сглажена)
    const rate = Math.abs((input.steer || 0) - this.prevSteer) / Math.max(dt, 1e-3);
    this.prevSteer = input.steer || 0;
    if (!keyboard && u > 33 && rate > 2.4) errors.push({ id: 'jerky_speed', hand: 'both' });

    // трава
    if (car.wheelsOut >= 2 && Math.abs(u) > 3) errors.push({ id: 'grass', hand: null });

    // пит-лейн: превышение в зоне 60 км/ч или подлёт к линии въезда без торможения
    const L = tr.pit;
    if (L && L.inLane(car.s, car.d)) {
      const v = Math.hypot(car.u, car.v);
      const uu = L.rel(car.s);
      const lim = 60 / 3.6;
      if ((L.inLimitZone(car.s) && v > lim + 2 / 3.6) || (uu < L.limA && v > Math.sqrt(lim * lim + 2 * 7 * Math.max(0, L.limA - uu)) + 1 && car.brake < 0.3)) {
        errors.push({ id: 'pit_speed', hand: null });
      }
    }

    // прямая: впереди нет поворота, дорога свободна (в пит-лейне — не ругаемся)
    if (!inCorner && u > 12 && aheadGap > 40 && !(L && L.inRange(car.s) && Math.abs(car.d) > tr.hw[i])) {
      const ahead = this.minAhead(car.s, 140);
      if (input.brake && ahead > u * 0.97 && u < vSafe * 0.95) errors.push({ id: 'brake_straight', hand: null });
      if (!input.gas && !input.brake && ahead > u + 8) errors.push({ id: 'coast_straight', hand: null });
    }
    return errors;
  }
}
