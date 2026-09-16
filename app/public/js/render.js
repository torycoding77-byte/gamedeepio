import {
  PALETTE, VIEW_ASPECT, viewWidthFor, shade, KIND,
  SHAPE_TYPES, ARENA_HALF, tankRadius,
} from '../shared/config.js';
import { tankById } from '../shared/tanks.js';
import { COLOR_MINE } from '../shared/protocol.js';

const FONT = '"Pretendard", "Malgun Gothic", system-ui, sans-serif';

const YOU_EDGE = shade(PALETTE.you, -0.30);
const ENEMY_EDGE = PALETTE.enemies.map((c) => shade(c, -0.30));
const BARREL_EDGE = shade(PALETTE.barrel, -0.34);
const BOSS_EDGE = shade(PALETTE.boss, -0.30);
const SHAPE_EDGE = SHAPE_TYPES.map((t) => shade(t.color, -0.30));

function polygonPath(ctx, sides, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 탱크 한 대(포신 + 몸통)를 원점 기준으로 그린다.
 * 호출 전에 translate/rotate 가 끝나 있어야 한다.
 * 승급 미리보기에서도 그대로 재사용한다.
 */
export function drawTankAtOrigin(ctx, classId, R, fill, edge, lw) {
  const tank = tankById(classId);

  ctx.fillStyle = PALETTE.barrel;
  ctx.strokeStyle = BARREL_EDGE;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';

  for (const bar of tank.barrels) {
    ctx.save();
    ctx.rotate(bar.angle);
    const x0 = bar.x * R;
    const x1 = (bar.x + bar.length) * R;
    const yc = bar.y * R;
    const h = (bar.width * R) / 2;

    ctx.beginPath();
    if (bar.trapezoid) {
      const h0 = h * (bar.trapezoid > 0 ? 0.74 : 1.18);
      const h1 = h * (bar.trapezoid > 0 ? 1.18 : 0.74);
      ctx.moveTo(x0, yc - h0);
      ctx.lineTo(x1, yc - h1);
      ctx.lineTo(x1, yc + h1);
      ctx.lineTo(x0, yc + h0);
    } else {
      ctx.moveTo(x0, yc - h);
      ctx.lineTo(x1, yc - h);
      ctx.lineTo(x1, yc + h);
      ctx.lineTo(x0, yc + h);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 몸통 — 기본은 원, bodyShape 가 있으면 정다각형(디펜더 = 삼각형)
  if (tank.bodyShape >= 3) {
    polygonPath(ctx, tank.bodyShape, R, 0);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw;
  ctx.fill();
  ctx.stroke();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cw = 0;
    this.ch = 0;
    this.dpr = 1;
    this.scale = 1;
    this.cam = { x: 0, y: 0 };
    this.resize();
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.cw = innerWidth;
    this.ch = innerHeight;
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
  }

  /** 레벨과 클래스 시야에 맞춰 줌을 정한다 (서버 컬링 박스와 동일한 규칙) */
  updateScale(level, fov) {
    const vw = viewWidthFor(level, fov);
    this.scale = Math.max(this.cw / vw, this.ch / (vw * VIEW_ASPECT));
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.cw / 2) / this.scale + this.cam.x,
      y: (sy - this.ch / 2) / this.scale + this.cam.y,
    };
  }

  render(state) {
    const ctx = this.ctx;
    const { cw, ch, scale } = this;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    const halfW = cw / 2 / scale;
    const halfH = ch / 2 / scale;
    const view = {
      left: this.cam.x - halfW, right: this.cam.x + halfW,
      top: this.cam.y - halfH, bottom: this.cam.y + halfH,
    };

    this.drawGrid(view);
    this.drawBounds(view);

    // 그리는 순서: 도형 → 트랩 → 총알 → 탱크
    const ents = state.entities;
    for (const e of ents) if (e.kind === KIND.SHAPE) this.drawShape(e);
    for (const e of ents) if (e.kind === KIND.TRAP) this.drawTrap(e);
    for (const e of ents) if (e.kind === KIND.DRONE) this.drawDrone(e);
    for (const e of ents) if (e.kind === KIND.BULLET) this.drawBullet(e);

    // 탱크는 z 순서대로 — 보스 본체(0)를 깔고 그 위에 포탑(2)을 얹는다
    const tanks = ents.filter((e) => e.kind === KIND.TANK);
    tanks.sort((a, b) => tankById(a.sub).z - tankById(b.sub).z);
    for (const e of tanks) this.drawTank(e, state.names);

    if (state.self && state.self.alive) this.drawSelf(state);

    ctx.restore();

    this.drawMinimap(state);
  }

  drawGrid(view) {
    const ctx = this.ctx;
    const step = 50;
    ctx.beginPath();
    const x0 = Math.floor(view.left / step) * step;
    const y0 = Math.floor(view.top / step) * step;
    for (let x = x0; x <= view.right; x += step) {
      ctx.moveTo(x, view.top);
      ctx.lineTo(x, view.bottom);
    }
    for (let y = y0; y <= view.bottom; y += step) {
      ctx.moveTo(view.left, y);
      ctx.lineTo(view.right, y);
    }
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1 / this.scale;
    ctx.stroke();
  }

  /** 아레나 밖을 어둡게 덮는다 */
  drawBounds(view) {
    const ctx = this.ctx;
    const A = ARENA_HALF;
    ctx.fillStyle = PALETTE.outside;
    if (view.left < -A) ctx.fillRect(view.left, view.top, -A - view.left, view.bottom - view.top);
    if (view.right > A) ctx.fillRect(A, view.top, view.right - A, view.bottom - view.top);
    if (view.top < -A) ctx.fillRect(Math.max(view.left, -A), view.top, Math.min(view.right, A) - Math.max(view.left, -A), -A - view.top);
    if (view.bottom > A) ctx.fillRect(Math.max(view.left, -A), A, Math.min(view.right, A) - Math.max(view.left, -A), view.bottom - A);

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 3 / this.scale;
    ctx.strokeRect(-A, -A, A * 2, A * 2);
  }

  drawShape(e) {
    const ctx = this.ctx;
    const t = SHAPE_TYPES[e.sub] || SHAPE_TYPES[0];
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    polygonPath(ctx, t.sides, e.radius, 0);
    ctx.fillStyle = t.color;
    ctx.strokeStyle = SHAPE_EDGE[e.sub] || SHAPE_EDGE[0];
    ctx.lineWidth = Math.max(2.5, e.radius * 0.09);
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (e.hp < 0.995) this.drawHealthBar(e.x, e.y + e.radius + 13, e.radius * 1.9, e.hp);
  }

  /** 트랩 — 총알과 달리 그 자리에 오래 남으므로 한눈에 구분되는 가시 모양으로 */
  drawTrap(e) {
    const ctx = this.ctx;
    const mine = (e.color & COLOR_MINE) !== 0;
    const idx = e.color & 0x7f;
    const fill = mine ? PALETTE.you : PALETTE.enemies[idx % 8];
    const edge = mine ? YOU_EDGE : ENEMY_EDGE[idx % 8];

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    const spikes = 3;
    const inner = e.radius * 0.5;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? e.radius : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(2, e.radius * 0.18);
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** 드론 — 진행 방향으로 뾰족한 작은 삼각형 */
  drawDrone(e) {
    const ctx = this.ctx;
    const mine = (e.color & COLOR_MINE) !== 0;
    const idx = e.color & 0x7f;
    const fill = mine ? PALETTE.you : PALETTE.enemies[idx % 8];
    const edge = mine ? YOU_EDGE : ENEMY_EDGE[idx % 8];
    const r = e.radius;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.beginPath();
    ctx.moveTo(r * 1.5, 0);
    ctx.lineTo(-r * 0.95, r * 1.05);
    ctx.lineTo(-r * 0.95, -r * 1.05);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawBullet(e) {
    const ctx = this.ctx;
    const mine = (e.color & COLOR_MINE) !== 0;
    const idx = e.color & 0x7f;
    const fill = mine ? PALETTE.you : (PALETTE.enemies[idx % 8]);
    const edge = mine ? YOU_EDGE : ENEMY_EDGE[idx % 8];
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(2, e.radius * 0.22);
    ctx.fill();
    ctx.stroke();
  }

  drawTank(e, names) {
    const ctx = this.ctx;
    const def = tankById(e.sub);
    const idx = e.color & 0x7f;
    const fill = def.boss ? PALETTE.boss : PALETTE.enemies[idx % 8];
    const edge = def.boss ? BOSS_EDGE : ENEMY_EDGE[idx % 8];
    const lw = Math.max(2.5, e.radius * 0.11);

    ctx.save();
    ctx.globalAlpha = e.alpha;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    drawTankAtOrigin(ctx, e.sub, e.radius, fill, edge, lw);
    ctx.restore();

    ctx.globalAlpha = e.alpha;
    const name = names.get(e.id);
    if (name) this.drawLabel(name, e.x, e.y - e.radius - 14);
    if (e.hp < 0.995) this.drawHealthBar(e.x, e.y + e.radius + 13, e.radius * 2.1, e.hp);
    ctx.globalAlpha = 1;
  }

  /** 내 탱크는 예측 위치와 내 조준각으로 그린다 (입력 지연 0) */
  drawSelf(state) {
    const ctx = this.ctx;
    const s = state.self;
    const R = tankRadius(s.level);
    const lw = Math.max(2.5, R * 0.11);

    ctx.save();
    ctx.translate(state.predicted.x, state.predicted.y);
    ctx.rotate(state.aim);
    drawTankAtOrigin(ctx, s.classId, R, PALETTE.you, YOU_EDGE, lw);
    ctx.restore();

    this.drawLabel(state.myName, state.predicted.x, state.predicted.y - R - 14);
    const ratio = s.maxHealth > 0 ? s.health / s.maxHealth : 1;
    if (ratio < 0.995) {
      this.drawHealthBar(state.predicted.x, state.predicted.y + R + 13, R * 2.1, ratio);
    }
  }

  drawLabel(text, x, y) {
    const ctx = this.ctx;
    const fs = 15 / this.scale;
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = fs * 0.28;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#eef2f6';
    ctx.fillText(text, x, y);
  }

  drawHealthBar(cx, y, w, ratio) {
    const ctx = this.ctx;
    const h = Math.max(5, 7 / this.scale);
    roundRectPath(ctx, cx - w / 2, y, w, h, h / 2);
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fill();
    if (ratio > 0) {
      roundRectPath(ctx, cx - w / 2, y, w * ratio, h, h / 2);
      ctx.fillStyle = ratio > 0.35 ? PALETTE.hpFill : PALETTE.enemies[0];
      ctx.fill();
    }
  }

  drawMinimap(state) {
    const ctx = this.ctx;
    const size = this.cw < 720 ? 92 : 132;
    const pad = 14;
    const x = this.cw - size - pad;
    const y = this.ch - size - pad - 18;
    const A = ARENA_HALF;
    const toMap = (wx, wy) => ({
      x: x + ((wx + A) / (A * 2)) * size,
      y: y + ((wy + A) / (A * 2)) * size,
    });

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    roundRectPath(ctx, x, y, size, size, 8);
    ctx.fillStyle = 'rgba(12,14,17,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    roundRectPath(ctx, x, y, size, size, 8);
    ctx.clip();

    for (const e of state.entities) {
      if (e.kind !== KIND.TANK) continue;
      const def = tankById(e.sub);
      if (def.z === 2) continue;            // 포탑은 본체와 겹치므로 생략
      const p = toMap(e.x, e.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, def.boss ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = def.boss ? PALETTE.boss : PALETTE.enemies[(e.color & 0x7f) % 8];
      ctx.fill();
      if (def.boss) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    if (state.self && state.self.alive) {
      const p = toMap(state.predicted.x, state.predicted.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.you;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
