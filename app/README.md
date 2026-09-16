# POLYARENA

실시간 멀티플레이어 탑다운 탱크 아레나. Cloudflare Workers + Durable Objects 위에서 돌아간다.

- 서버 권위 시뮬레이션 30Hz — 클라이언트는 입력만 보낸다 (치트 불가)
- 바이너리 프로토콜 — 스냅샷 약 0.8KB, 플레이어당 약 23KB/s
- 탱크 28종 · 스탯 8종 · 3단계 승급 트리
- 보스 **디펜더** 1기 — 트랩을 깔고 포탑 3문이 각자 조준, 처치 시 경험치 30,000
- 봇 AI가 방을 채워 혼자 접속해도 게임이 성립한다
- 데스크톱(마우스+WASD) / 모바일(듀얼 스틱) 모두 지원

---

## 실행

```bash
cd app
npm install
npm run check     # Node에서 게임 로직 전체를 실제로 굴려보는 자체 점검
npm run dev       # http://localhost:8787
```

`npm run dev` 로 띄운 뒤 **브라우저 탭 두 개**를 열면 서로가 보인다.

## 점검 스크립트

| 명령 | 하는 일 | 서버 필요 |
|---|---|---|
| `npm run check` | 탱크 트리 무결성, 성장 곡선, 600틱 시뮬레이션, 프로토콜 왕복 | 아니오 |
| `npm run e2e` | 실제 WebSocket 클라이언트 2개로 참전→전투→사망→재참전 검증 | 예 (`npm run dev`) |
| `npm run perf` | 32인 부하에서 틱 비용 측정 | 아니오 |

`perf` 기준 한 틱 비용은 시뮬레이션 0.33ms + 스냅샷 0.18ms 로 **33.3ms 예산의 약 1.5%** 다.
방 인원이나 도형 수를 늘릴 여유가 충분하다.

> 로컬 `wrangler dev` 에서는 workerd 타이머 특성상 브로드캐스트가 30Hz 가 아니라 약 22Hz 로 나온다.
> 시뮬레이션 자체는 `room.js` 의 누산기가 고정 스텝(30Hz)을 보장하므로 **게임 속도는 영향받지 않고**,
> 전송 빈도만 낮아진다. 클라이언트는 110ms 지연 보간으로 이를 흡수한다.

## 배포

```bash
npx wrangler login     # 최초 1회 (브라우저에서 Cloudflare 계정 인증)
npm run deploy
```

배포되면 `https://polyarena.<계정이름>.workers.dev` 가 출력된다. 그 주소가 바로 게임이다.

커스텀 도메인은 Cloudflare 대시보드 → **Workers & Pages → polyarena → Settings → Domains & Routes** 에서 연결한다.

로그는 `npm run tail` 로 실시간 확인.

### 무료 플랜에서

Durable Objects 는 `wrangler.jsonc` 의 마이그레이션이 `new_sqlite_classes` 로 되어 있어야 무료 플랜에서 동작한다.
이미 그렇게 설정해 두었으니 그대로 배포하면 된다.

---

## 구조

```
app/
├── wrangler.jsonc              Cloudflare 설정 (에셋 + Durable Object 바인딩)
├── scripts/check.js            배포 전 자체 점검
├── src/                        Worker 번들 (서버)
│   ├── index.js                라우팅: /ws → DO, 나머지 → 정적 에셋
│   ├── room.js                 GameRoom Durable Object (틱 루프 + 소켓)
│   └── game/
│       ├── world.js            시뮬레이션·충돌·스냅샷
│       ├── grid.js             공간 해시 그리드
│       ├── entities.js         총알 / 트랩 / 도형
│       ├── player.js           플레이어 탱크
│       ├── firing.js           포신 발사 (플레이어·보스 공용)
│       ├── boss.js             디펜더 보스 + 독립 조준 포탑
│       └── bot.js              봇 AI
└── public/                     정적 에셋 (클라이언트)
    ├── index.html  style.css
    ├── shared/                 ★ 서버·클라이언트 공용
    │   ├── config.js           상수와 밸런스 수식 전부
    │   ├── tanks.js            탱크 28종 + 보스 전용 2종
    │   └── protocol.js         바이너리 인코딩/디코딩
    └── js/
        ├── main.js             예측·보간·메인 루프
        ├── net.js              WebSocket
        ├── input.js            키보드/마우스/터치
        ├── render.js           캔버스 렌더링
        └── ui.js               HUD
```

### `public/shared/` 가 핵심

이 세 파일은 브라우저가 ES 모듈로 직접 로드하고, 서버는 `../public/shared/…` 로 import 해서
wrangler(esbuild)가 번들에 넣는다. 덕분에 **상수·밸런스 수식·탱크 정의·패킷 레이아웃이
서버와 클라이언트 사이에서 절대 어긋나지 않는다.** 밸런스를 고치려면 `config.js` 한 곳만 고치면 된다.

---

## 자주 만지게 될 값

| 하고 싶은 것 | 파일 | 값 |
|---|---|---|
| 아레나 크기 | `shared/config.js` | `ARENA_SIZE` |
| 틱 레이트 | `shared/config.js` | `TICK_RATE` |
| 방 최대 인원 | `shared/config.js` | `MAX_PLAYERS` |
| 봇 수 | `shared/config.js` | `BOT_FILL` (실제 플레이어가 늘면 자동으로 줄어든다) |
| 도형 밀도 | `shared/config.js` | `SHAPE_TARGET` |
| 보스 강함·보상 | `shared/config.js` | `BOSS_HEALTH` / `BOSS_XP` / `BOSS_SPEED` |
| 보스 재등장 간격 | `shared/config.js` | `BOSS_RESPAWN_DELAY` |
| 트랩 지속·감속 | `shared/config.js` | `TRAP_LIFE` / `TRAP_DRAG` |
| 레벨업 속도 | `shared/config.js` | `xpForLevel()` |
| 탱크 추가 | `shared/tanks.js` | 배열 끝에 항목 추가 + 상위 클래스의 `upgrades` 에 키 등록 |

> `tanks.js` 배열의 **순서가 곧 네트워크 ID** 다. 중간에 끼워 넣지 말고 항상 뒤에 추가할 것.

---

## 방 나누기 (동시접속 확장)

한 방은 Durable Object 인스턴스 하나이고 최대 40명이다. 더 필요하면 URL 쿼리로 방을 나눈다.

```
https://<주소>/?room=main
https://<주소>/?room=b
```

`room` 값마다 별개의 DO 인스턴스가 생성되어 서로 독립적으로 돌아간다.
자동 매치메이킹이 필요해지면 `src/index.js` 에서 방 목록을 관리하는 DO를 하나 더 두면 된다.

---

## 조작

| 입력 | 동작 |
|---|---|
| `W` `A` `S` `D` / 방향키 | 이동 |
| 마우스 | 조준 |
| 좌클릭 / `Space` | 사격 |
| `1` ~ `8` | 스탯 투자 |
| `E` | 자동 사격 |
| `C` | 자동 회전 |
| 모바일 | 좌측 스틱 이동, 우측 스틱 조준+사격 |
