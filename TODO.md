# OneHand — To-Do List

| Status | Item | Notes |
|--------|------|-------|
| ✅ Done | v1 Project scaffold | Hub shell (`index.html`/`style.css`/`hub.js`), PWA manifest + service worker, aiohttp local dev server (port 8084), GitHub Pages Actions workflow, placeholder icons. Empty `GAMES` array — hub shows "No games yet" until the first game is added. |
| ⬜ To Do | Real icon art | `generate_icons.py` currently produces a placeholder (dark rounded square + accent dot). Replace with real branding once the app has an identity. |
| ✅ Done | First game — Flap | Built 2026-07-05. Flappy-Bird-style tap-to-flap dodger at `public/games/flap/`. Single input vocabulary (tap = flap/start/retry), canvas-based, ceiling is a soft boundary (only ground + pipes are lethal) so spam-tapping near the top never causes a confusing death. Best score in localStorage. Added to `GAMES` in hub.js, shares the hub's service worker cache. Verified with Playwright using real `Touch`/`TouchEvent` dispatch (not `.click()`) — tap-to-start, flap physics, pipe collision, game-over, retry, and back-to-hub all confirmed working. |
| ⬜ To Do | Decide shared vs. per-game service worker caching | `sw.js` currently only caches hub shell assets. Once 2-3 games exist, decide whether they share one cache (simpler) or get dedicated ones (better cache-busting isolation per game). Currently sharing one cache (Flap's assets added to the same `ASSETS` array). |
