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
  const { util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const COLS = 10, ROWS = 20, CELL = 26;
  const BX = 270, BY = 60;                      // board position on screen
  const TARGET = 30;
  const NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  // Game Boy DMG palette (darkest → lightest). The 1989 Game Boy had no colour,
  // so every piece gets its own block pattern instead.
  const GB = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  const PAT = { I: 'bar', O: 'dot', T: 'solid', S: 'hatch', Z: 'ring', J: 'frame', L: 'check' };
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

  // one block, drawn in the piece's Game Boy pattern
  function gbCell(ctx, x, y, c, name) {
    const p = PAT[name], q = Math.max(2, Math.round(c / 6));
    ctx.fillStyle = GB[0]; ctx.fillRect(x, y, c, c);
    ctx.fillStyle = GB[3]; ctx.fillRect(x + q / 2, y + q / 2, c - q, c - q);
    const i = x + q * 1.5, j = y + q * 1.5, n = c - q * 3;
    if (n <= 0) return;
    if (p === 'solid') { ctx.fillStyle = GB[1]; ctx.fillRect(i, j, n, n); }
    else if (p === 'bar') { ctx.fillStyle = GB[2]; ctx.fillRect(i, j, n, n); ctx.fillStyle = GB[0]; ctx.fillRect(i, j + n / 2 - q / 2, n, q); }
    else if (p === 'dot') { ctx.fillStyle = GB[2]; ctx.fillRect(i, j, n, n); ctx.fillStyle = GB[0]; ctx.fillRect(x + c / 2 - q, y + c / 2 - q, q * 2, q * 2); }
    else if (p === 'hatch') { ctx.fillStyle = GB[1]; for (let k = 0; k < n; k += q * 2) ctx.fillRect(i, j + k, n, q); }
    else if (p === 'ring') { ctx.fillStyle = GB[0]; ctx.fillRect(i, j, n, n); ctx.fillStyle = GB[2]; ctx.fillRect(i + q, j + q, n - 2 * q, n - 2 * q); }
    else if (p === 'frame') { ctx.fillStyle = GB[1]; ctx.fillRect(i, j, n, n); ctx.fillStyle = GB[3]; ctx.fillRect(i + q, j + q, n - 2 * q, n - 2 * q); }
    else if (p === 'check') { ctx.fillStyle = GB[1]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if ((a + b) % 2 === 0) ctx.fillRect(i + a * n / 2, j + b * n / 2, n / 2, n / 2); }
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
    year: '1989 · Game Boy (after Tetris, 1984, Alexey Pajitnov)',
    history: 'Pajitnov wrote Tetris on a Soviet Elektronika 60 in 1984; the 1989 Game Boy version, four shades of green and a brick-walled well, sold over 35 million copies. Here the twist is that a second player deals every piece.',
    scoreSide: 'stacker', scoreName: 'points',
    tagline: 'Tetris where the other player chooses every piece you get.',
    flip: 'you deal the pieces, the computer stacks them.',
    blurb: 'My own game. The stacker plays normal Tetris and needs 30 lines to win. The dealer picks every piece and wins if the stack reaches the top. The dealer can\'t give the same piece three times in a row, and has to give an I-piece at least once every 12 pieces. Pieces fall faster every 4 lines. Scoring is the Game Boy\'s: 40, 100, 300 or 1200 points × level for 1–4 lines.',
    menuText: 'The stacker wins at <b>30 lines</b>. The dealer wins on a <b>top-out</b>. The dealer can\'t repeat a piece three times running, and an I-piece must come at least every 12 pieces.',
    sides: [
      { key: 'stacker', label: 'Stacker', human: '← → to move, ↑ or X to rotate, Z to rotate back, ↓ soft drop, Space hard drop.', cpu: 'Scores every legal placement (height, holes, bumpiness, lines), plans ahead with the next piece once it gets good, then actually steers the piece there one key-press at a time.' },
      { key: 'dealer', label: 'Dealer', human: 'Click a piece on the right (or press 1–7) to deal the next one. If you haven\'t picked when the current piece lands, it\'s random.', cpu: 'Deals randomly at first. Later it tests each piece against the board and deals the one that fits worst.' }
    ],
    defaults: { stacker: 'cpu', dealer: 'human' },

    thumb(ctx, w, h) {
      const s = w / W, c = CELL * s * 1.35, ox = 120 * s, oy = 40 * s;
      ctx.fillStyle = GB[3]; ctx.fillRect(0, 0, w, h);
      const rows = ['..........', '..........', '....TT....', '.....T....', 'I.......OO', 'I..SS...OO', 'I.SS.JJLLL', 'IZZ.JJJ.LL', 'ZZ.JJTTTLL'];
      rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') gbCell(ctx, ox + x * c, oy + y * c, c, ch); }));
      ctx.strokeStyle = GB[0]; ctx.lineWidth = 2; ctx.strokeRect(ox, oy, c * 10, c * 9);
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

      const level = () => 1 + Math.floor(lines / 4);
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
        if (history.length > 1) api.sfx('deal');
        return true;
      }

      function spawn() {
        if (!next) {
          deal(U.pick(allowedList()));
          if (api.isHuman('dealer') && history.length > 1) api.toast('Too slow — random piece');
        }
        const name = next;
        next = null;
        cur = { name, rot: 0, x: spawnX(name), y: SPAWN_Y };
        if (!fits(board, cur.name, 0, cur.x, cur.y)) {
          cur.y--;
          if (!fits(board, cur.name, 0, cur.x, cur.y)) return topOut();
        }
        fallT = 0; lockT = 0; soft = false;
        dealerThink = dealer.react(true) * 0.8 + U.rand(0.15, 0.7) + dealer.point(U.rand(60, 260), 50);   // look at the board, decide, click the palette
        if (!api.isHuman('stacker')) planMove();
      }

      function topOut() {
        over = true;
        cur = null;
        api.sfx('crash');
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
          clearing = { rows: full, t: 0.36 };
          lines += res.lines;
          score += [0, 40, 100, 300, 1200][res.lines] * level();     // Game Boy scoring
          api.sfx('line', { n: res.lines });
          if (res.lines === 4) api.toast('TETRIS!');
          if (lines >= TARGET) { board = res.board; cur = null; over = true; return api.end('stacker', `${lines} lines cleared. Score ${score}.`); }
          if (Math.floor((lines - res.lines) / 4) !== Math.floor(lines / 4)) api.toast(`Level ${level()} — faster`);
        }
        else api.sfx('lock');
        board = res.board;
        cur = null;
        spawn();
      }

      /* ---------- shared stacker actions ---------- */
      const tryMove = (dx, dy) => {
        if (cur && fits(board, cur.name, cur.rot, cur.x + dx, cur.y + dy)) { cur.x += dx; cur.y += dy; if (dx) { lockT = 0; api.sfx('move'); } return true; }
        return false;
      };
      function rotate(dir) {
        if (!cur || cur.name === 'O') return false;
        const r = (cur.rot + dir + 4) % 4;
        for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
          if (fits(board, cur.name, r, cur.x + kx, cur.y + ky)) { cur.rot = r; cur.x += kx; cur.y += ky; lockT = 0; api.sfx('rotate'); return true; }
        }
        return false;
      }
      function hardDrop() {
        if (!cur) return;
        const y = dropY(board, cur.name, cur.rot, cur.x, cur.y);
        score += y - cur.y;
        cur.y = y;
        lock();
      }

      /* ---------- computer stacker (plays like a person) ---------- */
      // Built from Tetris research (Kirsh & Maglio 1994; Lindstedt & Gray):
      //  • players start acting 400–600 ms after a piece appears
      //  • the average gap between key presses is ~250 ms (fastest ~75 ms)
      //  • weaker players spin a piece more than they need to — turning it on
      //    screen is how they "look" at it (turning it in your head takes ~1 s)
      //  • misdrops are usually one column off, often from holding a direction
      //    key a moment too long
      // It picks a good spot but not always the best one, speeds up when the
      // stack is high or pieces fall fast, and gets steadier as it warms up.
      const stackSkill = () => Math.min(0.85, 0.35 + lines * 0.015);
      const sp = new Arcade.Human({ reaction: 0.3 });
      let plan = null, actT = 0, soft = false, hold = null;
      const stackHeight = () => { for (let y = 0; y < ROWS; y++) if (board[y].some(Boolean)) return ROWS - y; return 0; };
      // time between two key presses: ~250 ms on average, quicker under pressure, never below 75 ms
      function keyGap() {
        const mean = U.lerp(0.25, 0.15, sp.pressure) * U.lerp(1, 0.85, stackSkill());
        return Math.max(0.075, mean * Math.exp(U.gauss() * 0.3 - 0.045));
      }
      function planMove() {
        const s = stackSkill();
        sp.pressure = U.clamp((stackHeight() - 8) / 10 + (0.35 - gravity()) * 1.2, 0, 1);
        const noise = U.lerp(0.4, 0.08, s) * (1 + sp.pressure);
        plan = bestPlacement(board, cur.name, next, noise, U.chance(s * 0.3));
        hold = null;
        if (!plan) return;
        // a wrong decision by one column (not a slip of the finger — that's the hold below)
        if (U.chance(0.02 + sp.pressure * 0.05)) {
          const dx = U.pick([-1, 1]);
          if (fits(board, cur.name, plan.rot, plan.x + dx, SPAWN_Y) || fits(board, cur.name, plan.rot, plan.x + dx, SPAWN_Y - 1)) plan.x += dx;
        }
        // the key sequence: a few "looking" spins, the real rotation, then the moves and the drop
        const keys = [];
        let r = 0;
        if (cur.name !== 'O' && U.chance(U.lerp(0.55, 0.15, s) * (1 - sp.pressure * 0.6))) {
          const spins = U.randInt(1, 2);
          for (let i = 0; i < spins; i++) keys.push('R');
          r = spins % 4;
        }
        const cw = (plan.rot - r + 4) % 4;
        if (cw === 3 && U.chance(0.55 + s * 0.4)) keys.push('L');       // the short way…
        else for (let i = 0; i < cw; i++) keys.push('R');                 // …or the long way round
        keys.push('MOVE', 'DROP');
        plan.keys = keys;
        plan.useHold = U.chance(0.5);
        plan.hard = U.chance(0.4 + s * 0.5);
        // first action 400–600 ms after the piece appears (quicker when rushed)
        actT = U.clamp(U.rand(0.4, 0.6) * Math.exp(U.gauss() * 0.2) * (1 - sp.pressure * 0.4), 0.2, 1.1);
      }
      function cpuStack(dt) {
        if (!cur || !plan) return;
        const s = stackSkill();
        // holding a direction key: the game auto-repeats, and letting go is a reaction
        if (hold) {
          hold.t -= dt;
          if (hold.t > 0) return;
          const stopAt = hold.overshoot ? plan.x + hold.dir : plan.x;
          if (cur.x === stopAt || !tryMove(hold.dir, 0) || cur.x === stopAt) {
            if (cur.x !== plan.x && !U.chance(0.5 + s * 0.4)) plan.x = cur.x;   // didn't notice the slip
            hold = null;
            actT = keyGap();
            return;
          }
          hold.t = 0.05;
          return;
        }
        actT -= dt;
        if (actT > 0) return;
        const k = plan.keys[0];
        if (k === 'R' || k === 'L') { plan.keys.shift(); rotate(k === 'R' ? 1 : -1); actT = keyGap(); return; }
        if (k === 'MOVE') {
          if (cur.rot !== plan.rot) { rotate(1); actT = keyGap(); return; }          // a rotation got blocked: fix it
          if (cur.x === plan.x) { plan.keys.shift(); actT = U.rand(0.12, 0.35) * (1 - sp.pressure * 0.5); return; }   // check, then drop
          const dir = Math.sign(plan.x - cur.x);
          if (plan.useHold && Math.abs(plan.x - cur.x) >= 3) {
            if (!tryMove(dir, 0)) { plan.x = cur.x; return; }
            hold = { dir, t: 0.16, overshoot: U.chance(0.25 * (1 - s) + sp.pressure * 0.15) };
            return;
          }
          if (!tryMove(dir, 0)) plan.x = cur.x;
          actT = keyGap();
          return;
        }
        if (k === 'DROP') { plan.keys.shift(); if (plan.hard) hardDrop(); else soft = true; }
      }

      /* ---------- computer dealer (plays like a person) ---------- */
      // Deals whatever comes to mind at first; as the game goes on it looks at
      // the board and deals the piece that fits worst more and more often.
      const dealSkill = () => Math.min(0.6, 0.05 + lines * 0.02);
      const dealer = new Arcade.Human({ reaction: 0.3 });
      function cpuDeal(dt) {
        if (next || !cur) return;
        dealerThink -= dt;
        if (dealerThink > 0) return;
        const opts = allowedList();
        if (!U.chance(dealSkill())) return void deal(U.pick(opts));
        const cp = bestPlacement(board, cur.name, null, 0, false);
        const after = cp ? placeOn(board, cur.name, cp.rot, cp.x, cp.y).board : board;
        const ranked = opts.map(p => { const b = bestPlacement(after, p, null, 0, false); return { p, sc: b ? b.score : -1e6 }; })
          .sort((a, b) => a.sc - b.sc);
        deal(ranked[U.chance(0.7) ? 0 : Math.min(1, ranked.length - 1)].p);     // the worst, or close to it
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

        // Game Boy look: pale green screen, brick-wall well, boxed SCORE/LEVEL/LINES/NEXT
        draw(ctx) {
          ctx.fillStyle = GB[3]; ctx.fillRect(0, 0, W, H);
          // brick walls either side of the well
          const brick = (x0, x1) => {
            for (let y = BY - 8, row = 0; y < BY + ROWS * CELL + 8; y += 13, row++)
              for (let x = x0 - (row % 2 ? 13 : 0); x < x1; x += 26) {
                const a = Math.max(x, x0), b = Math.min(x + 26, x1);
                if (b <= a) continue;
                ctx.fillStyle = GB[1]; ctx.fillRect(a, y, b - a, 13);
                ctx.fillStyle = GB[0]; ctx.fillRect(a, y + 11, b - a, 2); if (x >= x0) ctx.fillRect(x, y, 2, 13);
                ctx.fillStyle = GB[2]; ctx.fillRect(a + 3, y + 2, Math.max(0, b - a - 6), 2);
              }
          };
          brick(BX - 30, BX); brick(BX + COLS * CELL, BX + COLS * CELL + 30);
          ctx.fillStyle = GB[3]; ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
          ctx.fillStyle = GB[0]; ctx.fillRect(BX - 30, BY + ROWS * CELL, COLS * CELL + 60, 8);

          // blink cleared rows the way the Game Boy does before they collapse
          const blinkOn = clearing && Math.floor(clearing.t / 0.06) % 2 === 0;
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (board[y][x]) gbCell(ctx, BX + x * CELL, BY + y * CELL, CELL, board[y][x]);
          if (clearing) for (const r of clearing.rows) { ctx.fillStyle = blinkOn ? GB[0] : GB[3]; ctx.fillRect(BX, BY + r * CELL, COLS * CELL, CELL); }

          if (cur) {
            // faint landing shadow (the Game Boy had none; kept light so it doesn't distract)
            const gy = dropY(board, cur.name, cur.rot, cur.x, cur.y);
            ctx.fillStyle = 'rgba(48,98,48,.18)';
            for (const [cx, cy] of ROT[cur.name][cur.rot]) if (gy + cy >= 0) ctx.fillRect(BX + (cur.x + cx) * CELL + 2, BY + (gy + cy) * CELL + 2, CELL - 4, CELL - 4);
            for (const [cx, cy] of ROT[cur.name][cur.rot]) if (cur.y + cy >= 0) gbCell(ctx, BX + (cur.x + cx) * CELL, BY + (cur.y + cy) * CELL, CELL, cur.name);
          }

          // boxes, Game Boy style: dark outline, light fill, pixel text
          const box = (x, y, w, h, label) => {
            ctx.fillStyle = GB[0]; ctx.fillRect(x, y, w, h);
            ctx.fillStyle = GB[3]; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
            if (label) { ctx.fillStyle = GB[2]; ctx.fillRect(x + 4, y + 4, w - 8, 22); D.text(ctx, label, x + w / 2, y + 16, { size: 10, pixel: true, color: GB[0], align: 'center' }); }
          };
          const who = k => (api.isHuman(k) ? '1P' : 'CPU');
          const LX = 30, LW = 200;
          box(LX, 50, LW, 70, `STACKER ${who('stacker')}`);
          D.text(ctx, String(score), LX + LW - 16, 96, { size: 16, pixel: true, color: GB[0], align: 'right' });
          box(LX, 140, LW, 70, 'LEVEL');
          D.text(ctx, String(level()), LX + LW / 2, 186, { size: 18, pixel: true, color: GB[0], align: 'center' });
          box(LX, 230, LW, 90, 'LINES');
          D.text(ctx, `${lines}/${TARGET}`, LX + LW / 2, 272, { size: 18, pixel: true, color: GB[0], align: 'center' });
          ctx.fillStyle = GB[1]; ctx.fillRect(LX + 16, 296, LW - 32, 10);
          ctx.fillStyle = GB[3]; ctx.fillRect(LX + 18, 298, LW - 36, 6);
          ctx.fillStyle = GB[0]; ctx.fillRect(LX + 18, 298, (LW - 36) * Math.min(1, lines / TARGET), 6);
          box(LX, 340, LW, 90, 'GOAL');
          D.text(ctx, 'STACKER: 30 LINES', LX + LW / 2, 384, { size: 8, pixel: true, color: GB[0], align: 'center' });
          D.text(ctx, 'DEALER: TOP OUT', LX + LW / 2, 406, { size: 8, pixel: true, color: GB[0], align: 'center' });

          const RX = 570, RW = 200;
          box(RX, 50, RW, 120, `DEALER ${who('dealer')}`);
          D.text(ctx, 'NEXT', RX + 16, 44, { size: 8, pixel: true, color: GB[1] });
          if (next) miniPiece(ctx, next, RX + RW / 2, 104, 18);
          else if (Math.floor(api.time * 2.5) % 2) D.text(ctx, api.isHuman('dealer') ? 'PICK ONE' : 'THINKING', RX + RW / 2, 104, { size: 10, pixel: true, color: GB[1], align: 'center' });

          if (api.isHuman('dealer')) {
            NAMES.forEach((n, i) => {
              const r = paletteRect(i);
              const ok = allowed(n) && !next;
              const hov = api.pointer.inside && api.pointer.x >= r.x && api.pointer.x <= r.x + r.w && api.pointer.y >= r.y && api.pointer.y <= r.y + r.h;
              ctx.fillStyle = hov && ok ? GB[1] : GB[0]; ctx.fillRect(r.x, r.y, r.w, r.h);
              ctx.fillStyle = hov && ok ? GB[2] : GB[3]; ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
              ctx.globalAlpha = ok ? 1 : 0.25;
              miniPiece(ctx, n, r.x + r.w / 2 + 8, r.y + r.h / 2, 10);
              D.text(ctx, String(i + 1), r.x + 12, r.y + r.h / 2, { size: 8, pixel: true, color: GB[0] });
              ctx.globalAlpha = 1;
            });
            if (sinceI() >= 8) D.text(ctx, `I DUE IN ${12 - sinceI() - 1}`, RX + RW / 2, 570, { size: 8, pixel: true, color: GB[0], align: 'center' });
          } else {
            box(RX, 190, RW, 130, 'DEALT');
            history.slice(-8).reverse().forEach((n, i) => miniPiece(ctx, n, RX + 32 + (i % 4) * 45, 246 + Math.floor(i / 4) * 42, 9));
          }
        },
        score: () => score,
        endTitle: res => (res.winnerSide === 'stacker' ? '30 lines!' : 'Topped out'),
        _state: () => ({ lines, level: level(), over, board: board.map(r => r.map(c => c || '.').join('')) })
      };

      function humanDeal(n) {
        if (next) return api.toast('Next piece already dealt');
        if (!allowed(n)) return api.toast(sinceI() >= 11 ? 'An I-piece is due' : 'Not three in a row');
        deal(n);
      }
      function paletteRect(i) { return { x: 570 + (i % 2) * 104, y: 190 + Math.floor(i / 2) * 62, w: 96, h: 54 }; }
      function miniPiece(ctx, n, cx, cy, s) {
        const cells = ROT[n][0];
        const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
        const w = (Math.max(...xs) - Math.min(...xs) + 1) * s, h = (Math.max(...ys) - Math.min(...ys) + 1) * s;
        for (const [x, y] of cells) gbCell(ctx, cx - w / 2 + (x - Math.min(...xs)) * s, cy - h / 2 + (y - Math.min(...ys)) * s, s, n);
      }
    }
  });
})();
