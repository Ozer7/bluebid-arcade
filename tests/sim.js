// Headless balance test: runs computer-vs-computer matches with no drawing
// and reports who wins and how long games last.
// Usage: node tests/sim.js <gameId> [matches] [maxSeconds]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { window: {}, console, Math, setTimeout: () => 0, requestAnimationFrame: () => 0 };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['engine.js', 'games/snake.js', 'games/breakout.js', 'games/splat.js', 'games/asteroids.js', 'games/missile.js', 'games/tetris.js'])
  if (fs.existsSync(path.join(root, 'js', f))) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const A = ctx.Arcade;
const [id, n = 20, maxS = 600] = process.argv.slice(2);
const def = A.games.find(g => g.id === id);
const res = {}; const times = [];
for (let m = 0; m < +n; m++) {
  let over = null, time = 0;
  const roles = {}; def.sides.forEach(s => roles[s.key] = 'cpu');
  const api = { W: 800, H: 600, roles, isHuman: () => false, humanCount: () => 0, keys: new Set(), pointer: { x: 0, y: 0 },
    get time() { return time; }, end(w, d) { if (!over) over = { w, d }; }, toast() {}, sfx() {} };
  const g = def.create(api);
  const t0 = Date.now();
  while (!over && time < +maxS) { g.update(1 / 60); time += 1 / 60; }
  const key = over ? over.w : 'timeout';
  res[key] = (res[key] || 0) + 1; times.push(time);
  if (process.env.V) console.log(m, key, time.toFixed(0) + 's', over && over.d, g._state && JSON.stringify(g._state()), (Date.now() - t0) + 'ms');
}
times.sort((a, b) => a - b);
console.log(id, JSON.stringify(res), 'median', times[times.length >> 1].toFixed(0) + 's', 'min', times[0].toFixed(0), 'max', times[times.length - 1].toFixed(0));
