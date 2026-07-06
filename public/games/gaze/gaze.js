'use strict';

// One-handed contract: this game's whole premise is different from the rest
// of the hub — instead of a touch gesture, the input is the front camera
// reading your face. Blink mode (the only mode built so far; Area and Full
// gaze-point modes are planned as additions to this same game) treats a
// blink as a binary trigger, exactly like Flap's tap — the physics/pipes
// below are Flap's, unmodified, with the input source swapped. Video is
// processed entirely on-device via WASM (MediaPipe Tasks Vision); nothing
// is ever recorded, stored, or sent anywhere. START/RETRY still happen via
// a tap (matching Tilt's precedent — device sensors still need one initial
// touch to begin a run), and blink only drives the actual flap action.
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

const GRAVITY = 1600;
const FLAP_VELOCITY = -460;
const PIPE_SPEED = 190;
const PIPE_GAP = 230;
const PIPE_WIDTH = 74;
const PIPE_INTERVAL = 1500;
const BIRD_RADIUS = 18;
const BIRD_X_RATIO = 0.32;

const BLINK_THRESHOLD = 0.55;

const BEST_KEY = 'onehand-gaze-best';

// PERMISSION: waiting for the user to tap "enable camera". LOADING: camera
// granted, fetching the model. ERROR: camera denied or model failed to
// load. START/PLAYING/OVER: same meaning as every other game.
const STATE = { PERMISSION: 'permission', LOADING: 'loading', ERROR: 'error', START: 'start', PLAYING: 'playing', OVER: 'over' };
let state = STATE.PERMISSION;
let errorReason = '';

let bird, pipes, score, best, spawnTimerMs, lastTime;

let faceLandmarker = null;
let cameraStream = null;
let blinkScore = 0;
let wasBlinking = false;

function loadBest() { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10); }
function saveBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

function resetRun() {
    bird = { y: H / 2, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    spawnTimerMs = 0;
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

function flap() {
    if (state === STATE.START) {
        state = STATE.PLAYING;
        bird.vy = FLAP_VELOCITY;
    } else if (state === STATE.PLAYING) {
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
    reset();
    detectLoop();
}

function detectLoop() {
    if (faceLandmarker && videoEl.readyState >= 2) {
        const result = faceLandmarker.detectForVideo(videoEl, performance.now());
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
            const cats = result.faceBlendshapes[0].categories;
            const l = cats.find(c => c.categoryName === 'eyeBlinkLeft');
            const r = cats.find(c => c.categoryName === 'eyeBlinkRight');
            blinkScore = ((l ? l.score : 0) + (r ? r.score : 0)) / 2;
        } else {
            blinkScore = 0;
        }

        const isBlinking = blinkScore > BLINK_THRESHOLD;
        if (isBlinking && !wasBlinking) flap();
        wasBlinking = isBlinking;
    }
    requestAnimationFrame(detectLoop);
}

window.addEventListener('pagehide', () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

// --- rendering --------------------------------------------------------------

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

    if (state === STATE.PLAYING) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, 80);
    }

    if (state === STATE.START) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('BLINK TO FLAP', W / 2, H * 0.4);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('LOOK AT THE SCREEN AND BLINK', W / 2, H * 0.4 + 30);
        if (best > 0) {
            ctx.fillText('BEST ' + best, W / 2, H * 0.4 + 52);
        }
    }

    if (state === STATE.OVER) {
        ctx.fillStyle = '#eeeeee';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('GAME OVER', W / 2, H * 0.35);
        ctx.fillStyle = '#e8d83d';
        ctx.font = 'bold 42px monospace';
        ctx.fillText(String(score), W / 2, H * 0.35 + 58);
        ctx.fillStyle = '#888888';
        ctx.font = '13px monospace';
        ctx.fillText('BEST ' + best, W / 2, H * 0.35 + 84);
        ctx.fillStyle = '#eeeeee';
        ctx.font = '14px monospace';
        ctx.fillText('TAP TO RETRY', W / 2, H * 0.35 + 122);
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

best = loadBest();
resetRun();
requestAnimationFrame(loop);

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state === STATE.PERMISSION || state === STATE.ERROR) {
        startCameraFlow();
    } else if (state === STATE.OVER) {
        reset();
    }
});
