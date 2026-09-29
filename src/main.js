import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Track } from './game/track.js';
import { Renderer } from './game/renderer.js';
import { createPlayer, stepPlayer, tryNitro, STEP, KMH, MAX_SPEED } from './game/physics.js';
import { drawHud } from './game/hud.js';
import { createBots, updateBots, checkCollisions, racePosition } from './game/bots.js';
import { AudioEngine } from './game/audio.js';
import { Effects } from './game/effects.js';
import { showResults } from './ui/results.js';
import { drawPreview } from './ui/preview.js';
import { Onboarding } from './ui/onboarding.js';
import { qualifies, addRecord, recordsTable, lastName } from './ui/leaderboard.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camStatus = $('cam-status');
const debugEl = $('debug');
const screenEl = $('screen');
const coachEl = $('coach');

const camera = new Camera(video);
const tracker = new HandTracker();
const wheel = new Wheel();
const gestures = new GestureController(wheel);
const keyboard = new KeyboardControl();
const coach = new Coach();
const track = new Track();
const renderer = new Renderer($('game'));
const audio = new AudioEngine();
const fx = new Effects();

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  state: 'onboarding', // onboarding | countdown | race | paused | finished | results
  hands: [],
  input: null,
  player: createPlayer(),
  bots: createBots(),
  raceTime: 0,
  place: 1,
  lastFrame: performance.now(),
  acc: 0,
  countdown: -1,
  lastBeep: 4,
  finishTimer: 0,
  hint: null,
  lostT: 0, // сколько не видно обеих рук
  brightnessT: 0,
  trackerReady: null,
  // производительность
  lastVideoTime: -1,
  fps: 60,
  fpsFrames: 0,
  fpsT: 0,
  slowSec: 0,
  perfLevel: 0, // 0 — полное качество; дальше: 640×480 → меньше пикселей canvas → детект через кадр
  frameNo: 0,
};

const IDLE = { steer: 0, gas: false, brake: false, nitro: false };

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
    setMode('gesture');
    camStatus.textContent = `Камера ${camera.width}×${camera.height} · ${tracker.delegate}`;
    return null;
  } catch (e) {
    console.warn(e);
    const msg = e?.name ? cameraErrorText(e) : 'Не удалось загрузить распознавание рук. Играй с клавиатуры.';
    camStatus.textContent = 'Камера недоступна';
    // Автоматически переключаемся на клавиатуру.
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
  app.player = createPlayer();
  app.bots = createBots();
  app.raceTime = 0;
  app.acc = 0;
  app.countdown = 3;
  app.lastBeep = 4;
  app.state = 'countdown';
  app.lostT = 0;
  fx.reset();
  screenEl.classList.add('hidden');
  coach.reset();
  if (app.mode === 'gesture') coach.startRecording();
}

// Пауза: вручную (Esc/P/кнопка) или автоматически, когда пропали обе руки.
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
  const p = app.player;
  const canSave = qualifies(p.totalTime);
  const extra = `
    <h2>Рекорды</h2>
    ${
      canSave
        ? `<p class="lead">Новый рекорд! Впиши имя:</p>
           <div class="name-row"><input id="rec-name" maxlength="16" placeholder="Твоё имя" value="${lastName().replace(/"/g, '')}" />
           <button class="btn primary" id="rec-save">Сохранить</button></div>`
        : ''
    }
    <div id="rec-table">${recordsTable()}</div>
    ${app.mode === 'gesture' ? '<p>Подними обе ладони на 1 секунду — и сразу новый заезд.</p>' : ''}`;
  showResults(
    screenEl,
    {
      place: app.place,
      total: app.bots.length + 1,
      time: p.totalTime,
      bestLap: p.bestLap,
      lapTimes: p.lapTimes,
      coach: coach.summary(),
      keyboard: app.mode === 'keyboard',
    },
    {
      onRetry: newRace,
      onRecalibrate: app.mode === 'gesture' ? () => startOnboarding('calibrate') : null,
      extra,
    },
  );
  if (canSave) {
    const save = () => {
      const idx = addRecord($('rec-name').value, p.totalTime, { place: app.place, mode: app.mode });
      $('rec-table').innerHTML = recordsTable(idx);
      $('rec-save').closest('.name-row').remove();
    };
    $('rec-save').onclick = save;
    $('rec-name').onkeydown = (e) => e.key === 'Enter' && save();
  }
}

function startOnboarding(step) {
  app.state = 'onboarding';
  onboarding.show(step, { keyboard: app.mode === 'keyboard' });
}

// Один шаг симуляции с фиксированным dt.
function simulate(input, dt) {
  const p = app.player;
  if (app.state === 'countdown') {
    app.countdown -= dt;
    const n = Math.ceil(app.countdown);
    if (n < app.lastBeep) {
      app.lastBeep = n;
      audio.countdownBeep(n <= 0);
    }
    if (app.countdown <= 0) app.state = 'race';
    stepPlayer(p, IDLE, dt, track, false);
    return;
  }
  if (app.state === 'race' || app.state === 'finished') {
    app.countdown -= dt; // «ВПЕРЁД!» ещё немного висит после старта
    app.raceTime += dt;
    const events = stepPlayer(p, input, dt, track);
    updateBots(app.bots, p, track, dt, app.raceTime);
    if (checkCollisions(p, app.bots, track)) audio.crash();
    if (events.includes('lap')) audio.lap();
    if (events.includes('finish')) {
      app.place = racePosition(p, app.bots);
      app.state = 'finished';
      app.finishTimer = 2.5;
      audio.finish();
    }
    if (app.state === 'finished') {
      app.finishTimer -= dt;
      if (app.finishTimer <= 0) finishRace();
    }
    fx.update(dt, p);
    return;
  }
  if (app.state === 'paused') return;
  // онбординг и итоги: машина стоит/докатывается
  stepPlayer(p, IDLE, dt, track, false);
  fx.update(dt, p);
}

function readInput(now, dt) {
  if (app.mode === 'keyboard') return keyboard.update(dt);
  app.frameNo++;
  // Инференс только на новом кадре камеры (экран может быть 120 Гц, а камера — 30 к/с).
  const skip = app.perfLevel >= 3 && app.frameNo % 2 === 1;
  if (camera.ready && video.currentTime !== app.lastVideoTime && !skip) {
    app.lastVideoTime = video.currentTime;
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
    // Не даём одной ошибке остановить игровой цикл.
    console.error(e);
  }
}

// Если FPS держится ниже 24, по шагам снижаем нагрузку.
function monitorFps(dt) {
  app.fpsFrames++;
  app.fpsT += dt;
  if (app.fpsT < 1) return;
  app.fps = app.fpsFrames / app.fpsT;
  app.fpsFrames = 0;
  app.fpsT = 0;
  if (document.hidden) return;
  app.slowSec = app.fps < 24 ? app.slowSec + 1 : 0;
  if (app.slowSec >= 2 && app.perfLevel < 3) {
    app.slowSec = 0;
    app.perfLevel++;
    if (app.perfLevel === 1 && camera.ready) camera.downgrade(640, 480);
    if (app.perfLevel === 2) renderer.setQuality(0.7);
    console.info(`[airwheel] FPS ${app.fps.toFixed(0)}, уровень оптимизации ${app.perfLevel}`);
  }
}

function tick(now, dt) {
  monitorFps(dt);
  const input = (app.input = readInput(now, dt));
  const p = app.player;

  if (input.nitro && app.state === 'race' && tryNitro(p)) audio.nitro();
  const typing = document.activeElement instanceof HTMLInputElement;
  const startPressed = input.startTrigger || (!typing && keyboard.has('Enter', 'Space'));
  if (app.state === 'paused' && startPressed) resume();
  else if (app.state === 'results' && input.startTrigger) newRace();
  else if (app.state === 'onboarding' && onboarding.step === 'start' && !typing && keyboard.has('Enter')) onboarding.h.onStart();

  if (app.mode === 'gesture' && camera.ready) {
    // яркость кадра — раз в секунду
    app.brightnessT -= dt;
    if (app.brightnessT <= 0) {
      app.brightnessT = 1;
      const b = camera.measureBrightness();
      if (b !== null) gestures.brightness = b;
    }
    // режим «Ошибка»: одна главная подсказка
    const straight = track.curveAhead(p.z, 20) < 0.5;
    app.hint = coach.update(input.errors, now / 1000, { straight });
    // обе руки пропали во время гонки — пауза с подсказкой
    app.lostT = input.handsVisible === 0 ? app.lostT + dt : 0;
    if (app.state === 'race' && app.lostT > 0.4) {
      pause('Руки пропали из кадра. Верни обе руки в центр кадра, на уровень груди.');
    }
  } else {
    app.hint = null;
  }

  if (app.state === 'onboarding') {
    onboarding.update(input, dt, { brightness: camera.ready ? gestures.brightness : null, hint: app.hint });
  }

  const showHint = app.hint && ['countdown', 'race'].includes(app.state);
  if (showHint && coachEl.textContent !== app.hint.text) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);
  if (app.state === 'paused' && app.hint) {
    const el = $('pause-hint');
    if (el && el.textContent !== app.hint.text) el.textContent = app.hint.text;
  }

  // игровой цикл с фиксированным шагом, независимо от частоты кадров
  app.acc += dt;
  let steps = 0;
  while (app.acc >= STEP && steps < 6) {
    simulate(input, STEP);
    app.acc -= STEP;
    steps++;
  }
  if (steps === 6) app.acc = 0;

  const racing = ['countdown', 'race', 'finished'].includes(app.state);
  audio.update(p.speed / MAX_SPEED, p.braking, p.nitroT > 0, racing);

  renderer.render({ track, player: p, bots: app.bots, shake: p.shake, fx });
  if (racing || app.state === 'paused') {
    drawHud(renderer.ctx, renderer.width, renderer.height, {
      player: p,
      input,
      position: p.finished ? app.place : racePosition(p, app.bots),
      total: app.bots.length + 1,
      keyboard: app.mode === 'keyboard',
      countdown: app.countdown > -0.8 ? app.countdown : null,
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
    const f = (v) => (v == null ? '—' : v.toFixed(2));
    debugEl.textContent =
      `режим: ${app.mode}  состояние: ${app.state}  FPS: ${app.fps.toFixed(0)}  опт: ${app.perfLevel}\n` +
      `скорость: ${Math.round(p.speed * KMH)} км/ч  x: ${p.x.toFixed(2)}\n` +
      `steer: ${input.steer.toFixed(2)}  газ: ${input.gas}  тормоз: ${input.brake}\n` +
      `fist L: ${f(input.scoreL)}  R: ${f(input.scoreR)}  угол: ${f(input.relDeg)}°\n` +
      `ошибки: ${(input.errors || []).map((e) => e.id + (e.hand ? ':' + e.hand : '')).join(', ')}\n` +
      `подсказка: ${app.hint ? app.hint.id : '—'}  яркость: ${Math.round(gestures.brightness)}`;
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
    else if (app.state === 'onboarding' || app.state === 'results') startOnboarding('camera');
  } else {
    setMode('keyboard');
    if (app.state === 'onboarding') onboarding.show('start', { keyboard: true });
  }
}

$('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
$('btn-mute').onclick = toggleMute;
$('btn-kb').onclick = toggleKeyboard;
$('btn-pause').onclick = () => (app.state === 'paused' ? resume() : pause());

// Тач-кнопки: те же флаги, что и клавиатура.
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
  if (e.code === 'Backquote') debugEl.classList.toggle('hidden'); // отладочная панель
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (app.state === 'paused') resume();
    else pause();
  }
});

// Вкладка скрыта — ставим паузу, чтобы не проиграть гонку вслепую.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('Игра на паузе, пока вкладка скрыта.');
});

// Доступ из консоли для отладки и проверки жюри.
window.airwheel = app;

function boot() {
  // Модель рук начинаем грузить сразу, пока игрок читает первый экран.
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  requestAnimationFrame(frame);
}

boot();
