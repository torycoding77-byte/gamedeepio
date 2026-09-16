import { World } from '../src/game/world.js';
import { Writer, IN } from '../public/shared/protocol.js';
import { DT } from '../public/shared/config.js';

const world = new World();
const humans = [];
for (let i = 0; i < 12; i++) {
  const p = world.addPlayer(`P${i}`);
  p.spawn(0);
  p.setInput(IN.FIRE | IN.RIGHT, Math.random() * 6.28, 600, 1);
  humans.push(p);
}
for (let i = 0; i < 20; i++) world.addBot();

// 워밍업
for (let i = 0; i < 120; i++) world.step(DT);

const w = new Writer(16384);
const stepTimes = [], snapTimes = [];
for (let i = 0; i < 300; i++) {
  let t0 = performance.now();
  world.step(DT);
  stepTimes.push(performance.now() - t0);

  t0 = performance.now();
  for (const p of humans) { w.off = 0; world.buildSnapshot(w, p); w.done(); }
  snapTimes.push(performance.now() - t0);
}

const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return {
    평균: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(3),
    중앙: +s[s.length >> 1].toFixed(3),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(3),
    최대: +s[s.length - 1].toFixed(3),
  };
};

console.log('플레이어', world.players.size, '/ 도형', world.shapes.size, '/ 총알', world.bullets.size);
console.log('step(ms)         ', stat(stepTimes));
console.log('스냅샷 12명(ms)  ', stat(snapTimes));
console.log('틱 예산 33.3ms 대비 사용률',
  `${(((stat(stepTimes).평균 + stat(snapTimes).평균) / 33.3) * 100).toFixed(1)}%`);
