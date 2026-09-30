// Онбординг в 4 экрана:
// 1) камера и проверка света, 2) «Возьми руль» + калибровка,
// 3) короткое обучение с зелёными галочками, 4) старт.
import { LIMITS } from '../control/gestures.js';
import { recordsTable } from './leaderboard.js';

const GESTURES_TABLE = `
  <table class="gestures">
    <tr><td>✊✊</td><td>Оба кулака</td><td>Газ</td></tr>
    <tr><td>✋✋</td><td>Обе ладони</td><td>Тормоз</td></tr>
    <tr><td>✊✋</td><td>Разные руки</td><td>Накат</td></tr>
    <tr><td>↻</td><td>Наклон рук как руля</td><td>Поворот</td></tr>
    <tr><td>👍</td><td>Большой палец вверх 0,3 с</td><td>Нитро</td></tr>
    <tr><td>🙌</td><td>Ладони подняты 1 с</td><td>Старт / пауза</td></tr>
  </table>`;

const KEYS_TABLE = `
  <table class="gestures">
    <tr><td>↑ / W</td><td>Газ</td></tr>
    <tr><td>↓ / S</td><td>Тормоз</td></tr>
    <tr><td>← → / A D</td><td>Поворот</td></tr>
    <tr><td>Shift / N</td><td>Нитро</td></tr>
    <tr><td>Esc / P</td><td>Пауза</td></tr>
  </table>`;

export class Onboarding {
  constructor(root, h) {
    this.root = root;
    this.h = h; // { onEnableCamera, onKeyboard, onStart, onCalibrate }
    this.step = null;
    this.tasks = null;
    this.doneT = 0;
  }

  get active() {
    return this.step !== null;
  }

  hide() {
    this.step = null;
    this.root.classList.add('hidden');
  }

  render(html) {
    this.root.innerHTML = `<div class="card onboarding">${html}</div>`;
    this.root.classList.remove('hidden');
  }

  dots(n) {
    return `<div class="steps">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  show(step, opts = {}) {
    this.step = step;
    this.doneT = 0;
    const $ = (id) => this.root.querySelector(id);

    if (step === 'camera') {
      this.render(`
        ${this.dots(1)}
        <h1>🏎️ AirWheel</h1>
        <p class="lead">Гонка, где руль — твои руки. Камера следит за ладонями, а ты управляешь машиной, как настоящим рулём.</p>
        <h2>Шаг 1 из 4 · Камера и свет</h2>
        <p>Разреши доступ к камере. Видео никуда не отправляется — всё распознаётся прямо в браузере.</p>
        <div class="meter"><span>Свет</span><div class="bar"><b id="ob-light"></b></div><em id="ob-light-txt">—</em></div>
        <p id="ob-cam-msg" class="msg">${opts.error ? opts.error : ''}</p>
        <div class="row">
          <button class="btn primary" id="ob-cam">📷 Включить камеру</button>
          <button class="btn" id="ob-next" disabled>Дальше →</button>
          <button class="btn" id="ob-kb">⌨️ Играть с клавиатуры</button>
        </div>`);
      $('#ob-cam').onclick = async () => {
        $('#ob-cam').disabled = true;
        $('#ob-cam-msg').textContent = 'Загружаю модель рук и включаю камеру…';
        const err = await this.h.onEnableCamera();
        // Пока ждали камеру, экран мог смениться (например, авто-переход на клавиатуру).
        if (this.step !== 'camera' || !$('#ob-cam-msg')) return;
        if (err) {
          $('#ob-cam-msg').textContent = err;
          $('#ob-cam').disabled = false;
        } else {
          $('#ob-cam-msg').textContent = 'Камера работает. Проверь свет и жми «Дальше».';
          $('#ob-cam-msg').classList.add('ok');
          $('#ob-next').disabled = false;
          $('#ob-cam').classList.add('hidden');
        }
      };
      $('#ob-next').onclick = () => this.show('calibrate');
      $('#ob-kb').onclick = () => this.h.onKeyboard();
    }

    if (step === 'calibrate') {
      this.h.onCalibrate();
      this.render(`
        ${this.dots(2)}
        <h2>Шаг 2 из 4 · Возьми руль</h2>
        <p class="lead">Вытяни обе руки перед собой на уровне груди, как будто держишь руль. Сожми кулаки и держи ровно 2 секунды.</p>
        <div class="wheel-demo">✊ ───── ✊</div>
        <div class="meter"><span>Калибровка</span><div class="bar"><b id="ob-cal"></b></div><em id="ob-cal-txt">0%</em></div>
        <p id="ob-hint" class="msg"></p>
        <div class="row"><button class="btn" id="ob-skip">Пропустить</button></div>`);
      $('#ob-skip').onclick = () => this.show('tutorial');
    }

    if (step === 'tutorial') {
      this.tasks = { gas: 0, brake: 0, left: false, right: false, nitro: false };
      this.render(`
        ${this.dots(3)}
        <h2>Шаг 3 из 4 · Пробуем управление</h2>
        <ul class="tasks">
          <li id="t-gas"><i></i>Сожми оба кулака — это <b>газ</b></li>
          <li id="t-brake"><i></i>Раскрой обе ладони — это <b>тормоз</b></li>
          <li id="t-steer"><i></i>Поверни руль влево и вправо</li>
          <li id="t-nitro" class="optional"><i></i>Бонус: большой палец вверх — <b>нитро</b></li>
        </ul>
        <p id="ob-hint" class="msg"></p>
        <div class="row"><button class="btn" id="ob-skip">Пропустить</button></div>`);
      $('#ob-skip').onclick = () => this.show('start');
    }

    // Шаг 4 — меню уик-энда (выбор трассы, класса, кругов), если оно подключено.
    if (step === 'start' && this.h.onMenu) {
      this.step = null;
      this.h.onMenu(opts);
      return;
    }

    if (step === 'start') {
      const kb = !!opts.keyboard;
      this.render(`
        ${this.dots(4)}
        <h2>Шаг 4 из 4 · На старт!</h2>
        ${opts.error ? `<p class="msg">${opts.error}</p>` : ''}
        <p class="lead">${
          kb
            ? 'Нажми Enter или «Старт». 3 круга, 4 соперника.'
            : 'Подними обе открытые ладони к камере на 1 секунду или нажми «Старт». 3 круга, 4 соперника.'
        }</p>
        ${kb ? '' : '<div class="meter"><span>Старт</span><div class="bar"><b id="ob-start"></b></div><em></em></div>'}
        <div class="cols">
          <div><h2>Управление</h2>${kb ? KEYS_TABLE : GESTURES_TABLE}</div>
          <div><h2>Рекорды</h2>${recordsTable()}</div>
        </div>
        <div class="row">
          <button class="btn primary" id="ob-go">▶ Старт</button>
          ${kb ? '<button class="btn" id="ob-cam2">📷 Попробовать камеру</button>' : '<button class="btn" id="ob-recal">Перекалибровать</button>'}
        </div>`);
      $('#ob-go').onclick = () => this.h.onStart();
      if (kb) $('#ob-cam2').onclick = () => this.h.onRetryCamera();
      else $('#ob-recal').onclick = () => this.show('calibrate');
    }
  }

  setBar(id, p, txt) {
    const b = this.root.querySelector(id);
    if (b) b.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    const t = txt !== undefined && this.root.querySelector(`${id}-txt`);
    if (t && t.textContent !== txt) t.textContent = txt;
  }

  setHint(hint) {
    const el = this.root.querySelector('#ob-hint');
    if (!el) return;
    const text = hint ? `⚠ ${hint.text}` : '';
    if (el.textContent !== text) el.textContent = text;
  }

  check(id, ok) {
    const el = this.root.querySelector(id);
    if (el && ok && !el.classList.contains('done')) {
      el.classList.add('done');
      this.h.onTick?.();
    }
  }

  // Вызывается каждый кадр. info: { brightness, hint }
  update(input, dt, info = {}) {
    if (!this.step) return;
    if (this.step === 'camera') {
      const b = info.brightness;
      if (b != null) {
        const ok = b >= LIMITS.darkLevel;
        this.setBar('#ob-light', b / 160, ok ? (b > 90 ? 'Отлично' : 'Нормально') : 'Темно — включи свет');
        this.root.querySelector('#ob-light')?.classList.toggle('bad', !ok);
      }
    } else if (this.step === 'calibrate') {
      const p = input.calibProgress || 0;
      this.setBar('#ob-cal', p, `${Math.round(p * 100)}%`);
      this.setHint(info.hint);
      if (p >= 1) {
        this.doneT += dt;
        if (this.doneT > 0.6) {
          this.h.onTick?.();
          this.show('tutorial');
        }
      }
    } else if (this.step === 'tutorial') {
      const t = this.tasks;
      t.gas = input.gas ? t.gas + dt : 0;
      t.brake = input.brake ? t.brake + dt : 0;
      if (input.steer < -0.5) t.left = true;
      if (input.steer > 0.5) t.right = true;
      if (input.nitro) t.nitro = true;
      this.check('#t-gas', t.gas > 0.5);
      this.check('#t-brake', t.brake > 0.5);
      this.check('#t-steer', t.left && t.right);
      this.check('#t-nitro', t.nitro);
      this.setHint(info.hint);
      const done = ['#t-gas', '#t-brake', '#t-steer'].every((id) => this.root.querySelector(id)?.classList.contains('done'));
      if (done) {
        this.doneT += dt;
        if (this.doneT > 1) this.show('start');
      }
    } else if (this.step === 'start') {
      this.setBar('#ob-start', input.startHold || 0);
      if (input.startTrigger) this.h.onStart();
    }
  }
}
