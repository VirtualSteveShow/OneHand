# OneHand — Project Notes for Claude

**Last updated:** 2026-07-05
**Status:** Fresh scaffold. Hub shell is live and deployed; zero games built yet. This file exists so a new game can be added with the same conventions every time, without re-deriving them from scratch — it was written by carrying forward everything learned building `Snake` (a sibling project at `C:\Projects\Snake`), which went through ~90 versioned iterations on this exact stack.

---

## What This Is

A collection of small browser games bundled into one PWA, all built around a single hard constraint: **every game must be playable one-handed, thumb-only** — the use case is literally holding a baby in one arm and gaming with the other. That constraint drives every design decision here, more than genre or theme does.

**GitHub:** https://github.com/VirtualSteveShow/OneHand (public — required for GitHub Pages)
**Hosting:** GitHub Pages, auto-deploys on `git push master` via `.github/workflows/pages.yml` — live at https://virtualsteveshow.github.io/OneHand/
**Local dev port:** 8084 (see port map below)

---

## One-Handed Design Rules — read this before building any game

This is the entire point of the app, so it's worth being explicit about what "one-handed" actually rules out and allows, based on what worked in `Snake`'s advanced-mode ability system (hold/tap gestures, swipe-only movement):

**Allowed input vocabulary** (all provable one-thumb, portrait, phone-in-one-hand):
- **Tap** — anywhere in a defined zone, or a specific button.
- **Swipe** (4-directional or free-angle) — a full-length gesture is still one thumb.
- **Hold** — press and don't release; distinguish from tap via a short delay (~130ms) before the "held" state kicks in, so a quick tap doesn't misfire it. See `HOLD_BOOST_DELAY` in Snake's `client.js` for the exact pattern.
- **Drag** — thumb moves while touching down, single contact point.

**Not allowed** — anything that assumes a second hand or a second finger:
- Pinch, rotate, or any multi-touch gesture.
- Two simultaneous distinct touch targets (e.g., a virtual d-pad AND a separate action button that must be pressed together).
- Precision targets smaller than a comfortable thumb-tip (roughly 44×44px minimum, bigger is better) — a baby-holding thumb is not surgically precise.
- Anything requiring the phone to be held with both hands (e.g., landscape mode designed around two-thumb controls) — **portrait only**, controls reachable in the bottom ~half of the screen where a one-handed grip's thumb naturally rests.
- Tilt/shake controls are borderline-acceptable in theory but risky — a hand holding a baby is also gently rocking/moving unpredictably, so accelerometer input could false-trigger. Avoid unless there's a good reason to revisit this.

**Gesture-slot pattern worth reusing:** `Snake` built a clean system where a single hold-gesture and a single tap-gesture are the *only* manually-triggered inputs, and everything else (abilities, buffs) auto-triggers or is passive. This scales well to a one-handed constraint — it forces every game to boil player agency down to "when do I tap" and "when do I hold," which is exactly the right question to be asking for this app. Consider this pattern (or a subset of it) as a default starting point for a new game's control scheme rather than inventing a new input model each time.

**When in doubt:** picture yourself holding a baby in the crook of one arm, phone in that same hand, thumb free to move over the lower half of the screen, other arm fully occupied. If a control needs more than that, it doesn't belong in this app.

---

## Port Map (Steven's local machine)

| Port | App |
|------|-----|
| 8080 | ComfyUI Phone App |
| 8081 | Meal Planner |
| 8082 | SpyFall |
| 8083 | Snake (Snakes repo) |
| **8084** | **OneHand ← this project** |

(Kept in sync with the same table in `C:\Projects\Snake\CLAUDE.md` — update both when a new project claims a port.)

---

## Stack

Deliberately the same stack as `Snake` and `SpyFall` — proven to work well for this kind of small mobile-first game, zero build step, easy to iterate on:

- **Server:** Python + aiohttp (static file server, local dev only — production is GitHub Pages)
- **Frontend:** Vanilla JS/HTML/CSS, no framework, no bundler. **One noted exception:** `games/gaze/` dynamically imports Google's MediaPipe Tasks Vision (`FaceLandmarker`) from jsdelivr's CDN at runtime for camera-based face/blink detection — unavoidable for real face-landmark detection, still zero build step (loaded via `import()` in a classic script, no bundler needed), but it's the only game with an external dependency. Added 2026-07-05.
- **Hosting:** GitHub Pages (static), auto-deploy via Actions on push to `master`
- **PWA:** `manifest.json` + `sw.js` (network-first fetch, offline fallback to cache)
- **Local SSL:** reuses the same Tailscale cert as Snake/SpyFall/Phone App, so phone testing over HTTPS works without any extra setup:
  - `C:\ComfyUI_Portable\ComfyUI_Phone_App\tailscale.crt`
  - `C:\ComfyUI_Portable\ComfyUI_Phone_App\tailscale.key`

---

## Local Development

```
Start_Server.bat   — kills existing process on port 8084, starts fresh
Restart_Server.bat — same, but backgrounded (doesn't hold the terminal)
python server.py   — run directly
```

URLs:
```
https://localhost:8084
https://desktop-rsghbik.tail60e4a8.ts.net:8084   — phone testing via Tailscale
```

---

## Git Safety Rule

**Always commit before starting any significant editing session.** This ensures there's always a clean rollback point. If Claude Code runs out of usage mid-edit and leaves a file broken, run:
```
git checkout -- .
```
to restore everything to the last commit.

After every completed feature: `git add . && git commit -m "..." && git push`

The GitHub Pages deploy has an intermittent failure mode unrelated to the code (the `deploy-pages` action occasionally fails transiently). If a push's deploy run fails, just retry: `gh workflow run pages.yml` then `gh run watch <run-id> --exit-status`. Confirm what's actually live with:
```
curl -s "https://virtualsteveshow.github.io/OneHand/hub.js?_=$(date +%s)" | grep -o "VERSION = '[^']*'"
```

---

## Versioning — bump on every frontend deploy

Same discipline as Snake, adapted for the hub shell (each individual game, once built, should adopt the same pattern independently for its own assets):

| What | Where |
|------|-------|
| `const VERSION` | `public/hub.js` line 3 |
| stylesheet link | `public/index.html` `<link rel="stylesheet" href="style.css?v=N">` |
| script tag | `public/index.html` `<script src="hub.js?v=N">` |
| SW cache key | `public/sw.js` `const CACHE` |

`VERSION` is also rendered on-screen (`#hub-version` in `index.html`, populated by `hub.js`) so the version is visible immediately on opening the app, without needing devtools or `curl` — added 2026-07-05 because it wasn't otherwise obvious whether a phone had picked up the latest deploy.

**Note:** all asset paths in `index.html`, `manifest.json`, `sw.js`, and game files must stay **relative** (no leading `/`) — GitHub Pages serves this repo from `/OneHand/`, not domain root.

---

## File Structure

```
OneHand/
├── server.py            — aiohttp static file server, port 8084 (local dev only)
├── requirements.txt      — aiohttp>=3.9.0
├── generate_icons.py     — regenerates public/icons/*.png (no PIL dependency, pure zlib/struct)
├── CLAUDE.md
├── TODO.md
├── Start_Server.bat
├── Restart_Server.bat
├── .gitignore
├── .github/workflows/pages.yml   — deploys public/ to GitHub Pages on push to master
└── public/
    ├── index.html        — hub shell: title + game grid, PWA install point
    ├── style.css         — hub styles
    ├── hub.js            — GAMES array + grid renderer (add new games here)
    ├── sw.js             — service worker (network-first, cache fallback)
    ├── manifest.json     — PWA manifest for the whole app (one install covers every game)
    ├── icons/            — PWA icons (192px + 512px), currently placeholder art
    └── games/            — each game gets its own subfolder here, e.g. games/<id>/index.html
```

---

## Adding a New Game — checklist

1. Create `public/games/<id>/` with its own `index.html`, `style.css`, `<id>.js` (or similar) — self-contained, doesn't share JS state with the hub or other games.
2. Design its control scheme against the One-Handed Design Rules above *before* writing gameplay code — decide what tap does and what hold does (if anything) first.
3. Give it its own `VERSION` const and bump-on-deploy discipline, same pattern as the hub.
4. Add one entry to the `GAMES` array in `public/hub.js` (`id`, `name`, `tagline`, `path`, `color`) — `tagline` should name the gesture ("Tap to jump", "Hold to charge, release to fire") so the hub itself doubles as a reminder of the one-handed contract.
5. If the game needs offline caching, list its asset files in `public/sw.js`'s `ASSETS` array (or give it a dedicated cache — evaluate once there are a few games and it's clear whether a shared cache still makes sense).
6. Playwright-verify on a real touch-simulated flow before shipping — `.click()` does not dispatch real touch events, so gesture-based interactions (swipe, hold) need `dispatchEvent` with actual `Touch`/`TouchEvent` objects or `page.touchscreen` APIs to test faithfully. See Snake's session notes for the exact gotchas (Windows console can't print `—`/emoji when debugging via `print()` — encode as ASCII first).
7. Bump all 4 version markers, commit, push, confirm the live deploy via `curl` before calling it done.

---

## Deploying

```
git add .
git commit -m "description"
git push
```

GitHub Pages auto-deploys in ~1–2 min via Actions. Always bump the version markers before committing any frontend change (hub or any individual game).
