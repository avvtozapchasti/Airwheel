// Проверки игровой логики без браузера: трассы, профиль скорости, физика (автопилот по траектории).
// Запуск: npm test
import assert from 'node:assert/strict';
import { Track } from '../src/game/track.js';
import { computeRacingLine, speedProfile, brakingPoints, topSpeed } from '../src/game/profile.js';
import { CARS } from '../src/game/cars.js';
import { createCar, stepCar, STEP } from '../src/game/physics.js';
import ALPINE from '../src/game/tracks/alpine.js';

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

// Автопилот: pure pursuit по гоночной линии, газ/тормоз по профилю скорости.
export function autopilot(tr, spec, prof, { assist = 0.65, laps = 1, pace = 0.97 } = {}) {
  const line = tr.racingLine;
  const car = createCar(spec, tr, { s: 0, d: 0 });
  let t = 0, walls = 0, vmax = 0;
  const lapTimes = [];
  let lastLap = 0;
  while (t < 400 && lapTimes.length < laps) {
    const la = Math.max(10, car.u * 0.9);
    const p = tr.pointAt(car.s + la, line.offset[tr.index(car.s + la)]);
    let err = Math.atan2(p.x - car.x, p.z - car.z) - car.psi;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const Ld = Math.hypot(p.x - car.x, p.z - car.z);
    const dReq = Math.atan((spec.wheelbase * 2 * Math.sin(err)) / Ld);
    const spd = Math.max(Math.abs(car.u), 1);
    const aLat = (spec.grip * (spec.mass * 9.81 + spec.downforce * car.u * car.u)) / spec.mass;
    const dMax = Math.min(spec.steerLock, Math.atan((spec.wheelbase * (spec.steerOver + (1 - assist) * 0.5) * aLat) / (spd * spd)));
    const vT = prof.v[tr.index(car.s + car.u * 0.25)] * pace;
    const input = { steer: Math.max(-1, Math.min(1, -dReq / dMax)), gas: car.u < vT - 0.5, brake: car.u > vT + 1.5 };
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

console.log(`\nВсе проверки игры пройдены: ${passed}`);
