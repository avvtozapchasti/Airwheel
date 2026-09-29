// Классификация жестов по 21 точке руки. Собственная логика, без GestureRecognizer.
// Координаты приходят уже зеркальными и нормализованными (0..1).

export const FIST_ON = 0.9; // fist_score ниже — кулак
export const OPEN_ON = 1.1; // fist_score выше — открытая ладонь
const FINGER_TIPS = [8, 12, 16, 20];

// aspect = ширина/высота кадра: x и y нормализованы по-разному,
// поэтому x умножаем на aspect, чтобы расстояния были честными.
export function dist(a, b, aspect = 1) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function palmSize(lm, aspect) {
  return Math.max(1e-4, dist(lm[0], lm[9], aspect));
}

// Среднее расстояние от кончиков 4 пальцев до запястья / размер ладони.
export function fistScore(lm, aspect) {
  const palm = palmSize(lm, aspect);
  let sum = 0;
  for (const i of FINGER_TIPS) sum += dist(lm[i], lm[0], aspect);
  return sum / FINGER_TIPS.length / palm;
}

// Гистерезис: между порогами сохраняется прежнее состояние.
export function nextFistState(prev, score) {
  if (score < FIST_ON) return 'fist';
  if (score > OPEN_ON) return 'open';
  return prev || 'open';
}

// Большой палец вверх: кончик 4 заметно выше сустава 3, выше основания
// указательного (5) и выше запястья; остальные пальцы согнуты.
// y растёт вниз, поэтому «выше» = меньше y.
export function isThumbUp(lm, aspect, score) {
  const palm = palmSize(lm, aspect);
  const tip = lm[4];
  const aboveJoint = lm[3].y - tip.y > 0.25 * palm;
  const aboveIndex = lm[5].y - tip.y > 0.35 * palm;
  const aboveWrist = tip.y < lm[0].y;
  const fingersCurled = score < 1.05;
  return aboveJoint && aboveIndex && aboveWrist && fingersCurled;
}

// Ладонь открыта и поднята к камере: пальцы смотрят вверх, рука не у нижнего края.
export function isPalmRaised(lm, aspect, state) {
  const palm = palmSize(lm, aspect);
  return state === 'open' && lm[0].y - lm[12].y > 1.2 * palm && lm[0].y < 0.85;
}

// Разложить найденные руки на левую и правую по x на экране (после зеркалирования),
// а не по метке handedness — она часто путается у фронтальной камеры.
// Если рука одна, выбираем ближайший слот по прошлой позиции запястья.
export function assignHands(hands, prevL, prevR) {
  if (hands.length >= 2) {
    const [a, b] = hands[0].landmarks[0].x <= hands[1].landmarks[0].x ? [hands[0], hands[1]] : [hands[1], hands[0]];
    return { left: a, right: b };
  }
  if (hands.length === 1) {
    const w = hands[0].landmarks[0];
    let isLeft = w.x < 0.5;
    if (prevL && prevR) isLeft = dist(w, prevL) < dist(w, prevR);
    else if (prevL) isLeft = dist(w, prevL) < 0.25;
    else if (prevR) isLeft = dist(w, prevR) >= 0.25;
    return isLeft ? { left: hands[0], right: null } : { left: null, right: hands[0] };
  }
  return { left: null, right: null };
}

// Пороги для «сырых» ошибок, которые дальше разбирает coach.js.
export const LIMITS = {
  lostGraceMs: 150, // короткие пропуски трекинга не считаем потерей
  handsLowY: 0.78, // запястье ниже этой линии кадра — руки слишком низко
  tooClose: 0.6, // доля от откалиброванного расстояния
  tooFar: 1.6,
  jerkyDegPerSec: 250,
  driftMin: 5,
  driftMax: 12,
  thumbHoldSec: 0.3,
  thumbSeenSec: 0.08, // палец замечен, но отпущен раньше thumbHoldSec — «нитро не сработало»
  startHoldSec: 1.0,
  darkLevel: 55, // средняя яркость кадра 0..255
};

// Состояние одной руки (слот L или R) между кадрами.
class HandSlot {
  constructor(name) {
    this.name = name;
    this.reset();
  }
  reset() {
    this.present = false;
    this.lm = null;
    this.score = null;
    this.state = 'open';
    this.lastSeen = -1e9;
    this.lastWrist = null;
    this.thumb = false;
    this.raised = false;
  }
}

// Главный модуль управления: принимает руки, отдаёт абстрактный ввод для игры.
// Игра видит только объект {steer, gas, brake, nitro, handsVisible, fistL, fistR, errors[]}
// и не знает ничего про MediaPipe.
export class GestureController {
  constructor(wheel) {
    this.wheel = wheel;
    this.L = new HandSlot('L');
    this.R = new HandSlot('R');
    this.aspect = 4 / 3;
    this.lastT = null;
    this.thumbT = 0; // сколько держим палец вверх
    this.thumbLatched = false; // нитро уже выдано, ждём отпускания
    this.startT = 0;
    this.startLatched = false;
    this.brightness = 255;
  }

  update(hands, nowMs) {
    const t = nowMs / 1000;
    const dt = this.lastT === null ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const A = this.aspect;

    const { left, right } = assignHands(hands || [], this.L.lastWrist, this.R.lastWrist);
    for (const [slot, hand] of [[this.L, left], [this.R, right]]) {
      if (hand) {
        slot.present = true;
        slot.lm = hand.landmarks;
        slot.lastSeen = nowMs;
        slot.lastWrist = hand.landmarks[0];
        slot.score = fistScore(slot.lm, A);
        slot.state = nextFistState(slot.state, slot.score);
        slot.thumb = isThumbUp(slot.lm, A, slot.score);
        slot.raised = isPalmRaised(slot.lm, A, slot.state);
      } else if (nowMs - slot.lastSeen > LIMITS.lostGraceMs) {
        slot.present = false;
        slot.lm = null;
        slot.thumb = false;
        slot.raised = false;
      }
    }

    const L = this.L, R = this.R;
    const both = L.present && R.present;
    const fistL = L.present && L.state === 'fist';
    const fistR = R.present && R.state === 'fist';
    const errors = [];

    // --- руль и калибровка ---
    let calibProgress = this.wheel.calibrated ? 1 : 0;
    if (both) {
      const m = this.wheel.update(L.lm[0], R.lm[0], A, t);
      if (this.wheel.calibrating) calibProgress = this.wheel.feedCalibration(m, t, true);
    } else {
      this.wheel.release(dt);
      if (this.wheel.calibrating) calibProgress = this.wheel.feedCalibration(null, t, false);
    }

    // --- газ / тормоз / накат ---
    const gas = both && fistL && fistR;
    const brake = both && !fistL && !fistR;
    const mixed = both && fistL !== fistR;

    // --- нитро: большой палец вверх на любой руке, удержание 0,3 с ---
    let nitro = false;
    const thumb = L.thumb || R.thumb;
    if (thumb) {
      this.thumbT += dt;
      if (!this.thumbLatched && this.thumbT >= LIMITS.thumbHoldSec) {
        nitro = true;
        this.thumbLatched = true;
      }
    } else {
      if (!this.thumbLatched && this.thumbT >= LIMITS.thumbSeenSec) {
        errors.push({ id: 'nitro_short', hand: null });
      }
      this.thumbT = 0;
      this.thumbLatched = false;
    }
    const nitroHold = this.thumbLatched ? 1 : Math.min(1, this.thumbT / LIMITS.thumbHoldSec);

    // --- старт/пауза: обе открытые ладони подняты 1 с ---
    let startTrigger = false;
    if (both && L.raised && R.raised) {
      this.startT += dt;
      if (!this.startLatched && this.startT >= LIMITS.startHoldSec) {
        startTrigger = true;
        this.startLatched = true;
      }
    } else {
      this.startT = 0;
      this.startLatched = false;
    }
    const startHold = Math.min(1, this.startT / LIMITS.startHoldSec);

    // --- «сырые» ошибки для коуча ---
    if (this.brightness < LIMITS.darkLevel) errors.push({ id: 'dark', hand: null });
    if (!L.present && !R.present) errors.push({ id: 'hands_lost', hand: 'both' });
    else {
      if (!L.present) errors.push({ id: 'hand_lost', hand: 'L' });
      if (!R.present) errors.push({ id: 'hand_lost', hand: 'R' });
    }
    for (const s of [L, R]) {
      if (!s.present) continue;
      if (s.lm[0].y > LIMITS.handsLowY) errors.push({ id: 'hands_low', hand: s.name });
      if (s.score > FIST_ON && s.score < OPEN_ON) errors.push({ id: 'fist_partial', hand: s.name });
    }
    if (mixed) errors.push({ id: 'mixed', hand: fistL ? 'R' : 'L' });
    if (both) {
      const ratio = this.wheel.distRatio;
      if (ratio < LIMITS.tooClose) errors.push({ id: 'too_close', hand: 'both' });
      if (ratio > LIMITS.tooFar) errors.push({ id: 'too_far', hand: 'both' });
      if (Math.abs(this.wheel.angVel) > LIMITS.jerkyDegPerSec) errors.push({ id: 'jerky', hand: 'both' });
      const a = Math.abs(this.wheel.relDeg);
      if (a >= LIMITS.driftMin && a <= LIMITS.driftMax) errors.push({ id: 'drift', hand: 'both' });
    }

    return {
      steer: this.wheel.steer,
      gas,
      brake,
      nitro,
      handsVisible: (L.present ? 1 : 0) + (R.present ? 1 : 0),
      fistL,
      fistR,
      errors,
      // дополнительные поля для UI/отладки
      coast: !gas && !brake,
      mixed,
      nitroHold,
      startHold,
      startTrigger,
      calibProgress,
      relDeg: this.wheel.relDeg,
      angVel: this.wheel.angVel,
      distRatio: this.wheel.distRatio,
      scoreL: L.score,
      scoreR: R.score,
      thumbL: L.thumb,
      thumbR: R.thumb,
      left: L.present ? L.lm : null,
      right: R.present ? R.lm : null,
    };
  }
}
