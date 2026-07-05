'use strict';

// One-handed contract: the ENTIRE screen is the tap target. Tap = flap (and
// tap = start / tap = retry on the menu screens). No hold, no swipe, no
// precision targets — this game exists to prove the simplest possible
// one-input control scheme end to end.

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

const GRAVITY = 1600;          // px/s^2
const FLAP_VELOCITY = -460;    // px/s (negative = up)
const PIPE_SPEED = 190;        // px/s
const PIPE_GAP = 230;          // px
const PIPE_WIDTH = 74;         // px
const PIPE_INTERVAL = 1500;    // ms between spawns
const BIRD_RADIUS = 18;        // px
const BIRD_X_RATIO = 0.32;     // fraction of screen width

const BEST_KEY = 'onehand-flap-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

let bird, pipes, score, best, spawnTimerMs, lastTime;

function loadBest() {
    return parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
}
function saveBest(v) {
    localStorage.setItem(BEST_KEY, String(v));
}

function reset() {
    bird = { y: H / 2, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    spawnTimerMs = 0;
    state = STATE.START;
}

function flap() {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        bird.vy = FLAP_VELOCITY;
    } else if (state === STATE.PLAYING) {
        bird.vy = FLAP_VELOCITY;
    } else if (state === STATE.OVER) {
        reset();
    }
}

function spawnPipe() {
    const margin = 60;
    const minTop = margin;
    const maxTop = H - margin - PIPE_GAP;
    const top = minTop + Math.random() * Math.max(0, maxTop - minTop);
    pipes.push({ x: W + PIPE_WIDTH, top, scored: false });
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function update(dt) {
    if (state !== STATE.PLAYING) return;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 500));

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= PIPE_INTERVAL) {
        spawnTimerMs = 0;
        spawnPipe();
    }

    const birdX = W * BIRD_X_RATIO;
    for (const p of pipes) {
        p.x -= PIPE_SPEED * dt;
        if (!p.scored && p.x + PIPE_WIDTH < birdX) {
            p.scored = true;
            score++;
        }
    }
    pipes = pipes.filter(p => p.x > -PIPE_WIDTH);

    // Ceiling is a soft boundary (matches classic Flappy Bird) so a burst of
    // enthusiastic taps near the top never causes a confusing "invisible"
    // death — only the ground and pipes are lethal.
    if (bird.y - BIRD_RADIUS < 0) {
        bird.y = BIRD_RADIUS;
        if (bird.vy < 0) bird.vy = 0;
    }
    if (bird.y + BIRD_RADIUS > H) {
        gameOver();
        return;
    }
    for (const p of pipes) {
        if (birdX + BIRD_RADIUS > p.x && birdX - BIRD_RADIUS < p.x + PIPE_WIDTH) {
            if (bird.y - BIRD_RADIUS < p.top || bird.y + BIRD_RADIUS > p.top + PIPE_GAP) {
                gameOver();
                return;
            }
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#2f7a4d';
    for (const p of pipes) {
        ctx.fillRect(p.x, 0, PIPE_WIDTH, p.top);
        ctx.fillRect(p.x, p.top + PIPE_GAP, PIPE_WIDTH, H - (p.top + PIPE_GAP));
    }

    const birdX = W * BIRD_X_RATIO;
    ctx.save();
    ctx.translate(birdX, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = '#e8a33d';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(BIRD_RADIUS * 0.4, -BIRD_RADIUS * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('TAP TO START', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP = FLAP', W / 2, H * 0.4 + 30);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.4 + 52);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.35);
        ctx.fillStyle = '#e8a33d';
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
    flap();
});
