'use strict';

// One-handed contract: a new gesture primitive — pull-back-and-release. Press
// anywhere to plant an anchor right where your thumb lands (floats to the
// touch point, same trick as Orbit's wheel), drag away from it to pull back
// a band, release to launch. Unlike Orbit (angle only) or Charge (a scalar
// meter), this single drag encodes TWO continuous values at once: direction
// AND pull distance (aim + power). You aim by pulling away from the target,
// never by touching it, so every bit of input stays low on the screen no
// matter where the target sits — the target can be anywhere; your thumb
// never has to go there.

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

const BALL_RADIUS = 14;
const MAX_PULL = 140;          // px, pull distance for full power
const MIN_PULL = 16;           // px, below this a release is a no-op cancel
const LAUNCH_MIN_SPEED = 340;  // px/s
const LAUNCH_MAX_SPEED = 1400; // px/s — must cover the worst case: anchor at
                                // one bottom corner, target at the opposite
                                // top corner. Reachable envelope (the "parabola
                                // of safety") is Y_up <= v^2/2g - g*dx^2/2v^2;
                                // the old 850/1300 pair left real targets
                                // unreachable at max pull (see 2026-07-05 bug).
const GRAVITY = 1000;          // px/s^2

const TARGET_BASE_R = 46;
const TARGET_MIN_R = 24;
const TARGET_R_PER_SCORE = 1.2;

const BEST_KEY = 'onehand-sling-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

// playState: 'idle' (waiting for a press), 'aiming' (held, pulling back),
// 'flying' (ball in flight, ignore input until resolved)
let playState = 'idle';

let anchor = { x: 0, y: 0 }, dragPoint = { x: 0, y: 0 };
let ball = null;
let target, score, best, lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function nextTarget() {
    const r = Math.max(TARGET_MIN_R, TARGET_BASE_R - score * TARGET_R_PER_SCORE);
    const x = r + 16 + Math.random() * (W - (r + 16) * 2);
    const y = H * 0.1 + Math.random() * (H * 0.4);
    target = { x, y, r };
}

function resetRun() {
    score = 0;
    playState = 'idle';
    ball = null;
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

function beginAim(x, y) {
    anchor = { x, y };
    dragPoint = { x, y };
    playState = 'aiming';
}

function press(x, y) {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        beginAim(x, y);
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING && playState === 'idle') {
        beginAim(x, y);
    }
}

function move(x, y) {
    if (playState === 'aiming') dragPoint = { x, y };
}

function pullVector() {
    const dx = anchor.x - dragPoint.x;
    const dy = anchor.y - dragPoint.y;
    const dist = Math.hypot(dx, dy);
    return { dx, dy, dist };
}

function release() {
    if (playState !== 'aiming') return;
    const { dx, dy, dist } = pullVector();
    if (dist < MIN_PULL) {
        playState = 'idle';
        return;
    }
    const powerFrac = Math.min(1, (dist - MIN_PULL) / (MAX_PULL - MIN_PULL));
    const speed = LAUNCH_MIN_SPEED + powerFrac * (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED);
    const nx = dx / dist, ny = dy / dist;
    ball = { x: anchor.x, y: anchor.y, vx: nx * speed, vy: ny * speed };
    playState = 'flying';
}

function update(dt) {
    if (state !== STATE.PLAYING || playState !== 'flying' || !ball) return;

    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const dist = Math.hypot(ball.x - target.x, ball.y - target.y);
    if (dist < BALL_RADIUS + target.r) {
        score++;
        playState = 'idle';
        ball = null;
        nextTarget();
        return;
    }
    if (ball.x < -40 || ball.x > W + 40 || ball.y > H + 40) {
        gameOver();
    }
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

function drawTrajectoryPreview(startX, startY, vx, vy) {
    ctx.fillStyle = 'rgba(232, 61, 154, 0.45)';
    let x = startX, y = startY, svx = vx, svy = vy;
    const stepDt = 0.05;
    for (let i = 0; i < 40; i++) {
        svy += GRAVITY * stepDt;
        x += svx * stepDt;
        y += svy * stepDt;
        if (x < 0 || x > W || y > H) break;
        if (i % 2 === 0) {
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    // target
    ctx.strokeStyle = '#e83d9a';
    ctx.fillStyle = 'rgba(232, 61, 154, 0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (playState === 'aiming') {
        const { dx, dy, dist } = pullVector();
        const clamped = Math.min(dist, MAX_PULL);
        const nx = dist > 0 ? dx / dist : 0;
        const ny = dist > 0 ? dy / dist : 0;
        const ballX = anchor.x - nx * clamped;
        const ballY = anchor.y - ny * clamped;

        if (dist >= MIN_PULL) {
            const powerFrac = Math.min(1, (dist - MIN_PULL) / (MAX_PULL - MIN_PULL));
            const speed = LAUNCH_MIN_SPEED + powerFrac * (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED);
            drawTrajectoryPreview(anchor.x, anchor.y, nx * speed, ny * speed);
        }

        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(ballX, ballY);
        ctx.stroke();

        ctx.fillStyle = '#e83d9a';
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#eeeeee';
        ctx.beginPath();
        ctx.arc(ballX, ballY, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    } else if (playState === 'flying' && ball) {
        ctx.fillStyle = '#eeeeee';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
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
        ctx.fillText('PULL BACK & RELEASE', W / 2, H * 0.68);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('HIT THE TARGET', W / 2, H * 0.68 + 26);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.68 + 48);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.68);
        ctx.fillStyle = '#e83d9a';
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
