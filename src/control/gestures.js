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
    this.lastSeen = -1;
    this.lastWrist = null;
  }
}

// Главный модуль управления: принимает руки, отдаёт абстрактный ввод для игры.
export class GestureController {
  constructor() {
    this.L = new HandSlot('L');
    this.R = new HandSlot('R');
    this.aspect = 4 / 3;
  }

  update(hands, nowMs) {
    const { left, right } = assignHands(hands || [], this.L.lastWrist, this.R.lastWrist);
    for (const [slot, hand] of [[this.L, left], [this.R, right]]) {
      if (hand) {
        slot.present = true;
        slot.lm = hand.landmarks;
        slot.lastSeen = nowMs;
        slot.lastWrist = hand.landmarks[0];
        slot.score = fistScore(slot.lm, this.aspect);
        slot.state = nextFistState(slot.state, slot.score);
      } else {
        slot.present = false;
      }
    }
    const both = this.L.present && this.R.present;
    const fistL = this.L.present && this.L.state === 'fist';
    const fistR = this.R.present && this.R.state === 'fist';
    return {
      gas: both && fistL && fistR,
      brake: both && !fistL && !fistR,
      fistL,
      fistR,
      handsVisible: (this.L.present ? 1 : 0) + (this.R.present ? 1 : 0),
      scoreL: this.L.score,
      scoreR: this.R.score,
    };
  }
}
