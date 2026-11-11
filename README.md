# High Roller Defense

A neon casino tower defense for the browser. Each round you deal 5 cards onto the board, reroll the ones you don't want, and the poker hand you play becomes your tower. One level, 10 waves, and a boss: the Pit Boss.

Everything is generated in code: models, textures, card faces, effects, sound effects and the synthwave soundtrack. There are no asset files.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts: `npm test` (hand evaluator and dealing tests), `npm run build` (production build into `dist/`).

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`. Turn Pages on once in the repo settings (Settings > Pages > Source: GitHub Actions).

### Controls

- Click open tiles to deal cards, click cards to mark or select them.
- WASD or arrow keys pan, Q and E rotate, mouse wheel zooms.
- Click a tower to inspect or sell it. Space starts the next wave.
- Add `?seed=123` to the URL for a repeatable deck.

## How it works

| Folder | What lives there |
| --- | --- |
| `src/game/cards.ts` | Deck, dealing with tips (best of N hidden hands), rerolls, hand evaluation |
| `src/game/data.ts` | Every balance number: towers, enemies, waves, economy, map |
| `src/game/game.ts` | Round state machine, combat, status effects, boss phases |
| `src/render/` | Scene, cel shading (toon ramp plus ink outlines), procedural models and canvas textures |
| `src/audio.ts` | Web Audio synth: SFX and a layered synthwave sequencer |
| `src/ui.ts` | HTML overlay: HUD, card hand, tower panel, guide |
