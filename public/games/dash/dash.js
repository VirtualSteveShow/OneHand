'use strict';

// One-handed contract: swipe-only gameplay — left/right = change lane, up =
// jump, down = duck. Tap is only used for start/retry menu transitions (Flap
// is the tap-only sibling to this game's swipe-only one). Only one obstacle
// spawns at a time, always leaving two clear lanes, so a lane switch is
// always a valid escape even if a jump/duck swipe comes in too late.

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

const LANE_COUNT = 3;
const SWIPE_THRESHOLD = 40; // px

const LANE_LERP_RATE = 12;
const JUMP_DURATION_MS = 460;
const JUMP_HEIGHT = 70;
const DUCK_DURATION_MS = 460;

const BASE_SPEED = 260;   // px/s
const MAX_SPEED = 480;
const SPEED_PER_SCORE = 6;

const SPAWN_BASE_MS = 1100;
const SPAWN_MIN_MS = 650;
const SPAWN_PER_SCORE = 12;
const SPAWN_JITTER_MS = 150;

const OBSTACLE_TYPES = {
    low: { height: 50, color: '#8a5a2b', glyph: '^' },        // jump over
    high: { height: 50, color: '#4a6fa5', glyph: 'v' },       // duck under
    full: { height: 92, color: '#7a2f3d', glyph: '↔' },  // switch lanes
};
const TYPE_WEIGHTS = [['low', 0.4], ['high', 0.35], ['full', 0.25]];

const BEST_KEY = 'onehand-dash-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

let player, obstacles, score, best, spawnTimerMs, spawnIntervalMs, speed, lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function laneCenterX(lane) {
    const laneWidth = W / LANE_COUNT;
    return laneWidth * (lane + 0.5);
}

function baselineY() {
    return H * 0.78;
}

function resetRun() {
    player = { lane: 1, targetLane: 1, jumpStart: -Infinity, duckStart: -Infinity };
    obstacles = [];
    score = 0;
    spawnTimerMs = 0;
    spawnIntervalMs = SPAWN_BASE_MS;
    speed = BASE_SPEED;
}

function reset() {
    resetRun();
    state = STATE.START;
}

function pickType() {
    const r = Math.random();
    let acc = 0;
    for (const [type, weight] of TYPE_WEIGHTS) {
        acc += weight;
        if (r <= acc) return type;
    }
    return 'low';
}

function spawnObstacle() {
    const type = pickType();
    const lane = Math.floor(Math.random() * LANE_COUNT);
    obstacles.push({ type, lane, y: -OBSTACLE_TYPES[type].height, scored: false });
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function handleGesture(dir, time) {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        return;
    }
    if (state === STATE.OVER) {
        reset();
        return;
    }
    switch (dir) {
        case 'left':
            player.targetLane = Math.max(0, player.targetLane - 1);
            break;
        case 'right':
            player.targetLane = Math.min(LANE_COUNT - 1, player.targetLane + 1);
            break;
        case 'up':
            player.jumpStart = time;
            break;
        case 'down':
            player.duckStart = time;
            break;
    }
}

function update(dt, time) {
    if (state !== STATE.PLAYING) return;

    player.lane += (player.targetLane - player.lane) * Math.min(1, dt * LANE_LERP_RATE);

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnIntervalMs = Math.max(SPAWN_MIN_MS, SPAWN_BASE_MS - score * SPAWN_PER_SCORE)
            + (Math.random() * SPAWN_JITTER_MS * 2 - SPAWN_JITTER_MS);
        spawnObstacle();
    }

    const hitY = baselineY();
    const jumping = (time - player.jumpStart) < JUMP_DURATION_MS;
    const ducking = (time - player.duckStart) < DUCK_DURATION_MS;

    for (const o of obstacles) {
        o.y += speed * dt;

        const spans = o.y <= hitY && hitY <= o.y + OBSTACLE_TYPES[o.type].height;
        const sameLane = Math.abs(player.lane - o.lane) < 0.5;
        if (spans && sameLane) {
            const immune = (o.type === 'low' && jumping) || (o.type === 'high' && ducking);
            if (!immune) {
                gameOver();
                return;
            }
        }

        if (!o.scored && o.y > hitY) {
            o.scored = true;
            score++;
            speed = Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_PER_SCORE);
        }
    }
    obstacles = obstacles.filter(o => o.y < H + 40);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function draw(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    const laneWidth = W / LANE_COUNT;
    ctx.strokeStyle = '#242424';
    ctx.lineWidth = 1;
    for (let i = 1; i < LANE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(laneWidth * i, 0);
        ctx.lineTo(laneWidth * i, H);
        ctx.stroke();
    }

    for (const o of obstacles) {
        const def = OBSTACLE_TYPES[o.type];
        const w = laneWidth * 0.7;
        const x = laneCenterX(o.lane) - w / 2;
        roundRect(x, o.y, w, def.height, 8);
        ctx.fillStyle = def.color;
        ctx.fill();
        ctx.fillStyle = '#111111';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.glyph, laneCenterX(o.lane), o.y + def.height / 2);
    }

    const jumping = (time - player.jumpStart) < JUMP_DURATION_MS;
    const ducking = (time - player.duckStart) < DUCK_DURATION_MS;
    const jt = Math.min(1, Math.max(0, (time - player.jumpStart) / JUMP_DURATION_MS));
    const yOffset = jumping ? -JUMP_HEIGHT * 4 * jt * (1 - jt) : 0;
    const px = laneCenterX(player.lane);
    const py = baselineY() + yOffset;
    const pw = 46, ph = ducking ? 26 : 46;

    ctx.fillStyle = '#3d9ae8';
    roundRect(px - pw / 2, py - ph / 2, pw, ph, 12);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('SWIPE TO START', W / 2, H * 0.36);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('←→ LANE   ^ JUMP   v DUCK', W / 2, H * 0.36 + 30);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.36 + 52);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.3);
        ctx.fillStyle = '#3d9ae8';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.3 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.3 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.3 + 122);
    }
}

function loop(time) {
    if (!lastTime) lastTime = time;
    const dt = Math.min((time - lastTime) / 1000, 0.033);
    lastTime = time;
    update(dt, time);
    draw(time);
    requestAnimationFrame(loop);
}

best = loadBest();
reset();
requestAnimationFrame(loop);

let touchStart = null;
canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    touchStart = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;

    const adx = Math.abs(dx), ady = Math.abs(dy);
    let dir = 'tap';
    if (Math.max(adx, ady) >= SWIPE_THRESHOLD) {
        dir = adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    handleGesture(dir, performance.now());
});
canvas.addEventListener('pointercancel', () => { touchStart = null; });
