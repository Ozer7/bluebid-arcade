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
  const { util: U, draw: D } = Arcade;

  const W = 800, H = 600, GROUND = 560;
  const BIRD_X = 220, BIRD_R = 13;
  const GRAVITY = 1500, FLAP_V = -430;
  const COL_W = 70, SPACING = 280, CAP = 5;   // CAP = the lip on each pipe end (part of the hitbox)
  const TARGET = 30;

  // daytime pixel-art palette in the spirit of Flappy Bird (2013)
  const SKY = '#4ec0ca', CLOUD = '#e9fcd9', CITY = '#a6dfc6', CITY_WIN = '#d1f2e0', BUSH = '#5ee270', BUSH_D = '#3fb752';
  const GROUND_C = '#ded895', GRASS_A = '#73bf2e', GRASS_B = '#9ce659', DIRT_LINE = '#d0c874';
  const PIPE = '#73bf2e', PIPE_HI = '#9ce659', PIPE_LO = '#558022', OUTLINE = '#543847';
  const MEDALS = [{ at: 30, name: 'Gold', color: '#f5c542' }, { at: 20, name: 'Silver', color: '#d9d9d9' }, { at: 10, name: 'Bronze', color: '#d7883a' }];

  Arcade.register({
    id: 'splat',
    title: 'Splat',
    year: '2013 · after Flappy Bird (.GEARS)',
    history: 'Flappy Bird: one tap to flap, one point per pipe, bronze/silver/gold medals at 10/20/30. Its gravity roughly matches real gravity for a bird that size, and every tap resets the bird to the same upward speed.',
    tagline: 'A flappy bird against the player who builds the pipes.',
    flip: 'you lay out the pipes, the computer flies.',
    blurb: 'The bird needs 30 pipes for the win (and a gold medal). The builder wins on a splat.',
    menuText: 'The bird wins at <b>30 pipes</b>: bronze at 10, silver at 20, gold at 30. The builder wins on a <b>splat</b>. A gap can only move so far from the last one, so every layout can be flown.',
    scoreSide: 'flier', scoreName: 'pipes',
    sides: [
      { key: 'flier', label: 'Bird', human: 'Space, ↑, W or click to flap. Tap calmly and in rhythm — frantic tapping is how people crash.', cpu: 'Watches the next gap and taps when the bird sinks too low, with human timing wobble. Panics and over-taps when a gap is far above; drops too long when it\'s far below.' },
      { key: 'builder', label: 'Builder', human: 'Move the mouse up/down (or ↑ / ↓) to set the gap of the pipe coming in on the right. It locks when it scrolls in.', cpu: 'Drags its cursor like a mouse: gentle gaps at first, then zig-zags, staircases and the odd mean switch.' }
    ],
    defaults: { flier: 'cpu', builder: 'human' },

    thumb(ctx, w, h) {
      const s = w / W;
      ctx.fillStyle = SKY; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = CITY; for (let i = 0; i < 8; i++) ctx.fillRect(i * 55 * s * 2, (GROUND - 90 - (i % 3) * 25) * s, 80 * s, 200 * s);
      [[320, 250], [600, 380]].forEach(([x, gy]) => {
        ctx.fillStyle = OUTLINE; ctx.fillRect((x - 3) * s, 0, (COL_W + 6) * s, (gy - 88) * s); ctx.fillRect((x - 3) * s, (gy + 88) * s, (COL_W + 6) * s, h);
        ctx.fillStyle = PIPE; ctx.fillRect(x * s, 0, COL_W * s, (gy - 90) * s); ctx.fillRect(x * s, (gy + 90) * s, COL_W * s, h);
      });
      ctx.fillStyle = GROUND_C; ctx.fillRect(0, GROUND * s, w, h);
      ctx.fillStyle = GRASS_A; ctx.fillRect(0, GROUND * s, w, 6);
      ctx.fillStyle = '#f8c43a'; ctx.fillRect(BIRD_X * s - 12, 280 * s - 9, 24, 18);
      ctx.fillStyle = '#fff'; ctx.fillRect(BIRD_X * s + 2, 280 * s - 8, 8, 8);
      ctx.fillStyle = '#f16e3a'; ctx.fillRect(BIRD_X * s + 8, 280 * s + 1, 10, 6);
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
        api.sfx('flap');
      }

      // Hitting a pipe knocks the bird out: it flashes, tumbles and drops to the
      // ground, and only then goes SPLAT. Hitting the ground is an instant splat.
      let fall = null;   // {t, landed}
      let shake = 0, scrollT = 0, hitFlash = 0, wingT = 0;
      function knockOut() {
        bird.alive = false;
        hitFlash = 0.12;
        api.sfx('hit');
        const onGround = bird.y + BIRD_R >= GROUND - 1;
        fall = { t: 0, landed: false, spin: 0 };
        bird.vy = onGround ? 0 : Math.min(bird.vy, 0) * 0.3 - 140;     // a little knock-back pop
        if (onGround) land(); else setTimeout(() => api.sfx('fall'), 250);
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
        api.end('builder', `SPLAT after ${passed} pipe${passed === 1 ? '' : 's'}.`, 1200);
      }

      return {
        update(dt) {
          for (const p of particles) { p.vy += (p.feather ? 250 : 900) * dt; p.x += p.vx * dt * (p.feather ? 0.6 : 1); p.y += p.vy * dt; p.t -= dt; }
          particles = particles.filter(p => p.t > 0);
          if (shake > 0) shake -= dt;
          if (hitFlash > 0) hitFlash -= dt;
          wingT += dt * (bird.vy < 0 ? 14 : 7);
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
              api.sfx('point');
              if (passed >= TARGET) { api.sfx('win'); return api.end('flier', `All ${TARGET} pipes cleared: gold medal.`); }
              if (passed === 10) api.toast('Bronze medal!');
              else if (passed === 20) api.toast('Silver medal!');
              else if (passed % 5 === 0) api.toast('Faster — tighter gaps');
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

        // Flappy-style daytime pixel art: flat sky, clouds, a pale city, bushes,
        // outlined green pipes, striped ground, big outlined score numerals
        draw(ctx) {
          ctx.save();
          if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake / 0.35, (Math.random() - 0.5) * 8 * shake / 0.35);
          ctx.fillStyle = SKY; ctx.fillRect(-10, -10, W + 20, H + 20);
          // clouds, city, bushes (parallax at different speeds)
          const par = (sp, span) => -((scrollT * sp) % span);
          ctx.fillStyle = CLOUD;
          for (let x = par(8, 160) - 160; x < W + 160; x += 160) { ctx.beginPath(); ctx.arc(x + 40, GROUND - 150, 44, 0, 7); ctx.arc(x + 95, GROUND - 160, 54, 0, 7); ctx.arc(x + 140, GROUND - 145, 38, 0, 7); ctx.fill(); }
          ctx.fillRect(0, GROUND - 150, W, 60);
          for (let x = par(18, 240) - 240, i = 0; x < W + 240; x += 40, i++) {
            const bh = 40 + ((i * 37) % 5) * 14;
            ctx.fillStyle = CITY; ctx.fillRect(x, GROUND - 60 - bh, 38, bh + 60);
            ctx.fillStyle = CITY_WIN;
            for (let wy = GROUND - 52 - bh; wy < GROUND - 60; wy += 12) { ctx.fillRect(x + 6, wy, 6, 6); ctx.fillRect(x + 22, wy, 6, 6); }
          }
          ctx.fillStyle = BUSH;
          for (let x = par(30, 120) - 120; x < W + 120; x += 60) { ctx.beginPath(); ctx.arc(x, GROUND - 8, 34, 0, 7); ctx.fill(); }
          ctx.fillStyle = BUSH_D; ctx.fillRect(0, GROUND - 12, W, 12);

          for (const c of cols) drawColumn(ctx, c.x, c.gap, c.h, 1);

          // the builder's next pipe (preview at the right edge) — shown for the
          // computer builder too, so you can watch it drag the gap into place
          if (!fall) {
            const pg = clampGap(pendingGap);
            ctx.globalAlpha = 0.5;
            drawColumn(ctx, W - COL_W - 6, pg, gapH(), 0);
            ctx.globalAlpha = 1;
            const lo = Math.max(gapMin(), lastGap - maxDelta()), hi = Math.min(gapMax(), lastGap + maxDelta());
            ctx.fillStyle = OUTLINE; ctx.fillRect(W - 5, lo, 5, hi - lo);
            D.text(ctx, 'NEXT', W - COL_W / 2 - 6, pg, { size: 10, pixel: true, color: '#fff', align: 'center' });
          }

          // ground with scrolling stripes
          ctx.fillStyle = GROUND_C; ctx.fillRect(0, GROUND, W, H - GROUND);
          ctx.fillStyle = OUTLINE; ctx.fillRect(0, GROUND, W, 3);
          for (let x = -((scrollT * speed()) % 24); x < W; x += 24) {
            ctx.fillStyle = GRASS_A; ctx.fillRect(x, GROUND + 3, 12, 12);
            ctx.fillStyle = GRASS_B; ctx.fillRect(x + 12, GROUND + 3, 12, 12);
          }
          ctx.fillStyle = DIRT_LINE; ctx.fillRect(0, GROUND + 15, W, 3);

          // the bird: pixel body, flapping wing, white eye, orange beak, dark outline
          if (!(splat && splat.t > 0)) {
            ctx.save();
            ctx.translate(BIRD_X, bird.y);
            ctx.rotate(bird.rot);
            const flashOn = fall && fall.t < 0.25 && Math.floor(fall.t * 20) % 2 === 0;
            ctx.fillStyle = OUTLINE; ctx.fillRect(-16, -12, 32, 24);
            ctx.fillStyle = flashOn ? '#ffffff' : '#f8c43a'; ctx.fillRect(-14, -10, 28, 20);
            ctx.fillStyle = flashOn ? '#ffffff' : '#fbe29a'; ctx.fillRect(-14, -10, 28, 6);
            // wing
            const wy = fall ? 0 : [-4, 0, 4, 0][Math.floor(wingT) % 4];
            ctx.fillStyle = OUTLINE; ctx.fillRect(-15, -1 + wy, 14, 10);
            ctx.fillStyle = '#fff8e0'; ctx.fillRect(-13, 1 + wy, 10, 6);
            // eye
            ctx.fillStyle = OUTLINE; ctx.fillRect(2, -11, 13, 13);
            ctx.fillStyle = '#fff'; ctx.fillRect(3, -10, 11, 11);
            if (fall) { ctx.fillStyle = OUTLINE; ctx.fillRect(5, -8, 2, 2); ctx.fillRect(9, -4, 2, 2); ctx.fillRect(9, -8, 2, 2); ctx.fillRect(5, -4, 2, 2); ctx.fillRect(7, -6, 2, 2); }
            else { ctx.fillStyle = OUTLINE; ctx.fillRect(9, -7, 4, 6); }
            // beak
            ctx.fillStyle = OUTLINE; ctx.fillRect(8, 2, 14, 10);
            ctx.fillStyle = '#f16e3a'; ctx.fillRect(9, 3, 12, 3); ctx.fillStyle = '#e25a28'; ctx.fillRect(9, 7, 11, 4);
            ctx.restore();
          }
          // a flattened bird on the ground
          if (splat) {
            ctx.fillStyle = OUTLINE; ctx.fillRect(BIRD_X - 24, GROUND - 8, 48, 8);
            ctx.fillStyle = '#f8c43a'; ctx.fillRect(BIRD_X - 22, GROUND - 6, 44, 5);
            ctx.fillStyle = '#f16e3a'; ctx.fillRect(BIRD_X + 22, GROUND - 5, 8, 3);
          }
          for (const p of particles) {
            ctx.globalAlpha = Math.min(1, p.t * 2);
            ctx.fillStyle = p.feather ? '#fff8e0' : '#f8c43a';
            if (p.feather) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 6); ctx.fillRect(-5, -2, 10, 4); ctx.restore(); }
            else ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
          }
          ctx.globalAlpha = 1;
          ctx.restore();
          if (hitFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${hitFlash / 0.12})`; ctx.fillRect(0, 0, W, H); }

          // big score, Flappy style (white with a dark outline)
          outlined(ctx, String(passed), W / 2, 70, 40);
          if (splat) outlined(ctx, 'SPLAT!', W / 2, H / 2 - 40, 44, '#f16e3a');
          if (api.isHuman('flier') && !started && bird.alive) {
            outlined(ctx, 'GET READY', W / 2, 170, 26, '#f8c43a');
            D.text(ctx, 'SPACE / CLICK TO FLAP', W / 2, 212, { size: 12, pixel: true, color: '#fff', align: 'center' });
          }
          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          D.text(ctx, `BIRD ${who('flier')}`, 14, 22, { size: 10, pixel: true, color: '#fff' });
          D.text(ctx, `BUILDER ${who('builder')}`, W - 14, 22, { size: 10, pixel: true, color: '#fff', align: 'right' });
          const m = MEDALS.find(x => passed >= x.at);
          if (m) { ctx.fillStyle = OUTLINE; ctx.beginPath(); ctx.arc(26, 52, 13, 0, 7); ctx.fill(); ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(26, 52, 10, 0, 7); ctx.fill(); }
        },
        score: () => passed,
        medal: () => MEDALS.find(x => passed >= x.at) || null,
        endTitle: () => (passed >= TARGET ? 'Gold medal' : 'Game over'),
        _state: () => ({ passed, alive: bird.alive, y: bird.y, vy: bird.vy, cols: cols.map(c => [Math.round(c.x), Math.round(c.gap), c.h]) })
      };

      function outlined(ctx, str, x, y, size, fill = '#fff') {
        ctx.save();
        ctx.font = `${size}px ${D.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(4, size / 5); ctx.strokeStyle = OUTLINE; ctx.lineJoin = 'round';
        ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y);
        ctx.restore();
      }

      // an outlined green pipe with a lighter left edge, darker right edge and a wider lip
      function drawColumn(ctx, x, gap, h, solid) {
        const top = gap - h / 2, bot = gap + h / 2;
        const body = (y0, y1) => {
          ctx.fillStyle = OUTLINE; ctx.fillRect(x - 2, y0, COL_W + 4, y1 - y0);
          ctx.fillStyle = PIPE; ctx.fillRect(x, y0, COL_W, y1 - y0);
          ctx.fillStyle = PIPE_HI; ctx.fillRect(x + 6, y0, 8, y1 - y0);
          ctx.fillStyle = PIPE_LO; ctx.fillRect(x + COL_W - 12, y0, 8, y1 - y0);
        };
        const lip = y => {
          ctx.fillStyle = OUTLINE; ctx.fillRect(x - CAP - 2, y - 2, COL_W + CAP * 2 + 4, 22);
          ctx.fillStyle = solid ? PIPE : '#8fd3ff'; ctx.fillRect(x - CAP, y, COL_W + CAP * 2, 18);
          ctx.fillStyle = PIPE_HI; ctx.fillRect(x - CAP + 4, y, 8, 18);
          ctx.fillStyle = PIPE_LO; ctx.fillRect(x + COL_W + CAP - 14, y, 8, 18);
        };
        body(-2, top - 18); lip(top - 18);
        body(bot + 18, GROUND); lip(bot);
      }
    }
  });
})();
