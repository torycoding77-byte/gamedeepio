import {
  KIND, ARENA_HALF, DT, SHAPE_TARGET, SHAPE_TYPES, BOT_FILL,
  MAX_ENTITIES_IN_VIEW, VIEW_MARGIN, VIEW_ASPECT, viewWidthFor,
  PUSH_STRENGTH, BODY_DAMAGE_RATE, MAX_PLAYERS,
  BOSS_COUNT, BOSS_RESPAWN_DELAY, BOSS_RADIUS,
  ALPHA_TYPE, ALPHA_COUNT, ALPHA_ZONE,
  DRONE_SPEED, DRONE_ACCEL, DRONE_ORBIT_RADIUS, DRONE_ORBIT_SPEED,
  DRONE_SEEK_RANGE, DRONE_LEASH,
} from '../../public/shared/config.js';
import { tankById } from '../../public/shared/tanks.js';
import { COLOR_MINE, packAngle, writeSnapshot } from '../../public/shared/protocol.js';
import { SpatialGrid } from './grid.js';
import { Bullet, Shape, randomShapeType } from './entities.js';
import { Player } from './player.js';
import { Bot } from './bot.js';
import { Defender } from './boss.js';

/** 아레나에서 가능한 최대 반지름 (충돌 질의 여유분). 보스가 가장 크다. */
const MAX_RADIUS = Math.max(BOSS_RADIUS, ...SHAPE_TYPES.map((t) => t.radius));

/** 총알·트랩·드론은 같은 경로로 처리된다 (전부 bullets 맵에 산다) */
const isProjectile = (kind) =>
  kind === KIND.BULLET || kind === KIND.TRAP || kind === KIND.DRONE;

/** 선분(p→q)과 원(c, r)이 만나는가 — 빠른 총알의 터널링 방지 */
function segmentHitsCircle(px, py, qx, qy, cx, cy, r) {
  const dx = qx - px, dy = qy - py;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((cx - px) * dx + (cy - py) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const ex = px + dx * t - cx;
  const ey = py + dy * t - cy;
  return ex * ex + ey * ey <= r * r;
}

export class World {
  constructor() {
    this.grid = new SpatialGrid();
    this.players = new Map();
    this.bullets = new Map();
    this.shapes = new Map();
    this.bosses = new Map();
    this.turrets = new Map();   // 보스에 얹힌 포탑 (피격 판정 없음, 렌더링용)
    this.bossRespawnAt = 0;
    this.used = new Set();      // 사용 중인 ID 전체

    this.nextId = 1;
    this.tick = 0;
    this.time = 0;              // 초
    this.rosterVersion = 0;

    this._q = [];
    this._q2 = [];      // 드론 목표 탐색용 (다른 질의와 겹치지 않게 분리)
    this._solids = [];
    this._snapBuf = [];

    for (let i = 0; i < SHAPE_TARGET - ALPHA_COUNT; i++) this.spawnShape(true);
    for (let i = 0; i < ALPHA_COUNT; i++) this.spawnAlpha();
    for (let i = 0; i < BOSS_COUNT; i++) this.spawnBoss();
  }

  // ── ID ─────────────────────────────────────────────────────
  allocId() {
    for (let i = 0; i < 65535; i++) {
      this.nextId = (this.nextId + 1) & 0xffff;
      if (this.nextId === 0) this.nextId = 1;
      if (!this.used.has(this.nextId)) {
        this.used.add(this.nextId);
        return this.nextId;
      }
    }
    throw new Error('엔티티 ID 고갈');
  }
  freeId(id) { this.used.delete(id); }

  // ── 참가자 ─────────────────────────────────────────────────
  get realPlayerCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  addPlayer(name) {
    if (this.realPlayerCount >= MAX_PLAYERS) return null;
    const p = new Player(this, this.allocId(), name, false);
    this.players.set(p.id, p);
    this.rosterVersion++;
    return p;
  }

  addBot() {
    const b = new Bot(this, this.allocId());
    this.players.set(b.id, b);
    b.spawn(this.time);
    this.rosterVersion++;
    return b;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    // 지난 틱의 그리드에는 아직 이 객체가 남아 있다. 봇이 유령을 조준하지 않게 죽은 상태로 표시.
    p.alive = false;
    p.dead = true;
    this.players.delete(id);
    this.freeId(id);
    this.rosterVersion++;
  }

  findSpawnPoint(forPlayer) {
    const m = ARENA_HALF * 0.9;
    let best = { x: 0, y: 0 };
    let bestDist = -1;
    for (let i = 0; i < 16; i++) {
      const x = (Math.random() * 2 - 1) * m;
      const y = (Math.random() * 2 - 1) * m;
      let nearest = Infinity;
      for (const p of this.players.values()) {
        if (p === forPlayer || !p.alive) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDist) { bestDist = nearest; best = { x, y }; }
      if (nearest > 900) break; // 충분히 안전하면 즉시 채택
    }
    return best;
  }

  // ── 엔티티 생성 ────────────────────────────────────────────
  spawnBullet(owner, o) {
    if (this.bullets.size > 2600) return null; // 폭주 방지
    const b = new Bullet(this.allocId(), owner, o);
    this.bullets.set(b.id, b);
    return b;
  }

  /** 드론 — 총알과 달리 살아서 명령을 따르는 유닛 */
  spawnDrone(owner, o) {
    if (this.bullets.size > 2600) return null;
    const d = new Bullet(this.allocId(), owner, { ...o, isDrone: true });
    this.bullets.set(d.id, d);
    owner.droneCount = (owner.droneCount || 0) + 1;
    return d;
  }

  /** 알파 오각형은 맵 한가운데에만 정해진 수만큼 존재한다 */
  spawnAlpha() {
    const t = SHAPE_TYPES[ALPHA_TYPE];
    let x = 0, y = 0;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * ALPHA_ZONE;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      // 서로 겹치지 않게
      let ok = true;
      for (const s of this.shapes.values()) {
        if (s.typeIdx !== ALPHA_TYPE) continue;
        if (Math.hypot(s.x - x, s.y - y) < t.radius * 4) { ok = false; break; }
      }
      if (ok) break;
    }
    const s = new Shape(this.allocId(), ALPHA_TYPE, x, y);
    s.vx *= 0.25;   // 중앙을 크게 벗어나지 않도록 아주 느리게 표류
    s.vy *= 0.25;
    this.shapes.set(s.id, s);
    return s;
  }

  maintainAlphas() {
    let n = 0;
    for (const s of this.shapes.values()) if (s.typeIdx === ALPHA_TYPE) n++;
    if (n < ALPHA_COUNT) this.spawnAlpha();
  }

  spawnShape(initial = false) {
    const typeIdx = randomShapeType();
    const t = SHAPE_TYPES[typeIdx];
    const m = ARENA_HALF - t.radius - 20;
    let x = 0, y = 0;
    for (let i = 0; i < 10; i++) {
      x = (Math.random() * 2 - 1) * m;
      y = (Math.random() * 2 - 1) * m;
      if (initial) break;
      // 플레이어 눈앞에서 튀어나오지 않게
      let ok = true;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - x, p.y - y) < 900) { ok = false; break; }
      }
      if (ok) break;
    }
    const s = new Shape(this.allocId(), typeIdx, x, y);
    this.shapes.set(s.id, s);
    return s;
  }

  /** 보스 1기 + 포탑 3문을 아레나의 빈 곳에 세운다 */
  spawnBoss() {
    const id = this.allocId();
    const turretIds = [this.allocId(), this.allocId(), this.allocId()];
    const boss = new Defender(this, id, turretIds);
    const pos = this.findSpawnPoint(null);
    boss.placeAt(pos.x, pos.y);

    this.bosses.set(boss.id, boss);
    for (const t of boss.turrets) this.turrets.set(t.id, t);
    this.rosterVersion++;
    return boss;
  }

  // ── 데미지 ─────────────────────────────────────────────────
  damage(target, amount, sourceId) {
    if (target.dead || amount <= 0) return;
    target.health -= amount;
    if (sourceId) target.lastHitBy = sourceId;
    if (target.kind === KIND.TANK) target.combatTimer = 0;
    if (target.health <= 0) this.destroy(target);
  }

  destroy(entity) {
    if (entity.dead) return;
    entity.dead = true;
    entity.health = 0;

    const killer = this.players.get(entity.lastHitBy);
    const validKiller = killer && killer !== entity && killer.alive;
    // 경험치는 플레이어만 받지만, 처치자 이름은 보스도 표시해야 한다
    const slayer = killer || this.bosses.get(entity.lastHitBy);

    if (entity.kind === KIND.SHAPE) {
      if (validKiller) killer.addXp(entity.xp);
    } else if (entity.isBoss) {
      entity.alive = false;
      entity.deathTime = this.time;
      entity.killerName = slayer && slayer !== entity ? slayer.name : '아레나';
      this.bossRespawnAt = this.time + BOSS_RESPAWN_DELAY;
      if (validKiller) {
        killer.kills++;
        killer.addXp(entity.xp);   // 막타 한 명이 전부 가져간다
      }
    } else if (entity.kind === KIND.TANK) {
      entity.alive = false;
      entity.deathTime = this.time;
      entity.killerName = slayer && slayer !== entity ? slayer.name : '아레나';
      if (validKiller) {
        killer.kills++;
        killer.addXp(Math.round(entity.score * 0.35 + 60 * entity.level));
      }
    }
  }

  // ── 충돌 ───────────────────────────────────────────────────
  rebuildGrid() {
    const g = this.grid;
    g.clear();
    for (const p of this.players.values()) if (p.alive && !p.dead) g.insert(p);
    for (const s of this.shapes.values()) if (!s.dead) g.insert(s);
    for (const b of this.bullets.values()) if (!b.dead) g.insert(b);
    for (const b of this.bosses.values()) if (b.alive && !b.dead) g.insert(b);
    // 포탑은 피격 판정이 없지만, 스냅샷 시야 질의에 잡히려면 그리드에 있어야 한다
    for (const t of this.turrets.values()) if (!t.dead) g.insert(t);
  }

  collide(dt) {
    const g = this.grid;
    const q = this._q;

    // 1) 솔리드(탱크·도형) 겹침 해소 + 몸통 데미지
    const solids = this._solids;
    solids.length = 0;
    for (const p of this.players.values()) if (p.alive && !p.dead) solids.push(p);
    for (const s of this.shapes.values()) if (!s.dead) solids.push(s);
    for (const b of this.bosses.values()) if (b.alive && !b.dead) solids.push(b);

    for (const a of solids) {
      if (a.dead) continue;
      g.queryCircle(a.x, a.y, a.radius + MAX_RADIUS, q);
      for (let i = 0; i < q.length; i++) {
        const b = q[i];
        if (b === a || b.dead || b.noCollide || isProjectile(b.kind)) continue;
        if (a.id >= b.id) continue;           // 한 쌍당 정확히 한 번
        this.resolveSolidPair(a, b, dt);
      }
    }

    // 2) 총알 — 이동 궤적(선분)으로 판정하여 관통 누락을 없앤다
    for (const bullet of this.bullets.values()) {
      if (bullet.dead) continue;
      const pad = bullet.radius + MAX_RADIUS;
      const minX = Math.min(bullet.px, bullet.x) - pad;
      const maxX = Math.max(bullet.px, bullet.x) + pad;
      const minY = Math.min(bullet.py, bullet.y) - pad;
      const maxY = Math.max(bullet.py, bullet.y) + pad;
      g.queryRect(minX, minY, maxX, maxY, q);

      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        if (t === bullet || t.dead || t.noCollide) continue;
        if (t.teamId === bullet.teamId) continue;   // 아군 사격 없음
        if (t.kind === KIND.TANK && !t.alive) continue;
        if (isProjectile(t.kind) && bullet.id >= t.id) continue;  // 탄끼리는 한 쌍당 한 번
        if (!segmentHitsCircle(bullet.px, bullet.py, bullet.x, bullet.y, t.x, t.y, bullet.radius + t.radius)) continue;

        this.resolveBulletHit(bullet, t);
        if (bullet.dead) break;
      }
    }
  }

  resolveSolidPair(a, b, dt) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const rsum = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rsum * rsum) return;

    let d = Math.sqrt(d2);
    let nx, ny;
    if (d < 1e-4) { nx = 1; ny = 0; d = 1e-4; } else { nx = dx / d; ny = dy / d; }

    const overlap = rsum - d;
    const total = a.mass + b.mass;
    const shareA = b.mass / total;
    const shareB = a.mass / total;
    const soft = 0.6;

    a.x -= nx * overlap * shareA * soft;
    a.y -= ny * overlap * shareA * soft;
    b.x += nx * overlap * shareB * soft;
    b.y += ny * overlap * shareB * soft;

    const knock = PUSH_STRENGTH * (overlap / rsum);
    if (a.kind === KIND.TANK) { a.ivx -= nx * knock * shareA; a.ivy -= ny * knock * shareA; }
    else { a.vx -= nx * knock * shareA; a.vy -= ny * knock * shareA; }
    if (b.kind === KIND.TANK) { b.ivx += nx * knock * shareB; b.ivy += ny * knock * shareB; }
    else { b.vx += nx * knock * shareB; b.vy += ny * knock * shareB; }

    // 도형끼리는 서로 데미지를 주지 않는다
    if (a.kind !== KIND.TANK && b.kind !== KIND.TANK) return;

    const toB = a.bodyDamage * BODY_DAMAGE_RATE * dt;
    const toA = b.bodyDamage * BODY_DAMAGE_RATE * dt;
    this.damage(b, toB, a.kind === KIND.TANK ? a.id : 0);
    this.damage(a, toA, b.kind === KIND.TANK ? b.id : 0);
  }

  resolveBulletHit(bullet, target) {
    if (bullet.alreadyHit(target.id)) return;
    bullet.markHit(target.id);

    if (isProjectile(target.kind)) {
      target.markHit(bullet.id);
      const mine = bullet.damage, theirs = target.damage;
      bullet.health -= theirs;
      target.health -= mine;
      if (bullet.health <= 0) bullet.dead = true;
      if (target.health <= 0) target.dead = true;
      return;
    }

    // 귀속은 팀 기준. 포탑이 쏜 총알도 보스 본체의 킬로 남는다.
    this.damage(target, bullet.damage, bullet.teamId);
    bullet.health -= target.bodyDamage;
    if (bullet.health <= 0) bullet.dead = true;

    // 넉백 — 큰 총알일수록 세게 민다
    const spd = Math.hypot(bullet.vx, bullet.vy) || 1;
    const nx = bullet.vx / spd, ny = bullet.vy / spd;
    const knock = (bullet.mass / Math.max(0.4, target.mass)) * spd * 0.30;
    if (target.kind === KIND.TANK) { target.ivx += nx * knock; target.ivy += ny * knock; }
    else { target.vx += nx * knock; target.vy += ny * knock; }
  }

  /** 드론 한 기의 목표를 정하고 그쪽으로 조종한다 */
  steerDrone(d, dt) {
    const owner = d.ownerRef;
    if (!owner || owner.dead || !owner.alive) { d.dead = true; return; }

    let tx, ty;
    const cmd = owner.droneCommand;

    if (Math.hypot(d.x - owner.x, d.y - owner.y) > DRONE_LEASH) {
      // 너무 멀어졌으면 무조건 주인에게 복귀
      tx = owner.x; ty = owner.y;
      d.target = null;
    } else if (cmd) {
      // 마우스를 누르고 있다 → 그 지점으로 몰려간다
      tx = cmd.x; ty = cmd.y;
      d.target = null;
    } else {
      // 놓고 있다 → 알아서 주변을 처리한다
      const t = d.target;
      if (!t || t.dead || (t.kind === KIND.TANK && !t.alive)) {
        d.target = this.findDroneTarget(d, owner);
      }
      if (d.target) {
        tx = d.target.x; ty = d.target.y;
      } else {
        // 목표가 없으면 주인 주위를 돈다
        d.orbit += DRONE_ORBIT_SPEED * dt;
        tx = owner.x + Math.cos(d.orbit) * DRONE_ORBIT_RADIUS;
        ty = owner.y + Math.sin(d.orbit) * DRONE_ORBIT_RADIUS;
      }
    }

    const dx = tx - d.x, dy = ty - d.y;
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, DRONE_ACCEL * dt);
    d.vx += ((dx / dist) * DRONE_SPEED - d.vx) * k;
    d.vy += ((dy / dist) * DRONE_SPEED - d.vy) * k;
    d.angle = Math.atan2(d.vy, d.vx);
  }

  /** 주인 주변에서 드론이 물어뜯을 대상 — 적 탱크 우선, 없으면 도형 */
  findDroneTarget(d, owner) {
    const near = this.grid.queryCircle(owner.x, owner.y, DRONE_SEEK_RANGE, this._q2);
    let bestTank = null, bestTankD2 = Infinity;
    let bestShape = null, bestShapeD2 = Infinity;
    for (const e of near) {
      if (e.dead || e.teamId === owner.teamId) continue;
      const dx = e.x - d.x, dy = e.y - d.y;
      const d2 = dx * dx + dy * dy;
      if (e.kind === KIND.TANK) {
        if (!e.alive || e.noCollide || e.visibility < 0.3) continue;
        if (d2 < bestTankD2) { bestTankD2 = d2; bestTank = e; }
      } else if (e.kind === KIND.SHAPE) {
        // 알파 오각형은 체력이 너무 높아 드론만 갈려나간다 — 명령 없이는 건드리지 않는다
        if (e.maxHealth > 1000) continue;
        if (d2 < bestShapeD2) { bestShapeD2 = d2; bestShape = e; }
      }
    }
    return bestTank || bestShape;
  }

  // ── 메인 루프 ──────────────────────────────────────────────
  step(dt = DT) {
    this.tick++;
    this.time += dt;

    for (const p of this.players.values()) {
      if (p.isBot) p.think(dt);
      p.update(dt, this.time);
    }
    for (const b of this.bosses.values()) b.update(dt);
    for (const b of this.bullets.values()) {
      if (b.isDrone) this.steerDrone(b, dt);
      b.update(dt);
    }
    for (const s of this.shapes.values()) s.update(dt);

    this.rebuildGrid();
    this.collide(dt);

    // 죽은 것 정리
    for (const [id, b] of this.bullets) {
      if (!b.dead) continue;
      if (b.isDrone && b.ownerRef) {
        b.ownerRef.droneCount = Math.max(0, (b.ownerRef.droneCount || 0) - 1);
      }
      this.bullets.delete(id);
      this.freeId(id);
    }
    for (const [id, s] of this.shapes) {
      if (s.dead) { this.shapes.delete(id); this.freeId(id); }
    }
    for (const [id, boss] of this.bosses) {
      if (!boss.dead) continue;
      for (const t of boss.turrets) { this.turrets.delete(t.id); this.freeId(t.id); }
      this.bosses.delete(id);
      this.freeId(id);
      this.rosterVersion++;
    }

    // 도형 보충
    let guard = 0;
    while (this.shapes.size < SHAPE_TARGET && guard++ < 12) this.spawnShape();

    this.maintainAlphas();
    this.maintainBots();
    this.maintainBoss();
  }

  /** 처치된 보스는 일정 시간 뒤 다른 곳에 다시 나타난다 */
  maintainBoss() {
    if (this.bosses.size >= BOSS_COUNT) return;
    if (this.time < this.bossRespawnAt) return;
    this.spawnBoss();
  }

  maintainBots() {
    const real = this.realPlayerCount;
    const bots = [];
    for (const p of this.players.values()) if (p.isBot) bots.push(p);

    // 죽은 봇 부활
    for (const b of bots) {
      if (!b.alive) {
        if (b.respawnAt === 0) b.respawnAt = this.time + 2 + Math.random() * 3;
        else if (this.time >= b.respawnAt) {
          b.respawnAt = 0;
          b.resetProgress();
          b.spawn(this.time);
        }
      }
    }

    const desired = Math.max(0, BOT_FILL - real);
    if (bots.length < desired) {
      this.addBot();
    } else if (bots.length > desired) {
      // 한 틱에 하나씩만 정리 — 눈앞에서 사라지지 않게 먼 봇부터
      let victim = null, far = -1;
      for (const b of bots) {
        let nearest = Infinity;
        for (const p of this.players.values()) {
          if (p.isBot || !p.alive) continue;
          nearest = Math.min(nearest, Math.hypot(p.x - b.x, p.y - b.y));
        }
        if (nearest > far) { far = nearest; victim = b; }
      }
      if (victim) this.removePlayer(victim.id);
    }
  }

  // ── 스냅샷 ─────────────────────────────────────────────────
  buildSnapshot(writer, viewer) {
    const tank = tankById(viewer.classId);
    const vw = viewWidthFor(viewer.level, tank.fov);
    const halfW = vw / 2 + VIEW_MARGIN;
    const halfH = (vw * VIEW_ASPECT) / 2 + VIEW_MARGIN;

    const cx = viewer.alive ? viewer.x : viewer.x;
    const cy = viewer.alive ? viewer.y : viewer.y;

    const found = this.grid.queryRect(cx - halfW, cy - halfH, cx + halfW, cy + halfH, this._q);
    const out = this._snapBuf;
    out.length = 0;

    for (let i = 0; i < found.length; i++) {
      const e = found[i];
      if (e === viewer || e.dead) continue;

      let color = 0, sub = 0, alpha = 255;
      if (e.kind === KIND.TANK) {
        if (!e.alive) continue;
        if (e.visibility < 0.2) continue;       // 은신은 서버가 숨긴다 (클라 조작 불가)
        color = e.colorIdx & 0x7f;
        sub = e.classId;
        alpha = Math.round(e.visibility * 255);
      } else if (isProjectile(e.kind)) {
        color = (e.colorIdx & 0x7f) | (e.teamId === viewer.teamId ? COLOR_MINE : 0);
      } else {
        sub = e.typeIdx;
      }

      const hp = e.maxHealth > 0
        ? Math.max(0, Math.min(255, Math.round((e.health / e.maxHealth) * 255)))
        : 255;

      out.push({
        kind: e.kind,
        id: e.id,
        x: Math.round(e.x),
        y: Math.round(e.y),
        angle: packAngle(e.angle ?? 0),
        radius: Math.min(255, Math.round(e.radius)),
        hp,
        color,
        sub,
        alpha,
        _d2: (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy),
        _tank: e.kind === KIND.TANK ? 0 : 1,
      });
    }

    // 예산 초과 시 탱크 우선, 그다음 가까운 순
    if (out.length > MAX_ENTITIES_IN_VIEW) {
      out.sort((a, b) => (a._tank - b._tank) || (a._d2 - b._d2));
      out.length = MAX_ENTITIES_IN_VIEW;
    }

    writeSnapshot(writer, this.tick, viewer.inputSeq, viewer.snapshotSelf(), out, out.length);
  }

  leaderboard(limit = 10) {
    const rows = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      rows.push({
        id: p.id,
        score: Math.round(p.score),
        level: p.level,
        classId: p.classId,
        name: p.name,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, limit);
  }

  roster() {
    const list = [];
    for (const p of this.players.values()) list.push({ id: p.id, name: p.name });
    for (const b of this.bosses.values()) list.push({ id: b.id, name: b.name });
    return list;
  }
}
