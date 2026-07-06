'use strict';

// One-handed contract: a new gesture primitive — flick/momentum. Swipe
// anywhere on screen (same "whole screen is the gesture zone" trick Dash
// used) but this time the RELEASE VELOCITY itself — not just the direction,
// like Dash, or the pull distance, like Sling — launches a puck. The puck
// then slides with friction and bounces off the walls until it stops. Land
// it in the target zone to score. The gesture doesn't need to touch the
// puck itself (same as Dash's swipe not needing to touch the player); only
// the last ~90ms of motion before release is what determines the launch.

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

function teePos() { return { x: W / 2, y: H * 0.85 }; }

const PUCK_RADIUS = 15;
const VELOCITY_WINDOW_MS = 90;  // how far back to sample for release velocity
const MIN_FLICK_SPEED = 250;    // px/s, below this a release is a no-op cancel
const MAX_LAUNCH_SPEED = 1600;  // px/s
const FRICTION_ACCEL = 900;     // px/s^2
const BOUNCE_RESTITUTION = 0.55;
const STOP_SPEED = 20;          // px/s, below this the puck is "at rest"

const TARGET_BASE_R = 50;
const TARGET_MIN_R = 26;
const TARGET_R_PER_SCORE = 1.3;

const BEST_KEY = 'onehand-flick-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

// playState: 'idle' (puck resting at the tee), 'dragging' (recording a
// flick gesture), 'moving' (puck in flight, ignore input until it stops)
let playState = 'idle';

let puck, target, score, best, dragHistory, lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function nextTarget() {
    const r = Math.max(TARGET_MIN_R, TARGET_BASE_R - score * TARGET_R_PER_SCORE);
    const tee = teePos();
    let x, y;
    for (let i = 0; i < 8; i++) {
        x = r + 16 + Math.random() * (W - (r + 16) * 2);
        y = r + 16 + Math.random() * (H - (r + 16) * 2);
        if (Math.hypot(x - tee.x, y - tee.y) > r + PUCK_RADIUS + 40) break;
    }
    target = { x, y, r };
}

function resetRun() {
    score = 0;
    playState = 'idle';
    const tee = teePos();
    puck = { x: tee.x, y: tee.y, vx: 0, vy: 0 };
    dragHistory = [];
    nextTarget();
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

function beginDrag(x, y, t) {
    playState = 'dragging';
    dragHistory = [{ x, y, t }];
}

function press(x, y) {
    const t = performance.now();
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        beginDrag(x, y, t);
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING && playState === 'idle') {
        beginDrag(x, y, t);
    }
}

function move(x, y) {
    if (playState !== 'dragging') return;
    const t = performance.now();
    dragHistory.push({ x, y, t });
    while (dragHistory.length > 1 && t - dragHistory[0].t > VELOCITY_WINDOW_MS) {
        dragHistory.shift();
    }
}

function release() {
    if (playState !== 'dragging') return;
    const t = performance.now();
    const hist = dragHistory;
    playState = 'idle';
    if (hist.length < 2) return;

    const first = hist[0];
    const last = hist[hist.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return;

    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < MIN_FLICK_SPEED) return; // too slow — treat as a cancel, not a wasted shot

    const clamped = Math.min(speed, MAX_LAUNCH_SPEED);
    vx = (vx / speed) * clamped;
    vy = (vy / speed) * clamped;

    puck.vx = vx;
    puck.vy = vy;
    playState = 'moving';
}

function update(dt) {
    if (state !== STATE.PLAYING || playState !== 'moving') return;

    puck.x += puck.vx * dt;
    puck.y += puck.vy * dt;

    if (puck.x - PUCK_RADIUS < 0) { puck.x = PUCK_RADIUS; puck.vx = -puck.vx * BOUNCE_RESTITUTION; }
    if (puck.x + PUCK_RADIUS > W) { puck.x = W - PUCK_RADIUS; puck.vx = -puck.vx * BOUNCE_RESTITUTION; }
    if (puck.y - PUCK_RADIUS < 0) { puck.y = PUCK_RADIUS; puck.vy = -puck.vy * BOUNCE_RESTITUTION; }
    if (puck.y + PUCK_RADIUS > H) { puck.y = H - PUCK_RADIUS; puck.vy = -puck.vy * BOUNCE_RESTITUTION; }

    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > 0) {
        const dec = Math.min(speed, FRICTION_ACCEL * dt);
        const newSpeed = speed - dec;
        puck.vx *= newSpeed / speed;
        puck.vy *= newSpeed / speed;
    }

    if (Math.hypot(puck.vx, puck.vy) < STOP_SPEED) {
        puck.vx = 0;
        puck.vy = 0;
        const dist = Math.hypot(puck.x - target.x, puck.y - target.y);
        if (dist < PUCK_RADIUS + target.r) {
            score++;
            const tee = teePos();
            puck.x = tee.x;
            puck.y = tee.y;
            nextTarget();
        } else {
            gameOver();
        }
        playState = 'idle';
    }
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#e8493d';
    ctx.fillStyle = 'rgba(232, 73, 61, 0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (playState === 'dragging' && dragHistory.length > 1) {
        ctx.strokeStyle = 'rgba(232, 73, 61, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(dragHistory[0].x, dragHistory[0].y);
        for (let i = 1; i < dragHistory.length; i++) {
            ctx.lineTo(dragHistory[i].x, dragHistory[i].y);
        }
        ctx.stroke();
    }

    ctx.fillStyle = '#eeeeee';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_RADIUS, 0, Math.PI * 2);
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
        ctx.fillText('FLICK TO LAUNCH', W / 2, H * 0.68);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('LAND IN THE ZONE', W / 2, H * 0.68 + 26);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.68 + 48);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.68);
        ctx.fillStyle = '#e8493d';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.68 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.68 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.68 + 122);
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
