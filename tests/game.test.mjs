// Проверки игровой логики без браузера: трассы, профиль скорости, физика (автопилот по траектории).
// Запуск: npm test
import assert from 'node:assert/strict';
import { Track } from '../src/game/track.js';
import { computeRacingLine, speedProfile, brakingPoints, topSpeed } from '../src/game/profile.js';
import { CARS } from '../src/game/cars.js';
import { createCar, stepCar, STEP } from '../src/game/physics.js';
import ALPINE from '../src/game/tracks/alpine.js';
import { autopilotInput } from '../src/game/autopilot.js';
import { DriveAnalyzer } from '../src/game/analyzer.js';
import { placeCar } from '../src/game/physics.js';
import { createBots, updateBots, collidePlayer } from '../src/game/bots.js';
import { RaceSession } from '../src/game/session.js';

const TRACKS = [ALPINE];

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓', name);
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

console.log(`\nВсе проверки игры пройдены: ${passed}`);
