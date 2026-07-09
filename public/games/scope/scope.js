'use strict';

// One-handed contract: a "magic window" look-around game — tilt the phone
// gently and a reticle-fixed viewport pans across a wider virtual space
// scattered with targets, dwell on one (Full mode's dwell-to-score pattern,
// borrowed from Gaze) to pop it. Zero touch needed once a run starts, same
// promise as Tilt and Blow: only the initial tap-to-start needs a finger.
//
// Two background modes share the same gyro-driven pan/dwell logic:
//   - Camera: the back-facing camera feed as a live passthrough backdrop,
//     for a lightweight AR feel — tilting the phone pans the target layer
//     in rough sync with how the real-world view shifts through the lens.
//     This is NOT true world-locked AR (no SLAM/6dof anchoring, just a 2D
//     pan keyed to tilt angle) — targets don't stay pinned to a real-world
//     point if you walk around, only if you tilt in place. Good enough for
//     a lightweight "look through your phone" feel, not pixel-perfect.
//   - No Camera: a plain synthetic starfield stands in for the backdrop,
//     same pan/dwell logic, no camera permission needed at all.
//
// Deliberately reads gamma/beta (tilt angles, the same reliable axis Tilt
// already proved out) rather than alpha (compass heading) for panning —
// alpha needs a magnetometer and drifts; gamma/beta are accelerometer-
// derived and steady. This also matches what was actually asked for
// ("slightly tilting the phone"), not a full turn-your-body-around swing.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const videoEl = document.getElementById('cam');

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

const GAMMA_SENSITIVITY = 25; // degrees of tilt (relative to zero) for full horizontal pan
const BETA_SENSITIVITY = 20;  // degrees of tilt for full vertical pan
const TILT_DEADZONE = 1.5;    // degrees, ignore tiny jitter near zero

const VSPACE_W_RATIO = 2.4; // virtual space size as a multiple of screen size —
const VSPACE_H_RATIO = 1.8; // how far tilting can pan before hitting the edge

const TARGET_BASE_R = 55;
const TARGET_MIN_R = 32;
const TARGET_R_PER_SCORE = 1.5;

const DWELL_REQUIRED_MS = 500; // cumulative, not strict — looking away doesn't reset it
const TIME_BUDGET_BASE_MS = 4500;
const TIME_BUDGET_MIN_MS = 2500;
const TIME_BUDGET_PER_SCORE = 80;

const STAR_COUNT = 140;

const BEST_KEY = 'onehand-scope-best';

const STATE = { PERMISSION: 'permission', ERROR: 'error', MODE_SELECT: 'modeSelect', LOADING: 'loading', START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.PERMISSION;
let errorReason = '';
let mode = null; // 'camera' | 'nocamera'

let cameraStream = null;
let currentGamma = 0, currentBeta = 0;
let zeroGamma = 0, zeroBeta = 0;
let panOffset = { x: 0, y: 0 };

let target, dwellMs, timeLeftMs, score, best;
let stars = [];
let lastTime;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function onOrientation(e) {
    if (typeof e.gamma === 'number') currentGamma = e.gamma;
    if (typeof e.beta === 'number') currentBeta = e.beta;
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

async function requestBackCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        });
        videoEl.srcObject = cameraStream;
        await videoEl.play();
        return true;
    } catch (err) {
        return false;
    }
}

function vspaceSize() { return { w: W * VSPACE_W_RATIO, h: H * VSPACE_H_RATIO }; }

function randomStars(n) {
    const vs = vspaceSize();
    const arr = [];
    for (let i = 0; i < n; i++) {
        arr.push({ x: Math.random() * vs.w, y: Math.random() * vs.h, r: 1 + Math.random() * 2 });
    }
    return arr;
}

function targetRadius(s) { return Math.max(TARGET_MIN_R, TARGET_BASE_R - s * TARGET_R_PER_SCORE); }
function timeBudget(s) { return Math.max(TIME_BUDGET_MIN_MS, TIME_BUDGET_BASE_MS - s * TIME_BUDGET_PER_SCORE); }

function nextTarget() {
    const vs = vspaceSize();
    const r = targetRadius(score);
    const margin = r + 20;
    target = {
        x: margin + Math.random() * (vs.w - margin * 2),
        y: margin + Math.random() * (vs.h - margin * 2),
        r,
    };
    dwellMs = 0;
    timeLeftMs = timeBudget(score);
}

function resetRun() {
    score = 0;
    nextTarget();
    state = STATE.START;
}

function gameOver() {
    state = STATE.OVER;
    best = Math.max(best, score);
    saveBest(best);
}

function calibrateZero() {
    zeroGamma = currentGamma;
    zeroBeta = currentBeta;
}

async function enterMode(m) {
    mode = m;
    if (m === 'camera') {
        state = STATE.LOADING;
        const ok = await requestBackCamera();
        if (!ok) {
            errorReason = 'CAMERA ACCESS DENIED';
            state = STATE.ERROR;
            return;
        }
    } else if (stars.length === 0) {
        stars = randomStars(STAR_COUNT);
    }
    resetRun();
}

async function enablePermission() {
    const ok = await ensureGyroPermission();
    if (!ok) {
        errorReason = 'MOTION ACCESS DENIED';
        state = STATE.ERROR;
        return;
    }
    state = STATE.MODE_SELECT;
}

function updatePan() {
    let dGamma = currentGamma - zeroGamma;
    if (Math.abs(dGamma) < TILT_DEADZONE) dGamma = 0;
    dGamma = Math.max(-GAMMA_SENSITIVITY, Math.min(GAMMA_SENSITIVITY, dGamma));

    let dBeta = currentBeta - zeroBeta;
    if (Math.abs(dBeta) < TILT_DEADZONE) dBeta = 0;
    dBeta = Math.max(-BETA_SENSITIVITY, Math.min(BETA_SENSITIVITY, dBeta));

    const vs = vspaceSize();
    const maxPanX = (vs.w - W) / 2;
    const maxPanY = (vs.h - H) / 2;
    panOffset.x = (dGamma / GAMMA_SENSITIVITY) * maxPanX;
    panOffset.y = (dBeta / BETA_SENSITIVITY) * maxPanY;
}

function worldToScreen(vx, vy) {
    const vs = vspaceSize();
    return {
        x: (vx - vs.w / 2) - panOffset.x + W / 2,
        y: (vy - vs.h / 2) - panOffset.y + H / 2,
    };
}

function update(dt) {
    if (state !== STATE.PLAYING) return;
    updatePan();

    const sp = worldToScreen(target.x, target.y);
    const dist = Math.hypot(sp.x - W / 2, sp.y - H / 2);
    if (dist < target.r) dwellMs += dt * 1000;
    timeLeftMs -= dt * 1000;

    if (dwellMs >= DWELL_REQUIRED_MS) {
        score++;
        nextTarget();
    } else if (timeLeftMs <= 0) {
        gameOver();
    }
}

function drawVideoCover() {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (videoEl.readyState < 2 || !vw || !vh) return;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(videoEl, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawBackground() {
    if (mode === 'camera') {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, W, H);
        drawVideoCover();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; // keep white UI text legible over bright scenes
        ctx.fillRect(0, 0, W, H);
    } else {
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        for (const s of stars) {
            const sp = worldToScreen(s.x, s.y);
            if (sp.x < -10 || sp.x > W + 10 || sp.y < -10 || sp.y > H + 10) continue;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawReticle() {
    const cx = W / 2, cy = H / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy);
    ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6);
    ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18);
    ctx.stroke();
}

function drawTarget() {
    const sp = worldToScreen(target.x, target.y);
    ctx.fillStyle = 'rgba(232, 61, 107, 0.22)';
    ctx.strokeStyle = '#e83d6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, target.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const frac = Math.min(1, dwellMs / DWELL_REQUIRED_MS);
    if (frac > 0) {
        ctx.strokeStyle = '#4ec97a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, target.r + 10, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
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

function pointInRect(x, y, r) {
    return Math.abs(x - r.cx) < r.w / 2 && Math.abs(y - r.cy) < r.h / 2;
}

function modeButtonRect(index) {
    return { cx: W / 2, cy: H * 0.42 + index * 80, w: 240, h: 64 };
}

function changeModeHintRect() {
    return { cx: W / 2, cy: H * 0.36 + 110, w: 220, h: 40 };
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
        ctx.fillText('TAP TO ENABLE MOTION', W / 2, H * 0.4 + 28);
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
        if (errorReason === 'CAMERA ACCESS DENIED') {
            ctx.fillText('(RETURNS TO MODE SELECT)', W / 2, H * 0.4 + 48);
        }
        return;
    }

    if (state === STATE.MODE_SELECT) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('CHOOSE A BACKDROP', W / 2, H * 0.18);

        const labels = [['CAMERA', 'AR passthrough'], ['NO CAMERA', 'Starfield only']];
        labels.forEach(([name, sub], i) => {
            const r = modeButtonRect(i);
            roundRect(r.cx - r.w / 2, r.cy - r.h / 2, r.w, r.h, 12);
            ctx.fillStyle = '#1a1a1a';
            ctx.fill();
            ctx.strokeStyle = '#e83d6b';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#eeeeee';
            ctx.font = 'bold 18px monospace';
            ctx.fillText(name, r.cx, r.cy - 4);
            ctx.fillStyle = '#888888';
            ctx.font = '12px monospace';
            ctx.fillText(sub, r.cx, r.cy + 18);
        });
        return;
    }

    if (state === STATE.PLAYING || state === STATE.OVER) {
        drawBackground();
        if (state === STATE.PLAYING) {
            drawTarget();
            drawReticle();
            ctx.fillStyle = '#eeeeee';
            ctx.font = 'bold 42px monospace';
            ctx.fillText(String(score), W / 2, 80);
        }
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('TILT & DWELL', W / 2, H * 0.36);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO START, THEN JUST TILT', W / 2, H * 0.36 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.36 + 50);
        const r = changeModeHintRect();
        ctx.fillStyle = '#666666';
        ctx.font = '12px monospace';
        ctx.fillText('CHANGE BACKDROP', r.cx, r.cy + 4);
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.3);
        ctx.fillStyle = '#e83d6b';
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
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

window.addEventListener('pagehide', () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

best = loadBest();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const x = e.clientX, y = e.clientY;

    if (state === STATE.PERMISSION) {
        enablePermission();
        return;
    }

    if (state === STATE.ERROR) {
        if (errorReason === 'CAMERA ACCESS DENIED') state = STATE.MODE_SELECT;
        else enablePermission();
        return;
    }

    if (state === STATE.MODE_SELECT) {
        if (pointInRect(x, y, modeButtonRect(0))) enterMode('camera');
        else if (pointInRect(x, y, modeButtonRect(1))) enterMode('nocamera');
        return;
    }

    if (state === STATE.START) {
        if (pointInRect(x, y, changeModeHintRect())) {
            state = STATE.MODE_SELECT;
            return;
        }
        calibrateZero();
        state = STATE.PLAYING;
        return;
    }

    if (state === STATE.OVER) {
        resetRun();
    }
});
