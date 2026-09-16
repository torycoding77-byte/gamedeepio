import {
  KIND, ARENA_HALF, SHAPE_TYPES, BASE_BULLET_LIFE, TICK_RATE, TRAP_DRAG, DRONE_LIFE,
} from '../../public/shared/config.js';

/** 반지름 기반 질량 — 알파 오각형은 밀어도 거의 안 밀린다 */
function massOf(radius) {
  return (radius * radius) / 900;
}

export class Bullet {
  constructor(id, owner, o) {
    this.id = id;
    this.isTrap = !!o.isTrap;
    this.isDrone = !!o.isDrone;
    this.kind = this.isTrap ? KIND.TRAP : this.isDrone ? KIND.DRONE : KIND.BULLET;
    this.ownerId = owner.id;
    this.ownerRef = owner;
    this.colorIdx = owner.colorIdx;
    // 같은 팀끼리는 서로 맞지 않는다. 보스 본체와 포탑이 한 팀으로 묶이는 근거.
    this.teamId = owner.teamId ?? owner.id;

    this.x = o.x; this.y = o.y;
    this.px = o.x; this.py = o.y;
    this.vx = o.vx; this.vy = o.vy;
    this.radius = o.radius;

    this.damage = o.damage;
    this.bodyDamage = o.damage;   // 총알끼리 부딪히면 서로 이 값만큼 깎는다
    this.health = o.health;
    this.maxHealth = o.health;

    this.life = this.isDrone ? DRONE_LIFE : (o.life ?? BASE_BULLET_LIFE);
    // 트랩·드론은 방향이 보이는 도형이라 각도가 필요하다 (총알은 원형)
    this.angle = (this.isTrap || this.isDrone) ? Math.atan2(o.vy, o.vx) : 0;
    this.spin = this.isTrap ? (Math.random() - 0.5) * 1.1 : 0;
    // 드론은 계속 살아 있으므로 같은 상대를 다시 때릴 수 있어야 한다
    this.hitReset = 0;
    this.orbit = Math.random() * Math.PI * 2;
    this.target = null;
    this.dead = false;
    this.mass = massOf(o.radius) * (this.isTrap ? 2.2 : this.isDrone ? 1.0 : 0.35);
    this.hits = null;           // 첫 명중 때 생성 (대부분의 총알은 필요 없다)
    this.lastHitBy = owner.id;
    this._mark = -1;
  }

  update(dt) {
    this.px = this.x;
    this.py = this.y;
    // 트랩은 빠르게 감속해 제자리에 멈춘 뒤 수명이 다할 때까지 남는다
    if (this.isTrap) {
      const d = Math.pow(TRAP_DRAG, dt * TICK_RATE);
      this.vx *= d;
      this.vy *= d;
      this.angle += this.spin * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;

    if (this.isDrone) {
      // 드론은 오래 살아 있다. 같은 상대를 계속 들이받을 수 있도록
      // 명중 기록을 주기적으로 비운다.
      this.hitReset -= dt;
      if (this.hitReset <= 0) { this.hits = null; this.hitReset = 0.55; }
      // 드론은 아레나 밖으로 나가는 대신 벽에 걸린다
      const w = ARENA_HALF - this.radius;
      if (this.x < -w) { this.x = -w; this.vx = Math.abs(this.vx); }
      if (this.x > w)  { this.x = w;  this.vx = -Math.abs(this.vx); }
      if (this.y < -w) { this.y = -w; this.vy = Math.abs(this.vy); }
      if (this.y > w)  { this.y = w;  this.vy = -Math.abs(this.vy); }
      return;
    }

    // 아레나 밖으로 나가면 소멸
    const lim = ARENA_HALF + 120;
    if (this.x < -lim || this.x > lim || this.y < -lim || this.y > lim) this.dead = true;
  }

  alreadyHit(id) {
    return this.hits !== null && this.hits.has(id);
  }
  markHit(id) {
    if (this.hits === null) this.hits = new Set();
    this.hits.add(id);
  }
}

export class Shape {
  constructor(id, typeIdx, x, y) {
    const t = SHAPE_TYPES[typeIdx];
    this.id = id;
    this.kind = KIND.SHAPE;
    this.typeIdx = typeIdx;

    this.x = x; this.y = y;
    const drift = 14 + Math.random() * 20;
    const dir = Math.random() * Math.PI * 2;
    this.vx = Math.cos(dir) * drift;
    this.vy = Math.sin(dir) * drift;

    this.angle = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.7;

    this.radius = t.radius;
    this.maxHealth = t.health;
    this.health = t.health;
    this.bodyDamage = t.bodyDamage;
    this.xp = t.xp;
    this.score = t.score;

    this.mass = massOf(t.radius);
    this.dead = false;
    this.teamId = 0;            // 중립 — 어떤 총알에도 맞는다
    this.lastHitBy = 0;
    this._mark = -1;
  }

  update(dt) {
    this.angle += this.rotSpeed * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 벽에서 튕긴다
    const lim = ARENA_HALF - this.radius;
    if (this.x < -lim) { this.x = -lim; this.vx = Math.abs(this.vx); }
    if (this.x > lim)  { this.x = lim;  this.vx = -Math.abs(this.vx); }
    if (this.y < -lim) { this.y = -lim; this.vy = Math.abs(this.vy); }
    if (this.y > lim)  { this.y = lim;  this.vy = -Math.abs(this.vy); }

    // 밀린 뒤 원래 표류 속도로 서서히 복귀
    this.vx *= 0.99;
    this.vy *= 0.99;
  }
}

const SHAPE_WEIGHT_TOTAL = SHAPE_TYPES.reduce((s, t) => s + t.weight, 0);

export function randomShapeType() {
  let r = Math.random() * SHAPE_WEIGHT_TOTAL;
  for (let i = 0; i < SHAPE_TYPES.length; i++) {
    r -= SHAPE_TYPES[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}
