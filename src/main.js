import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker, drawHands } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { KeyboardControl } from './control/keyboard.js';
import { Track } from './game/track.js';
import { Renderer } from './game/renderer.js';
import { createPlayer, stepPlayer, tryNitro, STEP, KMH } from './game/physics.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camStatus = $('cam-status');
const debugEl = $('debug');

const camera = new Camera(video);
const tracker = new HandTracker();
const wheel = new Wheel();
const gestures = new GestureController(wheel);
const keyboard = new KeyboardControl();
const track = new Track();
const renderer = new Renderer($('game'));

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  hands: [],
  input: null,
  player: createPlayer(),
  lastFrame: performance.now(),
  acc: 0,
};

function drawPreview() {
  const w = (camCanvas.width = camCanvas.clientWidth * devicePixelRatio);
  const h = (camCanvas.height = camCanvas.clientHeight * devicePixelRatio);
  camCtx.fillStyle = '#000';
  camCtx.fillRect(0, 0, w, h);
  if (camera.ready) {
    camCtx.save();
    camCtx.translate(w, 0);
    camCtx.scale(-1, 1); // зеркалим видео, как в зеркале
    camCtx.drawImage(video, 0, 0, w, h);
    camCtx.restore();
  }
  drawHands(camCtx, app.hands, w, h, () => '#33e07a');
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
  if (input.nitro) tryNitro(app.player);

  // игровой цикл с фиксированным шагом, независимо от частоты кадров
  app.acc += dt;
  let steps = 0;
  while (app.acc >= STEP && steps < 6) {
    stepPlayer(app.player, input, STEP, track);
    app.acc -= STEP;
    steps++;
  }

  renderer.render({ track, player: app.player, bots: [], shake: app.player.shake });
  drawPreview();
  debugEl.textContent =
    `режим: ${app.mode}\n` +
    `скорость: ${Math.round(app.player.speed * KMH)} км/ч\n` +
    `steer: ${input.steer.toFixed(2)} газ: ${input.gas} тормоз: ${input.brake}\n` +
    `круг: ${app.player.lap}  x: ${app.player.x.toFixed(2)}`;
  requestAnimationFrame(frame);
}

function setMode(mode) {
  app.mode = mode;
  camStatus.textContent = mode === 'keyboard' ? 'Клавиатура: стрелки / WASD' : camStatus.textContent;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyK') setMode(app.mode === 'keyboard' ? 'gesture' : 'keyboard');
});

async function boot() {
  debugEl.classList.remove('hidden');
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
