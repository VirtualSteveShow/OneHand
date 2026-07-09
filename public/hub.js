'use strict';

const VERSION = 'v26';

// Each game gets one entry here once it's built — `id` must match its folder name under
// public/games/. `tagline` should name the one gesture the game uses (tap/swipe/hold), since
// the whole point of this app is that every game is playable one-handed, thumb-only, with no
// pinch/rotate/multi-touch and no controls that need a second hand to reach.
const GAMES = [
    { id: 'flap', name: 'Flap', tagline: 'Tap to flap', path: 'games/flap/', color: '#e8a33d' },
    { id: 'dash', name: 'Dash', tagline: 'Swipe to dodge', path: 'games/dash/', color: '#3d9ae8' },
    { id: 'charge', name: 'Charge', tagline: 'Hold to charge', path: 'games/charge/', color: '#b565e8' },
    { id: 'orbit', name: 'Orbit', tagline: 'Spin to dodge', path: 'games/orbit/', color: '#2fd0c5' },
    { id: 'sling', name: 'Sling', tagline: 'Pull to launch', path: 'games/sling/', color: '#e83d9a' },
    { id: 'tilt', name: 'Tilt', tagline: 'Tilt to steer', path: 'games/tilt/', color: '#5ddf7a' },
    { id: 'flick', name: 'Flick', tagline: 'Flick to launch', path: 'games/flick/', color: '#e8493d' },
    { id: 'gaze', name: 'Gaze', tagline: 'Blink to flap', path: 'games/gaze/', color: '#e8d83d' },
];

function renderGameGrid() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (GAMES.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'empty-state';
        empty.textContent = 'No games yet — check back soon!';
        grid.appendChild(empty);
        return;
    }
    for (const game of GAMES) {
        const card = document.createElement('a');
        card.className = 'game-card';
        card.href = game.path;
        card.style.setProperty('--accent', game.color || '#e8a33d');
        card.innerHTML = `
            <div class="game-card-name">${game.name}</div>
            <div class="game-card-tagline">${game.tagline}</div>
        `;
        grid.appendChild(card);
    }
}

function renderVersion() {
    const el = document.getElementById('hub-version');
    if (el) el.textContent = VERSION;
}

renderGameGrid();
renderVersion();
