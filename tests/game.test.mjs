// Проверки игровой логики без браузера: трассы, профиль скорости, физика (автопилот по траектории).
// Запуск: npm test
import assert from 'node:assert/strict';
import { Track } from '../src/game/track.js';
import { computeRacingLine, speedProfile, brakingPoints, topSpeed } from '../src/game/profile.js';
import { CARS } from '../src/game/cars.js';
import { createCar, stepCar, STEP, speedOf, maxSteer } from '../src/game/physics.js';
import { rng } from '../src/util/rng.js';
// детерминированные тесты: Math.random с фиксированным seed (TEST_SEED — для проверки на разных)
Math.random = rng(+(process.env.TEST_SEED || 20251003));
import { compoundGrip, wearGrip, createTire, updateTire, COMPOUND_IDS } from '../src/game/tires.js';
import { Weather } from '../src/game/weather.js';
import ALPINE from '../src/game/tracks/alpine.js';
import STREET from '../src/game/tracks/street.js';
import COASTAL from '../src/game/tracks/coastal.js';
import HARBOR from '../src/game/tracks/harbor.js';
import DESERT from '../src/game/tracks/desert.js';
import SAKURA from '../src/game/tracks/sakura.js';
import { autopilotInput } from '../src/game/autopilot.js';
import { DriveAnalyzer } from '../src/game/analyzer.js';
import { placeCar } from '../src/game/physics.js';
import { createBots, updateBots, collidePlayer } from '../src/game/bots.js';
import { RaceSession } from '../src/game/session.js';
import { QualiSession } from '../src/game/quali.js';

const TRACKS = [ALPINE, COASTAL, STREET];
const NEW_TRACKS = [HARBOR, DESERT, SAKURA];

let passed = 0;
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

const built = new Map();
function build(def) {
  if (!built.has(def.id)) {
    const tr = new Track(def);
    tr.racingLine = computeRacingLine(tr);
    built.set(def.id, tr);
  }
  return built.get(def.id);
}

// Автопилот (тот же, что в игре по ?autopilot).
export function autopilot(tr, spec, prof, { assist = 0.65, laps = 1, pace = 0.97 } = {}) {
  const car = createCar(spec, tr, { s: 0, d: 0 });
  let t = 0, walls = 0, vmax = 0;
  const lapTimes = [];
  let lastLap = 0;
  while (t < 400 && lapTimes.length < laps) {
    const input = autopilotInput(car, tr, prof, spec, { assist, pace });
    for (const e of stepCar(car, input, STEP, tr, { assist })) if (e.type === 'wall') walls++;
    vmax = Math.max(vmax, car.u);
    t += STEP;
    if (Math.floor(car.progress / tr.length) > lapTimes.length) {
      lapTimes.push(t - lastLap);
      lastLap = t;
    }
  }
  return { lapTimes, walls, vmax };
}

for (const def of TRACKS) {
  const tr = build(def);
  test(`${def.name}: замкнута, ширина 12–16 м, ≥3 зон торможения`, () => {
    const gap = Math.hypot(tr.x[0] - tr.x[tr.n - 1], tr.z[0] - tr.z[tr.n - 1]);
    assert.ok(gap < tr.ds * 1.5, 'шов ' + gap);
    for (let i = 0; i < tr.n; i++) {
      const w = tr.hw[i] * 2;
      assert.ok(w >= (def.minWidth ?? 12) - 0.01 && w <= (def.maxWidth ?? 16) + 0.01, `ширина ${w} на ${i}`);
    }
    const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
    const zones = brakingPoints(tr, prof).filter((b) => b.vEntry - b.vMin > 8);
    assert.ok(zones.length >= 3, 'зон торможения: ' + zones.length);
  });
}

for (const def of NEW_TRACKS) {
  test(`${def.name}: замкнута, ширина по данным, ≥3 зон торможения, длинная прямая, пит-лейн; GT3 и F1 проходят без ударов`, () => {
    const tr = build(def);
    const gap = Math.hypot(tr.x[0] - tr.x[tr.n - 1], tr.z[0] - tr.z[tr.n - 1]);
    assert.ok(gap < tr.ds * 1.5, 'шов ' + gap);
    for (let i = 0; i < tr.n; i++) {
      const w = tr.hw[i] * 2;
      assert.ok(w >= (def.minWidth ?? 12) - 0.01 && w <= (def.maxWidth ?? 16) + 0.01, `ширина ${w} на ${i}`);
    }
    const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
    const zones = brakingPoints(tr, prof).filter((b) => b.vEntry - b.vMin > 8);
    assert.ok(zones.length >= 3, 'зон торможения: ' + zones.length);
    let run = 0, longest = 0;
    for (let k = 0; k < 2 * tr.n; k++) {
      run = Math.abs(tr.kappa[k % tr.n]) < 1 / 600 ? run + tr.ds : 0;
      longest = Math.max(longest, run);
    }
    assert.ok(longest > 380, 'длинная прямая ' + longest.toFixed(0));
    assert.ok(tr.pit && tr.pit.len > 250, 'пит-лейн');
    for (const cls of ['gt3', 'f1']) {
      const pr = speedProfile(tr, tr.racingLine, CARS[cls]);
      const r = autopilot(tr, CARS[cls], pr, { laps: 1 });
      assert.equal(r.lapTimes.length, 1, cls + ' круг');
      assert.equal(r.walls, 0, cls + ' ударов');
    }
    console.log(`    ${(tr.length / 1000).toFixed(2)} км, прямая ${longest.toFixed(0)} м, зон торможения ${zones.length}, идеал GT3 ${prof.lapTime.toFixed(1)} с`);
  });
}

test('GT3: максимальная скорость ≈ 280 км/ч', () => {
  const v = topSpeed(CARS.gt3) * 3.6;
  assert.ok(v > 270 && v < 290, 'v=' + v);
});

test('GT3: автопилот проходит круг Alpine без ударов, близко к идеальному времени', () => {
  const tr = build(ALPINE);
  const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
  const r = autopilot(tr, CARS.gt3, prof, { laps: 2 });
  assert.equal(r.lapTimes.length, 2, 'кругов: ' + r.lapTimes.length);
  assert.equal(r.walls, 0, 'ударов: ' + r.walls);
  assert.ok(r.lapTimes[1] < prof.lapTime * 1.12, `круг ${r.lapTimes[1].toFixed(2)} при идеале ${prof.lapTime.toFixed(2)}`);
  console.log(`    круг автопилота ${r.lapTimes[1].toFixed(2)} с, идеал ${prof.lapTime.toFixed(2)} с, vmax ${(r.vmax * 3.6).toFixed(0)} км/ч`);
});

// --- анализ езды для режима «Ошибка» ---
function analyze(setup, input = {}) {
  const tr = build(ALPINE);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const bps = brakingPoints(tr, prof);
  const an = new DriveAnalyzer(tr, prof, bps, spec);
  const car = createCar(spec, tr, { s: 0, d: 0 });
  setup(car, tr, prof, bps);
  let errs = [];
  for (let k = 0; k < 5; k++) errs = an.update({ car, input: { steer: 0, gas: false, brake: false, ...input }, dt: 1 / 30, keyboard: true });
  return errs.map((e) => e.id + (e.name ? ':' + e.name : ''));
}

test('анализ: несёшься к шпильке без торможения → «Впереди шпилька»', () => {
  const ids = analyze((car, tr, prof, bps) => {
    const bp = bps.find((b) => b.corner.type === 'hairpin');
    placeCar(car, tr, bp.sBrake + 5);
    car.u = bp.vEntry;
  }, { gas: true });
  assert.ok(ids.includes('brake_zone:шпилька'), ids.join(','));
});

test('анализ: в повороте с газом быстрее предела → corner_fast', () => {
  const ids = analyze((car, tr, prof, bps) => {
    const bp = bps.find((b) => b.corner.type === 'hairpin');
    placeCar(car, tr, bp.sMin);
    car.u = bp.vMin * 1.4;
  }, { gas: true });
  assert.ok(ids.includes('corner_fast'), ids.join(','));
});

test('анализ: колёса на траве, тормоз и накат на прямой', () => {
  assert.ok(analyze((car) => (car.wheelsOut = 3, car.u = 20)).includes('grass'));
  const onStraight = (car, tr) => {
    placeCar(car, tr, 120);
    car.u = 30;
  };
  assert.ok(analyze(onStraight, { brake: true }).includes('brake_straight'));
  assert.ok(analyze(onStraight, {}).includes('coast_straight'));
  assert.ok(!analyze(onStraight, { gas: true }).length, 'на газу по прямой ошибок нет');
});

test('боты: 11 машин проходят 2 круга без NaN, быстрые впереди, есть обгоны', () => {
  const tr = build(ALPINE);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const bots = createBots(11, spec, tr, { seed: 42, difficulty: 'medium', bps: brakingPoints(tr, prof) });
  // стартуют в обратном порядке темпа — медленные впереди, чтобы проверить обгоны
  const order = [...bots].sort((a, b) => a.pace - b.pace);
  order.forEach((b, k) => b.place(tr.gridSlot(k).s, tr.gridSlot(k).d));
  let t = 0, overtakes = 0;
  let prevOrder = order.map((b) => b.code).join();
  while (t < 200 && Math.min(...bots.map((b) => b.progress)) < 2 * tr.length) {
    updateBots(bots, { dt: STEP, player: null, raceTime: t, started: true });
    t += STEP;
    for (const b of bots) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.progress) && Number.isFinite(b.d), 'NaN у ' + b.code);
    for (const b of bots) assert.ok(Math.abs(b.d) < tr.hw[b.idx] + 2, `${b.code} вылетел: d=${b.d.toFixed(1)}`);
    const ord = [...bots].sort((a, b) => b.progress - a.progress).map((b) => b.code).join();
    if (ord !== prevOrder) overtakes++;
    prevOrder = ord;
  }
  assert.ok(t < 200, 'боты не доехали 2 круга');
  const lapT = t / 2;
  assert.ok(lapT > prof.lapTime && lapT < prof.lapTime * 1.4, `круг ботов ${lapT.toFixed(1)} при идеале ${prof.lapTime.toFixed(1)}`);
  assert.ok(overtakes > 3, 'обгонов: ' + overtakes);
  console.log(`    2 круга за ${t.toFixed(1)} с, смен порядка: ${overtakes}`);
});

test('гонка: игрок на автопилоте + 11 ботов, решётка, огни, финиш, протокол с очками', () => {
  const tr = build(ALPINE);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const bps = brakingPoints(tr, prof);
  const bots = createBots(11, spec, tr, { seed: 7, bps });
  const events = [];
  const S = new RaceSession({ track: tr, spec, laps: 1, bots, onEvent: (e) => events.push(e.type) });
  const order = [...bots];
  order.splice(5, 0, 'player');
  S.start(order);
  let guard = 0;
  while (S.state !== 'done' && guard++ < 120 * 200) {
    const input = S.state === 'grid' ? { steer: 0, gas: false, brake: true } : autopilotInput(S.playerCar, tr, prof, spec, { pace: 0.9 });
    S.step(STEP, input);
    for (const b of bots) collidePlayer(S.playerCar, [b], tr);
  }
  assert.equal(S.state, 'done');
  assert.equal(events.filter((e) => e === 'light').length, 5, 'пять огней');
  assert.ok(events.includes('go') && events.includes('finish'));
  assert.ok(!events.includes('penalty'), 'без фальстарта при удержании тормоза');
  const rows = S.results();
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.points), [25, 18, 15]);
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].time >= rows[k - 1].time, 'протокол по времени');
  console.log(`    игрок: P${rows.find((r) => r.player).pos}, победитель ${rows[0].name} ${rows[0].time.toFixed(2)} с`);
});

test('квалификация: разгон, 2 попытки, протокол 12 машин; срезка аннулирует круг', () => {
  const tr = build(ALPINE);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const bots = createBots(11, spec, tr, { seed: 3 });
  const events = [];
  const Q = new QualiSession({ track: tr, spec, prof, bots, onEvent: (e) => events.push(e.type) });
  Q.start();
  let guard = 0, cut = false;
  while (Q.state !== 'done' && guard++ < 120 * 240) {
    let input = autopilotInput(Q.playerCar, tr, prof, spec, { pace: 0.92 });
    // во второй попытке срезаем: уводим машину на траву
    if (Q.attempt === 2 && Q.lapTimeOf() > 20 && Q.lapTimeOf() < 24) {
      input = { ...input, steer: 1 };
      cut = true;
    }
    Q.step(STEP, input);
  }
  assert.equal(Q.state, 'done');
  assert.equal(events.filter((e) => e === 'attempt').length, 2);
  assert.ok(cut && events.includes('invalid'), 'срезка аннулирует круг');
  const rows = Q.results();
  assert.equal(rows.length, 12);
  const me = rows.find((r) => r.player);
  assert.ok(me.time > 0, 'время игрока засчитано по первой попытке');
  for (const b of bots) assert.ok(Math.abs(b.qualiTime / b.prof.lapTime - 1) <= 0.0151, 'разброс ±1.5%');
  console.log(`    квала: игрок P${me.pos} ${me.time.toFixed(2)} с, поул ${rows[0].time.toFixed(2)} с`);
});

test('F1: ~340 км/ч, в быстрых поворотах намного быстрее GT3, тормозит позже, проходит круг', () => {
  const v = topSpeed(CARS.f1) * 3.6;
  assert.ok(v > 330 && v < 350, 'vmax F1 ' + v);
  const tr = build(ALPINE);
  const gt3 = speedProfile(tr, tr.racingLine, CARS.gt3);
  const f1 = speedProfile(tr, tr.racingLine, CARS.f1);
  assert.ok(f1.lapTime < gt3.lapTime * 0.85, `F1 ${f1.lapTime.toFixed(1)} против GT3 ${gt3.lapTime.toFixed(1)}`);
  // быстрый поворот (R≈120–250 м): у F1 скорость заметно выше
  let i0 = -1;
  for (let i = 0; i < tr.n; i++) {
    const R = 1 / Math.abs(tr.racingLine.kappa[i]);
    if (R > 120 && R < 250) {
      i0 = i;
      break;
    }
  }
  assert.ok(f1.v[i0] > gt3.v[i0] * 1.3, `поворот: F1 ${(f1.v[i0] * 3.6).toFixed(0)} против GT3 ${(gt3.v[i0] * 3.6).toFixed(0)} км/ч`);
  // зона торможения в шпильку с той же скорости короче
  const hp = (prof) => brakingPoints(tr, prof).find((b) => b.corner.type === 'hairpin');
  const zone = (b) => b.sMin - b.sBrake;
  assert.ok(zone(hp(f1)) < zone(hp(gt3)), `шпилька: F1 ${zone(hp(f1)).toFixed(0)} м против GT3 ${zone(hp(gt3)).toFixed(0)} м`);
  const r = autopilot(tr, CARS.f1, f1, { laps: 2 });
  assert.equal(r.walls, 0);
  console.log(`    F1: круг ${r.lapTimes[1].toFixed(2)} с (GT3 идеал ${gt3.lapTime.toFixed(1)} с), тормозной путь в шпильку ${zone(hp(f1)).toFixed(0)} м против ${zone(hp(gt3)).toFixed(0)} м`);
});

test('Street Night: узкая 9–11 м с участком ~8 м, шпилька 180° и 90° под тормоз, туннель, мокрая ночь', () => {
  const tr = build(STREET);
  let min = Infinity, max = 0;
  for (let i = 0; i < tr.n; i++) {
    min = Math.min(min, tr.hw[i] * 2);
    max = Math.max(max, tr.hw[i] * 2);
  }
  assert.ok(min >= 7.9 && min <= 8.5, 'самый узкий участок ' + min.toFixed(1));
  assert.ok(max <= 11.01, 'макс. ширина ' + max.toFixed(1));
  const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
  const bps = brakingPoints(tr, prof);
  assert.ok(bps.some((b) => b.corner.type === 'hairpin' && b.vMin < 16), 'шпилька');
  assert.ok(bps.filter((b) => b.corner.type === 'turn90' && b.vEntry - b.vMin > 10).length >= 3, '90° под тормоз');
  assert.ok(STREET.tunnel && STREET.env.time === 'night' && STREET.env.wet, 'туннель, ночь, мокро');
  // стены вплотную: вылет меньше 4 м везде (кроме стороны пит-лейна вдоль стартовой прямой)
  for (let i = 0; i < tr.n; i++) {
    let u = tr.pit.rel(i * tr.ds);
    if (u > tr.length / 2) u -= tr.length;
    const pitSide = u > -45 && u < tr.pit.len + 45;
    assert.ok((pitSide && tr.pit.side > 0) || tr.wallL[i] - tr.hw[i] < 4, 'стена слева ' + i);
    assert.ok((pitSide && tr.pit.side < 0) || tr.wallR[i] - tr.hw[i] < 4, 'стена справа ' + i);
  }
  const r = autopilot(tr, CARS.gt3, prof, { laps: 1, pace: 0.9 });
  assert.equal(r.lapTimes.length, 1, 'круг пройден');
  console.log(`    ширина ${min.toFixed(1)}–${max.toFixed(1)} м, круг автопилота ${r.lapTimes[0].toFixed(1)} с (касаний стен: ${r.walls})`);
});

test('Coastal Sprint: 2 шпильки, 90° после самой быстрой прямой, мост; GT3 и F1 проходят без ударов', () => {
  const tr = build(COASTAL);
  const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
  const bps = brakingPoints(tr, prof);
  assert.equal(bps.filter((b) => b.corner.type === 'hairpin').length, 2);
  // первый поворот после линии старта — 90° в конце самой быстрой прямой
  const t1 = bps[0];
  assert.equal(t1.corner.type, 'turn90');
  assert.ok(t1.vEntry * 3.6 > 250, 'перед T1 разгон до ' + (t1.vEntry * 3.6).toFixed(0));
  assert.ok(tr.bridge && tr.bridge.length > 150, 'мост');
  for (const cls of ['gt3', 'f1']) {
    const pr = speedProfile(tr, tr.racingLine, CARS[cls]);
    const r = autopilot(tr, CARS[cls], pr, { laps: 1 });
    assert.equal(r.walls, 0, cls + ' ударов');
    console.log(`    ${cls}: круг ${r.lapTimes[0].toFixed(1)} с`);
  }
});

// --- блок A: столкновения, покрытия, управляемость ---
// Машина рядом с левой стеной главной прямой Alpine, нос под углом angDeg к стене, 180 км/ч.
function wallShot(cls, angDeg, v = 50) {
  const tr = build(ALPINE);
  const spec = CARS[cls];
  const car = createCar(spec, tr, { s: 200, d: 0 });
  const i0 = tr.index(200);
  const a = (angDeg * Math.PI) / 180;
  placeCar(car, tr, 200, tr.wallL[i0] - 1.6 - 2.3 * Math.sin(a));
  car.psi = tr.heading[i0] + a;
  car.u = v;
  car.gear = Math.max(0, spec.gears.findIndex((g) => g > v));
  const before = speedOf(car);
  for (let k = 0; k < 240; k++) {
    const ev = stepCar(car, { steer: 0, gas: false, brake: false }, STEP, tr, { assist: 0.65 });
    const hit = ev.find((e) => e.type === 'wall');
    if (hit) return { car, tr, hit, loss: 1 - speedOf(car) / before };
  }
  return { car, tr, hit: null, loss: 0 };
}

test('стена: скользящий удар почти без потерь, лобовой гасит большую часть скорости, но не всю', () => {
  for (const cls of ['gt3', 'f1']) {
    const g = wallShot(cls, 10), m = wallShot(cls, 45), h = wallShot(cls, 90);
    assert.ok(g.hit && m.hit && h.hit, 'удар зафиксирован');
    assert.ok(g.loss < 0.08, `${cls} 10°: потеря ${(g.loss * 100).toFixed(0)}%`);
    assert.ok(m.loss > 0.2 && m.loss < 0.6, `${cls} 45°: потеря ${(m.loss * 100).toFixed(0)}%`);
    assert.ok(h.loss > 0.5 && h.loss < 0.9, `${cls} 90°: потеря ${(h.loss * 100).toFixed(0)}% — не 100%`);
    assert.ok(h.hit.strength > m.hit.strength && m.hit.strength > g.hit.strength, 'сила удара растёт с углом');
    console.log(`    ${cls}: 10° −${(g.loss * 100).toFixed(0)}%, 45° −${(m.loss * 100).toFixed(0)}%, 90° −${(h.loss * 100).toFixed(0)}%`);
  }
});

test('стена: не залипает — после лобового удара машина на газу уезжает вдоль трассы', () => {
  const { car, tr } = wallShot('gt3', 90, 12);
  const p0 = car.progress;
  for (let k = 0; k < 120 * 4; k++) stepCar(car, { steer: 0, gas: true, brake: false }, STEP, tr, { assist: 0.65 });
  assert.ok(car.progress - p0 > 15, 'проехал ' + (car.progress - p0).toFixed(1) + ' м');
  assert.ok(speedOf(car) * 3.6 > 20, 'скорость ' + (speedOf(car) * 3.6).toFixed(0));
});

test('трава и гравий: всегда можно разогнаться, на скорости тормозит 10–15 км/ч в секунду, выезд обратно', () => {
  const tr = build(ALPINE);
  for (const [cls, surf] of [['gt3', 'grass'], ['f1', 'grass'], ['gt3', 'gravel']]) {
    const spec = CARS[cls];
    const car = createCar(spec, tr, { s: 150, d: -(tr.hw[tr.index(150)] + 6) });
    if (surf === 'gravel') for (let i = 0; i < tr.n; i++) tr.gravelR[i] = 1;
    stepCar(car, { steer: 0, gas: false, brake: false }, STEP, tr, {});
    assert.equal(car.surfaces[0], surf);
    for (let k = 0; k < 120 * 4; k++) stepCar(car, { steer: 0, gas: true, brake: false }, STEP, tr, { assist: 0.65 });
    const v4 = car.u * 3.6;
    assert.ok(v4 > (surf === 'grass' ? 40 : 25), `${cls} ${surf}: за 4 с с места ${v4.toFixed(0)} км/ч`);
    if (surf === 'gravel') tr.gravelR.fill(0);
  }
  // накатом с 180 км/ч по траве: замедление от покрытия 10–15 км/ч в секунду (без учёта воздуха)
  const car = createCar(CARS.gt3, tr, { s: 150, d: -(tr.hw[tr.index(150)] + 6) });
  car.u = 50;
  car.gear = 4;
  const v0 = car.u;
  for (let k = 0; k < 120; k++) stepCar(car, { steer: 0, gas: false, brake: false }, STEP, tr, {});
  const air = (CARS.gt3.drag * 47 * 47) / CARS.gt3.mass;
  const dec = ((v0 - car.u) - air) * 3.6;
  assert.ok(dec > 10 && dec < 16, 'замедление на траве ' + dec.toFixed(1) + ' км/ч/с');
  // и возвращается на асфальт
  for (let k = 0; k < 120 * 5 && car.wheelsOut > 0; k++) {
    const input = { steer: -0.35, gas: true, brake: false };
    stepCar(car, input, STEP, tr, { assist: 0.65 });
  }
  assert.equal(car.wheelsOut, 0, 'вернулся на асфальт');
  assert.ok(car.u > 20, 'не потерял скорость в ноль: ' + (car.u * 3.6).toFixed(0));
});

test('руль зависит от скорости: ~30° на месте, 3–5° на максимальной; рывок руля не срывает в занос', () => {
  for (const cls of ['gt3', 'f1']) {
    const spec = CARS[cls];
    const lo = (maxSteer(spec, 3) * 180) / Math.PI, hi = (maxSteer(spec, topSpeed(spec)) * 180) / Math.PI;
    assert.ok(lo > 24 && lo <= 30.5, `${cls} на месте ${lo.toFixed(1)}°`);
    assert.ok(hi >= 3 && hi <= 5, `${cls} на максималке ${hi.toFixed(1)}°`);
  }
  // 200 км/ч по прямой, руль рывком в упор на 0.3 с и обратно — машина не разворачивается
  const tr = build(ALPINE);
  for (const cls of ['gt3', 'f1']) {
    const car = createCar(CARS[cls], tr, { s: 100, d: 0 });
    car.u = 55;
    car.gear = 4;
    let maxBeta = 0;
    for (let k = 0; k < 120 * 3; k++) {
      const t = k * STEP;
      stepCar(car, { steer: t < 0.3 ? 1 : 0, gas: true, brake: false }, STEP, tr, { assist: 0.65 });
      maxBeta = Math.max(maxBeta, Math.abs(car.beta));
    }
    assert.ok(maxBeta < 0.25, `${cls}: угол скольжения ${((maxBeta * 180) / Math.PI).toFixed(1)}°`);
    assert.ok(Math.abs(car.r) < 0.15, `${cls}: успокоилась, r=${car.r.toFixed(2)}`);
  }
});

test('столкновение с ботом: обмен импульсом, без остановки в ноль', () => {
  const tr = build(ALPINE);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const [bot] = createBots(1, spec, tr, { seed: 5 });
  const car = createCar(spec, tr, { s: 300, d: 0 });
  car.u = 50;
  bot.place(304.3, 0);
  bot.v = 40;
  bot.pose(0);
  const ev = collidePlayer(car, [bot], tr);
  assert.ok(ev.some((e) => e.type === 'contact'), 'контакт');
  assert.ok(car.u > 40 && car.u < 50, 'игрок ' + (car.u * 3.6).toFixed(0) + ' км/ч');
  assert.ok(bot.v > 40, 'бота подтолкнули: ' + (bot.v * 3.6).toFixed(0));
  void prof;
});

// «Игрок с жестами»: видит трассу с задержкой 80 мс, руль дрожит (шум, 30 Гц), газ/тормоз — вкл/выкл.
function gestureDriver(def, cls, { assist = 0.65, laps = 2, seed = 1, pace = 0.92 } = {}) {
  const tr = build(def);
  const spec = CARS[cls];
  const prof = speedProfile(tr, tr.racingLine, spec);
  const car = createCar(spec, tr, { s: 0, d: 0 });
  const r = rng(seed);
  const hist = [];
  let t = 0, held = { steer: 0, gas: false, brake: false }, next = 0, spins = 0, inSpin = false, offs = 0, wasOff = false;
  while (t < 400 && car.progress < laps * tr.length) {
    if (t >= next) {
      next += 1 / 30;
      hist.push({ t, ...autopilotInput(car, tr, prof, spec, { assist, pace }) });
      while (hist.length > 1 && hist[1].t <= t - 0.08) hist.shift();
      const noise = (r() + r() + r() + r() + r() + r() - 3) * 0.06;
      held = { steer: Math.max(-1, Math.min(1, hist[0].steer + noise)), gas: hist[0].gas, brake: hist[0].brake };
    }
    stepCar(car, held, STEP, tr, { assist });
    t += STEP;
    const b = Math.abs(car.beta);
    if (b > 0.6 && !inSpin) {
      spins++;
      inSpin = true;
    }
    if (b < 0.17) inSpin = false;
    const off = car.wheelsOut >= 2;
    if (off && !wasOff) offs++;
    wasOff = off;
  }
  return { spins, offs, t, done: car.progress >= laps * tr.length };
}

test('жесты (задержка, дрожь рук, газ вкл/выкл): GT3 проходит трассы без разворотов, F1 — строже', () => {
  for (const def of [...TRACKS, ...NEW_TRACKS]) {
    const a = gestureDriver(def, 'gt3', { assist: 0.65 });
    const n = gestureDriver(def, 'gt3', { assist: 0 });
    assert.ok(a.done && n.done, def.name + ': доехал');
    assert.equal(a.spins, 0, `${def.name} GT3 с помощью: разворотов ${a.spins}`);
    assert.ok(a.offs <= 4, `${def.name} GT3 с помощью: вылетов ${a.offs} за 2 круга`);
    assert.ok(n.spins + n.offs <= 6, `${def.name} GT3 без помощи: ошибок ${n.spins + n.offs} за 2 круга`);
    const f = gestureDriver(def, 'f1', { assist: 0.65 });
    assert.ok(f.done && f.spins === 0, `${def.name} F1 с помощью: разворотов ${f.spins}`);
    console.log(`    ${def.name}: GT3 вылетов ${a.offs} (без помощи ${n.offs}, разворотов ${n.spins}), F1 вылетов ${f.offs}`);
  }
});

// --- блок B: шины, погода, пит-лейн ---
test('шины: сухие в дождь ~0.65, мокрые на сухом ~0.85, износ снимает 10–25% сцепления', () => {
  const dryInRain = compoundGrip('medium', 0.9), wetOnDry = compoundGrip('wet', 0);
  assert.ok(dryInRain > 0.6 && dryInRain < 0.7, 'сухие в дождь ' + dryInRain.toFixed(2));
  assert.ok(Math.abs(wetOnDry - 0.85) < 0.02, 'мокрые на сухом ' + wetOnDry.toFixed(2));
  assert.ok(compoundGrip('wet', 0.9) > compoundGrip('soft', 0.9), 'в дождь мокрые лучше');
  assert.ok(compoundGrip('soft', 0) > compoundGrip('wet', 0), 'на сухом сухие лучше');
  // точка, где мокрые выгоднее, — около 0.3
  let cross = 0;
  for (let w = 0; w <= 1; w += 0.01) if (compoundGrip('wet', w) > compoundGrip('medium', w)) { cross = w; break; }
  assert.ok(cross > 0.25 && cross < 0.4, 'переход ' + cross.toFixed(2));
  for (const id of COMPOUND_IDS) {
    const loss = 1 - wearGrip(id, 1);
    assert.ok(loss >= 0.1 && loss <= 0.25, `${id}: износ −${(loss * 100).toFixed(0)}%`);
  }
  // мокрая шина на сухом стирается быстрее, чем в дождь
  const tr = build(ALPINE);
  const wearOf = (compound, wet) => {
    const car = createCar(CARS.gt3, tr, { s: 0, d: 0 });
    car.tire = createTire(compound);
    const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
    for (let k = 0; k < 120 * 30; k++) {
      stepCar(car, autopilotInput(car, tr, prof, CARS.gt3, { pace: 0.85 }), STEP, tr, { assist: 0.65, wetness: wet });
      updateTire(car, STEP, wet);
    }
    return car.tire.wear;
  };
  assert.ok(wearOf('wet', 0) > wearOf('wet', 0.9) * 1.8, 'мокрые перегреваются на сухом');
  assert.ok(wearOf('soft', 0) > wearOf('medium', 0) * 1.4, 'soft изнашивается быстрее medium');
});

test('погода: «Переменная» — дождь на 1–2 круге с предупреждением, трасса намокает и сохнет; seed детерминирован', () => {
  const lap = 80;
  const a = new Weather('variable', { seed: 42, lapTime: lap }), b = new Weather('variable', { seed: 42, lapTime: lap });
  assert.equal(a.start, b.start, 'одинаковый seed — одинаковый дождь у всех игроков');
  assert.ok(a.start > lap * 0.8 && a.start < lap * 1.5, 'старт дождя ' + a.start.toFixed(0));
  assert.equal(a.forecast(a.start - 70).type, 'rain');
  assert.equal(a.wetnessAt(a.start - 1), 0);
  const peak = a.wetnessAt(a.start + 60);
  assert.ok(peak > 0.6, 'намокла ' + peak.toFixed(2));
  const end = a.start + a.dur;
  assert.ok(a.wetnessAt(end + 60) < a.wetnessAt(end) && a.wetnessAt(end + 200) < 0.25, 'сохнет');
  assert.ok(Math.abs(b.wetnessAt(a.start + 60) - peak) < 1e-9, 'влажность одинаковая');
  const r = new Weather('rain'), d = new Weather('dry');
  assert.ok(r.wetnessAt(10) > 0.8 && r.rainAt(10) > 0.5 && d.wetnessAt(500) === 0);
});

// Водитель для теста пит-стопа: автопилот, на подъезде к пит-лейну — по пути въезда.
function pitRace({ track = ALPINE, weather = 'dry', laps = 3, assist = 0.65, requestLap = 2, compound = 'wet', brakeForPit = true, lineSpeed = 60 } = {}) {
  const tr = build(track);
  const spec = CARS.gt3;
  const prof = speedProfile(tr, tr.racingLine, spec);
  const bots = createBots(11, spec, tr, { seed: 9, bps: brakingPoints(tr, prof) });
  const events = [];
  const S = new RaceSession({ track: tr, spec, laps, assist, bots, prof, weather: new Weather(weather, { seed: 4, lapTime: prof.lapTime * 1.1 }), compound: 'medium', onEvent: (e) => events.push(e) });
  const order = [...bots];
  order.splice(5, 0, 'player');
  S.start(order);
  let guard = 0, maxPitV = 0;
  const L = tr.pit;
  while (S.state !== 'done' && guard++ < 120 * 600) {
    const car = S.playerCar, p = S.player;
    if (p.timing.lap === requestLap && !p.pit.request && p.pit.windowOpen(car) && !p.pit.stops.length) p.pit.request = compound;
    const toPit = p.pit.request || p.pit.active;
    let input = S.state === 'grid' ? { steer: 0, gas: false, brake: true } : autopilotInput(car, tr, prof, spec, { pace: 0.85, lineOffset: toPit && (p.pit.active || L.rel(car.s) > tr.length - 300 || L.rel(car.s) < L.wallA + 20) ? (k) => L.pathD(k * tr.ds) : null });
    if (brakeForPit && p.pit.request && p.pit.phase === 'track') {
      const u = L.rel(car.s);
      const toLine = (u > L.len ? tr.length - u : -u) + L.limA;
      if (speedOf(car) > Math.sqrt((lineSpeed / 3.6) ** 2 + 2 * 5 * Math.max(0, toLine - 8))) input = { ...input, gas: false, brake: true };
    }
    S.step(STEP, input);
    if (p.pit.active && L.inLimitZone(car.s)) maxPitV = Math.max(maxPitV, speedOf(car));
  }
  return { S, events, maxPitV };
}

test('пит-стоп игрока: въезд, 60 км/ч, остановка в боксе 2.5–4 с, смена шин, выезд, потери в протоколе', () => {
  const { S, events, maxPitV } = pitRace();
  const types = events.map((e) => e.type);
  for (const t of ['pit-enter', 'pit-stop', 'pit-done', 'pit-release', 'pit-exit']) assert.ok(types.includes(t), 'событие ' + t);
  const stop = events.find((e) => e.type === 'pit-stop');
  assert.ok(stop.duration >= 2.5 && stop.duration <= 4.0, 'длительность ' + stop.duration.toFixed(2));
  assert.equal(S.playerCar.tire.compound, 'wet', 'шины сменились');
  assert.ok(maxPitV * 3.6 < 63, 'скорость в пит-лейне ' + (maxPitV * 3.6).toFixed(1));
  assert.ok(!events.some((e) => e.type === 'penalty' && e.reason === 'pit'), 'без штрафа');
  const me = S.results().find((r) => r.player);
  assert.equal(me.pits, 1);
  assert.ok(me.pitLoss > 10 && me.pitLoss < 30, 'потери ' + me.pitLoss.toFixed(1));
  console.log(`    пит-стоп ${stop.duration.toFixed(1)} с, потери ${me.pitLoss.toFixed(1)} с, макс. ${(maxPitV * 3.6).toFixed(0)} км/ч`);
});

test('пит-лейн: превышение 60 км/ч на линии въезда — штраф +3 с и подсказка коуча', () => {
  // тормозит, но не до 60, а только до ~110 км/ч на линии въезда
  const { events } = pitRace({ assist: 0, lineSpeed: 110, laps: 2 });
  assert.ok(events.some((e) => e.type === 'penalty' && e.reason === 'pit' && e.sec === 3), 'штраф');
  const tr = build(ALPINE);
  const prof = speedProfile(tr, tr.racingLine, CARS.gt3);
  const an = new DriveAnalyzer(tr, prof, brakingPoints(tr, prof), CARS.gt3);
  const car = createCar(CARS.gt3, tr, { s: tr.pit.sIn + tr.pit.limA + 20, d: tr.pit.side * tr.pit.fastD(tr.pit.sIn + 100) });
  car.u = 30;
  const ids = an.update({ car, input: { steer: 0, gas: true, brake: false }, dt: 1 / 30 }).map((e) => e.id);
  assert.ok(ids.includes('pit_speed'), ids.join(','));
});

test('боты: в «Переменной» погоде меняют шины на мокрые в боксах, без «читов» по времени', () => {
  const { S } = pitRace({ weather: 'variable', laps: 4, requestLap: 99 });
  const rows = S.results().filter((r) => !r.player);
  const pitted = rows.filter((r) => r.pits > 0);
  assert.ok(pitted.length >= 6, 'заехали ' + pitted.length);
  for (const r of pitted) assert.ok(r.pitLoss > 10 && r.pitLoss < 35, `${r.code}: потери ${r.pitLoss.toFixed(1)}`);
  assert.ok(pitted.some((r) => r.entry.bot.pitStops.some((x) => x.compound === 'wet')), 'на мокрые');
  console.log(`    пит-стопы ботов: ${pitted.length}/11, потери ${(pitted.reduce((a, r) => a + r.pitLoss, 0) / pitted.length).toFixed(1)} с в среднем`);
});

test('графика: автоподбор понижает пресет, если средний FPS < 45 за 3 с', async () => {
  globalThis.window ??= { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
  globalThis.document ??= { hidden: false };
  const { QualityManager } = await import('../src/render/quality.js');
  const applied = [];
  const q = new QualityManager({ apply: (p) => applied.push(p.id) });
  q.setMode('auto');
  assert.equal(q.current.id, 'high');
  for (let t = 0; t < 7; t += 1 / 30) q.update(1 / 30, true); // 30 FPS
  assert.equal(q.current.id, 'medium');
  for (let t = 0; t < 7; t += 1 / 30) q.update(1 / 30, true);
  assert.equal(q.current.id, 'low');
  const fixed = new QualityManager({ apply: () => {} });
  fixed.setMode('high');
  for (let t = 0; t < 10; t += 1 / 20) fixed.update(1 / 20, true);
  assert.equal(fixed.current.id, 'high', 'ручной пресет не трогаем');
  const fast = new QualityManager({ apply: () => {} });
  fast.setMode('auto');
  for (let t = 0; t < 10; t += 1 / 60) fast.update(1 / 60, true);
  assert.equal(fast.current.id, 'high', 'при 60 FPS не понижаем');
});

for (const [name, fn] of queue) {
  await fn();
  passed++;
  console.log('✓', name);
}
console.log(`\nВсе проверки игры пройдены: ${passed}`);
