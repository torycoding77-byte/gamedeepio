import {
  reloadTimeFor, bulletSpeedFor, bulletDamageFor, bulletHealthFor,
  BASE_BULLET_LIFE, RECOIL_SCALE, TRAP_LIFE,
} from '../../public/shared/config.js';

/**
 * 사격 로직 — 플레이어와 보스(본체·포탑)가 같은 경로를 탄다.
 *
 * shooter 에게 필요한 것: x, y, angle, radius, stats, vx/vy, ivx/ivy
 * 이 조건만 만족하면 무엇이든 포신을 쏠 수 있다.
 */

/** 포신 로컬 좌표 → 월드 좌표. 클라이언트 렌더링과 같은 식이라야 총구 위치가 맞는다. */
export function muzzleOf(shooter, bar, R) {
  const ca = Math.cos(bar.angle), sa = Math.sin(bar.angle);
  const lx = (bar.x + bar.length) * R;
  const ly = bar.y * R;
  const bx = lx * ca - ly * sa;
  const by = lx * sa + ly * ca;
  const cw = Math.cos(shooter.angle), sw = Math.sin(shooter.angle);
  return {
    x: shooter.x + bx * cw - by * sw,
    y: shooter.y + bx * sw + by * cw,
  };
}

/** 포신 하나 발사 */
export function fireBarrel(world, shooter, bar) {
  const R = shooter.radius;
  const m = muzzleOf(shooter, bar, R);
  const spread = bar.spread ? (Math.random() - 0.5) * 2 * bar.spread : 0;
  const dir = shooter.angle + bar.angle + spread;

  const speed = bulletSpeedFor(shooter.stats, bar.speed);
  const jitter = bar.sizeVar ? 1 + (Math.random() - 0.5) * 2 * bar.sizeVar : 1;
  const radius = Math.max(4, bar.width * R * 0.5 * bar.size * jitter);

  // 트랩은 쏜 쪽의 속도를 물려받지 않는다 — 깔아둔 자리에 그대로 있어야 한다
  const inherit = bar.trap ? 0 : 0.3;

  const spawn = {
    x: m.x,
    y: m.y,
    vx: Math.cos(dir) * speed + (shooter.vx ?? 0) * inherit,
    vy: Math.sin(dir) * speed + (shooter.vy ?? 0) * inherit,
    radius,
    damage: bulletDamageFor(shooter.stats, bar.damage),
    health: bulletHealthFor(shooter.stats, bar.health),
    life: (bar.trap ? TRAP_LIFE : BASE_BULLET_LIFE) * bar.range,
    isTrap: bar.trap,
  };

  if (bar.drone) {
    world.spawnDrone(shooter, spawn);
  } else {
    world.spawnBullet(shooter, spawn);
  }

  // 반동 — 후방 포신 클래스는 이 힘으로 전진한다
  if (bar.recoil) {
    const recoil = RECOIL_SCALE * bar.recoil * bar.width;
    shooter.ivx -= Math.cos(dir) * recoil;
    shooter.ivy -= Math.sin(dir) * recoil;
  }
}

/**
 * 재장전 위상을 진행시키고 다 찬 포신을 발사한다.
 * phases 는 포신 수와 길이가 같은 Float64Array (0~1 위상).
 * 한 발이라도 쐈으면 true.
 */
export function tickBarrels(world, shooter, barrels, phases, firing, dt) {
  let fired = false;
  for (let i = 0; i < barrels.length; i++) {
    const bar = barrels[i];
    const reload = reloadTimeFor(shooter.stats, bar.reload);
    phases[i] += dt / reload;

    // 드론은 "쏘는" 게 아니라 편제를 유지하는 것 — 방아쇠와 무관하게
    // 최대 보유 수에 못 미치면 계속 보충한다.
    const wantFire = bar.drone
      ? (shooter.droneCount || 0) < (shooter.droneMax || 0)
      : firing;

    if (!wantFire) {
      // 장전은 끝까지만 차오른다 (기다렸다가 몰아 쏘는 것 방지)
      if (phases[i] > 1) phases[i] = 1;
      continue;
    }
    if (phases[i] >= 1) {
      phases[i] = Math.min(phases[i] - 1, 0.99);
      fireBarrel(world, shooter, bar);
      fired = true;
    }
  }
  return fired;
}

/** 포신별 발사 위상을 초기 지연값으로 되돌린다 */
export function resetPhases(barrels, phases) {
  for (let i = 0; i < barrels.length; i++) phases[i] = barrels[i].delay;
}
