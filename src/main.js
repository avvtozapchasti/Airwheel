import './style.css';
import * as THREE from 'three';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Graphics, hasWebGL2 } from './render/scene.js';
import { CameraRig } from './render/cameras.js';
import { buildRoad } from './render/trackMesh.js';
import * as TX from './render/textures.js';
import { Track } from './game/track.js';
import TEST_TRACK from './game/tracks/test.js';
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

const camera = new Camera(video);
const tracker = new HandTracker();
const wheel = new Wheel();
const gestures = new GestureController(wheel);
const keyboard = new KeyboardControl();
const coach = new Coach();

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  state: 'onboarding', // onboarding | demo | paused
  hands: [],
  input: null,
  lastFrame: performance.now(),
  lostT: 0,
  brightnessT: 0,
  trackerReady: null,
  lastVideoTime: -1,
  fps: 60,
  fpsFrames: 0,
  fpsT: 0,
  demoS: 0,
};

// ---------- 3D ----------
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

const gfx = new Graphics($('game'));
const rig = new CameraRig(gfx.camera);
const world = { track: null, group: null };

function loadTrack(def) {
  const track = new Track(def);
  const group = new THREE.Group();
  group.add(buildRoad(track));
  // временная земля под тестовой дорогой
  const g = TX.grass();
  g.map.repeat.set(200, 200);
  g.normalMap.repeat.set(200, 200);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ map: g.map, normalMap: g.normalMap, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = track.bounds.minY - 0.4;
  ground.receiveShadow = true;
  group.add(ground);
  gfx.scene.add(group);
  gfx.setEnvironment(def.env || {});
  world.track = track;
  world.group = group;
}

loadTrack(TEST_TRACK);

// ---------- онбординг ----------
const onboarding = new Onboarding(screenEl, {
  onEnableCamera: enableCamera,
  onKeyboard: () => {
    setMode('keyboard');
    onboarding.show('start', { keyboard: true });
  },
  onRetryCamera: () => onboarding.show('camera'),
  onCalibrate: () => wheel.startCalibration(),
  onStart: () => {
    onboarding.hide();
    app.state = 'demo';
  },
});

async function enableCamera() {
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

function readInput(now, dt) {
  if (app.mode === 'keyboard') return keyboard.update(dt);
  if (camera.ready && video.currentTime !== app.lastVideoTime) {
    app.lastVideoTime = video.currentTime;
    const res = tracker.detect(video, now);
    if (res) app.hands = res;
  }
  gestures.aspect = camera.width / camera.height || 4 / 3;
  return gestures.update(app.hands, now);
}

// Облёт тестовой трассы: точка едет по центру, камера — следом.
const demoTarget = { pos: new THREE.Vector3(), heading: 0, speed: 38, vmax: 78, dims: { length: 4.6 } };
function updateDemo(dt) {
  const tr = world.track;
  app.demoS = tr.wrapS(app.demoS + demoTarget.speed * dt);
  const p = tr.pointAt(app.demoS, 0);
  demoTarget.pos.set(p.x, p.y + 0.5, p.z);
  demoTarget.heading = tr.headingAt(app.demoS);
  demoTarget.s = app.demoS;
  rig.update(dt, demoTarget, tr);
  gfx.followSun(demoTarget.pos);
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

  if (app.mode === 'gesture' && camera.ready) {
    app.brightnessT -= dt;
    if (app.brightnessT <= 0) {
      app.brightnessT = 1;
      const b = camera.measureBrightness();
      if (b !== null) gestures.brightness = b;
    }
    app.hint = coach.update(input.errors, now / 1000, { straight: true });
  } else app.hint = null;

  if (app.state === 'onboarding') {
    onboarding.update(input, dt, { brightness: camera.ready ? gestures.brightness : null, hint: app.hint });
  }
  const showHint = app.hint && app.state === 'demo';
  if (showHint && coachEl.textContent !== app.hint.text) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);

  if (app.state !== 'paused') updateDemo(dt);
  gfx.render();

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
      `steer: ${input.steer.toFixed(2)}  газ: ${input.gas}  тормоз: ${input.brake}`;
  }
}

// ---------- кнопки и клавиши ----------
function toggleKeyboard() {
  if (app.mode === 'keyboard') {
    if (camera.ready) setMode('gesture');
    else if (app.state === 'onboarding') onboarding.show('camera');
  } else {
    setMode('keyboard');
    if (app.state === 'onboarding') onboarding.show('start', { keyboard: true });
  }
}

$('btn-kb').onclick = toggleKeyboard;
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyK') toggleKeyboard();
  if (e.code === 'KeyC') rig.next();
  if (e.code === 'Backquote') debugEl.classList.toggle('hidden');
});

window.airwheel = { app, gfx, world };

function boot() {
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  requestAnimationFrame(frame);
}

boot();
