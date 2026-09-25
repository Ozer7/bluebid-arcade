/* ==========================================================================
   ASTEROIDS — a pilot against the asteroid thrower.
   The pilot must survive 5 waves (20 seconds each) with 4 lives.
   The thrower launches asteroids from the edges, paid for with energy
   that recharges faster every wave. Big rocks split into smaller ones.

   Fairness: the computer pilot uses the same thrust, turn rate, bullet
   speed and fire cooldown as a human. It has to turn to aim, it reacts
   with human delays, and it misses. The computer thrower pays the same energy costs as a human.
   ========================================================================== */
(function () {
  'use strict';
  const { C, util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const WAVES = 5, WAVE_TIME = 20;
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
    blurb: 'The pilot has 4 lives and has to survive 5 waves of 20 seconds each. The thrower spends energy to launch asteroids from the edge of the screen. Energy recharges faster every wave, and big rocks split into smaller, faster ones when shot.',
    menuText: 'The pilot wins by surviving <b>5 waves</b>. The thrower wins by taking all <b>4 lives</b>. The thrower gets more energy every wave.',
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
      let lives = 4, score = 0;
      let energy = 5, size = 3;
      const ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2, respawn: 0, thrusting: false };
      let bullets = [], rocks = [], sparks = [];
      let cool = 0;
      let gameDone = false;
      const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, b: Math.random() }));

      const regen = () => 0.55 + (wave - 1) * 0.2;        // energy per second
      const maxRocks = () => 6 + wave * 2;
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

      /* ---------- computer thrower (plays like a person) ---------- */
      // People save up and throw in bursts of 2–3 clicks, aim at where the ship
      // is (not where it will be) with some scatter, and start with big rocks.
      // Later they mix in fast small rocks, lead the ship a little, and come
      // at it from behind.
      const tp = new Arcade.Human({ reaction: 0.3 });
      let throwThink = 1.5, burstLeft = 0;
      const throwerSkill = () => Math.min(0.6, 0.1 + (wave - 1) * 0.11 + waveT / 300);
      function cpuThrow(dt) {
        throwThink -= dt;
        if (throwThink > 0) return;
        const s = throwerSkill();
        if (burstLeft <= 0) {
          if (energy < U.lerp(8, 5, s)) { throwThink = 0.3; return; }        // saving up
          burstLeft = U.randInt(1, 3);
        }
        const sz = U.chance(0.2 + s * 0.4) ? U.pick([1, 1, 2]) : U.pick([3, 3, 2]);
        if (energy < SIZES[sz].cost) { burstLeft = 0; throwThink = 0.4; return; }
        const lead = U.chance(s) ? U.rand(0.3, 1.2) : 0;
        let tx = ship.x + ship.vx * lead + tp.scatter(U.lerp(90, 30, s));
        let ty = ship.y + ship.vy * lead + tp.scatter(U.lerp(90, 30, s));
        if (U.chance(s * 0.4)) { tx -= Math.cos(ship.a) * 60; ty -= Math.sin(ship.a) * 60; }   // from behind
        launch(U.clamp(tx, 20, W - 20), U.clamp(ty, 20, H - 20), sz);
        burstLeft--;
        throwThink = burstLeft > 0 ? U.rand(0.22, 0.45) : tp.react(true) + U.rand(0.6, 1.8);
      }

      /* ---------- computer pilot (plays like a person) ---------- */
      // Stays near the middle, turns toward the nearest rock and fires in bursts,
      // leading its shots only partly. New rocks are noticed a reaction-time
      // after they appear. When one gets too close it commits to a single panic
      // escape — it doesn't compute the best one — and it's bad at braking, so it
      // drifts toward the edges where wrapping rocks catch it.
      const pilotSkill = () => U.clamp(0.55 + (wave - 1) * 0.1 + waveT / 250, 0.55, 0.92);
      const pp = new Arcade.Human({ reaction: 0.25 });
      const ai = { known: new WeakMap(), target: null, retarget: 0, aimErr: 0, escape: null, homeBurst: 0, out: {} };

      // time and distance of closest approach between ship and a rock (straight lines, wrap-aware)
      function approach(r) {
        const px = offX(ship.x, r), py = offY(ship.y, r);
        const vx = r.vx - ship.vx, vy = r.vy - ship.vy;
        const vv = vx * vx + vy * vy || 1e-6;
        const t = U.clamp(-(px * vx + py * vy) / vv, 0, 5);
        return { t, d: Math.hypot(px + vx * t, py + vy * t), px, py };
      }

      function cpuPilot(dt) {
        const now = api.time, s = pilotSkill();
        const out = (ai.out = { turn: 0, thrust: false, fire: false, wantAngle: undefined });
        if (!ship.alive) return out;
        for (const r of rocks) if (!ai.known.has(r)) ai.known.set(r, now + pp.react(true));
        const seen = rocks.filter(r => ai.known.get(r) <= now);
        pp.pressure = U.clamp(seen.filter(r => Math.hypot(offX(ship.x, r), offY(ship.y, r)) < 220).length / 5, 0, 1);

        // committed to an escape: turn that way and thrust once roughly facing it
        if (ai.escape && now < ai.escape.until) {
          out.wantAngle = ai.escape.angle;
          out.thrust = Math.abs(U.angleDiff(ship.a, ai.escape.angle)) < 0.7;
          out.fire = true;                                   // people keep mashing fire while escaping
          return out;
        }
        ai.escape = null;

        // danger: a seen rock about to pass too close
        if (ship.inv <= 0) {
          let danger = null;
          for (const r of seen) {
            const ap = approach(r);
            if (ap.d < r.r + SHIP_R + 22 && ap.t < U.lerp(0.8, 1.3, s) && (!danger || ap.t < danger.ap.t)) danger = { r, ap };
          }
          if (danger && !pp.lapsed(0.25)) {
            const { r, ap } = danger;
            const toRock = Math.atan2(ap.py, ap.px);
            // small rock dead ahead? shoot it instead of running
            if (r.sz === 1 && Math.abs(U.angleDiff(ship.a, toRock)) < 0.3 && U.chance(0.6)) { out.wantAngle = toRock; out.fire = true; return out; }
            const rvx = r.vx - ship.vx, rvy = r.vy - ship.vy;
            let ex = -(ap.px + rvx * ap.t), ey = -(ap.py + rvy * ap.t);
            if (Math.hypot(ex, ey) < 4) { ex = -rvy; ey = rvx; }
            let esc = Math.atan2(ey, ex);
            // if the ship already points roughly sideways to the rock, people just hit thrust
            if (Math.abs(U.angleDiff(ship.a, esc)) < 0.6) esc = ship.a;
            ai.escape = { angle: esc + pp.scatter(U.lerp(0.3, 0.1, s)), until: now + U.rand(0.3, 0.55) };
            out.wantAngle = ai.escape.angle;
            out.thrust = Math.abs(U.angleDiff(ship.a, esc)) < 0.7;
            return out;
          }
        }

        // hunting: re-pick a target every so often (nearest rock; better players go for small fast ones)
        ai.retarget -= dt;
        if (ai.retarget <= 0 || !rocks.includes(ai.target)) {
          ai.retarget = U.rand(0.35, 0.8);
          let best = null, bestScore = Infinity;
          for (const r of seen) {
            const d = Math.hypot(offX(ship.x, r), offY(ship.y, r));
            const sc = d - (s > 0.6 ? (3 - r.sz) * 40 : 0) + Math.abs(U.angleDiff(ship.a, Math.atan2(offY(ship.y, r), offX(ship.x, r)))) * 60;
            if (sc < bestScore) { bestScore = sc; best = r; }
          }
          ai.target = best;
          ai.aimErr = pp.scatter(U.lerp(0.12, 0.04, s));
        }
        const r = ai.target;
        if (r) {
          const px = offX(ship.x, r), py = offY(ship.y, r);
          const d = Math.hypot(px, py);
          const lead = U.lerp(0.6, 0.95, s) * (d / BULLET_V);        // only partly leads the shot
          const ang = Math.atan2(py + r.vy * lead, px + r.vx * lead) + ai.aimErr;
          out.wantAngle = ang;
          out.fire = Math.abs(U.angleDiff(ship.a, ang)) < 0.28 && d < 420;   // bursts when roughly lined up
        }
        // drift back toward the middle now and then — and forget to brake
        const cx = W / 2 - ship.x, cy = H / 2 - ship.y;
        if (Math.hypot(cx, cy) > 200 && !r) {
          out.wantAngle = Math.atan2(cy, cx);
          out.thrust = Math.abs(U.angleDiff(ship.a, out.wantAngle)) < 0.3 && Math.hypot(ship.vx, ship.vy) < 90;
        }
        return out;
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
            if (a.wantAngle !== undefined) {
              // hold the turn key until roughly pointed the right way (a little overshoot is normal)
              const d = U.angleDiff(ship.a, a.wantAngle);
              turn = Math.abs(d) < 0.05 ? 0 : Math.sign(d);
            }
            thrust = a.thrust;
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
