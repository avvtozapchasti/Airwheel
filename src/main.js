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
import { buildCarModel, setHeadlightLevel, preloadCars, LIVERIES } from './render/carModel.js';
import { Podium } from './render/podium.js';
import { QualityManager } from './render/quality.js';
import { Particles, emitFromCar, emitWallSparks } from './render/particles.js';
import { RainSystem, WET } from './render/rain.js';
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
import { Weather } from './game/weather.js';
import { NetGame } from './net/netgame.js';
import { NetRaceSession } from './net/netsession.js';
import { LobbyUI } from './ui/lobby.js';
import { qualiTime } from './game/bots.js';
import { COMPOUNDS } from './game/tires.js';
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
const rain = new RainSystem(gfx.scene);
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
const PLAYER = { name: 'Ты', code: 'ТЫ', color: '#ffb000' }; // цвет — по окраске машины
const PENALTY_TEXT = { wall: 'Удар о стену', cut: 'Срезка', jump: 'Фальстарт', reset: 'Возврат на трассу', pit: 'Скорость в пит-лейне' };
const URLP = new URLSearchParams(location.search);
const AUTOPILOT = URLP.has('autopilot');

const settings = loadSettings({ trackId: TRACKS[0].id, cls: 'gt3', laps: 3, assist: 'medium', difficulty: 'medium', graphics: 'auto', weather: 'dry', tires: 'medium', name: 'Игрок', livery: 0 });
if (!LIVERIES[settings.livery]) settings.livery = 0;
PLAYER.color = LIVERIES[settings.livery].base;
if (!['dry', 'rain', 'variable'].includes(settings.weather)) settings.weather = 'dry';
if (!COMPOUNDS[settings.tires]) settings.tires = 'medium';
if (URLP.has('weather')) settings.weather = URLP.get('weather');
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
  debugT: 0,
  debugFull: false,
};

// ---------- трасса, класс, соперники ----------
const game = {
  track: null,
  trackId: null,
  spec: null,
  prof: null, // профиль для коуча — смесь сухого и мокрого по сцеплению шин
  profDry: null,
  profWet: null,
  bps: null,
  weather: null,
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
  game.profDry = speedProfile(game.track, game.track.racingLine, game.spec);
  game.profWet = speedProfile(game.track, game.track.racingLine, game.spec, { gripK: 0.64 });
  game.prof = { v: new Float32Array(game.profDry.v), lapTime: game.profDry.lapTime, vTop: game.profDry.vTop };
  game.bps = brakingPoints(game.track, game.profDry);
  if (game.model) {
    game.model.root.removeFromParent();
    game.model.dispose();
  }
  game.model = buildCarModel(game.spec, { livery: LIVERIES[settings.livery], number: 27, player: true });
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
  liveries: LIVERIES,
  onChange: (s) => {
    saveSettings(s);
    // окраска: сразу на машине (видна в облёте меню после старта)
    if (game.model && game.model.livery?.id !== LIVERIES[s.livery]?.id) {
      game.model.setLivery(LIVERIES[s.livery], 27);
      PLAYER.color = LIVERIES[s.livery].base;
    }
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
  onMultiplayer: () => openMultiplayer(),
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

// Профиль скорости для коуча: смесь сухого и мокрого по текущему сцеплению шин игрока.
function blendProfile(grip) {
  const f = Math.max(-0.1, Math.min(1.2, (1 - grip) / 0.36));
  const P = game.prof, D = game.profDry.v, W = game.profWet.v;
  for (let i = 0; i < P.v.length; i++) P.v[i] = D[i] + (W[i] - D[i]) * f;
}

function newWeather() {
  game.weather = new Weather(settings.weather, { seed: (Math.random() * 1e6) | 0, lapTime: game.profDry.lapTime * 1.08 });
  return game.weather;
}

function beginSession(S) {
  game.session = S;
  blendProfile(1);
  app.blendT = 0;
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
    prof: game.profDry,
    weather: newWeather(),
    compound: settings.tires,
    bots: game.bots,
    assist: ASSIST[settings.assist],
    player: PLAYER,
    onEvent: onSessionEvent,
  });
  S.start();
  world.pit?.setBoxes([...game.bots.map((b) => b.color), PLAYER.color], 11);
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
    prof: game.profDry,
    weather: newWeather(),
    compound: settings.tires,
    laps: settings.laps,
    assist: ASSIST[settings.assist],
    player: PLAYER,
    onEvent: onSessionEvent,
  });
  S.start(game.grid);
  world.pit?.setBoxes(S.entries.map((e) => e.color), S.entries.indexOf(S.player));
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
      // звук, искры и тряска — по силе удара (скорости по нормали к стене)
      const car = game.session?.playerCar;
      if (e.entry?.isPlayer && car) {
        audio.crash(0.25 + (e.strength ?? e.speed / 40) * 1.3);
        emitWallSparks(fx, car, e.side, 4 + e.speed * 1.2);
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
      hud.message(`${PENALTY_TEXT[e.reason] || 'Штраф'}: +${e.sec} с`, 'bad', 2.5);
      break;
    case 'respawn':
      hud.message('Возврат на трассу', 'info', 1.5);
      break;
    case 'weather':
      if (e.kind === 'rain-soon') hud.message('🌧 Дождь через 1 круг', 'info', 3.5);
      else if (e.kind === 'rain') hud.message('🌧 Дождь! Трасса намокает', 'bad', 3);
      else if (e.kind === 'stop') hud.message('☀ Дождь закончился — трасса сохнет', 'info', 3);
      break;
    case 'pit-enter':
      hud.message('Пит-лейн · 60 км/ч', 'info', 2);
      break;
    case 'pit-stop':
      audio.ok();
      break;
    case 'pit-done':
      audio.lap();
      break;
    case 'pit-exit':
      if (!e.drive) hud.message(`Пит-стоп · ${COMPOUNDS[e.compound]?.name ?? ''} · потеряно ${e.loss.toFixed(1)} с`, 'good', 3);
      break;
    case 'quali-end':
      hud.big('КВАЛИФИКАЦИЯ', 'gold');
      break;
    case 'finish':
      hud.big('ФИНИШ!', 'gold');
      audio.finish();
      break;
    case 'net-finish':
      mp.net?.sendFinish(e.report);
      hud.message('Ждём остальных…', 'info', 4);
      break;
    case 'done':
      if (mp.inQuali) mpQualiDone();
      else if (app.state === 'quali') showQualiResults();
      else finishRace();
      break;
  }
}

// Сетевая квалификация закончена: отправляем время хосту и ждём остальных.
function mpQualiDone() {
  const S = game.session;
  mp.inQuali = false;
  coach.stopRecording();
  hud.big('');
  hud.show(false);
  coachEl.classList.remove('show');
  app.state = 'mp-wait';
  mp.net?.sendQualiTime(S?.best ?? null);
  lobbyUI.showWait('Квалификация завершена', [S?.best ? `Твой лучший круг: <b>${formatLap(S.best)}</b>` : 'Засчитанного круга нет — стартуешь в конце.', 'Ждём остальных игроков, затем старт гонки…']);
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
    rows.slice(0, 3).map((r) => ({ spec: game.spec, color: r.color, livery: r.player ? LIVERIES[settings.livery] : null })),
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

// ---------- мультиплеер ----------
// Лобби по коду комнаты → (квалификация) → решётка → гонка → общий протокол от хоста.
const mp = { net: null, lobby: null, inRace: false, inQuali: false, pending: null, hostBots: null, firstFinishT: null, qStart: 0 };
const lobbyUI = new LobbyUI(screenEl, {
  onCreate: (name) => mpCreate(name),
  onJoin: (code, name) => mpJoin(code, name),
  onBack: () => openMultiplayer(),
  onSolo: () => {
    leaveNet();
    openMenu();
  },
  onReady: (on) => mp.net?.setReady(on),
  onStart: () => mpHostStart(),
  onLeave: () => {
    leaveNet();
    openMenu();
  },
  onSettings: (patch) => mp.net?.setSettings(patch),
});

function saveName(name) {
  settings.name = String(name || '').trim().slice(0, 16) || 'Игрок';
  saveSettings(settings);
}

function openMultiplayer(message = '') {
  leaveNet();
  openMenu();
  menu.hide();
  app.state = 'mp';
  lobbyUI.showMenu({ name: settings.name, message });
}

function newNet() {
  return new NetGame({
    onLobby: (l) => mpOnLobby(l),
    onStart: (m) => mpOnStart(m),
    onResults: (rows) => mpShowResults(rows),
    onError: (text) => mpError(text),
    onPeerLeft: (p) => mpPeerLeft(p),
    onToLobby: () => mpShowLobby(),
  });
}

function leaveNet() {
  mp.net?.leave();
  mp.net = null;
  mp.inRace = mp.inQuali = false;
  mp.pending = null;
  mp.hostBots = null;
}

function mpCreate(name) {
  saveName(name);
  leaveNet();
  mp.net = newNet();
  app.state = 'lobby';
  mp.net.host(settings.name, { trackId: settings.trackId, cls: settings.cls, laps: settings.laps, weather: settings.weather, bots: true, quali: false, difficulty: settings.difficulty });
}

function mpJoin(code, name) {
  saveName(name);
  leaveNet();
  mp.net = newNet();
  if (mp.net.join(code, settings.name)) {
    app.state = 'lobby';
    lobbyUI.showConnecting(mp.net.code);
  }
}

function mpOnLobby(l) {
  mp.lobby = l;
  // фон лобби — выбранная хостом трасса
  if (l.settings?.trackId && TRACK_BY_ID[l.settings.trackId] && l.settings.trackId !== game.trackId && !mp.inRace && !mp.inQuali) {
    loadTrack(l.settings.trackId);
    rig.script = trackFlyover();
  }
  if (app.state === 'lobby' && mp.net?.state === 'lobby') mpShowLobby();
}

function mpShowLobby() {
  if (!mp.net || !mp.lobby) return;
  mp.inRace = mp.inQuali = false;
  app.state = 'lobby';
  game.session = null;
  hud.show(false);
  coachEl.classList.remove('show');
  screenEl.classList.remove('podium-mode');
  showBots(false);
  if (!rig.script) rig.script = trackFlyover();
  lobbyUI.showLobby(mp.lobby, { isHost: mp.net.isHost, myId: mp.net.myId, tracks: TRACKS, classes: CLASS_IDS.map((id) => CARS[id]), ping: mp.net.myPing(), keyboard: app.mode === 'keyboard' });
}

function mpError(text) {
  const wasRacing = mp.inRace || mp.inQuali;
  leaveNet();
  openMenu();
  menu.hide();
  app.state = 'mp';
  lobbyUI.showError(text);
  if (wasRacing) hud.show(false);
}

function mpPlayerColor() {
  return mp.lobby?.players.find((p) => p.id === mp.net?.myId)?.color || PLAYER.color;
}

// Хост: квалификация (если включена) или сразу гонка.
function mpHostStart() {
  const net = mp.net;
  if (!net?.isHost || net.state !== 'lobby') return;
  const seed = (Math.random() * 1e6) | 0;
  mp.hostBots = null;
  if (net.settings.quali) {
    mp.qStart = performance.now();
    net.start('quali', { seed, weatherSeed: (Math.random() * 1e6) | 0 });
  } else net.start('race', mpRaceData(seed, null));
}

// Хост: боты на свободные места и порядок решётки (по квалификации или по темпу ботов).
function mpRaceData(seed, qtimes) {
  const net = mp.net, S = net.settings;
  game.trackId === S.trackId || loadTrack(S.trackId);
  setClass(S.cls);
  const humans = net.players.map((p) => ({ id: p.id, kind: 'human', name: p.name, color: p.color, time: qtimes?.get(p.id) ?? null }));
  const nb = S.bots ? Math.max(0, 12 - humans.length) : 0;
  const bots = mp.hostBots || (nb ? createBots(nb, game.spec, game.track, { seed, difficulty: settings.difficulty, bps: game.bps }) : []);
  mp.hostBots = bots;
  const botRows = bots.map((b) => ({ id: b.code, kind: 'bot', name: b.name, color: b.color, time: b.qualiTime ?? null, pace: b.pace }));
  let grid;
  if (qtimes) grid = [...humans, ...botRows].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  else {
    // без квалификации: боты по темпу, игроки — в середине решётки
    grid = botRows.sort((a, b) => b.pace - a.pace);
    humans.forEach((h, k) => grid.splice(Math.min(grid.length, 3 + k * 2), 0, h));
  }
  return { seed, holdT: 0.4 + Math.random() * 1.2, weatherSeed: (Math.random() * 1e6) | 0, grid: grid.map(({ id, kind, name, color, time }) => ({ id, kind, name, color, time })) };
}

// Старт этапа приходит заранее: ждём t0 по часам хоста (у всех одновременно).
function mpOnStart(m) {
  mp.pending = m;
  app.state = 'mp-wait';
  hud.show(false);
  screenEl.classList.remove('podium-mode');
  screenEl.innerHTML = `<div class="card loading"><h1>${m.stage === 'quali' ? 'Квалификация' : 'Гонка'} · ${esc(TRACK_BY_ID[m.settings.trackId]?.name ?? '')}</h1><p class="lead">Синхронизируем старт…</p></div>`;
  screenEl.classList.remove('hidden');
  try {
    if (game.trackId !== m.settings.trackId) loadTrack(m.settings.trackId);
    setClass(m.settings.cls);
  } catch (e) {
    console.error(e);
  }
}

function mpStartQuali(m) {
  const net = mp.net;
  clearBots();
  const humans = mp.lobby?.players.length ?? 1;
  const nb = net.isHost && m.settings.bots ? Math.max(0, 12 - humans) : 0;
  const bots = nb ? createBots(nb, game.spec, game.track, { seed: m.seed, difficulty: settings.difficulty, bps: game.bps }) : [];
  if (net.isHost) mp.hostBots = bots;
  game.bots = bots;
  const S = new QualiSession({
    track: game.track,
    spec: game.spec,
    prof: game.profDry,
    weather: new Weather(m.settings.weather, { seed: m.weatherSeed ?? m.seed, lapTime: game.profDry.lapTime * 1.08 }),
    compound: settings.tires,
    bots,
    assist: ASSIST[settings.assist],
    player: { name: settings.name, code: settings.name.slice(0, 3), color: mpPlayerColor() },
    onEvent: onSessionEvent,
  });
  S.start();
  game.model.setColor(mpPlayerColor());
  world.pit?.setBoxes([...bots.map((b) => b.color), mpPlayerColor()], 11);
  beginSession(S);
  rig.script = null;
  app.state = 'quali';
  mp.inQuali = true;
  hud.message('Квалификация · 2 попытки', 'info', 2.5);
}

function mpStartRace(m) {
  const net = mp.net;
  clearBots();
  net.remotes.clear();
  const spec = game.spec;
  const order = [];
  const hostBots = [];
  for (const g of m.grid) {
    if (g.id === net.myId) order.push('player');
    else if (g.kind === 'bot' && net.isHost) {
      const b = mp.hostBots?.find((x) => x.code === g.id);
      if (b) {
        order.push(b);
        hostBots.push(b);
      }
    } else order.push({ remote: net.remote(g.id, spec, game.track), id: g.id, name: g.name, color: g.color, human: g.kind === 'human' });
  }
  game.bots = hostBots;
  const me = m.grid.find((g) => g.id === net.myId);
  const S = new NetRaceSession({
    track: game.track,
    spec,
    prof: game.profDry,
    weather: new Weather(m.settings.weather, { seed: m.weatherSeed, lapTime: game.profDry.lapTime * 1.08 }),
    compound: settings.tires,
    laps: m.settings.laps,
    assist: ASSIST[settings.assist],
    player: { name: settings.name, code: settings.name.slice(0, 3), color: me?.color || PLAYER.color },
    onEvent: onSessionEvent,
    isHost: net.isHost,
    holdT: m.holdT,
  });
  S.start(order);
  S.player.id = net.myId;
  for (const e of S.entries) {
    if (e.isPlayer) continue;
    const mdl = buildCarModel(spec, { color: e.color });
    mdl.setLodScale(lodScale);
    mdl.bot = S.carOf(e);
    mdl.entryId = e.id;
    game.botModels.push(mdl);
  }
  game.model.setColor(me?.color || PLAYER.color);
  showBots(true);
  world.pit?.setBoxes(S.entries.map((e) => e.color), S.entries.indexOf(S.player));
  beginSession(S);
  rig.script = gridFlyover(S);
  app.state = 'race';
  app.format = 'race';
  mp.inRace = true;
  mp.firstFinishT = null;
}

function mpPeerLeft(p) {
  const S = game.session;
  if (mp.inRace && S?.entries) {
    const e = S.entries.find((x) => x.id === p.id);
    if (e && mp.net?.isHost && e.remote) {
      const bot = S.convertToBot(e, { seed: (Math.random() * 1e5) | 0, difficulty: settings.difficulty, bps: game.bps });
      const mdl = game.botModels.find((x) => x.entryId === p.id);
      if (mdl && bot) mdl.bot = bot;
      if (bot) game.bots.push(bot);
    }
    hud.message(`${p.name} отключился — машину ведёт бот`, 'info', 3);
  }
}

// Каждый кадр: сеть, ожидание старта, жесты в лобби, итоги у хоста.
function mpTick(dt, input, enter) {
  const net = mp.net;
  if (!net) return;
  net.tick(dt, mp.inRace && game.session ? game.session : null);
  if (!mp.net) return;
  if (mp.pending && net.hostNow() >= mp.pending.t0) {
    const m = mp.pending;
    mp.pending = null;
    try {
      if (m.stage === 'quali') mpStartQuali(m);
      else mpStartRace(m);
    } catch (e) {
      console.error(e);
      mpError('Не удалось запустить сетевую гонку.');
      return;
    }
  }
  if (app.state === 'lobby' || app.state === 'mp') {
    lobbyUI.update(input);
    if (enter && lobbyUI.view === 'lobby') {
      if (net.isHost) mpHostStart();
      else lobbyUI.h.onReady(!lobbyUI.ready);
    }
  }
  // хост: все прошли квалификацию (или 4 минуты) — решётка и гонка
  if (net.isHost && net.state === 'quali' && !mp.pending) {
    const all = net.players.every((p) => net.qtimes.has(p.id));
    if (all || performance.now() - mp.qStart > 240000) net.start('race', mpRaceData((Math.random() * 1e6) | 0, net.qtimes));
  }
  // хост: все игроки финишировали (или минута после первого) — общий протокол
  const S = game.session;
  if (net.isHost && mp.inRace && S instanceof NetRaceSession) {
    if (net.reports.size && mp.firstFinishT == null) mp.firstFinishT = performance.now();
    const connected = new Set(net.players.map((p) => p.id));
    const humans = S.entries.filter((e) => (e.isPlayer || e.human) && connected.has(e.id));
    const done = humans.length > 0 && humans.every((e) => net.reports.has(e.id));
    if (done || (mp.firstFinishT && performance.now() - mp.firstFinishT > 60000)) net.sendResults(S.finalRows(net.reports));
  }
}

function mpShowResults(rows) {
  const net = mp.net;
  if (!net) return;
  mp.inRace = false;
  app.state = 'results';
  coach.stopRecording();
  hud.big('');
  hud.show(false);
  coachEl.classList.remove('show');
  rig.script = null;
  const list = rows.map((r) => ({ ...r, player: r.id === net.myId }));
  const me = list.find((r) => r.player) || list[0];
  podium.show(
    list.slice(0, 3).map((r) => ({ spec: game.spec, color: r.color })),
    gfx.scene.environment,
  );
  screenEl.classList.add('podium-mode');
  const S = game.session;
  showResults(
    screenEl,
    {
      subtitle: `Сетевая гонка · ${game.track.name} · ${game.spec.name}`,
      place: me.pos,
      total: list.length,
      time: me.time,
      bestLap: me.bestLap,
      lapTimes: S?.player?.timing.lapTimes ?? [],
      penalty: me.penalty,
      standings: list,
      coach: coach.summary(),
      keyboard: app.mode === 'keyboard',
      extra: '',
    },
    {
      onRetry: net.isHost ? () => net.backToLobby() : () => {},
      onMenu: () => {
        leaveNet();
        openMenu();
      },
      retryLabel: net.isHost ? 'В лобби' : 'Ждём хоста…',
      menuLabel: 'Выйти в меню',
      retryDisabled: !net.isHost,
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
  if (mp.net) {
    screenEl.innerHTML = `
    <div class="card">
      <h1>⏸ Пауза</h1>
      <p class="lead" id="pause-hint">${reason || ''}</p>
      <p>Сетевая гонка продолжается — соперники не ждут. ${how}</p>
      <div class="row">
        <button class="btn primary" id="btn-resume">Продолжить</button>
        <button class="btn" id="btn-menu">Выйти из гонки</button>
      </div>
    </div>`;
    screenEl.classList.remove('hidden');
    $('btn-resume').onclick = resume;
    $('btn-menu').onclick = () => {
      leaveNet();
      openMenu();
    };
    return;
  }
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
    // заказал пит-стоп — автопилот едет по пути въезда в пит-лейн
    const pit = S.player?.pit, L = game.track.pit;
    const u = L ? L.rel(S.playerCar.s) : 0;
    const toPit = L && pit && (pit.request || pit.active) && (pit.active || u > game.track.length - 300 || u < L.wallA + 20);
    return { ...kb, ...autopilotInput(S.playerCar, game.track, game.prof, game.spec, { assist: ASSIST[settings.assist], lineOffset: toPit ? (k) => L.pathD(k * game.track.ds) : null }) };
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
  // большой палец вверх: на подъезде к пит-лейну — выбор шин, иначе ускорение
  const pitWin = driving && car && S.player?.pit && (S.player.pit.windowOpen(car) || (S.player.pit.request && S.player.pit.phase === 'track'));
  if (driving && input.nitro && pitWin) {
    S.player.pit.cycle(S.suggestTires(S.player));
    audio.ok();
  } else if (driving && input.nitro && (S.state === 'race' || app.state === 'quali') && tryBoost(car)) audio.nitro();
  if (driving && car && S.player?.pit && (app.blendT = (app.blendT || 0) - dt) <= 0) {
    app.blendT = 0.5;
    blendProfile(car.tireGrip ?? 1);
  }

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
  } else if (app.state === 'results' && input.startTrigger && !mp.net) startWeekend(app.format);

  quality.update(dt, !!driving);
  mpTick(dt, input, enter);

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
      game.model.update(car, alpha, dt, carEnv());
      const pos = game.model.root.position;
      rig.update(dt, { pos, heading: game.model.root.rotation.y, pitch: car.pitch, roll: car.roll, speed: speedOf(car), vmax: game.spec.vmax, shake: car.shake, rumble: car.rumble, ax: car.ax, boost: car.boostOn, dims: game.spec.dims, s: car.s }, game.track);
      gfx.followSun(pos);
    } else {
      game.model.root.visible = false;
      rig.update(dt, { pos: gfx.camera.position, heading: 0, speed: 0 }, game.track);
      gfx.followSun(gfx.camera.position);
    }
    const cenv = carEnv();
    setHeadlightLevel(cenv.night);
    for (const m of game.botModels) if (m.root.parent) m.update(m.bot, m.bot.isRemote ? 1 : alpha, dt, cenv);
    const showCars = driving || app.state === 'paused';
    world.update(gfx.camera.position, {
      dt,
      lodScale,
      focus: car && showCars ? car : { s: game.track.project(gfx.camera.position.x, gfx.camera.position.z, -1).s },
      bots: app.state === 'race' || (app.state === 'paused' && app.pausedFrom === 'race') ? othersOf(S) : null,
      pit: pitView(S),
    });
    gfx.setSpeedBlur(car && showCars ? Math.max(0, (speedOf(car) / game.spec.vmax - 0.55) * 1.6) : 0, car && showCars ? game.model.root.position : null);
    // глубина резкости — только в меню и на облёте решётки, не во время езды
    const menuish = ['menu', 'mp', 'lobby', 'mp-wait', 'onboarding'].includes(app.state);
    const gridFly = rig.script && S?.state === 'grid' && car;
    gfx.setDof(menuish ? 0.7 : gridFly ? 0.55 : 0, gridFly ? gfx.camera.position.distanceTo(game.model.root.position) : 30);
    // погода: мокрый асфальт, капли, приглушённый свет
    const W = weatherView(S);
    WET.uWet.value += (W.visWet - WET.uWet.value) * Math.min(1, dt * 2);
    gfx.setRainMood(W.rain);
    const vel = car && showCars ? { x: car.u * Math.sin(car.psi) + car.v * Math.cos(car.psi), z: car.u * Math.cos(car.psi) - car.v * Math.sin(car.psi) } : null;
    rain.update(app.state === 'paused' ? 0 : dt, W.rain * (quality.current.id === 'low' ? 0.5 : 1), gfx.camera.position, vel, game.track.def.env?.time === 'night');
    gfx.render();
  }

  // звук: двигатель по оборотам, тормоза, занос, поребрик, ближайший соперник
  if (car && driving) {
    let nearest = null;
    if (app.state === 'race') {
      for (const b of othersOf(S)) {
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
    const wetNow = (S?.wetness ?? 0) > 0.3; // брызги — только на реально мокрой трассе
    emitFromCar(fx, car, game.track, dt, { wet: wetNow, offType: game.track.def.env?.ground === 'sand' ? 'sand' : 'dust', f1: game.spec.id === 'f1' });
    // брызги за соперниками на мокром асфальте (только близкие к камере)
    if (wetNow && app.state === 'race') {
      for (const b of othersOf(S)) {
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
    app.debugT -= dt;
    if (app.debugT <= 0) {
      app.debugT = 0.1; // 10 раз в секунду — текст в DOM не нагружает кадр
      debugEl.textContent = debugText(S, car, input, errors);
    }
  }
}

// Отладочная панель: ` — кратко, F3 — подробно (физика по колёсам).
const WHEEL_NAMES = ['ПЛ', 'ПП', 'ЗЛ', 'ЗП'];
const DEG = 180 / Math.PI;
function debugText(S, car, input, errors) {
  const info = gfx.renderer.info.render;
  let t =
    `FPS: ${app.fps.toFixed(0)}  draw calls: ${info.calls}  треугольников: ${(info.triangles / 1000).toFixed(0)}k  графика: ${quality.current.name}${quality.mode === 'auto' ? ' (авто)' : ''}\n` +
    `режим: ${app.mode}  состояние: ${app.state}/${S?.state ?? '—'}  рук: ${input.handsVisible ?? '—'}\n` +
    `руль: ${(input.steer || 0).toFixed(2)}  газ: ${+input.gas || 0}  тормоз: ${+input.brake || 0}  ошибки: ${errors.map((e) => e.id).join(', ') || '—'}  подсказка: ${app.hint?.id ?? '—'}\n`;
  if (!car) return t;
  t +=
    `v: ${Math.round(speedOf(car) * KMH)} км/ч  передача: ${car.gear + 1}  s: ${car.s.toFixed(0)}  d: ${car.d.toFixed(2)}  покрытие: ${car.surfaceMain}\n` +
    `δ: ${(car.delta * DEG).toFixed(1)}°  β: ${(car.beta * DEG).toFixed(1)}°  r: ${car.r.toFixed(2)}  ay: ${car.ay.toFixed(1)}  недоворот: ${car.under.toFixed(2)}  снос: ${car.over.toFixed(2)}\n` +
    `TC: ${car.tc ? '●' : '○'}  ABS: ${car.abs ? '●' : '○'}  ESP: ${car.esp ? '●' : '○'}  помощь: ${ASSIST[settings.assist]}  шины ×${(car.tireGrip ?? 1).toFixed(2)}  штраф сцепл.: ${car.gripPenaltyT > 0 ? car.gripPenaltyT.toFixed(2) + ' с' : '—'}`;
  if (app.debugFull) {
    t += '\nколесо  покрытие      нагрузка   μ      увод    скольж.   Fx      Fy';
    car.wheels.forEach((w, k) => {
      t += `\n${WHEEL_NAMES[k].padEnd(7)} ${(w.S?.name ?? w.surface).padEnd(13)} ${w.load.toFixed(0).padStart(6)} Н  ${w.mu.toFixed(2)}  ${(w.slip * DEG).toFixed(1).padStart(5)}°  ${w.ratio.toFixed(3).padStart(6)}  ${w.fx.toFixed(0).padStart(6)}  ${w.fy.toFixed(0).padStart(6)}`;
    });
  }
  return t;
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
    hudExtras(S, car);
    return;
  }
  hudExtras(S, car);
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
    cars: S.entries.map((e) => ({ x: S.carOf(e).x, z: S.carOf(e).z, color: e.color, player: e.isPlayer })),
  });
}

// Освещение машин: ночь/сумерки — ярче фары и задние фонари; мокро — дождевой огонь F1.
function carEnv() {
  const t = game.track?.def.env?.time;
  return { night: t === 'night' || t === 'dusk', wet: WET.uWet.value > 0.35 && (game.session?.rain ?? 0) + (game.session?.wetness ?? 0) > 0.3 };
}

// Машины соперников (боты и игроки по сети) — для звука, брызг и пятен фар.
function othersOf(S) {
  if (!S?.entries) return [];
  return S.entries.filter((e) => !e.isPlayer).map((e) => S.carOf(e));
}

// Погода для рендера: влажность асфальта (ночные трассы всегда чуть влажные — блики) и дождь.
function weatherView(S) {
  const damp = game.track?.def.env?.wet ? 0.45 : 0;
  const live = S && (app.state === 'race' || app.state === 'quali' || app.state === 'paused');
  if (live) return { visWet: Math.max(damp, S.wetness || 0), rain: S.rain || 0 };
  // в меню — по выбранной погоде, чтобы фон показывал дождь
  const rainy = settings.weather === 'rain';
  return { visWet: Math.max(damp, rainy ? 0.9 : 0), rain: rainy ? 0.85 : 0 };
}

// Пит-лейн для рендера: где идёт пит-стоп (механики выбегают), светофор выезда.
function pitView(S) {
  if (!S?.player?.pit || !(app.state === 'race' || app.state === 'quali' || app.state === 'paused')) return { service: [] };
  const pp = S.player.pit;
  const service = [{ box: pp.box, active: pp.phase === 'service' || pp.phase === 'release' }];
  if (S.bots && app.state !== 'quali') for (const b of S.bots) if (b.pit?.phase === 'service') service.push({ box: b.pit.box, active: true });
  return { service, red: pp.phase === 'service' };
}

// Шины, погода, окно пит-стопа — новые элементы HUD.
function hudExtras(S, car) {
  const p = S.player;
  const pit = p.pit;
  const kb = app.mode === 'keyboard';
  hud.extras({
    tire: car.tire,
    weather: S.weather ? { ...S.weather.label(S.clock), wet: S.wetness } : null,
    pit: pit
      ? {
          window: pit.windowOpen(car) || (pit.request && pit.phase === 'track'),
          request: pit.request,
          suggest: S.suggestTires(p),
          phase: pit.phase,
          progress: p.pitOut?.progress ?? 0,
          compound: pit.compound,
          keyboard: kb,
        }
      : null,
    ping: mp.net && !mp.net.isHost ? mp.net.myPing() : null,
  });
}

// Выбор шин кнопкой/клавишей в окне пит-стопа.
function pitPick(id) {
  const S = game.session;
  const pit = S?.player?.pit;
  if (!pit || pit.phase !== 'track') return;
  pit.request = id;
  audio.ok();
}
hud.onPitPick = pitPick;

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
  if (['Digit1', 'Digit2', 'Digit3', 'Digit0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad0'].includes(e.code) && game.session?.player?.pit) {
    const k = e.code.slice(-1);
    if (k === '0') {
      if (game.session.player.pit.phase === 'track') game.session.player.pit.request = null;
    } else pitPick(['soft', 'medium', 'wet'][+k - 1]);
  }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyC') switchCamera();
  if (e.code === 'Backquote' || e.code === 'F3') {
    if (e.code === 'F3') e.preventDefault();
    const full = e.code === 'F3';
    // повторное нажатие той же клавиши — скрыть, другой — переключить режим
    if (!debugEl.classList.contains('hidden') && app.debugFull === full) debugEl.classList.add('hidden');
    else {
      debugEl.classList.remove('hidden');
      app.debugFull = full;
      app.debugT = 0;
    }
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (app.state === 'paused') resume();
    else pause();
  }
});

// закрыли вкладку — корректно выходим из сетевой комнаты (остальные сразу узнают)
window.addEventListener('pagehide', () => mp.net?.leave());

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
  // модели машин (GLB, meshopt) — в фоне; до загрузки работает процедурная копия
  preloadCars(['gt3', 'f1'])
    .then(() => {
      if (!game.session) {
        game.spec = null;
        setClass(settings.cls);
      }
    })
    .catch((e) => console.warn('[airwheel] модели машин', e));
  app.trackerReady = tracker.init();
  app.trackerReady.catch((e) => console.warn('Модель рук не загрузилась', e));
  onboarding.show('camera');
  rig.script = trackFlyover();
  requestAnimationFrame(frame);
}

boot();
