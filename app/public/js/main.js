import { Net } from './net.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { IN } from '../shared/protocol.js';
import { tankById } from '../shared/tanks.js';
import {
  ARENA_HALF, CONTROL_ACCEL, moveSpeedFor, tankRadius, MAX_AIM_DIST,
} from '../shared/config.js';

/** 스냅샷 사이를 메우기 위한 렌더 지연. 지터를 흡수하는 대신 이만큼 과거를 본다. */
const INTERP_DELAY = 110;
const SNAPSHOT_KEEP = 24;
const INPUT_INTERVAL = 1000 / 30;

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);

const state = {
  playerId: 0,
  myName: '무명의 탱크',
  self: null,
  predicted: { x: 0, y: 0, vx: 0, vy: 0 },
  aim: 0,
  aimDist: 0,      // 마우스까지의 월드 거리 — 드론에게 "여기로" 를 지시할 때 쓴다
  names: new Map(),
  entities: [],
  snapshots: [],
  playing: false,
  cameraReady: false,
};

const renderPool = new Map();

// ── 네트워크 ──────────────────────────────────────────────────
const net = new Net({
  onOpen: () => ui.setConnected(true),
  onClose: () => { ui.setConnected(false); state.playing = false; },
  onStatus: (msg) => ui.setStatus(msg),

  onWelcome: ({ playerId }) => {
    state.playerId = playerId;
  },

  onNames: (list) => {
    state.names.clear();
    for (const n of list) state.names.set(n.id, n.name);
    const mine = state.names.get(state.playerId);
    if (mine) state.myName = mine;
  },

  onLeaderboard: (rows) => ui.updateLeaderboard(rows, state.playerId),

  onSnapshot: (snap) => {
    state.self = snap.self;

    const map = new Map();
    for (const e of snap.entities) map.set(e.id, e);
    state.snapshots.push({ t: performance.now(), map });
    if (state.snapshots.length > SNAPSHOT_KEEP) state.snapshots.shift();

    reconcile(snap.self);

    if (snap.self.alive) {
      state.playing = true;
      ui.updateStats(snap.self);
      ui.updateBars(snap.self, state.myName);
      ui.updateClassPicker(snap.self.choices);
    }
  },

  onDeath: (info) => {
    state.playing = false;
    ui.showDeath(info);
  },
});

/** 서버 값으로 예측 위치를 부드럽게 끌어당긴다 */
function reconcile(self) {
  const p = state.predicted;
  if (!state.cameraReady) {
    p.x = self.x; p.y = self.y;
    p.vx = self.vx; p.vy = self.vy;
    renderer.cam.x = self.x;
    renderer.cam.y = self.y;
    state.cameraReady = true;
    return;
  }

  const ex = self.x - p.x;
  const ey = self.y - p.y;
  if (Math.hypot(ex, ey) > 380) {
    // 리스폰·순간이동 등 — 보정으로 못 따라잡을 격차는 그냥 맞춘다
    p.x = self.x; p.y = self.y;
  } else {
    p.x += ex * 0.35;
    p.y += ey * 0.35;
  }
  p.vx += (self.vx - p.vx) * 0.5;
  p.vy += (self.vy - p.vy) * 0.5;
}

// ── UI ────────────────────────────────────────────────────────
const ui = new UI({
  onSpawn: (name) => {
    state.myName = name.trim() || '무명의 탱크';
    net.sendSpawn(state.myName);
  },
  onStat: (index) => {
    if (state.self && state.self.points > 0) net.sendStat(index);
  },
  onClass: (id) => net.sendClass(id),
});

// ── 입력 ──────────────────────────────────────────────────────
const input = new Input(canvas, {
  onStat: (index) => {
    if (state.self && state.self.points > 0) net.sendStat(index);
  },
});
input.enabled = true;
ui.showTouchControls(input.touchMode);

// ── 예측 ──────────────────────────────────────────────────────
function predict(dt) {
  const s = state.self;
  if (!s || !s.alive) return;

  const tank = tankById(s.classId);
  const maxSpeed = moveSpeedFor(s.level, s.stats, tank.speedMult);

  const f = input.flags();
  let ax = 0, ay = 0;
  if (f & IN.UP) ay -= 1;
  if (f & IN.DOWN) ay += 1;
  if (f & IN.LEFT) ax -= 1;
  if (f & IN.RIGHT) ax += 1;
  const len = Math.hypot(ax, ay);
  if (len > 0) { ax /= len; ay /= len; }

  const p = state.predicted;
  const k = Math.min(1, CONTROL_ACCEL * dt);
  p.vx += (ax * maxSpeed - p.vx) * k;
  p.vy += (ay * maxSpeed - p.vy) * k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  const lim = ARENA_HALF - tankRadius(s.level);
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.y = Math.max(-lim, Math.min(lim, p.y));
}

// ── 보간 ──────────────────────────────────────────────────────
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function interpolate(now) {
  const snaps = state.snapshots;
  if (snaps.length === 0) { state.entities = []; return; }

  const target = now - INTERP_DELAY;

  let older = null, newer = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= target) { older = snaps[i]; newer = snaps[i + 1] ?? null; break; }
  }
  if (!older) { older = snaps[0]; newer = snaps[1] ?? null; }
  if (!newer) { newer = older; }

  const span = newer.t - older.t;
  const t = span > 0 ? Math.max(0, Math.min(1, (target - older.t) / span)) : 1;

  if (renderPool.size > 1400) renderPool.clear();

  const out = [];
  for (const [id, b] of newer.map) {
    let o = renderPool.get(id);
    if (!o) {
      o = { kind: 0, id, x: 0, y: 0, angle: 0, radius: 0, hp: 1, color: 0, sub: 0, alpha: 1 };
      renderPool.set(id, o);
    }
    const a = older.map.get(id);
    o.kind = b.kind;
    o.color = b.color;
    o.sub = b.sub;
    if (a && a.kind === b.kind) {
      o.x = a.x + (b.x - a.x) * t;
      o.y = a.y + (b.y - a.y) * t;
      o.angle = lerpAngle(a.angle, b.angle, t);
      o.radius = a.radius + (b.radius - a.radius) * t;
      o.hp = a.hp + (b.hp - a.hp) * t;
      o.alpha = a.alpha + (b.alpha - a.alpha) * t;
    } else {
      o.x = b.x; o.y = b.y; o.angle = b.angle;
      o.radius = b.radius; o.hp = b.hp; o.alpha = b.alpha;
    }
    out.push(o);
  }
  state.entities = out;
}

// ── 조준 ──────────────────────────────────────────────────────
function updateAim() {
  if (input.touchMode && (input.aimStick.dx || input.aimStick.dy)) {
    state.aim = Math.atan2(input.aimStick.dy, input.aimStick.dx);
    // 터치는 거리를 알 수 없으므로 스틱을 민 정도를 거리로 환산한다
    const push = Math.min(1, Math.hypot(input.aimStick.dx, input.aimStick.dy));
    state.aimDist = 300 + push * 900;
    return;
  }
  const w = renderer.screenToWorld(input.mouse.x, input.mouse.y);
  const dx = w.x - state.predicted.x;
  const dy = w.y - state.predicted.y;
  if (dx * dx + dy * dy > 4) state.aim = Math.atan2(dy, dx);
  state.aimDist = Math.min(MAX_AIM_DIST, Math.hypot(dx, dy));
}

// ── 메인 루프 ─────────────────────────────────────────────────
let lastFrame = performance.now();
let inputAccum = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const self = state.self;
  const tank = self ? tankById(self.classId) : tankById(0);
  renderer.updateScale(self ? self.level : 1, tank.fov);

  predict(dt);
  updateAim();

  // 카메라: 살아있으면 예측 위치, 죽었으면 서버가 알려준 마지막 위치
  const camTargetX = self && self.alive ? state.predicted.x : (self ? self.x : 0);
  const camTargetY = self && self.alive ? state.predicted.y : (self ? self.y : 0);
  const ck = Math.min(1, 14 * dt);
  renderer.cam.x += (camTargetX - renderer.cam.x) * ck;
  renderer.cam.y += (camTargetY - renderer.cam.y) * ck;

  // 입력은 30Hz 로만 보낸다 (프레임레이트가 144든 30이든 서버가 받는 양은 같다)
  inputAccum += dt * 1000;
  if (inputAccum >= INPUT_INTERVAL) {
    inputAccum %= INPUT_INTERVAL;
    if (net.connected) net.sendInput(input.flags(), state.aim, state.aimDist);
  }

  interpolate(now);
  renderer.render(state);
  ui.setPing(net.ping);
}

addEventListener('resize', () => renderer.resize());
addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 120));

net.connect();
requestAnimationFrame(frame);
