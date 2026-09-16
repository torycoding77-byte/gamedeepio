import {
  KIND, ARENA_HALF, MAX_LEVEL, MAX_STAT, CLASS_LEVELS, STAT_COUNT,
  xpForLevel, pointsGainedAt, tankRadius, maxHealthFor, bodyDamageFor,
  regenPerSecond, moveSpeedFor,
  CONTROL_ACCEL, IMPULSE_FRICTION, TICK_RATE, NAME_MAX, MAX_AIM_DIST,
} from '../../public/shared/config.js';
import { tankById, isValidUpgrade } from '../../public/shared/tanks.js';
import { IN } from '../../public/shared/protocol.js';
import { tickBarrels, resetPhases } from './firing.js';

/** 제어문자·제로폭·방향제어 문자를 제거한다 (닉네임으로 UI를 깨뜨리지 못하게) */
export function sanitizeName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').trim();
  return s.slice(0, NAME_MAX) || '무명의 탱크';
}

export class Player {
  constructor(world, id, name, isBot = false) {
    this.world = world;
    this.id = id;
    this.kind = KIND.TANK;
    this.name = sanitizeName(name);
    this.isBot = isBot;
    this.colorIdx = id % 8;
    this.teamId = id;   // 자기 총알·자기 팀 총알에 맞지 않기 위한 식별자

    this.x = 0; this.y = 0;
    this.angle = 0;
    this.cvx = 0; this.cvy = 0;   // 조작으로 만들어지는 속도
    this.ivx = 0; this.ivy = 0;   // 반동·충돌 임펄스
    this.vx = 0; this.vy = 0;

    this.flags = 0;
    this.aimDist = 0;
    this.inputSeq = 0;
    this.droneCount = 0;
    this.alive = false;
    this.dead = false;
    this._mark = -1;

    this.resetProgress();
  }

  resetProgress() {
    this.level = 1;
    this.xp = 0;
    this.score = 0;
    this.kills = 0;
    this.stats = new Uint8Array(STAT_COUNT);
    this.points = 0;
    this.classId = 0;
    this.upgradeTokens = 0;
    this.barrelPhase = new Float64Array(tankById(0).barrels.length);
    this.combatTimer = 99;
    this.visibility = 1;
    this.lastHitBy = 0;
    this.spawnTime = 0;
    this.droneCount = 0;
    this.recompute();
    this.health = this.maxHealth;
  }

  // ── 파생 스탯 ───────────────────────────────────────────────
  recompute() {
    const tank = tankById(this.classId);
    const prevMax = this.maxHealth || 0;
    const ratio = prevMax > 0 ? this.health / prevMax : 1;

    this.radius = tankRadius(this.level);
    this.maxHealth = maxHealthFor(this.level, this.stats, tank.healthMult);
    this.bodyDamage = bodyDamageFor(this.stats, tank.bodyMult);
    this.mass = (this.radius * this.radius) / 900;
    this.maxSpeed = moveSpeedFor(this.level, this.stats, tank.speedMult);
    this.fov = tank.fov;
    this.droneMax = tank.droneMax;

    if (prevMax > 0) this.health = Math.min(this.maxHealth, this.maxHealth * ratio);
  }

  get choices() {
    if (this.upgradeTokens <= 0) return [];
    return tankById(this.classId).upgradeIds;
  }

  // ── 스폰 / 사망 ────────────────────────────────────────────
  spawn(now) {
    const pos = this.world.findSpawnPoint(this);
    this.x = pos.x;
    this.y = pos.y;
    this.cvx = this.cvy = this.ivx = this.ivy = this.vx = this.vy = 0;
    this.angle = Math.atan2(-this.y, -this.x); // 중앙을 바라보며 시작
    this.alive = true;
    this.dead = false;
    this.health = this.maxHealth;
    this.combatTimer = 99;
    this.visibility = 1;
    this.lastHitBy = 0;
    this.spawnTime = now;
    this.barrelPhase = new Float64Array(tankById(this.classId).barrels.length);
    this.resetBarrelPhases();
  }

  resetBarrelPhases() {
    const barrels = tankById(this.classId).barrels;
    if (this.barrelPhase.length !== barrels.length) {
      this.barrelPhase = new Float64Array(barrels.length);
    }
    resetPhases(barrels, this.barrelPhase);
  }

  // ── 성장 ───────────────────────────────────────────────────
  addXp(amount) {
    if (!this.alive || amount <= 0) return;
    this.xp += amount;
    this.score += amount;
    let guard = 0;
    while (this.level < MAX_LEVEL && this.xp >= xpForLevel(this.level) && guard++ < 60) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      this.points += pointsGainedAt(this.level);
      if (CLASS_LEVELS.includes(this.level)) this.upgradeTokens++;
      this.recompute();
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * 0.12);
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
  }

  spendStat(index) {
    if (!this.alive) return false;
    if (index < 0 || index >= STAT_COUNT) return false;
    if (this.points <= 0 || this.stats[index] >= MAX_STAT) return false;
    this.stats[index]++;
    this.points--;
    this.recompute();
    return true;
  }

  chooseClass(classId) {
    if (!this.alive || this.upgradeTokens <= 0) return false;
    if (!isValidUpgrade(this.classId, classId)) return false;
    this.classId = classId;
    this.upgradeTokens--;
    this.resetBarrelPhases();
    this.recompute();
    return true;
  }

  // ── 입력 ───────────────────────────────────────────────────
  setInput(flags, angle, dist, seq) {
    this.flags = flags;
    if (!(flags & IN.AUTOSPIN)) this.angle = angle;
    this.aimDist = Math.min(MAX_AIM_DIST, dist || 0);
    this.inputSeq = seq;
  }

  /**
   * 드론에게 내리는 명령 지점.
   * 마우스를 누르고 있으면 그 지점, 아니면 null (= 알아서 싸워라).
   */
  get droneCommand() {
    if (!(this.flags & IN.FIRE) && !(this.flags & IN.AUTOFIRE)) return null;
    const d = this.aimDist || 0;
    if (d < 40) return null;
    return {
      x: this.x + Math.cos(this.angle) * d,
      y: this.y + Math.sin(this.angle) * d,
    };
  }

  // ── 매 틱 ──────────────────────────────────────────────────
  update(dt, now) {
    if (!this.alive) return;
    const tank = tankById(this.classId);

    if (this.flags & IN.AUTOSPIN) this.angle += 2.6 * dt;

    // 이동
    let ax = 0, ay = 0;
    if (this.flags & IN.UP) ay -= 1;
    if (this.flags & IN.DOWN) ay += 1;
    if (this.flags & IN.LEFT) ax -= 1;
    if (this.flags & IN.RIGHT) ax += 1;
    const len = Math.hypot(ax, ay);
    if (len > 0) { ax /= len; ay /= len; }

    const k = Math.min(1, CONTROL_ACCEL * dt);
    this.cvx += (ax * this.maxSpeed - this.cvx) * k;
    this.cvy += (ay * this.maxSpeed - this.cvy) * k;

    const decay = Math.pow(IMPULSE_FRICTION, dt * TICK_RATE);
    this.ivx *= decay;
    this.ivy *= decay;

    this.vx = this.cvx + this.ivx;
    this.vy = this.cvy + this.ivy;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 아레나 경계
    const lim = ARENA_HALF - this.radius;
    if (this.x < -lim) { this.x = -lim; this.cvx = Math.max(0, this.cvx); this.ivx *= 0.4; }
    if (this.x > lim)  { this.x = lim;  this.cvx = Math.min(0, this.cvx); this.ivx *= 0.4; }
    if (this.y < -lim) { this.y = -lim; this.cvy = Math.max(0, this.cvy); this.ivy *= 0.4; }
    if (this.y > lim)  { this.y = lim;  this.cvy = Math.min(0, this.cvy); this.ivy *= 0.4; }

    // 체력 회복
    this.combatTimer += dt;
    if (this.health < this.maxHealth) {
      this.health = Math.min(
        this.maxHealth,
        this.health + regenPerSecond(this.maxHealth, this.stats, this.combatTimer > 3) * dt
      );
    }

    // 사격
    const fired = this.updateBarrels(dt, tank);

    // 은신 (스토커 계열)
    if (tank.invisible) {
      const moving = Math.hypot(this.vx, this.vy) > 40;
      if (moving || fired || this.combatTimer < 1.2) {
        this.visibility = 1;
      } else {
        this.visibility = Math.max(0.05, this.visibility - dt * 0.9);
      }
    } else {
      this.visibility = 1;
    }
  }

  updateBarrels(dt, tank) {
    const firing = (this.flags & IN.FIRE) || (this.flags & IN.AUTOFIRE);
    const barrels = tank.barrels;
    if (this.barrelPhase.length !== barrels.length) this.resetBarrelPhases();
    return tickBarrels(this.world, this, barrels, this.barrelPhase, !!firing, dt);
  }

  snapshotSelf() {
    return {
      alive: this.alive,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      health: this.health,
      maxHealth: this.maxHealth,
      level: this.level,
      xp: this.xp,
      xpNeed: this.level >= MAX_LEVEL ? 0 : xpForLevel(this.level),
      score: Math.round(this.score),
      points: this.points,
      stats: this.stats,
      classId: this.classId,
      choices: this.choices,
    };
  }
}
