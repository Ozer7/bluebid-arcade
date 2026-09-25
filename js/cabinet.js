/* ==========================================================================
   Cocktail Cabinet — the front end
   Game select (attract mode with a live demo), "who's playing", pause,
   game over with 3-letter initials and a top-5 high-score table.
   Everything works from the keyboard (arrows, Enter, Esc, P, M) or the mouse.
   ========================================================================== */
(function () {
  'use strict';

  // Imitation runs as a Claude artifact (it needs Claude and a shared
  // matchmaking store, which a static site can't host without a server).
  const IMITATION_URL = 'https://claude.ai/artifact/6ykMELAsH8QmF3ZdVYU3ZT';
  const IMITATION = {
    id: 'imitation', title: 'Imitation', year: '2023 · after "Human or Not" (AI21 Labs)',
    flip: 'play the AI, or another human in a second browser.', external: IMITATION_URL
  };

  const $ = s => document.querySelector(s);
  const machine = $('#machine'), selectEl = $('#select'), playEl = $('#play');
  const overlay = $('#overlay'), ovBox = $('#ovBox');
  const games = Arcade.games;
  const entries = [...games, IMITATION];

  let mode = 'select';         // 'select' | 'play'
  let sel = 0;                 // highlighted entry on the select screen
  let current = null;          // game being played
  let roles = {};
  let preview = null, runner = null, demoMode = false;
  let idle = 0, idleTimer = 0;
  let nav = null;              // keyboard navigation inside an overlay

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= sound + global keys ================= */
  function unlockSound() { Arcade.sound.unlock(); }
  window.addEventListener('pointerdown', unlockSound, { capture: true });
  window.addEventListener('keydown', unlockSound, { capture: true });
  function renderSound() {
    const on = !Arcade.sound.muted;
    $('#btnSound').setAttribute('aria-pressed', String(on));
    $('#soundLabel').textContent = on ? 'Sound' : 'Muted';
  }
  function toggleSound() { Arcade.sound.setMuted(!Arcade.sound.muted); renderSound(); Arcade.sfx('select'); }
  renderSound();

  /* ================= select screen (attract mode) ================= */
  function buildList() {
    const list = $('#gameList');
    list.innerHTML = '';
    entries.forEach((g, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="no">${i + 1}</span><span class="nm"></span><span class="yr"></span>`;
      b.querySelector('.nm').textContent = g.title;
      b.querySelector('.yr').textContent = (g.year || '').split('·')[0].trim() + (g.external ? ' · opens in Claude' : '');
      b.addEventListener('mouseenter', () => { if (sel !== i) choose(i); });
      b.addEventListener('focus', () => { if (sel !== i) choose(i); });
      b.addEventListener('click', () => { choose(i); startSelected(); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function choose(i) {
    sel = (i + entries.length) % entries.length;
    idle = 0;
    [...$('#gameList').querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-current', String(k === sel)));
    const g = entries[sel];
    $('#selOrig').textContent = 'Original: ' + (g.year || '');
    $('#selFlip').innerHTML = `<b>Flip:</b> ${esc(g.flip)}`;
    renderScores($('#selScores'), g);
    renderCard(g);
    startPreview(g);
    Arcade.sfx('select');
  }

  function renderScores(el, g, highlight) {
    if (g.external) { el.innerHTML = '<h3>Players guess right 68% of the time</h3><p class="empty">(the Human or Not study, 2023)</p>'; return; }
    const t = Arcade.scores.get(g.id);
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const r = t[i];
      rows.push(r ? `<li${highlight === i ? ' class="me"' : ''}><span>${i + 1}.</span><span>${esc(r.name)}</span><span>${r.score}</span></li>`
        : `<li class="empty"><span>${i + 1}.</span><span>---</span><span>0</span></li>`);
    }
    el.innerHTML = `<h3>High scores · ${esc(g.scoreName || 'score')}</h3><ol>${rows.join('')}</ol>`;
  }

  function startPreview(g) {
    if (preview) preview.destroy();
    preview = null;
    const cv = $('#preview');
    if (g.external) { preview = imitationDemo(cv); return; }
    const cpu = {};
    g.sides.forEach(s => (cpu[s.key] = 'cpu'));
    const r = (preview = new Arcade.Runner(cv, g, cpu, {
      onEnd: () => setTimeout(() => { if (preview === r && mode === 'select') startPreview(g); }, 1600)
    }));
    r.quiet = true;
  }

  // a little terminal animation for Imitation's preview
  function imitationDemo(cv) {
    const ctx = cv.getContext('2d');
    const lines = [['them', 'hey whats up'], ['you', 'not much, you a bot?'], ['them', 'lol no. are YOU a bot'], ['you', 'what did you have for lunch'],
      ['them', 'cold pizza, dont judge'], ['you', 'hmm...'], ['sys', 'TIME. HUMAN OR AI?']];
    let t = 0, raf = 0, last = 0;
    const loop = ts => {
      raf = requestAnimationFrame(loop);
      t += Math.min(0.1, (ts - (last || ts)) / 1000); last = ts;
      ctx.fillStyle = '#020a04'; ctx.fillRect(0, 0, 800, 600);
      ctx.font = '38px VT323, monospace'; ctx.textBaseline = 'top';
      let chars = Math.floor(t * 18), y = 40;
      for (const [who, txt] of lines) {
        if (chars <= 0) break;
        const shown = txt.slice(0, chars); chars -= txt.length + 8;
        ctx.fillStyle = who === 'you' ? '#7bff5a' : who === 'sys' ? '#ffd23f' : '#b9ffc0';
        ctx.fillText((who === 'you' ? '> ' : who === 'sys' ? '' : '< ') + shown, 50, y); y += 70;
      }
      if (Math.floor(t * 2) % 2) { ctx.fillStyle = '#7bff5a'; ctx.fillRect(50, y, 18, 32); }
      if (t > 14) t = 0;
    };
    raf = requestAnimationFrame(loop);
    return { destroy() { cancelAnimationFrame(raf); } };
  }

  function startSelected() {
    const g = entries[sel];
    Arcade.sfx('coin');
    if (g.external) { const a = document.createElement('a'); a.href = g.external; a.target = '_blank'; a.rel = 'noopener'; a.click(); return; }
    location.hash = g.id;
  }

  /* ================= instruction card + marquee ================= */
  function renderCard(g) {
    $('#cardTitle').textContent = g.external ? 'Imitation · how to play' : `${g.title} · how to play`;
    if (g.external) {
      $('#cardBody').innerHTML = `<p class="goal">Chat with a stranger for two minutes, taking turns, then guess: a person, or Claude? You can play another person in a second browser. If nobody else is searching, Claude plays the other side and tries to pass as human.</p>
        <p class="src">Based on AI21 Labs' "Human or Not" (2023): 2-minute chats, turn-taking, 100-character messages, 20 seconds per message. Players guessed right 68% of the time.</p>`;
      return;
    }
    const cols = g.sides.map(s => `<div><h3>${esc(s.label)}</h3><p><b>You:</b> ${esc(s.human)}</p><p><b>Computer:</b> ${esc(s.cpu)}</p></div>`).join('');
    $('#cardBody').innerHTML = `<p class="goal">${g.menuText || esc(g.tagline)}</p><div class="cols">${cols}</div>
      <p class="src">Original: ${esc(g.year || '')}. ${esc(g.history || '')}</p>`;
  }
  function setMarquee(g) {
    if (!g) {
      machine.dataset.game = '';
      $('#marqueeKicker').textContent = 'BlueBid Arcade presents';
      $('#marqueeTitle').textContent = 'Cocktail Cabinet';
      $('#marqueeSub').textContent = '7 games · human or CPU on either side';
      return;
    }
    machine.dataset.game = g.id;
    $('#marqueeKicker').textContent = 'Original: ' + g.year;
    $('#marqueeTitle').textContent = g.title;
    $('#marqueeSub').textContent = g.tagline;
  }

  /* ================= routing ================= */
  function route() {
    const id = location.hash.replace('#', '');
    const g = games.find(x => x.id === id);
    if (g) openGame(g); else showSelect();
  }
  function showSelect() {
    stopRunner();
    mode = 'select';
    current = null;
    setMarquee(null);
    playEl.hidden = true;
    selectEl.hidden = false;
    $('#deckHelp').textContent = '↑ ↓ choose · Enter start · M sound';
    document.title = 'Cocktail Cabinet — BlueBid Arcade';
    choose(sel);
  }
  function openGame(g) {
    if (preview) { preview.destroy(); preview = null; }
    mode = 'play';
    current = g;
    sel = entries.indexOf(g);
    roles = Object.assign({}, g.defaults, store.get('roles:' + g.id) || {});
    setMarquee(g);
    renderCard(g);
    selectEl.hidden = true;
    playEl.hidden = false;
    $('#deckHelp').textContent = 'Enter start · P pause · Esc back · M sound';
    document.title = g.title + ' — Cocktail Cabinet';
    showRoles();
  }

  /* ================= runners ================= */
  function stopRunner() { if (runner) runner.destroy(); runner = null; }
  function startDemo() {
    stopRunner();
    demoMode = true;
    const cpu = {};
    current.sides.forEach(s => (cpu[s.key] = 'cpu'));
    const r = (runner = new Arcade.Runner($('#screen'), current, cpu, {
      onEnd: () => setTimeout(() => { if (demoMode && r === runner) startDemo(); }, 1500)
    }));
    r.quiet = true;
  }
  function startGame() {
    stopRunner();
    demoMode = false;
    store.set('roles:' + current.id, roles);
    hideOverlay();
    Arcade.sfx('start');
    const r = (runner = new Arcade.Runner($('#screen'), current, Object.assign({}, roles), {
      onEnd: res => r === runner && showResult(res),
      onPause: p => r === runner && (p ? showPause() : hideOverlay())
    }));
  }

  /* ================= overlays ================= */
  function hideOverlay() { overlay.hidden = true; nav = null; }
  function showOverlay(html, onKey) {
    ovBox.innerHTML = html;
    overlay.hidden = false;
    const items = [...ovBox.querySelectorAll('[data-nav]')];
    nav = { items, i: Math.max(0, items.findIndex(x => x.dataset.default === '1')), onKey };
    focusNav();
  }
  function focusNav() {
    if (!nav) return;
    nav.items.forEach((el, k) => el.setAttribute('data-focus', String(k === nav.i)));
  }

  function showRoles() {
    startDemo();                           // computers play behind the menu
    const g = current;
    const rows = g.sides.map(s => `
      <div class="role" data-nav data-side="${s.key}">
        <span class="rname">${esc(s.label)}</span>
        <span class="toggle">
          <button type="button" data-val="human" aria-pressed="${roles[s.key] === 'human'}">Human</button>
          <button type="button" data-val="cpu" aria-pressed="${roles[s.key] === 'cpu'}">CPU</button>
        </span>
      </div>`).join('');
    showOverlay(`
      <p class="kick">Who's playing?</p>
      <h2>${esc(g.title)}</h2>
      <p>${g.menuText || esc(g.tagline)}</p>
      <div class="roles">${rows}</div>
      <div class="ov-actions">
        <button class="pix-btn primary" type="button" data-nav data-act="start" data-default="1">Start</button>
        <button class="pix-btn" type="button" data-nav data-act="menu">Game select</button>
      </div>`, (k) => {
      const it = nav.items[nav.i];
      if ((k === 'ArrowLeft' || k === 'ArrowRight') && it.classList.contains('role')) {
        const side = it.dataset.side;
        roles[side] = roles[side] === 'human' ? 'cpu' : 'human';
        renderRoleButtons();
        Arcade.sfx('select');
        return true;
      }
      return false;
    });
    ovBox.querySelectorAll('.role .toggle button').forEach(b => b.addEventListener('click', () => {
      roles[b.closest('.role').dataset.side] = b.dataset.val;
      renderRoleButtons();
      Arcade.sfx('select');
    }));
    ovBox.querySelector('[data-act="start"]').addEventListener('click', startGame);
    ovBox.querySelector('[data-act="menu"]').addEventListener('click', () => { location.hash = ''; });
    $('#btnPause').disabled = true;
  }
  function renderRoleButtons() {
    ovBox.querySelectorAll('.role').forEach(r => r.querySelectorAll('button').forEach(b =>
      b.setAttribute('aria-pressed', String(roles[r.dataset.side] === b.dataset.val))));
  }

  function showPause() {
    $('#btnPause').disabled = false;
    showOverlay(`
      <p class="kick">Paused</p>
      <h2>${esc(current.title)}</h2>
      <div class="ov-actions">
        <button class="pix-btn primary" type="button" data-nav data-act="resume" data-default="1">Resume</button>
        <button class="pix-btn" type="button" data-nav data-act="restart">Restart</button>
        <button class="pix-btn" type="button" data-nav data-act="players">Change players</button>
        <button class="pix-btn" type="button" data-nav data-act="menu">Game select</button>
      </div>`);
    ovBox.querySelector('[data-act="resume"]').addEventListener('click', () => runner && runner.togglePause(false));
    ovBox.querySelector('[data-act="restart"]').addEventListener('click', startGame);
    ovBox.querySelector('[data-act="players"]').addEventListener('click', () => { stopRunner(); showRoles(); });
    ovBox.querySelector('[data-act="menu"]').addEventListener('click', () => { location.hash = ''; });
  }

  function showResult(res) {
    const g = current;
    const side = g.sides.find(s => s.key === res.winnerSide);
    const humanWon = roles[res.winnerSide] === 'human';
    const anyHuman = Object.values(roles).includes('human');
    Arcade.sfx(anyHuman ? (humanWon ? 'win' : 'lose') : 'win');
    const score = runner && runner.game.score ? Math.round(runner.game.score()) : 0;
    const scoringHuman = roles[g.scoreSide] === 'human';
    const qualifies = scoringHuman && Arcade.scores.qualifies(g.id, score);
    const medal = runner && runner.game.medal ? runner.game.medal() : null;
    const endTitle = (runner && runner.game.endTitle && runner.game.endTitle(res)) || 'Game over';
    const medalHtml = medal ? `<div class="medal" style="background:${medal.color}">${esc(medal.name)}</div>` : '';
    const scoreLine = g.scoreSide ? `<p>${esc(g.sides.find(s => s.key === g.scoreSide).label)} ${esc(g.scoreName)}: <b>${score}</b></p>` : '';
    const who = `<p class="who">${esc(side ? side.label : 'Nobody')} wins · ${humanWon ? 'human' : 'CPU'}</p>`;
    if (qualifies) return enterInitials(g, score, endTitle, who, res, medalHtml);
    showOverlay(`
      <p class="kick">${esc(endTitle)}</p>
      <h2>${esc(side ? side.label : 'Nobody')} wins</h2>
      <p class="who">${humanWon ? 'Human' : 'CPU'} player</p>
      <p>${esc(res.detail || '')}</p>
      ${medalHtml}${scoreLine}
      <div class="scores" id="ovScores"></div>
      <div class="ov-actions">
        <button class="pix-btn primary" type="button" data-nav data-act="again" data-default="1">Play again</button>
        <button class="pix-btn" type="button" data-nav data-act="swap">Swap sides</button>
        <button class="pix-btn" type="button" data-nav data-act="players">Change players</button>
        <button class="pix-btn" type="button" data-nav data-act="menu">Game select</button>
      </div>`);
    renderScores(ovBox.querySelector('#ovScores'), g);
    wireResultButtons();
  }
  function wireResultButtons() {
    ovBox.querySelector('[data-act="again"]').addEventListener('click', startGame);
    ovBox.querySelector('[data-act="swap"]').addEventListener('click', () => {
      const [a, b] = current.sides.map(s => s.key);
      [roles[a], roles[b]] = [roles[b], roles[a]];
      startGame();
    });
    ovBox.querySelector('[data-act="players"]').addEventListener('click', () => { stopRunner(); showRoles(); });
    ovBox.querySelector('[data-act="menu"]').addEventListener('click', () => { location.hash = ''; });
  }

  // arcade-style initials: ↑↓ change the letter, ←→ move, or just type; Enter saves
  function enterInitials(g, score, endTitle, who, res, medalHtml) {
    const letters = (store.get('arcade:lastInitials') || 'AAA').split('');
    let slot = 0;
    const draw = () => {
      ovBox.querySelector('.initials').innerHTML = letters.map((c, i) => `<span data-on="${i === slot}">${esc(c)}</span>`).join('');
    };
    showOverlay(`
      <p class="kick">${esc(endTitle)}</p>
      <h2>New high score!</h2>
      ${who}
      ${medalHtml}
      <p>${esc(g.scoreName)}: <b>${score}</b></p>
      <p>Enter your initials</p>
      <div class="initials"></div>
      <div class="ov-actions"><button class="pix-btn primary" type="button" data-nav data-act="save" data-default="1">Save</button></div>`, k => {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const i = A.indexOf(letters[slot]);
        letters[slot] = A[(i + (k === 'ArrowUp' ? 1 : -1) + A.length) % A.length];
        draw(); Arcade.sfx('select'); return true;
      }
      if (k === 'ArrowLeft') { slot = Math.max(0, slot - 1); draw(); return true; }
      if (k === 'ArrowRight') { slot = Math.min(2, slot + 1); draw(); return true; }
      if (/^[A-Za-z0-9]$/.test(k)) { letters[slot] = k.toUpperCase(); slot = Math.min(2, slot + 1); draw(); Arcade.sfx('select'); return true; }
      if (k === 'Backspace') { slot = Math.max(0, slot - 1); return true; }
      return false;
    });
    draw();
    ovBox.querySelector('[data-act="save"]').addEventListener('click', () => {
      const name = letters.join('');
      store.set('arcade:lastInitials', name);
      const table = Arcade.scores.add(g.id, name, score);
      const rank = table.findIndex(r => r.name === name.toUpperCase().slice(0, 3) && r.score === score);
      Arcade.sfx('coin');
      showOverlay(`
        <p class="kick">${esc(endTitle)}</p>
        <h2>Hall of fame</h2>
        <div class="scores" id="ovScores"></div>
        <div class="ov-actions">
          <button class="pix-btn primary" type="button" data-nav data-act="again" data-default="1">Play again</button>
          <button class="pix-btn" type="button" data-nav data-act="swap">Swap sides</button>
          <button class="pix-btn" type="button" data-nav data-act="players">Change players</button>
          <button class="pix-btn" type="button" data-nav data-act="menu">Game select</button>
        </div>`);
      renderScores(ovBox.querySelector('#ovScores'), g, rank);
      wireResultButtons();
    });
  }

  /* ================= keyboard ================= */
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'KeyM' && !(nav && nav.onKey && /^[A-Za-z]$/.test(e.key) && ovBox.querySelector('.initials'))) { toggleSound(); return; }
    if (mode === 'select') {
      if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); choose(sel + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); choose(sel - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startSelected(); }
      else if (/^[1-7]$/.test(e.key)) { choose(+e.key - 1); }
      return;
    }
    // overlays
    if (!overlay.hidden && nav) {
      if (nav.onKey && nav.onKey(e.key)) { e.preventDefault(); return; }
      if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !nav.items[nav.i].classList.contains('role')) || e.key === 'Tab') {
        e.preventDefault(); nav.i = (nav.i + 1) % nav.items.length; focusNav(); Arcade.sfx('select'); return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); nav.i = (nav.i - 1 + nav.items.length) % nav.items.length; focusNav(); Arcade.sfx('select'); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = nav.items[nav.i];
        if (it.classList.contains('role')) { nav.i = nav.items.findIndex(x => x.dataset.act === 'start'); focusNav(); return; }
        it.click(); return;
      }
      if (e.key === 'Escape' && ovBox.querySelector('[data-act="menu"]') && !ovBox.querySelector('[data-act="resume"]')) { location.hash = ''; return; }
      return;
    }
    if (e.key === 'Escape' && demoMode) { location.hash = ''; }
  });

  /* ================= deck buttons ================= */
  $('#btnBack').addEventListener('click', () => {
    if (mode === 'play' && runner && !demoMode && !runner.over && overlay.hidden) { runner.togglePause(true); return; }
    location.hash = '';
  });
  $('#btnStart').addEventListener('click', () => {
    if (mode === 'select') return startSelected();
    const p = ovBox.querySelector('.pix-btn.primary');
    if (!overlay.hidden && p) p.click();
  });
  $('#btnPause').addEventListener('click', () => runner && !demoMode && runner.togglePause());
  $('#btnSound').addEventListener('click', toggleSound);
  $('#pressStart').addEventListener('click', startSelected);

  // attract mode: after a while with no input, move on to the next game's demo
  window.addEventListener('pointermove', () => (idle = 0));
  window.addEventListener('keydown', () => (idle = 0));
  idleTimer = setInterval(() => {
    if (mode !== 'select' || document.hidden) return;
    idle += 1;
    if (idle >= 22) choose(sel + 1);
  }, 1000);

  window.addEventListener('hashchange', route);
  buildList();
  if (location.href.endsWith('#')) history.replaceState(null, '', location.pathname + location.search);
  route();

  // exposed for the automated tests in /tests
  window.__cabinet = { get runner() { return runner; }, startGame, setRoles: r => Object.assign(roles, r) };
})();
