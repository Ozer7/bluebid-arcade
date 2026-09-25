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
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600, GROUND = 560;
  const WAVES = 7;
  const CITY_X = [130, 200, 270, 530, 600, 670];
  const BAT_X = [50, 400, 750];
  const BAT_Y = GROUND - 14;
  const AMMO = 10;
  const INT_SPEED = [520, 700, 520];          // the centre battery fires faster, as in the original
  const BLAST_R = 34, GROW = 0.45, HOLD = 0.25, SHRINK = 0.4;
  const HIT_R = 26;                            // how close an impact must be to destroy a city/battery

  Arcade.register({
    id: 'missile',
    title: 'Missile Command',
    tagline: 'Defend six cities, or be the one raining missiles on them.',
    flip: 'you choose the targets and launch the missiles, and the computer shoots them down.',
    blurb: 'The attacker gets a missile budget each wave and chooses what to hit. The defender has three batteries of 10 interceptors, and each shot detonates wherever you point. Keep one city standing through 7 waves to win as the defender. Later waves bring more missiles, faster missiles, and warheads that split in two.',
    menuText: 'The defender wins by keeping a city alive through <b>7 waves</b>. The attacker wins by flattening <b>all 6 cities</b>.',
    sides: [
      { key: 'defender', label: 'Defender', human: 'Click in the sky to detonate an interceptor there. The nearest battery with ammo fires it.', cpu: 'Spots incoming missiles after a short reaction delay, works out where to aim so the blast meets the missile, and doesn\'t waste shots on missiles that are already doomed. It gets quicker and more accurate each wave.' },
      { key: 'attacker', label: 'Attacker', human: 'Click near a city or battery to launch a missile at it. You have a missile budget each wave and a short reload between launches.', cpu: 'Starts with scattered random shots. Later it picks the least-defended city, knocks out batteries, and times salvos to arrive together.' }
    ],
    defaults: { defender: 'cpu', attacker: 'human' },

    thumb(ctx, w, h) {
      const s = w / W;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#090f24'); g.addColorStop(1, '#1a1030');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3a2a12'; ctx.fillRect(0, GROUND * s, w, h);
      CITY_X.forEach(x => { ctx.fillStyle = C.cyan; ctx.fillRect((x - 14) * s, (GROUND - 16) * s, 28 * s, 16 * s); });
      ctx.strokeStyle = C.bad; ctx.lineWidth = 2;
      [[100, 0, 200, 380], [500, 0, 560, 300], [700, 0, 620, 260]].forEach(([a, b, c, d]) => { ctx.beginPath(); ctx.moveTo(a * s, b * s); ctx.lineTo(c * s, d * s); ctx.stroke(); });
      ctx.fillStyle = 'rgba(240,168,60,.8)'; ctx.beginPath(); ctx.arc(560 * s, 290 * s, 34 * s, 0, 7); ctx.fill();
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
      let gameOver = false;
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
        return true;
      }

      const blastRadius = bl => (bl.t < GROW ? (bl.t / GROW) * BLAST_R : bl.t < GROW + HOLD ? BLAST_R : Math.max(0, BLAST_R * (1 - (bl.t - GROW - HOLD) / SHRINK)));

      /* ---------- computer defender (plays like a person with a mouse) ---------- */
      // People notice each new missile a moment after it appears (more to track =
      // slower), then have to move the mouse to it — farther moves take longer
      // (Fitts' law). They aim "just in front" of a missile but usually not quite
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
        const move = 0.12 + 0.09 * Math.log2(1 + Math.hypot(ax - cursor.x, ay - cursor.y) / 30);
        cursor.busyUntil = now + move + U.rand(0.03, 0.12);
        cursor.x = ax; cursor.y = ay;
        if (fireAt(ax, ay)) shotAt.set(m, now + T + GROW + HOLD);        // they'll see whether it worked
      }

      /* ---------- computer attacker (plays like a person) ---------- */
      // Picks a city to go after and sends a few missiles at it, clicking at a
      // person's pace, then switches. Early on it spreads shots around; later it
      // knocks out batteries first and sends quick bursts from different angles.
      const ap = new Arcade.Human({ reaction: 0.3 });
      let atkCool = 1.2, focus = null, focusLeft = 0;
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
        launchAt(U.clamp(tx, 10, W - 10), U.chance(s * 0.6) ? U.rand(10, W - 10) : undefined);
        focusLeft--;
        atkCool = focusLeft > 0 && U.chance(s) ? U.rand(0.2, 0.45) : ap.react(true) + U.rand(0.4, 1.4);
      }

      /* ---------- impacts ---------- */
      function impact(x) {
        blasts.push({ x, y: GROUND - 6, t: 0, friendly: false });
        for (const c of cities) if (c.alive && Math.abs(c.x - x) < HIT_R) { c.alive = false; api.toast('City destroyed', C.bad); }
        for (const b of bats) if (b.alive && Math.abs(b.x - x) < HIT_R) { b.alive = false; b.ammo = 0; }
        if (cities.every(c => !c.alive) && !gameOver) {
          gameOver = true;
          api.end('attacker', `Every city fell in wave ${wave}.`);
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
          if (gameOver) return;

          if (phase === 'intro') {
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
            if (s.left <= 0) { shots.splice(i, 1); blasts.push({ x: s.tx, y: s.ty, t: 0, friendly: true }); }
          }
          // blasts destroy missiles
          for (const bl of blasts) {
            if (!bl.friendly) continue;
            const r = blastRadius(bl);
            for (let i = missiles.length - 1; i >= 0; i--) {
              const m = missiles[i];
              if (Math.hypot(m.x - bl.x, m.y - bl.y) < r) { missiles.splice(i, 1); blasts.push({ x: m.x, y: m.y, t: GROW * 0.5, friendly: false, small: true }); }
            }
          }

          // end of wave
          if (budget <= 0 && !missiles.length && !gameOver) {
            if (wave >= WAVES) {
              gameOver = true;
              const n = cities.filter(c => c.alive).length;
              return api.end('defender', `${n} ${n === 1 ? 'city' : 'cities'} survived all ${WAVES} waves.`);
            }
            wave++;
            phase = 'intro'; phaseT = 2.5;
            api.toast(`Wave ${wave}${wave === 3 ? ' — warheads that split!' : ''}`, C.warn);
          }
        },

        onPointer(type, x, y, e) {
          if (type !== 'down') return;
          const bothHuman = api.isHuman('attacker') && api.isHuman('defender');
          // with two humans on one screen: left-click defends, right-click (or shift-click) attacks
          const attackClick = bothHuman ? (e && (e.button === 2 || e.shiftKey)) : api.isHuman('attacker');
          if (attackClick && api.isHuman('attacker')) {
            if (phase !== 'play') return;
            if (budget <= 0) return api.toast('No missiles left this wave', C.muted);
            if (reload > 0) return;
            if (missiles.length >= maxInFlight()) return api.toast('Too many missiles in the air', C.muted);
            launchAt(U.clamp(x, 10, W - 10));
          } else if (api.isHuman('defender')) {
            if (!fireAt(x, y) && phase === 'play') api.toast('Out of interceptors', C.muted);
          }
        },

        draw(ctx) {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#070b1c'); g.addColorStop(1, '#1a1030');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          for (const s of stars) { ctx.fillStyle = `rgba(210,215,255,${0.15 + s.b * 0.5})`; ctx.fillRect(s.x, s.y + 40, 1.5, 1.5); }

          // ground
          ctx.fillStyle = '#3a2a12';
          ctx.beginPath(); ctx.moveTo(0, H);
          ctx.lineTo(0, GROUND);
          for (const b of BAT_X) { ctx.lineTo(b - 40, GROUND); ctx.lineTo(b - 22, BAT_Y); ctx.lineTo(b + 22, BAT_Y); ctx.lineTo(b + 40, GROUND); }
          ctx.lineTo(W, GROUND); ctx.lineTo(W, H); ctx.fill();

          // cities
          for (const c of cities) {
            if (c.alive) {
              ctx.fillStyle = C.cyan;
              [[-16, 10], [-9, 18], [-1, 13], [6, 22], [13, 9]].forEach(([dx, hh]) => ctx.fillRect(c.x + dx, GROUND - hh, 7, hh));
              ctx.fillStyle = '#e8d44d';
              ctx.fillRect(c.x - 7, GROUND - 14, 2, 2); ctx.fillRect(c.x + 8, GROUND - 17, 2, 2);
            } else {
              ctx.fillStyle = '#4a3a22';
              ctx.fillRect(c.x - 16, GROUND - 5, 32, 5);
            }
          }
          // batteries + ammo
          for (const b of bats) {
            ctx.fillStyle = b.alive ? C.accent : '#4a3a22';
            ctx.fillRect(b.x - 10, BAT_Y - 10, 20, 10);
            ctx.fillStyle = '#fff';
            for (let k = 0; k < b.ammo; k++) ctx.fillRect(b.x - 18 + (k % 5) * 8, BAT_Y + 4 + Math.floor(k / 5) * 6, 5, 3);
          }

          // enemy missiles (trail from launch point)
          ctx.lineWidth = 2;
          for (const m of missiles) {
            ctx.strokeStyle = m.split ? 'rgba(167,123,255,.8)' : 'rgba(242,92,105,.75)';
            ctx.beginPath(); ctx.moveTo(m.sx, m.sy); ctx.lineTo(m.x, m.y); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
          }
          // interceptors
          for (const s of shots) {
            ctx.strokeStyle = 'rgba(79,124,255,.8)';
            ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.x, s.y); ctx.stroke();
            ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(s.tx - 4, s.ty - 4); ctx.lineTo(s.tx + 4, s.ty + 4); ctx.moveTo(s.tx + 4, s.ty - 4); ctx.lineTo(s.tx - 4, s.ty + 4); ctx.stroke();
            ctx.lineWidth = 2;
          }
          // blasts
          for (const bl of blasts) {
            const r = bl.small ? blastRadius(bl) * 0.5 : blastRadius(bl);
            const hue = Math.floor(api.time * 20) % 3;
            ctx.fillStyle = bl.friendly ? ['#ffffff', '#f0a83c', '#4f7cff'][hue] : ['#f25c69', '#f0a83c', '#ffd24a'][hue];
            ctx.globalAlpha = 0.85;
            ctx.beginPath(); ctx.arc(bl.x, bl.y, r, 0, 7); ctx.fill();
            ctx.globalAlpha = 1;
          }

          // attacker aim hint
          if (api.isHuman('attacker') && api.pointer.inside && phase === 'play' && !api.isHuman('defender')) {
            ctx.strokeStyle = reload > 0 || budget <= 0 ? 'rgba(242,92,105,.4)' : 'rgba(242,92,105,.9)';
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(api.pointer.x, GROUND - 60); ctx.lineTo(api.pointer.x, GROUND); ctx.stroke();
            ctx.setLineDash([]);
          }

          if (phase === 'intro' && !gameOver) {
            D.text(ctx, `WAVE ${wave}`, W / 2, H / 2 - 30, { size: 44, pixel: true, align: 'center', glow: C.accent });
            D.text(ctx, `${budgetFor(wave)} missiles incoming${wave >= 3 ? ' · warheads that split' : ''}`, W / 2, H / 2 + 14, { size: 15, color: C.muted, align: 'center' });
          }

          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          D.hud(ctx, [
            { text: `DEFENDER · ${who('defender')}  CITIES ${cities.filter(c => c.alive).length}`, color: C.cyan, pixel: true },
            { text: `WAVE ${wave}/${WAVES}`, align: 'center', pixel: true },
            { text: `MISSILES ${budget}  ${who('attacker')} · ATTACKER`, color: C.bad, align: 'right', pixel: true }
          ]);
          if (api.isHuman('attacker') && api.isHuman('defender'))
            D.text(ctx, 'left-click: defend · right-click or shift-click: attack', W / 2, 56, { size: 12, color: C.muted, align: 'center' });
        },
        _state: () => ({ wave, cities: cities.filter(c => c.alive).length })
      };
    }
  });
})();
