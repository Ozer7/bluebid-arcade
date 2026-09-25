/* ==========================================================================
   SNAKE — one side steers the snake, the other side places the apples.
   Snake wins by eating 30 apples. Apples win if the snake crashes or starves.

   Fairness rules (apply to human and computer alike):
     • an apple must be at least 3 cells from the head and reachable
     • the hunger timer is sized from the real path length to the apple,
       so an apple can only starve the snake if the snake's own body is in
       the way — the placer has to set a trap, not just pick a far corner
     • the snake speeds up and grows faster as the game goes on
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const COLS = 32, ROWS = 22, CELL = 25, TOP = 50;
  const TARGET = 30;
  const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const idx = (x, y) => y * COLS + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

  /* ---------- board analysis shared by both computer players ---------- */

  // For every body cell, how many steps until it is free again.
  // Head = index 0. A segment at index i leaves after (length - i + pendingGrowth) steps.
  function freeAfter(body, grow) {
    const f = new Int16Array(COLS * ROWS);
    const n = body.length;
    for (let i = 0; i < n; i++) f[idx(body[i].x, body[i].y)] = n - i + grow;
    return f;
  }

  // Time-aware breadth-first search: a body cell counts as open if it will
  // have moved away by the time the head gets there. Returns the path
  // (list of cells, excluding the head) or null.
  function bfs(body, grow, target) {
    const f = freeAfter(body, grow);
    const start = body[0];
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    const dist = new Int16Array(COLS * ROWS).fill(-1);
    const q = [idx(start.x, start.y)];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0, d = dist[c];
      for (const dv of DIRS) {
        const nx = cx + dv.x, ny = cy + dv.y;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (dist[ni] !== -1) continue;
        if (f[ni] > d + 1) continue;               // still occupied when we would arrive
        dist[ni] = d + 1;
        prev[ni] = c;
        if (target && nx === target.x && ny === target.y) {
          const path = [];
          for (let k = ni; k !== q[0]; k = prev[k]) path.push({ x: k % COLS, y: (k / COLS) | 0 });
          return path.reverse();
        }
        q.push(ni);
      }
    }
    return target ? null : dist;                    // with no target: the whole distance map
  }

  // Can the snake still reach its own tail after following `path` and eating?
  // (If it can, it can never be trapped: it can always chase its tail.)
  function safeAfter(body, grow, path, growOnEat) {
    const b = body.slice();
    let g = grow;
    for (let i = 0; i < path.length; i++) {
      b.unshift(path[i]);
      if (g > 0) g--; else b.pop();
    }
    g += growOnEat;
    const tail = b[b.length - 1];
    // treat the tail as the goal: search with the tail cell considered free
    const p = bfs(b, g, tail);
    if (p) return true;
    // fallback: is there at least as much open room as the snake is long?
    return floodArea(b, b[0]) >= b.length + g;
  }

  function floodArea(body, from) {
    const blocked = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < body.length - 1; i++) blocked[idx(body[i].x, body[i].y)] = 1;
    const seen = new Uint8Array(COLS * ROWS);
    const q = [idx(from.x, from.y)];
    seen[q[0]] = 1;
    let n = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0;
      n++;
      for (const dv of DIRS) {
        const nx = cx + dv.x, ny = cy + dv.y;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen[ni] || blocked[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return n;
  }

  Arcade.register({
    id: 'snake',
    title: 'Snake',
    tagline: 'One side steers the snake. The other side decides where every apple goes.',
    flip: 'you place the apples, the computer steers.',
    blurb: 'The snake needs 30 apples to win. The apple placer wins if the snake crashes or starves. Apples must be reachable and at least 3 cells away, and the hunger clock is set from the real distance, so the only way to starve the snake is to trap it behind its own body.',
    menuText: 'Snake wins at <b>30 apples</b>. Apples win on a <b>crash or starvation</b>. The snake gets faster and longer as it eats.',
    sides: [
      { key: 'snake', label: 'Snake', human: 'Arrow keys or WASD to steer.', cpu: 'Plans a path with a search that knows where its body will be, and checks it can still reach its own tail after eating. It gets more careful as the game goes on.' },
      { key: 'apples', label: 'Apples', human: 'Click an empty cell to drop the next apple. You have a few seconds, or it lands at random.', cpu: 'Places apples at random at first, then looks for dead ends and apples that would trap the snake after eating.' }
    ],
    defaults: { snake: 'cpu', apples: 'human' },

    thumb(ctx, w, h) {
      const s = w / 16;
      ctx.fillStyle = C.grid;
      for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2) ctx.fillRect(x * s, y * s, s, s);
      const body = [[9, 6], [8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [5, 4], [4, 4], [3, 4]];
      body.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? '#7ff0a8' : `hsl(${145 - i * 3},62%,${52 - i * 2}%)`;
        D.roundRect(ctx, x * s + 2, y * s + 2, s - 4, s - 4, 6); ctx.fill();
      });
      ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(12.5 * s, 6.5 * s, s * 0.36, 0, 7); ctx.fill();
    },

    create(api) {
      const skillSnake = () => Math.min(0.97, 0.45 + eaten * 0.018);   // computer snake gets sharper
      const skillApple = () => Math.min(0.9, 0.12 + eaten * 0.03);     // computer placer gets nastier
      const stepTime = () => Math.max(0.07, 0.15 - eaten * 0.0027);
      const growPerApple = () => 1 + Math.floor(eaten / 10);
      const placeWindow = () => Math.max(1.8, 3.2 - eaten * 0.05);

      let snake = [{ x: 8, y: 11 }, { x: 7, y: 11 }, { x: 6, y: 11 }];
      let dir = { x: 1, y: 0 };
      let queue = [];
      let grow = 0;
      let stepAcc = 0;
      let eaten = 0;
      let apple = null;
      let placeLeft = placeWindow();
      let cpuThink = U.rand(0.4, 0.9);
      let hunger = 0, hungerMax = 1;
      let dead = null;
      let hover = null;
      let flash = 0;

      /* ----- apple placement (shared validation) ----- */
      function validity(x, y) {
        if (!inside(x, y)) return 'Off the board';
        if (snake.some(s => s.x === x && s.y === y)) return 'That cell is taken';
        const h = snake[0];
        if (Math.abs(h.x - x) + Math.abs(h.y - y) < 3) return 'Too close to the head';
        if (!bfs(snake, grow, { x, y })) return 'The snake cannot reach that cell';
        return null;
      }

      function place(x, y) {
        apple = { x, y };
        const p = bfs(snake, grow, apple);
        const len = p ? p.length : Math.abs(snake[0].x - x) + Math.abs(snake[0].y - y);
        hungerMax = hunger = stepTime() * (len * 1.5 + 14);
        flash = 0.35;
      }

      function validCells() {
        const out = [];
        const dist = bfs(snake, grow, null);
        const h = snake[0];
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
          const d = dist[idx(x, y)];
          if (d < 3) continue;                       // unreachable (-1) or too close
          if (snake.some(s => s.x === x && s.y === y)) continue;
          if (Math.abs(h.x - x) + Math.abs(h.y - y) < 3) continue;
          out.push({ x, y, d });
        }
        return out;
      }

      function randomPlace() {
        let cells = validCells();
        if (!cells.length) {                        // snake has sealed itself in — anywhere free
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
            if (!snake.some(s => s.x === x && s.y === y)) cells.push({ x, y });
        }
        const c = U.pick(cells);
        if (c) place(c.x, c.y);
      }

      // Computer apple placer: early on random; later it hunts for pockets
      // and for spots that leave the snake unable to reach its tail.
      function cpuPlace() {
        const cells = validCells();
        if (!cells.length) return randomPlace();
        if (!U.chance(skillApple())) { const c = U.pick(cells); return place(c.x, c.y); }
        const blockedN = (x, y) => DIRS.reduce((n, d) => {
          const nx = x + d.x, ny = y + d.y;
          return n + (!inside(nx, ny) || snake.some(s => s.x === nx && s.y === ny) ? 1 : 0);
        }, 0);
        const maxD = Math.max(...cells.map(c => c.d));
        cells.forEach(c => (c.score = (c.d / maxD) * 10 + blockedN(c.x, c.y) * 5 + Math.random() * 4));
        cells.sort((a, b) => b.score - a.score);
        let best = cells[0];
        // check the top candidates for a true trap (eating it leaves no way back to the tail)
        for (const c of cells.slice(0, 30)) {
          const path = bfs(snake, grow, c);
          if (path && !safeAfter(snake, grow, path, growPerApple())) { best = c; break; }
        }
        place(best.x, best.y);
      }

      /* ----- computer snake ----- */
      function cpuSteer() {
        const s = skillSnake();
        const head = snake[0];
        let path = apple ? bfs(snake, grow, apple) : null;
        if (path && U.chance(s) && !safeAfter(snake, grow, path, growPerApple())) path = null;
        if (path) return { x: path[0].x - head.x, y: path[0].y - head.y };
        return survivalMove();
      }

      // No safe path to the apple: keep alive by moving where there is the most room
      // and the tail is still reachable (tail-chasing), preferring the long way round.
      function survivalMove() {
        const head = snake[0];
        let best = null, bestScore = -Infinity;
        for (const d of DIRS) {
          if (d.x === -dir.x && d.y === -dir.y) continue;
          const nx = head.x + d.x, ny = head.y + d.y;
          if (!inside(nx, ny)) continue;
          const b = snake.slice();
          b.unshift({ x: nx, y: ny });
          let g = grow;
          if (g > 0) g--; else b.pop();
          const f = freeAfter(snake, grow);
          if (f[idx(nx, ny)] > 1) continue;         // collides with body
          const tailPath = bfs(b, g, b[b.length - 1]);
          const area = floodArea(b, b[0]);
          const score = (tailPath ? 2000 + tailPath.length * 3 : 0) + area + Math.random();
          if (score > bestScore) { bestScore = score; best = d; }
        }
        return best || dir;
      }

      /* ----- the tick ----- */
      function step() {
        if (api.isHuman('snake')) {
          if (queue.length) dir = queue.shift();
        } else {
          dir = cpuSteer();
        }
        const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        const hitsBody = snake.some((s, i) => s.x === head.x && s.y === head.y && !(i === snake.length - 1 && grow === 0));
        if (!inside(head.x, head.y) || hitsBody) {
          dead = 'crash';
          return api.end('apples', `The snake crashed after eating ${eaten} apple${eaten === 1 ? '' : 's'}.`);
        }
        snake.unshift(head);
        if (grow > 0) grow--; else snake.pop();
        if (apple && head.x === apple.x && head.y === apple.y) {
          eaten++;
          grow += growPerApple();
          apple = null;
          placeLeft = placeWindow();
          cpuThink = U.rand(0.35, 0.9);
          if (eaten >= TARGET) api.end('snake', `All ${TARGET} apples eaten — the snake is ${snake.length + grow} long.`);
          else if (eaten % 5 === 0) api.toast(`Level ${1 + eaten / 5} — faster!`, C.warn);
        }
      }

      return {
        update(dt) {
          if (flash > 0) flash -= dt;
          if (dead || eaten >= TARGET) return;
          // apple placement phase runs alongside the snake
          if (!apple) {
            placeLeft -= dt;
            if (!api.isHuman('apples')) {
              cpuThink -= dt;
              if (cpuThink <= 0) cpuPlace();
            } else if (placeLeft <= 0) {
              randomPlace();
              api.toast('Too slow — random apple', C.muted);
            }
          } else {
            hunger -= dt;
            if (hunger <= 0) {
              dead = 'starved';
              return api.end('apples', `The snake starved after ${eaten} apple${eaten === 1 ? '' : 's'}.`);
            }
          }
          stepAcc += dt;
          while (stepAcc >= stepTime() && !dead) { stepAcc -= stepTime(); step(); }
        },

        onKey(code) {
          if (!api.isHuman('snake')) return;
          const map = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
          const m = map[code];
          if (!m) return;
          const last = queue.length ? queue[queue.length - 1] : dir;
          if (m[0] === -last.x && m[1] === -last.y) return;       // no reversing into yourself
          if (m[0] === last.x && m[1] === last.y) return;
          if (queue.length < 2) queue.push({ x: m[0], y: m[1] });
        },

        onPointer(type, x, y) {
          if (!api.isHuman('apples')) return;
          const cx = Math.floor(x / CELL), cy = Math.floor((y - TOP) / CELL);
          hover = inside(cx, cy) ? { x: cx, y: cy } : null;
          if (type === 'down' && !apple && hover) {
            const why = validity(cx, cy);
            if (why) api.toast(why, C.bad); else place(cx, cy);
          }
        },

        draw(ctx) {
          ctx.fillStyle = C.bg;
          ctx.fillRect(0, 0, api.W, api.H);
          // board
          ctx.fillStyle = '#0c1329';
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
            if ((x + y) % 2) ctx.fillRect(x * CELL, TOP + y * CELL, CELL, CELL);

          // placement hint for a human placer
          if (!apple && api.isHuman('apples') && hover) {
            const ok = !validity(hover.x, hover.y);
            ctx.fillStyle = ok ? 'rgba(47,191,113,.35)' : 'rgba(242,92,105,.3)';
            ctx.fillRect(hover.x * CELL, TOP + hover.y * CELL, CELL, CELL);
          }

          // apple
          if (apple) {
            const ax = apple.x * CELL + CELL / 2, ay = TOP + apple.y * CELL + CELL / 2;
            const r = CELL * 0.38 + (flash > 0 ? flash * 14 : 0);
            ctx.fillStyle = C.bad;
            ctx.beginPath(); ctx.arc(ax, ay + 1, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = C.good;
            ctx.beginPath(); ctx.ellipse(ax + 4, ay - r + 1, 4, 2.2, -0.6, 0, Math.PI * 2); ctx.fill();
          }

          // snake
          const n = snake.length;
          for (let i = n - 1; i >= 0; i--) {
            const s = snake[i];
            const t = i / Math.max(1, n - 1);
            ctx.fillStyle = i === 0 ? '#7ff0a8' : `hsl(${145 - t * 40},${65 - t * 15}%,${55 - t * 18}%)`;
            const pad = i === 0 ? 1 : 2.5;
            D.roundRect(ctx, s.x * CELL + pad, TOP + s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 7);
            ctx.fill();
          }
          // eyes
          const h = snake[0], hx = h.x * CELL + CELL / 2, hy = TOP + h.y * CELL + CELL / 2;
          ctx.fillStyle = '#062012';
          for (const side of [-1, 1]) {
            const ex = hx + dir.x * 5 + dir.y * side * 5, ey = hy + dir.y * 5 - dir.x * side * 5;
            ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
          }
          if (dead) {
            ctx.fillStyle = 'rgba(242,92,105,.25)';
            ctx.fillRect(0, TOP, api.W, api.H - TOP);
          }

          // HUD
          const who = side => (api.isHuman(side) ? 'YOU' : 'CPU');
          D.hud(ctx, [
            { text: `SNAKE · ${who('snake')}`, color: C.good, pixel: true },
            { text: `APPLES ${eaten}/${TARGET}   LV ${1 + Math.floor(eaten / 5)}`, align: 'center', pixel: true },
            { text: `${who('apples')} · APPLES`, color: C.bad, align: 'right', pixel: true }
          ]);
          // hunger bar or placement timer
          if (apple) {
            D.bar(ctx, 0, 40, api.W, 6, hunger / hungerMax, hunger / hungerMax < 0.3 ? C.bad : C.warn, C.panel);
          } else {
            D.bar(ctx, 0, 40, api.W, 6, placeLeft / placeWindow(), C.accent, C.panel);
            if (api.isHuman('apples')) D.text(ctx, `Click to place an apple · ${Math.max(0, placeLeft).toFixed(1)}s`, api.W / 2, 64, { size: 13, color: C.accent, align: 'center' });
          }
        },

        // for tests
        _state: () => ({ eaten, length: snake.length, dead })
      };
    }
  });
})();
