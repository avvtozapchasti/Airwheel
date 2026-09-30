import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Graphics, hasWebGL2 } from './render/scene.js';
import { CameraRig } from './render/cameras.js';
import { World } from './render/world.js';
import { buildCarModel } from './render/carModel.js';
import { Track } from './game/track.js';
import { computeRacingLine } from './game/profile.js';
import { CARS } from './game/cars.js';
import { createCar, stepCar, placeCar, respawn, tryBoost, STEP, KMH, speedOf } from './game/physics.js';
import ALPINE from './game/tracks/alpine.js';
import { AudioEngine } from './game/audio.js';
import { formatTime } from './util/format.js';
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

const LAPS = 3;
const IDLE = { steer: 0, gas: false, brake: false, nitro: false };

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  state: 'onboarding', // onboarding | countdown | race | finished | results | paused
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
  countdown: 0,
  lastBeep: 4,
  assist: 0.65,
};

// ---------- трасса и машина ----------
const game = { track: null, line: null, spec: CARS.gt3, car: null, model: null };

function loadTrack(def) {
  const track = new Track(def);
  track.racingLine = computeRacingLine(track);
  world.load(track);
  game.track = track;
  if (game.model) {
    game.model.root.removeFromParent();
    game.model.dispose();
  }
  game.model = buildCarModel(game.spec, { color: 0xe89b00, player: true });
  gfx.scene.add(game.model.root);
  resetCar();
}

function resetCar() {
  const slot = game.track.gridSlot(0);
  game.car = createCar(game.spec, game.track, slot);
  game.race = { lap: 1, lapStart: 0, lapTimes: [], bestLap: null, time: 0, finished: false };
  rig.snap = true;
}

loadTrack(ALPINE);

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
function newRace() {
  resetCar();
  app.state = 'countdown';
  app.countdown = 3;
  app.lastBeep = 4;
  app.acc = 0;
  app.lostT = 0;
  screenEl.classList.add('hidden');
  coach.reset();
  if (app.mode === 'gesture') coach.startRecording();
}

function pause(reason) {
  if (app.state !== 'race' && app.state !== 'countdown') return;
  app.pausedFrom = app.state;
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
  app.state = app.pausedFrom || 'race';
  app.lostT = 0;
  screenEl.classList.add('hidden');
}

function finishRace() {
  app.state = 'results';
  coach.stopRecording();
  const r = game.race;
  screenEl.innerHTML = `
    <div class="card">
      <h1>🏁 Финиш</h1>
      <div class="stats">
        <div><span>Время</span><b>${formatTime(r.time)}</b></div>
        <div><span>Лучший круг</span><b>${formatTime(r.bestLap)}</b></div>
      </div>
      <p>Круги: ${r.lapTimes.map(formatTime).join(' · ')}</p>
      <div class="row"><button class="btn primary" id="btn-again">Ещё раз</button></div>
    </div>`;
  screenEl.classList.remove('hidden');
  $('btn-again').onclick = newRace;
}

// Один шаг симуляции (120 Гц).
function simulate(input, dt) {
  const car = game.car, tr = game.track, r = game.race;
  if (app.state === 'countdown') {
    app.countdown -= dt;
    const n = Math.ceil(app.countdown);
    if (n < app.lastBeep) {
      app.lastBeep = n;
      audio.countdownBeep(n <= 0);
    }
    if (app.countdown <= 0) app.state = 'race';
    stepCar(car, IDLE, dt, tr, { assist: app.assist, frozen: true });
    return;
  }
  if (app.state === 'race' || app.state === 'finished') {
    const control = r.finished ? { steer: 0, gas: false, brake: true } : input;
    const events = stepCar(car, control, dt, tr, { assist: app.assist });
    for (const e of events) {
      if (e.type === 'wall') audio.crash();
    }
    if (!r.finished) {
      r.time += dt;
      // круг: прогресс перешёл через очередную длину трассы
      const lapNow = Math.floor(car.progress / tr.length) + 1;
      if (lapNow > r.lap) {
        const t = r.time - r.lapStart;
        r.lapTimes.push(t);
        if (r.bestLap === null || t < r.bestLap) r.bestLap = t;
        r.lapStart = r.time;
        r.lap = lapNow;
        if (r.lap > LAPS) {
          r.finished = true;
          app.state = 'finished';
          app.finishT = 3;
          audio.finish();
        } else audio.lap();
      }
    }
    if (app.state === 'finished') {
      app.finishT -= dt;
      if (app.finishT <= 0) finishRace();
    }
    // застрял или развернулся — возвращаем на трассу
    if (car.stuckT > 3 || car.wrongWayT > 4) respawn(car, tr);
    return;
  }
  if (app.state === 'paused') return;
  stepCar(car, IDLE, dt, tr, { assist: app.assist, frozen: true });
}

function readInput(now, dt) {
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

const hudEl = $('hud-lite');
function tick(now, dt) {
  app.fpsFrames++;
  app.fpsT += dt;
  if (app.fpsT >= 1) {
    app.fps = app.fpsFrames / app.fpsT;
    app.fpsFrames = 0;
    app.fpsT = 0;
  }
  const input = (app.input = readInput(now, dt));
  const car = game.car;
  if (input.nitro && app.state === 'race' && tryBoost(car)) audio.nitro();

  const typing = document.activeElement instanceof HTMLInputElement;
  const startPressed = input.startTrigger || (!typing && keyboard.has('Enter', 'Space'));
  if (app.state === 'paused' && startPressed) resume();
  else if (app.state === 'results' && input.startTrigger) newRace();
  else if (app.state === 'onboarding' && onboarding.step === 'start' && !typing && keyboard.has('Enter')) onboarding.h.onStart();

  if (app.mode === 'gesture' && camera.ready) {
    app.brightnessT -= dt;
    if (app.brightnessT <= 0) {
      app.brightnessT = 1;
      const b = camera.measureBrightness();
      if (b !== null) gestures.brightness = b;
    }
    const straight = Math.abs(game.track.kappa[car.idx]) < 1 / 400;
    app.hint = coach.update(input.errors, now / 1000, { straight });
    app.lostT = input.handsVisible === 0 ? app.lostT + dt : 0;
    if (app.state === 'race' && app.lostT > 0.4) pause('Руки пропали из кадра. Верни обе руки в центр кадра, на уровень груди.');
  } else app.hint = null;

  if (app.state === 'onboarding') {
    onboarding.update(input, dt, { brightness: camera.ready ? gestures.brightness : null, hint: app.hint });
  }
  const showHint = app.hint && ['countdown', 'race'].includes(app.state);
  if (showHint && coachEl.textContent !== app.hint.text) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);

  // физика с фиксированным шагом 120 Гц
  app.acc += dt;
  let steps = 0;
  while (app.acc >= STEP && steps < 12) {
    simulate(input, STEP);
    app.acc -= STEP;
    steps++;
  }
  if (steps === 12) app.acc = 0;
  const alpha = app.acc / STEP;

  // рендер с интерполяцией между шагами физики
  game.model.update(car, alpha);
  const pos = game.model.root.position;
  rig.update(dt, { pos, heading: game.model.root.rotation.y, pitch: car.pitch, roll: car.roll, speed: speedOf(car), vmax: game.spec.vmax, shake: car.shake, dims: game.spec.dims, s: car.s }, game.track);
  gfx.followSun(pos);
  world.update(gfx.camera.position);
  gfx.render();

  const racing = ['countdown', 'race', 'finished'].includes(app.state);
  audio.update(speedOf(car) / game.spec.vmax, car.abs && car.brake > 0.3, car.boostOn, racing);

  if (hudEl) {
    const r = game.race;
    const cd = app.state === 'countdown' ? `<div class="big">${Math.ceil(app.countdown)}</div>` : '';
    hudEl.innerHTML = racing
      ? `${cd}<b>${Math.round(speedOf(car) * KMH)}</b> км/ч · передача ${car.gear + 1} · круг ${Math.min(r.lap, LAPS)}/${LAPS} · ${formatTime(r.time - r.lapStart)} · лучший ${formatTime(r.bestLap)}`
      : '';
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
      `режим: ${app.mode}  состояние: ${app.state}  FPS: ${app.fps.toFixed(0)}\n` +
      `draw calls: ${info.calls}  треугольников: ${info.triangles}\n` +
      `v: ${Math.round(speedOf(car) * KMH)} км/ч  s: ${car.s.toFixed(0)}  d: ${car.d.toFixed(2)}  δ: ${car.delta.toFixed(3)}\n` +
      `недоворот: ${car.under.toFixed(2)}  снос: ${car.over.toFixed(2)}  ABS: ${car.abs}  пробукс: ${car.wheelspin}\n` +
      `steer: ${input.steer.toFixed(2)}  газ: ${input.gas}  тормоз: ${input.brake}`;
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

window.airwheel = { app, game, gfx, world, rig, keyboard, placeCar };

function boot() {
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  requestAnimationFrame(frame);
}

boot();
