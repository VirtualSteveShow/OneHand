'use strict';

// One-handed contract: hold-only gameplay. Press and hold anywhere to charge
// (the ball rides a triangle wave 0 -> 1 -> 0 for as long as you hold), release
// to lock in that charge level. Land the release inside the target zone to
// score; a tap is just a near-zero-duration hold, so no separate gesture is
// needed to distinguish tap from hold (unlike Snake's ability system, there's
// no competing tap action here to disambiguate against). Flap proved tap,
// Dash proved swipe — this is the hold sibling.

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

function baselineY() { return H * 0.85; }
function maxTravel() { return H * 0.62; }

const BASE_PERIOD_MS = 1000;
const MIN_PERIOD_MS = 550;
const PERIOD_PER_SCORE = 25;

const BASE_WIDTH = 0.24;
const MIN_WIDTH = 0.1;
const WIDTH_PER_SCORE = 0.01;

const RESULT_MS = 500;
const BALL_RADIUS = 17;

const BEST_KEY = 'onehand-charge-best';

const STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.START;

// playState: 'idle' (waiting for a press), 'charging' (held down, riding the
// wave), 'result' (brief locked-in feedback pause before next round / game over)
let playState = 'idle';

let score, best, chargeStart, roundPeriodMs, roundWidth, target;
let resultUntil = 0, resultHit = false, frozenCharge = 0;
let lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function computePeriod(s) { return Math.max(MIN_PERIOD_MS, BASE_PERIOD_MS - s * PERIOD_PER_SCORE); }
function computeWidth(s) { return Math.max(MIN_WIDTH, BASE_WIDTH - s * WIDTH_PER_SCORE); }

function nextRound() {
    roundPeriodMs = computePeriod(score);
    roundWidth = computeWidth(score);
    const center = roundWidth / 2 + Math.random() * (1 - roundWidth);
    target = { cMin: center - roundWidth / 2, cMax: center + roundWidth / 2 };
}

function resetRun() {
    score = 0;
    playState = 'idle';
    nextRound();
}

function reset() {
    resetRun();
    state = STATE.START;
}

function computeCharge(time) {
    const elapsed = Math.max(0, time - chargeStart);
    const phase = (elapsed % (2 * roundPeriodMs)) / roundPeriodMs;
    return phase <= 1 ? phase : 2 - phase;
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function startCharging(time) {
    playState = 'charging';
    chargeStart = time;
}

function release(time) {
    if (playState !== 'charging') return;
    const charge = computeCharge(time);
    const hit = charge >= target.cMin && charge <= target.cMax;
    playState = 'result';
    resultUntil = time + RESULT_MS;
    resultHit = hit;
    frozenCharge = charge;
}

function press(time) {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        resetRun();
        startCharging(time);
    } else if (state === STATE.OVER) {
        reset();
    } else if (state === STATE.PLAYING && playState === 'idle') {
        startCharging(time);
    }
}

function update(time) {
    if (state !== STATE.PLAYING) return;
    if (playState === 'result' && time >= resultUntil) {
        if (resultHit) {
            score++;
            nextRound();
            playState = 'idle';
        } else {
            gameOver();
        }
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

function draw(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);

    const baseline = baselineY();
    const travel = maxTravel();
    const cx = W / 2;

    // guide track
    ctx.strokeStyle = '#242424';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, baseline);
    ctx.lineTo(cx, baseline - travel);
    ctx.stroke();

    const yTop = baseline - target.cMax * travel;
    const yBottom = baseline - target.cMin * travel;
    ctx.fillStyle = 'rgba(80, 200, 120, 0.22)';
    ctx.strokeStyle = 'rgba(80, 200, 120, 0.9)';
    ctx.lineWidth = 2;
    const zoneW = W * 0.6;
    roundRect(cx - zoneW / 2, yTop, zoneW, yBottom - yTop, 8);
    ctx.fill();
    ctx.stroke();

    let charge = 0;
    if (playState === 'charging') charge = computeCharge(time);
    else if (playState === 'result') charge = frozenCharge;

    const ballY = baseline - charge * travel;
    let ballColor = '#b565e8';
    if (playState === 'result') ballColor = resultHit ? '#4ec97a' : '#e85d5d';

    ctx.fillStyle = ballColor;
    ctx.beginPath();
    ctx.arc(cx, ballY, BALL_RADIUS, 0, Math.PI * 2);
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
        ctx.fillText('HOLD TO CHARGE', W / 2, H * 0.22);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('RELEASE IN THE ZONE', W / 2, H * 0.22 + 30);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.22 + 52);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.22);
        ctx.fillStyle = '#b565e8';
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
    lastTime = time;
    update(time);
    draw(time);
    requestAnimationFrame(loop);
}

best = loadBest();
reset();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(performance.now());
});
canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    release(performance.now());
});
canvas.addEventListener('pointercancel', () => {
    release(performance.now());
});
