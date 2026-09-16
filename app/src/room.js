import { World } from './game/world.js';
import { sanitizeName } from './game/player.js';
import {
  C2S, Reader, Writer, unpackAngle,
  encodeWelcome, encodeNames, encodeLeaderboard, encodeDeath, encodePong, encodeError,
} from '../public/shared/protocol.js';
import {
  TICK_MS, TICK_RATE, DT, ARENA_SIZE, ARENA_HALF, MAX_PLAYERS,
} from '../public/shared/config.js';

/** 소켓 하나가 1초에 보낼 수 있는 최대 메시지 수 (30Hz 입력 + 여유) */
const MSG_BUDGET_PER_SEC = 120;

/**
 * 게임 룸 = Durable Object 인스턴스 1개.
 * 룸 안의 모든 상태가 이 객체 하나에 있으므로 락도, 경쟁 상태도 없다.
 */
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.world = new World();
    this.sockets = new Map();   // WebSocket -> ctx
    this.loop = null;
    this.lastRoster = -1;
    this.leaderTimer = 0;
    this.writer = new Writer(16384);

    // 타이머는 요청한 만큼 정확히 안 온다. 실제 경과 시간을 누적해
    // 고정 스텝(DT)을 필요한 횟수만큼 돌린다 → 시뮬레이션 속도가 타이머에 흔들리지 않는다.
    this.accum = 0;
    this.lastTickAt = 0;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('이 엔드포인트는 WebSocket 전용입니다.', { status: 426 });
    }
    if (this.world.realPlayerCount >= MAX_PLAYERS) {
      return new Response('방이 가득 찼습니다.', { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 하이버네이션 API 대신 일반 accept() 를 쓴다.
    // 연결이 살아있는 동안 DO가 메모리에 상주해야 setInterval 게임 루프가 유지되기 때문.
    server.accept();
    this.onOpen(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  onOpen(ws) {
    const player = this.world.addPlayer('무명의 탱크');
    if (!player) {
      try { ws.send(encodeError('방이 가득 찼습니다.')); ws.close(1013, 'full'); } catch {}
      return;
    }

    // 아직 참전 전이어도 카메라는 아레나 어딘가를 비춘다 (메뉴 배경이 살아있게)
    player.x = (Math.random() * 2 - 1) * ARENA_HALF * 0.6;
    player.y = (Math.random() * 2 - 1) * ARENA_HALF * 0.6;

    const ctx = { player, deathSent: false, budget: MSG_BUDGET_PER_SEC, budgetAt: Date.now() };
    this.sockets.set(ws, ctx);

    ws.addEventListener('message', (ev) => {
      try {
        this.onMessage(ws, ctx, ev.data);
      } catch (err) {
        console.error('메시지 처리 실패', err);
      }
    });
    const close = () => this.onClose(ws);
    ws.addEventListener('close', close);
    ws.addEventListener('error', close);

    this.send(ws, encodeWelcome(player.id, ARENA_SIZE, TICK_RATE));
    this.send(ws, encodeNames(this.world.roster()));
    this.startLoop();
  }

  onClose(ws) {
    const ctx = this.sockets.get(ws);
    if (!ctx) return;
    this.sockets.delete(ws);
    this.world.removePlayer(ctx.player.id);
    if (this.sockets.size === 0) this.stopLoop();
  }

  onMessage(ws, ctx, data) {
    if (typeof data === 'string') return;          // 텍스트 프레임은 쓰지 않는다

    // 간단한 유량 제한 — 입력 스팸으로 룸 전체를 느리게 만들지 못하게
    const now = Date.now();
    if (now - ctx.budgetAt >= 1000) { ctx.budgetAt = now; ctx.budget = MSG_BUDGET_PER_SEC; }
    if (--ctx.budget < 0) return;

    // 어떤 이유로든 루프가 멈춰 있으면 되살린다 (연결은 살아있는데 틱이 죽는 상황 방지)
    if (!this.loop && this.sockets.size > 0) this.startLoop();

    const r = new Reader(data);
    if (r.remaining < 1) return;
    const op = r.u8();
    const p = ctx.player;

    switch (op) {
      case C2S.INPUT: {
        if (r.remaining < 7) return;
        const flags = r.u8();
        const angle = unpackAngle(r.u16());
        const dist = r.u16();
        const seq = r.u16();
        p.setInput(flags, angle, dist, seq);
        break;
      }
      case C2S.SPAWN: {
        if (p.alive) return;
        p.name = sanitizeName(r.str());
        p.resetProgress();
        p.spawn(this.world.time);
        ctx.deathSent = false;
        this.world.rosterVersion++;
        break;
      }
      case C2S.STAT:
        if (r.remaining >= 1) p.spendStat(r.u8());
        break;
      case C2S.CLASS:
        if (r.remaining >= 1) p.chooseClass(r.u8());
        break;
      case C2S.PING:
        if (r.remaining >= 8) this.send(ws, encodePong(r.f64(), Date.now()));
        break;
      default:
        break;
    }
  }

  // ── 루프 ───────────────────────────────────────────────────
  startLoop() {
    if (this.loop) return;
    this.lastTickAt = Date.now();
    this.accum = 0;
    this.loop = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        console.error('틱 실패', err);
      }
    }, TICK_MS);
  }

  stopLoop() {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  tick() {
    // 타이머가 늦게 왔으면 밀린 만큼 여러 스텝을 돌려 따라잡는다.
    // (탭 복귀·일시적 부하 뒤 폭주하지 않도록 한 번에 최대 4스텝)
    const now = Date.now();
    const elapsed = Math.min((now - this.lastTickAt) / 1000, 0.25);
    this.lastTickAt = now;
    this.accum += elapsed;

    let steps = 0;
    while (this.accum >= DT && steps < 4) {
      this.world.step(DT);
      this.accum -= DT;
      steps++;
    }
    if (steps === 0) return;        // 아직 한 스텝도 못 채웠으면 전송할 것도 없다
    if (this.accum > DT * 4) this.accum = 0;

    // 사망 알림 (한 번만)
    for (const ctx of this.sockets.values()) {
      const p = ctx.player;
      if (p.alive) ctx.deathSent = false;
    }
    for (const [ws, ctx] of this.sockets) {
      const p = ctx.player;
      if (!p.alive && !ctx.deathSent && p.spawnTime > 0) {
        ctx.deathSent = true;
        this.send(ws, encodeDeath(
          Math.round(p.score),
          p.level,
          Math.round((this.world.time - p.spawnTime) * 1000),
          p.killerName || '아레나'
        ));
      }
    }

    // 참가자 목록이 바뀔 때만 이름을 보낸다
    if (this.world.rosterVersion !== this.lastRoster) {
      this.lastRoster = this.world.rosterVersion;
      this.broadcast(encodeNames(this.world.roster()));
    }

    // 리더보드는 0.5초마다 (한 번에 여러 스텝을 돌렸을 수 있으므로 그만큼 차감)
    this.leaderTimer -= steps * DT;
    if (this.leaderTimer <= 0) {
      this.leaderTimer = 0.5;
      this.broadcast(encodeLeaderboard(this.world.leaderboard()));
    }

    // 스냅샷 — 플레이어마다 시야가 다르므로 개별 생성
    const w = this.writer;
    for (const [ws, ctx] of this.sockets) {
      w.off = 0;
      this.world.buildSnapshot(w, ctx.player);
      this.send(ws, w.done());
    }
  }

  send(ws, buf) {
    try {
      ws.send(buf);
    } catch {
      this.onClose(ws);
    }
  }

  broadcast(buf) {
    for (const ws of this.sockets.keys()) this.send(ws, buf);
  }
}
