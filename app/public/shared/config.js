/**
 * POLYARENA — 공용 설정
 * 서버(Durable Object)와 클라이언트(브라우저)가 이 파일 하나를 공유한다.
 * 여기 있는 수식이 곧 게임 밸런스다.
 */

// ── 시뮬레이션 ────────────────────────────────────────────────
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;

export const ARENA_SIZE = 11000;
export const ARENA_HALF = ARENA_SIZE / 2;
export const GRID_CELL = 260;

export const MAX_PLAYERS = 40;
export const BOT_FILL = 14; // 이 인원 미만이면 봇으로 채운다 (넓어진 맵에 맞춰 증원)
export const MAX_ENTITIES_IN_VIEW = 220;
export const VIEW_MARGIN = 260;

// ── 성장 ──────────────────────────────────────────────────────
export const MAX_LEVEL = 45;
export const MAX_STAT = 7;
export const CLASS_LEVELS = [15, 30, 45];

export const STAT_COUNT = 8;
export const S = {
  REGEN: 0, HEALTH: 1, BODY: 2, PEN: 3,
  DAMAGE: 4, BSPEED: 5, RELOAD: 6, MOVE: 7,
};

export const STATS = [
  { key: 'regen',  name: '체력 재생',   color: '#7ee081' },
  { key: 'health', name: '최대 체력',   color: '#f2e05c' },
  { key: 'body',   name: '몸통 데미지', color: '#c58bf0' },
  { key: 'pen',    name: '총알 관통',   color: '#7fb8f0' },
  { key: 'damage', name: '총알 데미지', color: '#f08787' },
  { key: 'bspeed', name: '총알 속도',   color: '#7ff0e2' },
  { key: 'reload', name: '재장전',      color: '#f0b45c' },
  { key: 'move',   name: '이동 속도',   color: '#a8f05c' },
];

/** 레벨 L에서 L+1로 가는 데 필요한 경험치 */
export function xpForLevel(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(1.15 * Math.pow(level, 2.05) + 12 * level);
}

/** 해당 레벨에 도달했을 때 받는 스탯 포인트 */
export function pointsGainedAt(level) {
  if (level <= 1) return 0;
  if (level <= 28) return 1;
  if (level <= MAX_LEVEL && level % 3 === 0) return 1;
  return 0;
}

// ── 탱크 수식 ─────────────────────────────────────────────────
export function tankRadius(level) {
  return 30 * Math.pow(1.008, level - 1);
}

export function maxHealthFor(level, stats, healthMult = 1) {
  return (50 + 2 * (level - 1) + stats[S.HEALTH] * 20) * healthMult;
}

export function bodyDamageFor(stats, bodyMult = 1) {
  return (20 + stats[S.BODY] * 6) * bodyMult;
}

/** 초당 회복량. 피격 후 3초가 지나면 대폭 증가한다. */
export function regenPerSecond(maxHp, stats, outOfCombat) {
  const base = maxHp * (0.0025 + 0.0045 * stats[S.REGEN]);
  return outOfCombat ? base * 6 : base;
}

export function moveSpeedFor(level, stats, speedMult = 1) {
  return 380 * (1 + 0.075 * stats[S.MOVE]) * Math.pow(0.9955, level - 1) * speedMult;
}

export const BASE_RELOAD = 0.5;   // 초
export const BASE_BULLET_SPEED = 620; // 유닛/초
export const BASE_BULLET_LIFE = 2.1;  // 초
export const BASE_BULLET_DAMAGE = 7;
export const BASE_BULLET_HEALTH = 8;

export function reloadTimeFor(stats, barrelReload) {
  return (BASE_RELOAD * barrelReload) / (1 + 0.15 * stats[S.RELOAD]);
}

export function bulletSpeedFor(stats, barrelSpeed) {
  return BASE_BULLET_SPEED * (1 + 0.11 * stats[S.BSPEED]) * barrelSpeed;
}

export function bulletDamageFor(stats, barrelDamage) {
  return (BASE_BULLET_DAMAGE + 3 * stats[S.DAMAGE]) * barrelDamage;
}

export function bulletHealthFor(stats, barrelHealth) {
  return (BASE_BULLET_HEALTH + 4 * stats[S.PEN]) * barrelHealth;
}

// 물리
export const CONTROL_ACCEL = 7;       // 목표 속도로 수렴하는 속도
export const IMPULSE_FRICTION = 0.93; // 틱당 반동 감쇠 (시정수 ≈ 0.48초)
// 반동 임펄스 배수. 이 값이 작으면 삼각날개·부스터의 "쏘면서 가속" 이 성립하지 않는다.
// 90이면 기본 탱크는 약 62u/s 뒤로 밀리고(이동속도의 16%), 삼각날개는 순 +195u/s 전진한다.
export const RECOIL_SCALE = 90;
export const PUSH_STRENGTH = 340;     // 겹침 해소 밀어내기
export const BODY_DAMAGE_RATE = 4;    // 몸통 데미지 초당 배수

// ── 중립 도형 ─────────────────────────────────────────────────
export const SHAPE_TYPES = [
  { name: '사각형',      sides: 4, radius: 26,  health: 12,   bodyDamage: 8,  xp: 12,   score: 12,   weight: 60, color: '#f2c14e' },
  { name: '삼각형',      sides: 3, radius: 25,  health: 32,   bodyDamage: 10, xp: 30,   score: 30,   weight: 30, color: '#e8705f' },
  { name: '오각형',      sides: 5, radius: 43,  health: 110,  bodyDamage: 14, xp: 140,  score: 140,  weight: 10, color: '#7b83f0' },
  // weight 0 = 무작위 스폰 대상이 아니다. 맵 중앙에만 정해진 수만큼 따로 등장한다.
  { name: '알파 오각형', sides: 5, radius: 100, health: 2600, bodyDamage: 24, xp: 3000, score: 3000, weight: 0,  color: '#9b6ef0' },
];

export const ALPHA_TYPE = 3;      // SHAPE_TYPES 에서 알파 오각형의 인덱스
export const ALPHA_COUNT = 2;     // 맵 전체에 이만큼만 존재한다
export const ALPHA_ZONE = 1000;   // 맵 중앙 이 반경 안에서만 스폰

// 아레나 넓이에 비례해 도형 수를 맞춘다 (7000² 기준 460개와 같은 밀도)
const SHAPE_DENSITY = 460 / (7000 * 7000);
export const SHAPE_TARGET = Math.round(ARENA_SIZE * ARENA_SIZE * SHAPE_DENSITY);

// ── 카메라 / 색상 ─────────────────────────────────────────────
export const BASE_VIEW_WIDTH = 1900; // 화면 가로에 담기는 월드 폭(레벨1 기준)
/** 세로로 보이는 폭의 비율. 서버 시야 컬링과 클라이언트 카메라가 이 값을 공유해야 한다. */
export const VIEW_ASPECT = 0.6;

/** classFov가 클수록 더 멀리 본다 (저격 계열) */
export function viewWidthFor(level, classFov) {
  return BASE_VIEW_WIDTH * (1 + (level - 1) * 0.006) * classFov;
}

export const PALETTE = {
  bg: '#191c21',
  grid: '#23272e',
  outside: 'rgba(0,0,0,0.28)',
  you: '#3fd2c7',
  enemies: [
    '#ff6b6b', '#ffa14a', '#c77dff', '#ff7ad9',
    '#8ec63f', '#4aa8ff', '#ffd93d', '#00d1a0',
  ],
  barrel: '#a3a8b0',
  hpBack: 'rgba(0,0,0,0.45)',
  hpFill: '#7ee081',
  boss: '#ff4d4d',      // 보스 본체·포탑
  bossBarrel: '#8e939b',
};

/** hex 색을 amt(-1~1)만큼 밝게/어둡게 */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = amt < 0 ? 1 + amt : 1 - amt;
  const add = amt < 0 ? 0 : 255 * amt;
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f + add));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f + add));
  const b = Math.min(255, Math.round((n & 255) * f + add));
  return `rgb(${r},${g},${b})`;
}

export const KIND = { TANK: 0, BULLET: 1, SHAPE: 2, TRAP: 3, DRONE: 4 };

export const NAME_MAX = 16;
export const DEFAULT_NAMES = [
  '무명의 탱크', '떠돌이', '방랑자', '신참', '도전자',
];

// ── 보스: 디펜더 ──────────────────────────────────────────────
// 아레나에 항상 1기. 아주 느리게 돌아다니며 트랩을 깔고, 포탑 3문이 독립 조준한다.
export const BOSS_COUNT = 1;
export const BOSS_RESPAWN_DELAY = 45;   // 초. 처치 후 이만큼 지나면 다른 곳에 다시 등장
export const BOSS_RADIUS = 132;
export const BOSS_HEALTH = 14000;
export const BOSS_BODY_DAMAGE = 42;
export const BOSS_SPEED = 46;           // 일반 탱크(380)의 1/8 — "아주 느리게"
export const BOSS_SPIN = 0.22;          // 초당 회전(라디안). 트랩이 부채꼴로 깔린다
export const BOSS_XP = 30000;           // 알파 오각형 10마리 분량
export const BOSS_TURRET_RANGE = 1150;

/** 보스 본체·포탑이 쓰는 가상 스탯 (일반 탱크와 같은 수식을 태우기 위함) */
export const BOSS_STATS = [0, 0, 0, 5, 5, 3, 2, 0];

// ── 트랩 ──────────────────────────────────────────────────────
// 멀리 날아가지 않는 대신 그 자리에 오래 남아 길목을 막는다.
export const TRAP_LIFE = 13;            // 초
export const TRAP_DRAG = 0.96;          // 틱당 감속 — 약 270유닛 나아가고 멈춘다

// ── 드론 (지휘관 계열) ────────────────────────────────────────
// 작은 삼각형 유닛. 마우스를 누르고 있으면 그 지점으로 몰려가고,
// 누르지 않으면 주인 주변을 돌다가 가까운 적·도형을 알아서 공격한다.
export const DRONE_SPEED = 300;        // 유닛/초
export const DRONE_ACCEL = 4.5;        // 목표 속도로 수렴하는 속도
export const DRONE_ORBIT_RADIUS = 250; // 대기 시 주인 주위를 도는 반경
export const DRONE_ORBIT_SPEED = 1.5;  // 라디안/초
export const DRONE_SEEK_RANGE = 950;   // 자율 공격 시 목표 탐색 반경
export const DRONE_LEASH = 1600;       // 주인에게서 이만큼 멀어지면 무조건 복귀
export const DRONE_LIFE = 999;         // 수명으로 죽지 않는다 (파괴되거나 주인이 죽어야 사라짐)

/** 조준 지점 전송 상한. 이 거리까지만 드론에게 "여기로 가라" 고 지시할 수 있다. */
export const MAX_AIM_DIST = 4000;
