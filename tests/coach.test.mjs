// Проверка логики распознавания и режима «Ошибка» без камеры:
// генерируем синтетические 21 точку руки и прогоняем через gestures.js + coach.js.
// Запуск: npm test
import assert from 'node:assert/strict';
import { GestureController, fistScore } from '../src/control/gestures.js';
import { Wheel } from '../src/control/wheel.js';
import { Coach, RULES } from '../src/control/coach.js';

// Рука: запястье (x, y), размер ладони p, поза, наклон всей кисти.
function hand(x, y, pose = 'fist', p = 0.12) {
  const lm = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const at = (i, dx, dy) => (lm[i] = { x: x + dx * p * 0.75, y: y + dy * p, z: 0 });
  // основания пальцев (MCP) — 5, 9, 13, 17
  at(5, -0.35, -0.95); at(9, 0, -1); at(13, 0.3, -0.95); at(17, 0.55, -0.85);
  const tipDist = { fist: 0.75, half: 1.0, open: 1.9, thumb: 0.75 }[pose];
  const bases = [[5, -0.35], [9, 0], [13, 0.3], [17, 0.55]];
  for (const [mcp, dx] of bases) {
    at(mcp + 1, dx, -Math.min(tipDist, 1.3));
    at(mcp + 2, dx, -tipDist * 0.9);
    at(mcp + 3, dx, -tipDist);
  }
  // большой палец
  at(1, -0.3, -0.3); at(2, -0.5, -0.55);
  if (pose === 'thumb') { at(3, -0.55, -1.1); at(4, -0.55, -1.6); }
  else { at(3, -0.55, -0.7); at(4, -0.4, -0.8); }
  return { landmarks: lm, score: 1 };
}

// Прогоняет сценарий: frames — функция (t) => руки; возвращает множество показанных подсказок.
function run(frames, seconds, ctx = { straight: true }, setup) {
  const wheel = new Wheel();
  const g = new GestureController(wheel);
  g.aspect = 4 / 3;
  if (setup) setup(g, wheel);
  const coach = new Coach();
  coach.startRecording();
  const shown = new Set();
  let out;
  for (let t = 0; t <= seconds; t += 1 / 30) {
    out = g.update(frames(t), t * 1000);
    const h = coach.update(out.errors, t, ctx);
    if (h) shown.add(h.id);
  }
  return { shown, out, coach, wheel };
}

const calibrated = (g, wheel) => { wheel.zeroDeg = 0; wheel.baseDist = 0.4; wheel.calibrated = true; };
const L = 0.3, R = 0.7, Y = 0.5;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓', name);
}

test('fist_score: кулак < 0.9, ладонь > 1.1', () => {
  assert.ok(fistScore(hand(0.5, 0.5, 'fist').landmarks, 4 / 3) < 0.9);
  assert.ok(fistScore(hand(0.5, 0.5, 'open').landmarks, 4 / 3) > 1.1);
  const half = fistScore(hand(0.5, 0.5, 'half').landmarks, 4 / 3);
  assert.ok(half > 0.9 && half < 1.1, 'half=' + half);
});

test('газ: оба кулака, тормоз: обе ладони, накат: смешанно', () => {
  assert.equal(run(() => [hand(L, Y, 'fist'), hand(R, Y, 'fist')], 0.5, undefined, calibrated).out.gas, true);
  assert.equal(run(() => [hand(L, Y, 'open'), hand(R, Y, 'open')], 0.5, undefined, calibrated).out.brake, true);
  const m = run(() => [hand(L, Y, 'fist'), hand(R, Y, 'open')], 0.5, undefined, calibrated).out;
  assert.equal(m.gas || m.brake, false);
});

test('руль: наклон вправо даёт steer > 0, мёртвая зона ±5°', () => {
  const tilt = (deg) => {
    const a = (deg * Math.PI) / 180, d = 0.2;
    return () => [hand(0.5 - d * Math.cos(a) / (4 / 3), Y - d * Math.sin(a), 'fist'), hand(0.5 + d * Math.cos(a) / (4 / 3), Y + d * Math.sin(a), 'fist')];
  };
  assert.ok(run(tilt(30), 1.5, undefined, calibrated).out.steer > 0.5);
  assert.ok(run(tilt(-30), 1.5, undefined, calibrated).out.steer < -0.5);
  assert.equal(run(tilt(3), 1.5, undefined, calibrated).out.steer, 0);
  assert.equal(run(tilt(60), 1.5, undefined, calibrated).out.steer, 1);
});

test('калибровка: 2 секунды удержания сохраняют нулевой угол и расстояние', () => {
  const r = run(() => [hand(0.35, 0.5, 'fist'), hand(0.65, 0.55, 'fist')], 2.3, undefined, (g, w) => w.startCalibration());
  assert.equal(r.wheel.calibrated, true);
  assert.ok(Math.abs(r.wheel.zeroDeg - Math.atan2(0.05, 0.3 * 4 / 3) * 180 / Math.PI) < 1);
  assert.ok(Math.abs(r.out.steer) < 0.01);
});

test('нитро: большой палец 0,3 с → nitro', () => {
  let fired = false;
  const wheel = new Wheel(); const g = new GestureController(wheel);
  for (let t = 0; t < 0.6; t += 1 / 30) if (g.update([hand(L, Y, 'thumb'), hand(R, Y, 'fist')], t * 1000).nitro) fired = true;
  assert.ok(fired);
});

test('старт/пауза: обе ладони подняты 1 с → startTrigger', () => {
  let fired = false;
  const wheel = new Wheel(); const g = new GestureController(wheel);
  for (let t = 0; t < 1.3; t += 1 / 30) if (g.update([hand(L, 0.6, 'open'), hand(R, 0.6, 'open')], t * 1000).startTrigger) fired = true;
  assert.ok(fired);
});

test('потеря одной руки: руль плавно в 0 за 0,5 с, газ выключен', () => {
  const wheel = new Wheel(); const g = new GestureController(wheel); calibrated(g, wheel);
  const a = (30 * Math.PI) / 180, d = 0.2;
  let out;
  for (let t = 0; t < 1.5; t += 1 / 30) out = g.update([hand(0.5 - d * Math.cos(a) * 0.75, Y - d * Math.sin(a), 'fist'), hand(0.5 + d * Math.cos(a) * 0.75, Y + d * Math.sin(a), 'fist')], t * 1000);
  assert.ok(out.steer > 0.5);
  let t = 1.5;
  out = g.update([hand(0.3, Y, 'fist')], (t += 0.2) * 1000); // пропуск > grace
  const mid = out.steer;
  for (let i = 0; i < 20; i++) out = g.update([hand(0.3, Y, 'fist')], (t += 1 / 30) * 1000);
  assert.ok(mid > 0 && out.steer === 0, `mid=${mid} end=${out.steer}`);
  assert.equal(out.gas, false);
});

// --- все 10 подсказок режима «Ошибка» ---
const cases = {
  hands_low: () => [hand(L, 0.9, 'fist'), hand(R, 0.9, 'fist')],
  fist_partial: () => [hand(L, Y, 'half'), hand(R, Y, 'fist')],
  too_close: () => [hand(0.45, Y, 'fist'), hand(0.55, Y, 'fist')],
  too_far: () => [hand(0.08, Y, 'fist'), hand(0.92, Y, 'fist')],
  mixed: () => [hand(L, Y, 'fist'), hand(R, Y, 'open')],
  jerky: (t) => {
    const deg = (Math.floor(t * 2) % 2 ? 40 : -40) * Math.min(1, t);
    const a = (deg * Math.PI) / 180, d = 0.2;
    return [hand(0.5 - d * Math.cos(a) * 0.75, Y - d * Math.sin(a), 'fist'), hand(0.5 + d * Math.cos(a) * 0.75, Y + d * Math.sin(a), 'fist')];
  },
  drift: () => {
    const a = (8 * Math.PI) / 180, d = 0.2;
    return [hand(0.5 - d * Math.cos(a) * 0.75, Y - d * Math.sin(a), 'fist'), hand(0.5 + d * Math.cos(a) * 0.75, Y + d * Math.sin(a), 'fist')];
  },
  hand_lost: () => [hand(L, Y, 'fist')],
  nitro_short: (t) => [hand(L, Y, t % 1 < 0.15 ? 'thumb' : 'fist'), hand(R, Y, 'fist')],
};

for (const [id, frames] of Object.entries(cases)) {
  test(`подсказка «${id}» срабатывает: ${RULES[id].text('L')}`, () => {
    const { shown } = run(frames, 4, { straight: true }, calibrated);
    assert.ok(shown.has(id), `показаны: ${[...shown].join(', ')}`);
  });
}

test('подсказка «dark» срабатывает при тёмном кадре', () => {
  const { shown } = run(() => [hand(L, Y, 'fist'), hand(R, Y, 'fist')], 1, undefined, (g, w) => { calibrated(g, w); g.brightness = 20; });
  assert.ok(shown.has('dark'));
  console.log('   ', RULES.dark.text());
});

test('крен руля не ругается в повороте', () => {
  const { shown } = run(cases.drift, 5, { straight: false }, calibrated);
  assert.ok(!shown.has('drift'));
});

test('чистые руки — ни одной подсказки', () => {
  const { shown } = run(() => [hand(L, Y, 'fist'), hand(R, Y, 'fist')], 3, undefined, calibrated);
  assert.equal(shown.size, 0, [...shown].join(','));
});

test('подсказка держится минимум 1,5 с и статистика собирается', () => {
  const coach = new Coach();
  coach.startRecording();
  coach.update([{ id: 'mixed', hand: 'R' }], 0);
  const h = coach.update([{ id: 'mixed', hand: 'R' }], 0.5);
  assert.equal(h.id, 'mixed');
  assert.equal(coach.update([], 1.0)?.id, 'mixed'); // ещё держится
  assert.equal(coach.update([], 2.1), null); // ушла
  assert.equal(coach.summary().main.id, 'mixed');
});

console.log(`\nВсе проверки пройдены: ${passed}`);
