// Browser smoke test: opens the cabinet, starts every game in several role
// combinations, feeds it some human input, and reports console errors.
// Usage: node tests/browser.mjs [baseUrl] [shotsDir]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:8765/';
const shots = process.argv[3] || '/tmp';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForTimeout(600);
await page.screenshot({ path: `${shots}/cabinet.png`, fullPage: true });
const ids = await page.evaluate(() => Arcade.games.map(g => g.id));
const input = {
  snake: async () => { for (const k of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowRight']) { await page.keyboard.press(k); await page.waitForTimeout(250); } },
  breakout: async () => { await page.mouse.move(640, 600); await page.mouse.down(); await page.mouse.up(); await page.keyboard.press('Space'); },
  splat: async () => { for (let i = 0; i < 6; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(300); } },
  asteroids: async () => { await page.keyboard.down('ArrowLeft'); await page.keyboard.press('Space'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft'); },
  missile: async () => { await page.waitForTimeout(2500); await page.mouse.click(400, 300); },
  tetris: async () => { for (const k of ['ArrowLeft', 'ArrowUp', 'Digit1', 'Space', 'Digit3']) { await page.keyboard.press(k); await page.waitForTimeout(150); } }
};
for (const id of ids) {
  const def = await page.evaluate(id => { const g = Arcade.games.find(x => x.id === id); return { sides: g.sides.map(s => s.key) }; }, id);
  const combos = [
    Object.fromEntries(def.sides.map((k, i) => [k, i === 0 ? 'human' : 'cpu'])),
    Object.fromEntries(def.sides.map((k, i) => [k, i === 0 ? 'cpu' : 'human'])),
    Object.fromEntries(def.sides.map(k => [k, 'human']))
  ];
  for (const [ci, roles] of combos.entries()) {
    await page.goto(base + '#' + id);
    await page.waitForTimeout(300);
    await page.evaluate(r => { __cabinet.setRoles(r); __cabinet.startGame(); }, roles);
    await page.waitForTimeout(400);
    await input[id]();
    // human-placer style clicks on the canvas too
    const box = await page.locator('#screen').boundingBox();
    for (const [fx, fy] of [[0.7, 0.3], [0.3, 0.6], [0.85, 0.5]]) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => __cabinet.runner && __cabinet.runner.game._state ? __cabinet.runner.game._state() : null);
    if (ci === 1) await page.screenshot({ path: `${shots}/${id}.png` });
    console.log(id, JSON.stringify(roles), JSON.stringify(st, (k, v) => (k === 'board' || k === 'cols' ? undefined : v)));
  }
}
// pause overlay + result overlay
await page.goto(base + '#snake');
await page.waitForTimeout(300);
await page.evaluate(() => { __cabinet.setRoles({ snake: 'cpu', apples: 'cpu' }); __cabinet.startGame(); });
await page.keyboard.press('KeyP');
await page.waitForTimeout(200);
await page.screenshot({ path: `${shots}/paused.png` });
await page.keyboard.press('KeyP');
await page.evaluate(() => __cabinet.runner.api.end('snake', 'Test ending.'));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/result.png` });
// menu with attract demo, phone width
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '#tetris');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/phone-menu.png`, fullPage: true });
await page.goto(base);
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/phone-cabinet.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('horizontal overflow on phone:', overflow);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
