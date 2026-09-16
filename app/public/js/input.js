import { IN } from '../shared/protocol.js';

const MOVE_KEYS = {
  KeyW: IN.UP, ArrowUp: IN.UP,
  KeyS: IN.DOWN, ArrowDown: IN.DOWN,
  KeyA: IN.LEFT, ArrowLeft: IN.LEFT,
  KeyD: IN.RIGHT, ArrowRight: IN.RIGHT,
};

export class Input {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;

    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.mouseDown = false;
    this.autoFire = false;
    this.autoSpin = false;

    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.moveStick = { active: false, id: -1, dx: 0, dy: 0 };
    this.aimStick = { active: false, id: -1, dx: 0, dy: 0, firing: false };

    this.enabled = false;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.enabled) return;

      if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);

      if (e.repeat) return;
      if (e.code === 'KeyE') this.autoFire = !this.autoFire;
      if (e.code === 'KeyC') this.autoSpin = !this.autoSpin;

      // 1~8 스탯 투자
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 8) this.hooks.onStat?.(n - 1);
      }
    });

    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this._bindTouch();
  }

  _bindTouch() {
    const setup = (el, stick, isAim) => {
      if (!el) return;
      const knob = el.querySelector('.knob');
      const radius = 44;

      const update = (t) => {
        const r = el.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2);
        let dy = t.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
        stick.dx = dx / radius;
        stick.dy = dy / radius;
        if (isAim) stick.firing = d > 12;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        stick.active = true;
        stick.id = t.identifier;
        update(t);
      }, { passive: false });

      el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === stick.id) update(t);
      }, { passive: false });

      const end = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== stick.id) continue;
          stick.active = false;
          stick.id = -1;
          stick.dx = stick.dy = 0;
          stick.firing = false;
          knob.style.transform = '';
        }
      };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };

    setup(document.getElementById('stick-move'), this.moveStick, false);
    setup(document.getElementById('stick-aim'), this.aimStick, true);
  }

  /** 조준각 계산에 쓸 화면상 목표점. 터치면 스틱 방향, 아니면 마우스. */
  aimVector(centerX, centerY) {
    if (this.touchMode && (this.aimStick.active || this.aimStick.dx || this.aimStick.dy)) {
      return { x: this.aimStick.dx, y: this.aimStick.dy };
    }
    return { x: this.mouse.x - centerX, y: this.mouse.y - centerY };
  }

  /** 서버로 보낼 입력 플래그 */
  flags() {
    let f = 0;

    if (this.touchMode && (this.moveStick.active)) {
      const { dx, dy } = this.moveStick;
      if (dx > 0.3) f |= IN.RIGHT;
      if (dx < -0.3) f |= IN.LEFT;
      if (dy > 0.3) f |= IN.DOWN;
      if (dy < -0.3) f |= IN.UP;
    }
    for (const code of this.keys) {
      const bit = MOVE_KEYS[code];
      if (bit) f |= bit;
    }

    if (this.mouseDown || this.keys.has('Space') || this.aimStick.firing) f |= IN.FIRE;
    if (this.autoFire) f |= IN.AUTOFIRE;
    if (this.autoSpin) f |= IN.AUTOSPIN;
    return f;
  }
}
