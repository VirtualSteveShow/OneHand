'use strict';

// One-handed contract: this game's whole premise is different from the rest
// of the hub — instead of a touch gesture, the input is the front camera
// reading your face. Three modes share one camera/model session (loaded
// once, switching modes doesn't reload it):
//   - Blink: a blink is a binary trigger, exactly like Flap's tap — the
//     physics/pipes are Flap's, unmodified, input source swapped.
//   - Area: coarse look-direction (left/center/right) reused as Dash's 3
//     lanes, but with only one obstacle type and never more than 2 lanes
//     filled at once — there's no jump/duck fallback here, so a lane must
//     always be free as an escape purely via where you're looking.
//   - Full: continuous gaze-point tracking. A 5-point look-and-tap
//     calibration fits a small linear regression (hand-rolled least
//     squares, no external calibration library) mapping the same
//     look-direction signal Area uses (now on both axes) to actual screen
//     coordinates. Targets need a sustained (cumulative, not strict) dwell
//     to score — the most technically ambitious and least accurate mode of
//     the three, by nature of estimating a 2D point from a phone camera
//     without dedicated eye-tracking hardware.
//
// Video is processed entirely on-device via WASM (MediaPipe Tasks Vision);
// nothing is ever recorded, stored, or sent anywhere. Starting/retrying a
// run still happens via a tap (matching Tilt's precedent — device sensors
// still need one initial touch to begin a run); the actual gameplay action
// (blink, or look direction) needs zero further touch.
//
// This is the first game in the hub to load an external library rather
// than being fully self-contained vanilla JS — unavoidable for real face
// landmark detection. See CLAUDE.md's Stack section for the one noted
// exception.

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

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

// App-level state: getting the camera/model ready, picking a mode, or
// actively inside a mode's own start/playing/over cycle.
const STATE = { PERMISSION: 'permission', LOADING: 'loading', ERROR: 'error', MODE_SELECT: 'modeSelect', IN_GAME: 'inGame' };
let state = STATE.PERMISSION;
let errorReason = '';

let mode = null; // 'blink' | 'area'
const MODE_STATE = { START: 'start', PLAYING: 'playing', OVER: 'over' };
let modeState = MODE_STATE.START;

let faceLandmarker = null;
let cameraStream = null;
let blinkSignal = 0;   // raw eyeBlinkLeft/Right average, 0..1
let wasBlinking = false;
let gazeXRaw = 0;       // raw look-direction signal, roughly -1 (left) .. 1 (right)
let gazeXSmooth = 0;
let gazeYRaw = 0;       // roughly -1 (up) .. 1 (down)
let gazeYSmooth = 0;

let lastTime;

function loadBestFor(key) { return parseInt(localStorage.getItem(key) || '0', 10); }
function saveBestFor(key, v) { localStorage.setItem(key, String(v)); }

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// --- Blink mode (Flap's physics, blink-triggered) ---------------------------

const BLINK_BEST_KEY = 'onehand-gaze-blink-best';
const BLINK_THRESHOLD = 0.55;

const GRAVITY = 1600;
const FLAP_VELOCITY = -460;
const PIPE_SPEED = 190;
const PIPE_GAP = 230;
const PIPE_WIDTH = 74;
const PIPE_INTERVAL = 1500;
const BIRD_RADIUS = 18;
const BIRD_X_RATIO = 0.32;

let bird, pipes, blinkSpawnTimerMs;
let score = 0, best = 0; // shared across whichever mode is active

function resetBlinkRun() {
    bird = { y: H / 2, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    blinkSpawnTimerMs = 0;
    best = loadBestFor(BLINK_BEST_KEY);
    modeState = MODE_STATE.START;
}

function blinkGameOver() {
    modeState = MODE_STATE.OVER;
    best = Math.max(best, score);
    saveBestFor(BLINK_BEST_KEY, best);
}

function blinkTrigger() {
    if (modeState === MODE_STATE.START) {
        modeState = MODE_STATE.PLAYING;
        bird.vy = FLAP_VELOCITY;
    } else if (modeState === MODE_STATE.PLAYING) {
        bird.vy = FLAP_VELOCITY;
    }
}

function spawnPipe() {
    const margin = 60;
    const minTop = margin;
    const maxTop = H - margin - PIPE_GAP;
    const top = minTop + Math.random() * Math.max(0, maxTop - minTop);
    pipes.push({ x: W + PIPE_WIDTH, top, scored: false });
}

function updateBlink(dt) {
    if (modeState !== MODE_STATE.PLAYING) return;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 500));

    blinkSpawnTimerMs += dt * 1000;
    if (blinkSpawnTimerMs >= PIPE_INTERVAL) {
        blinkSpawnTimerMs = 0;
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

    if (bird.y - BIRD_RADIUS < 0) {
        bird.y = BIRD_RADIUS;
        if (bird.vy < 0) bird.vy = 0;
    }
    if (bird.y + BIRD_RADIUS > H) {
        blinkGameOver();
        return;
    }
    for (const p of pipes) {
        if (birdX + BIRD_RADIUS > p.x && birdX - BIRD_RADIUS < p.x + PIPE_WIDTH) {
            if (bird.y - BIRD_RADIUS < p.top || bird.y + BIRD_RADIUS > p.top + PIPE_GAP) {
                blinkGameOver();
                return;
            }
        }
    }
}

function drawBlink() {
    ctx.fillStyle = '#2f7a4d';
    for (const p of pipes) {
        ctx.fillRect(p.x, 0, PIPE_WIDTH, p.top);
        ctx.fillRect(p.x, p.top + PIPE_GAP, PIPE_WIDTH, H - (p.top + PIPE_GAP));
    }

    const birdX = W * BIRD_X_RATIO;
    ctx.save();
    ctx.translate(birdX, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = '#e8d83d';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(BIRD_RADIUS * 0.4, -BIRD_RADIUS * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';

    if (modeState === MODE_STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (modeState === MODE_STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('BLINK TO FLAP', W / 2, H * 0.36);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('LOOK AT THE SCREEN AND BLINK', W / 2, H * 0.36 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.36 + 50);
        drawChangeModeHint();
    }

    if (modeState === MODE_STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.32);
        ctx.fillStyle = '#e8d83d';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.32 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.32 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.32 + 122);
    }
}

// --- Area mode (coarse look-direction, Dash's lane logic) --------------------

const AREA_BEST_KEY = 'onehand-gaze-area-best';
const LANE_COUNT = 3;
const LANE_LERP_RATE = 12;

const GAZE_SMOOTH_RATE = 10;  // per second
const GAZE_THRESHOLD = 0.10;  // classify left/right beyond this smoothed value

const AREA_OBSTACLE_HEIGHT = 50;
const AREA_SPEED_BASE = 220;
const AREA_SPEED_MAX = 420;
const AREA_SPEED_PER_SCORE = 8;

const AREA_SPAWN_BASE_MS = 1200;
const AREA_SPAWN_MIN_MS = 700;
const AREA_SPAWN_PER_SCORE = 15;
const AREA_SPAWN_JITTER_MS = 150;

let areaPlayer, areaObstacles, areaSpawnTimerMs, areaSpawnIntervalMs, areaSpeed;
let areaRowRemaining, areaNextRowId;

function areaLaneCenterX(lane) {
    const laneWidth = W / LANE_COUNT;
    return laneWidth * (lane + 0.5);
}
function areaBaselineY() { return H * 0.78; }

function resetAreaRun() {
    areaPlayer = { lane: 1, targetLane: 1 };
    areaObstacles = [];
    score = 0;
    areaSpawnTimerMs = 0;
    areaSpawnIntervalMs = AREA_SPAWN_BASE_MS;
    areaSpeed = AREA_SPEED_BASE;
    areaRowRemaining = new Map();
    areaNextRowId = 0;
    best = loadBestFor(AREA_BEST_KEY);
    modeState = MODE_STATE.START;
}

function areaGameOver() {
    modeState = MODE_STATE.OVER;
    best = Math.max(best, score);
    saveBestFor(AREA_BEST_KEY, best);
}

function classifyGazeLane(smoothed) {
    if (smoothed < -GAZE_THRESHOLD) return 0;
    if (smoothed > GAZE_THRESHOLD) return 2;
    return 1;
}

function areaP2(currentScore) {
    return Math.min(0.6, 0.15 + currentScore * 0.03);
}

function areaShuffledLanes() {
    const lanes = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes;
}

function areaSpawnRow() {
    // Never fills all 3 lanes — there's no jump/duck fallback in this mode,
    // so a lane must always be free as an escape purely from where you look.
    const count = Math.random() < areaP2(score) ? 2 : 1;
    const lanes = areaShuffledLanes().slice(0, count);
    const rowId = areaNextRowId++;
    areaRowRemaining.set(rowId, lanes.length);
    for (const lane of lanes) {
        areaObstacles.push({ lane, y: -AREA_OBSTACLE_HEIGHT, scored: false, rowId });
    }
}

function updateArea(dt) {
    if (modeState === MODE_STATE.PLAYING) {
        areaPlayer.targetLane = classifyGazeLane(gazeXSmooth);
        areaPlayer.lane += (areaPlayer.targetLane - areaPlayer.lane) * Math.min(1, dt * LANE_LERP_RATE);

        areaSpawnTimerMs += dt * 1000;
        if (areaSpawnTimerMs >= areaSpawnIntervalMs) {
            areaSpawnTimerMs = 0;
            areaSpawnIntervalMs = Math.max(AREA_SPAWN_MIN_MS, AREA_SPAWN_BASE_MS - score * AREA_SPAWN_PER_SCORE)
                + (Math.random() * AREA_SPAWN_JITTER_MS * 2 - AREA_SPAWN_JITTER_MS);
            areaSpawnRow();
        }

        const hitY = areaBaselineY();
        for (const o of areaObstacles) {
            o.y += areaSpeed * dt;

            const spans = o.y <= hitY && hitY <= o.y + AREA_OBSTACLE_HEIGHT;
            const sameLane = Math.abs(areaPlayer.lane - o.lane) < 0.5;
            if (spans && sameLane) {
                areaGameOver();
                return;
            }

            if (!o.scored && o.y > hitY) {
                o.scored = true;
                const remaining = (areaRowRemaining.get(o.rowId) || 1) - 1;
                if (remaining <= 0) {
                    areaRowRemaining.delete(o.rowId);
                    score++;
                    areaSpeed = Math.min(AREA_SPEED_MAX, AREA_SPEED_BASE + score * AREA_SPEED_PER_SCORE);
                } else {
                    areaRowRemaining.set(o.rowId, remaining);
                }
            }
        }
        areaObstacles = areaObstacles.filter(o => o.y < H + 40);
    }
}

function drawArea() {
    const laneWidth = W / LANE_COUNT;
    ctx.strokeStyle = '#242424';
    ctx.lineWidth = 1;
    for (let i = 1; i < LANE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(laneWidth * i, 0);
        ctx.lineTo(laneWidth * i, H);
        ctx.stroke();
    }

    for (const o of areaObstacles) {
        const w = laneWidth * 0.7;
        const x = areaLaneCenterX(o.lane) - w / 2;
        roundRect(x, o.y, w, AREA_OBSTACLE_HEIGHT, 8);
        ctx.fillStyle = '#e8763d';
        ctx.fill();
    }

    const px = areaLaneCenterX(areaPlayer ? areaPlayer.lane : 1);
    const py = areaBaselineY();
    ctx.fillStyle = '#e8d83d';
    roundRect(px - 23, py - 23, 46, 46, 12);
    ctx.fill();

    ctx.textAlign = 'center';

    if (modeState === MODE_STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (modeState === MODE_STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('LOOK TO STEER', W / 2, H * 0.36);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO START, THEN LOOK L/C/R', W / 2, H * 0.36 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.36 + 50);
        drawChangeModeHint();
    }

    if (modeState === MODE_STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.3);
        ctx.fillStyle = '#e8d83d';
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

// --- Full mode (continuous gaze-point tracking, calibrated) -----------------

const FULL_BEST_KEY = 'onehand-gaze-full-best';

const CALIB_POINTS = [
    { fx: 0.5, fy: 0.5 },
    { fx: 0.15, fy: 0.18 },
    { fx: 0.85, fy: 0.18 },
    { fx: 0.15, fy: 0.82 },
    { fx: 0.85, fy: 0.82 },
];

const FULL_TARGET_BASE_R = 70;
const FULL_TARGET_MIN_R = 40;
const FULL_TARGET_R_PER_SCORE = 2;

const FULL_DWELL_REQUIRED_MS = 500;   // cumulative, not strict — looking away doesn't reset it
const FULL_TIME_BUDGET_BASE_MS = 4500;
const FULL_TIME_BUDGET_MIN_MS = 2500;
const FULL_TIME_BUDGET_PER_SCORE = 80;

let fullCalibrating = false;
let fullCalibIndex = 0;
let fullCalibSamples = [];
let fullCalibration = null; // { calibX: [a,b,c], calibY: [a,b,c] } or null if never calibrated
let fullTarget, fullDwellMs, fullTimeLeftMs;
let fullPredX = 0, fullPredY = 0;

// Solve a 3x3 linear system via Gaussian elimination with partial pivoting.
function solve3x3(A, b) {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < 3; col++) {
        let pivotRow = col;
        for (let r = col + 1; r < 3; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
        }
        [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
        const pivotVal = Math.abs(M[col][col]) > 1e-9 ? M[col][col] : 1e-9;
        for (let c = col; c < 4; c++) M[col][c] /= pivotVal;
        for (let r = 0; r < 3; r++) {
            if (r === col) continue;
            const factor = M[r][col];
            for (let c = col; c < 4; c++) M[r][c] -= factor * M[col][c];
        }
    }
    return [M[0][3], M[1][3], M[2][3]];
}

// Least-squares fit of screenAxis = a*gazeX + b*gazeY + c from the 5
// calibration samples, via the normal equations (A^T A x = A^T y).
function fitAxis(samples, outKey) {
    const ATA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const ATy = [0, 0, 0];
    for (const s of samples) {
        const row = [s.gazeX, s.gazeY, 1];
        for (let i = 0; i < 3; i++) {
            ATy[i] += row[i] * s[outKey];
            for (let j = 0; j < 3; j++) ATA[i][j] += row[i] * row[j];
        }
    }
    return solve3x3(ATA, ATy);
}

function computeCalibration(samples) {
    return { calibX: fitAxis(samples, 'screenX'), calibY: fitAxis(samples, 'screenY') };
}

function applyCalibration() {
    if (!fullCalibration) { fullPredX = W / 2; fullPredY = H / 2; return; }
    const { calibX, calibY } = fullCalibration;
    const px = calibX[0] * gazeXSmooth + calibX[1] * gazeYSmooth + calibX[2];
    const py = calibY[0] * gazeXSmooth + calibY[1] * gazeYSmooth + calibY[2];
    fullPredX = Math.max(0, Math.min(W, px));
    fullPredY = Math.max(0, Math.min(H, py));
}

function startFullCalibration() {
    fullCalibrating = true;
    fullCalibIndex = 0;
    fullCalibSamples = [];
}

function captureCalibSample() {
    const pt = CALIB_POINTS[fullCalibIndex];
    fullCalibSamples.push({
        gazeX: gazeXSmooth, gazeY: gazeYSmooth,
        screenX: pt.fx * W, screenY: pt.fy * H,
    });
    fullCalibIndex++;
    if (fullCalibIndex >= CALIB_POINTS.length) {
        fullCalibration = computeCalibration(fullCalibSamples);
        fullCalibrating = false;
        resetFullRun();
    }
}

function fullTargetRadius(currentScore) {
    return Math.max(FULL_TARGET_MIN_R, FULL_TARGET_BASE_R - currentScore * FULL_TARGET_R_PER_SCORE);
}
function fullTimeBudget(currentScore) {
    return Math.max(FULL_TIME_BUDGET_MIN_MS, FULL_TIME_BUDGET_BASE_MS - currentScore * FULL_TIME_BUDGET_PER_SCORE);
}

function fullNextTarget() {
    const r = fullTargetRadius(score);
    const margin = r + 20;
    fullTarget = {
        x: margin + Math.random() * (W - margin * 2),
        y: margin + Math.random() * (H - margin * 2),
        r,
    };
    fullDwellMs = 0;
    fullTimeLeftMs = fullTimeBudget(score);
}

function resetFullRun() {
    score = 0;
    best = loadBestFor(FULL_BEST_KEY);
    fullNextTarget();
    modeState = MODE_STATE.START;
}

function fullGameOver() {
    modeState = MODE_STATE.OVER;
    best = Math.max(best, score);
    saveBestFor(FULL_BEST_KEY, best);
}

function updateFull(dt) {
    if (modeState !== MODE_STATE.PLAYING) return;

    const dist = Math.hypot(fullPredX - fullTarget.x, fullPredY - fullTarget.y);
    if (dist < fullTarget.r) fullDwellMs += dt * 1000;
    fullTimeLeftMs -= dt * 1000;

    if (fullDwellMs >= FULL_DWELL_REQUIRED_MS) {
        score++;
        fullNextTarget();
    } else if (fullTimeLeftMs <= 0) {
        fullGameOver();
    }
}

function drawCalibration() {
    const pt = CALIB_POINTS[fullCalibIndex];
    const tx = pt.fx * W, ty = pt.fy * H;
    ctx.fillStyle = '#e8d83d';
    ctx.beginPath();
    ctx.arc(tx, ty, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, 24, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eeeeee';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('LOOK HERE, THEN TAP', W / 2, H * 0.9);
    ctx.fillStyle = '#888888';
    ctx.font = '13px monospace';
    ctx.fillText((fullCalibIndex + 1) + ' / ' + CALIB_POINTS.length, W / 2, H * 0.9 + 24);
}

function drawFull() {
    if (fullCalibration) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fullPredX - 10, fullPredY);
        ctx.lineTo(fullPredX + 10, fullPredY);
        ctx.moveTo(fullPredX, fullPredY - 10);
        ctx.lineTo(fullPredX, fullPredY + 10);
        ctx.stroke();
    }

    if (modeState === MODE_STATE.PLAYING && fullTarget) {
        ctx.fillStyle = 'rgba(232, 216, 61, 0.18)';
        ctx.strokeStyle = '#e8d83d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fullTarget.x, fullTarget.y, fullTarget.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const frac = Math.min(1, fullDwellMs / FULL_DWELL_REQUIRED_MS);
        if (frac > 0) {
            ctx.strokeStyle = '#4ec97a';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(fullTarget.x, fullTarget.y, fullTarget.r + 10, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.stroke();
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    ctx.textAlign = 'center';

    if (modeState === MODE_STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('LOOK & DWELL', W / 2, H * 0.3);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO START', W / 2, H * 0.3 + 28);
        if (best > 0) ctx.fillText('BEST ' + best, W / 2, H * 0.3 + 50);
        drawRecalibrateHint();
        drawChangeModeHint();
    }

    if (modeState === MODE_STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.3);
        ctx.fillStyle = '#e8d83d';
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

// --- mode select --------------------------------------------------------

function modeButtonRect(index) {
    return { cx: W / 2, cy: H * 0.32 + index * 90, w: 240, h: 64 };
}
function changeModeHintRect() {
    return { cx: W / 2, cy: H * 0.8, w: 220, h: 40 };
}
function recalibrateHintRect() {
    return { cx: W / 2, cy: H * 0.72, w: 220, h: 36 };
}
function pointInRect(x, y, r) {
    return Math.abs(x - r.cx) < r.w / 2 && Math.abs(y - r.cy) < r.h / 2;
}

function drawChangeModeHint() {
    const r = changeModeHintRect();
    ctx.fillStyle = '#666666';
    ctx.font = '12px monospace';
    ctx.fillText('CHANGE MODE', r.cx, r.cy + 4);
}

function drawRecalibrateHint() {
    const r = recalibrateHintRect();
    ctx.fillStyle = '#666666';
    ctx.font = '12px monospace';
    ctx.fillText('RECALIBRATE', r.cx, r.cy + 4);
}

function enterMode(m) {
    mode = m;
    state = STATE.IN_GAME;
    if (m === 'blink') resetBlinkRun();
    else if (m === 'area') resetAreaRun();
    else if (m === 'full') {
        if (fullCalibration) resetFullRun();
        else startFullCalibration();
    }
}

function drawModeSelect() {
    ctx.fillStyle = '#eeeeee';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('CHOOSE A MODE', W / 2, H * 0.2);

    const labels = [
        ['BLINK', 'Blink to flap'],
        ['AREA', 'Look left/center/right'],
        ['FULL', 'Look & dwell (calibrated)'],
    ];
    labels.forEach(([name, sub], i) => {
        const r = modeButtonRect(i);
        roundRect(r.cx - r.w / 2, r.cy - r.h / 2, r.w, r.h, 12);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.strokeStyle = '#e8d83d';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 18px monospace';
        ctx.fillText(name, r.cx, r.cy - 4);
        ctx.fillStyle = '#888888';
        ctx.font = '12px monospace';
        ctx.fillText(sub, r.cx, r.cy + 18);
    });
}

// --- camera + face tracking setup -----------------------------------------

async function requestCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 320, height: 240 },
            audio: false,
        });
        videoEl.srcObject = cameraStream;
        await videoEl.play();
        return true;
    } catch (err) {
        errorReason = 'CAMERA ACCESS DENIED';
        return false;
    }
}

async function loadFaceLandmarker() {
    try {
        const vision = await import(VISION_URL);
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            outputFaceBlendshapes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
        });
        return true;
    } catch (err) {
        errorReason = 'FACE MODEL FAILED TO LOAD';
        return false;
    }
}

async function startCameraFlow() {
    state = STATE.LOADING;
    const camOk = await requestCamera();
    if (!camOk) { state = STATE.ERROR; return; }
    const modelOk = await loadFaceLandmarker();
    if (!modelOk) { state = STATE.ERROR; return; }
    state = STATE.MODE_SELECT;
    detectLoop();
}

function blendshapeScore(cats, name) {
    const c = cats.find(c => c.categoryName === name);
    return c ? c.score : 0;
}

function detectLoop() {
    if (faceLandmarker && videoEl.readyState >= 2) {
        const result = faceLandmarker.detectForVideo(videoEl, performance.now());
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
            const cats = result.faceBlendshapes[0].categories;
            const l = blendshapeScore(cats, 'eyeBlinkLeft');
            const r = blendshapeScore(cats, 'eyeBlinkRight');
            blinkSignal = (l + r) / 2;

            const lookRight = (blendshapeScore(cats, 'eyeLookInLeft') + blendshapeScore(cats, 'eyeLookOutRight')) / 2;
            const lookLeft = (blendshapeScore(cats, 'eyeLookOutLeft') + blendshapeScore(cats, 'eyeLookInRight')) / 2;
            gazeXRaw = lookRight - lookLeft;

            const lookDown = (blendshapeScore(cats, 'eyeLookDownLeft') + blendshapeScore(cats, 'eyeLookDownRight')) / 2;
            const lookUp = (blendshapeScore(cats, 'eyeLookUpLeft') + blendshapeScore(cats, 'eyeLookUpRight')) / 2;
            gazeYRaw = lookDown - lookUp;
        } else {
            blinkSignal = 0;
            gazeXRaw = 0;
            gazeYRaw = 0;
        }

        const isBlinking = blinkSignal > BLINK_THRESHOLD;
        if (mode === 'blink' && state === STATE.IN_GAME && isBlinking && !wasBlinking) {
            blinkTrigger();
        }
        wasBlinking = isBlinking;
    }
    requestAnimationFrame(detectLoop);
}

window.addEventListener('pagehide', () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

// --- top-level update/draw/input --------------------------------------------

function update(dt) {
    gazeXSmooth += (gazeXRaw - gazeXSmooth) * Math.min(1, dt * GAZE_SMOOTH_RATE);
    gazeYSmooth += (gazeYRaw - gazeYSmooth) * Math.min(1, dt * GAZE_SMOOTH_RATE);
    if (mode === 'full' && fullCalibration) applyCalibration();

    if (state !== STATE.IN_GAME) return;
    if (mode === 'blink') updateBlink(dt);
    else if (mode === 'area') updateArea(dt);
    else if (mode === 'full') updateFull(dt);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    if (state === STATE.PERMISSION) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('EYE ACCESS NEEDED', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('TAP TO ENABLE CAMERA', W / 2, H * 0.4 + 28);
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

    if (state === STATE.MODE_SELECT) {
        drawModeSelect();
    } else if (state === STATE.IN_GAME) {
        if (mode === 'blink') drawBlink();
        else if (mode === 'area') drawArea();
        else if (mode === 'full') {
            if (fullCalibrating) drawCalibration();
            else drawFull();
        }
    }

    // small live camera preview so the player can confirm they're in frame
    if (videoEl.readyState >= 2) {
        const pw = 72, ph = 54;
        const px = W - pw - 14, py = H - ph - 14;
        ctx.save();
        ctx.translate(px + pw, py);
        ctx.scale(-1, 1); // mirror, matches how people expect to see themselves
        ctx.drawImage(videoEl, 0, 0, pw, ph);
        ctx.restore();
        ctx.strokeStyle = wasBlinking ? '#e8493d' : '#333333';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
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

requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const x = e.clientX, y = e.clientY;

    if (state === STATE.PERMISSION || state === STATE.ERROR) {
        startCameraFlow();
        return;
    }

    if (state === STATE.MODE_SELECT) {
        if (pointInRect(x, y, modeButtonRect(0))) enterMode('blink');
        else if (pointInRect(x, y, modeButtonRect(1))) enterMode('area');
        else if (pointInRect(x, y, modeButtonRect(2))) enterMode('full');
        return;
    }

    if (state === STATE.IN_GAME) {
        if (mode === 'full' && fullCalibrating) {
            captureCalibSample();
            return;
        }
        if (modeState === MODE_STATE.START && pointInRect(x, y, changeModeHintRect())) {
            state = STATE.MODE_SELECT;
            return;
        }
        if (mode === 'full' && modeState === MODE_STATE.START && pointInRect(x, y, recalibrateHintRect())) {
            startFullCalibration();
            return;
        }
        if (mode === 'blink') {
            if (modeState === MODE_STATE.OVER) resetBlinkRun();
            // modeState START -> PLAYING happens via blink itself, not tap
        } else if (mode === 'area') {
            if (modeState === MODE_STATE.START) modeState = MODE_STATE.PLAYING;
            else if (modeState === MODE_STATE.OVER) resetAreaRun();
        } else if (mode === 'full') {
            if (modeState === MODE_STATE.START) modeState = MODE_STATE.PLAYING;
            else if (modeState === MODE_STATE.OVER) resetFullRun();
        }
    }
});
