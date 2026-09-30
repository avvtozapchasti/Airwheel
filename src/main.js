import './style.css';
import * as THREE from 'three';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Graphics, hasWebGL2 } from './render/scene.js';
import { CameraRig, FlyScript } from './render/cameras.js';
import { World } from './render/world.js';
import { buildCarModel } from './render/carModel.js';
import { Track } from './game/track.js';
import { computeRacingLine, speedProfile, brakingPoints } from './game/profile.js';
import { CARS } from './game/cars.js';
import { tryBoost, STEP, KMH, speedOf } from './game/physics.js';
import { RaceSession } from './game/session.js';
import { createBots } from './game/bots.js';
import { DriveAnalyzer } from './game/analyzer.js';
import { autopilotInput } from './game/autopilot.js';
import ALPINE from './game/tracks/alpine.js';
import { AudioEngine } from './game/audio.js';
import { formatLap } from './util/format.js';
import { Hud } from './ui/hud.js';
import { showResults } from './ui/results.js';
import { drawPreview } from './ui/preview.js';
import { Onboarding } from './ui/onboarding.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camStatus = $('cam-status');
const debugEl = $('debug');
const screenEl = $('screen');
const coachEl = $('coach');

// ---------- WebGL2 ----------
if (!hasWebGL2()) {
  document.body.innerHTML = `
    <div class="screen"><div class="card">
      <h1>Нужен WebGL2</h1>
      <p class="lead">Браузер не поддерживает WebGL2, без него 3D-гонка не запустится.</p>
      <p>Обнови браузер (Chrome, Edge, Firefox, Safari 15+) или включи аппаратное ускорение в настройках.</p>
      <div class="row"><button class="btn primary" onclick="location.reload()">Перезагрузить</button></div>
    </div></div>`;
  throw new Error('WebGL2 недоступен');
}

const camera = new Camera(video);
const tracker = new HandTracker();
const wheel = new Wheel();
const gestures = new GestureController(wheel);
const keyboard = new KeyboardControl();
const coach = new Coach();
const audio = new AudioEngine();
const gfx = new Graphics($('game'));
const rig = new CameraRig(gfx.camera);
const world = new World(gfx);
const hud = new Hud($('hud'));

const IDLE = { steer: 0, gas: false, brake: false, nitro: false };

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  state: 'onboarding', // onboarding | racing | results | paused
  hands: [],
  input: IDLE,
  lastFrame: performance.now(),
  acc: 0,
  lostT: 0,
  brightnessT: 0,
  trackerReady: null,
  lastVideoTime: -1,
  lastDetect: 0,
  detectHz: 30,
  fps: 60,
  fpsFrames: 0,
  fpsT: 0,
  hint: null,
  settings: { laps: 3, assist: 0.65, cls: 'gt3', track: ALPINE, difficulty: 'medium' },
};
const URLP = new URLSearchParams(location.search);
if (URLP.has('laps')) app.settings.laps = Math.max(1, Math.min(10, +URLP.get('laps') || 3));

// ---------- трасса, класс, данные для коуча ----------
const game = { track: null, spec: null, prof: null, bps: null, session: null, model: null, analyzer: null, botModels: [] };

function loadTrack(def, clsId) {
  const track = new Track(def);
  track.racingLine = computeRacingLine(track);
  world.load(track);
  hud.setTrack(track);
  game.track = track;
  setClass(clsId);
}

function setClass(clsId) {
  game.spec = CARS[clsId];
  game.prof = speedProfile(game.track, game.track.racingLine, game.spec);
  game.bps = brakingPoints(game.track, game.prof);
  if (game.model) {
    game.model.root.removeFromParent();
    game.model.dispose();
  }
  game.model = buildCarModel(game.spec, { color: 0xe89b00, player: true });
  gfx.scene.add(game.model.root);
}

loadTrack(app.settings.track, app.settings.cls);

// ---------- онбординг ----------
const onboarding = new Onboarding(screenEl, {
  onEnableCamera: enableCamera,
  onKeyboard: () => {
    audio.init();
    setMode('keyboard');
    onboarding.show('start', { keyboard: true });
  },
  onRetryCamera: () => onboarding.show('camera'),
  onCalibrate: () => wheel.startCalibration(),
  onStart: () => {
    audio.init();
    onboarding.hide();
    newRace();
  },
  onTick: () => audio.ok(),
});

async function enableCamera() {
  audio.init();
  try {
    camStatus.textContent = 'Загружаю модель рук…';
    await app.trackerReady;
    camStatus.textContent = 'Запрашиваю камеру…';
    await camera.start(1280, 720);
    if (onboarding.step === 'camera') setMode('gesture');
    camStatus.textContent = `Камера ${camera.width}×${camera.height} · ${tracker.delegate}`;
    return null;
  } catch (e) {
    console.warn(e);
    const msg = e?.name ? cameraErrorText(e) : 'Не удалось загрузить распознавание рук. Играй с клавиатуры.';
    camStatus.textContent = 'Камера недоступна';
    setMode('keyboard');
    onboarding.show('start', { keyboard: true, error: msg });
    return msg;
  }
}

function setMode(mode) {
  app.mode = mode;
  $('btn-kb').classList.toggle('on', mode === 'keyboard');
  document.body.classList.toggle('kb-mode', mode === 'keyboard');
  if (mode === 'keyboard') camStatus.textContent = 'Клавиатура: стрелки / WASD';
  else if (camera.ready) camStatus.textContent = `Камера ${camera.width}×${camera.height} · ${tracker.delegate}`;
}

// ---------- гонка ----------
function clearBotModels() {
  for (const m of game.botModels) {
    m.root.removeFromParent();
    m.dispose();
  }
  game.botModels = [];
}

function newRace() {
  const st = app.settings;
  const bots = createBots(11, game.spec, game.track, { difficulty: st.difficulty, bps: game.bps });
  // этап без квалификации: боты по темпу, игрок — седьмым
  const order = [...bots].sort((x, y) => y.pace - x.pace);
  order.splice(6, 0, 'player');
  clearBotModels();
  for (const b of bots) {
    const m = buildCarModel(game.spec, { color: b.color });
    m.bot = b;
    gfx.scene.add(m.root);
    game.botModels.push(m);
  }
  game.session = new RaceSession({
    track: game.track,
    spec: game.spec,
    laps: st.laps,
    assist: st.assist,
    player: { name: 'Ты', code: 'ТЫ', color: '#ffb000' },
    onEvent: onSessionEvent,
  });
  game.session.start(order);
  game.analyzer = new DriveAnalyzer(game.track, game.prof, game.bps, game.spec);
  app.state = 'racing';
  app.acc = 0;
  app.lostT = 0;
  rig.snap = true;
  rig.script = gridFlyover(game.session);
  screenEl.classList.add('hidden');
  hud.show(true);
  hud.setLights(0);
  coach.reset();
  coach.startRecording();
}

// Панорама решётки: от первых рядов вдоль машин к игроку.
function gridFlyover(S) {
  const tr = game.track;
  const P = (s, d, h) => {
    const p = tr.pointAt(s, d);
    return new THREE.Vector3(p.x, p.y + h, p.z);
  };
  const ps = S.player.slot.s;
  const keys = [
    { t: 0, pos: P(25, -tr.hw[0] - 6, 7), look: P(-20, 0, 0), fov: 50 },
    { t: 1.6, pos: P(-40, tr.hw[0] + 5, 5), look: P(-60, 0, 0), fov: 55 },
    { t: 3.2, pos: P(ps - 9, 0, 2.6), look: P(ps + 8, 0, 0.8), fov: 60 },
  ];
  return new FlyScript(keys, { onEnd: () => (rig.script = null) });
}

function onSessionEvent(e) {
  switch (e.type) {
    case 'light':
      hud.setLights(e.n);
      audio.countdownBeep(false);
      break;
    case 'go':
      hud.setLights(0, true);
      setTimeout(() => hud.setLights(0), 900);
      audio.countdownBeep(true);
      break;
    case 'overtake':
      hud.message(`Обгон! P${e.pos}`, 'good', 1.6);
      break;
    case 'contact':
      audio.crash();
      break;
    case 'wall':
      if (e.entry?.isPlayer) audio.crash();
      break;
    case 'lap':
      if (e.best && e.lap > 0) {
        hud.message(`${e.fastest ? 'Лучший круг гонки' : 'Лучший круг'} · ${formatLap(e.time)}`, e.fastest ? 'purple' : 'good');
        audio.lap();
      } else {
        hud.message(`Круг ${e.lap} · ${formatLap(e.time)}`);
        audio.lap();
      }
      break;
    case 'penalty':
      hud.message(e.reason === 'wall' ? `Удар о стену: +${e.sec} с` : e.reason === 'cut' ? `Срезка: +${e.sec} с` : `Фальстарт: +${e.sec} с`, 'bad', 2.5);
      break;
    case 'respawn':
      hud.message('Возврат на трассу', 'info', 1.5);
      break;
    case 'finish':
      hud.big('ФИНИШ!', 'gold');
      audio.finish();
      break;
    case 'done':
      finishRace();
      break;
  }
}

function pause(reason) {
  if (app.state !== 'racing') return;
  app.state = 'paused';
  const how =
    app.mode === 'gesture'
      ? 'Подними обе открытые ладони к камере на 1 секунду, чтобы продолжить.'
      : 'Нажми Enter или пробел, чтобы продолжить.';
  screenEl.innerHTML = `
    <div class="card">
      <h1>⏸ Пауза</h1>
      <p class="lead" id="pause-hint">${reason || ''}</p>
      <p>${how}</p>
      <div class="row">
        <button class="btn primary" id="btn-resume">Продолжить</button>
        <button class="btn" id="btn-restart">Заново</button>
      </div>
    </div>`;
  screenEl.classList.remove('hidden');
  $('btn-resume').onclick = resume;
  $('btn-restart').onclick = newRace;
}

function resume() {
  if (app.state !== 'paused') return;
  app.state = 'racing';
  app.lostT = 0;
  screenEl.classList.add('hidden');
}

function finishRace() {
  app.state = 'results';
  coach.stopRecording();
  hud.big('');
  hud.show(false);
  coachEl.classList.remove('show');
  const S = game.session, p = S.player, t = p.timing;
  const rows = S.results();
  const me = rows.find((r) => r.player);
  showResults(
    screenEl,
    {
      subtitle: `${game.track.name} · ${game.spec.name} · ${S.laps} круг(а)`,
      place: me.pos,
      total: rows.length,
      time: me.time,
      bestLap: t.bestLap,
      lapTimes: t.lapTimes,
      penalty: p.penalty,
      standings: rows,
      coach: coach.summary(),
      keyboard: app.mode === 'keyboard',
    },
    { onRetry: newRace },
  );
}

// ---------- ввод ----------
const AUTOPILOT = URLP.has('autopilot');

function readInput(now, dt) {
  if (AUTOPILOT && game.session?.playerCar) {
    const kb = keyboard.update(dt);
    if (game.session.state === 'grid') return { ...kb, gas: false, brake: true };
    return { ...kb, ...autopilotInput(game.session.playerCar, game.track, game.prof, game.spec, { assist: app.settings.assist }) };
  }
  if (app.mode === 'keyboard') return keyboard.update(dt);
  // инференс рук — не чаще detectHz и только на новом кадре камеры, отдельно от рендера
  if (camera.ready && video.currentTime !== app.lastVideoTime && now - app.lastDetect >= 1000 / app.detectHz - 2) {
    app.lastVideoTime = video.currentTime;
    app.lastDetect = now;
    const res = tracker.detect(video, now);
    if (res) app.hands = res;
  }
  gestures.aspect = camera.width / camera.height || 4 / 3;
  return gestures.update(app.hands, now);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - app.lastFrame) / 1000));
  app.lastFrame = now;
  try {
    tick(now, dt);
  } catch (e) {
    console.error(e);
  }
}

function tick(now, dt) {
  app.fpsFrames++;
  app.fpsT += dt;
  if (app.fpsT >= 1) {
    app.fps = app.fpsFrames / app.fpsT;
    app.fpsFrames = 0;
    app.fpsT = 0;
  }
  const input = (app.input = readInput(now, dt));
  const S = game.session;
  const racing = app.state === 'racing' && S;
  const car = S?.playerCar;
  if (racing && input.nitro && S.state === 'race' && tryBoost(car)) audio.nitro();

  const typing = document.activeElement instanceof HTMLInputElement;
  const startPressed = input.startTrigger || (!typing && keyboard.has('Enter', 'Space'));
  if (app.state === 'paused' && startPressed) resume();
  else if (app.state === 'results' && input.startTrigger) newRace();
  else if (app.state === 'onboarding' && onboarding.step === 'start' && !typing && keyboard.has('Enter')) onboarding.h.onStart();

  // физика с фиксированным шагом 120 Гц
  const physEvents = [];
  if (racing) {
    app.acc += dt;
    let steps = 0;
    while (app.acc >= STEP && steps < 12) {
      S.step(STEP, input);
      if (S.lastPhysics?.length) physEvents.push(...S.lastPhysics);
      app.acc -= STEP;
      steps++;
    }
    if (steps === 12) app.acc = 0;
  }

  // режим «Ошибка»: ошибки жестов + ошибки езды (по трассе)
  const errors = [];
  if (app.mode === 'gesture' && camera.ready) {
    app.brightnessT -= dt;
    if (app.brightnessT <= 0) {
      app.brightnessT = 1;
      const b = camera.measureBrightness();
      if (b !== null) gestures.brightness = b;
    }
    errors.push(...input.errors);
  }
  if (racing && S.state === 'race' && !S.player.finished) {
    errors.push(...game.analyzer.update({ car, input, dt, events: physEvents, keyboard: app.mode === 'keyboard' }));
  }
  if (app.mode === 'gesture' && camera.ready || racing) {
    const straight = car ? Math.abs(game.track.kappa[car.idx]) < 1 / 400 : true;
    app.hint = coach.update(errors, now / 1000, { straight, keyboard: app.mode === 'keyboard' });
  } else app.hint = null;
  if (app.mode === 'gesture' && camera.ready) {
    app.lostT = input.handsVisible === 0 ? app.lostT + dt : 0;
    if (racing && S.state === 'race' && app.lostT > 0.4) pause('Руки пропали из кадра. Верни обе руки в центр кадра, на уровень груди.');
  }

  if (app.state === 'onboarding') {
    onboarding.update(input, dt, { brightness: camera.ready ? gestures.brightness : null, hint: app.hint });
  }
  const showHint = app.hint && racing;
  if (showHint && coachEl.textContent !== app.hint.text) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);

  // рендер с интерполяцией между шагами физики
  const alpha = app.acc / STEP;
  if (car) {
    game.model.update(car, alpha);
    const pos = game.model.root.position;
    rig.update(dt, { pos, heading: game.model.root.rotation.y, pitch: car.pitch, roll: car.roll, speed: speedOf(car), vmax: game.spec.vmax, shake: car.shake, dims: game.spec.dims, s: car.s }, game.track);
    gfx.followSun(pos);
  }
  for (const m of game.botModels) m.update(m.bot, alpha);
  world.update(gfx.camera.position);
  gfx.render();

  audio.update(car ? speedOf(car) / game.spec.vmax : 0, !!car && car.abs && car.brake > 0.3, !!car?.boostOn, !!racing);

  if (racing) {
    const p = S.player;
    if (S.state === 'grid' && S.phaseT < 0) hud.big('');
    const nb = S.neighbours();
    hud.update({
      dt,
      car,
      spec: game.spec,
      input,
      timing: p.timing,
      lapTime: S.lapTimeOf(p),
      lastLap: p.timing.lapTimes.at(-1)?.time,
      session: S.state === 'grid' ? 'Старт' : 'Гонка',
      pos: S.positionOf(p),
      total: S.entries.length,
      lap: p.timing.lap,
      laps: S.laps,
      neighbours: nb,
      tower: S.tower(),
      keyboard: app.mode === 'keyboard',
      cars: S.entries.map((e) => ({ x: e.isPlayer ? e.car.x : e.bot.x, z: e.isPlayer ? e.car.z : e.bot.z, color: e.color, player: e.isPlayer })),
    });
  }

  drawPreview(camCanvas, camCtx, {
    video,
    cameraReady: camera.ready && app.mode === 'gesture',
    hands: app.mode === 'gesture' ? app.hands : [],
    input,
    hint: app.hint,
    keyboard: app.mode === 'keyboard',
  });

  if (!debugEl.classList.contains('hidden')) {
    const info = gfx.renderer.info.render;
    debugEl.textContent =
      `режим: ${app.mode}  состояние: ${app.state}/${S?.state}  FPS: ${app.fps.toFixed(0)}\n` +
      `draw calls: ${info.calls}  треугольников: ${info.triangles}\n` +
      (car
        ? `v: ${Math.round(speedOf(car) * KMH)} км/ч  s: ${car.s.toFixed(0)}  d: ${car.d.toFixed(2)}  δ: ${car.delta.toFixed(3)}\n` +
          `недоворот: ${car.under.toFixed(2)}  снос: ${car.over.toFixed(2)}  ABS: ${car.abs}  пробукс: ${car.wheelspin}\n`
        : '') +
      `steer: ${input.steer.toFixed(2)}  газ: ${input.gas}  тормоз: ${input.brake}\n` +
      `ошибки: ${errors.map((e) => e.id).join(', ')}  подсказка: ${app.hint?.id ?? '—'}`;
  }
}

// ---------- кнопки и клавиши ----------
function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
}

function toggleKeyboard() {
  if (app.mode === 'keyboard') {
    if (camera.ready) setMode('gesture');
    else if (app.state === 'onboarding' || app.state === 'results') {
      app.state = 'onboarding';
      hud.show(false);
      onboarding.show('camera');
    }
  } else {
    setMode('keyboard');
    if (app.state === 'onboarding') onboarding.show('start', { keyboard: true });
  }
}

$('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
$('btn-mute').onclick = toggleMute;
$('btn-kb').onclick = toggleKeyboard;
$('btn-pause').onclick = () => (app.state === 'paused' ? resume() : pause());

document.querySelectorAll('#touch button').forEach((btn) => {
  const k = btn.dataset.k;
  const set = (on) => (e) => {
    e.preventDefault();
    btn.classList.toggle('active', on);
    if (k === 'nitro') {
      if (on) keyboard.queueNitro();
    } else keyboard.touch[k] = on;
    if (on) audio.init();
  };
  btn.addEventListener('pointerdown', set(true));
  btn.addEventListener('pointerup', set(false));
  btn.addEventListener('pointercancel', set(false));
  btn.addEventListener('pointerleave', set(false));
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyK') toggleKeyboard();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyC') rig.next();
  if (e.code === 'Backquote') debugEl.classList.toggle('hidden');
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (app.state === 'paused') resume();
    else pause();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('Игра на паузе, пока вкладка скрыта.');
});

window.addEventListener('error', (e) => console.error('[airwheel]', e.message));
window.addEventListener('unhandledrejection', (e) => {
  console.error('[airwheel]', e.reason);
  e.preventDefault();
});

window.airwheel = { app, game, gfx, world, rig, keyboard, hud };

function boot() {
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  requestAnimationFrame(frame);
}

boot();
