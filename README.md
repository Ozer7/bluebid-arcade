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

## How the computer plays: like a person

Every computer player is built on a shared human-behaviour model (`Arcade.Human` in `engine.js`), not a perfect algorithm with noise added. It's grounded in reaction-time research:

- about 250 ms to react to something new (casual gamers are around 230 ms)
- 350–500 ms when there are several things to choose between
- occasional attention lapses
- aim that gets sloppier under pressure

Game by game:

- **Snake:** heads for the apple along an L-shaped route, turns a cell early when a wall is coming, hugs the edges once it's long, and avoids small pockets it can see. It turns a step late when the snake is fast, misjudges big enclosed areas, and takes risks when hungry. So it dies the way people do: boxed in by its own body, or clipping a wall at speed. The computer apple placer mostly drops apples "somewhere far away", and more and more often tucks them behind the body or in corners.
- **Splat:** the flier watches the next gap and taps whenever the bird sinks too low. What it sees is slightly behind reality, and its taps carry timing scatter. It taps frantically when the next gap is far above and lets the bird fall too long when it's far below. Its eyes move to the next gap only after clearing the current pipe. When it crashes, the bird tumbles to the ground and splats. The computer builder drags its cursor like a mouse (you can watch the preview move) and mixes gentle gaps with zig-zags, staircases and the occasional mean switch.
- **Breakout:** the paddle glances at the ball every fraction of a second and guesses where it will land (a straight line plus at most one wall bounce), refining the guess as the ball comes closer. It notices a brick bounce only a reaction-time later. It moves like a hand on a mouse: accelerates, overshoots slightly, settles.
- **Asteroids:** the pilot notices each new rock after a delay, turns and fires in bursts, and only partly leads its shots. When a rock gets close it commits to one panic escape, and it's bad at braking. The thrower saves up and throws bursts at where the ship is, starting with big rocks.
- **Missile Command:** the defender notices missiles late, has to move the mouse to each one (farther takes longer), usually aims not quite far enough ahead, fires again if a shot misses, and sometimes wastes shots. The attacker picks a city and hammers it, then switches.
- **Stack & Deal:** the stacker places about one piece a second at a person's key-tapping pace (8–11 presses a second). It sometimes rotates the long way round and misdrops pieces one column off, more often under pressure. The dealer gives random pieces early and more "worst fit" pieces later.

The computer players get a little sharper as each game goes on ("warming up"), and the games themselves speed up. So a game starts easy and gets harder whichever side you're on. Fairness rules still apply to both sides: apples must be reachable, gap moves are limited, the dealer can't repeat a piece three times in a row, and speeds and ammo are the same for everyone.

## Testing

```bash
node tests/sim.js snake 40          # 40 computer-vs-computer games, prints who won and how long they lasted
python3 -m http.server 8765 &       # then:
node tests/browser.mjs http://localhost:8765/ /tmp   # plays every game in 3 role combos, screenshots, console errors
```

Balance results with the human-like players (60–100 computer-vs-computer games each):

| Game | Result | Typical length |
|---|---|---|
| Snake | snake 45% / apples 55% | ~1:30 |
| Breakout | blue 50% / orange 50% | ~1:00 |
| Splat | flier 20–25% / builder 75–80% | most runs reach column 20+ |
| Asteroids | pilot 30–35% / thrower 65–70% | ~1:35 |
| Missile Command | defender 40% / attacker 60% | often down to the last cities in wave 7 |
| Stack & Deal | stacker 40% / dealer 60% | ~2:00 |

## Deploying (GitHub → Netlify → games.bluebid.online)

1. Push this folder to a GitHub repo.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo. Leave the build command empty and set the publish directory to `.`, then deploy. Every push to `main` will now deploy automatically.
3. In Netlify, go to **Domain management → Add a domain** and enter `games.bluebid.online`.
4. DNS: if bluebid.online uses GoDaddy's nameservers, add a **CNAME** record in GoDaddy with host `games` pointing to `<your-site>.netlify.app`. If it uses Netlify DNS, Netlify adds the record for you.
5. Wait for Netlify to issue the HTTPS certificate, then open https://games.bluebid.online in a private window to confirm it loads signed out.
