/* ==========================================================================
   STACK & DEAL (my own game: Tetris with a dealer)
   The stacker plays normal Tetris. The dealer chooses every piece.
   Stacker wins by clearing 30 lines. Dealer wins if the stack tops out.

   Fairness rules (enforced for human and computer dealers alike):
     • never the same piece three times in a row
     • at least one I-piece every 12 pieces
   The computer stacker moves the piece one input at a time (rotate, shift,
   drop) through the same collision checks as a human, at a limited speed.
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const COLS = 10, ROWS = 20, CELL = 26;
  const BX = 270, BY = 60;                      // board position on screen
  const TARGET = 30;
  const NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const COLORS = { I: '#3cc8e0', O: '#e8d44d', T: '#a77bff', S: '#2fbf71', Z: '#f25c69', J: '#4f7cff', L: '#f0a83c' };
  const SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]]
  };
  // rotation states, computed once by rotating each shape inside its box
  const ROT = {};
  for (const n of NAMES) {
    const size = n === 'I' ? 4 : n === 'O' ? 4 : 3;
    let cells = SHAPES[n];
    ROT[n] = [];
    for (let r = 0; r < 4; r++) {
      ROT[n].push(cells);
      cells = n === 'O' ? cells : cells.map(([x, y]) => [size - 1 - y, x]);
    }
  }

  /* ---------- board helpers (pure, used by the game and both AIs) ---------- */
  const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  function fits(board, name, rot, x, y) {
    for (const [cx, cy] of ROT[name][rot]) {
      const bx = x + cx, by = y + cy;
      if (bx < 0 || bx >= COLS || by >= ROWS) return false;
      if (by >= 0 && board[by][bx]) return false;
    }
    return true;
  }
  function dropY(board, name, rot, x, y) {
    while (fits(board, name, rot, x, y + 1)) y++;
    return y;
  }
  // returns {board, lines, topOut}
  function placeOn(board, name, rot, x, y) {
    const b = board.map(r => r.slice());
    let topOut = false;
    for (const [cx, cy] of ROT[name][rot]) {
      if (y + cy < 0) { topOut = true; continue; }
      b[y + cy][x + cx] = name;
    }
    const kept = b.filter(r => r.some(c => !c));
    const lines = ROWS - kept.length;
    while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
    return { board: kept, lines, topOut };
  }
  // Classic weighted heuristic (aggregate height, lines, holes, bumpiness)
  function evaluate(board, lines) {
    const heights = [];
    let holes = 0;
    for (let x = 0; x < COLS; x++) {
      let h = 0, seen = false;
      for (let y = 0; y < ROWS; y++) {
        if (board[y][x]) { if (!seen) { h = ROWS - y; seen = true; } }
        else if (seen) holes++;
      }
      heights.push(h);
    }
    const agg = heights.reduce((a, b) => a + b, 0);
    let bump = 0;
    for (let x = 0; x < COLS - 1; x++) bump += Math.abs(heights[x] - heights[x + 1]);
    const maxH = Math.max(...heights);
    return -0.510066 * agg + 0.760666 * lines - 0.35663 * holes - 0.184483 * bump - (maxH > 15 ? (maxH - 15) * 2 : 0);
  }
  const SPAWN_Y = -1;
  const spawnX = name => (name === 'I' || name === 'O' ? 3 : 3);
  // every placement reachable by "rotate at the top, slide sideways, drop"
  function placements(board, name) {
    const out = [];
    const rots = name === 'O' ? 1 : 4;
    for (let r = 0; r < rots; r++) {
      const sx = spawnX(name);
      if (!fits(board, name, r, sx, SPAWN_Y) && !fits(board, name, r, sx, SPAWN_Y - 1)) continue;
      const y0 = fits(board, name, r, sx, SPAWN_Y) ? SPAWN_Y : SPAWN_Y - 1;
      for (const dir of [-1, 1]) {
        for (let x = dir === 1 ? sx : sx - 1; x >= -3 && x < COLS; x += dir) {
          if (!fits(board, name, r, x, y0)) break;
          out.push({ rot: r, x, y: dropY(board, name, r, x, y0) });
        }
      }
    }
    return out;
  }
  function bestPlacement(board, name, next, noise, twoPly) {
    let best = null;
    for (const p of placements(board, name)) {
      const res = placeOn(board, name, p.rot, p.x, p.y);
      let score = res.topOut ? -1e6 : evaluate(res.board, res.lines);
      if (twoPly && next && !res.topOut) {
        let b2 = -1e6;
        for (const q of placements(res.board, next)) {
          const r2 = placeOn(res.board, next, q.rot, q.x, q.y);
          if (!r2.topOut) b2 = Math.max(b2, evaluate(r2.board, r2.lines));
        }
        score = score * 0.4 + b2 * 0.6 + res.lines * 0.3;
      }
      score += U.gauss() * noise;
      if (!best || score > best.score) best = Object.assign({ score }, p);
    }
    return best;
  }

  // exposed so the automated tests can check the planner on its own
  Arcade._tetris = { bestPlacement, placeOn, emptyBoard, placements, evaluate };

  Arcade.register({
    id: 'tetris',
    title: 'Stack & Deal',
    tagline: 'Tetris where the other player chooses every piece you get.',
    flip: 'you deal the pieces, the computer stacks them.',
    blurb: 'My own game. The stacker plays normal Tetris and needs 30 lines to win. The dealer picks every piece and wins if the stack reaches the top. The dealer can\'t give the same piece three times in a row, and has to give an I-piece at least once every 12 pieces. Pieces fall faster every 4 lines.',
    menuText: 'The stacker wins at <b>30 lines</b>. The dealer wins on a <b>top-out</b>. The dealer can\'t repeat a piece three times running, and an I-piece must come at least every 12 pieces.',
    sides: [
      { key: 'stacker', label: 'Stacker', human: '← → to move, ↑ or X to rotate, Z to rotate back, ↓ soft drop, Space hard drop.', cpu: 'Scores every legal placement (height, holes, bumpiness, lines), plans ahead with the next piece once it gets good, then actually steers the piece there one key-press at a time.' },
      { key: 'dealer', label: 'Dealer', human: 'Click a piece on the right (or press 1–7) to deal the next one. If you haven\'t picked when the current piece lands, it\'s random.', cpu: 'Deals randomly at first. Later it tests each piece against the board and deals the one that fits worst.' }
    ],
    defaults: { stacker: 'cpu', dealer: 'human' },

    thumb(ctx, w) {
      const s = w / W, c = CELL * s * 1.35, ox = 120 * s, oy = 40 * s;
      const rows = ['..........', '..........', '....TT....', '.....T....', 'I.......OO', 'I..SS...OO', 'I.SS.JJLLL', 'IZZ.JJJ.LL', 'ZZ.JJTTTLL'];
      rows.forEach((r, y) => [...r].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = COLORS[ch];
        ctx.fillRect(ox + x * c + 1, oy + y * c + 1, c - 2, c - 2);
      }));
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.strokeRect(ox, oy, c * 10, c * 9);
      NAMES.forEach((n, i) => { ctx.fillStyle = COLORS[n]; ctx.fillRect(w - 60, 40 * s + i * 22, 30, 14); });
    },

    create(api) {
      let board = emptyBoard();
      let lines = 0, score = 0;
      let cur = null;            // {name, rot, x, y}
      let next = null;           // dealt by the dealer
      const history = [];        // dealt pieces, newest last
      let fallT = 0, lockT = 0;
      let over = false;
      let clearing = null;       // {rows, t} line-clear flash
      let dealerThink = 0.6;
      let das = { dir: 0, t: 0 };

      const level = () => 1 + Math.floor(lines / 3);
      const gravity = () => Math.max(0.1, 0.8 * Math.pow(0.82, level() - 1));
      const sinceI = () => { let n = 0; for (let i = history.length - 1; i >= 0 && history[i] !== 'I'; i--) n++; return n; };
      function allowed(p) {
        const h = history;
        if (h.length >= 2 && h[h.length - 1] === p && h[h.length - 2] === p) return false;
        if (sinceI() >= 11 && p !== 'I') return false;
        return true;
      }
      const allowedList = () => NAMES.filter(allowed);

      function deal(p) {
        if (!allowed(p)) return false;
        next = p;
        history.push(p);
        return true;
      }

      function spawn() {
        if (!next) {
          deal(U.pick(allowedList()));
          if (api.isHuman('dealer') && history.length > 1) api.toast('Too slow — random piece', C.muted);
        }
        const name = next;
        next = null;
        cur = { name, rot: 0, x: spawnX(name), y: SPAWN_Y };
        if (!fits(board, cur.name, 0, cur.x, cur.y)) {
          cur.y--;
          if (!fits(board, cur.name, 0, cur.x, cur.y)) return topOut();
        }
        fallT = 0; lockT = 0; soft = false;
        dealerThink = U.rand(0.35, 0.9);
        if (!api.isHuman('stacker')) planMove();
      }

      function topOut() {
        over = true;
        cur = null;
        api.end('dealer', `The stack topped out at ${lines} line${lines === 1 ? '' : 's'}.`);
      }

      function lock() {
        const res = placeOn(board, cur.name, cur.rot, cur.x, cur.y);
        if (res.topOut) { board = res.board; return topOut(); }
        if (res.lines) {
          // remember which rows cleared, for the flash
          const full = [];
          const tmp = board.map(r => r.slice());
          for (const [cx, cy] of ROT[cur.name][cur.rot]) if (cur.y + cy >= 0) tmp[cur.y + cy][cur.x + cx] = cur.name;
          tmp.forEach((r, y) => { if (r.every(Boolean)) full.push(y); });
          clearing = { rows: full, t: 0.18 };
          lines += res.lines;
          score += [0, 100, 300, 500, 800][res.lines] * level();
          if (res.lines === 4) api.toast('TETRIS!', C.cyan);
          if (lines >= TARGET) { board = res.board; cur = null; over = true; return api.end('stacker', `${lines} lines cleared. Score ${score}.`); }
          if (Math.floor((lines - res.lines) / 4) !== Math.floor(lines / 4)) api.toast(`Level ${level()} — faster`, C.warn);
        }
        board = res.board;
        cur = null;
        spawn();
      }

      /* ---------- shared stacker actions ---------- */
      const tryMove = (dx, dy) => {
        if (cur && fits(board, cur.name, cur.rot, cur.x + dx, cur.y + dy)) { cur.x += dx; cur.y += dy; if (dx) lockT = 0; return true; }
        return false;
      };
      function rotate(dir) {
        if (!cur || cur.name === 'O') return false;
        const r = (cur.rot + dir + 4) % 4;
        for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
          if (fits(board, cur.name, r, cur.x + kx, cur.y + ky)) { cur.rot = r; cur.x += kx; cur.y += ky; lockT = 0; return true; }
        }
        return false;
      }
      function hardDrop() {
        if (!cur) return;
        const y = dropY(board, cur.name, cur.rot, cur.x, cur.y);
        score += (y - cur.y) * 2;
        cur.y = y;
        lock();
      }

      /* ---------- computer stacker ---------- */
      const stackSkill = () => Math.min(0.8, 0.3 + lines * 0.018);
      let plan = null, actT = 0, soft = false;
      function planMove() {
        const s = stackSkill();
        const noise = U.lerp(0.45, 0.02, s);
        plan = bestPlacement(board, cur.name, next, noise, s > 0.6);
        actT = U.lerp(0.35, 0.08, s);                      // a beat to "look" at the piece
      }
      function cpuStack(dt) {
        if (!cur || !plan) return;
        actT -= dt;
        if (actT > 0) return;
        const s = stackSkill();
        actT = U.lerp(0.17, 0.04, s) * U.rand(0.8, 1.25);   // one key press per tick
        if (cur.rot !== plan.rot) { if (!rotate(1)) plan.rot = cur.rot; return; }
        if (cur.x < plan.x) { if (!tryMove(1, 0)) plan.x = cur.x; return; }
        if (cur.x > plan.x) { if (!tryMove(-1, 0)) plan.x = cur.x; return; }
        if (s > 0.55) hardDrop(); else soft = true;
      }

      /* ---------- computer dealer ---------- */
      const dealSkill = () => Math.min(0.8, 0.1 + lines * 0.03);
      function cpuDeal(dt) {
        if (next || !cur) return;
        dealerThink -= dt;
        if (dealerThink > 0) return;
        const opts = allowedList();
        if (!U.chance(dealSkill())) return void deal(U.pick(opts));
        // assume the current piece lands in its best spot, then give the piece whose best spot is worst
        const cp = bestPlacement(board, cur.name, null, 0, false);
        const after = cp ? placeOn(board, cur.name, cp.rot, cp.x, cp.y).board : board;
        let worst = null;
        for (const p of opts) {
          const b = bestPlacement(after, p, null, 0, false);
          const sc = b ? b.score : -1e6;
          if (!worst || sc < worst.sc) worst = { p, sc };
        }
        deal(worst.p);
      }

      spawn();

      return {
        update(dt) {
          if (clearing) { clearing.t -= dt; if (clearing.t <= 0) clearing = null; }
          if (over || !cur) return;

          if (!api.isHuman('dealer')) cpuDeal(dt);

          if (api.isHuman('stacker')) {
            // held left/right auto-repeat
            const dir = (api.keys.has('ArrowRight') ? 1 : 0) - (api.keys.has('ArrowLeft') ? 1 : 0);
            if (dir !== das.dir) das = { dir, t: 0.16 };
            else if (dir) { das.t -= dt; if (das.t <= 0) { tryMove(dir, 0); das.t = 0.05; } }
            soft = api.keys.has('ArrowDown');
          } else {
            cpuStack(dt);
            if (!cur) return;
          }

          // gravity (soft drop = fast gravity)
          fallT += dt;
          const g = soft ? Math.min(0.035, gravity()) : gravity();
          while (fallT >= g && cur) {
            fallT -= g;
            if (!tryMove(0, 1)) break;
            if (soft) score += 1;
          }
          // lock delay once resting
          if (cur && !fits(board, cur.name, cur.rot, cur.x, cur.y + 1)) {
            lockT += dt;
            if (lockT >= 0.45) lock();
          } else lockT = 0;
        },

        onKey(code) {
          if (api.isHuman('stacker') && cur) {
            if (code === 'ArrowLeft') tryMove(-1, 0);
            if (code === 'ArrowRight') tryMove(1, 0);
            if (code === 'ArrowUp' || code === 'KeyX') rotate(1);
            if (code === 'KeyZ') rotate(-1);
            if (code === 'Space') hardDrop();
          }
          if (api.isHuman('dealer')) {
            const m = /^Digit([1-7])$/.exec(code);
            if (m) humanDeal(NAMES[+m[1] - 1]);
          }
        },
        onPointer(type, x, y) {
          if (type !== 'down' || !api.isHuman('dealer')) return;
          NAMES.forEach((n, i) => {
            const r = paletteRect(i);
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) humanDeal(n);
          });
        },

        draw(ctx) {
          ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

          // board frame + grid
          ctx.fillStyle = C.panel; ctx.fillRect(BX - 4, BY - 4, COLS * CELL + 8, ROWS * CELL + 8);
          ctx.fillStyle = '#0a1022'; ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
          ctx.strokeStyle = 'rgba(38,50,79,.45)'; ctx.lineWidth = 1;
          for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(BX + x * CELL, BY); ctx.lineTo(BX + x * CELL, BY + ROWS * CELL); ctx.stroke(); }
          for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(BX, BY + y * CELL); ctx.lineTo(BX + COLS * CELL, BY + y * CELL); ctx.stroke(); }
          // danger line
          ctx.fillStyle = 'rgba(242,92,105,.25)'; ctx.fillRect(BX, BY + 2 * CELL - 1, COLS * CELL, 2);

          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (board[y][x]) cell(ctx, BX + x * CELL, BY + y * CELL, COLORS[board[y][x]]);
          if (clearing) { ctx.fillStyle = 'rgba(255,255,255,.7)'; for (const r of clearing.rows) ctx.fillRect(BX, BY + r * CELL, COLS * CELL, CELL); }

          if (cur) {
            // ghost piece
            const gy = dropY(board, cur.name, cur.rot, cur.x, cur.y);
            ctx.globalAlpha = 0.22;
            for (const [cx, cy] of ROT[cur.name][cur.rot]) if (gy + cy >= 0) cell(ctx, BX + (cur.x + cx) * CELL, BY + (gy + cy) * CELL, COLORS[cur.name]);
            ctx.globalAlpha = 1;
            for (const [cx, cy] of ROT[cur.name][cur.rot]) if (cur.y + cy >= 0) cell(ctx, BX + (cur.x + cx) * CELL, BY + (cur.y + cy) * CELL, COLORS[cur.name]);
          }

          // left panel: stacker stats
          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          D.text(ctx, 'STACKER', 40, 90, { size: 16, pixel: true, color: C.cyan });
          D.text(ctx, who('stacker'), 40, 112, { size: 13, color: C.muted });
          D.text(ctx, 'LINES', 40, 160, { size: 12, color: C.muted });
          D.text(ctx, `${lines}/${TARGET}`, 40, 184, { size: 24, pixel: true });
          D.bar(ctx, 40, 202, 180, 6, lines / TARGET, C.cyan);
          D.text(ctx, 'LEVEL', 40, 240, { size: 12, color: C.muted });
          D.text(ctx, String(level()), 40, 264, { size: 24, pixel: true });
          D.text(ctx, 'SCORE', 40, 306, { size: 12, color: C.muted });
          D.text(ctx, String(score), 40, 330, { size: 20, pixel: true });

          // right panel: next piece + dealer palette
          const RX = 580;
          D.text(ctx, 'DEALER', RX, 90, { size: 16, pixel: true, color: C.warn });
          D.text(ctx, who('dealer'), RX, 112, { size: 13, color: C.muted });
          D.text(ctx, 'NEXT', RX, 146, { size: 12, color: C.muted });
          ctx.fillStyle = C.panel; D.roundRect(ctx, RX, 158, 120, 70, 10); ctx.fill();
          if (next) miniPiece(ctx, next, RX + 60, 193, 18);
          else D.text(ctx, api.isHuman('dealer') ? 'pick one ↓' : 'thinking…', RX + 60, 193, { size: 13, color: api.isHuman('dealer') ? C.warn : C.dim, align: 'center' });

          if (api.isHuman('dealer')) {
            NAMES.forEach((n, i) => {
              const r = paletteRect(i);
              const ok = allowed(n) && !next;
              const hov = api.pointer.inside && api.pointer.x >= r.x && api.pointer.x <= r.x + r.w && api.pointer.y >= r.y && api.pointer.y <= r.y + r.h;
              ctx.fillStyle = hov && ok ? C.grid : '#0b1124';
              D.roundRect(ctx, r.x, r.y, r.w, r.h, 8); ctx.fill();
              ctx.globalAlpha = ok ? 1 : 0.25;
              miniPiece(ctx, n, r.x + r.w / 2 + 6, r.y + r.h / 2, 10);
              D.text(ctx, String(i + 1), r.x + 10, r.y + r.h / 2, { size: 11, color: C.muted });
              ctx.globalAlpha = 1;
            });
            if (sinceI() >= 8) D.text(ctx, `I-piece due in ${12 - sinceI() - 1}`, RX, 560, { size: 11, color: C.muted });
          } else {
            D.text(ctx, 'recent deals', RX, 262, { size: 12, color: C.muted });
            history.slice(-8).reverse().forEach((n, i) => miniPiece(ctx, n, RX + 20 + (i % 4) * 34, 290 + Math.floor(i / 4) * 34, 7));
          }
        },
        _state: () => ({ lines, level: level(), over, board: board.map(r => r.map(c => c || '.').join('')) })
      };

      function humanDeal(n) {
        if (next) return api.toast('Next piece already dealt', C.muted);
        if (!allowed(n)) return api.toast(sinceI() >= 11 ? 'An I-piece is due' : 'Not three in a row', C.bad);
        deal(n);
      }
      function paletteRect(i) { return { x: 580 + (i % 2) * 64, y: 250 + Math.floor(i / 2) * 56, w: 58, h: 48 }; }
      function cell(ctx, x, y, col) {
        ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + 1, y + 1, CELL - 2, 4);
        ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x + 1, y + CELL - 5, CELL - 2, 4);
      }
      function miniPiece(ctx, n, cx, cy, s) {
        const cells = ROT[n][0];
        const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
        const w = (Math.max(...xs) - Math.min(...xs) + 1) * s, h = (Math.max(...ys) - Math.min(...ys) + 1) * s;
        ctx.fillStyle = COLORS[n];
        for (const [x, y] of cells) ctx.fillRect(cx - w / 2 + (x - Math.min(...xs)) * s + 1, cy - h / 2 + (y - Math.min(...ys)) * s + 1, s - 2, s - 2);
      }
    }
  });
})();
