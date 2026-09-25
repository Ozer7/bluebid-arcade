# BlueBid Arcade: the Cocktail Cabinet

Seven arcade games on one static page. In every game, either side can be played by a human or by the computer.

**Live:** https://games.bluebid.online · **Imitation:** runs as a Claude artifact (linked from the cabinet)

| Game | Side A | Side B | Flipped mode |
|---|---|---|---|
| Snake | Snake (steers) | Apples (places them) | You place apples, the computer steers |
| Breakout | Blue paddle (bottom) | Orange paddle (top) | The computer plays against you, head to head |
| Splat | Flier | Builder (lays out the columns) | You build, the computer flies without cheating |
| Asteroids | Pilot | Thrower | The computer flies, you throw asteroids |
| Missile Command | Defender | Attacker | You attack, the computer defends |
| Stack & Deal *(my game)* | Stacker | Dealer (picks every piece) | You deal, the computer stacks |
| Imitation | You | A person in another browser, or Claude | Chat for 2 minutes, then guess |

## How the code is organised

```
index.html            the cabinet page (menu + game stage)
css/cabinet.css       page styles
js/engine.js          shared engine: 60 Hz fixed-step loop, input, drawing helpers
js/cabinet.js         menu, "who plays which side" pickers, pause/result screens
js/games/*.js         one file per game (rules, both computer players, drawing)
imitation/index.html  source of the Imitation artifact (runs inside Claude)
tests/sim.js          headless computer-vs-computer balance test
tests/browser.mjs     browser smoke test (every game, every role combination)
netlify.toml          Netlify settings (no build step)
```

Every game file has the same shape:

```js
Arcade.register({
  id, title, sides: [{ key, label, human, cpu }], defaults,
  thumb(ctx, w, h),     // picture on the cabinet card
  create(api) {         // returns { update(dt), draw(ctx), onKey?, onPointer? }
    ...
  }
});
```

`api.isHuman(sideKey)` tells a game whether to read the keyboard or mouse for that side, or to run its computer player. Both paths call the same actions, like `flap()`, `launch()` and `hardDrop()`, so the computer is bound by the same physics, speed limits, ammo and cooldowns as a person.

## Fairness and difficulty (how each computer player works)

- **Snake:** a breadth-first search that knows when each body segment will move out of the way, plus a check that the snake can still reach its tail after eating. The computer apple placer hunts for dead ends and traps. Rule for both placers: an apple must be reachable and at least 3 cells away, and the hunger timer is sized from the real path length.
- **Breakout:** predicts where the ball will cross its line (wall and brick bounces included), adds aiming error, and angles its returns. Paddle speed is capped at the same value for mouse, keys and computer.
- **Splat:** before each flap decision, the flier simulates "flap now" and "don't flap" about one second ahead using the real physics, and allows for its own reaction time. It only sees columns already on screen. A builder can't move a gap more than a set distance from the previous one, so every layout can be flown.
- **Asteroids:** the pilot computes each rock's closest approach, tries escape manoeuvres in a quick simulation, and leads its shots. It has to rotate to aim. The thrower pays the same energy costs as a human.
- **Missile Command:** the defender reacts after a delay, solves for the aim point so the blast meets the missile, and skips missiles that are already doomed. The attacker targets the least-defended cities and times salvos to arrive together.
- **Stack & Deal:** the stacker scores every legal placement (height, holes, bumpiness, lines) and then actually steers the piece there one key press at a time. The dealer gives the worst-fitting piece, but can't deal the same piece three times in a row and must deal an I-piece at least every 12 pieces.

Every computer player has a skill value that starts low and rises as the game goes on (slower reactions, more aim error, and more mistakes early on). The game also speeds up level by level, so it starts easy and gets harder from whichever side you play.

## Testing

```bash
node tests/sim.js snake 40          # 40 computer-vs-computer games, prints who won and how long they lasted
python3 -m http.server 8765 &       # then:
node tests/browser.mjs http://localhost:8765/ /tmp   # plays every game in 3 role combos, screenshots, console errors
```

Balance results after easing the computer players (30–40 computer-vs-computer games each):

| Game | Result | Typical length |
|---|---|---|
| Snake | snake 50% / apples 50% | ~1:40 |
| Breakout | blue 40% / orange 60% | ~1:00 |
| Splat | flier 33% / builder 67% | deaths spread across levels |
| Asteroids | pilot 50% / thrower 50% | ~2:00 |
| Missile Command | defender 33% / attacker 67% | often down to the last city in wave 7 |
| Stack & Deal | stacker 43% / dealer 57% | ~2:10 |

## Deploying (GitHub → Netlify → games.bluebid.online)

1. Push this folder to a GitHub repo.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo. Leave the build command empty and set the publish directory to `.`, then deploy. Every push to `main` will now deploy automatically.
3. In Netlify, go to **Domain management → Add a domain** and enter `games.bluebid.online`.
4. DNS: if bluebid.online uses GoDaddy's nameservers, add a **CNAME** record in GoDaddy with host `games` pointing to `<your-site>.netlify.app`. If it uses Netlify DNS, Netlify adds the record for you.
5. Wait for Netlify to issue the HTTPS certificate, then open https://games.bluebid.online in a private window to confirm it loads signed out.
