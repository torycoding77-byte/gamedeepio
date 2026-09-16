import {
  S2C, Reader,
  encodeInput, encodeSpawn, encodeStat, encodeClass, encodePing,
  readSnapshot, decodeWelcome, decodeNames, decodeLeaderboard, decodeDeath,
} from '../shared/protocol.js';

/**
 * 서버와의 유일한 접점.
 * 이 클래스 밖에서는 바이너리를 만질 일이 없다.
 */
export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.seq = 0;
    this.ping = 0;
    this.connected = false;
    this.retryDelay = 500;
    this.pingTimer = null;
    this.closedByUser = false;
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const room = new URLSearchParams(location.search).get('room') || 'main';
    return `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}`;
  }

  connect() {
    this.closedByUser = false;
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      this.h.onStatus?.('연결할 수 없습니다.');
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.retryDelay = 500;
      this.h.onOpen?.();
      this.pingTimer = setInterval(() => this.sendPing(), 2000);
      this.sendPing();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return;
      try {
        this.handle(ev.data);
      } catch (err) {
        console.error('패킷 해석 실패', err);
      }
    };

    ws.onclose = () => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.h.onClose?.();
      if (!this.closedByUser) this.scheduleRetry();
    };

    ws.onerror = () => { /* onclose 가 뒤따라 온다 */ };
  }

  scheduleRetry() {
    this.h.onStatus?.(`연결이 끊겼습니다. ${(this.retryDelay / 1000).toFixed(1)}초 후 재시도…`);
    setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.8, 8000);
  }

  handle(buf) {
    const r = new Reader(buf);
    const op = r.u8();
    switch (op) {
      case S2C.WELCOME:
        this.h.onWelcome?.(decodeWelcome(r));
        break;
      case S2C.SNAPSHOT:
        this.h.onSnapshot?.(readSnapshot(r));
        break;
      case S2C.NAMES:
        this.h.onNames?.(decodeNames(r));
        break;
      case S2C.LEADERBOARD:
        this.h.onLeaderboard?.(decodeLeaderboard(r));
        break;
      case S2C.DEATH:
        this.h.onDeath?.(decodeDeath(r));
        break;
      case S2C.PONG: {
        const clientTime = r.f64();
        r.f64(); // serverTime — 시계 동기화는 하지 않는다
        this.ping = Math.round(performance.now() - clientTime);
        break;
      }
      case S2C.ERROR:
        this.h.onStatus?.(r.str());
        break;
    }
  }

  // ── 송신 ───────────────────────────────────────────────────
  _send(buf) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
  }
  sendInput(flags, aim, aimDist) {
    this.seq = (this.seq + 1) & 0xffff;
    this._send(encodeInput(flags, aim, aimDist, this.seq));
    return this.seq;
  }
  sendSpawn(name)    { this._send(encodeSpawn(name)); }
  sendStat(index)    { this._send(encodeStat(index)); }
  sendClass(classId) { this._send(encodeClass(classId)); }
  sendPing()         { this._send(encodePing(performance.now())); }
}
