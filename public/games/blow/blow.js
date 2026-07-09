'use strict';

// One-handed contract: an entirely untested sensor category for this hub —
// the microphone. Blow/hum/shout raises the bird, silence lets gravity pull
// it back down, same shape as Flap's pipes but the vertical control is a
// continuous thrust instead of a discrete tap impulse (closer to the old
// "helicopter game" than Flappy Bird). This is arguably the *most*
// one-handed-friendly input tested here yet — the core gameplay action
// needs no hand at all, just breath or voice, leaving both hands entirely
// free once a run has started (only the initial tap-to-start needs a
// finger, matching every other game's precedent).
//
// Audio is analyzed entirely on-device via the Web Audio API; nothing is
// ever recorded, stored, or sent anywhere, same privacy stance as Gaze's
// camera use.

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

// Lighter than Flap's 1600/460 impulse pair — continuous thrust needs a
// gentler gravity to stay controllable frame-to-frame, since the player is
// riding a noisy analog signal rather than firing sharp discrete impulses.
const GRAVITY = 900;
const THRUST_MAX = 1600;   // upward accel at full volume, comfortably beats gravity
const NOISE_FLOOR = 0.10;  // ambient room noise below this never counts as blowing
const MAX_RISE_SPEED = 480;
const MAX_FALL_SPEED = 620;

const BIRD_RADIUS = 18;
const BIRD_X_RATIO = 0.32;

const PIPE_WIDTH = 74;
// Wider gap than Flap's 230/165 — reacting to a noisy volume signal is less
// precise than a sharp tap, so this gives more margin for error.
const PIPE_GAP_BASE = 260;
const PIPE_GAP_MIN = 190;
const PIPE_GAP_PER_SCORE = 3;

const PIPE_SPEED_BASE = 190;
const PIPE_SPEED_MAX = 340;
const PIPE_SPEED_PER_SCORE = 6;

const PIPE_INTERVAL_BASE = 1500;
const PIPE_INTERVAL_MIN = 1000;
const PIPE_INTERVAL_PER_SCORE = 15;

const BEST_KEY = 'onehand-blow-best';

const STATE = { PERMISSION: 'permission', LOADING: 'loading', ERROR: 'error', START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.PERMISSION;
let errorReason = '';

let micStream = null, audioCtx = null, analyser = null, dataArray = null;
let volume = 0;

let bird, pipes, score, best, spawnTimerMs, pipeSpeed, lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function currentGap() { return Math.max(PIPE_GAP_MIN, PIPE_GAP_BASE - score * PIPE_GAP_PER_SCORE); }
function currentInterval() { return Math.max(PIPE_INTERVAL_MIN, PIPE_INTERVAL_BASE - score * PIPE_INTERVAL_PER_SCORE); }

async function startMicFlow() {
    state = STATE.LOADING;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        state = STATE.START;
    } catch (err) {
        errorReason = 'MIC ACCESS DENIED';
        state = STATE.ERROR;
    }
}

function readVolume() {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(dataArray);
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    return Math.min(1, rms * 4); // empirical gain so normal blowing/talking reaches a usable range
}

function resetRun() {
    bird = { y: H / 2, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    spawnTimerMs = 0;
    pipeSpeed = PIPE_SPEED_BASE;
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

function spawnPipe() {
    const gap = currentGap();
    const margin = 60;
    const minTop = margin;
    const maxTop = H - margin - gap;
    const top = minTop + Math.random() * Math.max(0, maxTop - minTop);
    pipes.push({ x: W + PIPE_WIDTH, top, gap, scored: false });
}

function press() {
    if (state === STATE.PERMISSION || state === STATE.ERROR) {
        startMicFlow();
        return;
    }
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
    } else if (state === STATE.OVER) {
        reset();
    }
}

function update(dt) {
    volume = readVolume();
    if (state !== STATE.PLAYING) return;

    const thrust = volume > NOISE_FLOOR
        ? ((volume - NOISE_FLOOR) / (1 - NOISE_FLOOR)) * THRUST_MAX
        : 0;
    bird.vy += (GRAVITY - thrust) * dt;
    bird.vy = Math.max(-MAX_RISE_SPEED, Math.min(MAX_FALL_SPEED, bird.vy));
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

function drawVolumeMeter() {
    const w = 16, h = 90;
    const x = W - w - 18, y = H - h - 18;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    const floorY = y + h - NOISE_FLOOR * h;
    ctx.strokeStyle = '#666666';
    ctx.beginPath();
    ctx.moveTo(x - 4, floorY);
    ctx.lineTo(x + w + 4, floorY);
    ctx.stroke();

    const fillH = Math.min(h, volume * h);
    ctx.fillStyle = volume > NOISE_FLOOR ? '#a3e83d' : '#555555';
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
        ctx.fillText('MIC ACCESS NEEDED', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO ENABLE MICROPHONE', W / 2, H * 0.4 + 28);
        ctx.fillText('PROCESSED ON-DEVICE, NEVER SENT ANYWHERE', W / 2, H * 0.4 + 50);
        return;
    }

    if (state === STATE.LOADING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('LOADING...', W / 2, H * 0.4);
        return;
    }

    if (state === STATE.ERROR) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(errorReason, W / 2, H * 0.4);
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
    ctx.fillStyle = '#a3e83d';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(BIRD_RADIUS * 0.4, -BIRD_RADIUS * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawVolumeMeter();

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
        ctx.fillText('BLOW OR SHOUT TO RISE', W / 2, H * 0.4 + 30);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.4 + 52);
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.35);
        ctx.fillStyle = '#a3e83d';
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

window.addEventListener('pagehide', () => {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
});

best = loadBest();
resetRun();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    press();
});
