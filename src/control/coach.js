// Режим «Ошибка»: превращает «сырые» ошибки из gestures.js в понятные подсказки.
// Правила:
//  - каждая подсказка = что не так + что сделать;
//  - одновременно показывается одна, самая важная (priority);
//  - подсказка держится минимум 1,5 с, чтобы ничего не мигало;
//  - у каждого правила своя задержка срабатывания (delay), чтобы не ругаться на случайный кадр;
//  - «импульсные» ошибки (рывок руля, короткое нитро) залипают на sticky секунд;
//  - за заезд собирается статистика эпизодов по каждому типу.
// Приоритет: сначала безопасность (стена, зона торможения, скорость в повороте, трава),
// потом техника рук, потом освещение. Правила езды приходят из game/analyzer.js.

export const MIN_SHOW_SEC = 1.5;
const SAFETY = 100; // приоритет, с которого подсказка считается подсказкой безопасности

const handName = (h) => (h === 'L' ? 'Левая' : 'Правая');

export const RULES = {
  // --- безопасность: ситуация на трассе ---
  wall_hit: {
    priority: 130,
    delay: 0,
    title: 'Удар о стену',
    text: () => 'Ты задел стену. Держись ближе к центру трассы на узких участках.',
    advice: 'Машина касалась стен. На узких участках держись ближе к центру и не режь поворот впритык к бетону.',
  },
  brake_zone: {
    priority: 125,
    delay: 0,
    sticky: 0.8,
    title: 'Поздно тормозишь',
    text: (h, e) => `Впереди ${e?.name || 'поворот'}. Раскрой ладони и тормози сейчас.`,
    kbText: (h, e) => `Впереди ${e?.name || 'поворот'}. Тормози сейчас (↓).`,
    advice: 'Ты поздно начинал тормозить перед поворотами. Раскрывай ладони у таблички 100 м — раньше, чем кажется.',
  },
  early_gas: {
    priority: 122,
    delay: 0,
    sticky: 0.8,
    title: 'Газ до старта',
    text: () => 'Рано! Держи ладони раскрытыми, пока горят огни, — иначе фальстарт.',
    kbText: () => 'Рано! Отпусти газ, пока горят огни, — иначе фальстарт.',
    advice: 'На старте газ нажимался, пока горели огни. Держи ладони раскрытыми и сжимай кулаки, только когда огни погаснут.',
  },
  pit_speed: {
    priority: 121,
    delay: 0,
    sticky: 1.2,
    title: 'Скорость в пит-лейне',
    text: () => 'Превышена скорость в пит-лейне. Раскрой ладони и притормози.',
    kbText: () => 'Превышена скорость в пит-лейне. Тормози (↓) до 60 км/ч.',
    advice: 'В пит-лейне ограничение 60 км/ч. Раскрывай ладони заранее, ещё до белой линии въезда.',
  },
  corner_fast: {
    priority: 120,
    delay: 0.15,
    sticky: 1.0,
    title: 'Быстро в поворот',
    text: () => 'Слишком быстро для поворота. Ладони раскрой раньше.',
    kbText: () => 'Слишком быстро для поворота. Тормози раньше.',
    advice: 'В повороты заезжал слишком быстро и с газом. Сначала тормоз (ладони), потом поворот, газ — на выходе.',
  },
  grass: {
    priority: 115,
    delay: 0.25,
    title: 'Трава',
    text: () => 'Колёса на траве. Сбрось газ и вернись на асфальт плавно.',
    kbText: () => 'Колёса на траве. Отпусти газ и плавно вернись на асфальт.',
    advice: 'Колёса часто уходили на траву. Сбрасывай газ и возвращайся на асфальт плавно, без резкого руля.',
  },
  understeer: {
    priority: 112,
    delay: 0.25,
    sticky: 1.0,
    title: 'Недоворот',
    text: () => 'Не довернул. Поверни руки сильнее и убери газ.',
    kbText: () => 'Не довернул. Поверни сильнее и отпусти газ.',
    advice: 'Машина не доворачивала и уходила наружу. Сбрасывай газ и поворачивай руки сильнее, но плавно.',
  },
  jerky_speed: {
    priority: 110,
    delay: 0,
    sticky: 1.2,
    title: 'Резкий руль на скорости',
    text: () => 'Крутишь слишком резко на скорости. Поворачивай плавнее, иначе занос.',
    advice: 'На скорости руль дёргался. Поворачивай плавно — на большой скорости хватает небольшого наклона рук.',
  },
  // --- техника рук ---
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
  brake_straight: {
    priority: 28,
    delay: 0.6,
    title: 'Тормоз на прямой',
    text: () => 'Тормозишь на прямой. Сожми кулаки, чтобы ехать быстрее.',
    kbText: () => 'Тормозишь на прямой. Держи газ (↑).',
    advice: 'Тормозил на прямых без причины. На прямой держи кулаки сжатыми до таблички торможения.',
  },
  coast_straight: {
    priority: 26,
    delay: 1.2,
    title: 'Нет газа на прямой',
    text: () => 'Газ не нажат на свободной прямой. Сожми оба кулака крепче.',
    kbText: () => 'Газ не нажат на прямой. Держи ↑.',
    advice: 'На свободных прямых газ пропадал. Сжимай кулаки полностью, пока не увидишь табличку торможения.',
  },
  nitro_short: {
    priority: 20,
    delay: 0,
    sticky: 0.3,
    title: 'Ускорение не сработало',
    text: () => 'Держи большой палец вверх дольше, пока не заполнится кольцо.',
    advice: 'Ускорение срывалось: палец опускался раньше времени. Держи большой палец вверх, пока кольцо не заполнится.',
  },
  // --- освещение ---
  dark: {
    priority: 10,
    delay: 0,
    title: 'Темно',
    text: () => 'Слишком темно. Включи свет или повернись к окну.',
    advice: 'Камере не хватало света, и руки распознавались хуже. Сядь лицом к окну или лампе.',
  },
};

export function ruleText(id, hand, err, keyboard) {
  const r = RULES[id];
  return (keyboard && r.kbText ? r.kbText : r.text)(hand, err);
}

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

  // errors — [{id, hand, ...}] из gestures.js и analyzer.js; ctx.straight — едем по прямой,
  // ctx.keyboard — текст подсказки для клавиатуры.
  update(errors, tSec, ctx = {}) {
    const raw = new Map();
    for (const e of errors) {
      const r = RULES[e.id];
      if (!r) continue;
      if (r.needsStraight && !ctx.straight) continue;
      if (!raw.has(e.id)) raw.set(e.id, e);
    }

    let best = null;
    for (const id of Object.keys(RULES)) {
      const r = RULES[id];
      const st = (this.state[id] ||= { since: null, activeUntil: -1, active: false, hand: null });
      if (raw.has(id)) {
        if (st.since === null) st.since = tSec;
        st.hand = raw.get(id).hand;
        st.err = raw.get(id);
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
    // исключение: подсказка безопасности (стена, тормоз) вытесняет менее важную сразу
    const preempt = best && cur && best !== cur.id && RULES[best].priority >= SAFETY && RULES[best].priority > RULES[cur.id].priority;
    if (cur && tSec - cur.shownAt < MIN_SHOW_SEC && !preempt) return cur;
    if (!best) {
      this.current = null;
      return null;
    }
    const hand = this.state[best].hand;
    const text = ruleText(best, hand, this.state[best].err, ctx.keyboard);
    if (!cur || cur.id !== best || cur.hand !== hand || cur.text !== text) {
      this.current = { id: best, hand, text, shownAt: tSec };
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

