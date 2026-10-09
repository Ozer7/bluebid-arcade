# Improvement log: Wave 2 (since the Wave 1 submission on Monday, October 5)

Site: https://games.bluebid.online · Original game: **Yank!**

Balance numbers are computer-versus-computer runs with `tests/sim.js` (60–120 games each), "side A / side B" wins.

## The whole cabinet
- **New eighth game, Yank!** (my original game), added to the same cabinet and domain.
- **You play the normal side by default.** Every game now opens with the human on the usual side (snake, bottom paddle, bird, pilot, defender, stacker, picnic) and the computer on the other. Swapping sides is still one click.
- **"Get ready" card before every game.** It shows which side you are, your controls, how you win, and a 3-second countdown (Space or a click starts at once). Before, games started the instant you pressed Start, and a new player could lose before touching a key.
- **Level select (testing aid).** The "Who's playing" screen has a "Start at" row to jump to a later level or wave: Snake level 1–6, Breakout wall 1–5, Splat level 1–6, Asteroids wave 1–5, Missile Command wave 1–7, Stack & Deal level 1–8, Yank! wave 1–6.
- **Every game rebalanced** so each side wins about as often as the other (details per game below).
- Menu shows 8 games and accepts keys 1–8.

## Snake
- Human steers the snake by default.
- Status bar labels: "APPLES 0/30" (how you win), and the bar is labelled "HUNGER" or "NEXT APPLE" so you can tell what it counts down.
- Human apple placer gets a "CLICK A CELL TO DROP AN APPLE" bar with the seconds left before a random apple is dropped. Before, a small "PLACE FOOD!" sat squeezed next to the player names with no timer.
- Fairer: the computer snake turns a step late less often at high speed. Snake 37% → 43%.

## Breakout
- "BALL 1" replaced by "BALLS LEFT 5" for each side, plus "FIRST TO 0 BALLS LOSES" on screen.
- Serve prompt now says how: "CLICK OR SPACE TO SERVE".
- Balance stays even (58% / 42%).

## Splat
- Human flies the bird by default.
- The bird now waits for your first flap, like Flappy Bird's "Get Ready" screen. Before, gravity started after one second.
- "OF 30 PIPES" under the score, so the goal is always visible.
- Human builder can see the allowed range for the next gap (brackets marked "ALLOWED") and a "LOCKS IN 1.2S" countdown.
- Fairer: gaps slightly taller and the next gap can't jump quite as far. Bird 22% → 48%.

## Asteroids
- Human flies the ship by default.
- The wave clock says "18S LEFT", not just "18".
- Thrower: the energy bar is labelled and has tick marks at each rock's cost, and the size list shows the cost and how many you can throw right now ("2 MEDIUM (2.5) ×3").
- Fairer: the thrower's energy refills a little more slowly. Pilot 32% → 45%.

## Missile Command
- Human defends by default.
- Each base shows how many missiles it has left.
- "9 LEFT" is now "MISSILES 9", and a human attacker gets a reload bar that says READY, RELOADING, TOO MANY IN AIR or NONE LEFT.
- The wave intro says "DESTROY CITIES" when you're the attacker (it used to say "DEFEND CITIES" to both sides).
- Fairer: the attacker gets slightly fewer missiles per wave. Defender 30% → 50%.

## Stack & Deal
- Human stacks by default.
- Human dealer gets a "BEFORE IT LANDS" bar showing how long until the game deals a random piece. Before, the only sign was "TOO SLOW — RANDOM PIECE" after the fact.
- The computer dealer learns to deal awkward pieces a little faster; stays even (53% / 47%).

## Imitation
- **Sound added** (it had none): coin sound on Find a match, touch-tone dialing while searching, a modem connect, keyboard clicks, a teletype burst when you send, a blip when they reply, a beep when it's your turn, ticks in your last 5 seconds and the round's last 10, a bell when time's up, and a win or lose jingle. "Sound on/off" button (or M) to mute.
- Header now says game 8.

## Yank! (new)
- Original game: flick a picnic tablecloth so its ripple throws bugs off the table, while the cloth slides out from under your dishes. Slow drags move dishes; fast flicks throw bugs; hard flicks launch beetles but can spill the lemonade.
- Guided first game (a ghost hand teaches the slow drag and the flick), flick-power meter with marked thresholds, power-ups, ladybugs you shouldn't flick, a queen ant, 2-minute games with 20-second waves.
- Both sides playable by a person or the computer; the computer players and the ants are built on research into how people point and flick and how ants forage.
