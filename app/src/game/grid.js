import { ARENA_HALF, ARENA_SIZE, GRID_CELL } from '../../public/shared/config.js';

/**
 * 공간 해시 그리드.
 * 매 틱 전부 다시 채운다(clear → insert). 엔티티 1000개 기준 비용은 무시할 수준이고,
 * 증분 갱신보다 버그가 날 여지가 훨씬 적다.
 */
export class SpatialGrid {
  constructor() {
    this.cols = Math.ceil(ARENA_SIZE / GRID_CELL);
    this.rows = this.cols;
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
    this.mark = 0; // 중복 반환 방지용 카운터
  }

  clear() {
    for (const c of this.cells) c.length = 0;
  }

  _col(x) {
    const c = Math.floor((x + ARENA_HALF) / GRID_CELL);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }
  _row(y) {
    const r = Math.floor((y + ARENA_HALF) / GRID_CELL);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  insert(e) {
    const c0 = this._col(e.x - e.radius);
    const c1 = this._col(e.x + e.radius);
    const r0 = this._row(e.y - e.radius);
    const r1 = this._row(e.y + e.radius);
    for (let r = r0; r <= r1; r++) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c++) this.cells[base + c].push(e);
    }
  }

  /** 사각 영역과 겹치는 엔티티를 out 배열에 담아 반환 (중복 제거됨) */
  queryRect(minX, minY, maxX, maxY, out) {
    out.length = 0;
    const m = ++this.mark;
    const c0 = this._col(minX), c1 = this._col(maxX);
    const r0 = this._row(minY), r1 = this._row(maxY);
    for (let r = r0; r <= r1; r++) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[base + c];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (e._mark === m) continue;
          e._mark = m;
          out.push(e);
        }
      }
    }
    return out;
  }

  queryCircle(x, y, radius, out) {
    return this.queryRect(x - radius, y - radius, x + radius, y + radius, out);
  }
}
