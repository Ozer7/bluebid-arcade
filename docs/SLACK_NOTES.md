# Slack post draft (course channel)

Wave 1 cabinet is up at games.bluebid.online. Three challenges I ran into and how I got past them:

1. **Making the computer "actually play" in Splat.** My first flier crashed every time. Its look-ahead was one frame off from the real game, so it clipped the pipe corners. Once the simulation matched the game frame for frame, it became too good. So I gave it a reaction time and some aim error that shrink as the levels go up.

2. **Keeping it fair both ways.** The builder can't move a gap more than a set distance from the last one, and the dealer in my Tetris game can't give the same piece three times in a row or go 12 pieces without an I-piece. Those rules apply to humans and the computer alike, so neither side can make the game impossible.

3. **Balancing without playing 500 games myself.** I wrote a headless script that runs computer-vs-computer matches and reports win rates. Missile Command started at 100% for the defender. I tuned missile speed and aim error until it landed around 65/35, with games often coming down to the last city.

Imitation lives as a Claude artifact, per Yoni's answer above. Each search waits a random 7–18 seconds, so how fast you get matched doesn't tell you whether it's a person or Claude.
