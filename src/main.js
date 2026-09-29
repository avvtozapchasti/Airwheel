import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Track } from './game/track.js';
import { Renderer } from './game/renderer.js';
import { createPlayer, stepPlayer, tryNitro, STEP, KMH } from './game/physics.js';
import { drawHud } from './game/hud.js';
import { createBots, updateBots, checkCollisions, racePosition } from './game/bots.js';
import { showResults } from './ui/results.js';
import { drawPreview } from './ui/preview.js';

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

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  hands: [],
  input: null,
  player: createPlayer(),
  bots: createBots(),
  raceTime: 0,
  place: 1,
  lastFrame: performance.now(),
  acc: 0,
  state: 'menu', // menu | countdown | race | paused | finished | results
  countdown: 0,
  finishTimer: 0,
  hint: null,
  lostT: 0, // сколько не видно обеих рук
  brightnessT: 0,
};

const IDLE = { steer: 0, gas: false, brake: false, nitro: false };

function newRace() {
  app.player = createPlayer();
  app.bots = createBots();
  app.raceTime = 0;
  app.acc = 0;
  app.countdown = 3;
  app.state = 'countdown';
  screenEl.classList.add('hidden');
  coach.reset();
  if (app.mode === 'gesture') coach.startRecording();
}

// Пауза: вручную (Esc/P) или автоматически, когда пропали обе руки.
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

function showMenu() {
  app.state = 'menu';
  screenEl.innerHTML = `
    <div class="card">
      <h1>AirWheel</h1>
      <p class="lead">Подними обе открытые ладони на 1 секунду или нажми «Старт».</p>
      <div class="row"><button class="btn primary" id="btn-start">Старт</button></div>
    </div>`;
  screenEl.classList.remove('hidden');
  $('btn-start').onclick = newRace;
}

function finishRace() {
  app.state = 'results';
  coach.stopRecording();
  const p = app.player;
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
    { onRetry: newRace },
  );
}

// Один шаг симуляции.
function simulate(input, dt) {
  if (app.state === 'countdown') {
    app.countdown -= dt;
    if (app.countdown <= 0) app.state = 'race';
    stepPlayer(app.player, IDLE, dt, track, false);
    return;
  }
  if (app.state === 'race' || app.state === 'finished') {
    app.countdown -= dt; // «ВПЕРЁД!» ещё немного висит после старта
    app.raceTime += dt;
    const events = stepPlayer(app.player, input, dt, track);
    updateBots(app.bots, app.player, track, dt, app.raceTime);
    checkCollisions(app.player, app.bots, track);
    if (events.includes('finish')) {
      app.place = racePosition(app.player, app.bots);
      app.state = 'finished';
      app.finishTimer = 2.5;
    }
    if (app.state === 'finished') {
      app.finishTimer -= dt;
      if (app.finishTimer <= 0) finishRace();
    }
    return;
  }
  // в меню и итогах машина просто стоит/докатывается
  stepPlayer(app.player, IDLE, dt, track, false);
}

function readInput(now, dt) {
  if (app.mode === 'keyboard') return keyboard.update(dt);
  if (camera.ready) {
    const res = tracker.detect(video, now);
    if (res) app.hands = res;
  }
  gestures.aspect = camera.width / camera.height;
  return gestures.update(app.hands, now);
}

function frame(now) {
  const dt = Math.min(0.1, (now - app.lastFrame) / 1000);
  app.lastFrame = now;

  const input = (app.input = readInput(now, dt));
  if (input.nitro && app.state === 'race') tryNitro(app.player);
  const startPressed = input.startTrigger || keyboard.has('Enter', 'Space');
  if (app.state === 'menu' && startPressed) newRace();
  else if (app.state === 'paused' && startPressed) resume();

  if (app.mode === 'gesture') {
    // яркость кадра — раз в секунду
    app.brightnessT -= dt;
    if (app.brightnessT <= 0) {
      app.brightnessT = 1;
      const b = camera.measureBrightness();
      if (b !== null) gestures.brightness = b;
    }
    // режим «Ошибка»: одна главная подсказка
    const straight = track.curveAhead(app.player.z, 20) < 0.5;
    app.hint = coach.update(input.errors, now / 1000, { straight });
    // обе руки пропали во время гонки — пауза с подсказкой
    app.lostT = input.handsVisible === 0 ? app.lostT + dt : 0;
    if (app.state === 'race' && app.lostT > 0.4) {
      pause('Руки пропали из кадра. Верни обе руки в центр кадра, на уровень груди.');
    }
  } else {
    app.hint = null;
  }
  const showHint = app.hint && ['countdown', 'race'].includes(app.state);
  if (showHint) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);
  // на паузе текущая подсказка показывается прямо в карточке
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

  renderer.render({ track, player: app.player, bots: app.bots, shake: app.player.shake });
  if (app.state !== 'menu') {
    drawHud(renderer.ctx, renderer.width, renderer.height, {
      player: app.player,
      input,
      position: app.player.finished ? app.place : racePosition(app.player, app.bots),
      total: app.bots.length + 1,
      keyboard: app.mode === 'keyboard',
      countdown: app.countdown > -0.8 ? app.countdown : null,
    });
  }
  drawPreview(camCanvas, camCtx, {
    video,
    cameraReady: camera.ready,
    hands: app.mode === 'gesture' ? app.hands : [],
    input,
    hint: app.hint,
    keyboard: app.mode === 'keyboard',
  });
  debugEl.textContent =
    `режим: ${app.mode}\n` +
    `скорость: ${Math.round(app.player.speed * KMH)} км/ч\n` +
    `steer: ${input.steer.toFixed(2)} газ: ${input.gas} тормоз: ${input.brake}\n` +
    `круг: ${app.player.lap}  x: ${app.player.x.toFixed(2)}\n` +
    `ошибки: ${(input.errors || []).map((e) => e.id + (e.hand ? ':' + e.hand : '')).join(', ')}\n` +
    `подсказка: ${app.hint ? app.hint.id : '—'}  яркость: ${Math.round(gestures.brightness)}`;
  requestAnimationFrame(frame);
}

function setMode(mode) {
  app.mode = mode;
  camStatus.textContent = mode === 'keyboard' ? 'Клавиатура: стрелки / WASD' : camStatus.textContent;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyK') setMode(app.mode === 'keyboard' ? 'gesture' : 'keyboard');
  if (e.code === 'Backquote') debugEl.classList.toggle('hidden'); // отладочная панель
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (app.state === 'paused') resume();
    else pause();
  }
});

// Доступ из консоли для отладки и проверки жюри.
window.airwheel = app;

async function boot() {
  showMenu();
  requestAnimationFrame(frame);
  try {
    camStatus.textContent = 'Загружаю модель рук…';
    await tracker.init();
    camStatus.textContent = 'Запрашиваю камеру…';
    await camera.start();
    wheel.startCalibration();
    camStatus.textContent = `Камера ${camera.width}×${camera.height}, ${tracker.delegate}`;
  } catch (e) {
    console.error(e);
    camStatus.textContent = cameraErrorText(e);
    setMode('keyboard');
  }
}

boot();
