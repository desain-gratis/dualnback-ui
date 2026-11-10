# Dual N-Back

A working-memory training game. Each round a square lights up on a 3x3 grid and a letter is spoken. Press **Position** if the square matches the one from N rounds ago, and **Sound** if the letter matches.

Plain HTML/CSS/JS (ES modules in `src/`), no runtime or build dependencies. Needs Node 18+ only for the build script, dev server and tests.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Serves `src/` at http://localhost:5173 (no build needed) |
| `npm run build` | Builds the static site into `dist/` |
| `npm run preview` | Serves `dist/` at http://localhost:4173 |
| `npm test` | Runs engine unit tests |

Without npm: `node build.mjs`, `node serve.mjs`, `node --test`.

Build options: `node build.mjs --out public` (different folder), `node build.mjs --no-minify` (readable bundle).

## Deploying

`dist/` contains `index.html`, `style.css`, `app.js` and the `audio/` folder. All paths are relative, so you can upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3, nginx) or a sub-folder of one. The bundle is a classic script, so it also opens straight from disk via `file://`.

## How it plays

- First N rounds of a session are warm-up; matches only start after that.
- Each modality has exactly 30% of scored trials as matches (independent, so some rounds match on both).
- Accuracy = hits / (hits + misses + false alarms).
- With "adjust automatically" on: both modalities at 80%+ raises N, either below 50% lowers it.
- Keys: `A` position, `L` sound, `Esc` quits, `Enter` replays from the results screen.
- Settings and the last 20 sessions are saved in localStorage.
- Letter audio uses the device voice by default (lowercase letters, so macOS does not say "capital"). If the voice stays silent, as can happen on iOS, it switches to the pre-recorded clips in `src/audio/` (played via `<audio>`), then to showing the letter on screen. The Voice settings page (link on the menu, with a Test voice button) can force the recorded clips.
- To regenerate or change the voice: `./tools/gen-audio.sh` (needs ffmpeg built with libflite; `VOICE=kal ./tools/gen-audio.sh`).

## Layout

```
src/
  index.html
  style.css
  js/engine.js    sequence generation + scoring (pure, tested)
  js/audio.js     letter audio (clips, speech fallback)
  audio/          letter clips (c.mp3 ... t.mp3)
  js/storage.js   localStorage
  js/main.js      UI and game loop
build.mjs         bundles src/ -> dist/
tools/            gen-audio.sh (regenerates the clips)
serve.mjs         static dev/preview server
test/             node:test unit tests
```

If you add a new JS module, list it in `MODULE_ORDER` in `build.mjs` (dependencies first).
