/**
 * 브라우저에서 실제로 게임을 띄우고 조작해 본다.
 *   node scripts/drive.mjs            (기본 http://127.0.0.1:8788)
 * 서버가 떠 있어야 한다.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://127.0.0.1:8788';
const ROOM = process.env.ROOM || 'drive';
const SHOT_DIR = process.env.SHOT_DIR || 'shots';
mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

/** 화면에서 특정 색이 몇 픽셀이나 보이는지 (허용 오차 포함) */
const COLORS = {
  '내 탱크(청록)':  [0x3f, 0xd2, 0xc7],
  '보스(빨강)':     [0xff, 0x4d, 0x4d],
  '사각형(노랑)':   [0xf2, 0xc1, 0x4e],
  '삼각형(주황)':   [0xe8, 0x70, 0x5f],
  '오각형(파랑)':   [0x7b, 0x83, 0xf0],
  '포신(회색)':     [0xa3, 0xa8, 0xb0],
  '그리드':         [0x23, 0x27, 0x2e],
};

async function samplePixels(page) {
  return page.evaluate((colors) => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hits = {};
    for (const k of Object.keys(colors)) hits[k] = 0;
    let nonBg = 0;
    const total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // 배경(#191c21) 이 아닌 픽셀
      if (Math.abs(r - 0x19) > 6 || Math.abs(g - 0x1c) > 6 || Math.abs(b - 0x21) > 6) nonBg++;
      for (const [k, [cr, cg, cb]] of Object.entries(colors)) {
        if (Math.abs(r - cr) <= 10 && Math.abs(g - cg) <= 10 && Math.abs(b - cb) <= 10) hits[k]++;
      }
    }
    return { hits, nonBg, total };
  }, COLORS);
}

// 시스템에 설치된 Chrome 을 쓴다 (Playwright 전용 브라우저를 따로 받지 않아도 된다)
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push(`요청 실패: ${r.url()} (${r.failure()?.errorText})`));

console.log(`\n브라우저로 접속: ${BASE}/?room=${ROOM}`);
await page.goto(`${BASE}/?room=${ROOM}`, { waitUntil: 'load' });

console.log('\n1. 로딩과 연결');
await page.waitForFunction(() => {
  const b = document.getElementById('play');
  return b && !b.disabled;
}, { timeout: 25000 });
check('WebSocket 연결 성공 (시작 버튼 활성화)', true);
check('시작 화면 표시', await page.isVisible('#menu'));
await page.screenshot({ path: `${SHOT_DIR}/1-menu.png` });

console.log('\n2. 참전');
await page.fill('#nick', '드라이버');
await page.click('#play');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
await page.waitForFunction(() => /Lv \d/.test(document.getElementById('level-label')?.textContent || ''),
  { timeout: 15000 });
check('HUD 표시', await page.isVisible('#hud'));
check('메뉴 닫힘', await page.isHidden('#menu'));

console.log('\n3. 조작 — 이동하며 사격');
// 스폰 직후 한 장 — 죽기 전 살아있는 화면을 잡는다
await page.waitForTimeout(900);
await page.screenshot({ path: SHOT_DIR + '/2-spawn.png' });
const early = await samplePixels(page);
console.log('     스폰 직후: 보스 ' + early.hits['보스(빨강)'] + 'px, 내탱크 ' + early.hits['내 탱크(청록)'] + 'px, 트랩색 확인용');
if (process.env.EXPECT_BOSS) {
  check('스폰 직후 보스가 보임', early.hits['보스(빨강)'] > 300, early.hits['보스(빨강)'] + ' px');
  check('스폰 직후 내 탱크가 보임', early.hits['내 탱크(청록)'] > 100, early.hits['내 탱크(청록)'] + ' px');

  // 보스 픽셀의 무게중심을 찾아 그쪽으로 걸어가 화면 가운데에 담는다
  const findBoss = () => page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 0xff) <= 10 && Math.abs(d[i + 1] - 0x4d) <= 10 && Math.abs(d[i + 2] - 0x4d) <= 10) {
        const px2 = (i / 4) % c.width, py2 = Math.floor((i / 4) / c.width);
        sx += px2; sy += py2; n++;
      }
    }
    return n ? { x: sx / n / c.width, y: sy / n / c.height, n } : null;
  });

  // 살아있는 동안의 프레임 중 보스가 가장 크게 잡힌 것을 남긴다
  let bestPx = 0;
  const alive = () => page.evaluate(() => document.getElementById('deathscreen').hidden);

  for (let step = 0; step < 22; step++) {
    if (!(await alive())) break;            // 죽으면 화면이 블러 처리된다
    const pos = await findBoss();
    if (pos && pos.n > bestPx) {
      bestPx = pos.n;
      await page.screenshot({ path: SHOT_DIR + '/3-boss.png' });
    }
    if (!pos) break;
    if (Math.abs(pos.x - 0.5) < 0.14 && Math.abs(pos.y - 0.5) < 0.16 && pos.n > 6000) break;
    const keys = [];
    if (pos.x < 0.45) keys.push('KeyA');
    if (pos.x > 0.55) keys.push('KeyD');
    if (pos.y < 0.43) keys.push('KeyW');
    if (pos.y > 0.57) keys.push('KeyS');
    if (!keys.length) break;
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(200);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(90);
  }

  console.log('     살아있는 동안 잡힌 최대 보스 픽셀: ' + bestPx);
  check('보스를 살아있는 상태로 크게 촬영', bestPx > 2000, bestPx + ' px');
}

// PICK_CLASS 가 주어지면 승급 창에서 해당 클래스를 고른다 (시각 확인용)
if (process.env.PICK_CLASS) {
  const want = process.env.PICK_CLASS;
  // 승급 창이 뜨려면 먼저 경험치를 벌어야 한다 — 자동사격 켜고 돌아다닌다
  await page.keyboard.press('KeyE');
  for (let i = 0; i < 40; i++) {
    // 도중에 죽으면 다시 참전해야 승급 창까지 갈 수 있다
    if (!(await page.evaluate(() => document.getElementById('deathscreen').hidden))) {
      await page.click('#respawn');
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyE');   // 자동사격 다시 켜기
    }
    const k = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][i % 4];
    await page.keyboard.down(k);
    await page.mouse.move(640 + Math.cos(i) * 420, 400 + Math.sin(i) * 280);
    await page.waitForTimeout(400);
    await page.keyboard.up(k);
    // 승급 창이 뜨면 바로 다음 단계로
    if (await page.evaluate(() => !document.getElementById('classpick').hidden)) break;
  }
  try {
    await page.waitForSelector('#classpick:not([hidden])', { timeout: 20000 });
    const opts = await page.$$eval('.class-opt .cn', (els) => els.map((e) => e.textContent.trim()));
    console.log('     승급 선택지: ' + opts.join(' / '));
    check('Lv15 승급 선택지 6가지', opts.length === 6, opts.length + '가지');
    const idx = opts.indexOf(want);
    check('"' + want + '" 선택지 존재', idx >= 0, opts.join(', '));
    if (idx >= 0) {
      await page.$$eval('.class-opt', (els, i) => els[i].click(), idx);
      await page.waitForTimeout(2500);
      const lvl = await page.textContent('#level-label');
      check('"' + want + '" 로 승급됨', (lvl || '').includes(want), lvl);
    }
  } catch (e) {
    check('승급 창 표시', false, e.message.slice(0, 80));
  }
}

await page.mouse.move(1000, 300);
await page.keyboard.down('KeyD');
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(640 + Math.cos(i / 2) * 380, 400 + Math.sin(i / 2) * 260);
  await page.waitForTimeout(250);
}
await page.mouse.up();
await page.keyboard.up('KeyD');
await page.keyboard.press('KeyE');   // 자동 사격 켜기
await page.waitForTimeout(3000);

await page.screenshot({ path: `${SHOT_DIR}/2-play.png` });

const hud = await page.evaluate(() => ({
  level: document.getElementById('level-label')?.textContent,
  score: document.getElementById('score-label')?.textContent,
  name: document.getElementById('myname')?.textContent,
  ping: document.getElementById('ping')?.textContent,
  lb: [...document.querySelectorAll('#lb-list li')].map((li) => li.textContent.trim()),
  stats: [...document.querySelectorAll('.stat-row')].length,
}));

console.log('\n4. 화면 내용');
const px = await samplePixels(page);
const pct = (n) => ((n / px.total) * 100).toFixed(2) + '%';
check(`화면이 비어있지 않음 (배경 아닌 픽셀 ${pct(px.nonBg)})`, px.nonBg / px.total > 0.02,
  '캔버스가 사실상 빈 화면이다');
for (const [k, v] of Object.entries(px.hits)) {
  console.log(`     ${k.padEnd(16)} ${String(v).padStart(7)} px`);
}
check('내 탱크가 그려짐', px.hits['내 탱크(청록)'] > 100);
check('포신이 그려짐', px.hits['포신(회색)'] > 40, px.hits['포신(회색)'] + ' px (클래스마다 포신 크기가 다르다)');
check('그리드가 그려짐', px.hits['그리드'] > 1000);
if (process.env.EXPECT_BOSS) {
  check('보스가 화면에 그려짐', px.hits['보스(빨강)'] > 300, px.hits['보스(빨강)'] + ' px');
}
check('도형이 그려짐',
  px.hits['사각형(노랑)'] + px.hits['삼각형(주황)'] + px.hits['오각형(파랑)'] > 200);

console.log('\n5. HUD 상태');
console.log(`     레벨: ${hud.level}`);
console.log(`     점수: ${hud.score}`);
console.log(`     닉네임: ${hud.name}`);
console.log(`     핑: ${hud.ping}ms`);
console.log(`     리더보드: ${hud.lb.length}명 — ${hud.lb.slice(0, 3).join(' | ')}`);
check('레벨 표시 정상', /Lv \d/.test(hud.level || ''));
check('점수가 올라감 (도형을 부숨)', /점수 [1-9]/.test(hud.score || ''), hud.score);
check('스탯 패널 8줄', hud.stats === 8, String(hud.stats));
check('리더보드에 참가자 표시', hud.lb.length >= 2);
check('핑 측정됨', hud.ping !== '--' && hud.ping !== '', hud.ping);

console.log('\n6. 콘솔 오류');
if (errors.length) {
  for (const e of errors.slice(0, 10)) console.log(`     ${e}`);
}
check('JS 오류 없음', errors.length === 0, `${errors.length}건`);

await browser.close();

console.log('');
console.log(`스크린샷: ${SHOT_DIR}/1-menu.png, ${SHOT_DIR}/2-play.png`);
if (failures > 0) { console.log(`\n실패 ${failures}건`); process.exit(1); }
console.log('\n브라우저 구동 정상.');
