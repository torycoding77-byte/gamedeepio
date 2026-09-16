/**
 * 배포 전 자체 점검.
 *   node scripts/check.js
 *
 * Cloudflare 런타임 없이 순수 Node 에서 돌아가는 부분(게임 로직 전체)을 실제로 굴려본다.
 * wrangler dev 를 띄우기 전에 여기서 걸러지는 버그가 대부분이다.
 */
import { World } from '../src/game/world.js';
import { TANKS, tankById, TANK_BY_KEY } from '../public/shared/tanks.js';
import { Writer, Reader, readSnapshot, IN } from '../public/shared/protocol.js';
import {
  MAX_LEVEL, MAX_STAT, STAT_COUNT, DT, pointsGainedAt, xpForLevel, SHAPE_TARGET,
  KIND, BOSS_COUNT, BOSS_XP, BOSS_RESPAWN_DELAY, TRAP_LIFE, BASE_BULLET_LIFE,
  ARENA_HALF, ARENA_SIZE, ALPHA_TYPE, ALPHA_COUNT, ALPHA_ZONE,
} from '../public/shared/config.js';

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(t) { console.log(`\n${t}`); }

// ── 1. 탱크 트리 ──────────────────────────────────────────────
section('탱크 트리');
const PLAYER_TANKS = TANKS.filter((t) => !t.boss);
const BOSS_TANKS = TANKS.filter((t) => t.boss);
check(`플레이어 클래스 ${PLAYER_TANKS.length}종 + 보스 전용 ${BOSS_TANKS.length}종`,
  PLAYER_TANKS.length >= 20 && BOSS_TANKS.length > 0);

const reachable = new Set([0]);
const queue = [0];
while (queue.length) {
  const t = tankById(queue.pop());
  for (const id of t.upgradeIds) if (!reachable.has(id)) { reachable.add(id); queue.push(id); }
}
const orphans = PLAYER_TANKS.filter((t) => !reachable.has(t.id)).map((t) => t.key);
check('모든 플레이어 클래스가 기본형에서 도달 가능', orphans.length === 0, `고립: ${orphans.join(', ')}`);
check('보스 클래스는 플레이어가 고를 수 없음',
  BOSS_TANKS.every((t) => !TANKS.some((o) => o.upgradeIds.includes(t.id))));

const badBarrels = TANKS.filter((t) => !t.barrels?.length).map((t) => t.key);
check('모든 클래스에 포신이 있음', badBarrels.length === 0, badBarrels.join(', '));

const deadEnds = PLAYER_TANKS.filter((t) => t.tier < 3 && t.upgradeIds.length === 0).map((t) => t.key);
check('티어 3 미만에 막다른 길 없음', deadEnds.length === 0, deadEnds.join(', '));

// ── 2. 성장 곡선 ──────────────────────────────────────────────
section('성장 곡선');
let totalPoints = 0;
let totalXp = 0;
for (let l = 2; l <= MAX_LEVEL; l++) totalPoints += pointsGainedAt(l);
for (let l = 1; l < MAX_LEVEL; l++) totalXp += xpForLevel(l);
check(`최대 레벨 스탯 포인트 ${totalPoints}점`, totalPoints > 25 && totalPoints < STAT_COUNT * MAX_STAT,
  `모든 스탯을 채우려면 ${STAT_COUNT * MAX_STAT}점이 필요하다`);
check(`만렙까지 누적 경험치 ${totalXp.toLocaleString()}`, totalXp > 10000 && totalXp < 500000);

// ── 3. 시뮬레이션 ─────────────────────────────────────────────
section('시뮬레이션 (600틱 = 20초)');
const world = new World();
check(`초기 도형 ${world.shapes.size}개`, world.shapes.size === SHAPE_TARGET);

const me = world.addPlayer('점검용');
me.spawn(0);

for (let i = 0; i < 8; i++) world.addBot();

let maxBullets = 0;
let anyNaN = null;
let peakScore = 0;   // 사망 시 진행도가 초기화되므로 최고치를 따로 본다
let myDeaths = 0;

for (let tick = 0; tick < 600; tick++) {
  // 가장 가까운 도형을 조준하며 사격 — 실제 플레이에 가깝게
  let best = null, bestD = Infinity;
  for (const s of world.shapes.values()) {
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  me.setInput(IN.FIRE, best ? Math.atan2(best.y - me.y, best.x - me.x) : 0, bestD, tick);

  world.step(DT);
  maxBullets = Math.max(maxBullets, world.bullets.size);
  peakScore = Math.max(peakScore, me.score);

  if (!anyNaN) {
    for (const p of world.players.values()) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.health)) {
        anyNaN = `player ${p.name} x=${p.x} y=${p.y} hp=${p.health}`;
        break;
      }
    }
    for (const b of world.bullets.values()) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { anyNaN = `bullet ${b.id}`; break; }
    }
  }
  // 죽으면 다시 살려서 계속 굴린다
  if (!me.alive) { myDeaths++; me.resetProgress(); me.spawn(world.time); }
}

check('NaN / Infinity 없음', anyNaN === null, anyNaN ?? '');
check(`총알이 실제로 발사됨 (최대 동시 ${maxBullets}발)`, maxBullets > 0);
check(`도형 개수 유지 (${world.shapes.size}/${SHAPE_TARGET})`, world.shapes.size >= SHAPE_TARGET - 12);
check(`플레이어가 경험치를 획득 (최고 ${Math.round(peakScore)}점, 사망 ${myDeaths}회)`,
  peakScore > 0, '총알이 도형에 맞지 않았거나 킬 귀속이 끊겼다');
check('봇이 살아서 움직임', [...world.players.values()].some((p) => p.isBot && p.alive));
const liveIds = world.players.size + world.bullets.size + world.shapes.size
  + world.bosses.size + world.turrets.size;
check('ID 누수 없음', world.used.size === liveIds, `used=${world.used.size} vs 실제=${liveIds}`);

const bound = ARENA_HALF + 50;
const arenaOk = [...world.players.values()].every((p) => Math.abs(p.x) < bound && Math.abs(p.y) < bound);
check('모든 탱크가 아레나 안에 있음', arenaOk);

// ── 4. 프로토콜 왕복 ──────────────────────────────────────────
section('바이너리 프로토콜');
const w = new Writer(16384);
world.buildSnapshot(w, me);
const bytes = w.done();
check(`스냅샷 ${bytes.byteLength.toLocaleString()} 바이트`, bytes.byteLength < 4096,
  '4KB를 넘으면 30Hz 전송에서 대역폭이 문제가 된다');

const r = new Reader(bytes);
r.u8(); // 오피코드
const snap = readSnapshot(r);
check('디코딩된 좌표가 서버와 일치', Math.abs(snap.self.x - Math.round(me.x)) < 1,
  `${snap.self.x} vs ${Math.round(me.x)}`);
check('디코딩된 레벨/클래스 일치', snap.self.level === me.level && snap.self.classId === me.classId);
check(`시야 내 엔티티 ${snap.entities.length}개 복원`, snap.entities.length > 0);
check('남은 바이트 없음 (레이아웃 어긋남 없음)', r.remaining === 0, `${r.remaining} 바이트 남음`);

const kinds = new Set(snap.entities.map((e) => e.kind));
check('도형이 시야에 잡힘', kinds.has(2));


// ── 5. 보스: 디펜더 ───────────────────────────────────────────
section('보스 — 디펜더');

const bw = new World();
// 도형과 봇을 치워 보스만 남긴다 (자해 여부를 깨끗하게 보기 위해)
bw.shapes.clear();
bw.spawnShape = () => null;
bw.maintainBots = () => {};
for (const id of [...bw.players.keys()]) bw.removePlayer(id);

const boss = [...bw.bosses.values()][0];
check(`보스 ${bw.bosses.size}기 스폰`, bw.bosses.size === BOSS_COUNT);
check(`포탑 ${bw.turrets.size}문 장착`, bw.turrets.size === 3);
check('보스가 삼각형 몸통', tankById(boss.classId).bodyShape === 3);
check(`보스 체력 ${boss.maxHealth.toLocaleString()}`, boss.maxHealth > 5000);

// 트랩이 어디서 생겨 어디서 멈추는지 추적한다
const traps = [];
const origSpawn = bw.spawnBullet.bind(bw);
bw.spawnBullet = (owner, o) => {
  const b = origSpawn(owner, o);
  if (b && b.isTrap) traps.push({ b, bx: o.x, by: o.y });
  return b;
};

const startPos = { x: boss.x, y: boss.y };
const hp0 = boss.health;
for (let i = 0; i < 300; i++) bw.step(DT);   // 10초

const travelled = Math.hypot(boss.x - startPos.x, boss.y - startPos.y);
check(`10초 동안 ${Math.round(travelled)}유닛 이동 — 아주 느림`,
  travelled > 0 && travelled < 700, '일반 탱크라면 3800유닛을 간다');

check(`트랩 ${traps.length}개 사출`, traps.length > 0);

const alive = traps.filter((t) => !t.b.dead);
const maxTravel = Math.max(0, ...alive.map((t) => Math.hypot(t.b.x - t.bx, t.b.y - t.by)));
check(`트랩 최대 이동거리 ${Math.round(maxTravel)}유닛 — 멀리 나가지 않음`,
  maxTravel > 30 && maxTravel < 450);

const stopped = alive.filter((t) => Math.hypot(t.b.vx, t.b.vy) < 12).length;
check(`정지한 트랩 ${stopped}/${alive.length} — 깔린 자리에 머무름`,
  alive.length > 0 && stopped / alive.length > 0.6);

check(`트랩 수명 ${TRAP_LIFE}초 (총알 ${BASE_BULLET_LIFE}초의 ${(TRAP_LIFE / BASE_BULLET_LIFE).toFixed(1)}배)`,
  TRAP_LIFE > BASE_BULLET_LIFE * 3);
check(`10초 뒤에도 ${alive.length}개가 남아 있음`, alive.length > 5);

check('보스가 자기 트랩·포탄에 맞지 않음', boss.health >= hp0,
  `체력 ${Math.round(hp0)} → ${Math.round(boss.health)}`);

// 포탑이 각자 조준하는지 — 보스 주변 세 방향에 적을 세운다
const around = [0, 2.1, 4.2].map((a, i) => {
  const p = bw.addPlayer('표적' + i);
  p.spawn(bw.time);
  p.x = boss.x + Math.cos(a) * 520;
  p.y = boss.y + Math.sin(a) * 520;
  return p;
});
for (let i = 0; i < 30; i++) {
  for (const p of around) { p.setInput(0, 0, 0, i); }
  bw.step(DT);
}
const turretAngles = [...bw.turrets.values()].map((t) => t.angle.toFixed(3));
check(`포탑 3문이 따로 조준 (${turretAngles.join(' / ')})`,
  new Set(turretAngles).size > 1, '전부 같은 방향이면 독립 조준이 아니다');

const turretShots = [...bw.bullets.values()].filter((b) => !b.isTrap).length;
check(`포탑이 작은 포탄 ${turretShots}발 발사 중`, turretShots > 0);

// 보스에게 죽으면 사망 화면에 "아레나" 가 아니라 보스 이름이 떠야 한다
const victim = around[0];
bw.damage(victim, victim.health + 1, boss.id);
check('보스에게 죽으면 처치자가 "디펜더"', victim.killerName === '디펜더', victim.killerName);

const victim2 = around[1];
const anyTurret = [...bw.turrets.values()][0];
bw.damage(victim2, victim2.health + 1, anyTurret.teamId);
check('포탑에게 죽어도 본체 이름으로 기록', victim2.killerName === '디펜더', victim2.killerName);

// 처치 보상
const slayer = bw.addPlayer('보스킬러');
slayer.spawn(bw.time);
const before = slayer.score;
bw.damage(boss, boss.health + 1, slayer.id);
check('보스 처치됨', boss.dead && !boss.alive);
check(`처치 보상 ${Math.round(slayer.score - before).toLocaleString()} 경험치`,
  Math.round(slayer.score - before) === BOSS_XP,
  `기대 ${BOSS_XP}`);
check(`한 방에 Lv${slayer.level} 도달`, slayer.level > 20);

// 처치 직후 정리 + 재등장 예약
bw.step(DT);
check('죽은 보스와 포탑이 정리됨', bw.bosses.size === 0 && bw.turrets.size === 0);
check(`${BOSS_RESPAWN_DELAY}초 뒤 재등장 예약`, bw.bossRespawnAt > bw.time);

bw.time = bw.bossRespawnAt + 1;
bw.step(DT);
check('시간이 지나면 다시 등장', bw.bosses.size === BOSS_COUNT && bw.turrets.size === 3);

// 스냅샷에 트랩이 실리는지
const bwBoss = [...bw.bosses.values()][0];
const viewer = [...bw.players.values()][0];
viewer.x = bwBoss.x; viewer.y = bwBoss.y;
for (let i = 0; i < 90; i++) bw.step(DT);
const bw2 = new Writer(16384);
bw.buildSnapshot(bw2, viewer);
const br = new Reader(bw2.done());
br.u8();
const bsnap = readSnapshot(br);
const bkinds = new Set(bsnap.entities.map((e) => e.kind));
check('스냅샷에 트랩이 실림 (KIND.TRAP)', bkinds.has(KIND.TRAP));
check('스냅샷에 보스 본체와 포탑이 실림',
  bsnap.entities.filter((e) => e.kind === KIND.TANK && tankById(e.sub).boss).length >= 4);


// ── 6. 맵 / 알파 오각형 ───────────────────────────────────────
section('맵과 알파 오각형');
check(`아레나 ${ARENA_SIZE}×${ARENA_SIZE}`, ARENA_SIZE >= 10000);
check(`도형 ${world.shapes.size}개 (넓이에 비례)`, world.shapes.size >= SHAPE_TARGET - 12);

const alphas = [...world.shapes.values()].filter((s) => s.typeIdx === ALPHA_TYPE);
check(`알파 오각형 ${alphas.length}개만 존재`, alphas.length === ALPHA_COUNT, `기대 ${ALPHA_COUNT}`);
const maxR = Math.max(0, ...alphas.map((a) => Math.hypot(a.x, a.y)));
check(`전부 맵 중앙 반경 ${ALPHA_ZONE} 안 (최대 ${Math.round(maxR)})`, maxR < ALPHA_ZONE * 1.6);

const others = [...world.shapes.values()].filter((s) => s.typeIdx !== ALPHA_TYPE);
check('일반 도형은 무작위 스폰 (중앙에 몰려있지 않음)',
  others.some((s) => Math.hypot(s.x, s.y) > ARENA_HALF * 0.5));

// ── 7. Lv15 승급 6종 ──────────────────────────────────────────
section('Lv15 승급 선택지');
const basicTank = TANK_BY_KEY.basic;
check(`선택지 ${basicTank.upgradeIds.length}가지`, basicTank.upgradeIds.length === 6,
  basicTank.upgrades.join(', '));
check('트랩퍼 포함', basicTank.upgrades.includes('trapper'));
check('지휘관(드론) 포함', basicTank.upgrades.includes('commander'));

// ── 8. 트랩퍼 ─────────────────────────────────────────────────
section('트랩퍼');
const tw = new World();
tw.maintainBots = () => {};
tw.shapes.clear();
tw.spawnShape = () => null;
for (const id of [...tw.players.keys()]) tw.removePlayer(id);
const trapper = tw.addPlayer('트랩퍼');
trapper.spawn(0);
trapper.upgradeTokens = 1;
check('기본형 → 트랩퍼 승급 가능', trapper.chooseClass(TANK_BY_KEY.trapper.id));
trapper.setInput(IN.FIRE, 0, 500, 1);
for (let i = 0; i < 150; i++) tw.step(DT);
const laid = [...tw.bullets.values()].filter((b) => b.isTrap);
check(`플레이어가 트랩 ${laid.length}개를 깖`, laid.length > 0);
check('내 트랩은 나를 때리지 않음', trapper.health === trapper.maxHealth,
  `${Math.round(trapper.health)}/${Math.round(trapper.maxHealth)}`);

// ── 9. 드론 (지휘관) ──────────────────────────────────────────
section('드론 — 지휘관');
const dw = new World();
dw.maintainBots = () => {};
dw.shapes.clear();
dw.spawnShape = () => null;
for (const id of [...dw.players.keys()]) dw.removePlayer(id);
for (const id of [...dw.bosses.keys()]) {
  const b = dw.bosses.get(id);
  for (const t of b.turrets) { dw.turrets.delete(t.id); dw.freeId(t.id); }
  dw.bosses.delete(id); dw.freeId(id);
}
dw.maintainBoss = () => {};

// 알파 오각형은 맵 중앙에만 있으므로 지휘관은 외곽에 세운다
const HOME_X = 3000, HOME_Y = 3000;
const cmdr = dw.addPlayer('지휘관');
cmdr.spawn(0);
cmdr.x = HOME_X; cmdr.y = HOME_Y;
cmdr.upgradeTokens = 1;
check('기본형 → 지휘관 승급 가능', cmdr.chooseClass(TANK_BY_KEY.commander.id));
check(`최대 드론 ${cmdr.droneMax}기`, cmdr.droneMax === 15, String(cmdr.droneMax));

cmdr.setInput(0, 0, 0, 1);                    // 방아쇠를 놓은 상태
const hold = () => { cmdr.x = HOME_X; cmdr.y = HOME_Y; };
for (let i = 0; i < 300; i++) { hold(); dw.step(DT); }
let drones = [...dw.bullets.values()].filter((b) => b.isDrone);
check(`방아쇠를 놓아도 드론 ${drones.length}기가 자동으로 편성됨`, drones.length === cmdr.droneMax,
  `${drones.length}/${cmdr.droneMax}`);
check('드론은 삼각형(KIND.DRONE)으로 전송됨', drones.every((d) => d.kind === KIND.DRONE));

// 대기 중에는 주인 주위를 돈다
const orbitDist = drones.map((d) => Math.hypot(d.x - HOME_X, d.y - HOME_Y));
const meanOrbit = orbitDist.reduce((a, b) => a + b, 0) / orbitDist.length;
check(`대기 시 주인 주위를 맴돔 (평균 ${Math.round(meanOrbit)}유닛)`, meanOrbit < 600);

// ── 마우스로 몰기 ──
const CMD_X = HOME_X + 900, CMD_Y = HOME_Y;
cmdr.setInput(IN.FIRE, 0, 900, 2);
const meanTo = (px, py) => {
  const ds = [...dw.bullets.values()].filter((b) => b.isDrone);
  return ds.reduce((a, d) => a + Math.hypot(d.x - px, d.y - py), 0) / Math.max(1, ds.length);
};
const beforeCmd = meanTo(CMD_X, CMD_Y);
for (let i = 0; i < 180; i++) { hold(); dw.step(DT); }   // 6초 (900유닛 이동에 최소 3초)
const afterCmd = meanTo(CMD_X, CMD_Y);
check(`마우스를 누르면 그 지점으로 몰려감 (${Math.round(beforeCmd)} → ${Math.round(afterCmd)}유닛)`,
  afterCmd < 220, `평균 ${Math.round(afterCmd)}유닛까지만 접근`);

// ── 놓으면 알아서 공격 ──
const { Shape } = await import('../src/game/entities.js');
const target = new Shape(dw.allocId(), 0, HOME_X + 500, HOME_Y);   // 사각형 하나를 옆에 둔다
dw.shapes.set(target.id, target);
const preyHp0 = target.health;
cmdr.setInput(0, 0, 0, 3);                    // 방아쇠를 놓는다
for (let i = 0; i < 180; i++) { hold(); dw.step(DT); }
check('방아쇠를 놓으면 주변 도형을 알아서 공격',
  target.dead || target.health < preyHp0,
  `체력 ${Math.round(preyHp0)} → ${Math.round(target.health)}`);

// ── 잃으면 보충 ──
drones = [...dw.bullets.values()].filter((b) => b.isDrone);
const killed = drones.slice(0, 6);
for (const d of killed) d.dead = true;
dw.step(DT);
const afterLoss = [...dw.bullets.values()].filter((b) => b.isDrone).length;
for (let i = 0; i < 200; i++) { hold(); dw.step(DT); }
const refilled = [...dw.bullets.values()].filter((b) => b.isDrone).length;
check(`파괴되면 다시 보충 (${afterLoss} → ${refilled}기)`, refilled > afterLoss);
check('최대치를 넘지 않음', refilled <= cmdr.droneMax, `${refilled}/${cmdr.droneMax}`);

// ── 주인이 죽으면 드론도 사라진다 ──
dw.damage(cmdr, cmdr.health + 1, 0);
for (let i = 0; i < 5; i++) dw.step(DT);
check('주인이 죽으면 드론도 소멸',
  [...dw.bullets.values()].filter((b) => b.isDrone).length === 0);

// ── 결과 ──────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(`실패 ${failures}건`);
  process.exit(1);
}
console.log('전부 통과. wrangler dev 로 띄워도 좋다.');
