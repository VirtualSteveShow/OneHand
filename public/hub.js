'use strict';

const VERSION = 'v3';

// Each game gets one entry here once it's built — `id` must match its folder name under
// public/games/. `tagline` should name the one gesture the game uses (tap/swipe/hold), since
// the whole point of this app is that every game is playable one-handed, thumb-only, with no
// pinch/rotate/multi-touch and no controls that need a second hand to reach.
const GAMES = [
    { id: 'flap', name: 'Flap', tagline: 'Tap to flap', path: 'games/flap/', color: '#e8a33d' },
    { id: 'dash', name: 'Dash', tagline: 'Swipe to dodge', path: 'games/dash/', color: '#3d9ae8' },
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

renderGameGrid();
