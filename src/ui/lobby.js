// Экраны мультиплеера: создать комнату / войти по коду, подключение, лобби.
// В том же стиле, что и меню (карточка, сегменты, кнопки). Жест «ладони 1 с» — «Готов» у
// игрока и «Старт» у хоста.
import { esc } from '../util/format.js';
import { JOIN_TIMEOUT_MS } from '../net/netgame.js';

const WEATHER = [
  ['dry', 'Сухо'],
  ['rain', 'Дождь'],
  ['variable', 'Переменная'],
];
const LAPS = [2, 3, 5];

export class LobbyUI {
  // h: { onCreate(name), onJoin(code, name), onBack(), onSolo(), onReady(on), onStart(), onLeave(), onSettings(patch) }
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.view = null;
    this.ready = false;
  }

  name() {
    return this.root.querySelector('#mp-name')?.value.trim() || this.lastName || 'Игрок';
  }

  // Главный экран мультиплеера.
  showMenu({ name = 'Игрок', message = '', code = '' } = {}) {
    this.view = 'menu';
    this.lastName = name;
    this.root.innerHTML = `
      <div class="card mp">
        <p class="eyebrow">Мультиплеер · по коду комнаты</p>
        <h1>👥 Гонка с друзьями</h1>
        <p class="lead">До 8 игроков, свободные места — боты. Соединение напрямую между браузерами, без регистрации.</p>
        ${message ? `<p class="msg">${esc(message)}</p>` : ''}
        <h2>Твоё имя</h2>
        <div class="name-row"><input id="mp-name" maxlength="16" value="${esc(name)}" autocomplete="off" spellcheck="false" /></div>
        <div class="mp-cols">
          <div class="mp-box">
            <h2>Создать комнату</h2>
            <p>Получишь код из 5 символов — отправь его друзьям.</p>
            <button class="btn primary" id="mp-create">＋ Создать комнату</button>
          </div>
          <div class="mp-box">
            <h2>Войти по коду</h2>
            <div class="name-row"><input id="mp-code" class="code-input" maxlength="5" placeholder="ABCDE" value="${esc(code)}" autocomplete="off" spellcheck="false" /></div>
            <button class="btn" id="mp-join">→ Войти</button>
          </div>
        </div>
        <div class="row">
          <button class="btn" id="mp-back">← Назад</button>
          <button class="btn" id="mp-solo">Играть одному</button>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    const q = (s) => this.root.querySelector(s);
    q('#mp-create').onclick = () => this.h.onCreate(this.name());
    const join = () => this.h.onJoin(q('#mp-code').value, this.name());
    q('#mp-join').onclick = join;
    q('#mp-code').onkeydown = (e) => e.key === 'Enter' && join();
    q('#mp-code').oninput = (e) => (e.target.value = e.target.value.toUpperCase());
    q('#mp-back').onclick = () => this.h.onBack();
    q('#mp-solo').onclick = () => this.h.onSolo();
  }

  showConnecting(code) {
    this.view = 'connecting';
    this.t0 = performance.now();
    this.root.innerHTML = `
      <div class="card mp">
        <h1>Подключение к комнате <span class="code">${esc(code)}</span>…</h1>
        <p class="lead">Ищем хоста через открытые сети и устанавливаем прямое соединение.</p>
        <div class="bar"><b id="mp-wait"></b></div>
        <div class="row">
          <button class="btn" id="mp-cancel">Отмена</button>
          <button class="btn" id="mp-solo">Играть одному</button>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('#mp-cancel').onclick = () => this.h.onLeave();
    this.root.querySelector('#mp-solo').onclick = () => this.h.onSolo();
  }

  showError(text) {
    this.view = 'error';
    this.root.innerHTML = `
      <div class="card mp">
        <h1>😕 Не получилось</h1>
        <p class="msg">${esc(text)}</p>
        <div class="row">
          <button class="btn primary" id="mp-retry">Попробовать снова</button>
          <button class="btn" id="mp-solo">Играть одному</button>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('#mp-retry').onclick = () => this.h.onBack(true);
    this.root.querySelector('#mp-solo').onclick = () => this.h.onSolo();
  }

  // Лобби: lobby = {code, players[], settings}, ctx = {isHost, myId, tracks[], classes[], ping, keyboard}
  showLobby(lobby, ctx) {
    this.view = 'lobby';
    this.lobby = lobby;
    this.ctx = ctx;
    const S = lobby.settings || {};
    const me = lobby.players.find((p) => p.id === ctx.myId);
    this.ready = !!me?.ready;
    const seg = (key, opts, cur) =>
      `<div class="seg ${ctx.isHost ? '' : 'ro'}" data-key="${key}">${opts.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const slots = Array.from({ length: 8 }, (_, k) => {
      const p = lobby.players[k];
      if (!p) return `<div class="pl empty"><i></i><span>${S.bots ? 'бот' : 'свободно'}</span></div>`;
      const ping = p.host ? 'хост' : p.ping != null ? `${p.ping} мс` : '…';
      return `<div class="pl ${p.id === ctx.myId ? 'me' : ''}"><i style="background:${p.color}"></i><span>${esc(p.name)}${p.id === ctx.myId ? ' (ты)' : ''}</span><em>${ping}</em><b class="${p.ready || p.host ? 'ok' : ''}">${p.host ? '★' : p.ready ? '✓ Готов' : 'не готов'}</b></div>`;
    }).join('');
    const tracks = ctx.tracks
      .map((t) => `<button class="choice mini ${t.id === S.trackId ? 'on' : ''}" data-track="${t.id}" ${ctx.isHost ? '' : 'disabled'}><b>${esc(t.name)}</b><span>${esc(t.subtitle || '')}</span></button>`)
      .join('');
    const allReady = lobby.players.every((p) => p.ready || p.host);
    this.root.innerHTML = `
      <div class="card menu mp">
        <div class="mp-head">
          <div><p class="eyebrow">Комната · отправь код друзьям</p><div class="code big" id="mp-code-big" title="Скопировать">${esc(lobby.code)}</div></div>
          <div class="ping">${ctx.isHost ? 'ты хост' : ctx.ping != null ? `📶 ${Math.round(ctx.ping)} мс` : '📶 …'}</div>
        </div>
        <h2>Игроки ${lobby.players.length}/8</h2>
        <div class="players">${slots}</div>
        <h2>Трасса ${ctx.isHost ? '' : '<small>(выбирает хост)</small>'}</h2>
        <div class="choices">${tracks}</div>
        <div class="opts">
          <label>Класс ${seg('cls', ctx.classes.map((c) => [c.id, c.name]), S.cls)}</label>
          <label>Круги ${seg('laps', LAPS.map((n) => [n, String(n)]), S.laps)}</label>
          <label>Погода ${seg('weather', WEATHER, S.weather)}</label>
          <label>Боты на свободные места ${seg('bots', [[1, 'Да'], [0, 'Нет']], S.bots ? 1 : 0)}</label>
          <label>Квалификация ${seg('quali', [[1, 'Да'], [0, 'Нет']], S.quali ? 1 : 0)}</label>
        </div>
        ${ctx.keyboard ? '' : `<div class="meter"><span>${ctx.isHost ? 'Старт' : 'Готов'} 🙌</span><div class="bar"><b id="mp-hold"></b></div><em>ладони 1 с</em></div>`}
        <div class="row">
          ${
            ctx.isHost
              ? `<button class="btn primary" id="mp-start">▶ ${S.quali ? 'Квалификация и гонка' : 'Старт гонки'}${allReady ? '' : ' (не все готовы)'}</button>`
              : `<button class="btn ${this.ready ? '' : 'primary'}" id="mp-ready">${this.ready ? '✓ Готов — отменить' : 'Я готов'}</button>`
          }
          <button class="btn" id="mp-leave">Выйти</button>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    const q = (s) => this.root.querySelector(s);
    q('#mp-leave').onclick = () => this.h.onLeave();
    q('#mp-code-big').onclick = () => navigator.clipboard?.writeText(lobby.code).catch(() => {});
    if (ctx.isHost) {
      q('#mp-start').onclick = () => this.h.onStart();
      this.root.querySelectorAll('[data-track]').forEach((b) => (b.onclick = () => this.h.onSettings({ trackId: b.dataset.track })));
      this.root.querySelectorAll('.seg').forEach((g) =>
        g.querySelectorAll('button').forEach((b) => {
          b.onclick = () => {
            const key = g.dataset.key;
            let v = b.dataset.v;
            if (key === 'laps') v = +v;
            if (key === 'bots' || key === 'quali') v = v === '1';
            this.h.onSettings({ [key]: v });
          };
        }),
      );
    } else q('#mp-ready').onclick = () => this.h.onReady(!this.ready);
  }

  // Ожидание (после квалификации / финиша).
  showWait(title, lines = []) {
    this.view = 'wait';
    this.root.innerHTML = `
      <div class="card mp">
        <h1>${esc(title)}</h1>
        ${lines.map((l) => `<p>${l}</p>`).join('')}
        <div class="row"><button class="btn" id="mp-leave">Выйти в меню</button></div>
      </div>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('#mp-leave').onclick = () => this.h.onLeave();
  }

  // Каждый кадр: прогресс подключения и жест «ладони».
  update(input) {
    if (this.view === 'connecting') {
      const b = this.root.querySelector('#mp-wait');
      if (b) b.style.width = `${Math.min(100, ((performance.now() - this.t0) / JOIN_TIMEOUT_MS) * 100)}%`;
    }
    if (this.view === 'lobby') {
      const b = this.root.querySelector('#mp-hold');
      if (b) b.style.width = `${Math.round((input.startHold || 0) * 100)}%`;
      if (input.startTrigger) {
        if (this.ctx.isHost) this.h.onStart();
        else this.h.onReady(!this.ready);
      }
    }
  }
}
