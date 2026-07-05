'use strict';

// One-handed contract: a new gesture primitive — a radial wheel that spawns
// wherever you press down (no need to hit a fixed on-screen target), then
// dragging your thumb around that spawn point in a small arc sets an angle
// in real time (the felt sensation of "spinning" a wheel under your thumb).
// Releasing freezes the angle. Still a single contact point, still just
// press + drag — nothing here needs a second finger. Flap proved tap, Dash
// proved swipe, Charge proved hold; this proves the floating radial drag.
//
// The wheel widget can spawn anywhere you press, but the playfield (ring +
// inbound debris) stays fixed in the upper-middle of the screen so your
// thumb and the wheel graphic never cover the action you're watching.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W, H, DPR;
let ORBIT_R, PLAYFIELD_CX, PLAYFIELD_CY, METEOR_SPAWN_R;

function resize() {
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    ORBIT_R = Math.min(W, H) * 0.18;
    METEOR_SPAWN_R = Math.min(ORBIT_R * 2.1, W / 2 - 16);
    PLAYFIELD_CX = W / 2;
    PLAYFIELD_CY = Math.max(METEOR_SPAWN_R + 16, H * 0.3);
}
window.addEventListener('resize', resize);
resize();

const DEADZONE = 14;         // px, ignore tiny jitter right at the press point
const HANDLE_MAX_R = 55;     // px, visual clamp for the wheel's handle
const WHEEL_R = 70;          // px, visual radius of the wheel graphic

const PLAYER_TOL = 0.24;     // rad, half-width of the player's safe arc
const METEOR_TOL = 0.16;     // rad, half-width of a meteor's danger arc

const MET_BASE_SPEED = 130;  // px/s, radius shrink rate
const MET_MAX_SPEED = 320;
const MET_SPEED_PER_SCORE = 6;

const SPAWN_BASE_MS = 1300;
const SPAWN_MIN_MS = 650;
const SPAWN_PER_SCORE = 18;
const SPAWN_JITTER_MS = 150;

const BEST_KEY = 'onehand-orbit-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

let playerTheta = -Math.PI / 2;
let wheelActive = false, wheelCenter = { x: 0, y: 0 };

let meteors, score, best, spawnTimerMs, spawnIntervalMs, metSpeed, lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function resetRun() {
    meteors = [];
    score = 0;
    spawnTimerMs = 0;
    spawnIntervalMs = SPAWN_BASE_MS;
    metSpeed = MET_BASE_SPEED;
    playerTheta = -Math.PI / 2;
}

function reset() {
    resetRun();
    state = STATE.START;
}

function spawnMeteor() {
    const angle = Math.random() * Math.PI * 2;
    meteors.push({ angle, r: METEOR_SPAWN_R, resolved: false });
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function press(x, y) {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        wheelActive = true;
        wheelCenter = { x, y };
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING) {
        wheelActive = true;
        wheelCenter = { x, y };
    }
}

function move(x, y) {
    if (!wheelActive) return;
    const dx = x - wheelCenter.x;
    const dy = y - wheelCenter.y;
    if (Math.hypot(dx, dy) > DEADZONE) {
        playerTheta = Math.atan2(dy, dx);
    }
}

function release() {
    wheelActive = false;
}

function update(dt) {
    if (state !== STATE.PLAYING) return;

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= spawnIntervalMs) {
        spawnTimerMs = 0;
        spawnIntervalMs = Math.max(SPAWN_MIN_MS, SPAWN_BASE_MS - score * SPAWN_PER_SCORE)
            + (Math.random() * SPAWN_JITTER_MS * 2 - SPAWN_JITTER_MS);
        spawnMeteor();
    }

    for (const m of meteors) {
        m.r -= metSpeed * dt;
        if (!m.resolved && m.r <= ORBIT_R) {
            m.resolved = true;
            if (Math.abs(angleDiff(m.angle, playerTheta)) < (PLAYER_TOL + METEOR_TOL)) {
                gameOver();
                return;
            }
            score++;
            metSpeed = Math.min(MET_MAX_SPEED, MET_BASE_SPEED + score * MET_SPEED_PER_SCORE);
        }
    }
    meteors = meteors.filter(m => !m.resolved);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    // orbit track
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(PLAYFIELD_CX, PLAYFIELD_CY, ORBIT_R, 0, Math.PI * 2);
    ctx.stroke();

    // meteors — drawn as arcs so their angular danger-width is visible
    ctx.strokeStyle = '#e8935d';
    ctx.lineWidth = 16;
    ctx.lineCap = 'butt';
    for (const m of meteors) {
        ctx.beginPath();
        ctx.arc(PLAYFIELD_CX, PLAYFIELD_CY, Math.max(4, m.r), m.angle - METEOR_TOL, m.angle + METEOR_TOL);
        ctx.stroke();
    }

    // player
    const px = PLAYFIELD_CX + ORBIT_R * Math.cos(playerTheta);
    const py = PLAYFIELD_CY + ORBIT_R * Math.sin(playerTheta);
    ctx.fillStyle = '#2fd0c5';
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();

    // floating wheel widget
    if (wheelActive && state === STATE.PLAYING) {
        ctx.strokeStyle = 'rgba(47, 208, 197, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wheelCenter.x, wheelCenter.y, WHEEL_R, 0, Math.PI * 2);
        ctx.stroke();

        const hx = wheelCenter.x + HANDLE_MAX_R * Math.cos(playerTheta);
        const hy = wheelCenter.y + HANDLE_MAX_R * Math.sin(playerTheta);
        ctx.strokeStyle = 'rgba(47, 208, 197, 0.7)';
        ctx.beginPath();
        ctx.moveTo(wheelCenter.x, wheelCenter.y);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        ctx.fillStyle = '#2fd0c5';
        ctx.beginPath();
        ctx.arc(hx, hy, 12, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.textAlign = 'center';

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, PLAYFIELD_CY - ORBIT_R - 40);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('HOLD & SPIN', W / 2, H * 0.68);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('DODGE THE DEBRIS', W / 2, H * 0.68 + 26);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.68 + 48);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.6);
        ctx.fillStyle = '#2fd0c5';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.6 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.6 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.6 + 122);
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
