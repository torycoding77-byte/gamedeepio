import { Player } from './player.js';
import { IN } from '../../public/shared/protocol.js';
import {
  KIND, S, MAX_STAT, ARENA_HALF, bulletSpeedFor,
} from '../../public/shared/config.js';
import { tankById } from '../../public/shared/tanks.js';

const BOT_NAMES = [
  '강철거북', '푸른늑대', '조용한손', '한밤의별', '붉은매',
  '느긋한곰', '전자양', '무쇠팔', '바람개비', '작은거인',
  '검은고래', '노란번개', '돌멩이', '새벽안개', '철수',
  '민들레', '고요한밤', '깜빡이', '해바라기', '흰여우',
  '나무늘보', '번개탄', '구름한점', '초코칩', '달빛사냥꾼',
];

/** 스탯 투자 성향. 앞에서부터 7까지 채우고 다음으로 넘어간다. */
const BUILDS = [
  [S.BSPEED, S.PEN, S.DAMAGE, S.RELOAD, S.MOVE, S.HEALTH, S.REGEN, S.BODY],   // 저격형
  [S.RELOAD, S.DAMAGE, S.PEN, S.BSPEED, S.MOVE, S.HEALTH, S.REGEN, S.BODY],   // 속사형
  [S.BODY, S.HEALTH, S.MOVE, S.REGEN, S.DAMAGE, S.PEN, S.RELOAD, S.BSPEED],   // 돌격형
  [S.PEN, S.DAMAGE, S.RELOAD, S.HEALTH, S.BSPEED, S.MOVE, S.REGEN, S.BODY],   // 균형형
];

function randomPoint() {
  const m = ARENA_HALF * 0.88;
  return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
}

export class Bot extends Player {
  constructor(world, id) {
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    super(world, id, name, true);
    this.build = BUILDS[Math.floor(Math.random() * BUILDS.length)];
    this.skill = 0.34 + Math.random() * 0.4;   // 0=엉망 1=정확
    // 포탑 회전 속도(rad/s). 사람처럼 "돌려서" 겨눠야 한다 —
    // 제한이 없으면 매 틱 완벽한 각도로 스냅해서 절대 빗나가지 않는다.
    this.turnRate = 2.6 + this.skill * 2.6;
    this.aimError = 0;
    this.waypoint = randomPoint();
    this.retarget = 0;
    this.target = null;
    this.targetIsTank = false;
    this.respawnAt = 0;
    this._nearby = [];
  }

  autoUpgrade() {
    let guard = 0;
    while (this.points > 0 && guard++ < 40) {
      const idx = this.build.find((i) => this.stats[i] < MAX_STAT);
      if (idx === undefined) break;
      if (!this.spendStat(idx)) break;
    }
    if (this.upgradeTokens > 0) {
      const options = this.choices;
      if (options.length > 0) {
        this.chooseClass(options[Math.floor(Math.random() * options.length)]);
      }
    }
  }

  pickTarget() {
    const range = 1250;
    const near = this.world.grid.queryCircle(this.x, this.y, range, this._nearby);

    let bestTank = null, bestTankD2 = Infinity;
    let bestShape = null, bestShapeScore = -Infinity;

    for (const e of near) {
      if (e === this || e.dead) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > range * range) continue;

      if (e.kind === KIND.TANK) {
        if (!e.alive || e.visibility < 0.3) continue;
        // 보스 포탑은 피격 판정이 없다 — 조준해봐야 총알만 버린다. 본체를 노려야 한다.
        if (e.isTurret) continue;
        if (d2 < bestTankD2) { bestTankD2 = d2; bestTank = e; }
      } else if (e.kind === KIND.SHAPE) {
        // 가치 대비 거리 — 알파 오각형은 체력이 너무 높아 낮게 평가
        const worth = e.maxHealth > 1000 ? e.xp * 0.05 : e.xp;
        const score = worth / (200 + Math.sqrt(d2));
        if (score > bestShapeScore) { bestShapeScore = score; bestShape = e; }
      }
    }

    const hpRatio = this.health / this.maxHealth;
    const wantFight = bestTank && (hpRatio > 0.45 || bestTankD2 < 350 * 350);

    if (wantFight) {
      this.target = bestTank;
      this.targetIsTank = true;
    } else if (bestShape) {
      this.target = bestShape;
      this.targetIsTank = false;
    } else {
      this.target = null;
      this.targetIsTank = false;
    }
  }

  /** 목표 각도로 회전 속도 한계 안에서만 돌린다 */
  aimToward(target, dt) {
    let diff = target - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const max = this.turnRate * dt;
    this.angle += Math.max(-max, Math.min(max, diff));
  }

  think(dt) {
    if (!this.alive) return;

    this.autoUpgrade();

    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.32 + Math.random() * 0.4;
      this.pickTarget();
    }
    if (this.target && (this.target.dead || (this.target.kind === KIND.TANK && !this.target.alive))) {
      this.target = null;
    }

    // 조준 오차가 천천히 흔들린다 → 기계처럼 정확하지 않게
    const maxErr = (1 - this.skill) * 0.45;
    this.aimError += (Math.random() - 0.5) * dt * 3;
    this.aimError = Math.max(-maxErr, Math.min(maxErr, this.aimError));

    let flags = 0;
    let moveX = 0, moveY = 0;

    if (this.target) {
      const t = this.target;
      const dx = t.x - this.x, dy = t.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;

      // 탄속을 고려한 예측 사격
      const barrels = tankById(this.classId).barrels;
      const bs = bulletSpeedFor(this.stats, barrels[0].speed);
      const lead = Math.min(0.9, dist / Math.max(200, bs)) * this.skill * 0.85;
      const aimX = t.x + (t.vx || 0) * lead;
      const aimY = t.y + (t.vy || 0) * lead;
      this.aimToward(Math.atan2(aimY - this.y, aimX - this.x) + this.aimError, dt);

      const hpRatio = this.health / this.maxHealth;
      let desired;
      if (this.targetIsTank) {
        if (hpRatio < 0.3) desired = dist + 600;              // 도주
        else desired = 320 + (1 - this.skill) * 200;          // 교전 거리 유지
      } else {
        desired = t.radius + this.radius + 30;                // 도형은 붙어서 처리
      }

      const err = dist - desired;
      if (Math.abs(err) > 45) {
        const sign = err > 0 ? 1 : -1;
        moveX = (dx / dist) * sign;
        moveY = (dy / dist) * sign;
      } else {
        // 사거리 안이면 옆으로 돌며 회피
        moveX = -dy / dist;
        moveY = dx / dist;
      }

      const inRange = dist < (this.targetIsTank ? 900 : 620);
      if (inRange) flags |= IN.FIRE;
    } else {
      // 목표가 없으면 웨이포인트로 순찰
      const dx = this.waypoint.x - this.x, dy = this.waypoint.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 180) {
        this.waypoint = randomPoint();
      } else {
        moveX = dx / dist;
        moveY = dy / dist;
        this.aimToward(Math.atan2(dy, dx) + this.aimError, dt);
      }
    }

    // 벽에 붙지 않게 중앙 쪽으로 보정
    const edge = ARENA_HALF - 400;
    if (this.x > edge) moveX -= (this.x - edge) / 400;
    if (this.x < -edge) moveX += (-edge - this.x) / 400;
    if (this.y > edge) moveY -= (this.y - edge) / 400;
    if (this.y < -edge) moveY += (-edge - this.y) / 400;

    const m = Math.hypot(moveX, moveY);
    if (m > 0.001) {
      const nx = moveX / m, ny = moveY / m;
      if (nx > 0.38) flags |= IN.RIGHT;
      if (nx < -0.38) flags |= IN.LEFT;
      if (ny > 0.38) flags |= IN.DOWN;
      if (ny < -0.38) flags |= IN.UP;
    }

    this.flags = flags;
    this.aimDist = 620;   // 드론 계열 봇은 전방을 지시한다
  }
}
