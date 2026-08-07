/*
 * MIT License
 * 
 * Copyright (c) 2022 Covao / Koichi Kobayashi (Original DonkeyCopilot)
 * Copyright (c) 2026 (Mini 4WD Copilot Mockup)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// DOM Elements
const throttleSlider = document.getElementById('throttle-slider');
const steeringSlider = document.getElementById('steering-slider');
const throttleValue = document.getElementById('throttle-value');
const steeringValue = document.getElementById('steering-value');
const throttleGauge = document.getElementById('throttle-gauge');
const steeringPointer = document.getElementById('steering-pointer');

const btnDriveMode = document.getElementById('btn-drive-mode');
const btnRec = document.getElementById('btn-rec');
const btnAutoRec = document.getElementById('btn-auto-rec');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnAbout = document.getElementById('btn-about');
const btnCloseAbout = document.getElementById('btn-close-about');
const aboutModal = document.getElementById('about-modal');

const fpsCounter = document.getElementById('fps-counter');
const gamepadStatus = document.getElementById('gamepad-status');
const cameraFeed = document.querySelector('.camera-feed');

// State
let state = {
    throttle: 0,
    steering: 0,
    driveMode: 'user', // 'user', 'local', 'local_angle'
    isRecording: false,
    isAutoRec: false,
    maxAccel: 100,
    lastFrameTime: performance.now(),
    frameCount: 0,
    fps: 0,
    buttonX0: false,
    buttonB0: false
};

// WebSocket Mock
let wsMock = {
    send: (data) => {
        // console.log("WS Send:", data); // Uncomment for debugging
    }
};

// Initialize
function init() {
    setupEventListeners();
    requestAnimationFrame(gameLoop);
}

function setupEventListeners() {
    // Sliders
    throttleSlider.addEventListener('input', updateStateFromUI);
    throttleSlider.addEventListener('change', () => resetSlider(throttleSlider, 'throttle'));
    throttleSlider.addEventListener('mouseup', () => resetSlider(throttleSlider, 'throttle'));
    throttleSlider.addEventListener('touchend', () => resetSlider(throttleSlider, 'throttle'));

    steeringSlider.addEventListener('input', updateStateFromUI);
    steeringSlider.addEventListener('change', () => resetSlider(steeringSlider, 'steering'));
    steeringSlider.addEventListener('mouseup', () => resetSlider(steeringSlider, 'steering'));
    steeringSlider.addEventListener('touchend', () => resetSlider(steeringSlider, 'steering'));

    // Buttons
    btnDriveMode.addEventListener('click', toggleDriveMode);
    btnRec.addEventListener('click', toggleRec);
    btnAutoRec.addEventListener('click', toggleAutoRec);
    btnFullscreen.addEventListener('click', toggleFullscreen);

    // Modal
    btnAbout.addEventListener('click', () => aboutModal.classList.remove('hidden'));
    btnCloseAbout.addEventListener('click', () => aboutModal.classList.add('hidden'));

    // Prevent default touch behaviors
    document.body.addEventListener('touchmove', (e) => {
        if(e.target.type !== 'range') {
            e.preventDefault();
        }
    }, { passive: false });
}

function updateStateFromUI() {
    state.throttle = parseFloat(throttleSlider.value);
    state.steering = parseFloat(steeringSlider.value);
    
    // Auto Steering Mode logic
    if (state.throttle !== 0 && state.driveMode === 'local') {
        state.driveMode = 'local_angle';
        updateDriveModeUI();
    }
    
    // Manual Mode override
    if (state.steering !== 0 && state.driveMode !== 'user') {
        state.driveMode = 'user';
        updateDriveModeUI();
    }
}

function resetSlider(slider, axis) {
    slider.value = 0;
    state[axis] = 0;
}

function toggleDriveMode() {
    if (state.driveMode === 'local' || state.driveMode === 'local_angle') {
        state.driveMode = 'user';
    } else {
        state.driveMode = 'local';
    }
    updateDriveModeUI();
}

function updateDriveModeUI() {
    if (state.driveMode === 'local') {
        btnDriveMode.textContent = 'Auto Mode';
        btnDriveMode.classList.add('auto-mode');
    } else if (state.driveMode === 'local_angle') {
        btnDriveMode.textContent = 'Auto Steering';
        btnDriveMode.classList.add('auto-mode');
    } else {
        btnDriveMode.textContent = 'Manual Mode';
        btnDriveMode.classList.remove('auto-mode');
    }
}

function toggleRec() {
    if (!state.isAutoRec) {
        state.isRecording = !state.isRecording;
        updateRecUI();
    }
}

function toggleAutoRec() {
    state.isAutoRec = !state.isAutoRec;
    if (state.isAutoRec) {
        btnAutoRec.classList.add('danger', 'active');
    } else {
        btnAutoRec.classList.remove('danger', 'active');
        state.isRecording = false;
    }
    updateRecUI();
}

function updateRecUI() {
    if (state.isRecording) {
        btnRec.classList.add('active-record');
    } else {
        btnRec.classList.remove('active-record');
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

// --- Gamepad Logic ---
function pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = gamepads[0];
    
    if (pad) {
        gamepadStatus.textContent = "Gamepad: On";
        gamepadStatus.classList.add('active');

        const deadband = 0.05;
        let analogX = pad.axes[2] || 0; // Right stick X for some controllers
        let analogY = -(pad.axes[1] || 0); // Left stick Y

        if (Math.abs(analogX) < deadband) analogX = 0;
        if (Math.abs(analogY) < deadband) analogY = 0;

        const buttonA = pad.buttons[0]?.pressed;
        const buttonB = pad.buttons[1]?.pressed;
        const buttonX = pad.buttons[2]?.pressed || pad.buttons[3]?.pressed;
        
        // Simple mapping to UI
        if(!throttleSlider.matches(':active')) {
            throttleSlider.value = analogY;
            state.throttle = analogY;
        }

        if(!steeringSlider.matches(':active')) {
            steeringSlider.value = analogX;
            state.steering = analogX;
        }

        // Button X: toggle drive mode
        if (buttonX && !state.buttonX0) {
            toggleDriveMode();
        }
        state.buttonX0 = buttonX;

        // Button B: toggle Rec
        if (buttonB && !state.buttonB0) {
            toggleRec();
        }
        state.buttonB0 = buttonB;
        
    } else {
        gamepadStatus.textContent = "Gamepad: Off";
        gamepadStatus.classList.remove('active');
    }
}

// --- Render Loop ---
function gameLoop(timestamp) {
    // Calculate FPS
    state.frameCount++;
    if (timestamp - state.lastFrameTime >= 1000) {
        state.fps = state.frameCount;
        state.frameCount = 0;
        state.lastFrameTime = timestamp;
        fpsCounter.textContent = `FPS ${state.fps}`;
    }

    pollGamepad();

    // Auto record logic
    if (state.isAutoRec) {
        if (Math.abs(state.throttle) > 0.01) {
            if(!state.isRecording) {
                state.isRecording = true;
                updateRecUI();
            }
        } else {
            if(state.isRecording) {
                state.isRecording = false;
                updateRecUI();
            }
        }
    }

    // Update UI Visuals
    let tVal = Math.round(state.throttle * 100);
    let sVal = Math.round(state.steering * 100);
    
    throttleValue.textContent = tVal;
    steeringValue.textContent = sVal;

    // Throttle gauge update (Arc length = 125 roughly)
    const maxOffset = 125;
    let offset = maxOffset - (Math.abs(state.throttle) * maxOffset);
    throttleGauge.style.strokeDashoffset = offset;
    
    // Change throttle color based on direction/level
    if (state.throttle < 0) {
        throttleGauge.style.stroke = "var(--danger)";
    } else if (state.throttle > 0.8) {
        throttleGauge.style.stroke = "var(--warning)";
    } else {
        throttleGauge.style.stroke = "var(--neon-pink)";
    }

    // Steering pointer rotation
    // Rotate from -90deg to 90deg based on -1 to 1
    const rot = state.steering * 45; 
    steeringPointer.style.transform = `rotate(${rot}deg)`;

    // Camera feed mock effect (blur on high speed)
    const speedBlur = Math.abs(state.throttle) * 3;
    cameraFeed.style.filter = `brightness(0.7) contrast(1.2) blur(${speedBlur}px)`;

    // Mock Send WebSocket
    wsMock.send(JSON.stringify({
        angle: state.steering,
        throttle: state.throttle,
        drive_mode: state.driveMode,
        recording: state.isRecording
    }));

    requestAnimationFrame(gameLoop);
}

// Start
init();
