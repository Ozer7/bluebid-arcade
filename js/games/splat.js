/* ==========================================================================
   SPLAT — a flappy flier against a column builder.
   The flier taps to flap through the gaps. The builder decides where every
   gap goes. Flier wins after 30 columns. Builder wins on a splat.

   Fairness rule (same for human and computer builders): each gap can move
   at most MAX_DELTA pixels from the previous one, so every layout is always
   flyable. The computer flier only sees columns already on screen, uses the
   same physics and collisions as a human, and must press "flap" to rise.
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600, GROUND = 560;
  const BIRD_X = 220, BIRD_R = 13;
  const GRAVITY = 1500, FLAP_V = -430;
  const COL_W = 70, SPACING = 280, CAP = 5;   // CAP = the lip on each pipe end (part of the hitbox)
  const TARGET = 30;

  Arcade.register({
    id: 'splat',
    title: 'Splat',
    tagline: 'A flappy flier against the builder who lays out the columns.',
    flip: 'you lay out the columns, the computer flies.',
    blurb: 'The flier needs to clear 30 columns. The builder wins on a splat. Each gap can only move so far from the one before it, so every layout can be flown. Every 5 columns, the gaps shrink and the scroll speeds up.',
    menuText: 'The flier wins after <b>30 columns</b>. The builder wins on a <b>splat</b>. Gaps can only move so far each column, so every run is flyable.',
    sides: [
      { key: 'flier', label: 'Flier', human: 'Space, ↑, W or click to flap.', cpu: 'Only sees columns already on screen. Before each flap it simulates both choices a second ahead using the real physics. It makes timing slips early on and tightens up later.' },
      { key: 'builder', label: 'Builder', human: 'Move the mouse up and down (or use ↑ / ↓) to set the gap of the column coming in on the right. It locks when it scrolls in.', cpu: 'Starts with gentle random gaps, then pulls each gap as far from the flier as the rules allow.' }
    ],
    defaults: { flier: 'cpu', builder: 'human' },

    thumb(ctx, w, h) {
      const s = w / W;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0d1633'); g.addColorStop(1, '#070b17');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      [[320, 250], [600, 380]].forEach(([x, gy]) => {
        ctx.fillStyle = C.good;
        ctx.fillRect(x * s, 0, COL_W * s, (gy - 90) * s);
        ctx.fillRect(x * s, (gy + 90) * s, COL_W * s, h);
      });
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(BIRD_X * s, 290 * s, 14, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(BIRD_X * s + 5, 286 * s, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#1b2a4d'; ctx.fillRect(0, GROUND * s, w, h);
    },

    create(api) {
      let passed = 0;
      const level = () => 1 + Math.floor(passed / 5);
      const speed = () => 160 + (level() - 1) * 10;
      const gapH = () => Math.max(145, 195 - (level() - 1) * 9);
      const maxDelta = () => Math.min(210, 130 + (level() - 1) * 15);
      const gapMin = () => gapH() / 2 + 30;
      const gapMax = () => GROUND - gapH() / 2 - 30;

      const bird = { y: 280, vy: 0, alive: true, rot: 0 };
      const cols = [];            // {x, gap, h, passed}
      let lastGap = 290;
      let pendingGap = 290;       // what the builder is setting for the next column
      let untilSpawn = 0.8;       // seconds until the next column scrolls in
      let splat = null;
      let particles = [];
      let started = false;
      let startT = 1.0;           // short grace period before gravity kicks in

      const clampGap = g => U.clamp(g, Math.max(gapMin(), lastGap - maxDelta()), Math.min(gapMax(), lastGap + maxDelta()));

      /* ---------- computer builder (plays like a person with a mouse) ---------- */
      // It picks where the next gap should go a moment after the last one locks,
      // then drags its cursor there — you can watch the preview column move.
      // Early on it builds gentle, readable gaps; later it mixes in zig-zags,
      // staircases and the occasional mean switch away from the bird.
      const builder = new Arcade.Human({ reaction: 0.3 });
      let buildTarget = 290, buildDecideIn = 0.6, buildPlan = { kind: 'gentle', dir: 1, left: 0 };
      const meanness = () => Math.min(0.45, 0.06 + passed * 0.016);
      function cpuChooseGap() {
        const lo = Math.max(gapMin(), lastGap - maxDelta()), hi = Math.min(gapMax(), lastGap + maxDelta());
        if (buildPlan.left <= 0) {
          const r = Math.random(), m = meanness();
          buildPlan = r < m * 0.4 ? { kind: 'zigzag', dir: U.pick([-1, 1]), left: U.randInt(2, 4) }
            : r < m * 0.7 ? { kind: 'stairs', dir: U.pick([-1, 1]), left: U.randInt(2, 3) }
            : r < m ? { kind: 'switch', left: 1 }
            : { kind: 'gentle', left: U.randInt(1, 3) };
        }
        buildPlan.left--;
        const reach = (hi - lo) / 2, mid = (lo + hi) / 2;
        let g;
        if (buildPlan.kind === 'zigzag') { buildPlan.dir *= -1; g = mid + buildPlan.dir * reach * U.rand(0.6, 0.95); }
        else if (buildPlan.kind === 'stairs') g = lastGap + buildPlan.dir * maxDelta() * U.rand(0.45, 0.8);
        else if (buildPlan.kind === 'switch') g = bird.y < mid ? hi - U.rand(0, 20) : lo + U.rand(0, 20);
        else g = lastGap + U.rand(-0.45, 0.45) * maxDelta();
        return U.clamp(g, lo, hi);
      }
      function cpuBuilderMove(dt) {
        buildDecideIn -= dt;
        if (buildDecideIn <= 0 && buildDecideIn > -1) { buildTarget = cpuChooseGap(); buildDecideIn = -9; }
        // a hand on a mouse: fast at first, slowing as it arrives, never perfectly still
        const diff = buildTarget - pendingGap;
        pendingGap = clampGap(pendingGap + U.clamp(diff * 8 * dt, -900 * dt, 900 * dt) + U.gauss() * 0.6);
      }

      function spawn() {
        const g = clampGap(pendingGap);
        cols.push({ x: W + 4, gap: g, h: gapH(), passed: false });
        lastGap = g;
        pendingGap = clampGap(pendingGap);
        if (!api.isHuman('builder')) buildDecideIn = builder.react(true) + U.rand(0.1, 0.5);
      }

      /* ---------- collisions (shared by the real game and the AI's look-ahead) ---------- */
      // Proper circle-vs-rectangle test against each pipe (the lip is part of the pipe).
      // `pad` makes the bird a little fatter — the computer uses it to keep a safety margin.
      function collides(y, colList, dx, pad = 0) {
        const R = BIRD_R + pad;
        if (y - R < 0 || y + R > GROUND) return true;
        const r2 = R * R;
        for (const c of colList) {
          const x0 = c.x - dx - CAP, x1 = c.x - dx + COL_W + CAP;
          if (BIRD_X + R < x0 || BIRD_X - R > x1) continue;
          const nx = U.clamp(BIRD_X, x0, x1);
          const top = c.gap - c.h / 2, bot = c.gap + c.h / 2;
          const ty = Math.min(y, top), by = Math.max(y, bot);   // nearest point on each pipe
          if ((BIRD_X - nx) ** 2 + (y - ty) ** 2 < r2) return true;
          if ((BIRD_X - nx) ** 2 + (y - by) ** 2 < r2) return true;
        }
        return false;
      }

      /* ---------- computer flier (plays like a person) ---------- */
      // How people actually fly: they watch the next gap, and tap whenever the
      // bird sinks below a comfortable height inside it. What they see is a
      // little behind reality, and the tap lands a reaction-time later. Calm
      // players tap in a steady rhythm; when the next gap is far above they tap
      // frantically and overshoot, and when it's far below they let the bird
      // fall too long and clip the bottom pipe. Their eyes only jump to the next
      // gap once they're through the current one.
      const flierSkill = () => U.clamp(0.5 + passed * 0.016, 0.5, 0.92);   // warming up
      const person = new Arcade.Human({ reaction: 0.24, lapseRate: 0.02 });
      const seen = new Arcade.Lag(1);
      const flier = { taps: [], lastTap: -1, target: 290, targetFor: null, switchAt: 0, comfort: 22 };

      function watchedPipe() {
        // the pipe the player is looking at: the current one until the bird's tail clears it
        for (const c of cols) if (c.x + COL_W + CAP > BIRD_X - BIRD_R) return c;
        return null;
      }

      function cpuFly() {
        const now = api.time, s = flierSkill();
        seen.push(now, { y: bird.y, vy: bird.vy });
        // eyes move to a new gap, and it takes a moment to "lock on"
        const p = watchedPipe();
        if (p && p !== flier.targetFor) {
          flier.targetFor = p;
          flier.switchAt = now + person.react() * 0.8;
          flier.comfort = gapH() * 0.13 + person.scatter((1 - s) * gapH() * 0.07);   // how low they let it sink this time
        }
        if (p && now >= flier.switchAt) flier.target += (p.gap - flier.target) * 0.25;   // the eyes settle on the gap
        const far = p ? p.gap - bird.y : 0;
        person.pressure = U.clamp(Math.abs(far) / 320 + (1 - s) * 0.2, 0, 1);

        // decide on what was seen a moment ago
        const view = seen.at(now - 0.09) || { y: bird.y, vy: bird.vy };
        const tapLine = flier.target + flier.comfort;
        const franticGap = far < -110 ? 0.13 : 0.2;                      // panic-tapping when the gap is way above
        // players read the bird's fall and tap a bit early when it's dropping fast — imperfectly
        // (rhythmic taps are timed from practice, so the see-then-tap delay is mostly
        //  compensated — what's left is timing scatter, bigger for a nervous player)
        const lookAhead = U.lerp(0.15, 0.18, s) * U.clamp(1 + person.scatter(U.lerp(0.18, 0.08, s)), 0.7, 1.3);
        const expected = view.y + view.vy * lookAhead + 0.5 * GRAVITY * lookAhead * lookAhead;
        if (expected > tapLine && view.vy > -80 && now - flier.lastTap > franticGap && !person.lapsed(1 / 60)) {
          // the finger lands a motor-delay later, with timing scatter
          const delay = U.clamp(0.07 + person.scatter(U.lerp(0.04, 0.018, s)), 0.02, 0.2);
          flier.taps.push(now + delay);
          flier.lastTap = now;
        }
        // execute taps that have "landed"
        let tap = false;
        while (flier.taps.length && flier.taps[0] <= now) { flier.taps.shift(); tap = true; }
        return tap;
      }

      /* ---------- game actions ---------- */
      function flap() {
        if (!bird.alive) return;
        started = true;
        bird.vy = FLAP_V;
      }

      // Hitting a pipe knocks the bird out: it flashes, tumbles and drops to the
      // ground, and only then goes SPLAT. Hitting the ground is an instant splat.
      let fall = null;   // {t, landed}
      let shake = 0, scrollT = 0;
      function knockOut() {
        bird.alive = false;
        const onGround = bird.y + BIRD_R >= GROUND - 1;
        fall = { t: 0, landed: false, spin: 0 };
        bird.vy = onGround ? 0 : Math.min(bird.vy, 0) * 0.3 - 140;     // a little knock-back pop
        if (onGround) land();
      }
      function land() {
        fall.landed = true;
        bird.y = GROUND - BIRD_R + 4;
        splat = { t: 0 };
        shake = 0.35;
        for (let i = 0; i < 30; i++) {
          const a = U.rand(Math.PI, Math.PI * 2), sp = U.rand(80, 360);
          particles.push({ x: BIRD_X, y: GROUND - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: U.rand(0.5, 1.2), feather: Math.random() < 0.4 });
        }
        api.end('builder', `SPLAT after ${passed} column${passed === 1 ? '' : 's'}.`, 1200);
      }

      return {
        update(dt) {
          for (const p of particles) { p.vy += (p.feather ? 250 : 900) * dt; p.x += p.vx * dt * (p.feather ? 0.6 : 1); p.y += p.vy * dt; p.t -= dt; }
          particles = particles.filter(p => p.t > 0);
          if (shake > 0) shake -= dt;
          if (splat) splat.t += dt;
          if (fall) {
            fall.t += dt;
            if (!fall.landed) {
              bird.vy += GRAVITY * dt;
              bird.y += bird.vy * dt;
              bird.rot = Math.min(1.6, bird.rot + dt * 6);             // nose-dives
              if (bird.y + BIRD_R >= GROUND) land();
            }
            return;
          }
          if (passed >= TARGET) return;
          scrollT += dt;
          if (!api.isHuman('builder')) cpuBuilderMove(dt);

          // builder keyboard control: ↑ / ↓ move the pending gap
          if (api.isHuman('builder')) {
            const kd = (api.keys.has('ArrowDown') ? 1 : 0) - (api.keys.has('ArrowUp') ? 1 : 0);
            if (kd) pendingGap = clampGap(pendingGap + kd * 260 * dt);
          }

          // columns move
          const v = speed();
          for (const c of cols) c.x -= v * dt;
          while (cols.length && cols[0].x < -COL_W - 10) cols.shift();
          untilSpawn -= dt;
          if (untilSpawn <= 0) { spawn(); untilSpawn += SPACING / v; }

          // flier
          if (!api.isHuman('flier')) { if (cpuFly()) flap(); started = true; }
          startT -= dt;
          if (started || startT <= 0) {
            bird.vy += GRAVITY * dt;
            bird.y += bird.vy * dt;
          }
          bird.rot = U.clamp(bird.vy / 700, -0.5, 1.1);
          if (collides(bird.y, cols, 0)) return knockOut();

          for (const c of cols) {
            if (!c.passed && c.x + COL_W + CAP < BIRD_X - BIRD_R) {
              c.passed = true;
              passed++;
              if (passed >= TARGET) return api.end('flier', `Cleared all ${TARGET} columns.`);
              if (passed % 5 === 0) api.toast(`Level ${level()} — tighter gaps`, C.warn);
            }
          }
        },

        onKey(code) {
          if (api.isHuman('flier') && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) {
            // if both sides are human, the builder keeps ↑/↓ and the flier keeps Space/W
            if (api.isHuman('builder') && code === 'ArrowUp') return;
            flap();
          }
        },
        onPointer(type, x, y) {
          if (api.isHuman('builder') && (type === 'move' || type === 'down')) {
            pendingGap = clampGap(y);
          }
          if (type === 'down' && api.isHuman('flier') && !api.isHuman('builder')) flap();
        },

        draw(ctx) {
          ctx.save();
          if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake / 0.35, (Math.random() - 0.5) * 8 * shake / 0.35);
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#0d1633'); g.addColorStop(1, '#070b17');
          ctx.fillStyle = g; ctx.fillRect(-10, -10, W + 20, H + 20);
          // distant skyline for depth
          ctx.fillStyle = '#0f1a36';
          for (let i = 0; i < 12; i++) {
            const bx = ((i * 97 - scrollT * 20) % 900 + 900) % 900 - 50;
            ctx.fillRect(bx, GROUND - 60 - (i * 37) % 90, 60, 200);
          }

          for (const c of cols) drawColumn(ctx, c.x, c.gap, c.h, 1);

          // the builder's pending column (preview at the right edge) — shown for the
          // computer builder too, so you can watch it "drag" the next gap into place
          if (!fall) {
            const pg = clampGap(pendingGap);
            ctx.globalAlpha = 0.45;
            drawColumn(ctx, W - COL_W - 6, pg, gapH(), 0);
            ctx.globalAlpha = 1;
            // allowed band
            const lo = Math.max(gapMin(), lastGap - maxDelta()), hi = Math.min(gapMax(), lastGap + maxDelta());
            ctx.fillStyle = 'rgba(79,124,255,.5)';
            ctx.fillRect(W - 4, lo, 4, hi - lo);
            D.text(ctx, `next gap ${Math.max(0, untilSpawn).toFixed(1)}s`, W - COL_W / 2 - 6, pg, { size: 11, color: '#fff', align: 'center' });
          }

          // ground
          ctx.fillStyle = '#1b2a4d'; ctx.fillRect(0, GROUND, W, H - GROUND);
          ctx.fillStyle = '#26324f';
          for (let x = -((scrollT * speed()) % 40); x < W; x += 40) ctx.fillRect(x, GROUND + 8, 22, 4);

          // bird (flashes and gets dizzy X-eyes when knocked out)
          if (!(splat && splat.t > 0)) {
            ctx.save();
            ctx.translate(BIRD_X, bird.y);
            ctx.rotate(bird.rot);
            const flashOn = fall && fall.t < 0.25 && Math.floor(fall.t * 20) % 2 === 0;
            ctx.fillStyle = flashOn ? '#ffffff' : '#ffd24a';
            ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f0a83c';
            ctx.beginPath(); ctx.ellipse(-4, 3, 7, 4, 0.4 + Math.sin(api.time * 20) * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -4, 4.5, 0, 7); ctx.fill();
            if (fall) {
              ctx.strokeStyle = '#111'; ctx.lineWidth = 1.8;
              ctx.beginPath(); ctx.moveTo(3, -6.5); ctx.lineTo(8, -1.5); ctx.moveTo(8, -6.5); ctx.lineTo(3, -1.5); ctx.stroke();
            } else { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6.5, -4, 2.2, 0, 7); ctx.fill(); }
            ctx.fillStyle = '#f25c69'; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(19, 3); ctx.lineTo(11, 6); ctx.fill();
            ctx.restore();
          }
          // a flattened bird on the ground
          if (splat) {
            ctx.fillStyle = '#ffd24a';
            ctx.beginPath(); ctx.ellipse(BIRD_X, GROUND - 3, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f25c69'; ctx.fillRect(BIRD_X + 18, GROUND - 5, 8, 3);
          }
          for (const p of particles) {
            ctx.globalAlpha = Math.min(1, p.t * 2);
            ctx.fillStyle = p.feather ? '#f0a83c' : '#ffd24a';
            if (p.feather) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 6); ctx.fillRect(-5, -1.5, 10, 3); ctx.restore(); }
            else { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 7); ctx.fill(); }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
          if (splat) D.text(ctx, 'SPLAT!', W / 2, H / 2 - 40, { size: 56, pixel: true, color: C.bad, align: 'center', glow: C.bad });
          else if (fall) D.text(ctx, 'BONK!', BIRD_X + 40, bird.y - 30, { size: 22, pixel: true, color: C.warn, align: 'left' });

          if (api.isHuman('flier') && !started && bird.alive)
            D.text(ctx, 'Space / click to flap', BIRD_X, bird.y - 40, { size: 13, color: C.muted, align: 'center' });

          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          D.hud(ctx, [
            { text: `FLIER · ${who('flier')}`, color: '#ffd24a', pixel: true },
            { text: `${passed}/${TARGET}   LV ${level()}`, align: 'center', pixel: true },
            { text: `${who('builder')} · BUILDER`, color: C.good, align: 'right', pixel: true }
          ]);
        },
        _state: () => ({ passed, alive: bird.alive, y: bird.y, vy: bird.vy, cols: cols.map(c => [Math.round(c.x), Math.round(c.gap), c.h]) })
      };

      function drawColumn(ctx, x, gap, h, solid) {
        const top = gap - h / 2, bot = gap + h / 2;
        const grad = ctx.createLinearGradient(x, 0, x + COL_W, 0);
        grad.addColorStop(0, '#1f9a5a'); grad.addColorStop(0.5, '#3fdc8a'); grad.addColorStop(1, '#1a7d4a');
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, COL_W, top);
        ctx.fillRect(x, bot, COL_W, GROUND - bot);
        ctx.fillStyle = solid ? '#2fbf71' : '#4f7cff';
        ctx.fillRect(x - CAP, top - 18, COL_W + CAP * 2, 18);
        ctx.fillRect(x - CAP, bot, COL_W + CAP * 2, 18);
      }
    }
  });
})();
