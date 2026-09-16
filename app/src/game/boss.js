import {
  KIND, ARENA_HALF, BOSS_RADIUS, BOSS_HEALTH, BOSS_BODY_DAMAGE,
  BOSS_SPEED, BOSS_SPIN, BOSS_XP, BOSS_TURRET_RANGE, BOSS_STATS,
  bulletSpeedFor,
} from '../../public/shared/config.js';
import { TANK_BY_KEY } from '../../public/shared/tanks.js';
import { tickBarrels, resetPhases } from './firing.js';

const DEFENDER = TANK_BY_KEY.defender;
const TURRET = TANK_BY_KEY.defenderTurret;

/** 포탑이 붙는 위치 — 삼각형 세 변의 가운데 안쪽 */
const TURRET_MOUNTS = [
  { angle: Math.PI / 3, dist: 0.46 },
  { angle: Math.PI,     dist: 0.46 },
  { angle: -Math.PI / 3, dist: 0.46 },
];

/**
 * 디펜더 위에 얹힌 소형 포탑.
 * 본체와 별개 엔티티로 스냅샷에 실리기 때문에 각자 다른 방향을 겨눌 수 있다.
 * 충돌·피격 판정은 갖지 않는다 (noCollide) — 데미지는 전부 본체가 받는다.
 */
export class DefenderTurret {
  constructor(world, boss, id, mount) {
    this.world = world;
    this.id = id;
    this.kind = KIND.TANK;
    this.boss = boss;
    this.isTurret = true;
    this.noCollide = true;

    this.teamId = boss.teamId;
    this.colorIdx = boss.colorIdx;
    this.classId = TURRET.id;
    this.stats = BOSS_STATS;

    this.mountAngle = mount.angle;
    this.mountDist = mount.dist * BOSS_RADIUS;
    this.radius = BOSS_RADIUS * 0.22;

    this.x = boss.x; this.y = boss.y;
    this.angle = 0;
    this.vx = 0; this.vy = 0;
    this.ivx = 0; this.ivy = 0;   // 반동 0 이지만 fireBarrel 이 참조한다

    // 항상 만피로 보내 본체 위에 체력바가 겹쳐 뜨지 않게 한다
    this.health = 1;
    this.maxHealth = 1;
    this.alive = true;
    this.dead = false;
    this.visibility = 1;
    this.lastHitBy = 0;
    this.mass = 1;
    this._mark = -1;

    this.phases = new Float64Array(TURRET.barrels.length);
    resetPhases(TURRET.barrels, this.phases);
    this.target = null;
    this.retarget = Math.random() * 0.3;
    this._near = [];
  }

  /** 사거리 안에서 가장 가까운 적 탱크 */
  pickTarget() {
    const near = this.world.grid.queryCircle(this.x, this.y, BOSS_TURRET_RANGE, this._near);
    let best = null, bestD2 = BOSS_TURRET_RANGE * BOSS_TURRET_RANGE;
    for (const e of near) {
      if (e.kind !== KIND.TANK || e.dead || !e.alive) continue;
      if (e.teamId === this.teamId) continue;      // 본체와 형제 포탑은 제외
      if (e.visibility < 0.3) continue;            // 은신 중이면 못 본다
      const dx = e.x - this.x, dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    }
    this.target = best;
  }

  update(dt) {
    // 본체에 붙어 같이 돌고 같이 움직인다
    const a = this.boss.angle + this.mountAngle;
    this.x = this.boss.x + Math.cos(a) * this.mountDist;
    this.y = this.boss.y + Math.sin(a) * this.mountDist;
    this.vx = this.boss.vx;
    this.vy = this.boss.vy;

    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.25;
      this.pickTarget();
    }
    const t = this.target;
    if (t && (t.dead || !t.alive)) this.target = null;

    let firing = false;
    if (this.target) {
      const tg = this.target;
      const dx = tg.x - this.x, dy = tg.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;

      // 탄속을 고려한 예측 사격
      const bs = bulletSpeedFor(this.stats, TURRET.barrels[0].speed);
      const lead = Math.min(0.8, dist / Math.max(200, bs));
      this.angle = Math.atan2(dy + (tg.vy || 0) * lead, dx + (tg.vx || 0) * lead);
      firing = dist < BOSS_TURRET_RANGE;
    } else {
      // 목표가 없으면 바깥쪽을 겨눈 채 대기
      this.angle = a;
    }

    tickBarrels(this.world, this, TURRET.barrels, this.phases, firing, dt);
  }
}

/**
 * 보스 "디펜더".
 * 아주 느리게 배회하면서 꼭짓점 3곳의 큰 사출기로 트랩을 깔고,
 * 위에 얹힌 포탑 3문이 각자 가까운 적을 조준해 작은 포탄을 퍼붓는다.
 */
export class Defender {
  constructor(world, id, turretIds) {
    this.world = world;
    this.id = id;
    this.kind = KIND.TANK;
    this.isBoss = true;
    this.name = DEFENDER.name;

    this.teamId = id;
    this.colorIdx = 0;
    this.classId = DEFENDER.id;
    this.stats = BOSS_STATS;

    this.radius = BOSS_RADIUS;
    this.mass = (BOSS_RADIUS * BOSS_RADIUS) / 900;   // 일반 탱크의 약 19배 — 밀어도 안 밀린다
    this.maxHealth = BOSS_HEALTH;
    this.health = BOSS_HEALTH;
    this.bodyDamage = BOSS_BODY_DAMAGE;
    this.xp = BOSS_XP;
    this.score = BOSS_XP;
    this.level = 45;          // 리더보드·킬 표기용

    this.x = 0; this.y = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.vx = 0; this.vy = 0;
    this.ivx = 0; this.ivy = 0;

    this.alive = true;
    this.dead = false;
    this.visibility = 1;
    this.combatTimer = 99;
    this.lastHitBy = 0;
    this._mark = -1;

    this.phases = new Float64Array(DEFENDER.barrels.length);
    resetPhases(DEFENDER.barrels, this.phases);

    this.waypoint = { x: 0, y: 0 };
    this.waypointTimer = 0;

    this.turrets = TURRET_MOUNTS.map((m, i) => new DefenderTurret(world, this, turretIds[i], m));
  }

  placeAt(x, y) {
    this.x = x;
    this.y = y;
    this.pickWaypoint();
    for (const t of this.turrets) t.update(0);
  }

  pickWaypoint() {
    const m = ARENA_HALF * 0.78;
    this.waypoint.x = (Math.random() * 2 - 1) * m;
    this.waypoint.y = (Math.random() * 2 - 1) * m;
    this.waypointTimer = 18 + Math.random() * 14;
  }

  update(dt) {
    if (!this.alive) return;

    // 몸통이 천천히 돈다 → 트랩이 부채꼴로 깔린다
    this.angle += BOSS_SPIN * dt;

    // 아주 느린 배회
    this.waypointTimer -= dt;
    const dx = this.waypoint.x - this.x;
    const dy = this.waypoint.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (this.waypointTimer <= 0 || dist < 160) this.pickWaypoint();

    const tx = dist > 1 ? (dx / dist) * BOSS_SPEED : 0;
    const ty = dist > 1 ? (dy / dist) * BOSS_SPEED : 0;
    this.vx += (tx - this.vx) * Math.min(1, 1.2 * dt);
    this.vy += (ty - this.vy) * Math.min(1, 1.2 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const lim = ARENA_HALF - this.radius;
    if (this.x < -lim) { this.x = -lim; this.pickWaypoint(); }
    if (this.x > lim)  { this.x = lim;  this.pickWaypoint(); }
    if (this.y < -lim) { this.y = -lim; this.pickWaypoint(); }
    if (this.y > lim)  { this.y = lim;  this.pickWaypoint(); }

    // 트랩 사출기는 쉬지 않는다
    tickBarrels(this.world, this, DEFENDER.barrels, this.phases, true, dt);

    // 오래 방치되면 천천히 회복 — 야금야금 깎아서 잡을 수 없게
    this.combatTimer += dt;
    if (this.combatTimer > 10 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * 0.02 * dt);
    }

    for (const t of this.turrets) t.update(dt);
  }
}

export { DEFENDER as DEFENDER_CLASS, TURRET as TURRET_CLASS };
