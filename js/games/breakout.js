/* ==========================================================================
   BREAKOUT — head to head.
   Two paddles (bottom and top) share one wall of bricks in the middle.
   Each player serves their own ball. Break bricks for points; get a ball
   past your opponent's paddle to take one of their lives.
   First to lose all 5 lives loses. The ball speeds up every level, and
   a fresh wall is built whenever the old one is cleared.
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const PW = 104, PH = 12;                   // paddle size
  const BOTTOM_Y = H - 34, TOP_Y = 34;       // paddle centre lines
  const BALL_R = 7;
  const PADDLE_MAX_SPEED = 820;              // px/s — same cap for mouse, keys and computer
  const LIVES = 5;
  const BR_COLS = 14, BR_ROWS = 6, BR_W = W / BR_COLS, BR_H = 20;
  const BR_TOP = H / 2 - (BR_ROWS * BR_H) / 2;
  const ROW_COLORS = ['#f25c69', '#f0a83c', '#e8d44d', '#2fbf71', '#3cc8e0', '#a77bff'];

  Arcade.register({
    id: 'breakout',
    title: 'Breakout',
    tagline: 'Two paddles, one wall of bricks. Smash through the wall and past your opponent.',
    flip: 'the computer plays against you.',
    blurb: 'Each player has a paddle and a ball. Bricks score points. Getting a ball past the other paddle takes one of their lives, and the first player to lose all 5 lives loses. The balls speed up every level, and the computer paddle has the same speed limit as yours.',
    menuText: 'First to lose <b>5 lives</b> loses. The balls get faster each level, and a fresh wall appears when one is cleared.',
    sides: [
      { key: 'bottom', label: 'Blue (bottom)', human: 'Move the mouse, or use ← →. Click or press Space to serve.', cpu: 'Predicts where the ball will cross its line, bounces included, then aims its return toward gaps in the wall. Its reactions and aim sharpen every level.' },
      { key: 'top', label: 'Orange (top)', human: 'Move the mouse, or use A / D (← → too if only one human is playing). Click or press Space to serve.', cpu: 'Same brain as the blue computer: it predicts, aims, and gets sharper every level.' }
    ],
    defaults: { bottom: 'human', top: 'cpu' },

    thumb(ctx, w) {
      const s = w / W;
      for (let r = 0; r < BR_ROWS; r++) for (let c = 0; c < BR_COLS; c++) {
        if ((r * 7 + c * 3) % 11 === 0) continue;
        ctx.fillStyle = ROW_COLORS[r];
        ctx.fillRect(c * BR_W * s + 1, (BR_TOP + r * BR_H) * s + 1, BR_W * s - 2, BR_H * s - 2);
      }
      ctx.fillStyle = C.p1; D.roundRect(ctx, 150 * s, (BOTTOM_Y - 6) * s, PW * s, PH * s, 4); ctx.fill();
      ctx.fillStyle = C.p2; D.roundRect(ctx, 520 * s, (TOP_Y - 6) * s, PW * s, PH * s, 4); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(260 * s, 430 * s, 8 * s * 1.6, 0, 7); ctx.fill();
    },

    create(api) {
      let level = 1;
      let levelTimer = 0;
      const ballSpeed = () => 330 + (level - 1) * 38;

      const players = {
        bottom: { key: 'bottom', y: BOTTOM_Y, x: W / 2, vx: 0, lives: LIVES, score: 0, color: C.p1, dirToOpp: -1, target: W / 2, think: 0 },
        top: { key: 'top', y: TOP_Y, x: W / 2, vx: 0, lives: LIVES, score: 0, color: C.p2, dirToOpp: 1, target: W / 2, think: 0 }
      };
      const other = k => (k === 'bottom' ? players.top : players.bottom);

      let bricks = [];
      function buildWall() {
        bricks = [];
        for (let r = 0; r < BR_ROWS; r++) for (let c = 0; c < BR_COLS; c++)
          bricks.push({ x: c * BR_W + 1.5, y: BR_TOP + r * BR_H + 1.5, w: BR_W - 3, h: BR_H - 3, row: r, alive: true });
      }
      buildWall();

      // one ball per player, starting stuck to its owner's paddle
      const balls = [makeBall('bottom'), makeBall('top')];
      function makeBall(owner) {
        return { owner, server: owner, x: 0, y: 0, vx: 0, vy: 0, stuck: true, serveT: 1.2, trail: [] };
      }
      function stickTo(b) {
        const p = players[b.server];
        b.x = p.x;
        b.y = p.key === 'bottom' ? p.y - PH / 2 - BALL_R - 1 : p.y + PH / 2 + BALL_R + 1;
      }
      function serve(b) {
        const p = players[b.server];
        const ang = U.rand(-0.45, 0.45);
        b.stuck = false;
        b.owner = b.server;
        b.vx = Math.sin(ang) * ballSpeed();
        b.vy = p.dirToOpp * Math.cos(ang) * ballSpeed();
      }

      // human controls
      const humans = Object.keys(players).filter(k => api.isHuman(k));
      const controls = {};
      for (const k of humans) {
        const solo = humans.length === 1;
        controls[k] = {
          left: solo ? ['ArrowLeft', 'KeyA'] : k === 'bottom' ? ['ArrowLeft'] : ['KeyA'],
          right: solo ? ['ArrowRight', 'KeyD'] : k === 'bottom' ? ['ArrowRight'] : ['KeyD'],
          mouse: solo || k === 'bottom'
        };
      }
      let mouseActive = false;

      /* ---------- computer paddle ---------- */
      const skill = () => U.clamp(0.32 + (level - 1) * 0.08 + levelTimer / 300, 0.32, 0.78);

      // Where will this ball cross the line y = lineY? Simulates wall bounces
      // and the brick band (as a solid block where bricks remain).
      function predictX(b, lineY) {
        let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
        if ((lineY - y) * vy <= 0) return null;    // moving away
        const dt = 1 / 120;
        for (let i = 0; i < 600; i++) {
          x += vx * dt; y += vy * dt;
          if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx); }
          if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx); }
          if (y > BR_TOP - BALL_R && y < BR_TOP + BR_ROWS * BR_H + BALL_R) {
            const col = U.clamp(Math.floor(x / BR_W), 0, BR_COLS - 1);
            if (bricks.some(br => br.alive && Math.abs(br.x + br.w / 2 - (col + 0.5) * BR_W) < 2 &&
                y > br.y - BALL_R && y < br.y + br.h + BALL_R)) vy = -vy;
          }
          if ((vy > 0 && y >= lineY) || (vy < 0 && y <= lineY)) return x;
        }
        return x;
      }

      function cpuThink(p, dt) {
        p.think -= dt;
        if (p.think > 0) return;
        const s = skill();
        p.think = U.lerp(0.26, 0.07, s);            // reaction time
        const lineY = p.key === 'bottom' ? p.y - PH / 2 - BALL_R : p.y + PH / 2 + BALL_R;
        // most urgent ball heading our way
        let best = null, bestT = Infinity;
        for (const b of balls) {
          if (b.stuck) continue;
          if ((lineY - b.y) * b.vy <= 0) continue;
          const t = (lineY - b.y) / b.vy;
          if (t < bestT) { bestT = t; best = b; }
        }
        if (best) {
          const px = predictX(best, lineY);
          const err = U.gauss() * U.lerp(58, 14, s);
          // aim: hit the ball off-centre to steer it toward the opponent's side / open gaps
          const opp = other(p.key);
          const wantLeft = opp.x > W / 2;
          const aim = (wantLeft ? 1 : -1) * U.lerp(0, PW * 0.32, s) * (U.chance(0.6) ? 1 : -0.4);
          p.target = U.clamp(px + err + aim, PW / 2, W - PW / 2);
        } else {
          // nothing incoming: drift back toward the middle, loosely following play
          const any = balls.find(b => !b.stuck);
          p.target = any ? U.lerp(W / 2, any.x, 0.4) : W / 2;
        }
      }

      function movePaddle(p, dt) {
        let desired = p.x;
        if (api.isHuman(p.key)) {
          const c = controls[p.key];
          const l = c.left.some(k => api.keys.has(k)), r = c.right.some(k => api.keys.has(k));
          if (l || r) { mouseActive = false; desired = p.x + (r - l) * PADDLE_MAX_SPEED * dt; }
          else if (c.mouse && mouseActive) desired = api.pointer.x;
        } else {
          cpuThink(p, dt);
          desired = p.target;
        }
        const maxStep = PADDLE_MAX_SPEED * dt;
        const nx = U.clamp(p.x + U.clamp(desired - p.x, -maxStep, maxStep), PW / 2, W - PW / 2);
        p.vx = (nx - p.x) / dt;
        p.x = nx;
      }

      /* ---------- ball physics ---------- */
      function paddleHit(b, p) {
        const top = p.y - PH / 2, bot = p.y + PH / 2;
        if (b.x < p.x - PW / 2 - BALL_R || b.x > p.x + PW / 2 + BALL_R) return false;
        if (p.key === 'bottom' && b.vy > 0 && b.y + BALL_R >= top && b.y < bot) {
          bounceOff(b, p); b.y = top - BALL_R; return true;
        }
        if (p.key === 'top' && b.vy < 0 && b.y - BALL_R <= bot && b.y > top) {
          bounceOff(b, p); b.y = bot + BALL_R; return true;
        }
        return false;
      }
      function bounceOff(b, p) {
        const off = U.clamp((b.x - p.x) / (PW / 2), -1, 1);
        const ang = off * 1.05;                        // up to ~60° off vertical
        const sp = ballSpeed();
        b.vx = Math.sin(ang) * sp;
        b.vy = p.dirToOpp * Math.cos(ang) * sp;
        b.owner = p.key;
      }

      function hitBricks(b) {
        for (const br of bricks) {
          if (!br.alive) continue;
          const cx = U.clamp(b.x, br.x, br.x + br.w), cy = U.clamp(b.y, br.y, br.y + br.h);
          const dx = b.x - cx, dy = b.y - cy;
          if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
          br.alive = false;
          players[b.owner].score += 10 + (BR_ROWS - 1 - Math.abs(br.row - 2.5)) * 2 | 0;
          // bounce along the axis of least penetration
          const ox = Math.min(Math.abs(b.x + BALL_R - br.x), Math.abs(br.x + br.w - (b.x - BALL_R)));
          const oy = Math.min(Math.abs(b.y + BALL_R - br.y), Math.abs(br.y + br.h - (b.y - BALL_R)));
          if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
          return;
        }
      }

      function loseBall(b, loserKey) {
        const loser = players[loserKey];
        loser.lives--;
        api.toast(`${loserKey === 'bottom' ? 'Blue' : 'Orange'} loses a life`, loserKey === 'bottom' ? C.p1 : C.p2);
        if (loser.lives <= 0) {
          const win = other(loserKey).key;
          api.end(win, `Final score ${players.bottom.score} – ${players.top.score} (blue – orange).`);
        }
        // the player who lost the ball serves it next
        b.server = loserKey;
        b.stuck = true;
        b.serveT = 1.4;
        b.trail = [];
      }

      function tryServe(key) {
        for (const b of balls) if (b.stuck && b.server === key && b.serveT < 1.0) serve(b);
      }

      return {
        update(dt) {
          levelTimer += dt;
          if (levelTimer > 28) { level++; levelTimer = 0; api.toast(`Level ${level} — faster ball`, C.warn); speedUp(); }

          for (const k in players) movePaddle(players[k], dt);

          for (const b of balls) {
            if (b.stuck) {
              stickTo(b);
              b.serveT -= dt;
              // computer serves quickly; humans get 3 seconds before an automatic serve
              const limit = api.isHuman(b.server) ? -2 : -U.rand(0, 0.4);
              if (b.serveT < limit) serve(b);
              continue;
            }
            // sub-step so fast balls cannot tunnel through paddles or bricks
            const steps = 3;
            for (let i = 0; i < steps; i++) {
              b.x += (b.vx * dt) / steps;
              b.y += (b.vy * dt) / steps;
              if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
              if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
              paddleHit(b, players.bottom);
              paddleHit(b, players.top);
              hitBricks(b);
              // stop nearly-horizontal balls from getting stuck bouncing forever
              if (Math.abs(b.vy) < ballSpeed() * 0.3) b.vy = Math.sign(b.vy || 1) * ballSpeed() * 0.3;
            }
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 8) b.trail.shift();
            if (b.y > H + BALL_R) loseBall(b, 'bottom');
            else if (b.y < -BALL_R) loseBall(b, 'top');
          }

          if (bricks.every(br => !br.alive)) {
            buildWall();
            level++; levelTimer = 0;
            api.toast(`Wall cleared! Level ${level}`, C.good);
            speedUp();
          }
        },

        onKey(code) {
          if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') for (const k of humans) tryServe(k);
        },
        onPointer(type) {
          if (type === 'move') mouseActive = true;
          if (type === 'down') { mouseActive = true; for (const k of humans) if (controls[k].mouse) tryServe(k); }
        },

        draw(ctx) {
          ctx.fillStyle = C.bg;
          ctx.fillRect(0, 0, W, H);
          // centre glow
          const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 420);
          g.addColorStop(0, 'rgba(79,124,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

          for (const br of bricks) {
            if (!br.alive) continue;
            ctx.fillStyle = ROW_COLORS[br.row];
            D.roundRect(ctx, br.x, br.y, br.w, br.h, 3); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.18)';
            ctx.fillRect(br.x + 2, br.y + 2, br.w - 4, 3);
          }

          for (const k in players) {
            const p = players[k];
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color; ctx.shadowBlur = 14;
            D.roundRect(ctx, p.x - PW / 2, p.y - PH / 2, PW, PH, 6); ctx.fill();
            ctx.shadowBlur = 0;
          }

          for (const b of balls) {
            const col = players[b.owner].color;
            b.trail.forEach((t, i) => {
              ctx.globalAlpha = (i / b.trail.length) * 0.35;
              ctx.fillStyle = col;
              ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (i / b.trail.length), 0, 7); ctx.fill();
            });
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, 7); ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
            if (b.stuck && api.isHuman(b.server) && b.serveT < 1.0) {
              D.text(ctx, 'click / space to serve', players[b.server].x, b.server === 'bottom' ? BOTTOM_Y - 34 : TOP_Y + 34,
                { size: 12, color: C.muted, align: 'center' });
            }
          }

          // side scoreboards (vertical, so they don't cover the paddles)
          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          const lives = n => '●'.repeat(Math.max(0, n)) + '○'.repeat(Math.max(0, LIVES - n));
          D.text(ctx, `${who('top')} ${players.top.score}`, 14, H / 2 - 92, { size: 16, color: C.p2, pixel: true });
          D.text(ctx, lives(players.top.lives), 14, H / 2 - 70, { size: 14, color: C.p2 });
          D.text(ctx, `${who('bottom')} ${players.bottom.score}`, 14, H / 2 + 92, { size: 16, color: C.p1, pixel: true });
          D.text(ctx, lives(players.bottom.lives), 14, H / 2 + 70, { size: 14, color: C.p1 });
          D.text(ctx, `LV ${level}`, W - 14, H / 2 - 82, { size: 16, color: C.muted, pixel: true, align: 'right' });
        },
        _state: () => ({ level, bottom: players.bottom.lives, top: players.top.lives })
      };

      function speedUp() {
        for (const b of balls) {
          if (b.stuck) continue;
          const sp = Math.hypot(b.vx, b.vy) || 1;
          b.vx *= ballSpeed() / sp; b.vy *= ballSpeed() / sp;
        }
      }
    }
  });
})();
