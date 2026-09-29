import './style.css';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker, drawHands } from './vision/hands.js';

const video = document.getElementById('video');
const camCanvas = document.getElementById('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camStatus = document.getElementById('cam-status');

const camera = new Camera(video);
const tracker = new HandTracker();
let hands = [];

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
