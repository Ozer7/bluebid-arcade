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

  // Nokia 3310 LCD: two colours only (Lospec "Nokia 3310" palette)
  const LCD = '#c7f0d8', INK = '#43523d', INK_SOFT = 'rgba(67,82,61,.14)';

  Arcade.register({
    id: 'snake',
    title: 'Snake',
    year: '1998 · Nokia 6110 (after Blockade, 1976)',
    history: 'Nokia shipped Snake on its phones from 1998; on the 3310 it ran on a two-tone green LCD, and higher levels were faster and worth more per bite. The Museum of Modern Art added it to its collection in 2012.',
    tagline: 'One side steers the snake. The other decides where every apple goes.',
    flip: 'you place the apples, the computer steers.',
    blurb: 'The snake needs 30 apples to win. The apple placer wins if the snake crashes or starves.',
    menuText: 'Snake wins at <b>30 apples</b>. Apples win on a <b>crash or starvation</b>. It gets faster, longer and worth more every 5 apples.',
    scoreSide: 'snake', scoreName: 'points',
    sides: [
      { key: 'snake', label: 'Snake', human: 'Arrow keys or WASD to steer. Each apple is worth 10 × the level.', cpu: 'Plays like a person: heads for the apple on an L-shaped route, turns early before walls, hugs the edges when long, and sometimes turns a step late or misjudges a dead end.' },
      { key: 'apples', label: 'Apples', human: 'Click an empty cell to drop the next apple (it must be reachable and 3+ cells away). Trap the snake behind its own body to starve it.', cpu: 'Mostly drops apples "somewhere far away"; as the game goes on, tucks them behind the body or into corners more often.' }
    ],
    defaults: { snake: 'cpu', apples: 'human' },

    thumb(ctx, w, h) {
      ctx.fillStyle = LCD; ctx.fillRect(0, 0, w, h);
      const s = w / 16;
      ctx.fillStyle = INK;
      ctx.fillRect(4, 4, w - 8, 4); ctx.fillRect(4, h - 8, w - 8, 4); ctx.fillRect(4, 4, 4, h - 8); ctx.fillRect(w - 8, 4, 4, h - 8);
      [[9, 6], [8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [5, 4], [4, 4], [3, 4]].forEach(([x, y]) => ctx.fillRect(x * s + 2, y * s + 2, s - 3, s - 3));
      ctx.fillRect(12 * s + s / 3, 6 * s, s / 3, s); ctx.fillRect(12 * s, 6 * s + s / 3, s, s / 3);
    },

    create(api) {
      // How much of the board the computer snake "takes in" when judging whether a
      // turn leads into a dead end. Small pockets are obvious; big traps are not —
      // exactly the mistake real players make when their snake gets long.
      const vision = () => Math.min(50, 12 + eaten * 1.4);
      const meanness = () => Math.min(0.55, 0.1 + eaten * 0.02);      // computer placer gets craftier
      const stepTime = () => Math.max(0.07, 0.15 - eaten * 0.0027);
      const growPerApple = () => 1 + Math.floor(eaten / 10);
      const placeWindow = () => Math.max(1.8, 3.2 - eaten * 0.05);

      let snake = [{ x: 8, y: 11 }, { x: 7, y: 11 }, { x: 6, y: 11 }];
      let dir = DIRS[0];
      let queue = [];
      let grow = 0;
      let stepAcc = 0;
      let eaten = 0;
      let apple = null;
      let placeLeft = placeWindow();
      let cpuThink = U.rand(0.6, 1.2);
      let hunger = 0, hungerMax = 1;
      let dead = null;
      let hover = null;
      let flash = 0;
      let deathT = 0, bonk = null;                    // crash animation
      let score = 0;
      let ghosts = [];                                 // LCD ghosting: cells the tail just left fade out slowly
      const person = new Arcade.Human({ reaction: 0.26, lapseRate: 0.025 });

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
        api.sfx('blip', { f: 520 });
        const p = bfs(snake, grow, apple);
        const len = p ? p.length : Math.abs(snake[0].x - x) + Math.abs(snake[0].y - y);
        hungerMax = hunger = stepTime() * (len * 2 + 22);
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

      // Computer apple placer, played the way a person plays it: mostly "somewhere
      // far away", sometimes tucked against a wall or corner, and — more often as
      // the game goes on — behind the snake's body so it has to go the long way round.
      function cpuPlace() {
        const cells = validCells();
        if (!cells.length) return randomPlace();
        const h = snake[0];
        const man = c => Math.abs(c.x - h.x) + Math.abs(c.y - h.y);
        const blockedN = c => DIRS.reduce((n, d) => {
          const nx = c.x + d.x, ny = c.y + d.y;
          return n + (!inside(nx, ny) || snake.some(s => s.x === nx && s.y === ny) ? 1 : 0);
        }, 0);
        const r = Math.random(), m = meanness();
        let pool;
        if (r < m * 0.6) pool = cells.filter(c => c.d - man(c) >= 6);            // behind the body
        else if (r < m) pool = cells.filter(c => blockedN(c) >= 2);             // tucked in a pocket or corner
        else if (r < m + 0.25) pool = cells.filter(c => c.x < 2 || c.y < 2 || c.x > COLS - 3 || c.y > ROWS - 3);
        else pool = cells.filter(c => man(c) >= 8);                            // just "far away"
        if (!pool || !pool.length) pool = cells;
        const c = U.pick(pool);
        place(c.x, c.y);
      }

      /* ----- computer snake: plays like a person ----- */
      // What a player actually does: heads for the apple along an L-shaped route
      // (few turns), turns a cell early when a wall or its body is coming up,
      // hugs the edges once the snake is long, and avoids pockets it can see.
      // What a player gets wrong: turns a step late when the snake is fast,
      // occasionally isn't paying attention, and misjudges big enclosed areas —
      // so it dies the way people die, by boxing itself in or clipping a wall.
      const lateChance = () => U.clamp(0.1 + (0.15 / stepTime() - 1) * 0.2, 0.1, 0.34);

      function occupiedAt(x, y) {
        if (!inside(x, y)) return true;
        return snake.some((b, i) => b.x === x && b.y === y && !(i === snake.length - 1 && grow === 0));
      }
      // flood fill that gives up after `cap` cells — the "how open does it look" glance
      function glance(x, y, cap) {
        const seen = new Set([x + ',' + y]);
        const q = [[x, y]];
        const body = new Set(snake.slice(0, -1).map(b => b.x + ',' + b.y));
        for (let h = 0; h < q.length && seen.size < cap; h++) {
          const [cx, cy] = q[h];
          for (const d of DIRS) {
            const nx = cx + d.x, ny = cy + d.y, k = nx + ',' + ny;
            if (!inside(nx, ny) || seen.has(k) || body.has(k)) continue;
            seen.add(k); q.push([nx, ny]);
          }
        }
        return seen.size;
      }

      function cpuSteer() {
        const head = snake[0];
        const len = snake.length + grow;
        const straight = dir;
        const cap = vision();
        // walking distance to the apple around the body — players know the tail moves
        // out of the way, so a spot sealed by the tail still counts as reachable
        const routeLen = (body, g) => { const p = apple ? bfs(body, g, apple) : null; return p ? p.length : 999; };
        const hereLen = routeLen(snake, grow);
        let best = null;
        for (const d of DIRS) {
          if (d.x === -dir.x && d.y === -dir.y) continue;
          const nx = head.x + d.x, ny = head.y + d.y;
          if (occupiedAt(nx, ny)) continue;
          let score = 0;
          if (apple) {
            const moved = [{ x: nx, y: ny }, ...snake];
            let g2 = grow; if (g2 > 0) g2--; else moved.pop();
            const before = hereLen, after = nx === apple.x && ny === apple.y ? 0 : routeLen(moved, g2);
            const hurry = 1 + (1 - hunger / hungerMax) * 1.5;               // hungrier = more direct
            score += (after < before ? 3 : -2) * hurry;
          }
          if (d === straight) score += 1.2;                                      // fewer turns
          if (d === straight && occupiedAt(nx + d.x, ny + d.y)) score -= 2.5;     // turn a cell early
          const room = glance(nx, ny, cap);
          score += (room / cap) * 3;
          // "that's a dead end" — but a hungry player takes the risk anyway
          const caution = U.clamp((hunger / hungerMax - 0.15) / 0.4, 0, 1);
          if (room < Math.min(len + 3, cap) && U.chance(0.6)) score -= 20 * caution;
          if (len > 20 && hunger / hungerMax > 0.5) score += 0.5 * DIRS.reduce((n, e) => n + (occupiedAt(nx + e.x, ny + e.y) ? 1 : 0), 0);   // hug walls/body
          score += U.gauss() * 0.7;
          if (!best || score > best.score) best = { d, score };
        }
        if (!best) return dir;                                                   // nowhere to go
        const turning = best.d !== dir;
        const straightFatal = occupiedAt(head.x + dir.x, head.y + dir.y);
        if (turning) {
          // reacting a step late, or not paying attention for a moment
          const late = lateChance() * (straightFatal ? 0.05 : 1);      // a wall right in your face is hard to miss
          if (U.chance(late) || person.lapsed(stepTime()) && !straightFatal) return dir;
        }
        return best.d;
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
          bonk = { x: dir.x, y: dir.y, wall: !inside(head.x, head.y) };
          api.sfx('crash');
          const what = bonk.wall ? 'hit the wall' : 'ran into itself';
          return api.end('apples', `The snake ${what} after eating ${eaten} apple${eaten === 1 ? '' : 's'}.`, 1800);
        }
        snake.unshift(head);
        if (grow > 0) grow--; else { const t = snake.pop(); ghosts.push({ x: t.x, y: t.y, a: 0.5 }); }
        if (apple && head.x === apple.x && head.y === apple.y) {
          eaten++;
          score += 10 * (1 + Math.floor((eaten - 1) / 5));
          grow += growPerApple();
          api.sfx('eat');
          apple = null;
          placeLeft = placeWindow();
          cpuThink = person.react(true) + U.rand(0.2, 0.8) + person.point(U.rand(150, 500), CELL);    // look, decide, move the mouse, click
          if (eaten >= TARGET) api.end('snake', `All ${TARGET} apples eaten — the snake is ${snake.length + grow} long.`);
          else if (eaten % 5 === 0) api.toast(`Level ${1 + eaten / 5} — faster!`);
        }
      }

      return {
        update(dt) {
          if (flash > 0) flash -= dt;
          for (const g of ghosts) g.a -= dt * 3;
          ghosts = ghosts.filter(g => g.a > 0);
          if (dead) { deathT += dt; return; }
          if (eaten >= TARGET) return;
          // apple placement phase runs alongside the snake
          if (!apple) {
            placeLeft -= dt;
            if (!api.isHuman('apples')) {
              cpuThink -= dt;
              if (cpuThink <= 0) cpuPlace();
            } else if (placeLeft <= 0) {
              randomPlace();
              api.toast('Too slow — random apple');
            }
          } else {
            hunger -= dt;
            if (hunger <= 0) {
              dead = 'starved';
              api.sfx('lose');
              return api.end('apples', `The snake starved after ${eaten} apple${eaten === 1 ? '' : 's'}.`, 1800);
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
            if (why) api.toast(why); else place(cx, cy);
          }
        },

        // Nokia-style LCD: two colours, chunky pixels, a faint pixel grid and
        // ghosting where the tail has just been
        draw(ctx) {
          ctx.fillStyle = LCD;
          ctx.fillRect(0, 0, api.W, api.H);
          // pixel grid of the LCD
          ctx.fillStyle = INK_SOFT;
          for (let x = 0; x <= COLS; x++) ctx.fillRect(x * CELL, TOP, 1, ROWS * CELL);
          for (let y = 0; y <= ROWS; y++) ctx.fillRect(0, TOP + y * CELL, COLS * CELL, 1);
          // playfield border
          ctx.fillStyle = INK;
          ctx.fillRect(0, TOP - 4, api.W, 3);

          const px = (x, y, a = 1, pad = 2) => { ctx.globalAlpha = a; ctx.fillRect(x * CELL + pad, TOP + y * CELL + pad, CELL - pad * 2, CELL - pad * 2); ctx.globalAlpha = 1; };

          // placement hint for a human placer: a dotted cell
          if (!apple && api.isHuman('apples') && hover) {
            const ok = !validity(hover.x, hover.y);
            ctx.strokeStyle = INK; ctx.setLineDash(ok ? [3, 3] : [1, 5]); ctx.lineWidth = 2;
            ctx.strokeRect(hover.x * CELL + 3, TOP + hover.y * CELL + 3, CELL - 6, CELL - 6);
            ctx.setLineDash([]);
          }

          // food: the Nokia "plus" shaped bite
          if (apple) {
            const ax = apple.x * CELL, ay = TOP + apple.y * CELL, u = CELL / 5;
            const blinkOn = flash <= 0 || Math.floor(flash * 20) % 2 === 0;
            if (blinkOn) {
              ctx.fillStyle = INK;
              ctx.fillRect(ax + 2 * u, ay + u * 0.6, u, u * 3.8);
              ctx.fillRect(ax + u * 0.6, ay + 2 * u, u * 3.8, u);
            }
          }

          // ghosting
          ctx.fillStyle = INK;
          for (const g of ghosts) px(g.x, g.y, g.a * 0.35);

          // snake — blinks when it dies, like on the phone
          const visible = !dead || deathT > 1.2 || Math.floor(deathT * 6) % 2 === 0;
          const shake = dead === 'crash' && deathT < 0.3 ? (Math.random() - 0.5) * 6 : 0;
          if (visible) {
            ctx.save();
            ctx.translate(shake, 0);
            const n = snake.length;
            for (let i = n - 1; i >= 0; i--) {
              const s = snake[i];
              let a = 1;
              if (dead === 'starved') a = U.clamp(1 - (deathT - (1 - i / n) * 0.6) * 1.2, 0.15, 1);
              ctx.fillStyle = INK;
              let ox = 0, oy = 0;
              if (i === 0 && bonk) { const k = Math.min(1, deathT * 8) * 6; ox = bonk.x * k; oy = bonk.y * k; }
              ctx.globalAlpha = a;
              ctx.fillRect(s.x * CELL + 2 + ox, TOP + s.y * CELL + 2 + oy, CELL - 4, CELL - 4);
              // body segments are joined, like the phone's snake
              const nxt = snake[i - 1];
              if (nxt) {
                const jx = (s.x + nxt.x) / 2, jy = (s.y + nxt.y) / 2;
                ctx.fillRect(jx * CELL + 4, TOP + jy * CELL + 4, CELL - 8, CELL - 8);
              }
              ctx.globalAlpha = 1;
            }
            // eye (an X once it's dead)
            const h = snake[0];
            const hx = h.x * CELL + CELL / 2 + dir.x * 4 - dir.y * 4 + (bonk ? bonk.x * 6 : 0);
            const hy = TOP + h.y * CELL + CELL / 2 + dir.y * 4 + dir.x * 4 + (bonk ? bonk.y * 6 : 0);
            ctx.fillStyle = LCD;
            if (dead) { ctx.fillRect(hx - 3, hy - 3, 2, 2); ctx.fillRect(hx + 1, hy + 1, 2, 2); ctx.fillRect(hx + 1, hy - 3, 2, 2); ctx.fillRect(hx - 3, hy + 1, 2, 2); }
            else ctx.fillRect(hx - 2, hy - 2, 4, 4);
            ctx.restore();
          }
          if (dead && deathT > 0.5) {
            ctx.fillStyle = LCD; ctx.fillRect(api.W / 2 - 170, TOP + 150, 340, 70);
            ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(api.W / 2 - 170, TOP + 150, 340, 70);
            D.text(ctx, dead === 'starved' ? 'STARVED' : 'GAME OVER', api.W / 2, TOP + 186, { size: 24, pixel: true, align: 'center', color: INK });
          }

          // status line, phone style
          const who = side => (api.isHuman(side) ? 'YOU' : 'CPU');
          D.text(ctx, String(score).padStart(4, '0'), 12, 24, { size: 18, pixel: true, color: INK });
          D.text(ctx, `${eaten}/${TARGET}`, api.W / 2 - 110, 24, { size: 12, pixel: true, color: INK, align: 'center' });
          D.text(ctx, `LV${1 + Math.floor(eaten / 5)}`, api.W / 2 - 20, 24, { size: 12, pixel: true, color: INK, align: 'center' });
          D.text(ctx, `SNAKE:${who('snake')} FOOD:${who('apples')}`, api.W - 12, 24, { size: 10, pixel: true, color: INK, align: 'right' });
          // hunger (or the placement countdown) as a segmented bar
          const t = apple ? hunger / hungerMax : placeLeft / placeWindow();
          const segs = 12, filled = Math.ceil(U.clamp(t, 0, 1) * segs);
          for (let i = 0; i < segs; i++) {
            ctx.fillStyle = INK; ctx.globalAlpha = i < filled ? (apple && t < 0.3 && Math.floor(api.time * 6) % 2 ? 0.3 : 1) : 0.15;
            ctx.fillRect(api.W / 2 + 40 + i * 9, 16, 7, 14);
          }
          ctx.globalAlpha = 1;
          if (!apple && api.isHuman('apples')) D.text(ctx, 'PLACE FOOD!', api.W / 2 + 200, 24, { size: 10, pixel: true, color: INK });
        },

        score: () => score,
        endTitle: () => (dead ? 'Game over' : 'Snake wins'),
        // for tests
        _state: () => ({ eaten, length: snake.length, dead })
      };
    }
  });
})();
