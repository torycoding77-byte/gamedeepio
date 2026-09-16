import { STATS, MAX_STAT, MAX_LEVEL, PALETTE } from '../shared/config.js';
import { tankById } from '../shared/tanks.js';
import { drawTankAtOrigin } from './render.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(hooks) {
    this.hooks = hooks;

    this.el = {
      hud: $('hud'),
      menu: $('menu'),
      death: $('deathscreen'),
      nick: $('nick'),
      play: $('play'),
      status: $('status'),
      respawn: $('respawn'),
      points: $('points'),
      statsPanel: $('stats'),
      statsRows: $('stats-rows'),
      lbList: $('lb-list'),
      classpick: $('classpick'),
      classOpts: $('classpick-opts'),
      scoreFill: $('score-fill'),
      scoreLabel: $('score-label'),
      levelFill: $('level-fill'),
      levelLabel: $('level-label'),
      myname: $('myname'),
      ping: $('ping'),
      touch: $('touch'),
      dScore: $('d-score'),
      dLevel: $('d-level'),
      dTime: $('d-time'),
      dKiller: $('d-killer'),
    };

    this.statRows = [];
    this.shownChoices = '';
    this.lbSignature = '';
    this.topScore = 1000;

    this.buildStatRows();
    this.bind();
  }

  bind() {
    this.el.play.addEventListener('click', () => this.startGame());
    this.el.nick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.el.play.disabled) this.startGame();
    });
    this.el.respawn.addEventListener('click', () => {
      this.el.death.hidden = true;
      this.hooks.onSpawn?.(this.el.nick.value);
    });

    // 시크릿 모드나 저장 차단 환경에서는 접근 자체가 throw 한다
    try {
      const saved = localStorage.getItem('polyarena.nick');
      if (saved) this.el.nick.value = saved;
    } catch { /* 닉네임 기억은 있으면 좋은 기능일 뿐 */ }
  }

  startGame() {
    const name = this.el.nick.value.trim();
    try {
      if (name) localStorage.setItem('polyarena.nick', name);
    } catch { /* 무시 */ }
    this.el.menu.hidden = true;
    this.el.hud.hidden = false;
    this.hooks.onSpawn?.(name);
  }

  setConnected(ok) {
    this.el.play.disabled = !ok;
    this.el.play.textContent = ok ? '게임 시작' : '연결 중…';
    if (ok) this.el.status.textContent = '';
  }

  setStatus(msg) {
    this.el.status.textContent = msg || '';
  }

  showTouchControls(on) {
    this.el.touch.hidden = !on;
  }

  setPing(ms) {
    this.el.ping.textContent = ms > 0 ? String(ms) : '--';
  }

  // ── 스탯 패널 ───────────────────────────────────────────────
  buildStatRows() {
    const frag = document.createDocumentFragment();
    STATS.forEach((stat, i) => {
      const row = document.createElement('div');
      row.className = 'stat-row locked';

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = stat.name;

      const pips = document.createElement('span');
      pips.className = 'pips';
      const pipEls = [];
      for (let p = 0; p < MAX_STAT; p++) {
        const pip = document.createElement('i');
        pip.className = 'pip';
        pips.appendChild(pip);
        pipEls.push(pip);
      }

      row.append(key, nm, pips);
      row.addEventListener('click', () => this.hooks.onStat?.(i));
      frag.appendChild(row);
      this.statRows.push({ row, pipEls, value: -1, state: '' });
    });
    this.el.statsRows.appendChild(frag);
  }

  updateStats(self) {
    this.el.points.textContent = String(self.points);
    this.el.statsPanel.classList.toggle('idle', self.points === 0);

    for (let i = 0; i < STATS.length; i++) {
      const r = this.statRows[i];
      const v = self.stats[i];
      const cls = v >= MAX_STAT ? 'max' : self.points > 0 ? '' : 'locked';

      if (r.value !== v) {
        r.value = v;
        for (let p = 0; p < MAX_STAT; p++) {
          r.pipEls[p].style.background = p < v
            ? STATS[i].color
            : 'rgba(255,255,255,0.09)';
        }
      }
      if (r.state !== cls) {
        r.state = cls;
        r.row.className = `stat-row ${cls}`.trim();
      }
    }
  }

  // ── 하단 바 ────────────────────────────────────────────────
  updateBars(self, myName) {
    const tank = tankById(self.classId);
    this.topScore = Math.max(this.topScore, self.score, 1000);

    this.el.scoreFill.style.width = `${Math.min(100, (self.score / this.topScore) * 100)}%`;
    this.el.scoreLabel.textContent = `점수 ${self.score.toLocaleString('ko-KR')}`;

    const pct = self.level >= MAX_LEVEL
      ? 100
      : self.xpNeed > 0 ? Math.min(100, (self.xp / self.xpNeed) * 100) : 0;
    this.el.levelFill.style.width = `${pct}%`;
    this.el.levelLabel.textContent = self.level >= MAX_LEVEL
      ? `Lv MAX · ${tank.name}`
      : `Lv ${self.level} · ${tank.name}`;

    if (this.el.myname.textContent !== myName) this.el.myname.textContent = myName;
  }

  // ── 리더보드 ───────────────────────────────────────────────
  updateLeaderboard(rows, myId) {
    const sig = rows.map((r) => `${r.id}:${r.score}`).join('|');
    if (sig === this.lbSignature) return;
    this.lbSignature = sig;
    if (rows.length) this.topScore = Math.max(this.topScore, rows[0].score, 1000);

    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.id === myId) li.className = 'me';

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = r.id === myId ? PALETTE.you : PALETTE.enemies[r.id % 8];

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = r.name;

      const sc = document.createElement('span');
      sc.className = 'sc';
      sc.textContent = r.score.toLocaleString('ko-KR');

      li.append(dot, nm, sc);
      frag.appendChild(li);
    }
    this.el.lbList.replaceChildren(frag);
  }

  // ── 승급 선택 ──────────────────────────────────────────────
  updateClassPicker(choices) {
    const sig = choices.join(',');
    if (sig === this.shownChoices) return;
    this.shownChoices = sig;

    if (choices.length === 0) {
      this.el.classpick.hidden = true;
      this.el.classOpts.replaceChildren();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const id of choices) {
      const tank = tankById(id);

      const btn = document.createElement('div');
      btn.className = 'class-opt';

      const cv = document.createElement('canvas');
      const W = 72, H = 52, dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = W * dpr;
      cv.height = H * dpr;
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.translate(W / 2, H / 2);

      // 포신이 상자 밖으로 나가지 않게 반지름을 맞춘다
      let ext = 1;
      for (const b of tank.barrels) {
        const tip = Math.abs(b.x + b.length);
        const lat = Math.abs(b.y) + b.width / 2;
        ext = Math.max(ext, Math.hypot(tip, lat));
      }
      const R = Math.min(W, H) / 2 / (ext + 0.25);
      drawTankAtOrigin(c, id, R, PALETTE.you, '#2b9a92', Math.max(1.2, R * 0.11));

      const nm = document.createElement('div');
      nm.className = 'cn';
      nm.textContent = tank.name;

      const de = document.createElement('div');
      de.className = 'cd';
      de.textContent = tank.desc;

      btn.append(cv, nm, de);
      btn.addEventListener('click', () => this.hooks.onClass?.(id));
      frag.appendChild(btn);
    }
    this.el.classOpts.replaceChildren(frag);
    this.el.classpick.hidden = false;
  }

  // ── 사망 화면 ──────────────────────────────────────────────
  showDeath(info) {
    this.el.dScore.textContent = info.score.toLocaleString('ko-KR');
    this.el.dLevel.textContent = String(info.level);
    this.el.dTime.textContent = `${Math.round(info.timeAlive / 1000)}초`;
    this.el.dKiller.textContent = info.killer;
    this.el.menu.hidden = true;
    this.el.death.hidden = false;
    this.shownChoices = '';
    this.el.classpick.hidden = true;
  }
}
