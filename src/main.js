import './style.css';
import * as THREE from 'three';
import { Camera, cameraErrorText } from './vision/camera.js';
import { HandTracker } from './vision/hands.js';
import { GestureController } from './control/gestures.js';
import { Wheel } from './control/wheel.js';
import { Coach } from './control/coach.js';
import { KeyboardControl } from './control/keyboard.js';
import { Graphics, hasWebGL2 } from './render/scene.js';
import { CameraRig, FlyScript, CAMERA_NAMES } from './render/cameras.js';
import { World } from './render/world.js';
import { buildCarModel } from './render/carModel.js';
import { Podium } from './render/podium.js';
import { QualityManager } from './render/quality.js';
import { Particles, emitFromCar, emitWallSparks } from './render/particles.js';
import { Track } from './game/track.js';
import { computeRacingLine, speedProfile, brakingPoints } from './game/profile.js';
import { CARS, CLASS_IDS } from './game/cars.js';
import { tryBoost, STEP, KMH, speedOf, placeCar } from './game/physics.js';
import { RaceSession } from './game/session.js';
import { QualiSession } from './game/quali.js';
import { createBots } from './game/bots.js';
import { DriveAnalyzer } from './game/analyzer.js';
import { autopilotInput } from './game/autopilot.js';
import { TRACKS, TRACK_BY_ID } from './game/tracks/index.js';
import { AudioEngine } from './game/audio.js';
import { formatLap, formatTime, esc, plural } from './util/format.js';
import { Hud } from './ui/hud.js';
import { Menu, ASSIST } from './ui/menu.js';
import { showResults } from './ui/results.js';
import { drawPreview } from './ui/preview.js';
import { Onboarding } from './ui/onboarding.js';
import { loadSettings, saveSettings, saveRecord } from './ui/leaderboard.js';

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
const podium = new Podium();
const fx = new Particles(gfx.scene);
fx.setViewport(gfx.height);
window.addEventListener('resize', () => fx.setViewport(gfx.height));

const IDLE = { steer: 0, gas: false, brake: false, nitro: false, errors: [] };
let lodScale = 1;
// Пресеты графики: всё, что можно поменять на лету, применяется сразу; плотность объектов —
// при следующей загрузке трассы.
const quality = new QualityManager({
  apply: (p) => {
    gfx.setQuality(p);
    gfx.applyFar();
    world.setRealLights(p.realLights);
    lodScale = p.lodScale;
    fx.setBudget(p.id === 'low' ? 0.4 : p.id === 'medium' ? 0.75 : 1);
    // вызывается после объявления app и game (quality.setMode ниже)
    for (const m of [game.model, ...game.botModels]) m?.setLodScale(p.lodScale);
    app.detectHz = p.id === 'low' ? 24 : 30;
  },
  onAuto: (p, fps) => hud.message(`Графика: ${p.name.toLowerCase()} (FPS ${Math.round(fps)})`, 'info', 2.5),
});
const PLAYER = { name: 'Ты', code: 'ТЫ', color: '#ffb000' };
const URLP = new URLSearchParams(location.search);
const AUTOPILOT = URLP.has('autopilot');

const settings = loadSettings({ trackId: TRACKS[0].id, cls: 'gt3', laps: 3, assist: 'medium', difficulty: 'medium', graphics: 'auto' });
if (!TRACK_BY_ID[settings.trackId]) settings.trackId = TRACKS[0].id;
if (!CARS[settings.cls]) settings.cls = 'gt3';
if (URLP.has('laps')) settings.laps = Math.max(1, Math.min(10, +URLP.get('laps') || 3));
if (URLP.has('track') && TRACK_BY_ID[URLP.get('track')]) settings.trackId = URLP.get('track');
if (URLP.has('class') && CARS[URLP.get('class')]) settings.cls = URLP.get('class');
if (URLP.has('graphics')) settings.graphics = URLP.get('graphics');

const app = {
  mode: 'gesture', // 'gesture' | 'keyboard'
  // onboarding | menu | quali | quali-results | race | results | paused
  state: 'onboarding',
  format: 'weekend', // 'weekend' — квала + гонка, 'race' — сразу гонка
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
};

// ---------- трасса, класс, соперники ----------
const game = {
  track: null,
  trackId: null,
  spec: null,
  prof: null,
  bps: null,
  session: null,
  model: null,
  analyzer: null,
  bots: [],
  botModels: [],
  grid: null,
};

function loadTrack(id) {
  if (game.trackId === id && game.track) return;
  const track = new Track(TRACK_BY_ID[id]);
  track.racingLine = computeRacingLine(track);
  world.load(track, quality.current);
  game.density = quality.current.density;
  hud.setTrack(track);
  game.track = track;
  game.trackId = id;
  game.spec = null;
}

function setClass(clsId) {
  if (game.spec?.id === clsId && game.prof) return;
  game.spec = CARS[clsId];
  game.prof = speedProfile(game.track, game.track.racingLine, game.spec);
  game.bps = brakingPoints(game.track, game.prof);
  if (game.model) {
    game.model.root.removeFromParent();
    game.model.dispose();
  }
  game.model = buildCarModel(game.spec, { color: 0xffb000, player: true });
  game.model.setLodScale(lodScale);
  gfx.scene.add(game.model.root);
  world.attachHeadlight(game.model);
}

function prepare() {
  if (game.density !== quality.current.density) game.trackId = null; // другой пресет — перестроить
  loadTrack(settings.trackId);
  setClass(settings.cls);
}

function clearBots() {
  for (const m of game.botModels) {
    m.root.removeFromParent();
    m.dispose();
  }
  game.botModels = [];
  game.bots = [];
}

function spawnBots() {
  clearBots();
  game.bots = createBots(11, game.spec, game.track, { difficulty: settings.difficulty, bps: game.bps });
  for (const b of game.bots) {
    const m = buildCarModel(game.spec, { color: b.color });
    m.setLodScale(lodScale);
    m.bot = b;
    game.botModels.push(m);
  }
}

function showBots(on) {
  for (const m of game.botModels) {
    if (on && !m.root.parent) gfx.scene.add(m.root);
    if (!on) m.root.removeFromParent();
  }
}

quality.setMode(settings.graphics);
prepare();

// ---------- онбординг и меню ----------
const onboarding = new Onboarding(screenEl, {
  onEnableCamera: enableCamera,
  onKeyboard: () => {
    audio.init();
    setMode('keyboard');
    openMenu();
  },
  onRetryCamera: () => onboarding.show('camera'),
  onCalibrate: () => wheel.startCalibration(),
  onMenu: () => openMenu(),
  onStart: () => openMenu(),
  onTick: () => audio.ok(),
});

const menu = new Menu(screenEl, {
  tracks: TRACKS,
  classes: CLASS_IDS.map((id) => CARS[id]),
  onChange: (s) => {
    saveSettings(s);
    if (quality.mode !== s.graphics) quality.setMode(s.graphics);
  },
  onStart: (format) => {
    audio.init();
    startWeekend(format);
  },
  onCamera: () => {
    menu.hide();
    app.state = 'onboarding';
    onboarding.show('camera');
  },
  onCalibrate: () => {
    menu.hide();
    app.state = 'onboarding';
    onboarding.show('calibrate');
  },
});

function openMenu(message = '') {
  app.state = 'menu';
  game.session = null;
  hud.show(false);
  coachEl.classList.remove('show');
  screenEl.classList.remove('podium-mode');
  menu.show(settings, { keyboard: app.mode === 'keyboard', message });
  prepare();
  showBots(false);
  // на фоне меню — медленный облёт трассы
  rig.script = trackFlyover();
}

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
    openMenu(msg);
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

// ---------- уик-энд: квалификация → решётка → гонка → итоги ----------
function startWeekend(format) {
  app.format = format;
  menu.hide();
  screenEl.classList.remove('podium-mode');
  screenEl.innerHTML = '<div class="card loading"><h1>Загрузка трассы…</h1></div>';
  screenEl.classList.remove('hidden');
  // даём браузеру отрисовать «Загрузка…», потом строим трассу
  setTimeout(() => {
    try {
      prepare();
      spawnBots();
      if (format === 'weekend') startQuali();
      else {
        // без квалификации: соперники по темпу, игрок восьмым
        const order = [...game.bots].sort((a, b) => b.pace - a.pace);
        order.splice(7, 0, 'player');
        game.grid = order;
        startRace();
      }
    } catch (e) {
      console.error(e);
      openMenu('Не удалось загрузить трассу. Попробуй ещё раз.');
    }
  }, 30);
}

function beginSession(S) {
  game.session = S;
  fx.clear();
  game.analyzer = new DriveAnalyzer(game.track, game.prof, game.bps, game.spec);
  app.acc = 0;
  app.lostT = 0;
  rig.snap = true;
  screenEl.classList.add('hidden');
  hud.show(true);
  hud.setLights(0);
  hud.big('');
  coach.reset();
  coach.startRecording();
}

function startQuali() {
  showBots(false);
  const S = new QualiSession({
    track: game.track,
    spec: game.spec,
    prof: game.prof,
    bots: game.bots,
    assist: ASSIST[settings.assist],
    player: PLAYER,
    onEvent: onSessionEvent,
  });
  S.start();
  beginSession(S);
  rig.script = null;
  app.state = 'quali';
  hud.message('Квалификация · 2 попытки', 'info', 2.5);
}

function startRace() {
  showBots(true);
  const S = new RaceSession({
    track: game.track,
    spec: game.spec,
    laps: settings.laps,
    assist: ASSIST[settings.assist],
    player: PLAYER,
    onEvent: onSessionEvent,
  });
  S.start(game.grid);
  beginSession(S);
  rig.script = gridFlyover(S);
  app.state = 'race';
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

// Фон меню: камера медленно летит вдоль трассы.
function trackFlyover() {
  const tr = game.track;
  let s = 0;
  const cam = new THREE.Vector3(), look = new THREE.Vector3();
  return {
    update(dt, c) {
      s = tr.wrapS(s + dt * 22);
      const p = tr.pointAt(s, tr.hw[tr.index(s)] + 16);
      const q = tr.pointAt(s + 60, 0);
      cam.set(p.x, p.y + 9, p.z);
      look.set(q.x, q.y + 1, q.z);
      c.position.lerp(cam, 0.05);
      c.lookAt(look);
      if (c.fov !== 55) {
        c.fov = 55;
        c.updateProjectionMatrix();
      }
    },
  };
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
      audio.crash(0.4 + e.speed * 0.1);
      break;
    case 'wall': {
      const car = game.session?.playerCar;
      if (e.entry?.isPlayer && car) {
        audio.crash(e.speed / 8);
        emitWallSparks(fx, car, e.side, e.total || e.speed);
      }
      break;
    }
    case 'scrape': {
      const car = game.session?.playerCar;
      if (car && Math.random() < 0.25) {
        emitWallSparks(fx, car, e.side, e.speed * 0.5);
        audio.scrape();
      }
      break;
    }
    case 'attempt':
      if (e.n > 1) hud.message(`Попытка ${e.n}`, 'info', 1.5);
      break;
    case 'invalid':
      hud.message('Круг аннулирован: срезка', 'bad', 2.5);
      break;
    case 'lap':
      audio.lap();
      if (!e.valid) hud.message(`Круг не засчитан · ${formatLap(e.time)}`, 'bad');
      else if (e.best && (e.fastest || e.overallBest)) hud.message(`${app.state === 'quali' ? 'Лучший круг сессии' : 'Лучший круг гонки'} · ${formatLap(e.time)}`, 'purple');
      else if (e.best && e.lap > 0) hud.message(`Лучший круг · ${formatLap(e.time)}`, 'good');
      else hud.message(`Круг ${e.lap} · ${formatLap(e.time)}`);
      break;
    case 'penalty':
      hud.message(e.reason === 'wall' ? `Удар о стену: +${e.sec} с` : e.reason === 'cut' ? `Срезка: +${e.sec} с` : `Фальстарт: +${e.sec} с`, 'bad', 2.5);
      break;
    case 'respawn':
      hud.message('Возврат на трассу', 'info', 1.5);
      break;
    case 'quali-end':
      hud.big('КВАЛИФИКАЦИЯ', 'gold');
      break;
    case 'finish':
      hud.big('ФИНИШ!', 'gold');
      audio.finish();
      break;
    case 'done':
      if (app.state === 'quali') showQualiResults();
      else finishRace();
      break;
  }
}

function showQualiResults() {
  app.state = 'quali-results';
  coach.stopRecording();
  hud.big('');
  hud.show(false);
  coachEl.classList.remove('show');
  const S = game.session;
  const rows = S.results();
  if (S.best) saveRecord(game.trackId, game.spec.id, { quali: S.best, lap: S.best });
  game.grid = rows.map((r) => (r.player ? 'player' : r.bot));
  const me = rows.find((r) => r.player);
  const body = rows
    .map(
      (r) => `<tr class="${r.player ? 'me' : ''}"><td>${r.pos}</td><td><i class="swatch" style="background:${r.color}"></i>${esc(r.name)}${
        r.pos === 1 ? ' <span class="pole">ПОУЛ</span>' : ''
      }</td><td>${r.time != null ? formatLap(r.time) : 'нет времени'}</td><td>${r.gap != null ? '+' + r.gap.toFixed(3) : ''}</td></tr>`,
    )
    .join('');
  screenEl.innerHTML = `
    <div class="card wide">
      <p class="eyebrow">${esc(game.track.name)} · ${game.spec.name} · квалификация</p>
      <h1>${me.pos === 1 ? '🏆 Поул-позиция!' : `Старт с ${me.pos}-го места`}</h1>
      <p class="lead">${S.best ? `Твой лучший круг: <b>${formatLap(S.best)}</b>` : 'Засчитанного круга нет — стартуешь последним.'}</p>
      <div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Пилот</th><th>Круг</th><th>Отставание</th></tr></thead><tbody>${body}</tbody></table></div>
      ${app.mode === 'gesture' ? '<div class="meter"><span>На старт 🙌</span><div class="bar"><b id="q-start"></b></div><em>ладони 1 с</em></div>' : ''}
      <div class="row">
        <button class="btn primary" id="q-go">🏁 На решётку</button>
        <button class="btn" id="q-again">Ещё раз квалификацию</button>
        <button class="btn" id="q-menu">В меню</button>
      </div>
    </div>`;
  screenEl.classList.remove('hidden');
  $('q-go').onclick = startRace;
  $('q-again').onclick = startQuali;
  $('q-menu').onclick = () => openMenu();
}

function finishRace() {
  app.state = 'results';
  coach.stopRecording();
  hud.big('');
  hud.show(false);
  coachEl.classList.remove('show');
  rig.script = null;
  const S = game.session, p = S.player, t = p.timing;
  const rows = S.results();
  const me = rows.find((r) => r.player);
  const improved = saveRecord(game.trackId, game.spec.id, { lap: t.bestLap, finish: me.pos, time: me.time, laps: S.laps });
  const badges = [improved.includes('lap') && 'новый рекорд круга', improved.includes('finish') && 'лучший финиш на трассе'].filter(Boolean);
  // подиум: три лучших машины
  podium.show(
    rows.slice(0, 3).map((r) => ({ spec: game.spec, color: r.color })),
    gfx.scene.environment,
  );
  screenEl.classList.add('podium-mode');
  showResults(
    screenEl,
    {
      subtitle: `${game.track.name} · ${game.spec.name} · ${S.laps} ${plural(S.laps, 'круг', 'круга', 'кругов')}`,
      place: me.pos,
      total: rows.length,
      time: me.time,
      bestLap: t.bestLap,
      lapTimes: t.lapTimes,
      penalty: p.penalty,
      standings: rows,
      coach: coach.summary(),
      keyboard: app.mode === 'keyboard',
      extra: badges.length ? `<p class="record">★ ${badges.join(' · ')}</p>` : '',
    },
    {
      onRetry: () => startWeekend(app.format),
      onMenu: () => openMenu(),
    },
  );
}

// ---------- пауза ----------
function pause(reason) {
  if (app.state !== 'race' && app.state !== 'quali') return;
  app.pausedFrom = app.state;
  app.state = 'paused';
  const how =
    app.mode === 'gesture'
      ? 'Подними обе открытые ладони к камере на 1 секунду, чтобы продолжить.'
      : 'Нажми Enter или пробел, чтобы продолжить.';
  const quali = app.pausedFrom === 'quali';
  screenEl.innerHTML = `
    <div class="card">
      <h1>⏸ Пауза</h1>
      <p class="lead" id="pause-hint">${reason || ''}</p>
      <p>${how}</p>
      <div class="row">
        <button class="btn primary" id="btn-resume">Продолжить</button>
        ${quali ? '<button class="btn" id="btn-endq">Завершить квалификацию</button>' : ''}
        <button class="btn" id="btn-restart">${quali ? 'Заново' : 'Рестарт гонки'}</button>
        <button class="btn" id="btn-menu">В меню</button>
      </div>
    </div>`;
  screenEl.classList.remove('hidden');
  $('btn-resume').onclick = resume;
  $('btn-restart').onclick = () => (quali ? startQuali() : startRace());
  $('btn-menu').onclick = () => openMenu();
  if (quali) {
    $('btn-endq').onclick = () => {
      app.state = 'quali';
      game.session.end();
    };
  }
}

function resume() {
  if (app.state !== 'paused') return;
  app.state = app.pausedFrom;
  app.lostT = 0;
  screenEl.classList.add('hidden');
}

// ---------- ввод ----------
function readInput(now, dt) {
  const S = game.session;
  if (AUTOPILOT && S?.playerCar && (app.state === 'race' || app.state === 'quali')) {
    const kb = keyboard.update(dt);
    if (S.state === 'grid') return { ...kb, gas: false, brake: true };
    return { ...kb, ...autopilotInput(S.playerCar, game.track, game.prof, game.spec, { assist: ASSIST[settings.assist] }) };
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
  const driving = (app.state === 'race' || app.state === 'quali') && S;
  const car = S?.playerCar;
  if (driving && input.nitro && (S.state === 'race' || app.state === 'quali') && tryBoost(car)) audio.nitro();

  // старт/продолжить: поднятые ладони или Enter
  const typing = document.activeElement instanceof HTMLInputElement;
  const enter = !typing && keyboard.has('Enter');
  if (app.state === 'paused' && (input.startTrigger || (!typing && keyboard.has('Enter', 'Space')))) resume();
  else if (app.state === 'menu') {
    menu.update(input);
    if (enter) menu.h.onStart('weekend');
  } else if (app.state === 'quali-results') {
    const b = $('q-start');
    if (b) b.style.width = `${Math.round((input.startHold || 0) * 100)}%`;
    if (input.startTrigger || enter) startRace();
  } else if (app.state === 'results' && input.startTrigger) startWeekend(app.format);

  quality.update(dt, !!driving);

  // физика с фиксированным шагом 120 Гц
  const physEvents = [];
  if (driving) {
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

  // режим «Ошибка»: ошибки жестов + ошибки езды по трассе
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
  const live = driving && (app.state === 'quali' ? S.state !== 'finishing' : S.state === 'race' && !S.player.finished);
  // на решётке при горящих огнях газ = фальстарт
  if (driving && app.state === 'race' && S.state === 'grid' && S.lights > 0 && input.gas) errors.push({ id: 'early_gas', hand: 'both' });
  if (live) {
    let aheadGap = Infinity;
    if (app.state === 'race') {
      for (const b of S.bots) {
        const g = game.track.deltaS(car.s, b.s);
        if (g > 0 && g < aheadGap && Math.abs(b.d - car.d) < 3) aheadGap = g;
      }
    }
    errors.push(...game.analyzer.update({ car, input, dt, events: physEvents, aheadGap, keyboard: app.mode === 'keyboard' }));
  }
  if ((app.mode === 'gesture' && camera.ready) || driving) {
    const straight = car ? Math.abs(game.track.kappa[car.idx]) < 1 / 400 : true;
    app.hint = coach.update(errors, now / 1000, { straight, keyboard: app.mode === 'keyboard' });
  } else app.hint = null;
  if (app.mode === 'gesture' && camera.ready && !AUTOPILOT) {
    app.lostT = input.handsVisible === 0 ? app.lostT + dt : 0;
    if (live && app.lostT > 0.4) pause('Руки пропали из кадра. Верни обе руки в центр кадра, на уровень груди.');
  }

  if (app.state === 'onboarding') {
    onboarding.update(input, dt, { brightness: camera.ready ? gestures.brightness : null, hint: app.hint });
  }
  const showHint = app.hint && driving;
  if (showHint && coachEl.textContent !== app.hint.text) coachEl.textContent = app.hint.text;
  coachEl.classList.toggle('show', !!showHint);
  if (app.state === 'paused' && app.hint) {
    const el = $('pause-hint');
    if (el && el.textContent !== app.hint.text) el.textContent = app.hint.text;
  }

  // ---------- рендер ----------
  const alpha = app.acc / STEP;
  if (app.state === 'results') {
    podium.update(dt, gfx.width / gfx.height);
    gfx.render(podium.scene, podium.camera);
  } else {
    if (car && (driving || app.state === 'paused')) {
      game.model.root.visible = true;
      game.model.update(car, alpha);
      const pos = game.model.root.position;
      rig.update(dt, { pos, heading: game.model.root.rotation.y, pitch: car.pitch, roll: car.roll, speed: speedOf(car), vmax: game.spec.vmax, shake: car.shake, dims: game.spec.dims, s: car.s }, game.track);
      gfx.followSun(pos);
    } else {
      game.model.root.visible = false;
      rig.update(dt, { pos: gfx.camera.position, heading: 0, speed: 0 }, game.track);
      gfx.followSun(gfx.camera.position);
    }
    for (const m of game.botModels) if (m.root.parent) m.update(m.bot, alpha);
    const showCars = driving || app.state === 'paused';
    world.update(gfx.camera.position, {
      dt,
      lodScale,
      focus: car && showCars ? car : { s: game.track.project(gfx.camera.position.x, gfx.camera.position.z, -1).s },
      bots: app.state === 'race' || (app.state === 'paused' && app.pausedFrom === 'race') ? game.bots : null,
    });
    gfx.setSpeedBlur(car && showCars ? Math.max(0, (speedOf(car) / game.spec.vmax - 0.55) * 1.6) : 0);
    gfx.render();
  }

  // звук: двигатель по оборотам, тормоза, занос, поребрик, ближайший соперник
  if (car && driving) {
    let nearest = null;
    if (app.state === 'race') {
      for (const b of S.bots) {
        const dx = b.x - car.x, dz = b.z - car.z;
        const dist = Math.hypot(dx, dz);
        if (!nearest || dist < nearest.dist) {
          // панорама: проекция на правую сторону камеры
          const right = Math.cos(car.psi) * -dx + Math.sin(car.psi) * dz;
          nearest = { dist, pan: (right / Math.max(4, dist)) * 1.2, speed: b.v };
        }
      }
    }
    audio.update({
      active: true,
      spec: game.spec,
      rpm: car.rpm,
      gear: car.gear,
      throttle: car.throttle,
      speed: speedOf(car),
      abs: car.abs && car.brake > 0.3,
      slide: Math.max(car.over, car.under * 0.6, car.wheelspin ? 0.6 : 0),
      kerb: car.onKerb,
      boost: car.boostOn,
      nearest,
    });
    emitFromCar(fx, car, game.track, dt, { wet: !!game.track.def.env?.wet, offType: game.track.def.env?.ground === 'sand' ? 'sand' : 'dust', f1: game.spec.id === 'f1' });
    // брызги за соперниками на мокром асфальте (только близкие к камере)
    if (game.track.def.env?.wet && app.state === 'race') {
      for (const b of S.bots) {
        if (b.v < 15 || Math.random() > dt * 18) continue;
        const dx = b.x - gfx.camera.position.x, dz = b.z - gfx.camera.position.z;
        if (dx * dx + dz * dz > 80 * 80) continue;
        const sp = Math.sin(b.psi), cp = Math.cos(b.psi);
        fx.emit('spray', b.x - sp * 1.8, b.y + 0.2, b.z - cp * 1.8, -sp * b.v * 0.2, 0.8, -cp * b.v * 0.2, 1.4);
      }
    }
  } else audio.update({ active: false });
  fx.update(app.state === 'paused' ? 0 : dt);

  if (driving && (app.state === 'race' || app.state === 'quali')) updateHud(S, car, input, dt);

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
      `режим: ${app.mode}  состояние: ${app.state}/${S?.state}  FPS: ${app.fps.toFixed(0)}  графика: ${quality.current.name}${quality.mode === 'auto' ? ' (авто)' : ''}\n` +
      `draw calls: ${info.calls}  треугольников: ${info.triangles}\n` +
      (car
        ? `v: ${Math.round(speedOf(car) * KMH)} км/ч  s: ${car.s.toFixed(0)}  d: ${car.d.toFixed(2)}  δ: ${car.delta.toFixed(3)}\n` +
          `недоворот: ${car.under.toFixed(2)}  снос: ${car.over.toFixed(2)}  ABS: ${car.abs}  пробукс: ${car.wheelspin}\n`
        : '') +
      `steer: ${input.steer.toFixed(2)}  газ: ${input.gas}  тормоз: ${input.brake}\n` +
      `ошибки: ${errors.map((e) => e.id).join(', ')}  подсказка: ${app.hint?.id ?? '—'}`;
  }
}

function updateHud(S, car, input, dt) {
  const p = S.player;
  const common = { dt, car, spec: game.spec, input, timing: p.timing, keyboard: app.mode === 'keyboard', lastLap: p.timing.lapTimes.at(-1)?.time };
  if (S instanceof QualiSession) {
    const rows = S.results();
    hud.update({
      ...common,
      lapTime: S.lapTimeOf(),
      session: S.state === 'outlap' ? 'Квалификация · разгон' : `Квалификация · попытка ${Math.max(1, S.attempt)}/${S.attempts}`,
      pos: S.position() || '—',
      total: rows.length,
      lapLabel: S.best ? `лучший <b>${formatLap(S.best)}</b>` : 'нет времени',
      tower: rows.map((r) => ({ pos: r.pos, code: r.code, color: r.color, gap: r.time != null ? formatLap(r.time) : '—', player: !!r.player })),
      cars: [{ x: car.x, z: car.z, color: PLAYER.color, player: true }],
    });
    return;
  }
  hud.update({
    ...common,
    lapTime: S.lapTimeOf(p),
    session: S.state === 'grid' ? 'Старт' : 'Гонка',
    pos: S.positionOf(p),
    total: S.entries.length,
    lap: p.timing.lap,
    laps: S.laps,
    neighbours: S.neighbours(),
    tower: S.tower(),
    cars: S.entries.map((e) => ({ x: e.isPlayer ? e.car.x : e.bot.x, z: e.isPlayer ? e.car.z : e.bot.z, color: e.color, player: e.isPlayer })),
  });
}

// ---------- кнопки и клавиши ----------
function switchCamera() {
  const mode = rig.next();
  if (app.state === 'race' || app.state === 'quali') hud.message(`Камера: ${CAMERA_NAMES[mode].toLowerCase()}`, 'info', 1.2);
}

function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
}

function toggleKeyboard() {
  if (app.mode === 'keyboard') {
    if (camera.ready) setMode('gesture');
    else if (['onboarding', 'menu', 'results', 'quali-results'].includes(app.state)) {
      app.state = 'onboarding';
      menu.hide();
      hud.show(false);
      screenEl.classList.remove('podium-mode');
      onboarding.show('camera');
    }
  } else {
    setMode('keyboard');
    if (app.state === 'onboarding') openMenu();
    else if (app.state === 'menu') menu.show(settings, { keyboard: true });
  }
}

$('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
$('btn-mute').onclick = toggleMute;
$('btn-kb').onclick = toggleKeyboard;
$('btn-cam').onclick = switchCamera;
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
  if (e.code === 'KeyC') switchCamera();
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

window.airwheel = { app, game, gfx, world, rig, keyboard, hud, settings, formatTime, placeCar };

function boot() {
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  rig.script = trackFlyover();
  requestAnimationFrame(frame);
}

boot();
