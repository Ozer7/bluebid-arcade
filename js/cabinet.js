/* ==========================================================================
   BlueBid Arcade — the cabinet (menu, side pickers, stage)
   ========================================================================== */
(function () {
  'use strict';

  // Imitation runs as a Claude artifact (it needs Claude and a shared
  // matchmaking store, neither of which a static site can host without a
  // server or an API key). Paste the published artifact link here.
  const IMITATION_URL = 'https://claude.ai/artifact/6ykMELAsH8QmF3ZdVYU3ZT';

  const $ = sel => document.querySelector(sel);
  const cabinet = $('#cabinet'), stage = $('#stage');
  const canvas = $('#screen'), overlay = $('#overlay');
  const games = Arcade.games;

  let current = null;      // current game definition
  let runner = null;       // live Runner (real game or attract-mode demo)
  let roles = {};          // chosen roles for current game
  let demo = false;        // true while the attract-mode demo plays behind the menu

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };

  /* ---------------- cabinet grid ---------------- */
  function buildGrid() {
    const grid = $('#grid');
    for (const g of games) {
      const b = document.createElement('button');
      b.className = 'gamecard';
      b.type = 'button';
      b.innerHTML = `<canvas width="400" height="300" aria-hidden="true"></canvas>
        <div class="body"><h3></h3><p></p><div class="flip"><b>Flip:</b> <span></span></div></div>`;
      b.querySelector('h3').textContent = g.title;
      b.querySelector('p').textContent = g.tagline;
      b.querySelector('.flip span').textContent = g.flip;
      b.addEventListener('click', () => { location.hash = g.id; });
      grid.appendChild(b);
      drawThumb(b.querySelector('canvas'), g);
    }
    // Imitation — the seventh cabinet slot
    const a = document.createElement('a');
    a.className = 'gamecard';
    a.href = IMITATION_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<canvas width="400" height="300" aria-hidden="true"></canvas>
      <div class="body"><span class="tag">Opens in Claude</span><h3>Imitation</h3>
      <p>Chat for two minutes, then guess: were you talking to a person or to Claude?</p>
      <div class="flip"><b>Flip:</b> <span>play the AI, or another human in a second browser.</span></div></div>`;
    grid.appendChild(a);
    drawImitationThumb(a.querySelector('canvas'));
  }

  function drawThumb(cv, g) {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = Arcade.C.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    try { g.thumb(ctx, cv.width, cv.height); } catch (e) { console.warn(e); }
  }

  function drawImitationThumb(cv) {
    const ctx = cv.getContext('2d'), C = Arcade.C, D = Arcade.draw;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 400, 300);
    const bubble = (x, y, w, col, right) => {
      ctx.fillStyle = col; D.roundRect(ctx, x, y, w, 34, 14); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 16 + i * ((w - 40) / 3), y + 15, (w - 60) / 3, 5);
      void right;
    };
    bubble(40, 60, 190, C.line);
    bubble(170, 110, 190, C.accent);
    bubble(40, 160, 150, C.line);
    D.text(ctx, 'HUMAN?', 110, 245, { size: 22, pixel: true, color: C.good, align: 'center' });
    D.text(ctx, 'AI?', 290, 245, { size: 22, pixel: true, color: C.warn, align: 'center' });
  }

  /* ---------------- routing ---------------- */
  function route() {
    const id = location.hash.replace('#', '');
    const g = games.find(x => x.id === id);
    if (g) openGame(g); else closeGame();
  }

  function closeGame() {
    stopRunner();
    current = null;
    stage.hidden = true;
    cabinet.hidden = false;
    document.title = 'BlueBid Arcade — the cocktail cabinet';
  }

  function openGame(g) {
    current = g;
    roles = Object.assign({}, g.defaults, store.get('roles:' + g.id) || {});
    cabinet.hidden = true;
    stage.hidden = false;
    $('#gameTitle').textContent = g.title;
    $('#gameBlurb').textContent = g.blurb;
    document.title = g.title + ' — BlueBid Arcade';
    window.scrollTo(0, 0);
    showMenu();
  }

  /* ---------------- runner control ---------------- */
  function stopRunner() {
    if (runner) runner.destroy();
    runner = null;
  }

  function startDemo() {
    stopRunner();
    demo = true;
    const cpuRoles = {};
    current.sides.forEach(s => (cpuRoles[s.key] = 'cpu'));
    const r = (runner = new Arcade.Runner(canvas, current, cpuRoles, {
      onEnd: () => setTimeout(() => { if (demo && r === runner) startDemo(); }, 1200)
    }));
  }

  function startGame() {
    stopRunner();
    demo = false;
    store.set('roles:' + current.id, roles);
    overlay.hidden = true;
    $('#pauseBtn').disabled = false;
    $('#restartBtn').disabled = false;
    $('#pauseBtn').textContent = 'Pause';
    renderSideInfo();
    const r = (runner = new Arcade.Runner(canvas, current, Object.assign({}, roles), {
      onEnd: res => r === runner && showResult(res),          // ignore results from a replaced game
      onPause: p => r === runner && (p ? showPause() : hideOverlay())
    }));
    canvas.focus && canvas.focus();
  }

  /* ---------------- overlays ---------------- */
  function hideOverlay() {
    overlay.hidden = true;
    $('#pauseBtn').textContent = 'Pause';
  }

  function setOverlay(kicker, title, html, withPickers, buttons) {
    $('#ovKicker').textContent = kicker;
    $('#ovTitle').textContent = title;
    $('#ovText').innerHTML = html;
    const pk = $('#sidePickers');
    pk.innerHTML = '';
    pk.hidden = !withPickers;
    if (withPickers) buildPickers(pk);
    const bb = $('#ovBtns');
    bb.innerHTML = '';
    for (const [label, fn, cls] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.addEventListener('click', fn);
      bb.appendChild(b);
    }
    overlay.hidden = false;
    const first = bb.querySelector('.primary');
    if (first) first.focus();
  }

  function showMenu() {
    startDemo();                        // computers play in the background while you choose
    $('#pauseBtn').disabled = true;
    $('#restartBtn').disabled = true;
    renderSideInfo();
    setOverlay('Choose who plays', current.title, current.menuText || current.tagline, true,
      [['Start', startGame, 'primary']]);
  }

  function showPause() {
    $('#pauseBtn').textContent = 'Resume';
    setOverlay('Paused', current.title, 'Take a breath.', false, [
      ['Resume', () => runner && runner.togglePause(false), 'primary'],
      ['Restart', startGame],
      ['Change players', () => { stopRunner(); showMenu(); }]
    ]);
  }

  function showResult(res) {
    const side = current.sides.find(s => s.key === res.winnerSide);
    const who = roles[res.winnerSide] === 'human' ? 'Human' : 'Computer';
    $('#pauseBtn').disabled = true;
    setOverlay('Game over', `${side ? side.label : 'Nobody'} wins`,
      `<b>${who}</b> took it. ${escapeHtml(res.detail || '')}`, false, [
        ['Play again', startGame, 'primary'],
        ['Swap sides', () => { swapSides(); startGame(); }],
        ['Change players', () => { stopRunner(); showMenu(); }]
      ]);
  }

  function swapSides() {
    const [a, b] = current.sides.map(s => s.key);
    [roles[a], roles[b]] = [roles[b], roles[a]];
  }

  function buildPickers(root) {
    for (const s of current.sides) {
      const row = document.createElement('div');
      row.className = 'picker';
      const name = document.createElement('span');
      name.textContent = s.label;
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', s.label + ' is played by');
      for (const [val, label] of [['human', 'Human'], ['cpu', 'Computer']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('aria-pressed', String(roles[s.key] === val));
        b.addEventListener('click', () => {
          roles[s.key] = val;
          seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          renderSideInfo();
        });
        seg.appendChild(b);
      }
      row.append(name, seg);
      root.appendChild(row);
    }
  }

  function renderSideInfo() {
    const box = $('#sideInfo');
    box.innerHTML = '';
    for (const s of current.sides) {
      const d = document.createElement('div');
      d.className = 'side';
      const isH = roles[s.key] === 'human';
      d.innerHTML = `<b></b><small></small>`;
      d.querySelector('b').textContent = s.label;
      const tag = document.createElement('span');
      tag.className = 'who ' + (isH ? 'human' : 'cpu');
      tag.textContent = isH ? 'Human' : 'Computer';
      d.querySelector('b').appendChild(tag);
      d.querySelector('small').textContent = isH ? s.human : s.cpu;
      box.appendChild(d);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- buttons & keys ---------------- */
  $('#backBtn').addEventListener('click', () => { location.hash = ''; });
  $('#pauseBtn').addEventListener('click', () => runner && !demo && runner.togglePause());
  $('#restartBtn').addEventListener('click', () => current && startGame());
  window.addEventListener('keydown', e => {
    if (stage.hidden || !current) return;
    if (e.code === 'KeyR' && !demo && runner && !runner.paused) startGame();
    if (e.code === 'Enter' && !overlay.hidden) {
      const p = $('#ovBtns .primary');
      if (p && document.activeElement !== p) { e.preventDefault(); p.click(); }
    }
  });
  window.addEventListener('hashchange', route);

  buildGrid();
  route();

  // exposed for the automated tests in /tests
  window.__cabinet = { get runner() { return runner; }, startGame, setRoles: r => Object.assign(roles, r) };
})();
