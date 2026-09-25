/* ==========================================================================
   MISSILE COMMAND — attacker against defender.
   The attacker has a missile budget each wave and chooses what to hit.
   The defender has three batteries (10 interceptors each per wave) and
   detonates interceptors in the sky; the blast destroys anything inside.
   Defender wins by keeping at least one city alive through 7 waves.
   Attacker wins by destroying all six cities.

   Our flip design: the classic game makes you defend. Here either side
   can be human. The attacker gets more missiles, faster missiles, and
   (from wave 3) warheads that split as the waves go by.
   ========================================================================== */
(function () {
  'use strict';
  const { util: U, draw: D } = Arcade;

  const W = 800, H = 600, GROUND = 560;
  const WAVES = 7;
  const CITY_X = [130, 200, 270, 530, 600, 670];
  const BAT_X = [50, 400, 750];
  const BAT_Y = GROUND - 14;
  const AMMO = 10;
  const INT_SPEED = [520, 700, 520];          // the centre battery fires faster, as in the original
  const BLAST_R = 34, GROW = 0.45, HOLD = 0.25, SHRINK = 0.4;
  const HIT_R = 26;                            // how close an impact must be to destroy a city/battery

  // per-wave colour schemes, following the 1980 original's wave table
  // (waves 1–2 red missiles/cyan cities, 3–4 green/cyan, 5–6 red/yellow, 7 yellow/yellow)
  const PALS = [
    { missile: '#ff3b3b', city: '#3fe0ff', ground: '#e8c200' },
    { missile: '#ff3b3b', city: '#3fe0ff', ground: '#e8c200' },
    { missile: '#39ff5a', city: '#3fe0ff', ground: '#e8c200' },
    { missile: '#39ff5a', city: '#3fe0ff', ground: '#e8c200' },
    { missile: '#ff3b3b', city: '#ffe43f', ground: '#3f7cff' },
    { missile: '#ff3b3b', city: '#ffe43f', ground: '#3f7cff' },
    { missile: '#ffe43f', city: '#ffe43f', ground: '#ff3fa4' }
  ];
  const FLASH = ['#ffffff', '#ffe43f', '#ff3fa4', '#3fe0ff', '#ff8a1f'];

  Arcade.register({
    id: 'missile',
    title: 'Missile Command',
    year: '1980 · Atari',
    history: 'Dave Theurer\'s trackball game: three bases of 10 anti-ballistic missiles (the centre one fires fastest), six cities, a score multiplier that climbs every two waves, bonus points for leftover missiles and cities — and when the last city falls, the screen reads THE END.',
    tagline: 'Defend six cities, or be the one raining missiles on them.',
    flip: 'you pick the targets and launch, the computer shoots them down.',
    blurb: 'The defender must keep a city alive through 7 waves. The attacker wins by flattening all 6.',
    menuText: 'The defender wins by keeping a city standing through <b>7 waves</b>; the attacker wins by flattening <b>all 6 cities</b>. Missiles destroyed score 25 × the wave multiplier (×1 up to ×4), plus a bonus for every missile and city left.',
    scoreSide: 'defender', scoreName: 'points',
    sides: [
      { key: 'defender', label: 'Defender', human: 'Click in the sky: the nearest base fires and the blast goes off at the crosshair. Aim a little ahead of each missile. Don\'t waste shots on missiles heading for rubble.', cpu: 'Notices each missile a moment late, moves its crosshair at human mouse speed, usually aims not quite far enough ahead, and re-fires when a shot misses. You can watch its crosshair move.' },
      { key: 'attacker', label: 'Attacker', human: 'Click near a city or base to launch at it. You get a missile budget each wave. From wave 3, every third missile splits in two.', cpu: 'Picks a city and sends a few missiles at it at a person\'s clicking pace, then switches; later knocks out bases first.' }
    ],
    defaults: { defender: 'cpu', attacker: 'human' },

    thumb(ctx, w, h) {
      const s = w / W, p = PALS[0];
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = p.ground; ctx.fillRect(0, GROUND * s, w, h);
      CITY_X.forEach(x => { ctx.fillStyle = p.city; ctx.fillRect((x - 14) * s, (GROUND - 16) * s, 28 * s, 16 * s); });
      ctx.strokeStyle = p.missile; ctx.lineWidth = 2;
      [[100, 0, 200, 380], [500, 0, 560, 300], [700, 0, 620, 260]].forEach(([a, b, c, d]) => { ctx.beginPath(); ctx.moveTo(a * s, b * s); ctx.lineTo(c * s, d * s); ctx.stroke(); });
      ctx.fillStyle = '#ff3fa4'; ctx.beginPath(); ctx.arc(560 * s, 290 * s, 34 * s, 0, 7); ctx.fill();
    },

    create(api) {
      let wave = 1;
      let phase = 'intro', phaseT = 2.2;          // intro → play → intro ...
      const cities = CITY_X.map(x => ({ x, alive: true }));
      const bats = BAT_X.map((x, i) => ({ x, i, ammo: AMMO, alive: true }));
      let missiles = [];      // enemy: {sx,sy,x,y,tx,ty,vx,vy,split,splitY,seenAt}
      let shots = [];         // interceptors: {x,y,tx,ty,vx,vy}
      let blasts = [];        // {x,y,t,friendly}
      let budget = 0, launched = 0, reload = 0, waveClock = 0;
      let gameOver = false, theEnd = 0;
      let score = 0, bonus = null;             // bonus = end-of-wave tally in progress
      const mult = () => 1 + Math.floor((wave - 1) / 2);
      const pal = () => PALS[Math.min(PALS.length - 1, wave - 1)];
      const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * 380, b: Math.random() }));

      const budgetFor = w => 8 + Math.round(w * 2.4);
      const mSpeed = () => 39 + wave * 9.5;
      const maxInFlight = () => 4 + wave;
      const reloadTime = () => Math.max(0.25, 0.55 - wave * 0.04);

      function startWave() {
        budget = budgetFor(wave); launched = 0; waveClock = 0;
        bats.forEach(b => { b.ammo = AMMO; b.alive = true; });
        phase = 'play';
      }
      // end of wave: count leftover missiles (5 each) and cities (100 each) × multiplier, with ticks
      function startBonus() {
        const ammo = bats.reduce((n, b) => n + (b.alive ? b.ammo : 0), 0);
        const alive = cities.filter(c => c.alive).length;
        bonus = { ammo, alive, shownAmmo: 0, shownCities: 0, t: 0, m: mult() };
        phase = 'bonus';
      }

      /* ---------- attacker actions (shared) ---------- */
      const targets = () => [...cities.filter(c => c.alive).map(c => ({ x: c.x, kind: 'city' })),
        ...bats.filter(b => b.alive).map(b => ({ x: b.x, kind: 'bat' }))];

      function launchAt(tx, sx) {
        if (phase !== 'play' || budget <= 0 || reload > 0) return false;
        if (missiles.length >= maxInFlight()) return false;
        sx = sx === undefined ? U.clamp(tx + U.rand(-220, 220), 10, W - 10) : sx;
        const ty = GROUND - 4;
        const d = Math.hypot(tx - sx, ty);
        const m = { sx, sy: 0, x: sx, y: 0, tx, ty, vx: ((tx - sx) / d) * mSpeed(), vy: (ty / d) * mSpeed(), split: false, splitY: 0, born: api.time };
        launched++;
        budget--;
        // from wave 3, every third missile is a splitting warhead
        if (wave >= 3 && launched % 3 === 0) { m.split = true; m.splitY = U.rand(190, 290); }
        missiles.push(m);
        reload = reloadTime();
        api.sfx('launch');
        return true;
      }

      /* ---------- defender actions (shared) ---------- */
      function fireAt(tx, ty, batIndex) {
        if (phase !== 'play') return false;
        ty = Math.min(ty, GROUND - 40);
        let b = batIndex !== undefined ? bats[batIndex] : null;
        if (!b || !b.alive || b.ammo <= 0) {
          const ok = bats.filter(k => k.alive && k.ammo > 0);
          if (!ok.length) return false;
          b = ok.reduce((a, k) => (Math.abs(k.x - tx) < Math.abs(a.x - tx) ? k : a));
        }
        b.ammo--;
        const sp = INT_SPEED[b.i];
        const d = Math.hypot(tx - b.x, ty - BAT_Y) || 1;
        shots.push({ x: b.x, y: BAT_Y - 8, sx: b.x, sy: BAT_Y - 8, tx, ty, vx: ((tx - b.x) / d) * sp, vy: ((ty - BAT_Y) / d) * sp, left: d / sp });
        api.sfx('abm');
        return true;
      }

      const blastRadius = bl => (bl.t < GROW ? (bl.t / GROW) * BLAST_R : bl.t < GROW + HOLD ? BLAST_R : Math.max(0, BLAST_R * (1 - (bl.t - GROW - HOLD) / SHRINK)));

      /* ---------- computer defender (plays like a person with a mouse) ---------- */
      // People notice each new missile a moment after it appears (more to track =
      // slower), then have to move the mouse to it — farther moves take longer
      // (Fitts' law: a mouse manages ~3.8 bits/s). They aim "just in front" of a missile but usually not quite
      // far enough, and they waste some shots: firing twice at the same missile,
      // or at one headed for a city that's already rubble.
      const dp = new Arcade.Human({ reaction: 0.28 });
      const cursor = { x: W / 2, y: 300, busyUntil: 0 };
      const noticed = new WeakMap(), shotAt = new WeakMap();
      const defSkill = () => Math.min(0.92, 0.5 + (wave - 1) * 0.07);
      function cpuDefend() {
        const now = api.time, s = defSkill();
        for (const m of missiles) if (!noticed.has(m)) noticed.set(m, now + dp.react(true));
        if (now < cursor.busyUntil) return;
        dp.pressure = U.clamp(missiles.length / 7, 0, 1);
        const live = bats.filter(b => b.alive && b.ammo > 0);
        if (!live.length) return;
        const cand = missiles.filter(m => noticed.get(m) <= now && m.y < GROUND - 60)
          .filter(m => !shotAt.has(m) || now > shotAt.get(m) || U.chance((1 - s) * 0.02))   // shoot again if it survived; sometimes double up early
          .filter(m => {
            const alive = cities.some(c => c.alive && Math.abs(c.x - m.tx) < HIT_R) || bats.some(b => b.alive && Math.abs(b.x - m.tx) < HIT_R);
            return alive || U.chance((1 - s) * 0.6);                                   // wasting shots on rubble
          })
          .sort((a, b) => b.y - a.y);                                                  // lowest first
        const m = cand[0];
        if (!m) return;
        // pick the battery a person would: the nearest one with ammo
        const b = live.reduce((a, k) => (Math.abs(k.x - m.x) < Math.abs(a.x - m.x) ? k : a));
        const sp = INT_SPEED[b.i];
        let T = Math.hypot(m.x - b.x, m.y - BAT_Y) / sp;
        for (let k = 0; k < 3; k++) T = Math.hypot(m.x + m.vx * T - b.x, m.y + m.vy * T - BAT_Y) / sp;
        const leadK = U.rand(U.lerp(0.6, 0.85, s), 1.05);                              // under-leads more often than not
        const sd = U.lerp(18, 6, s);
        const ax = m.x + m.vx * (T + GROW * 0.4) * leadK + dp.scatter(sd);
        const ay = Math.min(GROUND - 45, m.y + m.vy * (T + GROW * 0.4) * leadK + dp.scatter(sd));
        // moving the mouse there takes time; then click
        const mv = dp.point(Math.hypot(ax - cursor.x, ay - cursor.y), BLAST_R * 1.6);
        cursor.fx = cursor.x; cursor.fy = cursor.y; cursor.t0 = now; cursor.t1 = now + mv * 0.8;
        cursor.busyUntil = now + mv;
        cursor.x = ax; cursor.y = ay;
        if (fireAt(ax, ay)) shotAt.set(m, now + T + GROW + HOLD);        // they'll see whether it worked
      }

      /* ---------- computer attacker (plays like a person) ---------- */
      // Picks a city to go after and sends a few missiles at it, clicking at a
      // person's pace, then switches. Early on it spreads shots around; later it
      // knocks out batteries first and sends quick bursts from different angles.
      const ap = new Arcade.Human({ reaction: 0.3 });
      let atkCool = 1.2, focus = null, focusLeft = 0, atkCursor = W / 2;
      const atkSkill = () => Math.min(0.8, 0.15 + (wave - 1) * 0.11);
      function cpuAttack(dt) {
        atkCool -= dt;
        if (atkCool > 0 || budget <= 0 || reload > 0 || missiles.length >= maxInFlight()) return;
        const s = atkSkill();
        const t = targets();
        if (!t.length) return;
        if (!focus || focusLeft <= 0 || !t.some(x => x.x === focus.x)) {
          const armedBats = t.filter(x => x.kind === 'bat');
          const citiesLeft = t.filter(x => x.kind === 'city');
          focus = armedBats.length && U.chance(s * 0.3) ? U.pick(armedBats) : U.pick(citiesLeft.length ? citiesLeft : t);
          focusLeft = U.chance(s) ? U.randInt(2, 4) : 1;
        }
        const tx = focus.x + ap.scatter(U.lerp(40, 10, s));
        const travel = ap.point(Math.abs(tx - atkCursor), 40);
        atkCursor = tx;
        launchAt(U.clamp(tx, 10, W - 10), U.chance(s * 0.6) ? U.rand(10, W - 10) : undefined);
        focusLeft--;
        atkCool = (focusLeft > 0 && U.chance(s) ? U.rand(0.05, 0.2) : ap.react(true) + U.rand(0.3, 1.2)) + travel;
      }

      /* ---------- impacts ---------- */
      function impact(x) {
        blasts.push({ x, y: GROUND - 6, t: 0, friendly: false });
        api.sfx('boomMid');
        for (const c of cities) if (c.alive && Math.abs(c.x - x) < HIT_R) { c.alive = false; api.sfx('boomBig'); }
        for (const b of bats) if (b.alive && Math.abs(b.x - x) < HIT_R) { b.alive = false; b.ammo = 0; }
        if (cities.every(c => !c.alive) && !gameOver) {
          gameOver = true;
          theEnd = 0.001;
          api.sfx('boomBig');
          api.end('attacker', `Every city fell in wave ${wave}.`, 2600);
        }
      }

      function splitMissile(m) {
        const t = targets();
        for (let k = 0; k < 2; k++) {
          const tg = t.length ? U.pick(t) : { x: U.rand(40, W - 40) };
          const tx = tg.x + U.rand(-8, 8), ty = GROUND - 4;
          const d = Math.hypot(tx - m.x, ty - m.y);
          const sp = mSpeed() * 1.05;
          missiles.push({ sx: m.x, sy: m.y, x: m.x, y: m.y, tx, ty, vx: ((tx - m.x) / d) * sp, vy: ((ty - m.y) / d) * sp, split: false, born: m.born });
        }
      }

      return {
        update(dt) {
          for (const bl of blasts) bl.t += dt;
          blasts = blasts.filter(bl => bl.t < GROW + HOLD + SHRINK);
          if (theEnd) theEnd += dt;
          if (gameOver) return;

          if (phase === 'bonus') {
            bonus.t += dt;
            if (bonus.t > 0.08) {
              bonus.t = 0;
              if (bonus.shownAmmo < bonus.ammo) { bonus.shownAmmo++; score += 5 * bonus.m; api.sfx('tick'); }
              else if (bonus.shownCities < bonus.alive) { bonus.shownCities++; score += 100 * bonus.m; api.sfx('coin'); bonus.t = -0.2; }
              else if (bonus.t >= 0) { bonus.done = (bonus.done || 0) + 1; if (bonus.done > 10) { bonus = null; wave++; phase = 'intro'; phaseT = 2.6; api.sfx('siren'); } }
            }
            return;
          }
          if (phase === 'intro') {
            if (phaseT === 2.2 && wave === 1) api.sfx('siren');
            phaseT -= dt;
            if (phaseT <= 0) startWave();
            return;
          }

          waveClock += dt;
          reload -= dt;
          if (!api.isHuman('attacker')) cpuAttack(dt);
          else if (waveClock > 32 && budget > 0 && reload <= 0) {
            // an idle human attacker still has to spend the budget
            const t = targets(); if (t.length) launchAt(U.pick(t).x);
          }
          if (!api.isHuman('defender')) cpuDefend();

          // enemy missiles
          for (let i = missiles.length - 1; i >= 0; i--) {
            const m = missiles[i];
            m.x += m.vx * dt; m.y += m.vy * dt;
            if (m.split && m.y >= m.splitY) { missiles.splice(i, 1); splitMissile(m); continue; }
            if (m.y >= m.ty) { missiles.splice(i, 1); impact(m.x); }
          }
          // interceptors
          for (let i = shots.length - 1; i >= 0; i--) {
            const s = shots[i];
            s.x += s.vx * dt; s.y += s.vy * dt; s.left -= dt;
            if (s.left <= 0) { shots.splice(i, 1); blasts.push({ x: s.tx, y: s.ty, t: 0, friendly: true }); api.sfx('boomSmall'); }
          }
          // blasts destroy missiles
          for (const bl of blasts) {
            if (!bl.friendly) continue;
            const r = blastRadius(bl);
            for (let i = missiles.length - 1; i >= 0; i--) {
              const m = missiles[i];
              if (Math.hypot(m.x - bl.x, m.y - bl.y) < r) { missiles.splice(i, 1); score += 25 * mult(); blasts.push({ x: m.x, y: m.y, t: GROW * 0.5, friendly: true, small: true }); }
            }
          }

          // end of wave
          if (budget <= 0 && !missiles.length && !gameOver) {
            if (wave >= WAVES) {
              gameOver = true;
              const n = cities.filter(c => c.alive).length;
              score += n * 100 * mult();
              return api.end('defender', `${n} ${n === 1 ? 'city' : 'cities'} survived all ${WAVES} waves.`);
            }
            startBonus();
          }
        },

        onPointer(type, x, y, e) {
          if (type !== 'down') return;
          const bothHuman = api.isHuman('attacker') && api.isHuman('defender');
          // with two humans on one screen: left-click defends, right-click (or shift-click) attacks
          const attackClick = bothHuman ? (e && (e.button === 2 || e.shiftKey)) : api.isHuman('attacker');
          if (attackClick && api.isHuman('attacker')) {
            if (phase !== 'play') return;
            if (budget <= 0) return api.toast('No missiles left this wave');
            if (reload > 0) return;
            if (missiles.length >= maxInFlight()) return api.toast('Too many missiles in the air');
            launchAt(U.clamp(x, 10, W - 10));
          } else if (api.isHuman('defender')) {
            if (!fireAt(x, y) && phase === 'play') api.toast('Out of missiles');
          }
        },

        // 1980 raster look: black sky, coloured ground and cities that change
        // every two waves, colour-cycling fireballs, crosshairs, ABM pyramids
        draw(ctx) {
          const P = pal();
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

          // ground with the three base mounds
          ctx.fillStyle = P.ground;
          ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, GROUND);
          for (const b of BAT_X) { ctx.lineTo(b - 44, GROUND); ctx.lineTo(b - 26, BAT_Y - 4); ctx.lineTo(b + 26, BAT_Y - 4); ctx.lineTo(b + 44, GROUND); }
          ctx.lineTo(W, GROUND); ctx.lineTo(W, H); ctx.fill();

          // cities: blocky skylines; rubble when destroyed
          for (const c of cities) {
            if (c.alive) {
              ctx.fillStyle = P.city;
              [[-18, 8], [-12, 16], [-5, 11], [2, 20], [9, 13], [15, 7]].forEach(([dx, hh]) => ctx.fillRect(c.x + dx, GROUND - hh, 6, hh));
              ctx.fillStyle = '#000';
              ctx.fillRect(c.x - 10, GROUND - 12, 2, 2); ctx.fillRect(c.x + 4, GROUND - 16, 2, 2); ctx.fillRect(c.x + 11, GROUND - 9, 2, 2);
            } else {
              ctx.fillStyle = '#6a2a1a'; ctx.fillRect(c.x - 18, GROUND - 4, 36, 4);
            }
          }
          // ABMs stacked in a pyramid on each base (4-3-2-1, like the original)
          for (const b of bats) {
            if (!b.alive) continue;
            let k = 0;
            for (let row = 0; row < 4 && k < b.ammo; row++) {
              const n = 4 - row;
              for (let i = 0; i < n && k < b.ammo; i++, k++) {
                const x = b.x - (n - 1) * 5 + i * 10, y = BAT_Y + 8 - row * 7;
                ctx.fillStyle = '#1a3aff'; ctx.fillRect(x - 2, y - 4, 4, 6);
                ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 6, 2, 2);
              }
            }
          }

          // enemy missiles: thin trails in the wave colour, bright heads
          ctx.lineWidth = 1.5;
          for (const m of missiles) {
            ctx.strokeStyle = P.missile;
            ctx.beginPath(); ctx.moveTo(m.sx, m.sy); ctx.lineTo(m.x, m.y); ctx.stroke();
            ctx.fillStyle = Math.floor(api.time * 12) % 2 ? '#fff' : P.missile; ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
          }
          // interceptors: blue trails, target X
          for (const s of shots) {
            ctx.strokeStyle = '#4f7cff';
            ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.x, s.y); ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(s.tx - 4, s.ty - 4); ctx.lineTo(s.tx + 4, s.ty + 4); ctx.moveTo(s.tx + 4, s.ty - 4); ctx.lineTo(s.tx - 4, s.ty + 4); ctx.stroke();
          }
          // fireballs: colour-cycling discs
          for (const bl of blasts) {
            const r = bl.small ? blastRadius(bl) * 0.55 : blastRadius(bl);
            ctx.fillStyle = FLASH[(Math.floor(api.time * 24) + Math.floor(bl.x)) % FLASH.length];
            ctx.beginPath(); ctx.arc(bl.x, bl.y, r, 0, 7); ctx.fill();
          }

          // crosshairs: the human defender's, or the computer's "mouse" moving across the sky
          const cross = (x, y, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); };
          if (api.isHuman('defender') && api.pointer.inside && phase === 'play') cross(api.pointer.x, Math.min(api.pointer.y, GROUND - 40), '#fff');
          if (!api.isHuman('defender') && phase === 'play' && cursor.t1) {
            const k = U.clamp((api.time - cursor.t0) / Math.max(0.01, cursor.t1 - cursor.t0), 0, 1), e = 1 - (1 - k) * (1 - k);
            cross(U.lerp(cursor.fx, cursor.x, e), U.lerp(cursor.fy, cursor.y, e), '#9fb4ff');
          }
          // the human attacker's target marker
          if (api.isHuman('attacker') && api.pointer.inside && phase === 'play' && !api.isHuman('defender')) {
            ctx.strokeStyle = reload > 0 || budget <= 0 ? 'rgba(255,59,59,.35)' : P.missile;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(api.pointer.x, 0); ctx.lineTo(api.pointer.x, GROUND); ctx.stroke();
            ctx.setLineDash([]);
          }

          // HUD: score and multiplier, the original's way
          const who = k => (api.isHuman(k) ? '1UP' : 'CPU');
          D.text(ctx, String(score), 24, 22, { size: 16, pixel: true, color: '#ff3b3b' });
          D.text(ctx, `DEFENDER ${who('defender')}`, 24, 44, { size: 8, pixel: true, color: '#9fb4ff' });
          D.text(ctx, `${mult()}×`, W / 2, 22, { size: 14, pixel: true, color: '#fff', align: 'center' });
          D.text(ctx, `WAVE ${wave}/${WAVES}`, W / 2, 44, { size: 8, pixel: true, color: '#9fb4ff', align: 'center' });
          D.text(ctx, `${budget} LEFT`, W - 24, 22, { size: 12, pixel: true, color: P.missile, align: 'right' });
          D.text(ctx, `ATTACKER ${who('attacker')}`, W - 24, 44, { size: 8, pixel: true, color: '#9fb4ff', align: 'right' });
          if (api.isHuman('attacker') && api.isHuman('defender'))
            D.text(ctx, 'LEFT CLICK DEFENDS · RIGHT/SHIFT CLICK ATTACKS', W / 2, 70, { size: 8, pixel: true, color: '#9fb4ff', align: 'center' });

          if (phase === 'intro' && !gameOver && Math.floor(api.time * 3) % 3) {
            D.text(ctx, 'DEFEND', W / 2, H / 2 - 60, { size: 26, pixel: true, align: 'center', color: '#3f7cff' });
            D.text(ctx, 'CITIES', W / 2, H / 2 - 20, { size: 26, pixel: true, align: 'center', color: '#3f7cff' });
            D.text(ctx, `${mult()} × POINTS`, W / 2, H / 2 + 30, { size: 14, pixel: true, align: 'center', color: '#fff' });
            if (wave === 3) D.text(ctx, 'WARHEADS NOW SPLIT', W / 2, H / 2 + 62, { size: 10, pixel: true, align: 'center', color: P.missile });
          }
          if (phase === 'bonus' && bonus) {
            D.text(ctx, 'BONUS POINTS', W / 2, H / 2 - 70, { size: 16, pixel: true, align: 'center', color: '#3f7cff' });
            D.text(ctx, String(bonus.shownAmmo * 5 * bonus.m), W / 2 - 150, H / 2 - 20, { size: 12, pixel: true, align: 'right', color: '#fff' });
            for (let i = 0; i < bonus.shownAmmo; i++) { ctx.fillStyle = '#1a3aff'; ctx.fillRect(W / 2 - 130 + i * 9, H / 2 - 28, 5, 12); }
            D.text(ctx, String(bonus.shownCities * 100 * bonus.m), W / 2 - 150, H / 2 + 24, { size: 12, pixel: true, align: 'right', color: '#fff' });
            for (let i = 0; i < bonus.shownCities; i++) { ctx.fillStyle = P.city; ctx.fillRect(W / 2 - 130 + i * 36, H / 2 + 12, 26, 18); }
          }
          // THE END: a huge octagonal explosion over everything
          if (theEnd) {
            const r = Math.min(1, theEnd / 1.2) * 330;
            ctx.fillStyle = FLASH[Math.floor(api.time * 14) % FLASH.length];
            ctx.beginPath();
            for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; ctx.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); }
            ctx.closePath(); ctx.fill();
            if (theEnd > 1.0) D.text(ctx, 'THE END', W / 2, H / 2, { size: 44, pixel: true, align: 'center', color: '#000' });
          }
        },
        score: () => score,
        endTitle: res => (res.winnerSide === 'attacker' ? 'The end' : 'Cities saved'),
        _state: () => ({ wave, cities: cities.filter(c => c.alive).length })
      };
    }
  });
})();
