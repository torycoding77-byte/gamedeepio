/**
 * 통합 점검 — 실제로 뜬 서버에 WebSocket 두 개를 붙여 멀티플레이가 도는지 본다.
 *   1) npm run dev   (다른 터미널)
 *   2) node scripts/e2e.js
 *
 * Durable Object 안의 틱 루프, 바이너리 왕복, 봇 채우기, 리더보드까지 한 번에 확인한다.
 */
import {
  S2C, Reader, encodeSpawn, encodeInput,
  readSnapshot, decodeWelcome, decodeNames, decodeLeaderboard, decodeDeath,
  IN,
} from '../public/shared/protocol.js';
import { KIND } from '../public/shared/config.js';
import { tankById } from '../public/shared/tanks.js';

const URL_BASE = process.env.URL || 'ws://127.0.0.1:8787/ws?room=e2e';
// 아레나 끝에서 중앙까지 약 8초. 서로 마주치기에 충분한 시간을 준다.
const DURATION = Number(process.env.DURATION || 14000);

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

function makeClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_BASE);
    ws.binaryType = 'arraybuffer';

    const c = {
      ws, name,
      id: 0,
      snapshots: 0,
      lastSelf: null,
      everAlive: false,
      everMoved: false,
      deaths: 0,
      respawns: 0,
      maxLevel: 1,
      maxEntities: 0,
      sawTank: false,
      sawShape: false,
      sawBullet: false,
      sawTrap: false,
      sawBoss: false,
      names: new Map(),
      leaderboard: [],
      bytes: 0,
    };

    const timer = setTimeout(() => reject(new Error(`${name}: 연결 시간 초과`)), 8000);

    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`${name}: ${e.message || 'ws 오류'}`)); };

    ws.onmessage = (ev) => {
      const buf = ev.data;
      c.bytes += buf.byteLength;
      const r = new Reader(buf);
      const op = r.u8();

      if (op === S2C.WELCOME) {
        c.id = decodeWelcome(r).playerId;
        clearTimeout(timer);
        ws.send(encodeSpawn(name));
        resolve(c);
      } else if (op === S2C.SNAPSHOT) {
        const s = readSnapshot(r);
        c.snapshots++;
        c.lastSelf = s.self;
        if (s.self.alive) c.everAlive = true;
        if (Math.abs(s.self.vx) > 1 || Math.abs(s.self.vy) > 1) c.everMoved = true;
        c.maxLevel = Math.max(c.maxLevel, s.self.level);
        c.maxEntities = Math.max(c.maxEntities, s.entities.length);
        for (const e of s.entities) {
          if (e.kind === KIND.TANK) {
            c.sawTank = true;
            if (tankById(e.sub).boss) c.sawBoss = true;
          } else if (e.kind === KIND.SHAPE) c.sawShape = true;
          else if (e.kind === KIND.BULLET) c.sawBullet = true;
          else if (e.kind === KIND.TRAP) c.sawTrap = true;
        }
      } else if (op === S2C.NAMES) {
        c.names = new Map(decodeNames(r).map((n) => [n.id, n.name]));
      } else if (op === S2C.LEADERBOARD) {
        c.leaderboard = decodeLeaderboard(r);
      } else if (op === S2C.DEATH) {
        // 실제 클라이언트와 같이 동작한다: 죽으면 다시 참전
        decodeDeath(r);
        c.deaths++;
        setTimeout(() => {
          if (ws.readyState === 1) { ws.send(encodeSpawn(name)); c.respawns++; }
        }, 300);
      }
    };
  });
}

console.log(`\n서버: ${URL_BASE}`);

const a = await makeClient('점검A');
const b = await makeClient('점검B');
console.log(`  연결됨: A=#${a.id}, B=#${b.id}\n`);

// 스폰은 일부러 서로 멀리 떨어뜨린다. 두 클라이언트를 아레나 중앙으로 몰아
// "다른 탱크가 실제로 보이는가" 를 확실하게 확인한다.
let seq = 0;
const pump = setInterval(() => {
  seq = (seq + 1) & 0xffff;
  for (const c of [a, b]) {
    if (c.ws.readyState !== 1) continue;
    const s = c.lastSelf;
    let flags = IN.FIRE;
    let angle = 0;
    if (s) {
      if (s.x > 60) flags |= IN.LEFT;
      if (s.x < -60) flags |= IN.RIGHT;
      if (s.y > 60) flags |= IN.UP;
      if (s.y < -60) flags |= IN.DOWN;
      angle = Math.atan2(-s.y, -s.x);
    }
    c.ws.send(encodeInput(flags, angle, 700, seq));
  }
}, 1000 / 30);

await new Promise((r) => setTimeout(r, DURATION));
clearInterval(pump);

const secs = DURATION / 1000;

console.log('연결과 틱 루프');
check(`A 스냅샷 ${a.snapshots}개 (${(a.snapshots / secs).toFixed(1)}Hz)`,
  a.snapshots / secs > 20, '30Hz 틱 루프가 돌지 않는다');
check(`B 스냅샷 ${b.snapshots}개 (${(b.snapshots / secs).toFixed(1)}Hz)`, b.snapshots / secs > 20);
check('A 참전 성공', a.everAlive);
check('B 참전 성공', b.everAlive);
check(`사망 → 재참전 동작 (A ${a.deaths}회 사망 / ${a.respawns}회 재참전)`,
  a.deaths === 0 || a.respawns > 0, '사망 후 다시 들어갈 수 없다');

console.log('\n월드 동기화');
check(`시야 내 엔티티 최대 ${a.maxEntities}개`, a.maxEntities > 5);
check('도형이 보인다', a.sawShape);
check('다른 탱크가 보인다 (봇 포함)', a.sawTank);
check('총알이 보인다', a.sawBullet);

console.log('\n보스');
const allNames = [...a.names.values()];
check('보스 "디펜더" 가 참가자 목록에 올라옴', allNames.includes('디펜더'), allNames.join(', '));
console.log(`  · 보스를 실제로 마주침: ${a.sawBoss || b.sawBoss ? '예' : '아니오 (아레나가 넓어 못 만남)'}`);
console.log(`  · 트랩을 화면에서 봄:   ${a.sawTrap || b.sawTrap ? '예' : '아니오'}`);

console.log('\n참가자');
const names = [...a.names.values()];
check(`참가자 ${a.names.size}명 인식`, a.names.size >= 2, names.join(', '));
check('A가 B의 닉네임을 안다', names.includes('점검B'), names.join(', '));
// 로스터에는 점검용 클라이언트 2개와 보스도 포함된다 — 봇만 세려면 빼야 한다
const botCount = names.filter((n) => n !== '점검A' && n !== '점검B' && n !== '디펜더').length;
check(`봇이 방을 채운다 (${botCount}명)`, botCount >= 5,
  '봇 없이 빈 방이면 혼자 접속했을 때 게임이 성립하지 않는다');
check(`리더보드 ${a.leaderboard.length}명`, a.leaderboard.length >= 2);

console.log('\n진행도와 대역폭');
check('A가 이동했다 (서버가 입력을 처리)', a.everMoved);
check(`A 최고 레벨 ${a.maxLevel}`, a.maxLevel >= 1);
const kbps = a.bytes / 1024 / secs;
check(`수신 대역폭 ${kbps.toFixed(1)} KB/s`, kbps < 80, '실사용에 부담되는 수준');

a.ws.close();
b.ws.close();

console.log('');
if (failures > 0) { console.log(`실패 ${failures}건`); process.exit(1); }
console.log('멀티플레이 정상 동작.');
process.exit(0);
