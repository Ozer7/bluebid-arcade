/* ==========================================================================
   PICNIC DEFENDER (my own game: the tablecloth trick, used as a weapon)
   Bugs march across a picnic table toward the food. The picnic side grabs
   the tablecloth: a slow drag carries everything on it, a fast flick slides
   the cloth out from under the dishes (inertia, like the magician's trick)
   and sends a ripple across it that throws bugs off the table.
   Picnic wins by keeping at least 4 of its 6 dishes for 2:00. Bugs win
   when 3 dishes are eaten, spilled or knocked off.

   Rules for both sides (human and computer alike):
     • ants need a flick of 350+, beetles 1000+, the queen 1300+;
       an ant that is already eating holds on 1.5× tighter
     • a flick harder than 1150 tips over any lemonade glass in its path
     • the bugs side spends crumbs that come in at a fixed rate:
       ant 1, beetle 4, queen 12
     • wave 1 is as hard as the old wave 6, and every wave doubles the difficulty
       (crumbs per second, how fast bugs are placed, and bug speed, capped at 4x)
   Both computer players use Arcade.Human, so they react, aim and move the
   mouse at human speed.
   ========================================================================== */
(function () {
  'use strict';
  const { util: U, draw: D } = Arcade;

  const W = 800, H = 600;
  const TB = { x: 150, y: 56, w: 500, h: 532 };             // table top
  const TCX = TB.x + TB.w / 2, TCY = TB.y + TB.h / 2;
  const CW = 424, CH = 456;                                 // tablecloth
  const MAXOFF = 80;                                        // how far the cloth can be pulled
  const MAXF = 1800;                                        // strongest flick, px/s
  const NEED = { ant: 350, beetle: 1000, queen: 1300, ladybug: 350 };
  const GLASS_TIPS = 1150;
  const HALF = () => CW / 4;                                // half-width of a ripple: each flick's ripple is half the tablecloth wide
  const COST = { ant: 1, beetle: 4, queen: 12 };
  const PTS = { ant: 10, beetle: 50, queen: 150 };
  const SURVIVE = 120;                                      // seconds the picnic must last (an arcade run: 30 s – 3 min)
  const WAVE = 20;                                          // seconds per wave
  const LOSE_AT = 3;                                        // dishes gone when the bugs win
  const DOUBLE = w => Math.pow(2, w - 1);                   // every wave is twice as hard as the one before
  const INCOME = w => 22 * DOUBLE(w);                      // crumbs per second: 22 bugs a second in wave 1, doubling each wave
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // dishes: grip = cloth speed (px/s) above which the cloth slides out from under them
  const KINDS = {
    cake: { r: 34, grip: 260, sturdy: 1700, name: 'cake' },
    pie: { r: 30, grip: 300, sturdy: 1300, name: 'pie' },
    sand: { r: 28, grip: 330, sturdy: 1250, name: 'sandwiches' },
    melon: { r: 28, grip: 330, sturdy: 1250, name: 'watermelon' },
    glass: { r: 15, grip: 240, sturdy: GLASS_TIPS, name: 'lemonade' }    // a smooth glass base slides easily
  };
  const LAYOUT = [['cake', 0, 4], ['pie', -122, -128], ['sand', 122, -128], ['melon', -122, 136], ['glass', 128, 146], ['glass', 0, -165]];
  const POWERS = {
    pepper: { label: 'PEPPER', desc: 'Bugs nearby run away', col: '#3a3a3a' },
    refill: { label: 'REFILL', desc: 'Every dish topped up', col: '#e8c21f' },
    starch: { label: 'STARCH', desc: '3 strong flicks, no spills', col: '#3f8fe0' }
  };
  const RANKS = [
    { at: 2500, name: 'Picnic legend', color: '#ffd23f' },
    { at: 1200, name: 'Tablecloth magician', color: '#c0c8d8' },
    { at: 600, name: 'Cloth flicker', color: '#d08a4a' }
  ];
  const BLADES = Array.from({ length: 200 }, () => ({ x: Math.random() * W, y: Math.random() * H, l: U.rand(4, 9), a: U.rand(-0.5, 0.5), c: Math.random() < 0.5 ? '#3c6a2f' : '#4f7f3a' }));

  /* ---------- drawing helpers (shared by the game and the thumbnail) ---------- */
  function gingham(ctx, x, y, w, h) {
    ctx.fillStyle = '#fbf3e4'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(216,52,63,.42)';
    for (let i = 0; i < w; i += 68) ctx.fillRect(x + i, y, 34, h);
    for (let j = 0; j < h; j += 68) ctx.fillRect(x, y + j, w, 34);
  }
  function plate(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.arc(x + 3, y + 4, r + 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d9d2c4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, 7); ctx.stroke();
  }
  function antShape(ctx, leg) {
    ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = 1.2;
    for (let i = -1; i <= 1; i++) {
      const w = Math.sin(leg + i * 2) * 1.8;
      ctx.beginPath(); ctx.moveTo(i * 2.5, 0); ctx.lineTo(i * 3 + w, -6); ctx.moveTo(i * 2.5, 0); ctx.lineTo(i * 3 - w, 6); ctx.stroke();
    }
    ctx.fillStyle = '#2a1a12'; ctx.beginPath(); ctx.arc(-5, 0, 3.4, 0, 7); ctx.arc(0, 0, 2.4, 0, 7); ctx.arc(4.5, 0, 2.8, 0, 7); ctx.fill();
  }
  function hand(ctx, x, y, down, alpha = 1, scale = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = 2;
    if (down) { ctx.beginPath(); ctx.ellipse(0, 0, 13, 11, 0, 0, 7); ctx.fill(); ctx.stroke(); }
    else {
      D.roundRect(ctx, -9, -4, 18, 20, 6); ctx.fill(); ctx.stroke();
      D.roundRect(ctx, -3, -18, 6, 16, 3); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  Arcade.register({
    id: 'picnic',
    title: 'Picnic Defender',
    year: '2026 · my own game (after the tablecloth trick)',
    history: 'Pulling a tablecloth out from under the dishes is an old magician\'s trick that works because of inertia: pulled fast, the cloth slides under the plates before friction can move them. Taito tested a tablecloth-pulling arcade machine in Tokyo in 2010 (The Tablecloth Hour), and Super Mario Party has it as a minigame; here the cloth becomes a weapon against bugs.',
    scoreSide: 'picnic', scoreName: 'points',
    tagline: 'Flick the tablecloth to throw bugs off the picnic table.',
    flip: 'you send the bugs, the computer flicks the cloth.',
    blurb: 'My own game. The picnic side grabs the tablecloth: slow drags move the dishes, fast flicks send a ripple that throws bugs off the table. The bugs side spends crumbs to send ants, beetles and a queen. The picnic wins by keeping 4 of its 6 dishes for 2:00.',
    menuText: 'The picnic wins by keeping <b>4 of its 6 dishes for 2:00</b>. The bugs win when <b>3 dishes are gone</b>. Ants need a flick of 350, beetles 1000, the queen 1300 (ants hold on tighter once they\'re eating), and a flick over 1150 tips over the lemonade.',
    sides: [
      { key: 'picnic', label: 'Picnic', human: 'Grab the cloth with the mouse. Drag slowly to move dishes; drag fast toward a bug and let go to flick. Hit a bug with the middle of the ripple for full strength. Keys: arrows move the hand, hold Space to grab, let go to flick. Click a power-up to use it. Don\'t flick the ladybugs.', cpu: 'Takes longer to decide when more bugs are coming, moves its hand like a mouse (a fast movement, then often a small correction), and flicks in about 150 ms, a few degrees off and never the same strength twice. Under pressure it rushes and sometimes flicks far too hard; after spilling the lemonade it goes softer for a while. It pulls dishes back from the edge with a slow drag.' },
      { key: 'bugs', label: 'Bugs', human: 'Crumbs come in over time. Press 1 ant (1 crumb), 2 beetle (4), 3 queen (12), then click the table edge, or press I J K L to send from the top, left, bottom or right.', cpu: 'Plays to win: spends every crumb the moment it arrives, favours beetles and the queen, goes after the dish closest to being finished, and spreads its bugs around every side away from your hand (its pointer is hidden). Every wave it earns crumbs twice as fast.' }
    ],
    defaults: { picnic: 'human', bugs: 'cpu' },
    quick: { picnic: 'GRAB THE CLOTH: DRAG SLOWLY TO MOVE DISHES, FLICK AND LET GO TO THROW BUGS', bugs: '1 / 2 / 3 PICKS A BUG · CLICK THE TABLE EDGE (OR I J K L) TO SEND IT' },
    goals: { picnic: 'KEEP 4 OF YOUR 6 DISHES FOR 2:00', bugs: 'GET RID OF 3 DISHES' },
    levels: { label: 'Wave', max: 6 },

    thumb(ctx, w, h) {
      const s = w / W;
      ctx.fillStyle = '#46733a'; ctx.fillRect(0, 0, w, h);
      gingham(ctx, 150 * s, 60 * s, 500 * s, 480 * s);
      plate(ctx, 400 * s, 300 * s, 40 * s);
      ctx.fillStyle = '#f2a3b8'; ctx.beginPath(); ctx.arc(400 * s, 300 * s, 30 * s, 0, 7); ctx.fill();
    },

    create(api) {
      let time = 0, playT = (api.startLevel - 1) * WAVE, wave = api.startLevel, over = false, score = 0;
      let ox = 0, oy = 0, pox = 0, poy = 0, cvx = 0, cvy = 0, relT = 0;   // cloth offset and its velocity
      const dishes = LAYOUT.map(([k, x, y]) => Object.assign({ kind: k, x: TCX + x, y: TCY + y, vx: 0, vy: 0, food: 100, alive: true, wob: 0, fall: 0, warned: false, crunch: 0, eating: false }, KINDS[k]));
      let bugs = [], ripples = [], parts = [], floats = [], powers = [];
      let flung = 0, bestChain = 0, starch = 0, sinceFlick = 0, ladyT = 18, powerT = 16;
      let shake = 0, lastFlick = 0, lastFlickT = -9;

      // hand + grab, shared by mouse, keyboard and the computer
      const hnd = { x: TCX, y: TCY + 120, vx: 0, vy: 0, by: null };   // by: 'mouse' | 'keys' | 'cpu'
      let grab = null, hist = [];

      // coaching: first time a human plays the picnic, teach the two moves before any bugs come
      let coached = false;
      try { coached = localStorage.getItem('arcade:picnic:coached') === '1'; } catch { /* ignore */ }
      let coach = api.isHuman('picnic') && api.startLevel === 1 ? (coached ? { step: 3, t: 0 } : { step: 0, t: 0, acc: 0 }) : null;
      const coaching = () => coach && coach.step < 3;

      /* ---------- geometry ---------- */
      const cloth = () => ({ x: TCX - CW / 2 + ox, y: TCY - CH / 2 + oy, w: CW, h: CH });
      const onCloth = (x, y) => { const c = cloth(); return x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h; };
      const onTable = (x, y) => x > TB.x && x < TB.x + TB.w && y > TB.y && y < TB.y + TB.h;
      const alive = () => dishes.filter(d => d.alive);
      function float(x, y, txt, col = '#fff3c4', size = 10) { floats.push({ x, y, txt, col, size, t: 1 }); }
      function burst(x, y, col, n = 10, sp = 150) {
        for (let i = 0; i < n; i++) { const a = U.rand(0, 7), s = U.rand(0.3, 1) * sp; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: U.rand(0.4, 0.8), col, r: U.rand(1.5, 3.5) }); }
      }

      /* ---------- shared picnic actions ---------- */
      function powerAt(x, y) { return powers.find(p => p.life > 0 && U.dist(p.x, p.y, x, y) < 30); }
      function usePower(p) {
        p.life = 0;
        const P = POWERS[p.type];
        api.toast(`${P.label}: ${P.desc}`, P.col === '#3a3a3a' ? '#ff8a8a' : P.col);
        api.sfx('point');
        burst(p.x, p.y, P.col, 16, 180);
        if (p.type === 'pepper') for (const b of bugs) if (b.state !== 'off' && U.dist(b.x, b.y, p.x, p.y) < 190) { b.state = 'flee'; b.t = 4; b.dish = null; b.ang = Math.atan2(b.y - p.y, b.x - p.x); }
        if (p.type === 'refill') for (const d of dishes) if (d.alive) { d.food = Math.min(100, d.food + 40); d.warned = d.food < 30; }
        if (p.type === 'starch') starch = 3;
      }
      function grabAt(x, y, by) {
        if (over) return;
        const p = powerAt(x, y);
        if (p) return usePower(p);
        hnd.x = x; hnd.y = y; hnd.by = by;
        grab = { sx: x, sy: y, ox, oy, speed: 0, dist: 0 };
        hist = [{ x, y, t: now() }];
      }
      function dragTo(x, y) {
        hnd.x = x; hnd.y = y;
        if (!grab) return;
        grab.dist = Math.max(grab.dist, U.dist(grab.sx, grab.sy, x, y));
        ox = U.clamp(grab.ox + x - grab.sx, -MAXOFF, MAXOFF);
        oy = U.clamp(grab.oy + y - grab.sy, -MAXOFF, MAXOFF);
        const t = now();
        hist.push({ x, y, t });
        while (hist.length > 2 && t - hist[0].t > 90) hist.shift();
        const a = hist[0], dt = Math.max(16, t - a.t);
        grab.speed = Math.min(MAXF, U.dist(a.x, a.y, x, y) / dt * 1000);
      }
      // let go: a fast enough release sends a ripple (vx, vy in px/s)
      function release(vx, vy) {
        if (!grab) return;
        const sp = Math.min(MAXF, Math.hypot(vx, vy));
        if (sp >= 280) flick(hnd.x, hnd.y, vx, vy, sp);
        else if (grab.dist > 30 && hnd.by !== 'cpu' && (!coach || coach.step >= 1)) float(hnd.x, hnd.y - 20, 'TOO SLOW: MOVE FAST, THEN LET GO', '#ffd0a0', 8);
        grab = null; hist = []; relT = 0.25;
      }
      function releaseFromHistory() {
        if (!grab) return;
        const t = now();
        if (hist.length < 2) return release(0, 0);
        const a = hist[0], b = hist[hist.length - 1], dt = Math.max(16, t - a.t);
        if (t - b.t > 140) return release(0, 0);                        // stopped before letting go
        release((b.x - a.x) / dt * 1000, (b.y - a.y) / dt * 1000);
      }
      function flick(x, y, vx, vy, power) {
        const c = cloth(), m = Math.hypot(vx, vy) || 1;
        let st = false;
        if (starch > 0) { starch--; power = Math.min(2300, power * 1.5); st = true; }
        ripples.push({ ox: U.clamp(x, c.x, c.x + c.w), oy: U.clamp(y, c.y, c.y + c.h), dx: vx / m, dy: vy / m, amp: power, cur: power, f: 0, hit: new Set(), n: 0, starch: st });
        sinceFlick = 0; lastFlick = power; lastFlickT = time;
        shake = Math.min(8, power / 220);
        api.sfx('launch');
        const lbl = power >= NEED.queen ? 'MEGA FLICK' : power >= NEED.beetle ? 'HARD FLICK' : 'FLICK!';
        float(x, y - 18, lbl, power >= NEED.beetle ? '#ff8a8a' : '#ffffff', 10);
      }
      function hitBy(r, o) {
        const ex = o.x - r.ox, ey = o.y - r.oy, s = ex * r.dx + ey * r.dy, perp = Math.abs(ex * r.dy - ey * r.dx);
        return s > r.f - 26 && s < r.f + 26 && perp < HALF(r.f);
      }
      // a ripple is strongest along its centre line and fades toward its sides
      function strength(r, o) {
        const perp = Math.abs((o.x - r.ox) * r.dy - (o.y - r.oy) * r.dx);
        return r.cur * (1 - 0.55 * Math.min(1, perp / HALF(r.f)));
      }

      /* ---------- bugs ---------- */
      // Ant behaviour follows field studies of foraging ants: scouts wander
      // until they find food, then the path they took becomes a scent trail
      // that later ants follow in a line; an ant that finds food recruits the
      // searchers near it; walking speed varies a lot from ant to ant (about
      // 1.07 ± 0.45 m/min in Argentine ants, sped up here like a time-lapse);
      // and ants stop for a moment every few seconds.
      let trails = [];                                            // scent trails: {pts:[{x,y}], dish, str}
      const BASE_SP = { ant: 54, beetle: 40, queen: 28, ladybug: 44 };
      const SIZE = { ant: 5, beetle: 9, queen: 12, ladybug: 7 };
      function makeBug(type, x, y) {
        const spread = type === 'ant' ? 0.35 : 0.08;              // ants differ a lot in speed; beetles hardly
        const sp = U.clamp(BASE_SP[type] * Math.exp(U.gauss() * spread - spread * spread / 2), BASE_SP[type] * 0.5, BASE_SP[type] * 1.8) * 1.5 * Math.min(4, DOUBLE(wave));                // wave 1 = old wave 6 speed, doubling each wave up to 4x
        const b = { type, x, y, vx: 0, vy: 0, state: 'walk', t: 0, ang: Math.atan2(TCY - y, TCX - x), sp, r: SIZE[type], dish: null, ea: 0, chain: 1, spin: 0, leg: U.rand(0, 7), life: 14, spawnT: 4,
          trail: null, used: null, ti: 0, path: null, goal: null, pause: U.rand(1, 4) };
        if (type === 'ant') joinTrail(b);
        return b;
      }
      // an ant arriving near the start of a fresh scent trail follows it; otherwise it scouts
      function joinTrail(b) {
        let best = null, bd = 70;
        for (const t of trails) {
          if (t.str < 0.2 || !t.dish.alive) continue;
          const d = U.dist(b.x, b.y, t.pts[0].x, t.pts[0].y);
          if (d < bd) { bd = d; best = t; }
        }
        b.trail = best; b.used = best; b.ti = 0; b.goal = best ? best.dish : null;
        b.path = best ? null : [{ x: b.x, y: b.y }];
      }
      function lost(b) {                                          // knocked off its trail: start searching again
        b.state = 'walk'; b.dish = null; b.goal = null; b.trail = null; b.used = null;
        if (b.type === 'ant') b.path = [{ x: b.x, y: b.y }];
      }
      function walk(b, dt) {
        if (b.type === 'ant') {                                   // stop-and-go
          b.pause -= dt;
          if (b.pause < 0) { if (b.pause < -U.rand(0.15, 0.45)) b.pause = U.rand(1.5, 4.5); return; }
        }
        let tx, ty, wander;
        const t = b.trail;
        if (t && (t.str < 0.15 || !t.dish.alive)) b.trail = null;
        if (b.trail) {
          const p = b.trail.pts[b.ti];
          tx = p.x; ty = p.y; wander = 0.15;
          if (U.dist(b.x, b.y, tx, ty) < 9 && ++b.ti >= b.trail.pts.length) b.trail = null;
        } else {
          const d = b.goal && b.goal.alive ? b.goal : nearestDish(b);
          if (!d) return;
          b.goal = d; tx = d.x; ty = d.y;
          wander = b.path ? 0.9 : b.type === 'ant' ? 0.3 : 0.12;     // scouts zig-zag while they search
        }
        // correlated random walk: turn partly toward where it's going, plus noise
        b.ang += U.angleDiff(b.ang, Math.atan2(ty - b.y, tx - b.x)) * Math.min(1, dt * (b.path ? 2.2 : 6)) + U.gauss() * wander * Math.sqrt(dt) * 2;
        b.x += Math.cos(b.ang) * b.sp * dt; b.y += Math.sin(b.ang) * b.sp * dt;
        if (b.path) { const l = b.path[b.path.length - 1]; if (U.dist(b.x, b.y, l.x, l.y) > 12) b.path.push({ x: b.x, y: b.y }); }
        const d = b.goal;
        if (d && d.alive && U.dist(b.x, b.y, d.x, d.y) < d.r + 4) arrive(b, d);
      }
      function arrive(b, d) {
        b.state = 'eat'; b.dish = d; b.trail = null;
        // spread out around the dish instead of piling up
        const taken = bugs.filter(o => o !== b && o.state === 'eat' && o.dish === d).map(o => o.ea);
        let ea = Math.atan2(b.y - d.y, b.x - d.x);
        for (let k = 0; k < 8 && taken.some(a => Math.abs(U.angleDiff(a, ea)) < 0.45); k++) ea += 0.5 * (k + 1) * (k % 2 ? -1 : 1);
        b.ea = ea;
        if (b.type !== 'ant') return;
        if (b.used) b.used.str = Math.min(1, b.used.str + 0.25);     // walking the trail refreshes its scent
        if (b.path) {                                               // a scout found food: its path becomes a trail
          if (b.path.length > 2) trails.push({ pts: b.path, dish: d, str: 1 });
          b.path = null;
          for (const o of bugs) if (o.type === 'ant' && o.state === 'walk' && o.path && U.dist(o.x, o.y, b.x, b.y) < 140) o.goal = d;   // recruitment
        }
      }
      // a point just inside the table edge: side 0 top, 1 right, 2 bottom, 3 left
      function edgePoint(side, along = Math.random()) {
        const m = 10;
        if (side === 0) return { x: TB.x + 20 + along * (TB.w - 40), y: TB.y + m };
        if (side === 1) return { x: TB.x + TB.w - m, y: TB.y + 20 + along * (TB.h - 40) };
        if (side === 2) return { x: TB.x + 20 + along * (TB.w - 40), y: TB.y + TB.h - m };
        return { x: TB.x + m, y: TB.y + 20 + along * (TB.h - 40) };
      }
      const edgeDist = o => Math.min(o.x - TB.x, TB.x + TB.w - o.x, o.y - TB.y, TB.y + TB.h - o.y);
      function nearestDish(b) {
        let best = null, bd = 1e9;
        for (const d of dishes) { if (!d.alive) continue; const dd = U.dist(d.x, d.y, b.x, b.y); if (dd < bd) { bd = dd; best = d; } }
        return best;
      }
      function flungOff(b) {
        b.state = 'off'; b.t = 1;
        if (b.type === 'ladybug') { score = Math.max(0, score - 30); float(b.x, b.y, 'NOT THE LADYBUG! -30', '#ff9a9a'); api.sfx('lose'); return; }
        const pts = PTS[b.type] * b.chain;
        score += pts; flung++;
        float(U.clamp(b.x, 160, 640), U.clamp(b.y, 70, 580), `+${pts}${b.chain > 1 ? ' x' + b.chain : ''}`, b.chain > 2 || b.type !== 'ant' ? '#ffe066' : '#fff3c4', b.chain > 2 || b.type !== 'ant' ? 12 : 10);
        api.sfx('brick', { f: 500 + Math.min(b.chain, 10) * 110 });
      }

      /* ---------- waves ----------
         Each wave is 20 s and twice as hard as the one before. There used to be
         a 2-second regrouping pause at the end of each wave; play-testers found
         the game too easy, so it was removed and the pressure never lets up. */
      const breather = () => false;                                   // no regrouping pause between waves: the pressure never lets up

      /* ---------- shared bugs action: spend crumbs to send a bug ---------- */
      let crumbs = 56 + (api.startLevel - 1) * 15, pick = 'ant';
      const unlocked = () => true;                                   // beetles and the queen from the start
      function send(type, side, along) {
        if (over || coaching()) return false;
        if (breather()) { if (api.isHuman('bugs')) api.toast('The bugs regroup: wait for the next wave'); return false; }
        if (!unlocked(type)) { if (api.isHuman('bugs')) api.toast(type === 'beetle' ? 'Beetles from wave 2' : 'Queen from wave 3'); return false; }
        if (crumbs < COST[type]) { if (api.isHuman('bugs')) api.toast('Not enough crumbs'); return false; }
        if (bugs.length > 600) return false;                      // keep the frame rate smooth: the table is already swarming
        crumbs -= COST[type];
        const p = edgePoint(side, along);
        bugs.push(makeBug(type, p.x, p.y));
        if (type === 'queen') api.sfx('siren');
        return true;
      }
      // Level select: a later wave starts the way a real game would look by then: the score so
      // far, dishes already nibbled, and a swarm of ants (and a beetle) already crawling in.
      if (api.startLevel > 1) {
        score = (wave - 1) * 260;
        for (const d of dishes) d.food = 100 - (wave - 1) * 6;
        for (let i = 0; i < wave * 2 + 1; i++) { const p = edgePoint(U.randInt(0, 3)); bugs.push(makeBug('ant', p.x, p.y)); }
        if (unlocked('beetle')) { const p = edgePoint(U.randInt(0, 3)); bugs.push(makeBug('beetle', p.x, p.y)); }
      }
      // the side of the table a point is nearest to, and how far along it
      function sideOf(x, y) {
        const d = [y - TB.y, TB.x + TB.w - x, TB.y + TB.h - y, x - TB.x], side = d.indexOf(Math.min(...d));
        const along = side % 2 === 0 ? (x - TB.x - 20) / (TB.w - 40) : (y - TB.y - 20) / (TB.h - 40);
        return { side, along: U.clamp(along, 0, 1), dist: d[side] };
      }

      /* ---------- how a person moves a mouse (shared by both computer players) ----------
         A pointing movement is a fast first movement that lands a little off
         target, then, about 65% of the time, a small correction (the
         optimized-submovement model). Speed along the way is bell-shaped
         (minimum jerk) and the path bows slightly. Time comes from Fitts' law. */
      const mj = k => k * k * k * (10 - 15 * k + 6 * k * k);
      function aim(steps, brain, skill, pos, x, y, width) {
        const dist = U.dist(pos.x, pos.y, x, y);
        if (dist < 2) return;
        const sd = (dist * 0.045 + 3) * (1 + brain.pressure * 0.8);
        const ex = x + U.gauss() * sd, ey = y + U.gauss() * sd;
        pushMove(steps, pos, ex, ey, brain.point(dist, width) * U.lerp(1, 0.85, brain.pressure));
        const err = U.dist(ex, ey, x, y);
        if (err > width * 0.25 && U.chance(0.65 + skill * 0.2)) pushMove(steps, pos, x + U.gauss() * 2, y + U.gauss() * 2, Math.max(0.08, brain.point(err, width)));
      }
      function pushMove(steps, pos, x, y, dur) {
        const dx = x - pos.x, dy = y - pos.y, L = Math.hypot(dx, dy) || 1;
        steps.push({ k: 'move', x0: pos.x, y0: pos.y, x1: x, y1: y, dur, nx: -dy / L, ny: dx / L, bow: L * U.rand(-0.06, 0.06) });
        pos.x = x; pos.y = y;
      }
      function along(s, k) { const e = mj(k), bow = Math.sin(Math.PI * e) * s.bow; return { x: U.lerp(s.x0, s.x1, e) + s.nx * bow, y: U.lerp(s.y0, s.y1, e) + s.ny * bow }; }

      /* ---------- computer picnic (plays like a person) ----------
         • picking between several bugs takes longer the more there are
           (Hick-Hyman: about 150 ms more for every doubling of choices)
         • a mouse flick takes about 151 ms (sd 53) and comes out about 4° off
           the intended direction (Moyle & Cockburn); its strength varies
         • under pressure it moves faster but less accurately, and now and then
           flicks far too hard; after spilling a glass it flicks softer for a while
         • it rescues a dish near the edge with a slow drag, like a person would */
      const pBrain = new Arcade.Human({ reaction: 0.2 });
      let pSteps = [], spillMemory = 0;
      const pSkill = () => Math.min(0.9, 0.75 + playT / 150);
      function threat(b) {
        if (b.state === 'off' || b.state === 'fly' || b.type === 'ladybug' || !onCloth(b.x, b.y)) return -1;
        const d = nearestDish(b);
        if (!d) return -1;
        let s = b.state === 'eat' ? 3 + (100 - d.food) / 40 : 2 - U.dist(b.x, b.y, d.x, d.y) / 220;
        if (b.type === 'queen') s += 1.5;
        if (b.type === 'beetle') s += 0.5;
        return s + U.gauss() * 0.4 * (1 - pSkill());
      }
      function inPath(r, o) {
        const ex = o.x - r.ox, ey = o.y - r.oy, s = ex * r.dx + ey * r.dy, perp = Math.abs(ex * r.dy - ey * r.dx);
        return s > 0 && s < 500 && perp < HALF(s);
      }
      function cpuPicnic(dt) {
        pBrain.pressure = U.clamp(bugs.filter(b => b.state === 'eat').length / 6 + (6 - alive().length) * 0.08, 0, 1);
        if (spillMemory > 0) spillMemory -= dt;
        if (!pSteps.length) planPicnic();
        const s = pSteps[0];
        if (!s) return;
        s.t = (s.t || 0) + dt;
        const k = Math.min(1, s.t / s.dur);
        if (s.k === 'wait') { if (k >= 1) pSteps.shift(); return; }
        if (s.k === 'move') { const p = along(s, k); hnd.x = p.x; hnd.y = p.y; hnd.by = 'cpu'; if (k >= 1) pSteps.shift(); return; }
        if (s.k === 'press') {
          if (k < 1) return;
          pSteps.shift();
          if (s.tap) { const p = powerAt(hnd.x, hnd.y); if (p) usePower(p); } else grabAt(hnd.x, hnd.y, 'cpu');
          return;
        }
        // flick or slow drag: the hand pushes the cloth along a minimum-jerk path, then lets go
        if (!grab) { pSteps.shift(); return; }
        if (s.x0 === undefined) { s.x0 = hnd.x; s.y0 = hnd.y; }
        const e = mj(k);
        dragTo(s.x0 + s.dx * s.len * e, s.y0 + s.dy * s.len * e);
        if (k >= 1) { pSteps.shift(); release(s.k === 'flick' ? s.dx * s.power : 0, s.k === 'flick' ? s.dy * s.power : 0); }
      }
      function planPicnic() {
        const st = pSteps, pos = { x: hnd.x, y: hnd.y }, sk = pSkill();
        const wait = dur => st.push({ k: 'wait', dur });
        // a dish drifting near the edge: pull it back with a slow drag
        const near = dishes.find(d => d.alive && edgeDist(d) < d.r + 30 && onCloth(d.x, d.y));
        if (near && U.chance(0.4 + sk * 0.5)) {
          wait(pBrain.react(true));
          const dir = Math.atan2(TCY - near.y, TCX - near.x), gx = near.x + Math.cos(dir) * (near.r + 24), gy = near.y + Math.sin(dir) * (near.r + 24);
          aim(st, pBrain, sk, pos, gx, gy, 40);
          const len = U.rand(55, 80);
          st.push({ k: 'press', dur: 0.06 }, { k: 'drag', dur: len / U.rand(110, 170), dx: Math.cos(dir), dy: Math.sin(dir), len });
          wait(pBrain.react());
          return;
        }
        const scored = bugs.map(b => ({ b, s: threat(b) })).filter(o => o.s > 0);
        const p = powers.find(q => q.life > 2);
        if (p && !scored.some(o => o.s > 2.5) && U.chance(0.5)) {
          wait(pBrain.react());
          aim(st, pBrain, sk, pos, p.x, p.y, 36);
          st.push({ k: 'press', dur: 0.06, tap: true });
          wait(pBrain.react());
          return;
        }
        if (!scored.length) {                                       // nothing to do: rest the hand, glance around
          if (U.chance(0.3)) aim(st, pBrain, sk, pos, U.lerp(pos.x, TCX, 0.3) + U.gauss() * 20, U.lerp(pos.y, TCY + 120, 0.3) + U.gauss() * 20, 60);
          wait(U.rand(0.25, 0.5));
          return;
        }
        // a skilled player goes for groups: one ripple can take several bugs
        for (const o of scored) o.s += sk * 0.35 * bugs.filter(x => x !== o.b && x.state === 'walk' && U.dist(x.x, x.y, o.b.x, o.b.y) < 70).length;
        scored.sort((a, b) => b.s - a.s);
        const target = scored[0].b;
        // Hick-Hyman: a simple reaction (~250 ms) plus ~150 ms per doubling of the bugs to choose from
        wait(pBrain.react() + 0.15 * (1 - pSkill() * 0.3) * Math.log2(Math.min(scored.length, 12) + 1) * Math.exp(U.gauss() * 0.2));   // practice speeds up choosing
        // how hard: comfortably above what this bug needs (a person can't judge it exactly)
        const eating = target.state === 'eat';
        let power = target.type === 'ant' ? (eating ? U.rand(680, 900) : spillMemory > 0 ? U.rand(480, 700) : U.rand(550, 800))
          : NEED[target.type] * U.rand(1.05, 1.2);
        if (U.chance(0.03 + pBrain.pressure * 0.06)) power *= 1.5;              // panic: far too hard
        power = U.clamp(power * Math.exp(U.gauss() * 0.15), 300, MAXF);         // no two flicks are the same
        // which way: toward the nearest edge, but a careful player steers clear of glasses and ladybugs
        let dir = null, bestCost = 1e9;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          let cost = (dx ? (dx > 0 ? TB.x + TB.w - target.x : target.x - TB.x) : (dy > 0 ? TB.y + TB.h - target.y : target.y - TB.y)) / 200;
          if (U.chance(0.5 + sk * 0.5)) {
            const r = { ox: target.x - dx * 100, oy: target.y - dy * 100, dx, dy };
            for (const d of dishes) if (d.alive && d.kind === 'glass' && power > GLASS_TIPS && inPath(r, d)) cost += 3;
            for (const b of bugs) if (b.type === 'ladybug' && b.state !== 'off' && inPath(r, b)) cost += 2;
          }
          if (cost < bestCost) { bestCost = cost; dir = Math.atan2(dy, dx); }
        }
        // a glass in the way: a careful player threads the needle, hard enough for the bug but under the spill mark
        if (power > GLASS_TIPS && NEED[target.type] < GLASS_TIPS && U.chance(sk) && dishes.some(d => d.alive && d.kind === 'glass' && inPath({ ox: target.x - Math.cos(dir) * 100, oy: target.y - Math.sin(dir) * 100, dx: Math.cos(dir), dy: Math.sin(dir) }, d)))
          power = U.lerp(NEED[target.type] * 1.03, GLASS_TIPS * 0.97, Math.random());
        const back = U.rand(60, 120);
        // the start point only has to be somewhere behind the bug, so it's a big target (fewer corrections)
        aim(st, pBrain, sk, pos, U.clamp(target.x - Math.cos(dir) * back, TB.x + 10, TB.x + TB.w - 10), U.clamp(target.y - Math.sin(dir) * back, TB.y + 10, TB.y + TB.h - 10), 70);
        const dur = U.clamp(0.151 + U.gauss() * 0.053, 0.08, 0.3);
        const a = dir + U.gauss() * 4.2 * Math.PI / 180 * (1 + pBrain.pressure);
        st.push({ k: 'press', dur: 0.06 }, { k: 'flick', dur, dx: Math.cos(a), dy: Math.sin(a), power, len: Math.min(200, power * dur / 1.875) });
        wait(U.rand(0.1, 0.25));                                              // a glance at the ripple, while already picking the next bug
      }

      /* ---------- computer bugs (plays like a person) ----------
         Clicks bugs onto the table like a person with a mouse: decides (longer
         with more options), moves its cursor to the edge (Fitts' law, same
         movement model as the hand) and clicks; a run of ants is a run of
         clicks. Its plan: go after the dish that is easiest to finish, come in
         from an edge the hand isn't guarding, strike right after a flick while
         the hand is busy, and now and then save up for one big rush. */
      const bBrain = new Arcade.Human({ reaction: 0.2 });
      const bc = { x: TB.x + TB.w + 40, y: TCY };                // its cursor (hidden from a human picnic player)
      let bSteps = [], saving = 0;
      const bSkill = () => 0.85;                                   // plays at its sharpest from the start
      // The computer bugs play to win: every crumb is spent the moment it arrives, never banked.
      // It favours beetles and the queen (they need hard flicks that risk the lemonade), aims at
      // the dish that is closest to being finished, and spreads its bugs around every side,
      // mostly away from the hand.
      function cpuBugs(dt) {
        if (coaching() || breather()) return;
        for (let guard = 0; guard < 200 && crumbs >= 1 && bugs.length <= 600; guard++) {
          const live = alive(); if (!live.length) return;
          const target = live.map(d => ({ d, s: (100 - d.food) / 40 + (1 - edgeDist(d) / 260) + Math.random() * 0.8 })).sort((a, b) => b.s - a.s)[0].d;
          let type = 'ant';
          if (crumbs >= COST.queen && !bugs.some(b => b.type === 'queen' && b.state !== 'off')) type = 'queen';
          else if (crumbs >= COST.beetle && U.chance(0.55)) type = 'beetle';
          const hs = sideOf(hnd.x, hnd.y);
          let side, al;
          if (U.chance(0.55)) {                                   // straight at the target, from its nearest side
            const near = [target.y - TB.y, TB.x + TB.w - target.x, TB.y + TB.h - target.y, target.x - TB.x].map((dd, sd) => ({ sd, dd })).sort((a, b) => a.dd - b.dd);
            side = near[0].sd === hs.side && hs.dist < 150 ? near[1].sd : near[0].sd;
            al = (side % 2 === 0 ? (target.x - TB.x - 20) / (TB.w - 40) : (target.y - TB.y - 20) / (TB.h - 40)) + U.rand(-0.25, 0.25);
          } else {                                                // anywhere else, away from the hand
            side = U.randInt(0, 3); if (side === hs.side && U.chance(0.7)) side = (side + 2) % 4;
            al = Math.random();
          }
          if (!send(type, side, U.clamp(al, 0, 1))) return;
          const p = edgePoint(side, U.clamp(al, 0, 1)); bc.x = p.x; bc.y = p.y;
        }
      }
      function cpuBugsOld(dt) {
        if (!bSteps.length) planBugs();
        const s = bSteps[0];
        if (!s) return;
        s.t = (s.t || 0) + dt * 15 * DOUBLE(wave);              // places bugs 15x faster than a person could, doubling every wave
        const k = Math.min(1, s.t / s.dur);
        if (s.k === 'wait') { if (k >= 1 || (s.early && sinceFlick < 0.25 && s.t > 0.2)) bSteps.shift(); return; }
        if (s.k === 'move') { const p = along(s, k); bc.x = p.x; bc.y = p.y; if (k >= 1) bSteps.shift(); return; }
        if (k >= 1) { bSteps.shift(); const p = s.side != null ? s : sideOf(bc.x, bc.y); send(s.type, p.side, p.along); }
      }
      function planBugs() {
        const st = bSteps, pos = { x: bc.x, y: bc.y };
        const wait = (dur, early) => st.push({ k: 'wait', dur, early });
        if (breather()) return wait(U.rand(0.3, 0.6));
        const opts = ['ant', 'beetle', 'queen'].filter(t => unlocked(t) && crumbs >= COST[t]);
        if (!opts.length) return wait(U.rand(0.25, 0.5), true);
        // gentle difficulty adjustment, only against a person: change what gets sent, never the rules
        let ease = 1;
        if (api.isHuman('picnic')) {
          const lostN = 6 - alive().length, low = alive().filter(d => d.food < 30).length;
          if (lostN >= 2 || low >= 2) ease = 1;                                   // struggling: hold back a little
          else if (playT > 25 && !lostN && alive().every(d => d.food > 70)) ease = 0.6;   // cruising: press harder
        }
        // the dish to go after: low on food, near an edge, or a glass (it tempts hard flicks)
        const target = alive().map(d => ({ d, s: (100 - d.food) / 50 + (1 - edgeDist(d) / 260) + (d.kind === 'glass' ? 0.15 : 0) + U.gauss() * 0.6 * (1 - bSkill()) }))
          .sort((a, b) => b.s - a.s)[0].d;
        // come in from the edge nearest it, unless the hand is guarding that edge
        const sides = [target.y - TB.y, TB.x + TB.w - target.x, TB.y + TB.h - target.y, target.x - TB.x].map((dist, sd) => ({ sd, dist })).sort((a, b) => a.dist - b.dist);
        const hs = sideOf(hnd.x, hnd.y);
        const side = sides[0].sd === hs.side && hs.dist < 150 && U.chance(0.4 + bSkill() * 0.4) ? sides[1].sd : sides[0].sd;
        const al = side % 2 === 0 ? (target.x - TB.x - 20) / (TB.w - 40) : (target.y - TB.y - 20) / (TB.h - 40);
        const pt = edgePoint(side, U.clamp(al + U.gauss() * 0.08, 0, 1));
        let type = 'ant', n = 1;
        if (opts.includes('queen') && !bugs.some(b => b.type === 'queen' && b.state !== 'off') && U.chance(0.35 / ease)) type = 'queen';
        else if (opts.includes('beetle') && U.chance(0.4 / ease)) { type = 'beetle'; n = Math.min(Math.floor(crumbs / COST.beetle), U.randInt(1, 1 + Math.floor((wave + 5) / 2))); }
        else {
          if (!saving && U.chance(0.15)) saving = U.randInt(14, 22);      // save up for a rush
          if (saving && crumbs < saving) return wait(U.rand(0.5, 1));
          n = saving ? Math.floor(crumbs) : Math.min(Math.floor(crumbs), U.randInt(2, 8 + wave));
          if (crumbs >= 6) n = Math.max(n, Math.floor(crumbs * 0.9));                  // never sit on a pile of crumbs: a steady stream, not bursts
          saving = 0;
        }
        wait(bBrain.react(true) + 0.15 * Math.log2(opts.length * 2 + 1) * Math.exp(U.gauss() * 0.2));
        aim(st, bBrain, bSkill(), pos, pt.x, pt.y, 60);
        // Clumps are easy to flick away in one go, so the bugs come in spread out: the first one where
        // the pointer is, the rest each from its own spot, a third of them from other sides of the table.
        for (let i = 0; i < n; i++) {
          const spot = i === 0 ? {} : U.chance(0.35) ? { side: U.randInt(0, 3), along: Math.random() } : { side, along: U.clamp(al + U.rand(-0.45, 0.45), 0, 1) };
          st.push(Object.assign({ k: 'click', type, dur: i ? 0.1 + U.rand(0, 0.12) : 0.06 }, spot));
        }
        wait(U.rand(0.05, 0.2) * ease, true);                     // look at the result; strike early if the hand just flicked
      }

      /* ---------- update ---------- */
      function update(dt) {
        time += dt;
        for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - dt * 2.5; q.vy *= 1 - dt * 2.5; q.t -= dt; }
        parts = parts.filter(q => q.t > 0);
        for (const f of floats) { f.y -= 36 * dt; f.t -= dt * 0.85; }
        floats = floats.filter(f => f.t > 0);
        shake = Math.max(0, shake - dt * 30);
        if (over) { for (const d of dishes) if (d.fall > 0) d.fall -= dt; return; }

        if (coach) coachStep(dt);
        if (!coaching()) {
          playT += dt;
          const w = 1 + Math.floor(playT / WAVE);
          if (w !== wave) { wave = w; api.toast(`Wave ${wave}: twice as hard`); api.sfx('point'); }
          crumbs = Math.min(8 * DOUBLE(wave), crumbs + dt * INCOME(wave));
          sinceFlick += dt;
        }

        // players
        if (!api.isHuman('picnic')) cpuPicnic(dt);
        else keyHand(dt);
        if (!api.isHuman('bugs') && !coaching()) cpuBugs(dt);

        // the cloth snaps back quickly after a release, so the dishes stay where they are
        if (!grab) {
          if (relT > 0) relT -= dt;
          else { const d = Math.hypot(ox, oy); if (d > 0.5) { const s = Math.min(d, 600 * dt); ox -= ox / d * s; oy -= oy / d * s; } }
        }
        cvx = (ox - pox) / dt; cvy = (oy - poy) / dt; pox = ox; poy = oy;
        const csp = Math.hypot(cvx, cvy);
        if (coach && coach.step === 0 && grab && csp > 5 && csp < 320) coach.acc += csp * dt;

        // dishes ride the cloth, or the cloth slips out from under them
        for (const d of dishes) {
          if (!d.alive) { if (d.fall > 0) d.fall -= dt; continue; }
          if (onCloth(d.x, d.y)) {
            let tx = cvx, ty = cvy;
            if (csp > d.grip) { tx *= 0.12; ty *= 0.12; }
            const k = Math.min(1, dt * 14);
            d.vx += (tx - d.vx) * k; d.vy += (ty - d.vy) * k;
          } else { d.vx *= Math.max(0, 1 - dt * 8); d.vy *= Math.max(0, 1 - dt * 8); }
          d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.wob > 0) d.wob -= dt;
          if (!onTable(d.x, d.y)) {
            if (coaching()) { d.x = U.clamp(d.x, TB.x + d.r, TB.x + TB.w - d.r); d.y = U.clamp(d.y, TB.y + d.r, TB.y + TB.h - d.r); d.vx = d.vy = 0; }
            else { lose(d, 'CRASH!', `The ${d.name} fell off the table`); shake = 12; burst(d.x, d.y, '#ffffff', 18, 200); api.sfx('crash'); }
          }
        }
        const live = alive();
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, mn = a.r + b.r + 10;
          if (d < mn) { const p = (mn - d) / 2; a.x -= dx / d * p; a.y -= dy / d * p; b.x += dx / d * p; b.y += dy / d * p; }
        }

        // ripples
        for (const r of ripples) {
          r.f += 900 * dt;
          r.cur = r.amp * (1 - r.f / 700);                       // ripples die out sooner
          if (r.cur < 150) continue;
          for (const b of bugs) {
            if (b.state === 'off' || r.hit.has(b) || !onCloth(b.x, b.y) || !hitBy(r, b)) continue;
            r.hit.add(b);
            // bugs that are already eating hold on tighter; near the threshold some keep their grip
            const need = NEED[b.type] * (b.type === 'ant' && b.state === 'eat' ? 1.5 : 1);   // a feeding ant clings; heavy bugs don't
            const amp = strength(r, b);
            if (amp >= need && U.chance(U.clamp(0.45 + (amp - need) / 500, 0, 1))) {
              if (b.type !== 'ladybug') { r.n++; bestChain = Math.max(bestChain, r.n); }
              b.chain = r.n || 1; b.state = 'fly'; b.dish = null;
              const sp = amp * 0.95;
              b.vx = r.dx * sp + U.rand(-120, 120); b.vy = r.dy * sp + U.rand(-120, 120); b.spin = U.rand(-20, 20);
            } else {
              b.state = 'daze'; b.t = 0.6; b.dish = null; b.x += r.dx * 10; b.y += r.dy * 10;
              if (b.type === 'beetle' || b.type === 'queen') float(b.x, b.y - 14, b.type === 'queen' ? 'NEEDS A MEGA FLICK' : 'NEEDS A HARD FLICK', '#ffd0a0', 8);
            }
          }
          for (const t of trails) if (!r.hit.has(t) && r.cur >= NEED.ant && t.pts.some(p => hitBy(r, p))) { r.hit.add(t); t.str -= 0.5; }   // a ripple scrambles the scent
          for (const d of dishes) {
            if (!d.alive || r.hit.has(d) || !onCloth(d.x, d.y) || !hitBy(r, d)) continue;
            r.hit.add(d);
            const amp = strength(r, d);
            if (amp > d.sturdy && !r.starch) {
              if (d.kind === 'glass' && !coaching()) { lose(d, 'SPILLED!', 'Too hard a flick for the lemonade'); burst(d.x, d.y, '#ffe66b', 22, 180); shake = 10; api.sfx('hit'); spillMemory = 20; }
              else { d.wob = 0.5; d.vx += r.dx * amp * 0.12; d.vy += r.dy * amp * 0.12; }
            } else d.wob = 0.25;
          }
        }
        ripples = ripples.filter(r => r.f < 950 && r.cur >= 150);

        // bugs
        for (const b of bugs) {
          b.leg += dt * 14;
          if (b.state === 'fly' || b.state === 'off') {
            b.x += b.vx * dt; b.y += b.vy * dt;
            const fr = b.state === 'off' ? 0.3 : 2.2;
            b.vx *= Math.max(0, 1 - dt * fr); b.vy *= Math.max(0, 1 - dt * fr); b.ang += b.spin * dt;
            if (b.state === 'fly') { if (!onTable(b.x, b.y)) flungOff(b); else if (Math.hypot(b.vx, b.vy) < 40) { b.state = 'daze'; b.t = 0.7; } }
            else b.t -= dt;
            continue;
          }
          if (onCloth(b.x, b.y)) { b.x += cvx * dt; b.y += cvy * dt; }            // bugs cling to the cloth
          if (!onTable(b.x, b.y)) { b.chain = 1; flungOff(b); continue; }
          if (b.type === 'queen') { b.spawnT -= dt; if (b.spawnT <= 0) { b.spawnT = 4; bugs.push(makeBug('ant', b.x + U.rand(-14, 14), b.y + U.rand(-14, 14))); } }
          if (b.state === 'daze') { b.t -= dt; if (b.t <= 0) lost(b); continue; }
          if (b.state === 'flee') { b.t -= dt; b.x += Math.cos(b.ang) * 80 * dt; b.y += Math.sin(b.ang) * 80 * dt; if (b.t <= 0) lost(b); continue; }
          if (b.type === 'ladybug') {
            b.life -= dt; b.ang += U.rand(-3, 3) * dt;
            b.x += Math.cos(b.ang) * b.sp * dt; b.y += Math.sin(b.ang) * b.sp * dt;
            if (b.x < TB.x + 20 || b.x > TB.x + TB.w - 20 || b.y < TB.y + 20 || b.y > TB.y + TB.h - 20) b.ang = Math.atan2(TCY - b.y, TCX - b.x);
            if (b.life <= 0) { b.state = 'off'; b.t = 1; b.vx = 0; b.vy = -140; score += 25; float(b.x, b.y, 'LUCKY LADYBUG +25', '#ffb3c1'); api.sfx('point'); }
            continue;
          }
          if (b.state === 'eat') {
            const d = b.dish;
            if (!d || !d.alive) { lost(b); continue; }
            b.x = d.x + Math.cos(b.ea) * (d.r + 3); b.y = d.y + Math.sin(b.ea) * (d.r + 3); b.ang = b.ea + Math.PI;
            d.food -= { ant: 2.6, beetle: 7, queen: 12 }[b.type] * dt * (coaching() ? 0.3 : 1);
            d.eating = true;
            if (d.food <= 0) { if (coaching()) d.food = 20; else { lose(d, 'EATEN!', `The bugs finished the ${d.name}`); burst(d.x, d.y, '#c08a5a', 14, 120); } }
            continue;
          }
          walk(b, dt);
        }
        for (const t of trails) { t.str -= dt * 0.04; for (const p of t.pts) if (onCloth(p.x, p.y)) { p.x += cvx * dt; p.y += cvy * dt; } }
        trails = trails.filter(t => t.str > 0.15 && t.dish.alive);
        bugs = bugs.filter(b => b.state !== 'off' || (b.t > 0 && b.x > -40 && b.x < W + 40 && b.y > -40 && b.y < H + 40));

        // eating sounds and the low-food warning
        for (const d of dishes) {
          if (!d.alive) continue;
          if (d.eating) { d.crunch -= dt; if (d.crunch <= 0) { d.crunch = 0.55; api.sfx('step'); } }
          d.eating = false;
          if (!d.warned && d.food < 30) { d.warned = true; api.sfx('tick'); float(d.x, d.y - d.r - 16, `SAVE THE ${d.name.toUpperCase()}!`, '#ff8a8a', 8); }
        }

        // ladybugs and power-ups, from the game itself (neither side controls them)
        if (!coaching()) {
          ladyT -= dt;
          if (ladyT <= 0) { ladyT = U.rand(18, 26); const p = edgePoint(U.randInt(0, 3)); bugs.push(makeBug('ladybug', p.x, p.y)); }
          powerT -= dt;
          if (powerT <= 0) { powerT = U.rand(20, 28); spawnPower(); }
        }
        for (const p of powers) { p.life -= dt; if (onCloth(p.x, p.y)) { p.x += cvx * dt; p.y += cvy * dt; } }
        powers = powers.filter(p => p.life > 0);

        // end of the game
        if (6 - alive().length >= LOSE_AT) {
          over = true; grab = null;
          const left = SURVIVE - playT;
          return api.end('bugs', left < 25 ? `So close: the picnic fell with only ${clock(left)} to go. ${flung} bugs flung.` : `${LOSE_AT} dishes gone after ${clock(playT)}. ${flung} bugs flung.`, 1200);
        }
        if (playT >= SURVIVE) {
          over = true; grab = null;
          const bonus = alive().length * 100;
          score += bonus;
          api.sfx('win');
          return api.end('picnic', `${alive().length} of 6 dishes saved (+${bonus}). ${flung} bugs flung, best chain x${bestChain}.`);
        }
      }
      function lose(d, title, msg) {
        d.alive = false; d.fall = 0.6; api.toast(`${title} ${msg}`, '#ff8a8a');
        if (6 - alive().length === LOSE_AT - 1) api.toast('One more dish and the picnic is over!', '#ffd23f');
      }
      function spawnPower() {
        const type = U.pick(Object.keys(POWERS)), c = cloth();
        for (let i = 0; i < 20; i++) {
          const x = U.rand(c.x + 40, c.x + c.w - 40), y = U.rand(c.y + 40, c.y + c.h - 40);
          if (dishes.every(d => !d.alive || U.dist(d.x, d.y, x, y) > d.r + 40)) { powers.push({ type, x, y, life: 10 }); api.sfx('coin'); return; }
        }
      }
      const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

      /* ---------- coaching (first game as a human picnic) ---------- */
      function coachStep(dt) {
        coach.t += dt;
        if (coach.step === 0 && coach.acc >= 60) {
          coach.step = 1; coach.t = 0; api.sfx('point');
          api.toast('Nice! Slow drags move everything');
          for (let i = 0; i < 5; i++) { const b = makeBug('ant', TCX + U.rand(-120, 120), TCY + U.rand(-60, 90)); b.sp = 10; bugs.push(b); }
        } else if (coach.step === 1 && flung >= 1) {
          coach.step = 2; coach.t = 0; api.sfx('start');
          api.toast('You got it! Fast flicks throw bugs');
          const b = makeBug('beetle', TCX + U.rand(-60, 60), TCY + 80); b.sp = 8; bugs.push(b);
        } else if (coach.step === 2 && (coach.t > 9 || !bugs.some(b => b.type === 'beetle' && b.state !== 'off'))) endCoach();
        else if (coach.step === 3 && coach.t > 3.2) coach = null;
      }
      function endCoach() {
        try { localStorage.setItem('arcade:picnic:coached', '1'); } catch { /* ignore */ }
        bugs = []; flung = 0; score = 0; bestChain = 0;
        for (const [i, d] of dishes.entries()) Object.assign(d, { x: TCX + LAYOUT[i][1], y: TCY + LAYOUT[i][2], vx: 0, vy: 0, food: 100, warned: false });
        coach = { step: 3, t: 0 };
        api.toast('Wave 1: protect the picnic!');
        api.sfx('start');
      }

      /* ---------- keyboard hand ---------- */
      // Holding a direction while grabbing speeds the hand up, so a longer push is a harder flick.
      function keyHand(dt) {
        const k = api.keys;
        let dx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), dy = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
        if (grab && hnd.by !== 'keys') return;                     // the mouse has the cloth
        if (!dx && !dy && !grab) return;
        hnd.by = 'keys';
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        if (grab) {
          hnd.vx += dx * 5200 * dt; hnd.vy += dy * 5200 * dt;
          if (!dx) hnd.vx *= Math.max(0, 1 - dt * 10);
          if (!dy) hnd.vy *= Math.max(0, 1 - dt * 10);
          const sp = Math.hypot(hnd.vx, hnd.vy); if (sp > 1700) { hnd.vx *= 1700 / sp; hnd.vy *= 1700 / sp; }
        } else { hnd.vx = dx * 380; hnd.vy = dy * 380; }
        const nx = U.clamp(hnd.x + hnd.vx * dt, TB.x, TB.x + TB.w), ny = U.clamp(hnd.y + hnd.vy * dt, TB.y, TB.y + TB.h);
        if (grab) dragTo(nx, ny); else { hnd.x = nx; hnd.y = ny; }
        if (grab && !k.has('Space')) release(hnd.vx, hnd.vy);
      }

      /* ---------- drawing ---------- */
      function drawCloth(ctx) {
        const c = cloth();
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(c.x + 4, c.y + 6, c.w, c.h);
        ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
        gingham(ctx, c.x, c.y, c.w, c.h);
        for (const r of ripples) {
          const a = U.clamp(r.cur / MAXF, 0.25, 1), fx = r.ox + r.dx * r.f, fy = r.oy + r.dy * r.f, half = HALF(r.f), nx = -r.dy, ny = r.dx;
          ctx.lineCap = 'round';
          for (let k = 0; k < 3; k++) {
            const back = 14 + k * 26;
            ctx.strokeStyle = `rgba(60,20,20,${0.32 * a / (k + 1)})`; ctx.lineWidth = 24 - k * 6;
            ctx.beginPath(); ctx.moveTo(fx - r.dx * back + nx * half, fy - r.dy * back + ny * half); ctx.lineTo(fx - r.dx * back - nx * half, fy - r.dy * back - ny * half); ctx.stroke();
          }
          ctx.strokeStyle = r.starch ? `rgba(150,210,255,${0.9 * a})` : `rgba(255,255,255,${0.85 * a})`; ctx.lineWidth = 14;
          ctx.beginPath(); ctx.moveTo(fx + nx * half, fy + ny * half); ctx.lineTo(fx - nx * half, fy - ny * half); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = '#c22b36'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.strokeRect(c.x + 7, c.y + 7, c.w - 14, c.h - 14); ctx.setLineDash([]);
      }
      function drawDish(ctx, d) {
        let a = 1, sc = 1;
        if (!d.alive) { if (d.fall <= 0) return; a = d.fall / 0.6; sc = 0.6 + a * 0.4; }
        const jx = d.wob > 0 ? U.rand(-2, 2) : 0, jy = d.wob > 0 ? U.rand(-2, 2) : 0;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(d.x + jx, d.y + jy); ctx.scale(sc, sc);
        if (d.alive && d.food < 30) { ctx.fillStyle = `rgba(216,52,63,${0.25 + 0.2 * Math.sin(time * 8)})`; ctx.beginPath(); ctx.arc(0, 0, d.r + 16, 0, 7); ctx.fill(); }
        if (d.kind === 'glass') {
          ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.arc(3, 4, d.r + 2, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(230,245,255,.9)'; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 7); ctx.fill();
          ctx.fillStyle = '#f7dd4a'; ctx.beginPath(); ctx.arc(0, 0, d.r - 3, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(-4, -4, 3, 0, 7); ctx.fill();
        } else {
          plate(ctx, 0, 0, d.r);
          if (d.kind === 'cake') {
            ctx.fillStyle = '#f2a3b8'; ctx.beginPath(); ctx.arc(0, 0, d.r - 6, 0, 7); ctx.fill();
            ctx.fillStyle = '#fff'; for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(t) * (d.r - 11), Math.sin(t) * (d.r - 11), 3, 0, 7); ctx.fill(); }
            ctx.fillStyle = '#d8343f'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
          }
          if (d.kind === 'pie') {
            ctx.fillStyle = '#e0a14c'; ctx.beginPath(); ctx.arc(0, 0, d.r - 5, 0, 7); ctx.fill();
            ctx.strokeStyle = '#b5762b'; ctx.lineWidth = 3;
            for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 8, -d.r + 8); ctx.lineTo(i * 8, d.r - 8); ctx.moveTo(-d.r + 8, i * 8); ctx.lineTo(d.r - 8, i * 8); ctx.stroke(); }
          }
          if (d.kind === 'sand') for (const s of [-1, 1]) {
            ctx.save(); ctx.rotate(s * 0.5); ctx.fillStyle = '#f3d79a';
            ctx.beginPath(); ctx.moveTo(-14 * s, -12); ctx.lineTo(14 * s, -12); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#8fc46a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
          }
          if (d.kind === 'melon') {
            ctx.fillStyle = '#3f8a3a'; ctx.beginPath(); ctx.arc(0, 4, d.r - 6, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#ef5a5f'; ctx.beginPath(); ctx.arc(0, 4, d.r - 10, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#222'; for (const x of [-8, 0, 8]) ctx.fillRect(x - 1, -6, 2, 4);
          }
        }
        if (d.alive) {
          const f = U.clamp(d.food / 100, 0, 1);
          ctx.strokeStyle = f > 0.5 ? '#8fc46a' : f > 0.3 ? '#f0b84a' : '#d8343f'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, d.r + (d.kind === 'glass' ? 4 : 8), -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      function drawBug(ctx, b) {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
        if (b.state === 'off') { ctx.globalAlpha = U.clamp(b.t, 0, 1); const s = 1 + (1 - b.t) * 0.6; ctx.scale(s, s); }
        if (b.type === 'beetle' || b.type === 'queen') {
          const q = b.type === 'queen';
          if (q) ctx.scale(1.25, 1.25);
          ctx.strokeStyle = '#1d1a12'; ctx.lineWidth = 1.5;
          for (let i = -1; i <= 1; i++) { const w = Math.sin(b.leg + i) * 2; ctx.beginPath(); ctx.moveTo(i * 4, -6); ctx.lineTo(i * 5 + w, -12); ctx.moveTo(i * 4, 6); ctx.lineTo(i * 5 - w, 12); ctx.stroke(); }
          if (q) {
            ctx.fillStyle = '#4a2414'; ctx.beginPath(); ctx.ellipse(-6, 0, 8, 6.5, 0, 0, 7); ctx.ellipse(4, 0, 5, 4.5, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(11, 0, 4, 0, 7); ctx.fill();
            ctx.fillStyle = '#f7dd4a'; ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(10, -11); ctx.lineTo(12, -7); ctx.lineTo(14, -11); ctx.lineTo(15, -5); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(220,235,255,.55)'; ctx.beginPath(); ctx.ellipse(-2, -7, 7, 3, -0.4, 0, 7); ctx.ellipse(-2, 7, 7, 3, 0.4, 0, 7); ctx.fill();
          } else {
            ctx.fillStyle = '#2f6b4f'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 8, 0, 0, 7); ctx.fill();
            ctx.strokeStyle = '#183b2a'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(9, 0); ctx.stroke();
            ctx.fillStyle = 'rgba(200,255,220,.45)'; ctx.beginPath(); ctx.ellipse(-2, -3, 4, 2, 0, 0, 7); ctx.fill();
            ctx.fillStyle = '#183b2a'; ctx.beginPath(); ctx.arc(11, 0, 3.5, 0, 7); ctx.fill();
          }
        } else if (b.type === 'ladybug') {
          ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(7, 0, 3.5, 0, 7); ctx.fill();
          ctx.fillStyle = '#e23b3b'; ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, 7); ctx.fill();
          ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-7.5, 0); ctx.lineTo(7.5, 0); ctx.stroke();
          ctx.fillStyle = '#1a1a1a'; for (const [x, y] of [[-3, -3.5], [2, -4], [-3, 3.5], [2, 4]]) { ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill(); }
        } else antShape(ctx, b.leg);
        if (b.state === 'daze' || b.state === 'flee') { ctx.rotate(-b.ang); D.text(ctx, b.state === 'flee' ? '!' : '*', 0, -13, { size: 10, color: b.state === 'flee' ? '#ff8a8a' : '#fff3c4', align: 'center' }); }
        ctx.restore();
      }
      function drawPower(ctx, p) {
        const P = POWERS[p.type];
        if (p.life < 3 && Math.floor(time * 8) % 2) return;
        const bob = Math.sin(time * 4) * 2;
        ctx.save(); ctx.translate(p.x, p.y + bob);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(0, 0, 24 + Math.sin(time * 6) * 3, 0, 7); ctx.fill();
        ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = P.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.fill(); ctx.stroke();
        if (p.type === 'pepper') { ctx.fillStyle = '#555'; ctx.fillRect(-6, -8, 12, 16); ctx.fillStyle = '#ccc'; ctx.fillRect(-6, -11, 12, 4); }
        if (p.type === 'refill') { ctx.fillStyle = '#f7dd4a'; ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, -8); ctx.lineTo(5, 9); ctx.lineTo(-5, 9); ctx.closePath(); ctx.fill(); }
        if (p.type === 'starch') { ctx.fillStyle = '#5aa0e6'; ctx.fillRect(-5, -6, 10, 15); ctx.fillStyle = '#2d5f99'; ctx.fillRect(-3, -10, 6, 4); }
        ctx.restore();
        outline(ctx, `CLICK: ${P.label}`, p.x, p.y - 34, 8, '#fffaf0');
      }
      function outline(ctx, s, x, y, size, color) {
        ctx.save(); ctx.font = `${size}px ${D.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,20,10,.8)'; ctx.strokeText(s, x, y); ctx.fillStyle = color; ctx.fillText(s, x, y); ctx.restore();
      }
      function panelBox(ctx, x, y, w, h, label) {
        ctx.fillStyle = 'rgba(20,32,18,.82)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#d8343f'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        if (label) D.text(ctx, label, x + w / 2, y + 14, { size: 8, pixel: true, color: '#f7dd4a', align: 'center' });
      }
      function drawSides(ctx) {
        const who = k => (api.isHuman(k) ? '1P' : 'CPU');
        const label = (str, x, y, color = '#a9b99a') => D.text(ctx, str, x, y, { size: 7, pixel: true, color, align: 'center' });

        // left: picnic score and the flick meter (the dishes show their own food rings)
        panelBox(ctx, 8, 48, 134, 544, `PICNIC ${who('picnic')}`);
        label('SCORE', 75, 86);
        D.text(ctx, String(score), 75, 106, { size: 14, pixel: true, color: '#fbf3e4', align: 'center' });
        ctx.fillStyle = '#3f5a36'; ctx.fillRect(20, 126, 110, 2);
        label('FLICK POWER', 75, 146);
        const mx = 26, my = 166, mh = 370, mw = 22;
        const live = grab ? grab.speed : lastFlick * U.clamp(1 - (time - lastFlickT) / 1.5, 0, 1);
        const f = U.clamp(live / MAXF, 0, 1);
        const yOf = v => my + mh * (1 - v / MAXF);
        ctx.fillStyle = '#24361f'; ctx.fillRect(mx, my, mw, mh);
        ctx.fillStyle = 'rgba(216,52,63,.25)'; ctx.fillRect(mx, my, mw, yOf(GLASS_TIPS) - my);     // spill zone
        ctx.fillStyle = live >= GLASS_TIPS ? '#d8343f' : live >= NEED.ant ? '#f7dd4a' : '#8fc46a';
        ctx.fillRect(mx, my + mh * (1 - f), mw, mh * f);
        const mark = (v, text, sub, color = '#fbf3e4') => {
          const y = yOf(v);
          ctx.fillStyle = color; ctx.fillRect(mx - 3, y - 1, mw + 6, 2);
          D.text(ctx, text, mx + mw + 10, y, { size: 7, pixel: true, color });
          if (sub) D.text(ctx, sub, mx + mw + 10, y + 13, { size: 7, pixel: true, color: '#ff8a8a' });
        };
        mark(NEED.ant, 'ANTS');
        mark(NEED.beetle, 'BEETLES');
        mark(GLASS_TIPS, 'SPILLS', null, '#ff8a8a');
        mark(NEED.queen, 'QUEEN');
        if (starch) label(`STARCH x${starch}`, 75, 562, '#9fd0ff');

        // right: the bugs' crumbs, plus the bug buttons when a person plays the bugs
        panelBox(ctx, 658, 48, 134, 544, `BUGS ${who('bugs')}`);
        label('CRUMBS', 725, 86);
        D.text(ctx, String(Math.floor(crumbs)), 725, 106, { size: 14, pixel: true, color: '#fbf3e4', align: 'center' });
        D.bar(ctx, 680, 122, 90, 4, crumbs % 1, '#e8c21f', '#24361f');
        if (api.isHuman('bugs')) {
          ['ant', 'beetle', 'queen'].forEach((t, i) => {
            const r = palRect(i), ok = unlocked(t) && crumbs >= COST[t], on = pick === t;
            ctx.fillStyle = on ? '#d8343f' : '#24361f'; ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.strokeStyle = ok ? '#8fc46a' : '#3f5a36'; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            ctx.globalAlpha = unlocked(t) ? 1 : 0.35;
            ctx.save(); ctx.translate(r.x + 24, r.y + r.h / 2); ctx.rotate(-Math.PI / 2);
            drawBug(ctx, { type: t, x: 0, y: 0, ang: 0, leg: time * 10, state: 'walk' });
            ctx.restore();
            D.text(ctx, `${i + 1} ${t.toUpperCase()}`, r.x + 44, r.y + r.h / 2 - 8, { size: 7, pixel: true, color: '#fbf3e4' });
            D.text(ctx, unlocked(t) ? `${COST[t]} CRUMB${COST[t] > 1 ? 'S' : ''}` : `WAVE ${t === 'beetle' ? 2 : 3}`, r.x + 44, r.y + r.h / 2 + 8, { size: 7, pixel: true, color: '#a9b99a' });
            ctx.globalAlpha = 1;
          });
          label('CLICK THE', 725, 368, '#d7e3c8');
          label('TABLE EDGE', 725, 384, '#d7e3c8');
          label('OR I J K L', 725, 404, '#d7e3c8');
        } else if (breather()) label('REGROUPING', 725, 150, '#a9b99a');
        else if (bSteps.some(x => x.k === 'click')) label('SENDING', 725, 150, '#f7dd4a');
      }
      // the computer bug player's mouse pointer: hidden whenever a person is playing, so the
      // picnic player can't see where the next bugs will come from (shown only in CPU-vs-CPU demos)
      function bugCursor(ctx) {
        if (api.isHuman('picnic')) return;
        ctx.save(); ctx.translate(bc.x, bc.y);
        ctx.fillStyle = '#2a1a12'; ctx.strokeStyle = '#fbf3e4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 12.5); ctx.lineTo(8, 19); ctx.lineTo(10.5, 18); ctx.lineTo(7, 11.5); ctx.lineTo(12.5, 11.5); ctx.closePath();
        ctx.stroke(); ctx.fill(); ctx.restore();
      }
      function palRect(i) { return { x: 668, y: 148 + i * 66, w: 114, h: 58 }; }
      function drawCoach(ctx) {
        let title, sub, gx, gy, down = true;
        const t = coach.t;
        if (coach.step === 0) { title = '1. DRAG THE CLOTH SLOWLY'; sub = 'Hold it and move it gently, like the hand'; gx = TCX + 60 + Math.sin(t / 3 * Math.PI * 2) * 55; gy = TCY + 150; }
        else if (coach.step === 1) {
          title = '2. FLICK IT AND LET GO'; sub = 'Move fast toward an ant, then release';
          const ph = t % 1.8; gx = TCX - 130 + Math.min(ph, 0.55) / 0.55 * 150; gy = TCY - 20; down = ph < 0.55;
          if (ph > 0.55 && ph < 1.2) { ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - (ph - 0.55) / 0.65)})`; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(TCX + 20 + (ph - 0.55) * 150, TCY - 110); ctx.lineTo(TCX + 20 + (ph - 0.55) * 150, TCY + 70); ctx.stroke(); }
        } else { title = '3. BEETLES NEED A HARD FLICK'; sub = 'Really fast. Careful: hard flicks spill lemonade'; const ph = t % 1.4; gx = TCX - 150 + Math.min(ph, 0.35) / 0.35 * 200; gy = TCY + 130; down = ph < 0.35; }
        hand(ctx, gx, gy, down, 0.9, 1.7);
        ctx.fillStyle = 'rgba(20,32,18,.9)'; ctx.fillRect(TB.x, TB.y + TB.h - 70, TB.w, 70);
        outline(ctx, title, TCX, TB.y + TB.h - 48, 12, '#f7dd4a');
        D.text(ctx, sub, TCX, TB.y + TB.h - 26, { size: 13, color: '#fbf3e4', align: 'center' });
        D.text(ctx, 'ENTER: SKIP', TB.x + TB.w - 8, TB.y + TB.h - 10, { size: 7, pixel: true, color: '#a9b99a', align: 'right' });
      }

      return {
        update,

        onKey(code) {
          if (code === 'Enter' && coaching()) return endCoach();
          if (api.isHuman('picnic') && code === 'Space' && !grab) {
            hnd.by = 'keys'; hnd.vx = hnd.vy = 0;
            grabAt(hnd.x, hnd.y, 'keys');
          }
          if (api.isHuman('bugs')) {
            const m = /^Digit([1-3])$/.exec(code);
            if (m) { pick = ['ant', 'beetle', 'queen'][+m[1] - 1]; api.sfx('select'); }
            const side = { KeyI: 0, KeyL: 1, KeyK: 2, KeyJ: 3 }[code];
            if (side !== undefined) send(pick, side, Math.random());
          }
        },
        onPointer(type, x, y) {
          const bugsMouse = api.isHuman('bugs') && !api.isHuman('picnic');
          if (type === 'down') {
            if (api.isHuman('bugs')) {
              for (let i = 0; i < 3; i++) { const r = palRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { pick = ['ant', 'beetle', 'queen'][i]; api.sfx('select'); return; } }
            }
            if (bugsMouse) {
              const s = sideOf(x, y);
              if (s.dist < 60 && x > TB.x - 30 && x < TB.x + TB.w + 30 && y > TB.y - 30 && y < TB.y + TB.h + 30) send(pick, s.side, s.along);
              return;
            }
            if (api.isHuman('picnic') && onTable(x, y)) grabAt(x, y, 'mouse');
          } else if (type === 'move') {
            if (api.isHuman('picnic') && (hnd.by === 'mouse' || !grab)) { if (grab) dragTo(x, y); else if (onTable(x, y)) { hnd.x = x; hnd.y = y; hnd.by = 'mouse'; } }
          } else if (type === 'up' && grab && hnd.by === 'mouse') releaseFromHistory();
        },

        // picnic-cartoon look: grass, a wooden table, a red gingham cloth
        draw(ctx) {
          ctx.save();
          if (shake) ctx.translate(U.rand(-shake, shake), U.rand(-shake, shake));
          ctx.fillStyle = '#46733a'; ctx.fillRect(-20, -20, W + 40, H + 40);
          ctx.lineWidth = 1.5;
          for (const b of BLADES) { ctx.strokeStyle = b.c; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.sin(b.a) * b.l, b.y - Math.cos(b.a) * b.l); ctx.stroke(); }
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(TB.x + 8, TB.y + 10, TB.w, TB.h);
          ctx.fillStyle = '#b07a43'; ctx.fillRect(TB.x, TB.y, TB.w, TB.h);
          ctx.strokeStyle = '#8e5f30'; ctx.lineWidth = 2;
          for (let i = 1; i < 6; i++) { const x = TB.x + TB.w * i / 6; ctx.beginPath(); ctx.moveTo(x, TB.y); ctx.lineTo(x, TB.y + TB.h); ctx.stroke(); }
          ctx.strokeStyle = '#6f4520'; ctx.lineWidth = 4; ctx.strokeRect(TB.x + 2, TB.y + 2, TB.w - 4, TB.h - 4);
          drawCloth(ctx);
          for (const d of dishes) drawDish(ctx, d);
          for (const p of powers) drawPower(ctx, p);
          for (const b of bugs) if (b.state !== 'off') drawBug(ctx, b);
          for (const b of bugs) if (b.state === 'off') drawBug(ctx, b);
          for (const q of parts) { ctx.globalAlpha = U.clamp(q.t * 2, 0, 1); ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill(); }
          ctx.globalAlpha = 1;
          for (const f of floats) { ctx.globalAlpha = U.clamp(f.t * 1.5, 0, 1); outline(ctx, f.txt, f.x, f.y, f.size, f.col); }
          ctx.globalAlpha = 1;
          if (grab) hand(ctx, hnd.x, hnd.y, true);
          else if (hnd.by === 'keys' || hnd.by === 'cpu') hand(ctx, hnd.x, hnd.y, false);
          if (!api.isHuman('bugs') && !coaching()) bugCursor(ctx);
          ctx.restore();

          D.hud(ctx, [
            { text: coaching() ? 'HOW TO PLAY' : `WAVE ${wave}`, pixel: true, size: 10, color: '#f7dd4a' },
            { text: coaching() ? '' : breather() ? `BUGS REGROUP · WAVE ${wave + 1} IN ${Math.ceil(WAVE - playT % WAVE)}` : `SAVE THE FOOD ${clock(Math.max(0, SURVIVE - playT))}`, align: 'center', pixel: true, size: 10, color: breather() ? '#8fc46a' : '#fbf3e4' },
            { text: `${alive().length}/6 DISHES`, align: 'right', pixel: true, size: 10, color: alive().length <= 2 ? '#ff8a8a' : '#fbf3e4' }
          ], 40);
          drawSides(ctx);
          if (coaching()) drawCoach(ctx);
          else if (coach && coach.step === 3) {
            ctx.fillStyle = 'rgba(20,32,18,.88)'; ctx.fillRect(TB.x, TB.y + TB.h - 54, TB.w, 54);
            D.text(ctx, 'SLOW DRAG = MOVE DISHES  ·  FLICK + LET GO = THROW BUGS', TCX, TB.y + TB.h - 27, { size: 7, pixel: true, color: '#fbf3e4', align: 'center' });
          } else if (api.isHuman('picnic') && sinceFlick > 7 && bugs.some(b => b.state === 'eat')) {
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 7);
            ctx.fillStyle = '#d8343f'; ctx.fillRect(TCX - 180, TB.y + TB.h - 50, 360, 36);
            D.text(ctx, 'FLICK THE CLOTH! FAST, THEN LET GO', TCX, TB.y + TB.h - 32, { size: 8, pixel: true, color: '#fff', align: 'center' });
            ctx.globalAlpha = 1;
          }
        },
        score: () => score,
        medal: () => RANKS.find(r => score >= r.at) || null,
        endTitle: res => (res.winnerSide === 'picnic' ? 'Picnic saved!' : 'Picnic over'),
        _state: () => ({ time: Math.round(playT), wave, score, flung, dishes: alive().length, bugs: bugs.length, crumbs: Math.floor(crumbs), coaching: coaching() })
      };
    }
  });
})();
