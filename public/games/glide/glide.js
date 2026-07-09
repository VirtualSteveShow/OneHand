'use strict';

// One-handed contract: a new primitive this hub hadn't tested yet — direct,
// absolute finger-position control. Every other drag-based game here uses a
// *relative* mechanic (Orbit's floating joystick measures angle from a
// press-anchor, Sling pulls back a vector and releases) — none map an
// on-screen object straight to the raw touch point. Glide does exactly
// that: the dot's position IS your thumb's position, full stop, no offset
// math.
//
// That raises a one-handed problem: if the dot can go anywhere on screen,
// dodging a threat near the top would need the thumb to physically reach
// the top of the screen, which breaks the "bottom-half, one-handed grip"
// rule this whole app is built around. The fix is to confine the entire
// arena — not just the controls, the actual play field — to a rounded-rect
// region in the lower half of the screen. Wherever your thumb naturally
// rests is, by construction, the only place the dot can ever be.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W, H, DPR;
function resize() {
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function arenaRect() {
    return { x: W * 0.08, y: H * 0.38, w: W * 0.84, h: H * 0.52 };
}

const PLAYER_RADIUS = 16;
const OBSTACLE_RADIUS = 13;
const DESPAWN_MARGIN = 60;

const SPEED_BASE = 140;
const SPEED_MAX = 340;
const SPEED_PER_SCORE = 10;

const SPAWN_BASE_MS = 900;
const SPAWN_MIN_MS = 380;
const SPAWN_PER_SCORE = 22;
const SPAWN_JITTER_MS = 100;

const BEST_KEY = 'onehand-glide-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;
let dragging = false;

let player, obstacles, score, best, elapsedMs, spawnTimerMs, spawnIntervalMs, obstSpeed;
let lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function clampToArena(x, y) {
    const r = arenaRect();
    return {
        x: Math.max(r.x + PLAYER_RADIUS, Math.min(r.x + r.w - PLAYER_RADIUS, x)),
        y: Math.max(r.y + PLAYER_RADIUS, Math.min(r.y + r.h - PLAYER_RADIUS, y)),
    };
}

function resetRun() {
    const r = arenaRect();
    player = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    obstacles = [];
    score = 0;
    elapsedMs = 0;
    spawnTimerMs = 0;
    spawnIntervalMs = SPAWN_BASE_MS;
    obstSpeed = SPEED_BASE;
    dragging = false;
}

function reset() {
    resetRun();
    state = STATE.START;
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function spawnObstacle() {
    const r = arenaRect();
    const edge = Math.floor(Math.random() * 4);
    let sx, sy;
    if (edge === 0) { sx = r.x; sy = r.y + Math.random() * r.h; }
    else if (edge === 1) { sx = r.x + r.w; sy = r.y + Math.random() * r.h; }
    else if (edge === 2) { sx = r.x + Math.random() * r.w; sy = r.y; }
    else { sx = r.x + Math.random() * r.w; sy = r.y + r.h; }

    const tx = r.x + Math.random() * r.w;
    const ty = r.y + Math.random() * r.h;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.hypot(dx, dy) || 1;
    obstacles.push({ x: sx, y: sy, vx: dx / dist, vy: dy / dist });
}

function press(x, y) {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        dragging = true;
        player = clampToArena(x, y);
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING) {
        dragging = true;
        player = clampToArena(x, y);
    }
}

function move(x, y) {
    if (!dragging) return;
    player = clampToArena(x, y);
}

function release() {
    dragging = false;
}

function update(dt) {
    if (state !== STATE.PLAYING) return;

    elapsedMs += dt * 1000;
    score = Math.floor(elapsedMs / 1000);
    obstSpeed = Math.min(SPEED_MAX, SPEED_BASE + score * SPEED_PER_SCORE);

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnIntervalMs = Math.max(SPAWN_MIN_MS, SPAWN_BASE_MS - score * SPAWN_PER_SCORE)
            + (Math.random() * SPAWN_JITTER_MS * 2 - SPAWN_JITTER_MS);
        spawnObstacle();
    }

    const r = arenaRect();
    for (const o of obstacles) {
        o.x += o.vx * obstSpeed * dt;
        o.y += o.vy * obstSpeed * dt;

        if (Math.hypot(o.x - player.x, o.y - player.y) < PLAYER_RADIUS + OBSTACLE_RADIUS) {
            gameOver();
            return;
        }
    }
    obstacles = obstacles.filter(o =>
        o.x > r.x - DESPAWN_MARGIN && o.x < r.x + r.w + DESPAWN_MARGIN &&
        o.y > r.y - DESPAWN_MARGIN && o.y < r.y + r.h + DESPAWN_MARGIN
    );
}

function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    const r = arenaRect();
    ctx.strokeStyle = '#242424';
    ctx.lineWidth = 2;
    roundRect(r.x, r.y, r.w, r.h, 18);
    ctx.stroke();

    if (state !== STATE.START) {
        ctx.fillStyle = '#5d5de8';
        for (const o of obstacles) {
            ctx.beginPath();
            ctx.arc(o.x, o.y, OBSTACLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = dragging ? '#5ddf7a' : '#e8d83d';
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.textAlign = 'center';

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('DRAG TO MOVE', W / 2, H * 0.22);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('DODGE THE DOTS', W / 2, H * 0.22 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.22 + 50);
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.22);
        ctx.fillStyle = '#5d5de8';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.22 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.22 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.22 + 122);
    }
}

function loop(time) {
    if (!lastTime) lastTime = time;
    const dt = Math.min((time - lastTime) / 1000, 0.033);
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

best = loadBest();
reset();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    move(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    release();
});
canvas.addEventListener('pointercancel', () => { release(); });
