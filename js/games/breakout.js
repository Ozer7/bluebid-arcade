/* ==========================================================================
   BREAKOUT — head to head, in the style of Atari's 1976 original.
   The original: 8 rows of bricks (yellow 1, green 3, orange 5, red 7 points),
   a black-and-white screen under coloured cellophane strips, and a ball that
   speeds up after 4 hits, after 12 hits, and on first touching the orange
   and red rows. Here two paddles share one wall: the wall is mirrored so each
   player meets the cheap yellow bricks first and the red ones sit in the
   middle. Get your ball past the other paddle to take one of their 5 balls.
   ========================================================================== */
(function () {
  'use strict';
  const { util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const PW = 96, PH = 10;                    // paddle size
  const BOTTOM_Y = H - 36, TOP_Y = 36;       // paddle centre lines
  const BALL_R = 5;                          // the ball is a small square
  const PADDLE_MAX_SPEED = 820;              // px/s — same cap for mouse, keys and computer
  const LIVES = 5;
  const BR_COLS = 14, BR_ROWS = 8, BR_W = W / BR_COLS, BR_H = 16;
  const BR_TOP = H / 2 - (BR_ROWS * BR_H) / 2;
  // mirrored wall: yellow nearest each player, red in the middle
  const ROWS = ['yellow', 'green', 'orange', 'red', 'red', 'orange', 'green', 'yellow'];
  const POINTS = { yellow: 1, green: 3, orange: 5, red: 7 };
  const OVERLAY = { yellow: '#f7d84a', green: '#46d66c', orange: '#ff8f2a', red: '#ff3f33', blue: '#4a8dff' };
  const PITCH = { yellow: 880, green: 988, orange: 1175, red: 1397 };

  Arcade.register({
    id: 'breakout',
    title: 'Breakout',
    year: '1976 · Atari',
    history: 'Designed by Nolan Bushnell and Steve Bristow, with a prototype by Steve Wozniak. The monitor was black and white; the colours came from strips of cellophane stuck over the screen.',
    tagline: 'Two paddles, one wall. Break through and get your ball past the other side.',
    flip: 'the computer plays against you, head to head.',
    blurb: 'Each player has 5 balls. Bricks score 1/3/5/7 points by colour; getting your ball past the other paddle costs them a ball.',
    menuText: 'Each side has <b>5 balls</b>. Bricks score <b>1 / 3 / 5 / 7</b>. The ball speeds up after 4 hits, 12 hits, and when it first reaches orange and red, just like 1976.',
    scoreSide: 'bottom', scoreName: 'points',
    sides: [
      { key: 'bottom', label: 'Player 1 (bottom)', human: 'Mouse, or ← →. Click or Space to serve.', cpu: 'Glances at the ball, guesses where it will land (straight line, one wall bounce), sharpens the guess in the last third of a second, and moves like a hand on a mouse. Brick bounces catch it a reaction-time late.' },
      { key: 'top', label: 'Player 2 (top)', human: 'Mouse, or A / D (← → too if you\'re the only human). Click or Space to serve.', cpu: 'Same human-like paddle as player 1.' }
    ],
    defaults: { bottom: 'human', top: 'cpu' },

    thumb(ctx, w, h) {
      const s = w / W;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      for (let r = 0; r < BR_ROWS; r++) for (let c = 0; c < BR_COLS; c++) {
        if ((r * 7 + c * 3) % 11 === 0) continue;
        ctx.fillStyle = OVERLAY[ROWS[r]];
        ctx.fillRect(c * BR_W * s + 1, (BR_TOP + r * BR_H) * s + 1, BR_W * s - 2, BR_H * s - 2);
      }
      ctx.fillStyle = OVERLAY.blue;
      ctx.fillRect(150 * s, (BOTTOM_Y - 5) * s, PW * s, PH * s);
      ctx.fillRect(520 * s, (TOP_Y - 5) * s, PW * s, PH * s);
      ctx.fillStyle = '#fff'; ctx.fillRect(260 * s, 430 * s, 10 * s, 10 * s);
    },

    create(api) {
      let level = 1;                 // which wall (a new one appears when one is cleared)
      let levelTimer = 0;
      // 1976 rules: speed steps after 4 hits, after 12 hits, and on first contact with
      // the orange and red rows; plus a small step for each new wall and each long rally
      let hits = 0, tier = 0, sawOrange = false, sawRed = false, rallyT = 0;
      const ballSpeed = () => 270 + tier * 30 + (level - 1) * 25;
      let flashT = 0, frameNo = 0;

      const players = {
        bottom: { key: 'bottom', y: BOTTOM_Y, x: W / 2, vx: 0, lives: LIVES, score: 0, dirToOpp: -1, target: W / 2, think: 0 },
        top: { key: 'top', y: TOP_Y, x: W / 2, vx: 0, lives: LIVES, score: 0, dirToOpp: 1, target: W / 2, think: 0 }
      };
      const other = k => (k === 'bottom' ? players.top : players.bottom);

      let bricks = [];
      function buildWall() {
        bricks = [];
        for (let r = 0; r < BR_ROWS; r++) for (let c = 0; c < BR_COLS; c++)
          bricks.push({ x: c * BR_W + 1, y: BR_TOP + r * BR_H + 1, w: BR_W - 2, h: BR_H - 2, row: r, color: ROWS[r], alive: true });
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
        api.sfx('paddle');
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

      /* ---------- computer paddle (plays like a person) ---------- */
      // People don't simulate bounces. They glance at the ball every fraction of
      // a second (gaze runs ~150 ms ahead of the ball, and falls behind for ~200 ms
      // after each bounce), guess where it will come down (straight line, maybe one wall
      // bounce), and refine that guess as it gets closer — so the paddle starts
      // roughly right and makes a late correction. A bounce off a brick is only
      // noticed a reaction-time later. The hand moves like a hand on a mouse:
      // accelerates, overshoots a little, settles, never perfectly still.
      const skill = () => U.clamp(0.35 + (level - 1) * 0.08 + levelTimer / 300, 0.35, 0.8);
      for (const k in players) Object.assign(players[k], { person: new Arcade.Human({ reaction: 0.23 }), look: 0, pv: 0, ballDir: {} });

      // the naive human guess: straight line, reflected off the side walls at most once
      function guessX(b, lineY) {
        const t = (lineY - b.y) / b.vy;
        if (t <= 0) return null;
        let x = b.x + b.vx * t;
        if (x < BALL_R) x = 2 * BALL_R - x;
        else if (x > W - BALL_R) x = 2 * (W - BALL_R) - x;
        return { x: U.clamp(x, BALL_R, W - BALL_R), t };
      }

      function cpuThink(p, dt) {
        const s = skill();
        const lineY = p.key === 'bottom' ? p.y - PH / 2 - BALL_R : p.y + PH / 2 + BALL_R;
        // notice direction changes (brick bounces) only after a reaction time
        for (const b of balls) {
          const d = Math.sign(b.vy);
          const seen = p.ballDir[balls.indexOf(b)];
          if (seen && seen.d !== d && !seen.pending) { seen.pending = api.time + p.person.react(); }
          if (!seen) p.ballDir[balls.indexOf(b)] = { d };
          else if (seen.pending && api.time >= seen.pending) { seen.d = d; seen.pending = 0; p.look = 0; }
        }
        p.look -= dt;
        if (p.look > 0) return;
        p.look = U.rand(0.12, 0.28);                    // how often they re-read the ball
        let best = null;
        balls.forEach((b, i) => {
          if (b.stuck) return;
          const believedDown = p.ballDir[i] ? p.ballDir[i].d : Math.sign(b.vy);
          const coming = p.key === 'bottom' ? believedDown > 0 : believedDown < 0;
          if (!coming || Math.sign(b.vy) !== believedDown) return;
          const g = guessX(b, lineY);
          if (g && (!best || g.t < best.t)) best = g;
        });
        if (best) {
          // eye-tracking studies of Breakout: players look ~150 ms ahead of the ball and
          // their gaze is closest to the paddle ~300 ms before impact — so the last
          // moments get quick, precise corrections
          if (best.t < 0.35) p.look = Math.min(p.look, U.rand(0.06, 0.1));
          // the further away the ball, the rougher the guess
          const sd = (8 + best.t * 55) * U.lerp(1.1, 0.5, s);
          let target = best.x + p.person.scatter(sd);
          // good players sometimes angle the ball on purpose
          if (U.chance(s * 0.35)) target += U.pick([-1, 1]) * PW * U.rand(0.15, 0.35);
          p.target = U.clamp(target, PW / 2, W - PW / 2);
        } else {
          // nothing coming: drift with the ball loosely, like following it with your eyes
          // (follow the ball that will come back to you soonest)
          let next = null, soonest = Infinity;
          for (const b of balls) {
            if (b.stuck || !b.vy) continue;
            const farY = b.vy > 0 ? H : 0;
            const tBack = Math.abs(farY - b.y) / Math.abs(b.vy) + Math.abs(farY - p.y) / Math.abs(b.vy);
            if (tBack < soonest) { soonest = tBack; next = b; }
          }
          p.target = U.clamp(next ? U.lerp(W / 2, next.x, 0.5) : W / 2, PW / 2, W - PW / 2);
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
          // hand dynamics: a springy pull toward the target with slight overshoot and tremor
          const acc = (p.target - p.x) * 90 - p.pv * 14;
          p.pv = U.clamp(p.pv + acc * dt, -PADDLE_MAX_SPEED, PADDLE_MAX_SPEED);
          desired = p.x + p.pv * dt + U.gauss() * 0.4;
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
        api.sfx('paddle');
      }

      // If the ball overlaps more than one brick, hit the one it reached first
      // (nearest to where it came from) — otherwise a ball from one side would
      // tunnel a row deeper than a ball from the other.
      function hitBricks(b) {
        let hit = null, best = Infinity;
        const px = b.x - b.vx * 0.01, py = b.y - b.vy * 0.01;
        for (const br of bricks) {
          if (!br.alive) continue;
          const cx = U.clamp(b.x, br.x, br.x + br.w), cy = U.clamp(b.y, br.y, br.y + br.h);
          const dx = b.x - cx, dy = b.y - cy;
          if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
          const d = Math.hypot(br.x + br.w / 2 - px, br.y + br.h / 2 - py);
          if (d < best) { best = d; hit = br; }
        }
        if (!hit) return;
        const br = hit;
        br.alive = false;
        players[b.owner].score += POINTS[br.color];
        api.sfx('brick', { f: PITCH[br.color] });
        // the 1976 speed-ups
        hits++;
        const before = tier;
        if (hits === 4 || hits === 12) tier++;
        if (br.color === 'orange' && !sawOrange) { sawOrange = true; tier++; }
        if (br.color === 'red' && !sawRed) { sawRed = true; tier++; }
        if (tier !== before) speedUp();
        // bounce along the axis of least penetration
        const ox = Math.min(Math.abs(b.x + BALL_R - br.x), Math.abs(br.x + br.w - (b.x - BALL_R)));
        const oy = Math.min(Math.abs(b.y + BALL_R - br.y), Math.abs(br.y + br.h - (b.y - BALL_R)));
        if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
      }

      function loseBall(b, loserKey) {
        const loser = players[loserKey];
        loser.lives--;
        flashT = 0.25;
        api.sfx('lose');
        api.toast(`${loserKey === 'bottom' ? 'Player 1' : 'Player 2'} loses a ball`);
        if (loser.lives <= 0) {
          const win = other(loserKey).key;
          api.end(win, `Final score ${players.bottom.score} – ${players.top.score}.`);
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
          if (flashT > 0) flashT -= dt;
          // a long rally speeds things up a notch, so games don't stall
          rallyT += dt;
          if (rallyT > 35) { rallyT = 0; tier++; speedUp(); api.toast('Faster!'); }

          for (const k of (frameNo % 2 ? ['bottom', 'top'] : ['top', 'bottom'])) movePaddle(players[k], dt);

          // alternate which ball moves first each frame, so neither side gets an edge
          frameNo++;
          for (const b of (frameNo % 2 ? balls : [...balls].reverse())) {
            if (b.stuck) {
              stickTo(b);
              b.serveT -= dt;
              // computer serves quickly; humans get 3 seconds before an automatic serve
              const limit = api.isHuman(b.server) ? -2 : -U.rand(0.1, 0.9);
              if (b.serveT < limit) serve(b);
              continue;
            }
            // sub-step so fast balls cannot tunnel through paddles or bricks
            const steps = 3;
            for (let i = 0; i < steps; i++) {
              b.x += (b.vx * dt) / steps;
              b.y += (b.vy * dt) / steps;
              if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); api.sfx('wall'); }
              if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); api.sfx('wall'); }
              if (frameNo % 2) { paddleHit(b, players.bottom); paddleHit(b, players.top); }
              else { paddleHit(b, players.top); paddleHit(b, players.bottom); }
              hitBricks(b);
              // stop nearly-horizontal balls from getting stuck bouncing forever
              if (Math.abs(b.vy) < ballSpeed() * 0.3) b.vy = (b.vy ? Math.sign(b.vy) : (b.owner === 'bottom' ? -1 : 1)) * ballSpeed() * 0.3;
            }
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 8) b.trail.shift();
            if (b.y > H + BALL_R) loseBall(b, 'bottom');
            else if (b.y < -BALL_R) loseBall(b, 'top');
          }

          if (bricks.every(br => !br.alive)) {
            buildWall();
            level++; levelTimer = 0; hits = 0; sawOrange = sawRed = false;
            api.toast(`Wall cleared! Wall ${level}`);
            api.sfx('coin');
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

        // 1976 look: everything is drawn white on black, then coloured
        // "cellophane" strips are multiplied over the screen — so the ball turns
        // yellow, green, orange and red as it flies through the bands, and blue
        // down by the paddles
        draw(ctx) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#fff';
          for (const br of bricks) if (br.alive) ctx.fillRect(br.x, br.y, br.w, br.h);
          for (const k in players) { const p = players[k]; ctx.fillRect(p.x - PW / 2, p.y - PH / 2, PW, PH); }
          for (const b of balls) ctx.fillRect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 2);
          // side walls
          ctx.fillRect(0, 0, 4, H); ctx.fillRect(W - 4, 0, 4, H);

          // score + balls left: chunky white numerals, like the original's score digits
          const who = k => (api.isHuman(k) ? '1UP' : 'CPU');
          D.text(ctx, String(players.top.score).padStart(3, '0'), 18, H / 2 - 104, { size: 26, pixel: true, color: '#fff' });
          D.text(ctx, `${who('top')}  BALL ${Math.max(1, LIVES - players.top.lives + 1)}`, 18, H / 2 - 78, { size: 10, pixel: true, color: '#fff' });
          D.text(ctx, String(players.bottom.score).padStart(3, '0'), 18, H / 2 + 104, { size: 26, pixel: true, color: '#fff' });
          D.text(ctx, `${api.isHuman('bottom') ? '1UP' : 'CPU'}  BALL ${Math.max(1, LIVES - players.bottom.lives + 1)}`, 18, H / 2 + 78, { size: 10, pixel: true, color: '#fff' });
          D.text(ctx, `WALL ${level}`, W - 18, H / 2 - 104, { size: 10, pixel: true, color: '#fff', align: 'right' });
          for (const b of balls) if (b.stuck && api.isHuman(b.server) && b.serveT < 1.0 && Math.floor(api.time * 2) % 2)
            D.text(ctx, 'SERVE', players[b.server].x, b.server === 'bottom' ? BOTTOM_Y - 30 : TOP_Y + 30, { size: 10, pixel: true, color: '#fff', align: 'center' });

          // the cellophane overlay
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ROWS.forEach((c, r) => { ctx.fillStyle = OVERLAY[c]; ctx.fillRect(0, BR_TOP + r * BR_H, W, BR_H); });
          ctx.fillStyle = OVERLAY.blue;
          ctx.fillRect(0, BOTTOM_Y - 26, W, 50);
          ctx.fillRect(0, TOP_Y - 24, W, 50);
          ctx.restore();
          if (flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${flashT * 0.5})`; ctx.fillRect(0, 0, W, H); }
        },
        score: () => players.bottom.score,
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
