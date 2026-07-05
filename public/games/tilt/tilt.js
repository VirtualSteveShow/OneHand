'use strict';

// One-handed contract: a new gesture primitive — hold + tilt. Press and hold
// anywhere (no drag, no fixed target — just presence of a touch) to arm the
// gyro; while held, tilting the phone left/right steers the ball. Release
// freezes it in place. This is the one primitive that reads a device sensor
// instead of touch geometry, which this project's own CLAUDE.md flags as
// risky in general (a hand holding a baby is also gently rocking
// unpredictably). Two mitigations specifically for that: (1) the tilt is
// only ever read while a finger is actively down — no passive/always-on
// sensing — and (2) every single press recalibrates a fresh zero-point from
// whatever angle the phone happens to be at that moment, so an unusual
// resting grip (or drift between plays) never becomes false input; only
// deliberate tilting relative to your own current grip moves the ball.

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

function baselineY() { return H * 0.82; }

const BALL_RADIUS = 16;
const GAMMA_SENSITIVITY = 22; // degrees of tilt (relative to zero) for full travel
const GAMMA_DEADZONE = 1.5;   // degrees, ignore tiny jitter near zero

const OBSTACLE_HEIGHT = 22;
const OBSTACLE_WIDTH_FRAC = 0.3;
const OBST_SPEED_BASE = 220;  // px/s
const OBST_SPEED_MAX = 420;
const OBST_SPEED_PER_SCORE = 8;

const SPAWN_BASE_MS = 1200;
const SPAWN_MIN_MS = 700;
const SPAWN_PER_SCORE = 15;
const SPAWN_JITTER_MS = 150;

const BEST_KEY = 'onehand-tilt-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;
let permissionDenied = false;

let ballX, obstacles, score, best, spawnTimerMs, spawnIntervalMs, obstSpeed, lastTime;

let currentGamma = 0;   // last raw gamma reading
let gyroActive = false; // only true while a finger is down
let zeroGamma = 0;      // calibrated at the moment of the most recent press

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function onOrientation(e) {
    if (typeof e.gamma === 'number') currentGamma = e.gamma;
}
window.addEventListener('deviceorientation', onOrientation);

async function ensureGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const result = await DeviceOrientationEvent.requestPermission();
            return result === 'granted';
        } catch (err) {
            return false;
        }
    }
    return true; // Android/desktop: no explicit permission needed
}

function resetRun() {
    ballX = W / 2;
    obstacles = [];
    score = 0;
    spawnTimerMs = 0;
    spawnIntervalMs = SPAWN_BASE_MS;
    obstSpeed = OBST_SPEED_BASE;
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

function armGyro() {
    gyroActive = true;
    zeroGamma = currentGamma;
}

function disarmGyro() {
    gyroActive = false;
}

async function press() {
    if (state === STATE.START) {
        const ok = await ensureGyroPermission();
        if (!ok) {
            permissionDenied = true;
            return;
        }
        permissionDenied = false;
        state = STATE.PLAYING;
        resetRun();
        armGyro();
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING) {
        armGyro();
    }
}

function release() {
    disarmGyro();
}

function spawnObstacle() {
    const width = W * OBSTACLE_WIDTH_FRAC;
    const x = Math.random() * (W - width);
    obstacles.push({ x, width, y: -OBSTACLE_HEIGHT, scored: false });
}

function update(dt) {
    if (state !== STATE.PLAYING) return;

    if (gyroActive) {
        let delta = currentGamma - zeroGamma;
        if (Math.abs(delta) < GAMMA_DEADZONE) delta = 0;
        delta = Math.max(-GAMMA_SENSITIVITY, Math.min(GAMMA_SENSITIVITY, delta));
        const frac = delta / GAMMA_SENSITIVITY;
        const margin = BALL_RADIUS + 16;
        ballX = W / 2 + frac * (W / 2 - margin);
    }

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnIntervalMs = Math.max(SPAWN_MIN_MS, SPAWN_BASE_MS - score * SPAWN_PER_SCORE)
            + (Math.random() * SPAWN_JITTER_MS * 2 - SPAWN_JITTER_MS);
        spawnObstacle();
    }

    const hitY = baselineY();
    for (const o of obstacles) {
        o.y += obstSpeed * dt;

        const spans = o.y <= hitY && hitY <= o.y + OBSTACLE_HEIGHT;
        const overlapX = (ballX + BALL_RADIUS > o.x) && (ballX - BALL_RADIUS < o.x + o.width);
        if (spans && overlapX) {
            gameOver();
            return;
        }
        if (!o.scored && o.y > hitY) {
            o.scored = true;
            score++;
            obstSpeed = Math.min(OBST_SPEED_MAX, OBST_SPEED_BASE + score * OBST_SPEED_PER_SCORE);
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

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    const hitY = baselineY();
    ctx.strokeStyle = '#242424';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#e8763d';
    for (const o of obstacles) {
        roundRect(o.x, o.y, o.width, OBSTACLE_HEIGHT, 6);
        ctx.fill();
    }

    ctx.fillStyle = '#5ddf7a';
    ctx.beginPath();
    ctx.arc(ballX, hitY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        if (permissionDenied) {
            ctx.fillText('MOTION ACCESS NEEDED', W / 2, H * 0.4);
            ctx.fillStyle = '#888888';
            ctx.font = '13px monospace';
            ctx.fillText('ALLOW MOTION ACCESS, THEN TAP', W / 2, H * 0.4 + 28);
        } else {
            ctx.fillText('HOLD & TILT', W / 2, H * 0.4);
            ctx.fillStyle = '#888888';
            ctx.font = '13px monospace';
            ctx.fillText('STEER LEFT / RIGHT', W / 2, H * 0.4 + 28);
            if (best > 0) {
                ctx.fillText('BEST ' + best, W / 2, H * 0.4 + 50);
            }
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.35);
        ctx.fillStyle = '#5ddf7a';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.35 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.35 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.35 + 122);
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
    press();
});
canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    release();
});
canvas.addEventListener('pointercancel', () => { release(); });
