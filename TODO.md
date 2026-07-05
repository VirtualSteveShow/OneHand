# OneHand — To-Do List

| Status | Item | Notes |
|--------|------|-------|
| ✅ Done | v1 Project scaffold | Hub shell (`index.html`/`style.css`/`hub.js`), PWA manifest + service worker, aiohttp local dev server (port 8084), GitHub Pages Actions workflow, placeholder icons. Empty `GAMES` array — hub shows "No games yet" until the first game is added. |
| ⬜ To Do | Real icon art | `generate_icons.py` currently produces a placeholder (dark rounded square + accent dot). Replace with real branding once the app has an identity. |
| ⬜ To Do | First game | Pick a simple, proven-fun one-handed concept to prove out the `public/games/<id>/` pattern end-to-end (folder structure, hub entry, versioning, offline caching) before building anything more ambitious. |
| ⬜ To Do | Decide shared vs. per-game service worker caching | `sw.js` currently only caches hub shell assets. Once 2-3 games exist, decide whether they share one cache (simpler) or get dedicated ones (better cache-busting isolation per game). |
