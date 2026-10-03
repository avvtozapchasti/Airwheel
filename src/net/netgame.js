// Мультиплеер по коду комнаты: лобби, старт, синхронизация, итоги.
//
// Хост-авторитетная модель:
//  - хост создаёт комнату (код из 5 символов), ведёт список игроков и настройки, запускает
//    квалификацию/гонку, ведёт ботов и погоду (seed), собирает итоговый протокол;
//  - каждый клиент сам симулирует свою машину и 20 раз в секунду шлёт хосту её состояние;
//    хост 20 раз в секунду рассылает снимок всех машин (игроки + боты) с меткой своего времени;
//  - часы: клиент меряет RTT пингом и считает смещение до часов хоста — старт отсчёта и
//    интерполяция чужих машин (−100 мс) идут по времени хоста;
//  - отключился игрок — его машину дальше ведёт бот; отключился хост — сообщение и выход в меню.
import { Transport, makeRoomCode, normalizeCode, isValidCode, MAX_PLAYERS, PROTOCOL } from './transport.js';
import { RemoteCar, decodeCar, encodeCar, encodeBot, INTERP_MS } from './remote.js';

export const JOIN_TIMEOUT_MS = 10000;
const SEND_HZ = 20;
const DROP_MS = 6000; // нет сообщений дольше — игрок (или хост) считается отключившимся
export const MP_COLORS = ['#ffb000', '#2f7cf6', '#e63946', '#18b89b', '#b14dff', '#ff7a00', '#ff4d8d', '#8ecae6'];

export const NET_ERRORS = {
  timeout: 'Не удалось подключиться. Проверь код или сеть.',
  full: 'Комната заполнена (максимум 8 игроков).',
  started: 'В этой комнате уже идёт гонка. Подожди её окончания.',
  version: 'У хоста другая версия игры. Обновите страницу у обоих.',
  hostLeft: 'Хост отключился. Сетевая игра завершена.',
  webrtc: 'Браузер не поддерживает WebRTC. Играй одному.',
  code: 'Код комнаты — 5 символов (буквы и цифры, без O, 0, I и 1).',
};

export class NetGame {
  // h: { onLobby(lobby), onStart(msg), onGrid(msg), onResults(rows), onError(text), onInfo(text), onPeerLeft(player) }
  constructor(h = {}) {
    this.h = h;
    this.role = null; // 'host' | 'client'
    this.code = null;
    this.t = null;
    this.myId = null;
    this.hostPeer = null;
    this.players = []; // [{id, peer, name, color, ready, host, ping}]
    this.settings = null;
    this.state = 'idle'; // idle | connecting | lobby | quali | race | results
    this.offset = 0; // время хоста − локальное, мс
    this.bestRtt = Infinity;
    this.rtt = null;
    this.rttSamples = [];
    this.remotes = new Map(); // id → RemoteCar
    this.sendT = 0;
    this.pingT = 0;
    this.reports = new Map();
    this.qtimes = new Map();
  }

  get isHost() {
    return this.role === 'host';
  }

  hostNow() {
    return performance.now() + (this.isHost ? 0 : this.offset);
  }

  // ---------- создание / вход ----------
  host(name, settings) {
    this.role = 'host';
    this.code = makeRoomCode();
    this.myId = 'h';
    this.settings = { ...settings, bots: settings.bots ?? true, quali: settings.quali ?? false };
    this.players = [{ id: 'h', peer: null, name, color: MP_COLORS[0], ready: true, host: true, ping: 0 }];
    this.openTransport();
    this.state = 'lobby';
    this.emitLobby();
    return this.code;
  }

  join(rawCode, name) {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) {
      this.fail(NET_ERRORS.code);
      return false;
    }
    this.role = 'client';
    this.code = code;
    this.myName = name;
    this.state = 'connecting';
    this.openTransport();
    this.joinTimer = setTimeout(() => {
      if (this.state === 'connecting') this.fail(NET_ERRORS.timeout);
    }, JOIN_TIMEOUT_MS);
    return true;
  }

  openTransport() {
    try {
      this.t = new Transport(this.code, {
        onPeerJoin: (peer) => this.onPeerJoin(peer),
        onPeerLeave: (peer) => this.onPeerLeave(peer),
        onMessage: (peer, msg) => this.onMessage(peer, msg),
        onState: (peer, msg) => this.onState(peer, msg),
        onError: (e) => console.warn('[net] join error', e),
      }).join();
    } catch (e) {
      console.warn(e);
      this.fail(NET_ERRORS.webrtc);
    }
  }

  fail(text) {
    const was = this.state;
    this.leave();
    this.h.onError?.(text, was);
  }

  leave() {
    clearTimeout(this.joinTimer);
    this.t?.leave();
    this.t = null;
    this.state = 'idle';
    this.role = null;
    this.remotes.clear();
  }

  // ---------- события транспорта ----------
  onPeerJoin(peer) {
    if (this.role === 'client' && this.state === 'connecting') this.t.send(peer, { t: 'hello', v: PROTOCOL, name: this.myName });
  }

  onPeerLeave(peer) {
    if (this.isHost) {
      const p = this.players.find((x) => x.peer === peer);
      if (!p) return;
      this.players = this.players.filter((x) => x !== p);
      this.h.onPeerLeft?.(p);
      this.t.broadcast({ t: 'left', id: p.id, name: p.name });
      this.emitLobby();
    } else if (peer === this.hostPeer) {
      this.fail(NET_ERRORS.hostLeft);
    }
  }

  onMessage(peer, m) {
    if (!m || typeof m !== 'object') return;
    this.seen(peer);
    if (this.isHost) return this.hostMessage(peer, m);
    return this.clientMessage(peer, m);
  }

  // ---------- хост ----------
  hostMessage(peer, m) {
    const p = this.players.find((x) => x.peer === peer);
    switch (m.t) {
      case 'hello': {
        if (p) return this.t.send(peer, { t: 'welcome', id: p.id, code: this.code });
        if (m.v !== PROTOCOL) return this.t.send(peer, { t: 'reject', reason: 'version' });
        if (this.state !== 'lobby') return this.t.send(peer, { t: 'reject', reason: 'started' });
        if (this.players.length >= MAX_PLAYERS) return this.t.send(peer, { t: 'reject', reason: 'full' });
        const id = 'p' + Math.random().toString(36).slice(2, 7);
        const used = new Set(this.players.map((x) => x.color));
        const color = MP_COLORS.find((c) => !used.has(c)) || MP_COLORS[this.players.length % MP_COLORS.length];
        const name = String(m.name || 'Игрок').slice(0, 16) || 'Игрок';
        this.players.push({ id, peer, name, color, ready: false, host: false, ping: null, seenAt: performance.now() });
        this.t.send(peer, { t: 'welcome', id, code: this.code });
        this.emitLobby();
        break;
      }
      case 'ready':
        if (p) {
          p.ready = !!m.ready;
          this.emitLobby();
        }
        break;
      case 'ping':
        this.t.send(peer, { t: 'pong', c: m.c, h: performance.now() });
        if (p && m.rtt != null) {
          p.ping = Math.round(m.rtt);
          this.pingDirty = true;
        }
        break;
      case 'qtime':
        if (p) this.qtimes.set(p.id, m.best ?? null);
        this.h.onQtime?.(p, m.best);
        break;
      case 'finish':
        if (p) this.reports.set(p.id, m.report);
        this.h.onReport?.(p, m.report);
        break;
    }
  }

  // Настройки лобби (только хост): трасса, класс, круги, погода, боты, квалификация.
  setSettings(patch) {
    if (!this.isHost) return;
    Object.assign(this.settings, patch);
    this.emitLobby();
  }

  lobbyMsg() {
    return { t: 'lobby', code: this.code, players: this.players.map(({ peer, ...x }) => x), settings: this.settings, state: this.state };
  }

  emitLobby() {
    const msg = this.lobbyMsg();
    if (this.isHost && this.t) this.t.broadcast(msg);
    this.h.onLobby?.(msg);
  }

  allReady() {
    return this.players.every((p) => p.ready || p.host);
  }

  // Хост: старт этапа. stage: 'quali' | 'race'. grid — порядок решётки [{id, kind, name, color}].
  start(stage, extra) {
    if (!this.isHost) return;
    this.state = stage;
    this.reports.clear();
    if (stage === 'quali') this.qtimes.clear();
    const msg = { t: 'start', stage, settings: this.settings, t0: this.hostNow() + (stage === 'race' ? 2500 : 1200), ...extra };
    this.t.broadcast(msg);
    this.h.onStart?.(msg);
    this.emitLobby();
  }

  sendResults(rows) {
    if (!this.isHost) return;
    this.state = 'results';
    this.t.broadcast({ t: 'results', rows });
    this.h.onResults?.(rows);
  }

  // Хост: вернуть всех в лобби (после итогов).
  backToLobby() {
    if (!this.isHost) return;
    this.state = 'lobby';
    for (const p of this.players) p.ready = p.host;
    this.t.broadcast({ t: 'tolobby' });
    this.emitLobby();
  }

  // ---------- клиент ----------
  clientMessage(peer, m) {
    switch (m.t) {
      case 'welcome':
        if (this.state !== 'connecting') return;
        clearTimeout(this.joinTimer);
        this.hostPeer = peer;
        this.hostSeenAt = performance.now();
        this.myId = m.id;
        this.state = 'lobby';
        this.ping();
        break;
      case 'reject':
        if (this.state === 'connecting') this.fail(NET_ERRORS[m.reason] || NET_ERRORS.timeout);
        break;
      default:
        if (peer !== this.hostPeer) return; // слушаем только хоста
        switch (m.t) {
          case 'lobby':
            this.players = m.players;
            this.settings = m.settings;
            this.h.onLobby?.(m);
            break;
          case 'pong': {
            const now = performance.now();
            const rtt = now - m.c;
            this.rtt = rtt;
            // смещение часов — по самым быстрым ответам (меньше всего искажено очередями)
            this.rttSamples.push({ rtt, off: m.h + rtt / 2 - now });
            if (this.rttSamples.length > 12) this.rttSamples.shift();
            const best = this.rttSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
            this.offset = best.off;
            break;
          }
          case 'start':
            this.state = m.stage;
            this.reports.clear();
            this.h.onStart?.(m);
            break;
          case 'grid':
            this.h.onGrid?.(m);
            break;
          case 'results':
            this.state = 'results';
            this.h.onResults?.(m.rows);
            break;
          case 'tolobby':
            this.state = 'lobby';
            this.h.onToLobby?.();
            break;
          case 'left':
            this.h.onPeerLeft?.({ id: m.id, name: m.name });
            break;
        }
    }
  }

  setReady(ready) {
    if (this.role !== 'client' || !this.hostPeer) return;
    this.t.send(this.hostPeer, { t: 'ready', ready });
  }

  sendQualiTime(best) {
    if (this.isHost) this.qtimes.set('h', best ?? null);
    else this.t?.send(this.hostPeer, { t: 'qtime', best });
  }

  sendFinish(report) {
    if (this.isHost) this.reports.set('h', report);
    else this.t?.send(this.hostPeer, { t: 'finish', report });
  }

  ping() {
    if (this.role !== 'client' || !this.hostPeer || !this.t) return;
    this.t.send(this.hostPeer, { t: 'ping', c: performance.now(), rtt: this.rtt });
  }

  // ---------- состояние машин ----------
  remote(id, spec, track) {
    let rc = this.remotes.get(id);
    if (!rc) {
      rc = new RemoteCar(spec, track);
      this.remotes.set(id, rc);
    }
    return rc;
  }

  // Последний раз, когда от пира что-то приходило (для heartbeat).
  seen(peer) {
    const now = performance.now();
    if (this.isHost) {
      const p = this.players.find((x) => x.peer === peer);
      if (p) p.seenAt = now;
    } else if (peer === this.hostPeer) this.hostSeenAt = now;
  }

  // Heartbeat: пинг раз в секунду, тишина дольше DROP_MS — отключение.
  checkAlive() {
    const now = performance.now();
    if (this.isHost) {
      for (const p of [...this.players]) if (!p.host && p.seenAt && now - p.seenAt > DROP_MS) this.onPeerLeave(p.peer);
    } else if (this.hostPeer && this.hostSeenAt && now - this.hostSeenAt > DROP_MS) this.fail(NET_ERRORS.hostLeft);
  }

  onState(peer, m) {
    if (!m) return;
    this.seen(peer);
    if (this.isHost) {
      // состояние машины клиента: на время хоста
      const p = this.players.find((x) => x.peer === peer);
      if (!p || !Array.isArray(m.c)) return;
      const rc = this.remotes.get(p.id);
      const now = this.hostNow();
      if (rc) rc.add(now, decodeCar(m.c));
      p.lastState = { t: now, c: m.c };
    } else if (peer === this.hostPeer && Array.isArray(m.c)) {
      for (const row of m.c) {
        const [id, age, ...enc] = row;
        if (id === this.myId) continue;
        const rc = this.remotes.get(id);
        if (rc) rc.add(m.ts - age, decodeCar(enc));
      }
    }
  }

  // Каждый кадр: пинг, рассылка состояния (20 Гц), выборка чужих машин на (время хоста − 100 мс).
  tick(dt, session) {
    if (!this.t) return;
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = 1;
      this.ping();
      if (this.isHost) this.t.broadcast({ t: 'hb' });
      this.checkAlive();
      if (!this.t) return;
      if (this.isHost && this.pingDirty && this.state === 'lobby') {
        this.pingDirty = false;
        this.emitLobby();
      }
    }
    if (!session) return;
    const now = this.hostNow();
    for (const rc of this.remotes.values()) rc.sample(now - INTERP_MS, dt);
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const me = session.player;
    if (!me) return;
    if (this.isHost) {
      // снимок: своя машина, боты, последние состояния клиентов (с возрастом)
      const rows = [];
      for (const e of session.entries) {
        if (e.isPlayer) rows.push([this.myId, 0, ...encodeCar(e.car, e)]);
        else if (e.bot) rows.push([e.id, 0, ...encodeBot(e.bot, e)]);
        else if (e.human) {
          const p = this.players.find((x) => x.id === e.id);
          if (p?.lastState) rows.push([e.id, Math.round(now - p.lastState.t), ...p.lastState.c]);
        }
      }
      this.t.sendState(null, { ts: Math.round(now), c: rows });
    } else {
      this.t.sendState(this.hostPeer, { c: encodeCar(me.car, me) });
    }
  }

  myPing() {
    return this.isHost ? null : this.rtt;
  }
}
