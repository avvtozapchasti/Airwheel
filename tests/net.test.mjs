// Проверки сетевой логики без WebRTC: коды комнат, кодирование состояния, интерполяция чужих
// машин, полная сетевая гонка «хост + клиент» в одном процессе с задержкой доставки снимков.
import assert from 'node:assert/strict';
import { Track } from '../src/game/track.js';
import { computeRacingLine, speedProfile, brakingPoints } from '../src/game/profile.js';
import { CARS } from '../src/game/cars.js';
import { STEP } from '../src/game/physics.js';
import { autopilotInput } from '../src/game/autopilot.js';
import { createBots } from '../src/game/bots.js';
import { Weather } from '../src/game/weather.js';
import { makeRoomCode, normalizeCode, isValidCode } from '../src/net/transport.js';
import { RemoteCar, encodeCar, encodeBot, decodeCar, INTERP_MS } from '../src/net/remote.js';
import { NetRaceSession } from '../src/net/netsession.js';
import ALPINE from '../src/game/tracks/alpine.js';

let passed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

const tr = new Track(ALPINE);
tr.racingLine = computeRacingLine(tr);
const spec = CARS.gt3;
const prof = speedProfile(tr, tr.racingLine, spec);

test('код комнаты: 5 символов без O/0/I/1, ввод нормализуется', () => {
  for (let k = 0; k < 200; k++) {
    const c = makeRoomCode();
    assert.ok(isValidCode(c), c);
    assert.ok(!/[O0I1]/.test(c), c);
  }
  assert.equal(normalizeCode(' ab-cd e '), 'ABCDE');
  assert.equal(isValidCode(normalizeCode('abc')), false);
});

test('состояние машины: кодирование и декодирование без потерь (с округлением)', () => {
  const rc = { x: 12.3456, y: 1.2, z: -40.1, psi: 1.234567, u: 50, v: 1, delta: 0.05, brake: 1, boostOn: true, progress: 1234.5, d: -2.25, lift: 0, pitch: 0.01, roll: -0.02, tire: { compound: 'wet', wear: 0.3 } };
  const st = decodeCar(encodeCar(rc, { finished: false, penalty: 3, pit: { phase: 'service' } }));
  assert.ok(Math.abs(st.x - 12.35) < 0.01 && Math.abs(st.psi - 1.235) < 0.001);
  assert.equal(st.compound, 'wet');
  assert.equal(st.pit, 'service');
  assert.equal(st.penalty, 3);
  assert.ok(Math.abs(st.v - Math.hypot(50, 1)) < 0.01);
  assert.ok(JSON.stringify(encodeCar(rc, {})).length < 200, 'компактно');
});

test('чужая машина: интерполяция между снимками, экстраполяция ограничена 250 мс', () => {
  const r = new RemoteCar(spec, tr);
  const snap = (t, x) => r.add(t, decodeCar(encodeCar({ x, y: 0, z: 0, psi: Math.PI / 2, u: 20, v: 0, delta: 0, brake: 0, progress: x, d: 0 }, {})));
  snap(0, 0);
  snap(50, 1);
  snap(100, 2);
  r.sample(75, 0.016);
  assert.ok(Math.abs(r.x - 1.5) < 1e-6, 'середина ' + r.x);
  r.sample(100 + 1000, 0.016); // данных нет секунду — дальше 250 мс не уезжаем
  assert.ok(r.x < 2 + 20 * 0.26, 'экстраполяция ' + r.x.toFixed(2));
  snap(40, 99); // старый пакет игнорируется
  assert.equal(r.buf.at(-1).t, 100);
});

test('сетевая гонка в одном процессе: хост (боты) + клиент, снимки 20 Гц с задержкой, общий протокол', () => {
  const LAT = 40; // мс в одну сторону
  const bots = createBots(4, spec, tr, { seed: 11, bps: brakingPoints(tr, prof) });
  const weatherSeed = 5;
  // решётка: бот, хост, бот, клиент, бот, бот
  const grid = [bots[0].code, 'h', bots[1].code, 'p1', bots[2].code, bots[3].code];
  const evH = [], evC = [];
  const mk = (isHost, onEvent) =>
    new NetRaceSession({ track: tr, spec, prof, laps: 1, assist: 0.65, isHost, holdT: 0.8, weather: new Weather('dry', { seed: weatherSeed }), player: { name: isHost ? 'Хост' : 'Гость' }, onEvent });
  const H = mk(true, (e) => evH.push(e));
  const C = mk(false, (e) => evC.push(e));
  const rcHostSide = new RemoteCar(spec, tr); // клиент — на хосте
  const rcClientSide = new Map(); // хост и боты — на клиенте
  H.start(grid.map((id) => (id === 'h' ? 'player' : id === 'p1' ? { remote: rcHostSide, id: 'p1', name: 'Гость', color: '#2f7cf6', human: true } : bots.find((b) => b.code === id))));
  C.start(
    grid.map((id) => {
      if (id === 'p1') return 'player';
      const rc = new RemoteCar(spec, tr);
      rcClientSide.set(id, rc);
      return { remote: rc, id, name: id === 'h' ? 'Хост' : id, color: '#fff', human: id === 'h' };
    }),
  );
  H.player.id = 'h';
  C.player.id = 'p1';
  const inflight = [];
  let t = 0, sendT = 0, maxErr = 0;
  const reports = new Map();
  for (let k = 0; k < 120 * 200 && reports.size < 2; k++) {
    t += STEP * 1000;
    const inp = (S) => (S.state === 'grid' ? { steer: 0, gas: false, brake: true } : autopilotInput(S.playerCar, tr, prof, spec, { pace: 0.9 }));
    H.step(STEP, inp(H));
    C.step(STEP, inp(C));
    sendT += STEP * 1000;
    if (sendT >= 50) {
      sendT = 0;
      inflight.push({ at: t + LAT, to: 'host', id: 'p1', st: decodeCar(encodeCar(C.playerCar, C.player)), ts: t });
      inflight.push({ at: t + LAT, to: 'client', id: 'h', st: decodeCar(encodeCar(H.playerCar, H.player)), ts: t });
      for (const e of H.entries) if (e.bot) inflight.push({ at: t + LAT, to: 'client', id: e.id, st: decodeCar(encodeBot(e.bot, e)), ts: t });
    }
    while (inflight.length && inflight[0].at <= t) {
      const m = inflight.shift();
      if (m.to === 'host') rcHostSide.add(m.ts, m.st);
      else rcClientSide.get(m.id).add(m.ts, m.st);
    }
    if (k % 2 === 0) {
      rcHostSide.sample(t - INTERP_MS, STEP * 2);
      for (const rc of rcClientSide.values()) rc.sample(t - INTERP_MS, STEP * 2);
      // где хост на самом деле был 100 мс назад — сравниваем с его копией у клиента
      if (H.state === 'race' && H.time > 2) {
        const rc = rcClientSide.get('h');
        const err = Math.abs(rc.progress - (H.playerCar.progress - H.playerCar.u * 0.1));
        maxErr = Math.max(maxErr, err);
      }
    }
    evH.length = evC.length = 0;
    if (H.waiting && !reports.has('h')) reports.set('h', { time: H.player.finishTime, bestLap: H.player.timing.bestLap, penalty: H.player.penalty, pits: 0, pitLoss: 0 });
    if (C.waiting && !reports.has('p1')) reports.set('p1', { time: C.player.finishTime, bestLap: C.player.timing.bestLap, penalty: C.player.penalty, pits: 0, pitLoss: 0 });
  }
  assert.equal(reports.size, 2, 'оба финишировали');
  assert.ok(maxErr < 3, 'копия хоста у клиента отстаёт не больше 3 м: ' + maxErr.toFixed(2));
  const rows = H.finalRows(reports);
  assert.equal(rows.length, 6);
  const host = rows.find((r) => r.id === 'h'), guest = rows.find((r) => r.id === 'p1');
  assert.ok(host.human && guest.human);
  assert.ok(Math.abs(guest.time - reports.get('p1').time - reports.get('p1').penalty) < 1e-6, 'время гостя — из его отчёта');
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].time >= rows[k - 1].time);
  // клиент видел правильный порядок старта и финиш хоста
  assert.equal(C.entries.find((e) => e.id === 'h').finished, true);
  console.log(`    гонка: хост P${host.pos}, гость P${guest.pos}; ошибка копии хоста ≤ ${maxErr.toFixed(2)} м`);
});

test('отключение игрока: хост передаёт его машину боту с того же места', () => {
  const bots = createBots(2, spec, tr, { seed: 3 });
  const rc = new RemoteCar(spec, tr);
  const H = new NetRaceSession({ track: tr, spec, prof, laps: 2, isHost: true, holdT: 0.5 });
  H.start([bots[0], 'player', { remote: rc, id: 'p1', name: 'Гость', color: '#2f7cf6', human: true }, bots[1]]);
  rc.add(0, decodeCar(encodeCar({ x: 0, y: 0, z: 0, psi: 0, u: 30, v: 0, delta: 0, brake: 0, progress: 250, d: 1.5 }, {})));
  rc.sample(0, 0.016);
  const e = H.entries.find((x) => x.id === 'p1');
  const bot = H.convertToBot(e, { seed: 9 });
  assert.ok(bot && e.bot === bot && !e.remote, 'стал ботом');
  assert.ok(e.name.includes('бот'));
  assert.ok(Math.abs(bot.progress - 250) < 1e-6 && Math.abs(bot.d - 1.5) < 1e-6 && bot.v === 30);
  assert.ok(H.bots.includes(bot) && !H.remotes.includes(e));
});

for (const [name, fn] of queue) {
  await fn();
  passed++;
  console.log('✓', name);
}
console.log(`\nВсе сетевые проверки пройдены: ${passed}`);
