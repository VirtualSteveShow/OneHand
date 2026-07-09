'use strict';

// One-handed contract: a discrete accelerometer-spike trigger — shake the
// phone hard enough and it counts as one flap, exactly like Flap's tap or
// Gaze's blink (physics/pipes are Flap's, unmodified, input source
// swapped again). This is a DIFFERENT sensor primitive from Tilt's
// continuous hold-angle steering: Tilt reads a steady orientation, Shake
// watches linear acceleration for a one-shot spike above a threshold, with
// a cooldown so a single physical shake (which oscillates back and forth
// several times) doesn't fire more than one trigger.
//
// Built explicitly as a testbed entry at the user's request to cover a
// mobile input this hub hadn't tried, NOT as a recommended real-world
// one-handed control: this project's own CLAUDE.md flags shake/tilt as
// "borderline-acceptable in theory but risky" for the app's actual
// one-handed use case (a hand holding a baby is also gently rocking
// unpredictably, which could false-trigger a shake). Tilt mitigated that
// with a single steady axis and a deadzone; a discrete shake spike has no
// equivalent mitigation available, since the whole point is reacting to a
// sudden motion. Play this one without a baby in the other arm.

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

const GRAVITY = 1600;
const FLAP_VELOCITY = -460;
const PIPE_SPEED_BASE = 190;
const PIPE_SPEED_MAX = 340;
const PIPE_SPEED_PER_SCORE = 6;
const PIPE_GAP_BASE = 230;
const PIPE_GAP_MIN = 165;
const PIPE_GAP_PER_SCORE = 3;
const PIPE_WIDTH = 74;
const PIPE_INTERVAL_BASE = 1500;
const PIPE_INTERVAL_MIN = 1000;
const PIPE_INTERVAL_PER_SCORE = 15;
const BIRD_RADIUS = 18;
const BIRD_X_RATIO = 0.32;

const SHAKE_THRESHOLD = 18;    // m/s^2 of linear acceleration (gravity excluded) to count as a shake
const SHAKE_COOLDOWN_MS = 350; // refractory period so one physical shake fires exactly one trigger

const BEST_KEY = 'onehand-shake-best';

const STATE = { PERMISSION: 'permission', ERROR: 'error', START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.PERMISSION;

let bird, pipes, score, best, spawnTimerMs, pipeSpeed, lastTime;
let currentMag = 0;
let lastShakeTime = -Infinity;
let flashUntil = 0;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function currentGap() { return Math.max(PIPE_GAP_MIN, PIPE_GAP_BASE - score * PIPE_GAP_PER_SCORE); }
function currentInterval() { return Math.max(PIPE_INTERVAL_MIN, PIPE_INTERVAL_BASE - score * PIPE_INTERVAL_PER_SCORE); }

async function ensureMotionPermission() {
    if (typeof DeviceMotionEvent !== 'undefined'
        && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const result = await DeviceMotionEvent.requestPermission();
            return result === 'granted';
        } catch (err) {
            return false;
        }
    }
    return true; // Android/desktop: no explicit permission needed
}

function onMotion(e) {
    // Prefer gravity-excluded linear acceleration; fall back to the
    // gravity-included reading on devices/browsers that don't provide the
    // former (its resting-state offset just becomes part of the ambient
    // noise floor the threshold already has to sit above).
    const a = (e.acceleration && e.acceleration.x != null) ? e.acceleration : e.accelerationIncludingGravity;
    if (!a) return;
    const ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
    currentMag = Math.sqrt(ax * ax + ay * ay + az * az);

    const now = performance.now();
    if (currentMag > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_COOLDOWN_MS) {
        lastShakeTime = now;
        flashUntil = now + 150;
        shakeTrigger();
    }
}
window.addEventListener('devicemotion', onMotion);

function resetRun() {
    bird = { y: H / 2, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    spawnTimerMs = 0;
    pipeSpeed = PIPE_SPEED_BASE;
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function shakeTrigger() {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        bird.vy = FLAP_VELOCITY;
    } else if (state === STATE.PLAYING) {
        bird.vy = FLAP_VELOCITY;
    }
}

function spawnPipe() {
    const gap = currentGap();
    const margin = 60;
    const minTop = margin;
    const maxTop = H - margin - gap;
    const top = minTop + Math.random() * Math.max(0, maxTop - minTop);
    pipes.push({ x: W + PIPE_WIDTH, top, gap, scored: false });
}

async function enablePermission() {
    const ok = await ensureMotionPermission();
    state = ok ? STATE.START : STATE.ERROR;
}

function press() {
    if (state === STATE.PERMISSION || state === STATE.ERROR) {
        enablePermission();
    } else if (state === STATE.OVER) {
        resetRun();
        state = STATE.START;
    }
    // START/PLAYING: no tap action — shakeTrigger() alone drives both
    // starting a run and flapping mid-run, matching Blink's convention.
}

function update(dt) {
    if (state !== STATE.PLAYING) return;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 500));

    spawnTimerMs += dt * 1000;
    if (spawnTimerMs >= currentInterval()) {
        spawnTimerMs = 0;
        spawnPipe();
    }

    const birdX = W * BIRD_X_RATIO;
    for (const p of pipes) {
        p.x -= pipeSpeed * dt;
        if (!p.scored && p.x + PIPE_WIDTH < birdX) {
            p.scored = true;
            score++;
            pipeSpeed = Math.min(PIPE_SPEED_MAX, PIPE_SPEED_BASE + score * PIPE_SPEED_PER_SCORE);
        }
    }
    pipes = pipes.filter(p => p.x > -PIPE_WIDTH);

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
            if (bird.y - BIRD_RADIUS < p.top || bird.y + BIRD_RADIUS > p.top + p.gap) {
                gameOver();
                return;
            }
        }
    }
}

function drawShakeMeter() {
    const w = 16, h = 90;
    const x = W - w - 18, y = H - h - 18;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    const maxShown = SHAKE_THRESHOLD * 1.6;
    const floorY = y + h - Math.min(1, SHAKE_THRESHOLD / maxShown) * h;
    ctx.strokeStyle = '#666666';
    ctx.beginPath();
    ctx.moveTo(x - 4, floorY);
    ctx.lineTo(x + w + 4, floorY);
    ctx.stroke();

    const frac = Math.min(1, currentMag / maxShown);
    const fillH = frac * h;
    ctx.fillStyle = currentMag > SHAKE_THRESHOLD ? '#3de89a' : '#555555';
    ctx.fillRect(x, y + h - fillH, w, fillH);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    if (state === STATE.PERMISSION) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('MOTION ACCESS NEEDED', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO ENABLE, THEN SHAKE', W / 2, H * 0.4 + 28);
        return;
    }

    if (state === STATE.ERROR) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('MOTION ACCESS DENIED', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO TRY AGAIN', W / 2, H * 0.4 + 28);
        return;
    }

    ctx.fillStyle = '#2f7a4d';
    for (const p of pipes) {
        ctx.fillRect(p.x, 0, PIPE_WIDTH, p.top);
        ctx.fillRect(p.x, p.top + p.gap, PIPE_WIDTH, H - (p.top + p.gap));
    }

    const birdX = W * BIRD_X_RATIO;
    ctx.save();
    ctx.translate(birdX, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = performance.now() < flashUntil ? '#ffffff' : '#3de89a';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(BIRD_RADIUS * 0.4, -BIRD_RADIUS * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawShakeMeter();

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('SHAKE TO FLAP', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('SHAKE THE PHONE TO START', W / 2, H * 0.4 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.4 + 50);
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.35);
        ctx.fillStyle = '#3de89a';
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
resetRun();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    press();
});
