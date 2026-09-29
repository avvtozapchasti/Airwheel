// Режим «Ошибка»: превращает «сырые» ошибки из gestures.js в понятные подсказки.
// Правила:
//  - каждая подсказка = что не так + что сделать;
//  - одновременно показывается одна, самая важная (priority);
//  - подсказка держится минимум 1,5 с, чтобы ничего не мигало;
//  - у каждого правила своя задержка срабатывания (delay), чтобы не ругаться на случайный кадр;
//  - «импульсные» ошибки (рывок руля, короткое нитро) залипают на sticky секунд;
//  - за заезд собирается статистика эпизодов по каждому типу.

export const MIN_SHOW_SEC = 1.5;

const handName = (h) => (h === 'L' ? 'Левая' : 'Правая');

export const RULES = {
  dark: {
    priority: 100,
    delay: 0,
    title: 'Темно',
    text: () => 'Слишком темно. Включи свет или повернись к окну.',
    advice: 'Камере не хватало света, и руки распознавались хуже. Сядь лицом к окну или лампе.',
  },
  hands_lost: {
    priority: 95,
    delay: 0.2,
    title: 'Руки вне кадра',
    text: () => 'Обе руки пропали из кадра. Верни их в центр, на уровень груди.',
    advice: 'Руки часто пропадали из кадра. Отодвинься от камеры на полшага, чтобы обе руки помещались.',
  },
  hand_lost: {
    priority: 90,
    delay: 0.2,
    title: 'Рука вне кадра',
    text: (h) => `${handName(h)} рука вышла из кадра. Верни её в центр.`,
    advice: 'Одна из рук выходила из кадра. Держи руль ближе к центру, не раскидывай руки в стороны.',
  },
  hands_low: {
    priority: 80,
    delay: 0.6,
    title: 'Руки низко',
    text: () => 'Руки слишком низко. Подними их на уровень груди, иначе руль не читается.',
    advice: 'Руки опускались слишком низко. Держи «руль» на уровне груди, локти можно опереть о стол.',
  },
  mixed: {
    priority: 70,
    delay: 0.4,
    title: 'Разные жесты',
    text: () => 'Одна рука сжата, другая открыта. Сожми обе для газа или раскрой обе для тормоза.',
    advice: 'Руки часто показывали разные жесты. Газ — оба кулака, тормоз — обе ладони, одновременно.',
  },
  fist_partial: {
    priority: 60,
    delay: 0.5,
    title: 'Слабый кулак',
    text: () => 'Кулак сжат не до конца. Сожми крепче, чтобы газовать.',
    advice: 'Кулак был сжат не до конца, и газ пропадал. Сжимай пальцы полностью, как на настоящем руле.',
  },
  too_close: {
    priority: 50,
    delay: 0.7,
    title: 'Руки близко',
    text: () => 'Руки слишком близко. Разведи шире, руль будет точнее.',
    advice: 'Руки сходились слишком близко, и угол руля считался неточно. Держи их на ширине плеч.',
  },
  too_far: {
    priority: 50,
    delay: 0.7,
    title: 'Руки далеко',
    text: () => 'Руки слишком далеко друг от друга. Сведи ближе.',
    advice: 'Руки расходились слишком широко и рисковали выйти из кадра. Держи их на ширине плеч.',
  },
  jerky: {
    priority: 40,
    delay: 0,
    sticky: 1.0,
    title: 'Резкий руль',
    text: () => 'Крутишь слишком резко. Поворачивай плавнее.',
    advice: 'Руль дёргался слишком резко, машину заносило. Поворачивай плавно и заранее, до входа в поворот.',
  },
  drift: {
    priority: 30,
    delay: 3.0,
    needsStraight: true,
    title: 'Крен руля',
    text: () => 'Руль уходит вбок. Выровняй руки по горизонтали.',
    advice: 'На прямых руль был слегка повёрнут, машину тянуло в сторону. Держи руки на одной высоте.',
  },
  nitro_short: {
    priority: 20,
    delay: 0,
    sticky: 0.3,
    title: 'Нитро не сработало',
    text: () => 'Держи большой палец вверх дольше, пока не заполнится кольцо.',
    advice: 'Нитро срывалось: палец опускался раньше времени. Держи большой палец вверх, пока кольцо не заполнится.',
  },
};

export class Coach {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {}; // id -> { since, activeUntil, active, hand }
    this.current = null; // { id, hand, text, shownAt }
    this.stats = {};
    this.recording = false;
  }

  startRecording() {
    this.stats = {};
    this.recording = true;
  }

  stopRecording() {
    this.recording = false;
  }

  // errors — [{id, hand}] из gestures.js; ctx.straight — едем по прямой.
  update(errors, tSec, ctx = {}) {
    const raw = new Map();
    for (const e of errors) {
      const r = RULES[e.id];
      if (!r) continue;
      if (r.needsStraight && !ctx.straight) continue;
      if (!raw.has(e.id)) raw.set(e.id, e.hand);
    }

    let best = null;
    for (const id of Object.keys(RULES)) {
      const r = RULES[id];
      const st = (this.state[id] ||= { since: null, activeUntil: -1, active: false, hand: null });
      if (raw.has(id)) {
        if (st.since === null) st.since = tSec;
        st.hand = raw.get(id);
        if (r.sticky && tSec - st.since >= r.delay) st.activeUntil = tSec + r.sticky;
      } else {
        st.since = null;
      }
      const active = (st.since !== null && tSec - st.since >= r.delay) || tSec < st.activeUntil;
      if (active && !st.active && this.recording) this.stats[id] = (this.stats[id] || 0) + 1;
      st.active = active;
      if (active && (!best || r.priority > RULES[best].priority)) best = id;
    }

    // Подсказка держится минимум MIN_SHOW_SEC, затем уступает самой важной активной.
    const cur = this.current;
    if (cur && tSec - cur.shownAt < MIN_SHOW_SEC) return cur;
    if (!best) {
      this.current = null;
      return null;
    }
    const hand = this.state[best].hand;
    if (!cur || cur.id !== best || cur.hand !== hand) {
      this.current = { id: best, hand, text: RULES[best].text(hand), shownAt: tSec };
    }
    return this.current;
  }

  // Итоги для экрана результатов.
  summary() {
    const entries = Object.entries(this.stats)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || RULES[b[0]].priority - RULES[a[0]].priority);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const main = entries[0] ? { id: entries[0][0], count: entries[0][1], ...RULES[entries[0][0]] } : null;
    return {
      total,
      items: entries.map(([id, count]) => ({ id, count, title: RULES[id].title })),
      main,
    };
  }
}
