/* ==========================================================================
   BlueBid Arcade — shared engine
   --------------------------------------------------------------------------
   Every game registers itself with Arcade.register({...}). The engine owns:
     • the canvas and a fixed 60 Hz update loop (same physics for humans and
       computer players — the computer never gets a different simulation)
     • keyboard + pointer input, converted to the game's 800×600 coordinates
     • pause / game-over handling and small drawing helpers

   A game definition looks like:
     {
       id, title, tagline, blurb,
       sides: [ {key, label, human: "how a human plays it", cpu: "what the computer does"}, ... ],
       defaults: { sideKey: "human" | "cpu", ... },
       thumb(ctx, w, h),          // draws the little picture on the cabinet card
       create(api) -> instance    // instance has update(dt), draw(ctx), optional onKey/onPointer
     }
   ========================================================================== */
(function () {
  'use strict';

  const W = 800, H = 600;
  const STEP = 1 / 60;             // fixed simulation step (seconds)

  const Arcade = (window.Arcade = { W, H, STEP, games: [] });
  Arcade.register = def => Arcade.games.push(def);

  /* ---------- colours used on the canvases ---------- */
  Arcade.C = {
    bg: '#070b17', panel: '#0e1528', grid: '#121b33', line: '#26324f',
    text: '#e9edf7', muted: '#98a4c0', dim: '#5f6c8c',
    accent: '#4f7cff', good: '#2fbf71', bad: '#f25c69', warn: '#f0a83c',
    p1: '#4f7cff', p2: '#f0a83c', violet: '#a77bff', cyan: '#3cc8e0'
  };

  /* ---------- maths helpers ---------- */
  const U = (Arcade.util = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: arr => arr[Math.floor(Math.random() * arr.length)],
    chance: p => Math.random() < p,
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    // normally distributed noise (mean 0, sd 1) — used to give the computer human-like aim error
    gauss() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // shortest signed angle from a to b
    angleDiff(a, b) {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  });

  /* ---------- human-behaviour model ----------
     Every computer player is built on this so it plays like a person, not a
     perfect algorithm with noise sprinkled on. Numbers come from reaction-time
     research: a simple visual reaction averages ~250 ms (casual gamers ~230 ms,
     typical range 200–300 ms); a choice between several things takes 350–500 ms.
     People also have attention lapses, get sloppier under pressure, and aim
     with scatter that grows with distance and speed. */
  class Human {
    constructor(o = {}) {
      this.reaction = o.reaction ?? 0.25;      // mean simple reaction, seconds
      this.spread = o.spread ?? 0.22;          // log-normal spread (reaction times are right-skewed)
      this.lapseRate = o.lapseRate ?? 0.03;    // attention lapses per second
      this.pressure = 0;                       // 0 calm … 1 panicking — set by the game
    }
    // one reaction time sample, in seconds (choice = several options to pick from)
    react(choice = false) {
      const mean = (choice ? this.reaction * 1.6 : this.reaction) * (1 + this.pressure * 0.35);
      let t = mean * Math.exp(U.gauss() * this.spread - (this.spread * this.spread) / 2);
      if (Math.random() < this.lapseRate * t * 4) t += U.rand(0.25, 0.7);     // "wasn't looking"
      return U.clamp(t, 0.12, 1.6);
    }
    // aiming / placement scatter that grows under pressure
    scatter(sd) { return U.gauss() * sd * (1 + this.pressure * 0.8); }
    // is the player momentarily not paying attention?
    lapsed(dt) { return Math.random() < this.lapseRate * dt; }
    // Time to move the mouse to a target and click it (Fitts' law, Shannon form).
    // A mouse manages about 3.8 bits/s (MacKenzie, ISO 9241-9), plus ~60 ms to click.
    point(dist, width = 40) {
      const id = Math.log2(1 + Math.max(0, dist) / Math.max(4, width));
      return (0.06 + id / 3.8) * Math.exp(U.gauss() * 0.15) * (1 + this.pressure * 0.2);
    }
  }
  Arcade.Human = Human;

  // A short memory of past states, so a computer player can act on what it
  // saw a reaction-time ago instead of on the exact present.
  class Lag {
    constructor(seconds = 1) { this.buf = []; this.max = seconds; }
    push(t, state) { this.buf.push({ t, state }); while (this.buf.length && t - this.buf[0].t > this.max) this.buf.shift(); }
    at(t) {
      for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].t <= t) return this.buf[i].state;
      return this.buf.length ? this.buf[0].state : null;
    }
  }
  Arcade.Lag = Lag;

  /* ---------- sound: tiny chip-style synth (WebAudio), no audio files ----------
     Early arcade machines made their sounds with simple oscillators and noise;
     this does the same. Every sound is a short burst built from a square /
     triangle / sine wave or filtered noise. Silent until the player interacts
     (browsers require that), and can be muted from the cabinet. */
  const Sound = (Arcade.sound = {
    ctx: null,
    muted: (() => { try { return localStorage.getItem('arcade:muted') === '1'; } catch { return false; } })(),
    unlock() {
      if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return null;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch { this.ctx = null; }
      return this.ctx;
    },
    setMuted(m) { this.muted = m; try { localStorage.setItem('arcade:muted', m ? '1' : '0'); } catch { /* ignore */ } },
    tone({ f = 440, to = null, type = 'square', dur = 0.08, vol = 0.12, at = 0 }) {
      const c = this.ctx; if (!c || this.muted) return;
      const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise({ dur = 0.3, vol = 0.2, freq = 1200, to = 200, at = 0 }) {
      const c = this.ctx; if (!c || this.muted) return;
      const t = c.currentTime + at, n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; fl.type = 'lowpass';
      fl.frequency.setValueAtTime(freq, t); fl.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(fl).connect(g).connect(c.destination); src.start(t); src.stop(t + dur + 0.02);
    }
  });
  const SFX = {
    select: () => Sound.tone({ f: 880, dur: 0.04, vol: 0.06 }),
    coin: () => { Sound.tone({ f: 988, dur: 0.07, vol: 0.1 }); Sound.tone({ f: 1319, dur: 0.25, vol: 0.1, at: 0.07 }); },
    start: () => [523, 659, 784, 1047].forEach((f, i) => Sound.tone({ f, dur: 0.09, vol: 0.09, at: i * 0.08 })),
    blip: (o = {}) => Sound.tone({ f: o.f || 660, dur: 0.05, vol: 0.08 }),
    paddle: () => Sound.tone({ f: 470, dur: 0.05, vol: 0.12 }),
    wall: () => Sound.tone({ f: 236, dur: 0.05, vol: 0.1 }),
    brick: (o = {}) => Sound.tone({ f: o.f || 940, dur: 0.06, vol: 0.1 }),
    eat: () => { Sound.tone({ f: 660, to: 990, dur: 0.06, vol: 0.09 }); },
    step: () => Sound.tone({ f: 120, dur: 0.02, vol: 0.02, type: 'square' }),
    flap: () => Sound.tone({ f: 260, to: 520, dur: 0.07, vol: 0.07, type: 'triangle' }),
    point: () => { Sound.tone({ f: 1046, dur: 0.06, vol: 0.07 }); Sound.tone({ f: 1568, dur: 0.14, vol: 0.07, at: 0.06 }); },
    hit: () => { Sound.noise({ dur: 0.18, vol: 0.25, freq: 2400, to: 300 }); Sound.tone({ f: 160, to: 60, dur: 0.2, vol: 0.12 }); },
    fall: () => Sound.tone({ f: 700, to: 90, dur: 0.6, vol: 0.07, type: 'triangle' }),
    crash: () => { Sound.noise({ dur: 0.45, vol: 0.3, freq: 1600, to: 80 }); Sound.tone({ f: 110, to: 40, dur: 0.4, vol: 0.14 }); },
    fire: () => Sound.tone({ f: 1400, to: 250, dur: 0.1, vol: 0.06, type: 'square' }),
    thrust: () => Sound.noise({ dur: 0.08, vol: 0.05, freq: 500, to: 300 }),
    boomBig: () => Sound.noise({ dur: 0.7, vol: 0.3, freq: 900, to: 50 }),
    boomMid: () => Sound.noise({ dur: 0.45, vol: 0.25, freq: 1400, to: 80 }),
    boomSmall: () => Sound.noise({ dur: 0.25, vol: 0.2, freq: 2500, to: 150 }),
    thump: (o = {}) => Sound.tone({ f: o.high ? 64 : 55, dur: 0.12, vol: 0.35, type: 'sine' }),
    launch: () => Sound.noise({ dur: 0.35, vol: 0.12, freq: 3000, to: 600 }),
    abm: () => Sound.tone({ f: 900, to: 300, dur: 0.18, vol: 0.06, type: 'sawtooth' }),
    siren: () => [0, 0.25, 0.5].forEach(a => Sound.tone({ f: 600, to: 900, dur: 0.22, vol: 0.06, type: 'sawtooth', at: a })),
    tick: () => Sound.tone({ f: 1200, dur: 0.03, vol: 0.05 }),
    move: () => Sound.tone({ f: 330, dur: 0.02, vol: 0.04 }),
    rotate: () => Sound.tone({ f: 520, dur: 0.03, vol: 0.05 }),
    lock: () => Sound.tone({ f: 140, dur: 0.05, vol: 0.1 }),
    line: (o = {}) => (o.n === 4 ? [523, 659, 784, 1047, 1319] : [523, 784, 1047]).forEach((f, i) => Sound.tone({ f, dur: 0.08, vol: 0.08, at: i * 0.06 })),
    deal: () => Sound.tone({ f: 740, dur: 0.04, vol: 0.06, type: 'triangle' }),
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => Sound.tone({ f, dur: 0.12, vol: 0.09, at: i * 0.11 })),
    lose: () => [392, 330, 262, 196].forEach((f, i) => Sound.tone({ f, dur: 0.18, vol: 0.09, at: i * 0.16, type: 'triangle' }))
  };
  Arcade.sfx = (name, o) => { if (SFX[name] && Sound.ctx && !Sound.muted) try { SFX[name](o); } catch { /* ignore */ } };

  /* ---------- high-score tables (top 5 per game, 3-letter initials, kept in this browser) ---------- */
  Arcade.scores = {
    key: id => 'arcade:hs:' + id,
    get(id) { try { return JSON.parse(localStorage.getItem(this.key(id))) || []; } catch { return []; } },
    qualifies(id, score) { if (!(score > 0)) return false; const t = this.get(id); return t.length < 5 || score > t[t.length - 1].score; },
    add(id, name, score) {
      const t = this.get(id);
      t.push({ name: (name || 'AAA').toUpperCase().slice(0, 3), score, at: Date.now() });
      t.sort((a, b) => b.score - a.score);
      try { localStorage.setItem(this.key(id), JSON.stringify(t.slice(0, 5))); } catch { /* ignore */ }
      return t.slice(0, 5);
    }
  };

  /* ---------- drawing helpers ---------- */
  const FONT = '"Press Start 2P", "Silkscreen", ui-monospace, Menlo, Consolas, monospace';
  const BODY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  Arcade.draw = {
    FONT, BODY,
    text(ctx, str, x, y, o = {}) {
      ctx.save();
      ctx.font = `${o.weight || 700} ${o.size || 16}px ${o.pixel ? FONT : BODY}`;
      ctx.fillStyle = o.color || Arcade.C.text;
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = o.baseline || 'middle';
      if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 12; }
      ctx.fillText(str, x, y);
      ctx.restore();
    },
    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
    // a thin bar (0..1) — used for timers, energy, hunger
    bar(ctx, x, y, w, h, t, color, back = Arcade.C.line) {
      ctx.fillStyle = back;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * U.clamp(t, 0, 1), h);
    },
    // standard strip across the top of the canvas: [{text,color,align}]
    hud(ctx, items, height = 40) {
      ctx.fillStyle = 'rgba(7,11,23,.86)';
      ctx.fillRect(0, 0, W, height);
      ctx.fillStyle = Arcade.C.line;
      ctx.fillRect(0, height - 1, W, 1);
      for (const it of items) {
        const x = it.align === 'right' ? W - 16 : it.align === 'center' ? W / 2 : 16;
        Arcade.draw.text(ctx, it.text, it.x ?? x, height / 2, {
          size: it.size || 14, color: it.color || Arcade.C.text, align: it.align || 'left', pixel: it.pixel
        });
      }
    }
  };

  /* ---------- the runner: one live game on the stage ---------- */
  class Runner {
    constructor(canvas, def, roles, hooks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.def = def;
      this.roles = roles;                 // e.g. { snake: 'cpu', apples: 'human' }
      this.hooks = hooks;                 // { onEnd(result) }
      this.keys = new Set();
      this.pointer = { x: W / 2, y: H / 2, down: false, inside: false };
      this.paused = false;
      this.over = null;
      this.time = 0;
      this.toasts = [];
      this.acc = 0;
      this.last = 0;
      this.raf = 0;

      const self = this;
      this.api = {
        W, H,
        roles,
        isHuman: side => roles[side] === 'human',
        humanCount: () => Object.values(roles).filter(r => r === 'human').length,
        keys: this.keys,
        pointer: this.pointer,
        get time() { return self.time; },
        // winnerSide = one of the side keys; detail = sentence shown on the result card
        // `delay` lets a game finish its crash/death animation before the result card
        end(winnerSide, detail, delay = 900) {
          if (self.over) return;
          self.over = { winnerSide, detail };
          setTimeout(() => self.hooks.onEnd && self.hooks.onEnd(self.over), delay);
        },
        toast(msg, color) { self.toasts.push({ msg, color: color || '#ffd23f', t: 1.6 }); },
        // sound effects are silent in attract-mode demos
        sfx(name, o) { if (!self.quiet) Arcade.sfx(name, o); }
      };

      this.game = def.create(this.api);
      this._bind();
      this.raf = requestAnimationFrame(t => this._frame(t));
    }

    _toGame(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    }

    _bind() {
      const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
      this._kd = e => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (GAME_KEYS.includes(e.code)) e.preventDefault();
        if (e.code === 'KeyP' || e.code === 'Escape') { if (this.hooks.onPause) this.togglePause(); return; }
        if (!this.keys.has(e.code)) {
          this.keys.add(e.code);
          if (!this.paused && !this.over && this.game.onKey) this.game.onKey(e.code);
        }
      };
      this._ku = e => this.keys.delete(e.code);
      this._blur = () => this.keys.clear();
      this._pd = e => {
        const p = this._toGame(e);
        Object.assign(this.pointer, p, { down: true, inside: true });
        if (!this.paused && !this.over && this.game.onPointer) this.game.onPointer('down', p.x, p.y, e);
      };
      this._pm = e => {
        const p = this._toGame(e);
        Object.assign(this.pointer, p, { inside: true });
        if (!this.paused && !this.over && this.game.onPointer) this.game.onPointer('move', p.x, p.y, e);
      };
      this._pu = e => {
        this.pointer.down = false;
        if (!this.paused && !this.over && this.game.onPointer) { const p = this._toGame(e); this.game.onPointer('up', p.x, p.y, e); }
      };
      this._pl = () => { this.pointer.inside = false; };
      this._ctx = e => e.preventDefault();
      this._wheel = e => {
        if (this.game.onWheel && !this.paused && !this.over) { e.preventDefault(); this.game.onWheel(Math.sign(e.deltaY)); }
      };
      window.addEventListener('keydown', this._kd);
      window.addEventListener('keyup', this._ku);
      window.addEventListener('blur', this._blur);
      this.canvas.addEventListener('pointerdown', this._pd);
      this.canvas.addEventListener('pointermove', this._pm);
      window.addEventListener('pointerup', this._pu);
      this.canvas.addEventListener('pointerleave', this._pl);
      this.canvas.addEventListener('contextmenu', this._ctx);
      this.canvas.addEventListener('wheel', this._wheel, { passive: false });
    }

    togglePause(force) {
      if (this.over) return;
      this.paused = force === undefined ? !this.paused : force;
      this.keys.clear();
      this.hooks.onPause && this.hooks.onPause(this.paused);
    }

    _frame(t) {
      this.raf = requestAnimationFrame(tt => this._frame(tt));
      if (!this.last) this.last = t;
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt > 0.25) dt = 0.25;               // tab was hidden — don't fast-forward
      if (!this.paused) {
        this.acc += dt;
        while (this.acc >= STEP) {
          // after game over we keep updating for a moment so explosions finish
          this.game.update(STEP);
          this.time += STEP;
          this.acc -= STEP;
          for (const s of this.toasts) s.t -= STEP;
          this.toasts = this.toasts.filter(s => s.t > 0);
        }
      }
      this._draw();
    }

    // run the simulation without drawing — used by the automated tests
    fastForward(seconds) {
      const n = Math.round(seconds / STEP);
      for (let i = 0; i < n && !this.over; i++) { this.game.update(STEP); this.time += STEP; }
    }

    _draw() {
      const ctx = this.ctx;
      ctx.save();
      this.game.draw(ctx);
      // toasts: short arcade-style banners
      let y = H - 44;
      for (const s of this.toasts) {
        ctx.globalAlpha = Math.min(1, s.t * 2);
        ctx.font = `12px ${FONT}`;
        const w = ctx.measureText(s.msg.toUpperCase()).width + 28;
        ctx.fillStyle = 'rgba(0,0,0,.82)';
        ctx.fillRect(W / 2 - w / 2, y - 15, w, 30);
        ctx.strokeStyle = s.color; ctx.lineWidth = 2;
        ctx.strokeRect(W / 2 - w / 2 + 1, y - 14, w - 2, 28);
        Arcade.draw.text(ctx, s.msg.toUpperCase(), W / 2, y + 1, { size: 12, color: s.color, align: 'center', pixel: true });
        y -= 38;
      }
      ctx.restore();
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this._kd);
      window.removeEventListener('keyup', this._ku);
      window.removeEventListener('blur', this._blur);
      this.canvas.removeEventListener('pointerdown', this._pd);
      this.canvas.removeEventListener('pointermove', this._pm);
      window.removeEventListener('pointerup', this._pu);
      this.canvas.removeEventListener('pointerleave', this._pl);
      this.canvas.removeEventListener('contextmenu', this._ctx);
      this.canvas.removeEventListener('wheel', this._wheel);
    }
  }

  Arcade.Runner = Runner;
})();
