import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker, drawHands } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';

const video = document.getElementById('video');
const camCanvas = document.getElementById('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camStatus = document.getElementById('cam-status');

const camera = new Camera(video);
const tracker = new HandTracker();
let hands = [];
const wheel = new Wheel();
const gestures = new GestureController(wheel);
wheel.startCalibration();
const debugEl = document.getElementById('debug');
debugEl.classList.remove('hidden');

function drawPreview() {
  const w = (camCanvas.width = camCanvas.clientWidth * devicePixelRatio);
  const h = (camCanvas.height = camCanvas.clientHeight * devicePixelRatio);
  if (camera.ready) {
    camCtx.save();
    camCtx.translate(w, 0);
    camCtx.scale(-1, 1); // зеркалим видео, как в зеркале
    camCtx.drawImage(video, 0, 0, w, h);
    camCtx.restore();
  }
  drawHands(camCtx, hands, w, h, () => '#33e07a');
}

function frame(now) {
  if (camera.ready) {
    const res = tracker.detect(video, now);
    if (res) hands = res;
    gestures.aspect = camera.width / camera.height;
    const g = gestures.update(hands, now);
    const f = (v) => (v == null ? '—' : v.toFixed(2));
    debugEl.textContent =
      `рук: ${g.handsVisible}\n` +
      `L: ${f(g.scoreL)} ${g.fistL ? 'КУЛАК' : 'ладонь'}\n` +
      `R: ${f(g.scoreR)} ${g.fistR ? 'КУЛАК' : 'ладонь'}\n` +
      `газ: ${g.gas}  тормоз: ${g.brake}\n` +
      `калибровка: ${(g.calibProgress * 100).toFixed(0)}%\n` +
      `угол: ${g.relDeg.toFixed(1)}°  steer: ${g.steer.toFixed(2)}\n` +
      `нитро: ${(g.nitroHold * 100).toFixed(0)}%  старт: ${(g.startHold * 100).toFixed(0)}%\n` +
      `ошибки: ${g.errors.map((e) => e.id).join(', ')}`;
  }
  drawPreview();
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    camStatus.textContent = 'Загружаю модель рук…';
    await tracker.init();
    camStatus.textContent = 'Запрашиваю камеру…';
    await camera.start();
    camStatus.textContent = `Камера ${camera.width}×${camera.height}, ${tracker.delegate}`;
  } catch (e) {
    console.error(e);
    camStatus.textContent = cameraErrorText(e);
  }
  requestAnimationFrame(frame);
}

boot();
