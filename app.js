/*
 * ミニ四駆自動運転 WebApp (Client Controller)
 * WebSocket (ws://localhost:8765) 経由で車載マイコンと100ms周期で双方向通信
 */

// DOM Elements
const wsStatus = document.getElementById('ws-status');
const modeBadge = document.getElementById('mode-badge');
const distanceBadge = document.getElementById('distance-badge');
const fpsCounter = document.getElementById('fps-counter');
const gamepadStatus = document.getElementById('gamepad-status');

const throttleSlider = document.getElementById('throttle-slider');
const steeringSlider = document.getElementById('steering-slider');
const throttleValue = document.getElementById('throttle-value');
const steeringValue = document.getElementById('steering-value');
const throttleGauge = document.getElementById('throttle-gauge');
const steeringPointer = document.getElementById('steering-pointer');

const statusModeText = document.getElementById('status-mode-text');
const statusDistanceText = document.getElementById('status-distance-text');
const statusStopReason = document.getElementById('status-stop-reason');
const stopReasonLine = document.getElementById('stop-reason-line');

const btnDriveMode = document.getElementById('btn-drive-mode');
const btnEmergencyStop = document.getElementById('btn-emergency-stop');
const btnResetStop = document.getElementById('btn-reset-stop');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnAbout = document.getElementById('btn-about');
const btnCloseAbout = document.getElementById('btn-close-about');
const aboutModal = document.getElementById('about-modal');

const alertBanner = document.getElementById('alert-banner');
const alertMessage = document.getElementById('alert-message');

const torOverlay = document.getElementById('tor-overlay');
const torCountdown = document.getElementById('tor-countdown');
const btnTorTakeover = document.getElementById('btn-tor-takeover');

const disconnectedOverlay = document.getElementById('disconnected-overlay');

// Application State
let appState = {
    // Current recognized mode (WebApp's view)
    clientMode: 'MANUAL', // 'MANUAL', 'AUTO', 'SAFE_STOP', 'EMERGENCY_STOP'
    
    // Server's authoritative mode (Source of Truth)
    mcuMode: 'MANUAL',
    frontDistanceMm: 1200,
    torActive: false,
    torRemainingMs: 0,
    stopReason: 'NONE',
    requestRejectReason: 'NONE',

    // Control inputs (-1.0 to 1.0)
    throttle: 0.0,
    steering: 0.0,

    // One-shot requests
    modeRequest: 'NONE', // 'NONE', 'MANUAL', 'AUTO'
    emergencyStopRequest: false,
    resetStopRequest: false,

    // UI Pending states
    pendingMode: null,
    pendingTimer: null,

    // Connectivity
    connected: false,
    lastHeartbeatTime: 0,

    // Performance
    frameCount: 0,
    lastFrameTime: performance.now(),
    fps: 60
};

// Keyboard state for smooth 2-axis control
const keysPressed = {
    up: false,
    down: false,
    left: false,
    right: false
};

// WebSocket Management
let ws = null;
const WS_PORT = 8765;
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = location.host || `localhost:${WS_PORT}`;
const WS_URL = `${wsProto}//${wsHost}`;

function connectWebSocket() {
    try {
        ws = new WebSocket(WS_URL);
    } catch (e) {
        setDisconnectedUI();
        setTimeout(connectWebSocket, 2000);
        return;
    }

    ws.onopen = () => {
        appState.connected = true;
        appState.lastHeartbeatTime = Date.now();
        wsStatus.textContent = "WS: 接続中 (ONLINE)";
        wsStatus.className = "status-badge connected";
        disconnectedOverlay.classList.add('hidden');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleHeartbeat(data);
        } catch (e) {
            console.error("Invalid WS message:", e);
        }
    };

    ws.onclose = () => {
        setDisconnectedUI();
        setTimeout(connectWebSocket, 1500);
    };

    ws.onerror = () => {
        setDisconnectedUI();
    };
}

function setDisconnectedUI() {
    appState.connected = false;
    wsStatus.textContent = "WS: 未接続 (OFFLINE)";
    wsStatus.className = "status-badge disconnected";
    disconnectedOverlay.classList.remove('hidden');
}

// Handle authoritative Heartbeat from MCU
function handleHeartbeat(data) {
    appState.lastHeartbeatTime = Date.now();
    appState.mcuMode = data.mode || 'MANUAL';
    appState.clientMode = appState.mcuMode;
    appState.frontDistanceMm = data.front_distance_mm ?? 1200;
    appState.torActive = !!data.tor_active;
    appState.torRemainingMs = data.tor_remaining_ms || 0;
    appState.stopReason = data.stop_reason || 'NONE';
    appState.requestRejectReason = data.request_reject_reason || 'NONE';

    // Clear Pending if mode changed or rejected
    if (appState.pendingMode) {
        if (appState.mcuMode === appState.pendingMode || appState.requestRejectReason !== 'NONE') {
            clearTimeout(appState.pendingTimer);
            appState.pendingMode = null;
        }
    }

    // Show reject reason alert if any
    if (appState.requestRejectReason !== 'NONE') {
        showErrorMessage(`要求拒否: ${getRejectReasonText(appState.requestRejectReason)}`);
    }

    updateUIFromState();
}

function getRejectReasonText(reason) {
    switch (reason) {
        case 'OBSTACLE_NEAR': return '前方に障害物を検知しています';
        case 'SENSOR_NOT_READY': return 'センサーが準備完了していません';
        case 'IN_TOR': return '引継ぎ要求(TOR)発生中です';
        case 'IN_EMERGENCY': return '非常停止中です';
        case 'MODE_MISMATCH': return '車両の状態と一致しない操作です';
        default: return reason;
    }
}

function showErrorMessage(msg) {
    alertMessage.textContent = msg;
    alertBanner.classList.remove('hidden');
    setTimeout(() => {
        alertBanner.classList.add('hidden');
    }, 3000);
}

// Update UI Components
function updateUIFromState() {
    // 1. Badges & Text
    modeBadge.textContent = `MODE: ${appState.mcuMode}`;
    modeBadge.className = `status-badge mode-badge mode-${appState.mcuMode.toLowerCase().replace('_', '')}`;
    
    distanceBadge.textContent = `前方距離: ${appState.frontDistanceMm} mm`;
    statusModeText.textContent = appState.mcuMode;
    statusDistanceText.textContent = `${appState.frontDistanceMm} mm`;
    statusStopReason.textContent = appState.stopReason;

    // 2. Mode & Action Buttons
    if (appState.mcuMode === 'MANUAL') {
        btnDriveMode.classList.remove('hidden', 'auto-mode', 'pending');
        btnDriveMode.textContent = appState.pendingMode === 'AUTO' ? '切替中 (Pending)...' : 'Auto Mode へ切替';
        btnDriveMode.disabled = !!appState.pendingMode;
        btnResetStop.classList.add('hidden');

        throttleSlider.disabled = false;
        steeringSlider.disabled = false;
    } else if (appState.mcuMode === 'AUTO') {
        btnDriveMode.classList.remove('hidden', 'pending');
        btnDriveMode.classList.add('auto-mode');
        btnDriveMode.textContent = appState.pendingMode === 'MANUAL' ? '切替中 (Pending)...' : 'Manual Mode へ切替';
        btnDriveMode.disabled = !!appState.pendingMode;
        btnResetStop.classList.add('hidden');

        throttleSlider.disabled = true;
        steeringSlider.disabled = true;
    } else if (appState.mcuMode === 'SAFE_STOP' || appState.mcuMode === 'EMERGENCY_STOP') {
        btnDriveMode.classList.add('hidden');
        btnResetStop.classList.remove('hidden');
        btnResetStop.textContent = appState.mcuMode === 'EMERGENCY_STOP' ? '🚨 安全確認・非常停止を解除' : '手動モードで再開 (リセット)';

        throttleSlider.disabled = true;
        steeringSlider.disabled = true;
    }

    // 3. TOR Overlay
    if (appState.torActive && appState.mcuMode === 'AUTO') {
        torOverlay.classList.remove('hidden');
        const sec = (appState.torRemainingMs / 1000).toFixed(1);
        torCountdown.textContent = sec;
    } else {
        torOverlay.classList.add('hidden');
    }

    // 4. Update Gauges
    renderGauges();
}

function renderGauges() {
    let tVal = Math.round(appState.throttle * 100);
    let sVal = Math.round(appState.steering * 100);
    
    throttleValue.textContent = tVal;
    steeringValue.textContent = sVal;

    // Throttle gauge fill (arc offset)
    const maxOffset = 125;
    let offset = maxOffset - (Math.abs(appState.throttle) * maxOffset);
    throttleGauge.style.strokeDashoffset = offset;
    
    if (appState.throttle < 0) {
        throttleGauge.style.stroke = "var(--accent-red)";
    } else if (appState.throttle > 0.8) {
        throttleGauge.style.stroke = "var(--accent-orange)";
    } else {
        throttleGauge.style.stroke = "var(--accent-blue)";
    }

    // Steering pointer angle (-45 to 45 deg)
    const rot = appState.steering * 45;
    steeringPointer.style.transform = `rotate(${rot}deg)`;
}

// Send Command via WebSocket (100ms interval)
function sendCommandLoop() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = {
            client_mode: appState.clientMode,
            throttle: appState.mcuMode === 'MANUAL' ? appState.throttle : 0.0,
            steering: appState.mcuMode === 'MANUAL' ? appState.steering : 0.0,
            mode_request: appState.modeRequest,
            emergency_stop_request: appState.emergencyStopRequest,
            reset_stop_request: appState.resetStopRequest
        };

        ws.send(JSON.stringify(payload));

        // Reset one-shot flags
        appState.modeRequest = 'NONE';
        appState.emergencyStopRequest = false;
        appState.resetStopRequest = false;
    }

    // Heartbeat timeout check (1.5 seconds)
    if (appState.connected && Date.now() - appState.lastHeartbeatTime > 1500) {
        setDisconnectedUI();
    }
}

// --- Keyboard & Input Handling (2-Axis Independent Control) ---
function updateKeyboardInputs() {
    if (appState.mcuMode !== 'MANUAL') return;

    let targetThrottle = 0.0;
    let targetSteering = 0.0;

    if (keysPressed.up && !keysPressed.down) targetThrottle = 1.0;
    if (keysPressed.down && !keysPressed.up) targetThrottle = -1.0;

    if (keysPressed.left && !keysPressed.right) targetSteering = -1.0;
    if (keysPressed.right && !keysPressed.left) targetSteering = 1.0;

    // Only override sliders if keyboard is being actively pressed
    const isKeyboardActive = keysPressed.up || keysPressed.down || keysPressed.left || keysPressed.right;
    if (isKeyboardActive) {
        appState.throttle = targetThrottle;
        appState.steering = targetSteering;
        throttleSlider.value = targetThrottle;
        steeringSlider.value = targetSteering;
    }
}

function setupEventListeners() {
    // Sliders
    throttleSlider.addEventListener('input', () => {
        appState.throttle = parseFloat(throttleSlider.value);
    });
    throttleSlider.addEventListener('change', () => {
        throttleSlider.value = 0;
        appState.throttle = 0;
    });
    throttleSlider.addEventListener('mouseup', () => {
        throttleSlider.value = 0;
        appState.throttle = 0;
    });
    throttleSlider.addEventListener('touchend', () => {
        throttleSlider.value = 0;
        appState.throttle = 0;
    });

    steeringSlider.addEventListener('input', () => {
        appState.steering = parseFloat(steeringSlider.value);
    });
    steeringSlider.addEventListener('change', () => {
        steeringSlider.value = 0;
        appState.steering = 0;
    });
    steeringSlider.addEventListener('mouseup', () => {
        steeringSlider.value = 0;
        appState.steering = 0;
    });
    steeringSlider.addEventListener('touchend', () => {
        steeringSlider.value = 0;
        appState.steering = 0;
    });

    // Buttons
    btnDriveMode.addEventListener('click', () => {
        if (appState.pendingMode) return;
        const req = appState.mcuMode === 'MANUAL' ? 'AUTO' : 'MANUAL';
        appState.modeRequest = req;
        appState.pendingMode = req;
        btnDriveMode.textContent = '切替中 (Pending)...';
        btnDriveMode.classList.add('pending');

        appState.pendingTimer = setTimeout(() => {
            if (appState.pendingMode) {
                showErrorMessage('モード切替がタイムアウトしました');
                appState.pendingMode = null;
                updateUIFromState();
            }
        }, 1000);
    });

    btnEmergencyStop.addEventListener('click', () => {
        appState.emergencyStopRequest = true;
    });

    btnResetStop.addEventListener('click', () => {
        appState.resetStopRequest = true;
    });

    btnTorTakeover.addEventListener('click', () => {
        appState.modeRequest = 'MANUAL';
        torOverlay.classList.add('hidden');
    });

    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    });

    // Modal
    btnAbout.addEventListener('click', () => aboutModal.classList.remove('hidden'));
    btnCloseAbout.addEventListener('click', () => aboutModal.classList.add('hidden'));

    // Keyboard Listeners
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keysPressed.up = true;
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keysPressed.down = true;
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysPressed.left = true;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysPressed.right = true;
        if (e.key === ' ') {
            appState.emergencyStopRequest = true;
            e.preventDefault();
        }
        updateKeyboardInputs();
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keysPressed.up = false;
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keysPressed.down = false;
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysPressed.left = false;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysPressed.right = false;
        
        updateKeyboardInputs();
        
        // Return to center when all keys released
        if (!keysPressed.up && !keysPressed.down) {
            appState.throttle = 0.0;
            throttleSlider.value = 0;
        }
        if (!keysPressed.left && !keysPressed.right) {
            appState.steering = 0.0;
            steeringSlider.value = 0;
        }
    });
}

// --- Gamepad Polling ---
function pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = gamepads[0];
    
    if (pad) {
        gamepadStatus.textContent = "Gamepad: On";
        gamepadStatus.classList.add('active');

        if (appState.mcuMode === 'MANUAL') {
            const deadband = 0.08;
            let stickX = pad.axes[0] || pad.axes[2] || 0;
            let stickY = -(pad.axes[1] || 0);

            if (Math.abs(stickX) < deadband) stickX = 0;
            if (Math.abs(stickY) < deadband) stickY = 0;

            if (!throttleSlider.matches(':active') && !keysPressed.up && !keysPressed.down) {
                appState.throttle = stickY;
                throttleSlider.value = stickY;
            }
            if (!steeringSlider.matches(':active') && !keysPressed.left && !keysPressed.right) {
                appState.steering = stickX;
                steeringSlider.value = stickX;
            }
        }

        // Button A or B for Emergency Stop
        if (pad.buttons[1]?.pressed || pad.buttons[0]?.pressed) {
            appState.emergencyStopRequest = true;
        }
    } else {
        gamepadStatus.textContent = "Gamepad: Off";
        gamepadStatus.classList.remove('active');
    }
}

// --- Main Render Loop (60 FPS) ---
function gameLoop(timestamp) {
    appState.frameCount++;
    if (timestamp - appState.lastFrameTime >= 1000) {
        appState.fps = appState.frameCount;
        appState.frameCount = 0;
        appState.lastFrameTime = timestamp;
        fpsCounter.textContent = `FPS: ${appState.fps}`;
    }

    pollGamepad();
    renderGauges();
    requestAnimationFrame(gameLoop);
}

// Initialize Application
function init() {
    setupEventListeners();
    connectWebSocket();
    setInterval(sendCommandLoop, 100); // 100ms periodic transmit & watchdog
    requestAnimationFrame(gameLoop);
}

init();
