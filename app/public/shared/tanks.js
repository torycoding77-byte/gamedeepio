/**
 * POLYARENA — 탱크 클래스 정의 (28종)
 *
 * 탱크는 전부 "포신 배열"이라는 데이터로만 기술한다.
 * 서버는 이 배열을 읽어 총알을 만들고, 클라이언트는 같은 배열을 읽어 포신을 그린다.
 * → 새 클래스를 추가하려면 이 파일에 항목 하나만 넣으면 된다.
 *
 * 포신 좌표계: 탱크 반지름 = 1.0 인 단위.
 *   angle  포신 방향 (도, 탱크가 바라보는 방향 기준)
 *   x      포신 방향 앞쪽 오프셋
 *   y      포신 방향 기준 좌우 오프셋
 *   length 포신 길이
 *   width  포신 폭
 */

function B(angle, x, y, length, width, o = {}) {
  return {
    angle: (angle * Math.PI) / 180,
    x, y, length, width,
    delay:     o.delay     ?? 0,    // 재장전 위상 오프셋 (0~1) — 교대 사격용
    reload:    o.reload    ?? 1,    // 재장전 시간 배수 (클수록 느림)
    recoil:    o.recoil    ?? 1,    // 반동 배수
    damage:    o.damage    ?? 1,    // 총알 데미지 배수
    health:    o.health    ?? 1,    // 총알 관통력 배수
    speed:     o.speed     ?? 1,    // 총알 속도 배수
    spread:    o.spread    ?? 0,    // 탄퍼짐 (라디안)
    size:      o.size      ?? 1,    // 총알 크기 배수
    sizeVar:   o.sizeVar   ?? 0,    // 총알 크기 랜덤 편차
    range:     o.range     ?? 1,    // 사거리(수명) 배수
    trapezoid: o.trapezoid ?? 0,    // 1 = 앞이 넓은 사다리꼴, -1 = 뒤가 넓음
    trap:      o.trap      ?? false, // true면 총알 대신 트랩을 깐다
    drone:     o.drone     ?? false, // true면 총알 대신 드론을 내보낸다
  };
}

/** 순서 = 프로토콜 ID. 절대 중간에 끼워넣지 말 것 (뒤에 추가만). */
export const TANKS = [
  // ── Tier 0 ────────────────────────────────────────────────
  {
    key: 'basic', name: '기본', tier: 0,
    desc: '균형 잡힌 기본형. 여기서 모든 길이 갈라진다.',
    upgrades: ['twin', 'sniper', 'machine', 'flank', 'trapper', 'commander'],
    barrels: [B(0, 0, 0, 1.55, 0.72)],
  },

  // ── Tier 1 (Lv15) ─────────────────────────────────────────
  {
    key: 'twin', name: '쌍포', tier: 1,
    desc: '두 포신이 번갈아 발사. 화력이 두 배, 발당 위력은 절반.',
    upgrades: ['triple', 'twinFlank', 'quad'],
    barrels: [
      B(0, 0, -0.36, 1.55, 0.60, { delay: 0.0, damage: 0.6, health: 0.7 }),
      B(0, 0,  0.36, 1.55, 0.60, { delay: 0.5, damage: 0.6, health: 0.7 }),
    ],
  },
  {
    key: 'sniper', name: '저격수', tier: 1, fov: 1.30,
    desc: '시야가 넓고 탄속이 빠르다. 대신 연사가 느리다.',
    upgrades: ['assassin', 'hunter'],
    barrels: [
      B(0, 0, 0, 2.20, 0.66, { reload: 1.75, speed: 1.55, damage: 1.30, health: 1.25, recoil: 2.4, spread: 0.004 }),
    ],
  },
  {
    key: 'machine', name: '기관총', tier: 1,
    desc: '넓게 흩뿌리는 속사. 근접 압박에 강하다.',
    upgrades: ['destroyer', 'gunner', 'sprayer'],
    barrels: [
      B(0, 0, 0, 1.50, 0.72, { trapezoid: 1, reload: 0.62, damage: 0.55, health: 0.55, speed: 1.05, spread: 0.30, sizeVar: 0.35 }),
    ],
  },
  {
    key: 'flank', name: '플랭크', tier: 1,
    desc: '앞뒤로 쏜다. 후방 포신의 반동이 전진 추진력이 된다.',
    upgrades: ['triAngle', 'quad', 'twinFlank'],
    barrels: [
      B(0,   0, 0, 1.55, 0.72),
      B(180, 0, 0, 1.40, 0.72, { damage: 0.85, speed: 0.90, recoil: 1.3 }),
    ],
  },

  // ── Tier 2 (Lv30) ─────────────────────────────────────────
  {
    key: 'triple', name: '삼연포', tier: 2,
    desc: '부채꼴 3연발. 정면 제압력이 높다.',
    upgrades: ['spread', 'triplet'],
    barrels: [
      B(0,   0, 0, 1.60, 0.68, { delay: 0.0 }),
      B(-24, 0, 0, 1.50, 0.62, { delay: 0.5, damage: 0.7, health: 0.8 }),
      B(24,  0, 0, 1.50, 0.62, { delay: 0.5, damage: 0.7, health: 0.8 }),
    ],
  },
  {
    key: 'twinFlank', name: '쌍둥이 플랭크', tier: 2,
    desc: '앞뒤 모두 쌍포. 사방에서 몰려도 대응할 수 있다.',
    upgrades: ['octo', 'tripleTwin'],
    barrels: [
      B(0,   0, -0.36, 1.50, 0.58, { delay: 0.0,  damage: 0.6, health: 0.7 }),
      B(0,   0,  0.36, 1.50, 0.58, { delay: 0.5,  damage: 0.6, health: 0.7 }),
      B(180, 0, -0.36, 1.50, 0.58, { delay: 0.25, damage: 0.6, health: 0.7 }),
      B(180, 0,  0.36, 1.50, 0.58, { delay: 0.75, damage: 0.6, health: 0.7 }),
    ],
  },
  {
    key: 'quad', name: '사방포', tier: 2,
    desc: '동서남북 동시 사격. 도형 사냥 효율이 최고다.',
    upgrades: ['octo'],
    barrels: [
      B(0,   0, 0, 1.50, 0.66, { damage: 0.85 }),
      B(90,  0, 0, 1.50, 0.66, { damage: 0.85 }),
      B(180, 0, 0, 1.50, 0.66, { damage: 0.85 }),
      B(270, 0, 0, 1.50, 0.66, { damage: 0.85 }),
    ],
  },
  {
    key: 'assassin', name: '암살자', tier: 2, fov: 1.55,
    desc: '더 길어진 포신. 상대가 나를 보기 전에 먼저 쏜다.',
    upgrades: ['ranger', 'stalker'],
    barrels: [
      B(0, 0, 0, 2.50, 0.64, { reload: 2.0, speed: 1.70, damage: 1.55, health: 1.45, recoil: 3.0 }),
    ],
  },
  {
    key: 'hunter', name: '사냥꾼', tier: 2, fov: 1.20,
    desc: '한 번에 크기가 다른 두 발. 명중하면 아프다.',
    upgrades: ['predator'],
    barrels: [
      B(0, 0, 0, 1.90, 0.80, { delay: 0.0,  reload: 1.5, damage: 0.75, health: 0.9, speed: 1.25 }),
      B(0, 0, 0, 2.15, 0.60, { delay: 0.14, reload: 1.5, damage: 0.75, health: 0.9, speed: 1.25, size: 0.85 }),
    ],
  },
  {
    key: 'destroyer', name: '파괴자', tier: 2, speedMult: 0.94,
    desc: '느리지만 한 방이 무겁다. 반동으로 뒤로 밀린다.',
    upgrades: ['annihilator', 'shredder'],
    barrels: [
      B(0, 0, 0, 1.70, 1.00, { reload: 4.0, damage: 3.0, health: 3.2, speed: 0.75, recoil: 5.0 }),
    ],
  },
  {
    key: 'gunner', name: '포수', tier: 2,
    desc: '작은 총알 4연발. 탄막이 끊이지 않는다.',
    upgrades: ['streamliner', 'artillery'],
    barrels: [
      B(0, 0, -0.55, 1.35, 0.34, { delay: 0.00, reload: 0.75, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0, 0,  0.55, 1.35, 0.34, { delay: 0.50, reload: 0.75, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0, 0, -0.19, 1.60, 0.34, { delay: 0.25, reload: 0.75, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0, 0,  0.19, 1.60, 0.34, { delay: 0.75, reload: 0.75, damage: 0.40, health: 0.5, speed: 1.15 }),
    ],
  },
  {
    key: 'sprayer', name: '살포기', tier: 2,
    desc: '기관총 위에 산탄 포신을 하나 더. 벽처럼 쏟아낸다.',
    upgrades: ['storm'],
    barrels: [
      B(0, 0, 0, 1.50, 0.72, { trapezoid: 1, reload: 0.90, damage: 0.55, health: 0.55, spread: 0.06 }),
      B(0, 0, 0, 1.85, 0.55, { trapezoid: 1, reload: 0.50, damage: 0.50, health: 0.50, spread: 0.50, sizeVar: 0.4 }),
    ],
  },
  {
    key: 'triAngle', name: '삼각날개', tier: 2, speedMult: 1.04,
    desc: '뒤쪽 두 포신이 로켓처럼 밀어준다. 아레나에서 가장 빠른 계열.',
    upgrades: ['booster', 'fighter'],
    barrels: [
      B(0,   0, 0, 1.55, 0.72),
      B(150, 0, 0, 1.40, 0.66, { reload: 1.15, damage: 0.7, speed: 0.9, recoil: 2.6 }),
      B(210, 0, 0, 1.40, 0.66, { reload: 1.15, damage: 0.7, speed: 0.9, recoil: 2.6 }),
    ],
  },

  // ── Tier 3 (Lv45) ─────────────────────────────────────────
  {
    key: 'spread', name: '산탄포', tier: 3,
    desc: '전방 부채꼴 7문. 정면에 서는 순간 끝난다.',
    upgrades: [],
    barrels: [
      B(0,   0, 0, 1.65, 0.62, { reload: 1.3, damage: 0.75 }),
      B(-18, 0, 0, 1.50, 0.50, { delay: 0.00, reload: 2.2, damage: 0.55, health: 0.6 }),
      B(-38, 0, 0, 1.36, 0.50, { delay: 0.17, reload: 2.2, damage: 0.55, health: 0.6 }),
      B(-58, 0, 0, 1.22, 0.50, { delay: 0.34, reload: 2.2, damage: 0.55, health: 0.6 }),
      B(18,  0, 0, 1.50, 0.50, { delay: 0.50, reload: 2.2, damage: 0.55, health: 0.6 }),
      B(38,  0, 0, 1.36, 0.50, { delay: 0.67, reload: 2.2, damage: 0.55, health: 0.6 }),
      B(58,  0, 0, 1.22, 0.50, { delay: 0.84, reload: 2.2, damage: 0.55, health: 0.6 }),
    ],
  },
  {
    key: 'triplet', name: '삼련포', tier: 3,
    desc: '나란한 3문이 순차 발사. 한 줄기 탄류를 만든다.',
    upgrades: [],
    barrels: [
      B(0, 0,  0.00, 1.70, 0.72, { delay: 0.00, reload: 1.15, damage: 0.62, health: 0.8 }),
      B(0, 0, -0.50, 1.50, 0.62, { delay: 0.33, reload: 1.15, damage: 0.62, health: 0.8 }),
      B(0, 0,  0.50, 1.50, 0.62, { delay: 0.66, reload: 1.15, damage: 0.62, health: 0.8 }),
    ],
  },
  {
    key: 'octo', name: '팔방포', tier: 3,
    desc: '8방향 전탄 발사. 포위당할수록 강해진다.',
    upgrades: [],
    barrels: [0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
      B(a, 0, 0, 1.40, 0.60, { damage: 0.7, health: 0.8 })
    ),
  },
  {
    key: 'tripleTwin', name: '삼중쌍포', tier: 3,
    desc: '세 방향 쌍포. 회전하며 쏘면 빈틈이 없다.',
    upgrades: [],
    barrels: [
      B(0,   0, -0.36, 1.45, 0.55, { delay: 0.0, damage: 0.55, health: 0.7 }),
      B(0,   0,  0.36, 1.45, 0.55, { delay: 0.5, damage: 0.55, health: 0.7 }),
      B(120, 0, -0.36, 1.45, 0.55, { delay: 0.0, damage: 0.55, health: 0.7 }),
      B(120, 0,  0.36, 1.45, 0.55, { delay: 0.5, damage: 0.55, health: 0.7 }),
      B(240, 0, -0.36, 1.45, 0.55, { delay: 0.0, damage: 0.55, health: 0.7 }),
      B(240, 0,  0.36, 1.45, 0.55, { delay: 0.5, damage: 0.55, health: 0.7 }),
    ],
  },
  {
    key: 'ranger', name: '레인저', tier: 3, fov: 2.00,
    desc: '화면 밖에서 저격한다. 아레나에서 시야가 가장 넓다.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 2.90, 0.62, { reload: 2.4, speed: 2.0, damage: 1.7, health: 1.5, recoil: 3.4, range: 1.6 }),
    ],
  },
  {
    key: 'stalker', name: '스토커', tier: 3, fov: 1.55, invisible: true,
    desc: '멈추고 쏘지 않으면 모습이 사라진다. 매복형.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 2.50, 0.64, { reload: 2.0, speed: 1.7, damage: 1.6, health: 1.45, recoil: 3.0 }),
    ],
  },
  {
    key: 'predator', name: '포식자', tier: 3, fov: 1.35,
    desc: '3연속 관통탄을 한 호흡에. 맞으면 대부분 즉사한다.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 1.70, 0.92, { delay: 0.00, reload: 3.0, damage: 0.9, health: 1.1, speed: 1.3 }),
      B(0, 0, 0, 2.00, 0.74, { delay: 0.09, reload: 3.0, damage: 0.9, health: 1.1, speed: 1.3 }),
      B(0, 0, 0, 2.30, 0.58, { delay: 0.18, reload: 3.0, damage: 0.9, health: 1.1, speed: 1.3 }),
    ],
  },
  {
    key: 'annihilator', name: '섬멸자', tier: 3, speedMult: 0.90,
    desc: '아레나에서 가장 큰 탄환. 한 발이 곧 판정승.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 1.75, 1.30, { reload: 5.0, damage: 4.0, health: 4.2, speed: 0.70, recoil: 7.0 }),
    ],
  },
  {
    key: 'shredder', name: '파쇄자', tier: 3, speedMult: 0.98,
    desc: '파괴자의 반동을 후방 포신으로 상쇄한다. 치고 빠지기용.',
    upgrades: [],
    barrels: [
      B(0,   0, 0, 1.70, 1.05, { reload: 4.2, damage: 3.0, health: 3.2, speed: 0.78, recoil: 5.5 }),
      B(180, 0, 0, 1.35, 0.68, { reload: 1.1, damage: 0.6, health: 0.7, speed: 0.85, recoil: 2.4 }),
    ],
  },
  {
    key: 'streamliner', name: '스트리머', tier: 3, fov: 1.15,
    desc: '5문이 0.04초 간격으로. 총알이 실처럼 이어진다.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 1.35, 0.44, { delay: 0.0, reload: 3.2, damage: 0.35, health: 0.5, speed: 1.25 }),
      B(0, 0, 0, 1.55, 0.44, { delay: 0.2, reload: 3.2, damage: 0.35, health: 0.5, speed: 1.25 }),
      B(0, 0, 0, 1.75, 0.44, { delay: 0.4, reload: 3.2, damage: 0.35, health: 0.5, speed: 1.25 }),
      B(0, 0, 0, 1.95, 0.44, { delay: 0.6, reload: 3.2, damage: 0.35, health: 0.5, speed: 1.25 }),
      B(0, 0, 0, 2.15, 0.44, { delay: 0.8, reload: 3.2, damage: 0.35, health: 0.5, speed: 1.25 }),
    ],
  },
  {
    key: 'artillery', name: '자주포', tier: 3,
    desc: '전방 4문 + 후방 2문. 후퇴하면서도 화력이 죽지 않는다.',
    upgrades: [],
    barrels: [
      B(0,   0, -0.55, 1.35, 0.34, { delay: 0.00, reload: 0.80, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0,   0,  0.55, 1.35, 0.34, { delay: 0.50, reload: 0.80, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0,   0, -0.19, 1.60, 0.34, { delay: 0.25, reload: 0.80, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(0,   0,  0.19, 1.60, 0.34, { delay: 0.75, reload: 0.80, damage: 0.40, health: 0.5, speed: 1.15 }),
      B(180, 0, -0.30, 1.25, 0.50, { delay: 0.00, reload: 1.20, damage: 0.55, health: 0.7, recoil: 2.0 }),
      B(180, 0,  0.30, 1.25, 0.50, { delay: 0.50, reload: 1.20, damage: 0.55, health: 0.7, recoil: 2.0 }),
    ],
  },
  {
    key: 'storm', name: '폭풍', tier: 3,
    desc: '기관총 3문이 부채꼴로. 화면이 총알로 덮인다.',
    upgrades: [],
    barrels: [
      B(0,   0, 0, 1.55, 0.66, { trapezoid: 1, delay: 0.00, reload: 0.70, damage: 0.50, health: 0.5, spread: 0.30, sizeVar: 0.35 }),
      B(-25, 0, 0, 1.40, 0.60, { trapezoid: 1, delay: 0.33, reload: 0.70, damage: 0.45, health: 0.45, spread: 0.35, sizeVar: 0.35 }),
      B(25,  0, 0, 1.40, 0.60, { trapezoid: 1, delay: 0.66, reload: 0.70, damage: 0.45, health: 0.45, spread: 0.35, sizeVar: 0.35 }),
    ],
  },
  {
    key: 'booster', name: '부스터', tier: 3, speedMult: 1.08,
    desc: '후방 추진기 4개. 사격이 곧 가속이다. 도망도 추격도 최고.',
    upgrades: [],
    barrels: [
      B(0,   0, 0, 1.55, 0.72),
      B(150, 0, 0, 1.35, 0.62, { reload: 1.2, damage: 0.6, health: 0.7, speed: 0.85, recoil: 2.4 }),
      B(210, 0, 0, 1.35, 0.62, { reload: 1.2, damage: 0.6, health: 0.7, speed: 0.85, recoil: 2.4 }),
      B(125, 0, 0, 1.20, 0.56, { reload: 1.2, damage: 0.5, health: 0.6, speed: 0.80, recoil: 2.0 }),
      B(235, 0, 0, 1.20, 0.56, { reload: 1.2, damage: 0.5, health: 0.6, speed: 0.80, recoil: 2.0 }),
    ],
  },
  {
    key: 'fighter', name: '전투기', tier: 3, speedMult: 1.05,
    desc: '전후좌우 전부 커버. 빠르고 빈틈이 없는 만능형.',
    upgrades: [],
    barrels: [
      B(0,   0, 0, 1.55, 0.72),
      B(90,  0, 0, 1.25, 0.60, { reload: 1.3, damage: 0.55, health: 0.6, speed: 0.85 }),
      B(270, 0, 0, 1.25, 0.60, { reload: 1.3, damage: 0.55, health: 0.6, speed: 0.85 }),
      B(150, 0, 0, 1.35, 0.62, { reload: 1.2, damage: 0.60, health: 0.7, speed: 0.85, recoil: 2.4 }),
      B(210, 0, 0, 1.35, 0.62, { reload: 1.2, damage: 0.60, health: 0.7, speed: 0.85, recoil: 2.4 }),
    ],
  },

  // ── 보스 전용 (플레이어는 선택할 수 없다) ──────────────────
  {
    key: 'defender', name: '디펜더', tier: -1, boss: true,
    bodyShape: 3,   // 삼각형 몸통
    z: 0,           // 포탑보다 먼저(아래에) 그린다
    desc: '아주 느리게 배회하며 트랩을 깔고 포탑 3문으로 제압하는 보스.',
    upgrades: [],
    barrels: [
      // 꼭짓점 3곳의 넓은 트랩 사출기 — 멀리 못 가지만 오래 남는 트랩을 깐다
      B(0,   0.42, 0, 0.62, 1.05, { trap: true, trapezoid: 1, reload: 5.0, damage: 1.8, health: 5.0, speed: 0.34, size: 0.30, recoil: 0 }),
      B(120, 0.42, 0, 0.62, 1.05, { trap: true, trapezoid: 1, reload: 5.0, damage: 1.8, health: 5.0, speed: 0.34, size: 0.30, recoil: 0, delay: 0.33 }),
      B(240, 0.42, 0, 0.62, 1.05, { trap: true, trapezoid: 1, reload: 5.0, damage: 1.8, health: 5.0, speed: 0.34, size: 0.30, recoil: 0, delay: 0.66 }),
    ],
  },
  {
    key: 'defenderTurret', name: '디펜더 포탑', tier: -1, boss: true,
    z: 2,           // 본체 위에 그린다
    desc: '디펜더 위에 얹힌 소형 포탑. 본체와 따로 조준한다.',
    upgrades: [],
    barrels: [
      B(0, 0, 0, 1.50, 0.80, { reload: 0.80, damage: 0.55, health: 1.0, speed: 1.10, spread: 0.07, recoil: 0 }),
    ],
  },

  // ── 트랩 계열 (Lv15 신규) ──────────────────────────────────
  {
    key: 'trapper', name: '트랩퍼', tier: 1,
    desc: '길목에 트랩을 깐다. 쫓아오는 상대를 가장 확실하게 막는다.',
    upgrades: ['tripleTrapper', 'heavyTrapper'],
    barrels: [
      B(0, 0.10, 0, 1.20, 0.92, { trap: true, trapezoid: 1, reload: 1.6, damage: 1.1, health: 3.5, speed: 0.45, recoil: 0.6 }),
    ],
  },
  {
    key: 'tripleTrapper', name: '삼중 트랩퍼', tier: 2,
    desc: '전방 부채꼴로 세 줄기. 벽을 세우듯 깔아버린다.',
    upgrades: ['octoTrapper'],
    barrels: [
      B(0,   0.10, 0, 1.15, 0.80, { trap: true, trapezoid: 1, delay: 0.00, reload: 2.0, damage: 0.9, health: 3.0, speed: 0.45, recoil: 0.5 }),
      B(-40, 0.10, 0, 1.08, 0.76, { trap: true, trapezoid: 1, delay: 0.33, reload: 2.0, damage: 0.9, health: 3.0, speed: 0.45, recoil: 0.5 }),
      B(40,  0.10, 0, 1.08, 0.76, { trap: true, trapezoid: 1, delay: 0.66, reload: 2.0, damage: 0.9, health: 3.0, speed: 0.45, recoil: 0.5 }),
    ],
  },
  {
    key: 'heavyTrapper', name: '중장 트랩퍼', tier: 2, speedMult: 0.96,
    desc: '거대한 트랩 하나. 밟으면 그대로 끝난다.',
    upgrades: ['fortress'],
    barrels: [
      B(0, 0.10, 0, 1.30, 1.28, { trap: true, trapezoid: 1, reload: 3.0, damage: 2.2, health: 7.0, speed: 0.38, recoil: 1.4 }),
    ],
  },
  {
    key: 'octoTrapper', name: '팔방 트랩퍼', tier: 3,
    desc: '사방팔방에 트랩. 서 있는 자리가 곧 요새가 된다.',
    upgrades: [],
    barrels: [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) =>
      B(a, 0.10, 0, 1.05, 0.70, { trap: true, trapezoid: 1, delay: i / 8, reload: 2.6, damage: 0.85, health: 2.8, speed: 0.42, recoil: 0 })
    ),
  },
  {
    key: 'fortress', name: '요새', tier: 3, speedMult: 0.90,
    desc: '네 방향 중장 트랩. 느리지만 아무도 접근하지 못한다.',
    upgrades: [],
    barrels: [
      B(0,   0.10, 0, 1.25, 1.20, { trap: true, trapezoid: 1, delay: 0.00, reload: 3.2, damage: 2.0, health: 6.5, speed: 0.38, recoil: 0 }),
      B(90,  0.10, 0, 1.25, 1.20, { trap: true, trapezoid: 1, delay: 0.25, reload: 3.2, damage: 2.0, health: 6.5, speed: 0.38, recoil: 0 }),
      B(180, 0.10, 0, 1.25, 1.20, { trap: true, trapezoid: 1, delay: 0.50, reload: 3.2, damage: 2.0, health: 6.5, speed: 0.38, recoil: 0 }),
      B(270, 0.10, 0, 1.25, 1.20, { trap: true, trapezoid: 1, delay: 0.75, reload: 3.2, damage: 2.0, health: 6.5, speed: 0.38, recoil: 0 }),
    ],
  },

  // ── 드론 계열 (Lv15 신규) ──────────────────────────────────
  {
    key: 'commander', name: '지휘관', tier: 1, droneMax: 15, fov: 1.12,
    desc: '작은 삼각 드론을 부린다. 누르면 마우스로 몰고, 놓으면 알아서 싸운다.',
    upgrades: ['marshal', 'legion'],
    barrels: [
      B(135, 0.04, 0, 1.05, 1.00, { drone: true, trapezoid: -1, delay: 0.0, reload: 1.2, damage: 0.9, health: 6.0, speed: 0.9, size: 0.55, recoil: 0 }),
      B(225, 0.04, 0, 1.05, 1.00, { drone: true, trapezoid: -1, delay: 0.5, reload: 1.2, damage: 0.9, health: 6.0, speed: 0.9, size: 0.55, recoil: 0 }),
    ],
  },
  {
    key: 'marshal', name: '통솔자', tier: 2, droneMax: 22, fov: 1.18,
    desc: '드론을 더 많이 거느린다. 숫자로 밀어붙이는 형.',
    upgrades: ['supreme'],
    barrels: [
      B(120, 0.04, 0, 1.00, 0.90, { drone: true, trapezoid: -1, delay: 0.00, reload: 1.1, damage: 0.75, health: 5.0, speed: 0.9, size: 0.50, recoil: 0 }),
      B(240, 0.04, 0, 1.00, 0.90, { drone: true, trapezoid: -1, delay: 0.33, reload: 1.1, damage: 0.75, health: 5.0, speed: 0.9, size: 0.50, recoil: 0 }),
      B(180, 0.04, 0, 1.00, 0.90, { drone: true, trapezoid: -1, delay: 0.66, reload: 1.1, damage: 0.75, health: 5.0, speed: 0.9, size: 0.50, recoil: 0 }),
    ],
  },
  {
    key: 'legion', name: '군단장', tier: 2, droneMax: 8, fov: 1.15,
    desc: '수는 적지만 하나하나가 크고 단단한 드론.',
    upgrades: ['overlord'],
    barrels: [
      B(140, 0.04, 0, 1.10, 1.20, { drone: true, trapezoid: -1, delay: 0.0, reload: 1.6, damage: 1.7, health: 9.0, speed: 0.85, size: 0.85, recoil: 0 }),
      B(220, 0.04, 0, 1.10, 1.20, { drone: true, trapezoid: -1, delay: 0.5, reload: 1.6, damage: 1.7, health: 9.0, speed: 0.85, size: 0.85, recoil: 0 }),
    ],
  },
  {
    key: 'supreme', name: '총사령관', tier: 3, droneMax: 30, fov: 1.25,
    desc: '드론 서른 기. 화면이 삼각형으로 뒤덮인다.',
    upgrades: [],
    barrels: [0, 90, 180, 270].map((a, i) =>
      B(a + 45, 0.04, 0, 0.98, 0.86, { drone: true, trapezoid: -1, delay: i / 4, reload: 1.0, damage: 0.7, health: 4.5, speed: 0.92, size: 0.46, recoil: 0 })
    ),
  },
  {
    key: 'overlord', name: '패왕', tier: 3, droneMax: 10, fov: 1.2,
    desc: '거대 드론 열 기가 따라다닌다. 한 기 한 기가 탱크급.',
    upgrades: [],
    barrels: [
      B(140, 0.04, 0, 1.15, 1.34, { drone: true, trapezoid: -1, delay: 0.0,  reload: 1.5, damage: 2.1, health: 11.0, speed: 0.85, size: 1.00, recoil: 0 }),
      B(220, 0.04, 0, 1.15, 1.34, { drone: true, trapezoid: -1, delay: 0.33, reload: 1.5, damage: 2.1, health: 11.0, speed: 0.85, size: 1.00, recoil: 0 }),
      B(180, 0.04, 0, 1.10, 1.20, { drone: true, trapezoid: -1, delay: 0.66, reload: 1.5, damage: 2.1, health: 11.0, speed: 0.85, size: 1.00, recoil: 0 }),
    ],
  },
];

// ── 파생 테이블 ───────────────────────────────────────────────
TANKS.forEach((t, i) => {
  t.id = i;
  t.fov ??= 1;
  t.speedMult ??= 1;
  t.healthMult ??= 1;
  t.bodyMult ??= 1;
  t.invisible ??= false;
  t.bodyShape ??= 0;   // 0 = 원형, 3 이상 = 정다각형 몸통
  t.z ??= 1;           // 그리는 순서 (작을수록 아래)
  t.boss ??= false;    // 플레이어가 고를 수 없는 NPC 전용 클래스
  t.droneMax ??= 0;    // 0보다 크면 드론 계열
});

export const TANK_BY_KEY = Object.fromEntries(TANKS.map((t) => [t.key, t]));

/** 업그레이드 키 배열 → ID 배열 */
TANKS.forEach((t) => {
  t.upgradeIds = t.upgrades.map((k) => {
    const target = TANK_BY_KEY[k];
    if (!target) throw new Error(`알 수 없는 업그레이드: ${t.key} → ${k}`);
    return target.id;
  });
});

export function tankById(id) {
  return TANKS[id] ?? TANKS[0];
}

/** id 가 fromId 의 정당한 다음 단계인지 (서버 검증용) */
export function isValidUpgrade(fromId, toId) {
  const from = TANKS[fromId];
  return !!from && from.upgradeIds.includes(toId);
}

export const TANK_COUNT = TANKS.length;
