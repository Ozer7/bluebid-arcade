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

## The look: a real arcade cabinet

Research on arcade front-ends and cabinets (attract mode, marquee, bezel, control deck, three-letter high-score tables) shaped the page:

- **Cabinet:** a lit **marquee** on top (it changes to each game's colours), a curved **CRT** with scanlines inside a bezel, and a **control deck** with round arcade buttons (Back, Start, Pause, Sound).
- **Game select in attract mode:** a joystick-style list (↑ ↓ or 1–7, Enter to start) with a live CPU-vs-CPU **demo** of the highlighted game, its original year, the flip, and its **top-5 high scores**. Left alone for 22 seconds, it cycles through the games by itself, like an arcade machine does.
- **Instruction card** under the screen, like the printed card under the glass on a real cabinet.
- **High scores with 3-letter initials** (arrow keys or typing), saved in the browser. **Sound effects** from a small chip-style synthesiser (WebAudio, no files), with an M key to mute.
- **Every game has its own era look** instead of one shared style:

| Game | Looks like | Details taken from the original |
|---|---|---|
| Snake | Nokia 6110 LCD (1998) | green-grey LCD palette, ghosting pixels, blinking death, points per apple rise with level |
| Breakout | Atari 1976 cabinet | white-on-black monitor under coloured cellophane strips, 8 brick rows worth 1/3/5/7, square ball, speed-ups after 4 and 12 hits and on the first orange and red brick |
| Splat | Flappy Bird (2013) | pixel sky, city and ground stripes, outlined pipes, big outlined score, bronze/silver/gold medals at 10/20/30 |
| Asteroids | Atari vector monitor (1979) | glowing thin lines with phosphor afterglow, rocks worth 20/50/100, heartbeat that speeds up, risky hyperspace (Shift/H, 20% chance to explode) |
| Missile Command | Atari raster (1980) | colour scheme changes every two waves (like the original's wave table), ABM pyramids on 3 bases, colour-cycling fireballs, score multiplier ×1→×4, end-of-wave bonus count, "THE END" explosion |
| Stack & Deal | Game Boy Tetris (1989) | four greens, brick-walled well, block patterns instead of colours, blinking line clears, Game Boy scoring 40/100/300/1200 × level |
| Imitation | teletype terminal | green phosphor text, modem "dialing" while matchmaking, Human or Not turn rules (one message each, 100 characters, 20 seconds per turn) |

## How the code is organised

```
index.html            the cabinet page (menu + game stage)
css/cabinet.css       page styles
js/engine.js          shared engine: 60 Hz fixed-step loop, input, drawing, human-behaviour model, sound, high scores
js/cabinet.js         attract-mode game select, demo previews, side pickers, pause/result/initials screens
js/games/*.js         one file per game (rules, both computer players, drawing)
imitation/index.html  source of the Imitation artifact (runs inside Claude)
tests/sim.js          headless computer-vs-computer balance test
tests/browser.mjs     browser smoke test (every game, every role combination)
netlify.toml          Netlify settings (no build step)
```

Every game file has the same shape:

```js
Arcade.register({
  id, title, year, history, scoreSide, scoreName,
  sides: [{ key, label, human, cpu }], defaults,
  thumb(ctx, w, h),     // still picture
  create(api) {         // returns { update(dt), draw(ctx), onKey?, onPointer?, score?, medal?, endTitle? }
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
- **Stack & Deal:** the stacker makes its first move 400–600 ms after a piece appears and presses keys about 250 ms apart, speeding up under pressure. Like weaker players, it often spins a piece to "look" at it before settling. It sometimes holds a direction key a moment too long and lands one column off. The dealer looks at the board, decides, then moves the mouse to the palette and clicks.

Everything controlled with a mouse (the apple placer, the thrower, both Missile Command sides, the dealer) takes human mouse-travel time from Fitts' law, at about 3.8 bits per second.

### Research behind the numbers

- Reaction time averages about 250 ms, and 350–500 ms when choosing between options ([reaction-time-test.io](https://www.reaction-time-test.io/average-reaction-time)).
- Tetris players start rotating 400–600 ms after a piece appears and average about 250 ms between key presses. They rotate pieces on screen because turning one in your head takes 800–1200 ms per quarter turn ([Kirsh & Maglio, 1994](https://adrenaline.ucsd.edu/kirsh/Articles/CogsciJournal/DistinguishingEpi_prag.pdf)). Only world champions react in 60–130 ms ([the "cognitive speed-bump" study](https://escholarship.org/content/qt7gv9443c/qt7gv9443c_noSplash_50081b22db30d526bd4460d55de9b431.pdf?t=sgo4qw)).
- Breakout players look about 150 ms ahead of the ball, fall behind for about 200 ms after bounces, and focus on the paddle about 300 ms before impact ([Looking at Breakout](https://ri.conicet.gov.ar/bitstream/11336/56606/2/CONICET_Digital_Nro.7be67435-94e5-45cf-8d27-4939d5b87587_A.pdf)).
- Mouse pointing runs at about 3.78 bits per second ([MacKenzie, ISO 9241-9](https://www.yorku.ca/mack/gi2009.html)).
- In Snake, nearly every death is self-trapping, and beginners take the shortest route to the fruit ([cpscount.com](https://cpscount.com/blogs/snake-game-strategy/)). A typical game lasts 1–3 minutes ([theoriginalsnake.com](https://theoriginalsnake.com/faq)).
- Flappy-style players do best with calm, rhythmic taps and lose control when they tap frantically ([Tanooki Site](https://tanookisite.com/flappy-bird-players-guide/)). One amateur's 77 games averaged about 18 points ([jetcitydigital](https://jetcitydigital.wordpress.com/2014/02/10/a-weekend-of-flappy-bird-quantified/)).
- In Missile Command, players under-lead missiles, waste shots on rubble, and as beginners usually see only the first 5–6 waves ([StrategyWiki](https://strategywiki.org/wiki/Missile_Command/Walkthrough), [Retro Game Deconstruction Zone](https://www.retrogamedeconstructionzone.com/2019/11/missilie-command-deep-dive.html)).
- In Asteroids, players camp in the center, beginners shoot big rocks carelessly, and edge wrap-arounds cause surprise deaths ([arcade.ly](https://arcade.ly/asteroids-tips-and-tricks)).

### Research behind the rules and the look

- **Breakout (1976):** 8 rows in pairs of yellow, green, orange, red worth 1, 3, 5, 7; the ball speeds up after 4 hits, after 12 hits, and on first contact with the orange and red rows; the black-and-white monitor was coloured with cellophane strips ([Wikipedia: Breakout](https://en.wikipedia.org/wiki/Breakout_(video_game)), [Arcade Museum](https://www.arcade-museum.com/game_detail.php?game_id=7194)).
- **Asteroids (1979):** vector display, inertia, hyperspace as a risky escape, large/medium/small rocks worth 20/50/100, and the two-note "heartbeat" that speeds up as a wave goes on ([Wikipedia: Asteroids](https://en.wikipedia.org/wiki/Asteroids_(video_game))).
- **Missile Command (1980):** three bases with 10 missiles each (the center one fastest), a multiplier that climbs every two waves, bonus points for unused missiles and surviving cities, colour schemes that change every two waves, and the "THE END" screen ([Wikipedia: Missile Command](https://en.wikipedia.org/wiki/Missile_Command), [StrategyWiki](https://strategywiki.org/wiki/Missile_Command/Walkthrough)).
- **Flappy Bird (2013):** a tap sets a fixed upward speed, gravity pulls hard, and medals come at 10/20/30/40 ([Flappy Bird Wiki](https://flappybird.fandom.com/wiki/Medals)).
- **Nokia Snake:** the two-tone LCD palette ([Lospec: Nokia 3310](https://lospec.com/palette-list/nokia-3310)); higher levels give more points per food.
- **Game Boy Tetris (1989):** the four-green DMG palette ([Lospec](https://lospec.com/palette-list/nintendo-gameboy-bgb)), 40/100/300/1200 × (level+1) scoring and blinking line clears ([Tetris Wiki](https://tetris.wiki/Tetris_(Game_Boy))).
- **Imitation:** AI21's *Human or Not* (2023): 2-minute chats, alternating turns, 100-character messages, 20 seconds per message. Players guessed right 68% of the time: 60% against bots and 73% against people ([Jannai et al., 2023](https://arxiv.org/abs/2305.20010)).
- **Arcade look:** attract mode (title, demo, high scores, "insert coin") and three-initial high-score tables ([TV Tropes: Attract Mode](https://tvtropes.org/pmwiki/pmwiki.php/Main/AttractMode)); game feel from screen shake, flashes and sound ([Vlambeer, "The Art of Screenshake"](https://www.youtube.com/watch?v=AJdEqssNZ-U)).

The computer players get a little sharper as each game goes on ("warming up"), and the games themselves speed up. So a game starts easy and gets harder whichever side you're on. Fairness rules still apply to both sides: apples must be reachable, gap moves are limited, the dealer can't repeat a piece three times in a row, and speeds and ammo are the same for everyone.

## Testing

```bash
node tests/sim.js snake 40          # 40 computer-vs-computer games, prints who won and how long they lasted
python3 -m http.server 8765 &       # then:
node tests/browser.mjs http://localhost:8765/ /tmp   # plays every game in 3 role combos, screenshots, console errors
```

Balance results after the arcade redesign (60 computer-vs-computer games each, one run):

| Game | Result | Typical length |
|---|---|---|
| Snake | snake 37% / apples 63% | ~1:55 |
| Breakout | blue 57% / orange 43% (200-game run: 53/47) | ~0:55 |
| Splat | flier 22% / builder 78% | ~0:42 |
| Asteroids | pilot 32% / thrower 68% | ~1:30 |
| Missile Command | defender 30% / attacker 70% | ~3:45, usually into wave 6–7 |
| Stack & Deal | stacker 53% / dealer 47% | ~2:40 |

## Deploying (GitHub → Netlify → games.bluebid.online)

1. Push this folder to a GitHub repo.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo. Leave the build command empty and set the publish directory to `.`, then deploy. Every push to `main` will now deploy automatically.
3. In Netlify, go to **Domain management → Add a domain** and enter `games.bluebid.online`.
4. DNS: if bluebid.online uses GoDaddy's nameservers, add a **CNAME** record in GoDaddy with host `games` pointing to `<your-site>.netlify.app`. If it uses Netlify DNS, Netlify adds the record for you.
5. Wait for Netlify to issue the HTTPS certificate, then open https://games.bluebid.online in a private window to confirm it loads signed out.
