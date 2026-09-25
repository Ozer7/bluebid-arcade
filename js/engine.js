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

  /* ---------- drawing helpers ---------- */
  const FONT = '"Silkscreen", ui-monospace, Menlo, Consolas, monospace';
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
        toast(msg, color) { self.toasts.push({ msg, color: color || Arcade.C.text, t: 1.6 }); }
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
      // toasts
      let y = H - 34;
      for (const s of this.toasts) {
        ctx.globalAlpha = Math.min(1, s.t * 2);
        ctx.font = `700 15px ${BODY}`;
        const w = ctx.measureText(s.msg).width + 28;
        ctx.fillStyle = 'rgba(14,21,40,.92)';
        Arcade.draw.roundRect(ctx, W / 2 - w / 2, y - 16, w, 32, 10);
        ctx.fill();
        Arcade.draw.text(ctx, s.msg, W / 2, y, { size: 15, color: s.color, align: 'center' });
        y -= 40;
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
