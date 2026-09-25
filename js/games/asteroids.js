/* ==========================================================================
   ASTEROIDS — a pilot against the asteroid thrower.
   The pilot must survive 5 waves (25 seconds each) with 3 lives.
   The thrower launches asteroids from the edges, paid for with energy
   that recharges faster every wave. Big rocks split into smaller ones.

   Fairness: the computer pilot uses the same thrust, turn rate, bullet
   speed and fire cooldown as a human. It has to turn to aim and it can
   miss. The computer thrower pays the same energy costs as a human.
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const WAVES = 5, WAVE_TIME = 25;
  const TURN = 4.2, THRUST = 260, DRAG = 0.55, MAX_V = 330;
  const BULLET_V = 520, BULLET_LIFE = 1.05, FIRE_COOLDOWN = 0.22, MAX_BULLETS = 5;
  const SHIP_R = 12;
  const SIZES = {
    3: { r: 42, cost: 4, speed: [45, 75], pts: 20 },
    2: { r: 24, cost: 2.5, speed: [75, 115], pts: 50 },
    1: { r: 13, cost: 1.5, speed: [110, 160], pts: 100 }
  };
  const ENERGY_MAX = 10;

  // shortest wrapped offset from a to b on a torus of size L
  const wrapD = (a, b, L) => { let d = b - a; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; };
  // offset to a rock: rocks still flying in from off-screen don't wrap yet
  const offX = (x, r) => (r.fresh > 0 ? r.x - x : wrapD(x, r.x, W));
  const offY = (y, r) => (r.fresh > 0 ? r.y - y : wrapD(y, r.y, H));

  Arcade.register({
    id: 'asteroids',
    title: 'Asteroids',
    tagline: 'A pilot trying to survive against the player hurling the rocks.',
    flip: 'the computer flies the ship, you send the asteroids.',
    blurb: 'The pilot has 3 lives and has to survive 5 waves of 25 seconds each. The thrower spends energy to launch asteroids from the edge of the screen. Energy recharges faster every wave, and big rocks split into smaller, faster ones when shot.',
    menuText: 'The pilot wins by surviving <b>5 waves</b>. The thrower wins by taking all <b>3 lives</b>. The thrower gets more energy every wave.',
    sides: [
      { key: 'pilot', label: 'Pilot', human: '← → to turn, ↑ to thrust, Space to fire.', cpu: 'Works out when each rock will pass closest, dodges the urgent ones, and leads its shots on the rest. It has to rotate to aim like you do, and its aim and reactions sharpen each wave.' },
      { key: 'thrower', label: 'Thrower', human: 'Click anywhere to throw an asteroid from the nearest edge toward that point. 1 / 2 / 3 or the mouse wheel picks the size (small, medium, big).', cpu: 'Starts by throwing random rocks. Later it leads the ship, fires from behind it, and sends crossfire from both sides.' }
    ],
    defaults: { pilot: 'cpu', thrower: 'human' },

    thumb(ctx, w) {
      const s = w / W;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
      [[160, 120, 44], [620, 420, 38], [560, 150, 22], [250, 460, 16]].forEach(([x, y, r], k) => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2, rr = r * (0.8 + ((i * 7 + k) % 5) * 0.08);
          ctx.lineTo((x + Math.cos(a) * rr) * s, (y + Math.sin(a) * rr) * s);
        }
        ctx.closePath(); ctx.stroke();
      });
      ctx.save(); ctx.translate(400 * s, 300 * s); ctx.rotate(-0.6);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, -11); ctx.lineTo(-7, 0); ctx.lineTo(-12, 11); ctx.closePath(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      [[460, 250], [500, 220]].forEach(([x, y]) => ctx.fillRect(x * s, y * s, 3, 3));
    },

    create(api) {
      let wave = 1, waveT = 0;
      let lives = 3, score = 0;
      let energy = 5, size = 3;
      const ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2, respawn: 0, thrusting: false };
      let bullets = [], rocks = [], sparks = [];
      let cool = 0;
      let gameDone = false;
      const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, b: Math.random() }));

      const regen = () => 0.7 + (wave - 1) * 0.26;        // energy per second
      const maxRocks = () => 9 + wave * 2;
      const speedMul = () => 1 + (wave - 1) * 0.1;

      function makeRock(x, y, vx, vy, sz) {
        const verts = [];
        const n = 9 + sz * 2;
        for (let i = 0; i < n; i++) verts.push(0.75 + Math.random() * 0.35);
        rocks.push({ x, y, vx, vy, sz, r: SIZES[sz].r, rot: 0, spin: U.rand(-1, 1), verts, fresh: 1.2 });
      }

      // Launch from the screen edge nearest the aim point, heading at the aim point.
      function launch(tx, ty, sz) {
        const cost = SIZES[sz].cost;
        if (energy < cost) { if (api.isHuman('thrower')) api.toast('Not enough energy', C.muted); return false; }
        if (rocks.length >= maxRocks()) { if (api.isHuman('thrower')) api.toast('Too many rocks on screen', C.muted); return false; }
        const r = SIZES[sz].r;
        const dl = tx, dr = W - tx, dt = ty, db = H - ty;
        const m = Math.min(dl, dr, dt, db);
        let sx, sy;
        if (m === dl) { sx = -r; sy = ty + U.rand(-120, 120); }
        else if (m === dr) { sx = W + r; sy = ty + U.rand(-120, 120); }
        else if (m === dt) { sx = tx + U.rand(-120, 120); sy = -r; }
        else { sx = tx + U.rand(-120, 120); sy = H + r; }
        const ang = Math.atan2(ty - sy, tx - sx);
        const sp = U.rand(...SIZES[sz].speed) * speedMul();
        makeRock(sx, sy, Math.cos(ang) * sp, Math.sin(ang) * sp, sz);
        energy -= cost;
        return true;
      }

      /* ---------- computer thrower ---------- */
      let throwThink = 1.5;
      const throwerSkill = () => Math.min(0.6, 0.1 + (wave - 1) * 0.13 + waveT / 200);
      function cpuThrow(dt) {
        throwThink -= dt;
        if (throwThink > 0) return;
        const s = throwerSkill();
        throwThink = U.lerp(1.6, 0.45, s) + U.rand(0, 0.5);
        // pick a size it can afford; smarter throwers mix in fast small rocks
        const sz = U.chance(s * 0.5) ? U.pick([1, 2]) : U.pick([2, 3, 3]);
        if (energy < SIZES[sz].cost) return;
        if (!U.chance(s)) return void launch(U.rand(80, W - 80), U.rand(80, H - 80), sz);
        // aim where the ship will be, and come from behind it
        const t = U.rand(0.8, 1.6);
        const tx = U.clamp(ship.x + ship.vx * t, 30, W - 30), ty = U.clamp(ship.y + ship.vy * t, 30, H - 30);
        launch(tx, ty, sz);
        // crossfire: a second rock from the far side
        if (U.chance(s * 0.5) && energy >= SIZES[1].cost) launch(W - tx, H - ty, 1);
      }

      /* ---------- computer pilot ---------- */
      const pilotSkill = () => U.clamp(0.15 + (wave - 1) * 0.12 + waveT / 250, 0.15, 0.72);
      const ai = { think: 0, turn: 0, thrust: false, fire: false, aimErr: 0 };

      // time and distance of closest approach between ship and a rock (straight lines, wrap-aware)
      function approach(r) {
        const px = offX(ship.x, r), py = offY(ship.y, r);
        const vx = r.vx - ship.vx, vy = r.vy - ship.vy;
        const vv = vx * vx + vy * vy || 1e-6;
        const t = U.clamp(-(px * vx + py * vy) / vv, 0, 5);
        return { t, d: Math.hypot(px + vx * t, py + vy * t), px, py };
      }

      function cpuPilot(dt) {
        const s = pilotSkill();
        ai.think -= dt;
        if (ai.think <= 0) {
          ai.think = U.lerp(0.28, 0.07, s);
          ai.aimErr = U.gauss() * U.lerp(0.3, 0.05, s);
          decide(s);
        }
        return ai;
      }

      // Try a manoeuvre in a quick simulation: hold (turn, thrust) for `hold` seconds,
      // then coast. Returns the smallest gap to any rock over the next 1.2 s.
      function clearance(turn, thrust, hold, near) {
        let x = 0, y = 0, vx = ship.vx, vy = ship.vy, a = ship.a, worst = Infinity;
        const dt = 1 / 30, drag = Math.exp(-DRAG * dt);
        for (let t = dt; t <= 1.2; t += dt) {
          if (t <= hold) { a += turn * TURN * dt; if (thrust) { vx += Math.cos(a) * THRUST * dt; vy += Math.sin(a) * THRUST * dt; } }
          vx *= drag; vy *= drag;
          x += vx * dt; y += vy * dt;
          for (const n of near) {
            const g = Math.hypot(n.px + n.vx * t - x, n.py + n.vy * t - y) - n.r * 0.9 - SHIP_R;
            if (g < worst) worst = g;
          }
        }
        return worst;
      }

      function decide(s) {
        ai.fire = false; ai.thrust = false; ai.turn = 0; ai.wantAngle = undefined; ai.plan = null;
        if (!ship.alive) return;
        const near = rocks.map(r => ({ r, px: offX(ship.x, r), py: offY(ship.y, r), vx: r.vx, vy: r.vy, sz: r.sz }))
          .filter(n => Math.hypot(n.px, n.py) < 330).map(n => Object.assign(n, { r: n.r.r, rock: n.r }));

        // 1) danger check: if coasting brings a rock too close, pick the best escape manoeuvre
        const margin = U.lerp(8, 26, s);
        if (ship.inv <= 0 && near.length) {
          const idle = clearance(0, false, 0, near);
          if (idle < margin) {
            let best = null;
            for (const turn of [-1, 0, 1]) for (const thrust of [true, false]) for (const hold of [0.25, 0.5, 0.8]) {
              if (!thrust && hold > 0.25) continue;
              // a sloppier pilot misjudges its options a little
              const c = clearance(turn, thrust, hold, near) + U.gauss() * (1 - s) * 18;
              if (!best || c > best.c) best = { c, turn, thrust, hold };
            }
            if (best && best.c > idle) { ai.plan = { turn: best.turn, thrust: best.thrust, t: best.hold }; }
          }
        }

        // 2) aim: the most urgent rock on a collision course, else the easiest nearby target
        let target = null, bestScore = Infinity;
        for (const n of near) {
          const ap = approach(n.rock);
          const onCourse = ap.d < n.r + SHIP_R + 30 && ap.t < 2.5;
          const d = Math.hypot(n.px, n.py);
          const turnCost = Math.abs(U.angleDiff(ship.a, Math.atan2(n.py, n.px))) * 110;
          const sc = (onCourse ? ap.t * 150 : 400 + d) + turnCost;
          if (sc < bestScore) { bestScore = sc; target = n; }
        }
        if (target) {
          const { px, py, vx, vy } = target;
          // intercept: solve |p + v t| = BULLET_V t
          const a = vx * vx + vy * vy - BULLET_V * BULLET_V, b = 2 * (px * vx + py * vy), c = px * px + py * py;
          const disc = b * b - 4 * a * c;
          let t = disc > 0 ? (-b - Math.sqrt(disc)) / (2 * a) : 0;
          if (t < 0) t = (-b + Math.sqrt(Math.max(0, disc))) / (2 * a);
          ai.wantAngle = Math.atan2(py + vy * t, px + vx * t) + ai.aimErr;
          const off = Math.abs(U.angleDiff(ship.a, ai.wantAngle));
          ai.fire = off < Math.atan2(target.r * 0.8, Math.hypot(px, py)) + U.lerp(0.1, 0.02, s);
        } else {
          // nothing close: drift back toward the middle
          const cx = W / 2 - ship.x, cy = H / 2 - ship.y;
          ai.wantAngle = Math.atan2(cy, cx);
          ai.thrust = Math.hypot(cx, cy) > 160 && Math.hypot(ship.vx, ship.vy) < 50 && Math.abs(U.angleDiff(ship.a, ai.wantAngle)) < 0.3;
        }
      }

      /* ---------- shared ship controls ---------- */
      function fire() {
        if (cool > 0 || !ship.alive || bullets.length >= MAX_BULLETS) return;
        cool = FIRE_COOLDOWN;
        bullets.push({
          x: ship.x + Math.cos(ship.a) * SHIP_R, y: ship.y + Math.sin(ship.a) * SHIP_R,
          vx: Math.cos(ship.a) * BULLET_V, vy: Math.sin(ship.a) * BULLET_V, t: BULLET_LIFE
        });
      }

      function explode(x, y, n, col) {
        for (let i = 0; i < n; i++) {
          const a = U.rand(0, Math.PI * 2), sp = U.rand(40, 220);
          sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: U.rand(0.3, 0.9), col });
        }
      }

      function breakRock(i) {
        const r = rocks[i];
        rocks.splice(i, 1);
        score += SIZES[r.sz].pts;
        explode(r.x, r.y, 6 + r.sz * 4, C.muted);
        if (r.sz > 1) {
          for (const k of [-1, 1]) {
            const ang = Math.atan2(r.vy, r.vx) + k * U.rand(0.35, 0.8);
            const sp = U.rand(...SIZES[r.sz - 1].speed) * speedMul();
            makeRock(r.x, r.y, Math.cos(ang) * sp, Math.sin(ang) * sp, r.sz - 1);
            rocks[rocks.length - 1].fresh = 0;
          }
        }
      }

      function shipHit() {
        explode(ship.x, ship.y, 30, C.cyan);
        lives--;
        ship.alive = false;
        ship.respawn = 1.6;
        if (lives <= 0) { gameDone = true; api.end('thrower', `The ship went down in wave ${wave}.`); }
        else api.toast(`Ship lost — ${lives} left`, C.bad);
      }

      function tryRespawn() {
        // wait until the centre is clear
        const clear = rocks.every(r => Math.hypot(offX(W / 2, r), offY(H / 2, r)) > r.r + 90);
        if (!clear) return;
        Object.assign(ship, { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2 });
      }

      return {
        update(dt) {
          for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; }
          sparks = sparks.filter(p => p.t > 0);
          if (gameDone) return;

          // waves
          waveT += dt;
          if (waveT >= WAVE_TIME) {
            if (wave >= WAVES) { gameDone = true; return api.end('pilot', `Survived all ${WAVES} waves with ${lives} ${lives === 1 ? 'life' : 'lives'} left. Score ${score}.`); }
            wave++; waveT = 0;
            api.toast(`Wave ${wave} — more energy for the thrower`, C.warn);
          }
          energy = Math.min(ENERGY_MAX, energy + regen() * dt);

          // thrower
          if (!api.isHuman('thrower')) cpuThrow(dt);

          // pilot input (human keys or computer decisions — same effect either way)
          let turn = 0, thrust = false, shoot = false;
          if (api.isHuman('pilot')) {
            turn = (api.keys.has('ArrowRight') || api.keys.has('KeyD') ? 1 : 0) - (api.keys.has('ArrowLeft') || api.keys.has('KeyA') ? 1 : 0);
            thrust = api.keys.has('ArrowUp') || api.keys.has('KeyW');
            shoot = api.keys.has('Space');
          } else {
            const a = cpuPilot(dt);
            if (a.plan && a.plan.t > 0) {
              // executing an escape manoeuvre
              a.plan.t -= dt;
              turn = a.plan.turn; thrust = a.plan.thrust;
              if (a.plan.t <= 0) a.plan = null;
            } else if (a.wantAngle !== undefined) {
              // re-evaluate the turn every frame so it doesn't overshoot its target angle
              const d = U.angleDiff(ship.a, a.wantAngle);
              turn = Math.abs(d) < TURN * dt ? 0 : Math.sign(d);
              if (Math.abs(d) < TURN * dt) ship.a = a.wantAngle;
              thrust = a.thrust;
            }
            shoot = a.fire;
          }

          cool -= dt;
          if (ship.alive) {
            ship.a += turn * TURN * dt;
            ship.thrusting = thrust;
            if (thrust) { ship.vx += Math.cos(ship.a) * THRUST * dt; ship.vy += Math.sin(ship.a) * THRUST * dt; }
            const drag = Math.exp(-DRAG * dt);
            ship.vx *= drag; ship.vy *= drag;
            const sp = Math.hypot(ship.vx, ship.vy);
            if (sp > MAX_V) { ship.vx *= MAX_V / sp; ship.vy *= MAX_V / sp; }
            ship.x = (ship.x + ship.vx * dt + W) % W;
            ship.y = (ship.y + ship.vy * dt + H) % H;
            ship.inv -= dt;
            if (shoot) fire();
          } else {
            ship.respawn -= dt;
            if (ship.respawn <= 0) tryRespawn();
          }

          for (const b of bullets) { b.x = (b.x + b.vx * dt + W) % W; b.y = (b.y + b.vy * dt + H) % H; b.t -= dt; }
          bullets = bullets.filter(b => b.t > 0);

          for (const r of rocks) {
            r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
            // rocks enter from off-screen, then wrap like everything else
            if (r.fresh > 0) {
              r.fresh -= dt;
              if (r.x > r.r && r.x < W - r.r && r.y > r.r && r.y < H - r.r) r.fresh = 0;
            } else {
              if (r.x < -r.r) r.x += W + 2 * r.r; if (r.x > W + r.r) r.x -= W + 2 * r.r;
              if (r.y < -r.r) r.y += H + 2 * r.r; if (r.y > H + r.r) r.y -= H + 2 * r.r;
            }
          }

          // bullets vs rocks
          for (let i = rocks.length - 1; i >= 0; i--) {
            const r = rocks[i];
            const hit = bullets.findIndex(b => Math.hypot(offX(b.x, r), offY(b.y, r)) < r.r);
            if (hit >= 0) { bullets.splice(hit, 1); breakRock(i); }
          }
          // rocks vs ship
          if (ship.alive && ship.inv <= 0) {
            for (const r of rocks) {
              if (Math.hypot(offX(ship.x, r), offY(ship.y, r)) < r.r * 0.9 + SHIP_R * 0.8) { shipHit(); break; }
            }
          }
        },

        onKey(code) {
          if (!api.isHuman('thrower')) return;
          if (code === 'Digit1') size = 1;
          if (code === 'Digit2') size = 2;
          if (code === 'Digit3') size = 3;
        },
        onWheel(d) { if (api.isHuman('thrower')) size = U.clamp(size - d, 1, 3); },
        onPointer(type, x, y) {
          if (type === 'down' && api.isHuman('thrower')) launch(x, y, size);
        },

        draw(ctx) {
          ctx.fillStyle = C.bg;
          ctx.fillRect(0, 0, W, H);
          for (const s of stars) { ctx.fillStyle = `rgba(200,210,255,${0.15 + s.b * 0.4})`; ctx.fillRect(s.x, s.y, 1.5, 1.5); }

          // rocks
          ctx.lineWidth = 2;
          for (const r of rocks) {
            ctx.save();
            ctx.translate(r.x, r.y); ctx.rotate(r.rot);
            ctx.strokeStyle = r.sz === 1 ? C.warn : r.sz === 2 ? '#c9d2ea' : C.muted;
            ctx.fillStyle = 'rgba(152,164,192,.06)';
            ctx.beginPath();
            r.verts.forEach((v, i) => {
              const a = (i / r.verts.length) * Math.PI * 2;
              ctx.lineTo(Math.cos(a) * r.r * v, Math.sin(a) * r.r * v);
            });
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.restore();
          }

          // bullets
          ctx.fillStyle = '#fff';
          for (const b of bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 2.4, 0, 7); ctx.fill(); }

          // ship
          if (ship.alive && !(ship.inv > 0 && Math.floor(api.time * 10) % 2)) {
            ctx.save();
            ctx.translate(ship.x, ship.y); ctx.rotate(ship.a);
            ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5; ctx.shadowColor = C.cyan; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, -11); ctx.lineTo(-7, 0); ctx.lineTo(-12, 11); ctx.closePath(); ctx.stroke();
            if (ship.thrusting && Math.floor(api.time * 30) % 2) {
              ctx.strokeStyle = C.warn;
              ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(-19, 0); ctx.lineTo(-9, 5); ctx.stroke();
            }
            ctx.restore();
          }
          for (const p of sparks) {
            ctx.globalAlpha = Math.min(1, p.t * 2);
            ctx.fillStyle = p.col;
            ctx.fillRect(p.x, p.y, 2.5, 2.5);
          }
          ctx.globalAlpha = 1;

          // aiming hint for a human thrower
          if (api.isHuman('thrower') && api.pointer.inside) {
            const p = api.pointer;
            ctx.strokeStyle = energy >= SIZES[size].cost ? 'rgba(240,168,60,.7)' : 'rgba(242,92,105,.5)';
            ctx.setLineDash([4, 5]);
            ctx.beginPath(); ctx.arc(p.x, p.y, SIZES[size].r, 0, 7); ctx.stroke();
            ctx.setLineDash([]);
          }

          const who = k => (api.isHuman(k) ? 'YOU' : 'CPU');
          D.hud(ctx, [
            { text: `PILOT · ${who('pilot')}  ${'▲'.repeat(Math.max(0, lives))}`, color: C.cyan, pixel: true },
            { text: `WAVE ${wave}/${WAVES}  ${Math.ceil(WAVE_TIME - waveT)}s`, align: 'center', pixel: true },
            { text: `${who('thrower')} · THROWER`, color: C.warn, align: 'right', pixel: true }
          ]);
          // energy + size selector
          D.bar(ctx, 0, 40, W, 5, energy / ENERGY_MAX, C.warn, C.panel);
          if (api.isHuman('thrower')) {
            const names = { 1: 'SMALL 1.5', 2: 'MEDIUM 2.5', 3: 'BIG 4' };
            [1, 2, 3].forEach((k, i) => {
              D.text(ctx, `${k} ${names[k]}`, W - 330 + i * 110, H - 16, {
                size: 12, color: k === size ? C.warn : C.dim
              });
            });
            D.text(ctx, `energy ${energy.toFixed(1)}`, 16, H - 16, { size: 12, color: C.warn });
          }
          D.text(ctx, `score ${score}`, 16, 60, { size: 12, color: C.muted });
        },
        _state: () => ({ wave, lives, rocks: rocks.length, score })
      };
    }
  });
})();
