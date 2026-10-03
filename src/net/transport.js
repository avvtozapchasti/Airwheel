// Сетевой транспорт: WebRTC peer-to-peer без своего сервера (Trystero).
// Сигнализация (обмен SDP) идёт через несколько публичных Nostr-реле параллельно — нет
// единой точки отказа, работает со статического хостинга (Vercel). Дальше данные идут
// напрямую между браузерами по DataChannel, зашифрованно.
// NAT: публичные STUN (Google, Cloudflare, Twilio) + бесплатный TURN Open Relay (Metered)
// для сетей, где прямое соединение невозможно.
import { joinRoom, selfId } from 'trystero/nostr';

export const APP_ID = 'airwheel-racing-mp-v2';
export const PROTOCOL = 2;
export const MAX_PLAYERS = 8;

// Код комнаты: 5 символов без путающихся O/0/I/1.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode() {
  let s = '';
  const rnd = new Uint32Array(5);
  crypto.getRandomValues(rnd);
  for (let k = 0; k < 5; k++) s += ALPHABET[rnd[k] % ALPHABET.length];
  return s;
}
export function normalizeCode(raw) {
  return [...String(raw || '').toUpperCase()]
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, 5);
}
export const isValidCode = (c) => c.length === 5 && [...c].every((ch) => ALPHABET.includes(ch));

export const TURN = [
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
// Nostr-реле для сигнализации: крупные публичные, проверенные на доступность. Подключаемся
// ко всем сразу — комната находится, даже если часть реле недоступна.
export const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr.mom', 'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://nostr-pub.wellorder.net', 'wss://offchain.pub', 'wss://nostr.oxtr.dev', 'wss://purplerelay.com'];
export const STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'stun:global.stun.twilio.com:3478', 'stun:stun.relay.metered.ca:80'];

export { selfId };

// Комната: ctl — надёжные сообщения (лобби, старт, итоги), st — состояние машин 20 раз в секунду.
export class Transport {
  constructor(code, { onPeerJoin, onPeerLeave, onMessage, onState, onError } = {}) {
    this.code = code;
    this.h = { onPeerJoin, onPeerLeave, onMessage, onState, onError };
    this.peers = new Set();
    this.room = null;
  }

  join() {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC недоступен в этом браузере');
    this.room = joinRoom(
      {
        appId: APP_ID,
        turnConfig: TURN,
        rtcConfig: { iceServers: STUN.map((urls) => ({ urls })) },
        relayConfig: { urls: RELAYS, redundancy: RELAYS.length },
      },
      'room-' + this.code,
      { onJoinError: (d) => this.h.onError?.(d?.error || 'join') },
    );
    this.ctl = this.room.makeAction('ctl');
    this.st = this.room.makeAction('st');
    this.ctl.onMessage = (data, ctx) => this.safe(() => this.h.onMessage?.(ctx.peerId, data));
    this.st.onMessage = (data, ctx) => this.safe(() => this.h.onState?.(ctx.peerId, data));
    this.room.onPeerJoin = (id) => {
      this.peers.add(id);
      this.safe(() => this.h.onPeerJoin?.(id));
    };
    this.room.onPeerLeave = (id) => {
      this.peers.delete(id);
      this.safe(() => this.h.onPeerLeave?.(id));
    };
    return this;
  }

  safe(fn) {
    try {
      fn();
    } catch (e) {
      console.error('[net]', e);
    }
  }

  send(to, msg) {
    if (!this.room) return;
    this.ctl.send(msg, to ? { target: to } : undefined).catch(() => {});
  }

  broadcast(msg) {
    this.send(null, msg);
  }

  sendState(to, data) {
    if (!this.room) return;
    this.st.send(data, to ? { target: to } : undefined).catch(() => {});
  }

  async ping(id) {
    try {
      return await this.room.ping(id);
    } catch {
      return null;
    }
  }

  leave() {
    const r = this.room;
    this.room = null;
    this.peers.clear();
    r?.leave().catch(() => {});
  }
}
