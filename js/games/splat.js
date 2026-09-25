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
      const speed = () => 165 + (level() - 1) * 14;
      const gapH = () => Math.max(122, 190 - (level() - 1) * 12);
      const maxDelta = () => Math.min(250, 140 + (level() - 1) * 20);
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

      /* ---------- computer builder ---------- */
      const builderSkill = () => Math.min(0.6, 0.1 + passed * 0.02);
      function cpuBuild() {
        const lo = Math.max(gapMin(), lastGap - maxDelta()), hi = Math.min(gapMax(), lastGap + maxDelta());
        if (U.chance(builderSkill())) {
          // hard: as far as possible from where the flier is now
          return bird.y < (lo + hi) / 2 ? hi - U.rand(0, 15) : lo + U.rand(0, 15);
        }
        const mid = (lo + hi) / 2, span = (hi - lo) * 0.35;
        return U.clamp(mid + U.rand(-span, span), lo, hi);
      }

      function spawn() {
        const g = api.isHuman('builder') ? clampGap(pendingGap) : cpuBuild();
        cols.push({ x: W + 4, gap: g, h: gapH(), passed: false });
        lastGap = g;
        pendingGap = clampGap(pendingGap);
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

      /* ---------- computer flier ---------- */
      const flierSkill = () => U.clamp(0.22 + passed * 0.016, 0.22, 0.7);
      let decideIn = 0;
      let aimNoise = 0, aimFor = null;

      // aim point: the centre of the next gap we haven't cleared yet
      function aimAt(colList, dx) {
        for (const c of colList) if (c.x - dx + COL_W + CAP > BIRD_X - BIRD_R) return c.gap;
        return lastGap;
      }

      // Roll the physics forward. `first` = flap on the first frame?
      // After that, follow a simple "flap if below the aim point and falling" rule.
      // `wait` = how long until the flier can next react (its own reaction time),
      // so the look-ahead never assumes a flap it couldn't actually make in time.
      function rollout(first, wait) {
        const dt = 1 / 60;
        let y = bird.y, vy = first ? FLAP_V : bird.vy, cool = first ? Math.max(0.18, wait) : wait;
        const v = speed();
        let err = 0;
        const pad = U.lerp(-4, 3, flierSkill());   // a sloppy flier cuts corners
        for (let i = 1; i <= 60; i++) {
          vy += GRAVITY * dt; y += vy * dt;
          cool -= dt;
          const dx = v * dt * (i - 1);          // the columns already moved this frame
          if (collides(y, cols, dx, pad)) return { crash: i, err: Infinity };
          // a flap rises ~60px, so flapping ~28px below the centre keeps the bird centred
          const centre = aimAt(cols, dx) + aimNoise;
          err += Math.abs(y - centre);
          if (cool <= 0 && y > centre + 28 && vy > -50) { vy = FLAP_V; cool = 0.18; }
        }
        return { crash: 0, err };
      }

      function cpuFly(dt) {
        const s = flierSkill();
        // resample aim error once per column
        const next = cols.find(c => c.x + COL_W + CAP > BIRD_X - BIRD_R);
        if (next !== aimFor) { aimFor = next; aimNoise = U.gauss() * (1 - s) * gapH() * 0.3; }
        decideIn -= dt;
        if (decideIn > 0) return false;
        decideIn = U.lerp(0.13, 0.02, s) + U.rand(0, (1 - s) * 0.08);   // reaction time
        const a = rollout(true, decideIn), b = rollout(false, decideIn);
        let flap;
        if (a.crash && b.crash) flap = a.crash > b.crash;
        else if (a.crash) flap = false;
        else if (b.crash) flap = true;
        else flap = a.err < b.err;
        return flap;
      }

      /* ---------- game actions ---------- */
      function flap() {
        if (!bird.alive) return;
        started = true;
        bird.vy = FLAP_V;
      }

      function doSplat() {
        bird.alive = false;
        splat = { t: 0 };
        for (let i = 0; i < 26; i++) {
          const a = U.rand(0, Math.PI * 2), sp = U.rand(80, 320);
          particles.push({ x: BIRD_X, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: U.rand(0.5, 1.1) });
        }
        api.end('builder', `SPLAT after ${passed} column${passed === 1 ? '' : 's'}.`);
      }

      return {
        update(dt) {
          for (const p of particles) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; }
          particles = particles.filter(p => p.t > 0);
          if (!bird.alive || passed >= TARGET) return;

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
          if (!api.isHuman('flier')) { if (cpuFly(dt)) flap(); started = true; }
          startT -= dt;
          if (started || startT <= 0) {
            bird.vy += GRAVITY * dt;
            bird.y += bird.vy * dt;
          }
          bird.rot = U.clamp(bird.vy / 700, -0.5, 1.1);
          if (collides(bird.y, cols, 0)) return doSplat();

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
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#0d1633'); g.addColorStop(1, '#070b17');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          // distant skyline for depth
          ctx.fillStyle = '#0f1a36';
          for (let i = 0; i < 12; i++) {
            const bx = ((i * 97 - api.time * 20) % 900 + 900) % 900 - 50;
            ctx.fillRect(bx, GROUND - 60 - (i * 37) % 90, 60, 200);
          }

          for (const c of cols) drawColumn(ctx, c.x, c.gap, c.h, 1);

          // the builder's pending column (preview at the right edge)
          if (api.isHuman('builder')) {
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
          for (let x = -((api.time * speed()) % 40); x < W; x += 40) ctx.fillRect(x, GROUND + 8, 22, 4);

          // bird
          if (bird.alive) {
            ctx.save();
            ctx.translate(BIRD_X, bird.y);
            ctx.rotate(bird.rot);
            ctx.fillStyle = '#ffd24a';
            ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f0a83c';
            ctx.beginPath(); ctx.ellipse(-4, 3, 7, 4, 0.4 + Math.sin(api.time * 20) * 0.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -4, 4.5, 0, 7); ctx.fill();
            ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6.5, -4, 2.2, 0, 7); ctx.fill();
            ctx.fillStyle = '#f25c69'; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(19, 3); ctx.lineTo(11, 6); ctx.fill();
            ctx.restore();
          }
          for (const p of particles) {
            ctx.globalAlpha = Math.min(1, p.t * 2);
            ctx.fillStyle = '#ffd24a';
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 1;
          if (splat) D.text(ctx, 'SPLAT!', W / 2, H / 2 - 40, { size: 56, pixel: true, color: C.bad, align: 'center', glow: C.bad });

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
