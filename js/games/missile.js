/* ==========================================================================
   MISSILE COMMAND — attacker against defender.
   The attacker has a missile budget each wave and chooses what to hit.
   The defender has three batteries (10 interceptors each per wave) and
   detonates interceptors in the sky; the blast destroys anything inside.
   Defender wins by keeping at least one city alive through 7 waves.
   Attacker wins by destroying all six cities.

   Our flip design: the classic game makes you defend. Here either side
   can be human. The attacker gets more missiles, faster missiles, and
   (from wave 3) splitting warheads as the waves go by.
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
    blurb: 'The attacker gets a missile budget each wave and chooses what to hit. The defender has three batteries of 10 interceptors, and each shot detonates wherever you point. Keep one city standing through 7 waves to win as the defender. Later waves bring more missiles, faster missiles, and warheads that split in three.',
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

      const budgetFor = w => 8 + Math.round(w * 2.7);
      const mSpeed = () => 42 + wave * 10;
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

      /* ---------- computer defender ---------- */
      let defCool = 0;
      const planned = [];     // {x,y,at} blasts the AI already committed to
      const defSkill = () => Math.min(0.88, 0.32 + (wave - 1) * 0.1);
      function cpuDefend(dt) {
        const s = defSkill();
        defCool -= dt;
        if (defCool > 0) return;
        const now = api.time;
        // forget plans that have played out
        for (let i = planned.length - 1; i >= 0; i--) if (planned[i].at < now - HOLD) planned.splice(i, 1);
        const reaction = U.lerp(1.3, 0.3, s);
        const live = bats.filter(b => b.alive && b.ammo > 0);
        if (!live.length) return;
        const cand = missiles.filter(m => now - m.born > reaction && !covered(m))
          .filter(m => {
            // a sharp defender ignores missiles aimed at rubble
            const tgtAlive = cities.some(c => c.alive && Math.abs(c.x - m.tx) < HIT_R) || bats.some(b => b.alive && Math.abs(b.x - m.tx) < HIT_R);
            return tgtAlive || !U.chance(s);
          })
          .sort((a, b) => (GROUND - a.y) / a.vy - (GROUND - b.y) / b.vy);
        const m = cand[0];
        if (!m) return;
        // choose the battery that can get a blast there soonest
        let best = null;
        for (const b of live) {
          const sp = INT_SPEED[b.i];
          let T = Math.hypot(m.x - b.x, m.y - BAT_Y) / sp;
          let px = m.x, py = m.y;
          for (let k = 0; k < 6; k++) {                 // refine the intercept point
            const lead = T + GROW * 0.45;
            px = m.x + m.vx * lead; py = m.y + m.vy * lead;
            T = Math.hypot(px - b.x, py - BAT_Y) / sp;
          }
          if (py > GROUND - 45) continue;                // too late for this battery
          if (!best || T < best.T) best = { b, T, px, py };
        }
        if (!best) return;
        const err = U.lerp(34, 6, s);
        const ax = best.px + U.gauss() * err, ay = best.py + U.gauss() * err;
        if (fireAt(ax, ay, best.b.i)) {
          planned.push({ x: ax, y: ay, at: now + best.T });
          defCool = U.lerp(0.6, 0.17, s) + U.rand(0, 0.18);
        }
      }
      // will this missile fly into a blast that's already on its way?
      function covered(m) {
        const now = api.time;
        for (const p of planned) {
          const dtm = Math.max(0, p.at - now) + GROW * 0.5;
          if (Math.hypot(m.x + m.vx * dtm - p.x, m.y + m.vy * dtm - p.y) < BLAST_R * 0.8) return true;
        }
        for (const bl of blasts) {
          if (bl.t > GROW + HOLD) continue;
          if (Math.hypot(m.x + m.vx * 0.2 - bl.x, m.y + m.vy * 0.2 - bl.y) < BLAST_R * 0.9) return true;
        }
        return false;
      }

      /* ---------- computer attacker ---------- */
      let atkCool = 1.2;
      const atkSkill = () => Math.min(0.9, 0.2 + (wave - 1) * 0.13);
      function cpuAttack(dt) {
        atkCool -= dt;
        if (atkCool > 0 || budget <= 0 || reload > 0 || missiles.length >= maxInFlight()) return;
        const p = atkSkill();
        atkCool = U.lerp(1.8, 0.55, p) + U.rand(0, 0.8);
        const t = targets();
        if (!t.length) return;
        let tgt;
        if (U.chance(p)) {
          // least-defended city: far from batteries that still have ammo
          const armed = bats.filter(b => b.alive && b.ammo > 0);
          const cityT = t.filter(x => x.kind === 'city');
          if (armed.length && U.chance(p * 0.35)) tgt = t.filter(x => x.kind === 'bat').sort((a, b) => U.rand(-1, 1))[0];
          if (!tgt && cityT.length) {
            tgt = cityT.map(c => ({ c, d: Math.min(...armed.map(b => Math.abs(b.x - c.x)), 999) }))
              .sort((a, b) => b.d - a.d)[U.chance(0.6) ? 0 : U.randInt(0, cityT.length - 1)].c;
          }
        }
        tgt = tgt || U.pick(t);
        launchAt(tgt.x + U.rand(-6, 6));
        // salvo: extra missiles from far-apart start points
        if (U.chance(p * 0.5)) {
          const extra = U.chance(p) ? 2 : 1;
          for (let i = 0; i < extra; i++) { reload = 0; launchAt(tgt.x + U.rand(-8, 8), U.rand(10, W - 10)); }
        }
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
        for (let k = 0; k < 3; k++) {
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
          if (!api.isHuman('defender')) cpuDefend(dt);

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
            api.toast(`Wave ${wave}${wave === 3 ? ' — splitting warheads!' : ''}`, C.warn);
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
            D.text(ctx, `${budgetFor(wave)} missiles incoming${wave >= 3 ? ' · splitting warheads' : ''}`, W / 2, H / 2 + 14, { size: 15, color: C.muted, align: 'center' });
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
