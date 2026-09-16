/**
 * POLYARENA — 바이너리 네트워크 프로토콜
 *
 * JSON은 스냅샷 하나가 10KB를 넘어 30Hz로는 감당이 안 된다.
 * 여기서 인코딩과 디코딩을 한 파일에 같이 두어 서버/클라이언트가 어긋날 수 없게 한다.
 */

// ── 오피코드 ──────────────────────────────────────────────────
export const C2S = {
  INPUT: 1,   // 이동/조준/사격
  SPAWN: 2,   // 닉네임과 함께 참전
  STAT: 3,    // 스탯 포인트 투자
  CLASS: 4,   // 클래스 승급
  PING: 5,
};

export const S2C = {
  WELCOME: 1,
  SNAPSHOT: 2,
  NAMES: 3,
  LEADERBOARD: 4,
  DEATH: 5,
  PONG: 6,
  ERROR: 7,
};

export const IN = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8,
  FIRE: 16, AUTOFIRE: 32, AUTOSPIN: 64,
};

export const ENTITY_BYTES = 12;
export const COLOR_MINE = 0x80; // color 바이트의 최상위 비트 = "내 것"

const TWO_PI = Math.PI * 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function packAngle(a) {
  let t = a % TWO_PI;
  if (t < 0) t += TWO_PI;
  return Math.round((t / TWO_PI) * 65535) & 0xffff;
}
export function unpackAngle(v) {
  return (v / 65535) * TWO_PI;
}

// ── 버퍼 유틸 ─────────────────────────────────────────────────
export class Writer {
  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.off = 0;
  }
  _need(n) {
    if (this.off + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.off + n) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v)  { this._need(1); this.view.setUint8(this.off, v); this.off += 1; return this; }
  i8(v)  { this._need(1); this.view.setInt8(this.off, v); this.off += 1; return this; }
  u16(v) { this._need(2); this.view.setUint16(this.off, v); this.off += 2; return this; }
  i16(v) { this._need(2); this.view.setInt16(this.off, v); this.off += 2; return this; }
  u32(v) { this._need(4); this.view.setUint32(this.off, v); this.off += 4; return this; }
  f32(v) { this._need(4); this.view.setFloat32(this.off, v); this.off += 4; return this; }
  f64(v) { this._need(8); this.view.setFloat64(this.off, v); this.off += 8; return this; }
  str(s) {
    const bytes = encoder.encode(String(s ?? '').slice(0, 64));
    this._need(1 + bytes.length);
    this.view.setUint8(this.off, bytes.length);
    this.off += 1;
    new Uint8Array(this.buf).set(bytes, this.off);
    this.off += bytes.length;
    return this;
  }
  done() { return this.buf.slice(0, this.off); }
}

export class Reader {
  constructor(buf) {
    this.u8arr = new Uint8Array(buf);
    this.view = new DataView(buf);
    this.off = 0;
  }
  get remaining() { return this.view.byteLength - this.off; }
  u8()  { const v = this.view.getUint8(this.off);  this.off += 1; return v; }
  i8()  { const v = this.view.getInt8(this.off);   this.off += 1; return v; }
  u16() { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  i16() { const v = this.view.getInt16(this.off);  this.off += 2; return v; }
  u32() { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  f32() { const v = this.view.getFloat32(this.off);this.off += 4; return v; }
  f64() { const v = this.view.getFloat64(this.off);this.off += 8; return v; }
  str() {
    const len = this.u8();
    const s = decoder.decode(this.u8arr.subarray(this.off, this.off + len));
    this.off += len;
    return s;
  }
}

// ── 클라이언트 → 서버 ─────────────────────────────────────────
/**
 * 조준각만으로는 "마우스가 얼마나 멀리 있는지" 를 알 수 없다.
 * 드론에게 목표 지점을 지시하려면 거리가 필요해 2바이트를 더 싣는다.
 */
export function encodeInput(flags, aimAngle, aimDist, seq) {
  const w = new Writer(12);
  const d = Math.max(0, Math.min(65535, Math.round(aimDist) || 0));
  w.u8(C2S.INPUT).u8(flags).u16(packAngle(aimAngle)).u16(d).u16(seq & 0xffff);
  return w.done();
}
export function encodeSpawn(name) {
  const w = new Writer(80);
  w.u8(C2S.SPAWN).str(name);
  return w.done();
}
export function encodeStat(index) {
  const w = new Writer(4);
  w.u8(C2S.STAT).u8(index);
  return w.done();
}
export function encodeClass(classId) {
  const w = new Writer(4);
  w.u8(C2S.CLASS).u8(classId);
  return w.done();
}
export function encodePing(t) {
  const w = new Writer(16);
  w.u8(C2S.PING).f64(t);
  return w.done();
}

// ── 서버 → 클라이언트 ─────────────────────────────────────────
export function encodeWelcome(playerId, arenaSize, tickRate) {
  const w = new Writer(16);
  w.u8(S2C.WELCOME).u16(playerId).u16(arenaSize).u8(tickRate);
  return w.done();
}
export function decodeWelcome(r) {
  return { playerId: r.u16(), arenaSize: r.u16(), tickRate: r.u8() };
}

/**
 * 스냅샷.
 *   self     내 탱크의 전체 상태 (매 틱 갱신, 크기가 작아 압축 불필요)
 *   entities 시야 안의 엔티티 (12바이트 고정)
 */
export function writeSnapshot(w, tick, ackSeq, self, entities, count) {
  w.u8(S2C.SNAPSHOT);
  w.u32(tick >>> 0);
  w.u16(ackSeq & 0xffff);

  w.u8(self.alive ? 1 : 0);
  w.i16(Math.round(self.x));
  w.i16(Math.round(self.y));
  w.f32(self.vx);
  w.f32(self.vy);
  w.f32(self.health);
  w.f32(self.maxHealth);
  w.u8(self.level);
  w.f32(self.xp);
  w.f32(self.xpNeed);
  w.u32(self.score >>> 0);
  w.u8(self.points);
  for (let i = 0; i < 8; i++) w.u8(self.stats[i]);
  w.u8(self.classId);
  w.u8(self.choices.length);
  for (const c of self.choices) w.u8(c);

  w.u16(count);
  for (let i = 0; i < count; i++) {
    const e = entities[i];
    w.u8(e.kind);
    w.u16(e.id);
    w.i16(e.x);
    w.i16(e.y);
    w.u16(e.angle);
    w.u8(e.radius);
    w.u8(e.hp);
    w.u8(e.color);
    w.u8(e.sub);
    w.u8(e.alpha);
  }
}

export function readSnapshot(r) {
  const tick = r.u32();
  const ackSeq = r.u16();

  const self = {
    alive: r.u8() === 1,
    x: r.i16(),
    y: r.i16(),
    vx: r.f32(),
    vy: r.f32(),
    health: r.f32(),
    maxHealth: r.f32(),
    level: r.u8(),
    xp: r.f32(),
    xpNeed: r.f32(),
    score: r.u32(),
    points: r.u8(),
    stats: new Array(8),
    classId: 0,
    choices: [],
  };
  for (let i = 0; i < 8; i++) self.stats[i] = r.u8();
  self.classId = r.u8();
  const nChoices = r.u8();
  for (let i = 0; i < nChoices; i++) self.choices.push(r.u8());

  const count = r.u16();
  const entities = new Array(count);
  for (let i = 0; i < count; i++) {
    entities[i] = {
      kind: r.u8(),
      id: r.u16(),
      x: r.i16(),
      y: r.i16(),
      angle: unpackAngle(r.u16()),
      radius: r.u8(),
      hp: r.u8() / 255,
      color: r.u8(),
      sub: r.u8(),
      alpha: r.u8() / 255,
    };
  }
  return { tick, ackSeq, self, entities };
}

export function encodeNames(list) {
  const w = new Writer(1024);
  w.u8(S2C.NAMES).u8(Math.min(list.length, 255));
  for (let i = 0; i < Math.min(list.length, 255); i++) {
    w.u16(list[i].id).str(list[i].name);
  }
  return w.done();
}
export function decodeNames(r) {
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: r.u16(), name: r.str() });
  return out;
}

export function encodeLeaderboard(rows) {
  const w = new Writer(1024);
  w.u8(S2C.LEADERBOARD).u8(rows.length);
  for (const row of rows) {
    w.u16(row.id).u32(row.score >>> 0).u8(row.level).u8(row.classId).str(row.name);
  }
  return w.done();
}
export function decodeLeaderboard(r) {
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: r.u16(),
      score: r.u32(),
      level: r.u8(),
      classId: r.u8(),
      name: r.str(),
    });
  }
  return out;
}

export function encodeDeath(score, level, timeAlive, killer) {
  const w = new Writer(128);
  w.u8(S2C.DEATH).u32(score >>> 0).u8(level).u32(Math.round(timeAlive)).str(killer);
  return w.done();
}
export function decodeDeath(r) {
  return {
    score: r.u32(),
    level: r.u8(),
    timeAlive: r.u32(),
    killer: r.str(),
  };
}

export function encodePong(clientTime, serverTime) {
  const w = new Writer(24);
  w.u8(S2C.PONG).f64(clientTime).f64(serverTime);
  return w.done();
}

export function encodeError(message) {
  const w = new Writer(128);
  w.u8(S2C.ERROR).str(message);
  return w.done();
}
