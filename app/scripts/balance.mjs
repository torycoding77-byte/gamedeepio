/**
 * 밸런스 수치 확인 — 바꾼 값이 실제로 어떤 결과를 내는지 계산하고 시뮬레이션한다.
 *   node scripts/balance.mjs
 */
import { World } from '../src/game/world.js';
import { TANK_BY_KEY } from '../public/shared/tanks.js';
import {
  BASE_BULLET_SPEED, BASE_BULLET_LIFE, RECOIL_SCALE, IMPULSE_FRICTION,
  TICK_RATE, DT, reloadTimeFor, STAT_COUNT, KIND,
} from '../public/shared/config.js';

const zero = new Uint8Array(STAT_COUNT);
const decayPerSec = (1 - IMPULSE_FRICTION) * TICK_RATE;

/** 계속 쏠 때 정착되는 반동 속도(u/s) */
function drift(tankKey) {
  let f = 0;
  for (const b of TANK_BY_KEY[tankKey].barrels) {
    const shotsPerSec = 1 / reloadTimeFor(zero, b.reload);
    const impulse = RECOIL_SCALE * b.recoil * b.width;
    // 포신 방향의 반대로 밀린다 → 전방 성분만 합산
    f += -Math.cos(b.angle) * impulse * shotsPerSec;
  }
  return f / decayPerSec;
}

console.log('\n총알');
console.log(`  기본 속도   ${BASE_BULLET_SPEED} u/s`);
console.log(`  기본 사거리 ${Math.round(BASE_BULLET_SPEED * BASE_BULLET_LIFE)} u  (수명 ${BASE_BULLET_LIFE}초)`);
console.log(`  화면 가로 1900u 를 가로지르는 시간 ${(1900 / BASE_BULLET_SPEED).toFixed(2)}초`);

console.log('\n반동 (계속 사격 시 정착 속도, 이동속도 380 기준)');
for (const k of ['basic', 'twin', 'destroyer', 'annihilator', 'triAngle', 'booster']) {
  const d = drift(k);
  const sign = d >= 0 ? '전진' : '후퇴';
  console.log(`  ${TANK_BY_KEY[k].name.padEnd(8)} ${Math.abs(Math.round(d)).toString().padStart(4)} u/s ${sign}  (이동속도의 ${Math.abs(d / 380 * 100).toFixed(0)}%)`);
}

console.log('\n봇 시뮬레이션 (봇 10기끼리 120초)');
const w = new World();
let kills = 0;
const origDestroy = w.destroy.bind(w);
w.destroy = (e) => {
  if (!e.dead && e.kind === KIND.TANK && !e.isBoss && !e.isTurret) kills++;
  return origDestroy(e);
};
for (let i = 0; i < 10; i++) w.addBot();

let shotsFired = 0;
const origSpawn = w.spawnBullet.bind(w);
w.spawnBullet = (o, opt) => { if (o.isBot) shotsFired++; return origSpawn(o, opt); };

for (let t = 0; t < 120 * TICK_RATE; t++) w.step(DT);

const bots = [...w.players.values()].filter((p) => p.isBot);
const levels = bots.map((b) => b.level).sort((a, b) => b - a);
const scores = bots.map((b) => Math.round(b.score)).sort((a, b) => b - a);
console.log(`  봇끼리 처치 수  ${kills}회 (분당 ${(kills / 2).toFixed(1)}회)`);
console.log(`  봇이 쏜 총알    ${shotsFired.toLocaleString()}발`);
console.log(`  레벨 분포       ${levels.join(', ')}`);
console.log(`  상위 점수       ${scores.slice(0, 5).join(', ')}`);
console.log(`  평균 조준오차폭 ${(bots.reduce((s, b) => s + (1 - b.skill) * 0.45, 0) / bots.length * 57.3).toFixed(1)}°`);
console.log(`  평균 회전속도   ${(bots.reduce((s, b) => s + b.turnRate, 0) / bots.length).toFixed(2)} rad/s  (180° 도는 데 ${(Math.PI / (bots.reduce((s, b) => s + b.turnRate, 0) / bots.length)).toFixed(2)}초)`);
console.log('');
