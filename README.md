# BlueBid Arcade: the Cocktail Cabinet

Eight arcade games on one static page. In every game, either side can be played by a human or by the computer.

**Live:** https://games.bluebid.online · **Imitation:** runs as a Claude artifact (linked from the cabinet)

| Game | Side A | Side B | Flipped mode |
|---|---|---|---|
| Snake | Snake (steers) | Apples (places them) | You place apples, the computer steers |
| Breakout | Blue paddle (bottom) | Orange paddle (top) | The computer plays against you, head to head |
| Splat | Flier | Builder (lays out the columns) | You build, the computer flies without cheating |
| Asteroids | Pilot | Thrower | The computer flies, you throw asteroids |
| Missile Command | Defender | Attacker | You attack, the computer defends |
| Stack & Deal *(my game)* | Stacker | Dealer (picks every piece) | You deal, the computer stacks |
| Picnic Defender *(my original game)* | Picnic (flicks the tablecloth) | Bugs (sends ants, beetles and a queen) | You send the bugs, the computer flicks the cloth |
| Imitation | You | A person in another browser, or Claude | Chat for 2 minutes, then guess |

## The look: a real arcade cabinet

Arcade cabinets and attract mode shaped the page:

- **Cabinet:** a lit **marquee** on top (it changes to each game's colours), a curved **CRT** with scanlines inside a bezel, and a **control deck** with round arcade buttons (Back, Start, Pause, Sound).
- **Game select in attract mode:** a list you move through with ↑ ↓ or 1–8 (Enter to start) with a live CPU-vs-CPU **demo** of the highlighted game, its original year, the flip, and its **top-5 high scores**. Left alone for 22 seconds, it cycles through the games by itself, like an arcade machine does.
- **Instruction card** under the screen, like the printed card under the glass on a real cabinet.
- **Get ready card** before every game: which side you are, your controls, how you win, and a 3-second countdown (Space or a click starts at once).
- **You play the normal side by default** (snake, bottom paddle, bird, pilot, defender, stacker, picnic); swap sides in one click.
- **Start at** (a testing aid) on the "Who's playing" screen: jump to a later level or wave instead of playing up to it. The game starts the way it would look by then: Snake as long as it would have grown, Stack & Deal with a messy stack, rocks already flying in Asteroids, bugs already crawling in Picnic Defender, and the score earned so far.
- **Everything you're waiting on is on screen**: hunger and apple timers, balls left, the builder's allowed gap range and lock countdown, the thrower's energy with each rock's cost, missiles per base and the attacker's reload, the dealer's "before it lands" deadline, Picnic Defender's flick meter and crumbs.
- **High scores with 3-letter initials** (arrow keys or typing), saved in the browser. **Sound effects** from a small chip-style synthesiser (WebAudio, no files), with an M key to mute.
- **Every game has its own era look** instead of one shared style:

| Game | Looks like | Details |
|---|---|---|
| Snake | Nokia 6110 LCD (1998) | green-grey LCD palette, ghosting pixels, blinking death, points per apple rise with level |
| Breakout | Atari 1976 cabinet | white-on-black monitor under coloured cellophane strips, 8 brick rows worth 1/3/5/7, square ball, speed-ups after 4 and 12 hits and on the first orange and red brick |
| Splat | Flappy Bird (2013) | pixel sky, city and ground stripes, outlined pipes, big outlined score, bronze/silver/gold medals at 10/20/30 |
| Asteroids | Atari vector monitor (1979) | glowing thin lines with phosphor afterglow, rocks worth 20/50/100, heartbeat that speeds up, risky hyperspace (Shift/H, 20% chance to explode) |
| Missile Command | Atari raster (1980) | colour scheme changes every two waves (like the original's wave table), ABM pyramids on 3 bases, colour-cycling fireballs, score multiplier ×1→×4, end-of-wave bonus count, "THE END" explosion |
| Stack & Deal | Game Boy Tetris (1989) | four greens, brick-walled well, block patterns instead of colours, blinking line clears, Game Boy scoring 40/100/300/1200 × level |
| Picnic Defender | picnic cartoon (my own, 2026) | red gingham cloth on a wooden table, ripples you can watch travel across the cloth, a flick-power meter marked with what each strength does, and a coached first game that teaches the slow drag and the flick before any bugs arrive |
| Imitation | teletype terminal | green phosphor text, modem "dialing" while matchmaking, Human or Not turn rules (one message each, 100 characters, 20 seconds per turn), and a coin flip between a person and Claude when two players search at once |

## How the code is organised

```
index.html            the cabinet page (menu + game stage)
css/cabinet.css       page styles
js/engine.js          shared engine: 60 Hz fixed-step loop, input, drawing, human-behaviour model, sound, high scores
js/cabinet.js         attract-mode game select, demo previews, side pickers, pause/result/initials screens
js/games/*.js         one file per game (rules, both computer players, drawing)
imitation/index.html  source of the Imitation artifact (runs inside Claude)
docs/IMPROVEMENTS.md  Wave 2 improvement log, game by game
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
- **Picnic Defender:** the picnic player takes longer to decide the more bugs it has to choose from (Hick-Hyman law), then moves its hand like a mouse: a fast first movement that lands a little off, followed most of the time by a small correction, at Fitts'-law speed. Each flick lasts about 150 ms, comes out a few degrees off the intended direction, and is never the same strength twice. Under pressure it rushes and sometimes flicks far too hard, and it pulls dishes back from the edge with a slow drag. The bug player moves a visible pointer the same way and clicks bugs onto the table: it goes after the dish that is easiest to finish, comes in from an edge the hand isn't guarding, strikes right after a flick, and sometimes saves up for a rush. The ants behave like real foraging ants: scouts zig-zag until they find food, their path becomes a scent trail that later ants follow in a line (a ripple scrambles it), an ant that finds food recruits the searchers near it, every ant walks at its own speed, and they stop for a moment every few seconds.
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

- **Breakout (1976):** 8 rows in pairs of yellow, green, orange, red worth 1, 3, 5, 7; the ball speeds up after 4 hits, after 12 hits, and on first contact with the orange and red rows; the black-and-white monitor was coloured with cellophane strips ([Wikipedia: Breakout](https://en.wikipedia.org/wiki/Breakout_(video_game))).
- **Asteroids (1979):** vector display, inertia, hyperspace as a risky escape, and a "heartbeat" that quickens as the game goes on ([Wikipedia: Asteroids](https://en.wikipedia.org/wiki/Asteroids_(video_game))); large/medium/small rocks worth 20/50/100 ([Asteroids disassembly](https://6502disassembly.com/va-asteroids/)).
- **Missile Command (1980):** three bases with 10 missiles each (the center one fastest), a multiplier that climbs every two waves, bonus points for remaining missiles and cities, and "The End" instead of "Game Over" ([Wikipedia: Missile Command](https://en.wikipedia.org/wiki/Missile_Command)); the colour scheme for each pair of waves ([Missile Command wave guide](https://6502disassembly.com/va-missile-command/wave-guide.html)).
- **Flappy Bird (2013):** bronze, silver, gold and platinum medals at 10, 20, 30 and 40 points ([Wikipedia: Flappy Bird](https://en.wikipedia.org/wiki/Flappy_Bird)).
- **Nokia Snake:** the two-tone LCD palette ([Lospec: Nokia 3310](https://lospec.com/palette-list/nokia-3310)).
- **Game Boy Tetris (1989):** the four-green palette ([Lospec: Original Gameboy](https://lospec.com/palette-list/original-gameboy)), 40/100/300/1200 × (level+1) scoring ([TetrisWiki: Scoring](https://tetris.wiki/Scoring)), and a level every 10 lines ([TetrisWiki: Tetris (Game Boy)](https://tetris.wiki/Tetris_(Game_Boy))).
- **Picnic Defender (my original game):** the tablecloth trick works by inertia: the cloth moves away quickly but the dishes stay where they were, helped by a smooth, low-friction cloth ([UMD Physics lecture demos](https://lecdem.physics.umd.edu/tools-and-resources/lecdem-blog/411-blog-highlight-tablecloth-part1.html)). The trick has been a game before, as Taito's arcade test *The Tablecloth Hour* (2010) ([Arcade Heroes](https://arcadeheroes.com/2010/08/15/test-your-tablecloth-pulling-skills-with-the-tablecloth-hour/)) and Super Mario Party's *Clearing the Table* ([Super Mario Wiki](https://www.mariowiki.com/Clearing_the_Table)); neither has enemies. Using the cloth's ripple to throw bugs off the table while defending the food is the new part.
- **Picnic Defender: how people point, flick and decide.** Mouse flicks take about 151 ms (sd 53) and land about 4° off the intended direction ([Moyle & Cockburn, "Analysing Mouse and Pen Flick Gestures"](https://www.csse.canterbury.ac.nz/andrew.cockburn/papers/moyle-cockburn.pdf)). About 65% of aimed movements have a second, correcting movement after the first one ([Liverpool John Moores University study on aiming](https://researchonline.ljmu.ac.uk/15895/3/Optimization%20in%20manual%20aiming%20relating%20inherent%20variability%20and%20target%20size%2C%20and%20its%20influence%20on%20tendency.pdf)). Choice reaction time grows by about 150 ms for every doubling of the options (Hick-Hyman law; [KSU lecture notes](https://faculty.ksu.edu.sa/sites/default/files/2%20Chapter%203%20Information%20Processing%20-%20Part%203%20-%20Hick%20Hyman%20Law%20%28AMS%20Feb01_25%29.pdf)).
- **Picnic Defender: how ants forage.** Argentine ants recruit nestmates to food straight from their trails, which sped up food collection at least 9 times; ants on the trail walked about 1.07 ± 0.45 m/min ([Flanagan et al., 2013, PLOS ONE](https://pinterwollmanlab.eeb.ucla.edu/wp-content/uploads/sites/86/2016/05/Flanagan-et-al-2013-Plos-One.pdf)).
- **Picnic Defender: difficulty and pull.** Waves follow a sawtooth: each peak a little higher than the last, with a short valley of relief between them, and a gentle start ([Abratabia: difficulty curves](https://www.abratabia.com/game-design/difficulty-curves.php)). Against a person, the computer bugs quietly hold back when the player is struggling and press harder when they're cruising, by changing what they send, never the rules, in the spirit of Hunicke's Hamlet system ([Hunicke & Chapman](https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf)). Losing narrowly gives the strongest urge to play again ([Larche, Musielak & Dixon, 2017](https://link.springer.com/article/10.1007/s10899-016-9633-7)), so the end screen says how close you came.
- **Picnic Defender: speed.** An arcade run should last between 30 seconds and 3 minutes, keep the first minute at low intensity, then roughly double the pressure ([Game-Ace: arcade game design](https://game-ace.com/blog/arcade-game-design/)), so a game is 2:00 with 20-second waves, and the bugs' income and speed climb every wave. Waves get harder in more than one way at once (more bugs, faster bugs, tougher bugs) so it doesn't feel like the game just adds enemies ([GameDev.net thread on wave progression](https://www.gamedev.net/topic/627974-zombie-game-wave-difficulty-progression/)). People learn fastest when they succeed about 85% of the time ([Wilson et al., 2019, via Neuroscience News](https://neurosciencenews.com/learning-optimized-15171/)); most single flicks succeed, but a whole game is very hard to win: after play-testers found it too easy twice, the simulated experienced player (built from lab reaction and flick data) almost never survives the full 2:00, and real players who learn the flick still do better than it.
- **Imitation:** AI21's *Human or Not* (2023): 2-minute chats, alternating turns, 100-character messages, 20 seconds per message. Players guessed right 68% of the time: 60% against bots and 73% against people ([Jannai et al., 2023](https://arxiv.org/abs/2305.20010)).
- **Clear to a new player (Wave 2):** the first usability heuristic is to always show the system's status ([Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/)); game-specific heuristics add "provide users with information on game status" and "provide instructions, training, and help" ([Pinelle, Wong & Stach, CHI 2008](https://course.ccs.neu.edu/is4300f15/ssl/pinelle-chi08.pdf)). Counts you act on (ammo-like) read best where you use them, and status (health-like) in a fixed HUD ([McMaster HUD study](https://gscale.cas.mcmaster.ca/research/empiricalHUDs/)), so missile counts sit on each base, the gap range sits at the pipe, and lives and timers sit in the top bar.
- **Arcade look:** attract mode, where an idle machine shows gameplay and high scores to draw players in ([TV Tropes: Attract Mode](https://tvtropes.org/pmwiki/pmwiki.php/Main/AttractMode)); game feel from screen shake, flashes and sound ([Jan Willem Nijman, "The Art of Screenshake"](https://www.youtube.com/watch?v=AJdEqssNZ-U)).

The computer players get a little sharper as each game goes on ("warming up"), and the games themselves speed up. So a game starts easy and gets harder whichever side you're on. Fairness rules still apply to both sides: apples must be reachable, gap moves are limited, the dealer can't repeat a piece three times in a row, and speeds and ammo are the same for everyone.

## Testing

```bash
node tests/sim.js snake 40          # 40 computer-vs-computer games, prints who won and how long they lasted
node tests/skilled.js 60            # Picnic Defender: a quick, experienced picnic player against the computer bugs
LEVEL=4 node tests/sim.js missile 10   # start every game at level/wave 4 (same as the Start at row)
python3 -m http.server 8765 &       # then:
node tests/browser.mjs http://localhost:8765/ /tmp   # plays every game in 3 role combos, screenshots, console errors
```

Balance results for Wave 2 (computer vs computer, 60–120 games each; Wave 1 in brackets):

| Game | Result | Typical length |
|---|---|---|
| Snake | snake 43% / apples 57% (was 37 / 63) | ~2:00 |
| Breakout | bottom 58% / top 42% (was 57 / 43) | ~0:50 |
| Splat | bird 48% / builder 52% (was 22 / 78) | ~0:50 |
| Asteroids | pilot 45% / thrower 55% (was 32 / 68) | ~1:40 |
| Missile Command | defender 50% / attacker 50% (was 30 / 70) | ~3:45 |
| Stack & Deal | stacker 53% / dealer 47% (unchanged) | ~2:40 |
| Picnic Defender | bugs win almost every computer game (made the hardest game on purpose after play-testing); the simulated experienced player (`node tests/skilled.js 60`) lasts about 6 s; wave 1 is as hard as the old wave 6 and each wave doubles it | ~0:06 (2:00 if the picnic survives) |

## Deploying (GitHub → Netlify → games.bluebid.online)

1. Push this folder to a GitHub repo.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo. Leave the build command empty and set the publish directory to `.`, then deploy. Every push to `main` will now deploy automatically.
3. In Netlify, go to **Domain management → Add a domain** and enter `games.bluebid.online`.
4. DNS: if bluebid.online uses GoDaddy's nameservers, add a **CNAME** record in GoDaddy with host `games` pointing to `<your-site>.netlify.app`. If it uses Netlify DNS, Netlify adds the record for you.
5. Wait for Netlify to issue the HTTPS certificate, then open https://games.bluebid.online in a private window to confirm it loads signed out.
