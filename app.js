/**
 * ミニ四駆自動運転 WebApp (FPV Cockpit Controller - Minimal Monochrome)
 * 
 * スマホ操作 & 車載カメラ映像（FPV）に特化したモバイルファースト実装:
 * - 画面全体に車載マイコンから配信されるカメラ映像ストリーム (/video_feed) を表示
 * - 画面を見ずに操作可能な左右分割ブラインドタッチ操作 (左親指: スロットル / 右親指: ステアリング)
 * - 装飾を最小限に抑えた純白・黒・グレーのモノクロームデザイン
 * - Source of Truth は車載マイコン (Heartbeat)
 * - 2軸独立制御 (スロットル / ステアリング、斜め走行対応、自動中立復帰)
 * - 状態遷移管理 (MANUAL, AUTO_PENDING, MANUAL_PENDING, AUTO, AUTO_TOR, SAFE_STOP, EMERGENCY_STOP, DISCONNECTED)
 */

// ==========================================
// 定数 & 列挙型定義
// ==========================================

const UIState = Object.freeze({
    DISCONNECTED: 'DISCONNECTED',
    MANUAL: 'MANUAL',
    AUTO_PENDING: 'AUTO_PENDING',
    MANUAL_PENDING: 'MANUAL_PENDING',
    AUTO: 'AUTO',
    AUTO_TOR: 'AUTO_TOR',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

const ClientMode = Object.freeze({
    MANUAL: 'MANUAL',
    AUTO: 'AUTO',
    SAFE_STOP: 'SAFE_STOP',
    EMERGENCY_STOP: 'EMERGENCY_STOP'
});

const ModeRequest = Object.freeze({
    NONE: 'NONE',
    MANUAL: 'MANUAL',
    AUTO: 'AUTO'
});

const StopReasonText = Object.freeze({
    NONE: 'NONE',
    OBSTACLE: 'OBSTACLE DETECTED',
    TOR_TIMEOUT: 'TOR TIMEOUT',
    EMERGENCY_BUTTON: 'EMERGENCY STOP',
    COMM_TIMEOUT: 'COMM TIMEOUT',
    SENSOR_ERROR: 'SENSOR ERROR'
});

const RejectReasonText = Object.freeze({
    NONE: 'NONE',
    OBSTACLE_NEAR: 'OBSTACLE NEAR',
    SENSOR_NOT_READY: 'SENSOR NOT READY',
    IN_TOR: 'IN TOR WARNING',
    IN_EMERGENCY: 'IN EMERGENCY STOP',
    MODE_MISMATCH: 'MODE MISMATCH'
});

// ==========================================
// 1. InputController クラス (スマホタッチ・ブラインド操作・キーボード・パッド)
// ==========================================

class InputController {
    constructor(onEmergencyStopCallback) {
        this.onEmergencyStop = onEmergencyStopCallback;
        this.enabled = true;

        this.throttle = 0.0;
        this.steering = 0.0;

        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false
        };

        this.gamepadConnected = false;

        this.touchState = {
            throttle: {
                active: false,
                touchId: null,
                startY: 0,
                currentY: 0,
                maxDistance: 60
            },
            steering: {
                active: false,
                touchId: null,
                startX: 0,
                currentX: 0,
                maxDistance: 60
            }
        };

        this.mouseState = {
            activeZone: null,
            startY: 0,
            startX: 0
        };

        this.throttleZone = document.getElementById('touch-throttle-zone');
        this.steeringZone = document.getElementById('touch-steering-zone');
        this.throttleJoystickBase = document.getElementById('throttle-joystick-base');
        this.throttleJoystickThumb = document.getElementById('throttle-joystick-thumb');
        this.steeringJoystickBase = document.getElementById('steering-joystick-base');
        this.steeringJoystickThumb = document.getElementById('steering-joystick-thumb');

        this.initTouchEvents();
        this.initMouseEvents();
        this.initKeyboardEvents();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.reset();
        }
    }

    reset() {
        this.throttle = 0.0;
        this.steering = 0.0;

        this.keys.up = false;
        this.keys.down = false;
        this.keys.left = false;
        this.keys.right = false;

        this.touchState.throttle.active = false;
        this.touchState.throttle.touchId = null;
        this.touchState.steering.active = false;
        this.touchState.steering.touchId = null;

        if (this.throttleJoystickBase) this.throttleJoystickBase.classList.add('hidden');
        if (this.steeringJoystickBase) this.steeringJoystickBase.classList.add('hidden');
    }

    initTouchEvents() {
        // 左ゾーン: スロットル
        this.throttleZone.addEventListener('touchstart', (e) => {
            if (!this.enabled) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (!this.touchState.throttle.active) {
                    this.touchState.throttle.active = true;
                    this.touchState.throttle.touchId = touch.identifier;
                    this.touchState.throttle.startY = touch.clientY;
                    this.touchState.throttle.currentY = touch.clientY;

                    const rect = this.throttleZone.getBoundingClientRect();
                    const localX = touch.clientX - rect.left;
                    const localY = touch.clientY - rect.top;
                    this.throttleJoystickBase.style.left = `${localX}px`;
                    this.throttleJoystickBase.style.top = `${localY}px`;
                    this.throttleJoystickThumb.style.transform = 'translate(-50%, -50%)';
                    this.throttleJoystickBase.classList.remove('hidden');
                    break;
                }
            }
        }, { passive: false });

        this.throttleZone.addEventListener('touchmove', (e) => {
            if (!this.enabled || !this.touchState.throttle.active) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === this.touchState.throttle.touchId) {
                    this.touchState.throttle.currentY = touch.clientY;
                    const deltaY = this.touchState.throttle.startY - touch.clientY;
                    const maxDist = this.touchState.throttle.maxDistance;

                    let norm = deltaY / maxDist;
                    norm = Math.max(-1.0, Math.min(1.0, norm));
                    if (Math.abs(norm) < 0.05) norm = 0.0;

                    this.throttle = norm;
                    const visualY = -norm * (maxDist * 0.5);
                    this.throttleJoystickThumb.style.transform = `translate(-50%, calc(-50% + ${visualY}px))`;
                    break;
                }
            }
        }, { passive: false });

        const endThrottleTouch = (e) => {
            if (!this.touchState.throttle.active) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchState.throttle.touchId) {
                    this.touchState.throttle.active = false;
                    this.touchState.throttle.touchId = null;
                    this.throttle = 0.0;
                    this.throttleJoystickBase.classList.add('hidden');
                    break;
                }
            }
        };

        this.throttleZone.addEventListener('touchend', endThrottleTouch, { passive: false });
        this.throttleZone.addEventListener('touchcancel', endThrottleTouch, { passive: false });

        // 右ゾーン: ステアリング
        this.steeringZone.addEventListener('touchstart', (e) => {
            if (!this.enabled) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (!this.touchState.steering.active) {
                    this.touchState.steering.active = true;
                    this.touchState.steering.touchId = touch.identifier;
                    this.touchState.steering.startX = touch.clientX;
                    this.touchState.steering.currentX = touch.clientX;

                    const rect = this.steeringZone.getBoundingClientRect();
                    const localX = touch.clientX - rect.left;
                    const localY = touch.clientY - rect.top;
                    this.steeringJoystickBase.style.left = `${localX}px`;
                    this.steeringJoystickBase.style.top = `${localY}px`;
                    this.steeringJoystickThumb.style.transform = 'translate(-50%, -50%)';
                    this.steeringJoystickBase.classList.remove('hidden');
                    break;
                }
            }
        }, { passive: false });

        this.steeringZone.addEventListener('touchmove', (e) => {
            if (!this.enabled || !this.touchState.steering.active) return;
            e.preventDefault();

            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === this.touchState.steering.touchId) {
                    this.touchState.steering.currentX = touch.clientX;
                    const deltaX = touch.clientX - this.touchState.steering.startX;
                    const maxDist = this.touchState.steering.maxDistance;

                    let norm = deltaX / maxDist;
                    norm = Math.max(-1.0, Math.min(1.0, norm));
                    if (Math.abs(norm) < 0.05) norm = 0.0;

                    this.steering = norm;
                    const visualX = norm * (maxDist * 0.5);
                    this.steeringJoystickThumb.style.transform = `translate(calc(-50% + ${visualX}px), -50%)`;
                    break;
                }
            }
        }, { passive: false });

        const endSteeringTouch = (e) => {
            if (!this.touchState.steering.active) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchState.steering.touchId) {
                    this.touchState.steering.active = false;
                    this.touchState.steering.touchId = null;
                    this.steering = 0.0;
                    this.steeringJoystickBase.classList.add('hidden');
                    break;
                }
            }
        };

        this.steeringZone.addEventListener('touchend', endSteeringTouch, { passive: false });
        this.steeringZone.addEventListener('touchcancel', endSteeringTouch, { passive: false });
    }

    initMouseEvents() {
        this.throttleZone.addEventListener('mousedown', (e) => {
            if (!this.enabled || e.button !== 0) return;
            this.mouseState.activeZone = 'throttle';
            this.mouseState.startY = e.clientY;

            const rect = this.throttleZone.getBoundingClientRect();
            this.throttleJoystickBase.style.left = `${e.clientX - rect.left}px`;
            this.throttleJoystickBase.style.top = `${e.clientY - rect.top}px`;
            this.throttleJoystickThumb.style.transform = 'translate(-50%, -50%)';
            this.throttleJoystickBase.classList.remove('hidden');
        });

        this.steeringZone.addEventListener('mousedown', (e) => {
            if (!this.enabled || e.button !== 0) return;
            this.mouseState.activeZone = 'steering';
            this.mouseState.startX = e.clientX;

            const rect = this.steeringZone.getBoundingClientRect();
            this.steeringJoystickBase.style.left = `${e.clientX - rect.left}px`;
            this.steeringJoystickBase.style.top = `${e.clientY - rect.top}px`;
            this.steeringJoystickThumb.style.transform = 'translate(-50%, -50%)';
            this.steeringJoystickBase.classList.remove('hidden');
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.enabled || !this.mouseState.activeZone) return;

            if (this.mouseState.activeZone === 'throttle') {
                const deltaY = this.mouseState.startY - e.clientY;
                const maxDist = 60;
                let norm = Math.max(-1.0, Math.min(1.0, deltaY / maxDist));
                if (Math.abs(norm) < 0.05) norm = 0.0;
                this.throttle = norm;
                const visualY = -norm * (maxDist * 0.5);
                this.throttleJoystickThumb.style.transform = `translate(-50%, calc(-50% + ${visualY}px))`;
            } else if (this.mouseState.activeZone === 'steering') {
                const deltaX = e.clientX - this.mouseState.startX;
                const maxDist = 60;
                let norm = Math.max(-1.0, Math.min(1.0, deltaX / maxDist));
                if (Math.abs(norm) < 0.05) norm = 0.0;
                this.steering = norm;
                const visualX = norm * (maxDist * 0.5);
                this.steeringJoystickThumb.style.transform = `translate(calc(-50% + ${visualX}px), -50%)`;
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.mouseState.activeZone === 'throttle') {
                this.throttle = 0.0;
                this.throttleJoystickBase.classList.add('hidden');
            } else if (this.mouseState.activeZone === 'steering') {
                this.steering = 0.0;
                this.steeringJoystickBase.classList.add('hidden');
            }
            this.mouseState.activeZone = null;
        });
    }

    initKeyboardEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = true;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = true;
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;

            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                if (this.onEmergencyStop) this.onEmergencyStop();
            }

            this.updateFromKeyboard();
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = false;
            if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = false;
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;

            this.updateFromKeyboard();
        });
    }

    updateFromKeyboard() {
        if (!this.enabled) return;

        let targetThrottle = 0.0;
        let targetSteering = 0.0;

        if (this.keys.up && !this.keys.down) targetThrottle = 1.0;
        if (this.keys.down && !this.keys.up) targetThrottle = -1.0;

        if (this.keys.left && !this.keys.right) targetSteering = -1.0;
        if (this.keys.right && !this.keys.left) targetSteering = 1.0;

        const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
        if (isKeyboardActive) {
            this.throttle = targetThrottle;
            this.steering = targetSteering;
        } else if (!this.touchState.throttle.active && !this.mouseState.activeZone) {
            if (!this.keys.up && !this.keys.down) this.throttle = 0.0;
            if (!this.keys.left && !this.keys.right) this.steering = 0.0;
        }
    }

    pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[0];

        if (!pad) {
            this.gamepadConnected = false;
            return;
        }

        this.gamepadConnected = true;

        if (this.enabled) {
            const deadband = 0.08;
            let stickX = pad.axes[0] || pad.axes[2] || 0;
            let stickY = -(pad.axes[1] || 0);

            if (Math.abs(stickX) < deadband) stickX = 0;
            if (Math.abs(stickY) < deadband) stickY = 0;

            const isKeyboardActive = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
            const isTouchActive = this.touchState.throttle.active || this.touchState.steering.active || this.mouseState.activeZone;

            if (!isKeyboardActive && !isTouchActive) {
                this.throttle = stickY;
                this.steering = stickX;
            }
        }

        if (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed || pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) {
            if (this.onEmergencyStop) this.onEmergencyStop();
        }
    }

    getThrottle() {
        return this.enabled ? this.throttle : 0.0;
    }

    getSteering() {
        return this.enabled ? this.steering : 0.0;
    }
}

// ==========================================
// 2. CameraManager クラス (車載カメラストリーム受信管理)
// ==========================================

class CameraManager {
    constructor() {
        this.cameraStreamImg = document.getElementById('camera-stream');
        this.cameraModeLabel = document.getElementById('camera-mode-label');

        const savedUrl = localStorage.getItem('mini4wd_camera_url') || '/video_feed';
        this.applyCameraUrl(savedUrl);
    }

    applyCameraUrl(url) {
        this.streamUrl = url.trim() || '/video_feed';
        localStorage.setItem('mini4wd_camera_url', this.streamUrl);

        if (this.cameraStreamImg) {
            this.cameraStreamImg.src = this.streamUrl;
            this.cameraModeLabel.textContent = 'LIVE';
        }
    }
}

// ==========================================
// 3. UIManager クラス (画面描画 & HUD制御)
// ==========================================

class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.initDOMElements();
        this.bindEvents();
        this.alertTimeout = null;
    }

    initDOMElements() {
        this.wsStatus = document.getElementById('ws-status');
        this.wsStatusText = document.getElementById('ws-status-text');
        this.modeBadge = document.getElementById('mode-badge');
        this.distanceBadge = document.getElementById('distance-badge');
        this.distanceHudCard = document.getElementById('distance-hud-card');
        this.fpsCounter = document.getElementById('fps-counter');
        this.gamepadStatus = document.getElementById('gamepad-status');

        this.throttleBarFill = document.getElementById('throttle-bar-fill');
        this.steeringBarFill = document.getElementById('steering-bar-fill');
        this.throttleValue = document.getElementById('throttle-value');
        this.steeringValue = document.getElementById('steering-value');
        this.steeringGuideMarker = document.getElementById('steering-guide-marker');

        this.btnDriveMode = document.getElementById('btn-drive-mode');
        this.btnDriveModeText = document.getElementById('btn-drive-mode-text');
        this.btnResetStop = document.getElementById('btn-reset-stop');
        this.btnResetStopText = document.getElementById('btn-reset-stop-text');
        this.btnEmergencyStop = document.getElementById('btn-emergency-stop');
        this.btnFullscreen = document.getElementById('btn-fullscreen');
        this.btnAbout = document.getElementById('btn-about');
        this.btnCloseAbout = document.getElementById('btn-close-about');
        this.btnCameraSettings = document.getElementById('btn-camera-settings');
        this.btnSaveCamera = document.getElementById('btn-save-camera');
        this.btnCloseCamera = document.getElementById('btn-close-camera');

        this.stopReasonHud = document.getElementById('stop-reason-hud');
        this.statusStopReason = document.getElementById('status-stop-reason');

        this.alertBanner = document.getElementById('alert-banner');
        this.alertMessage = document.getElementById('alert-message');

        this.aboutModal = document.getElementById('about-modal');
        this.cameraModal = document.getElementById('camera-modal');
        this.cameraUrlInput = document.getElementById('camera-url-input');
        this.torOverlay = document.getElementById('tor-overlay');
        this.torCountdown = document.getElementById('tor-countdown');
        this.btnTorTakeover = document.getElementById('btn-tor-takeover');
        this.disconnectedOverlay = document.getElementById('disconnected-overlay');
    }

    bindEvents() {
        this.btnDriveMode.addEventListener('click', () => {
            if (this.callbacks.onDriveModeClick) this.callbacks.onDriveModeClick();
        });

        this.btnEmergencyStop.addEventListener('click', () => {
            if (this.callbacks.onEmergencyStopClick) this.callbacks.onEmergencyStopClick();
        });

        this.btnResetStop.addEventListener('click', () => {
            if (this.callbacks.onResetStopClick) this.callbacks.onResetStopClick();
        });

        this.btnTorTakeover.addEventListener('click', () => {
            if (this.callbacks.onTorTakeoverClick) this.callbacks.onTorTakeoverClick();
        });

        this.btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        this.btnAbout.addEventListener('click', () => {
            this.aboutModal.classList.remove('hidden');
        });

        this.btnCloseAbout.addEventListener('click', () => {
            this.aboutModal.classList.add('hidden');
        });

        this.btnCameraSettings.addEventListener('click', () => {
            const currentUrl = localStorage.getItem('mini4wd_camera_url') || '/video_feed';
            this.cameraUrlInput.value = currentUrl;
            this.cameraModal.classList.remove('hidden');
        });

        this.btnCloseCamera.addEventListener('click', () => {
            this.cameraModal.classList.add('hidden');
        });

        this.btnSaveCamera.addEventListener('click', () => {
            const url = this.cameraUrlInput.value.trim();
            if (this.callbacks.onCameraSettingsSave) {
                this.callbacks.onCameraSettingsSave(url);
            }
            this.cameraModal.classList.add('hidden');
        });
    }

    renderState(uiState, mcuData) {
        const dist = (mcuData && mcuData.front_distance_mm !== undefined) ? mcuData.front_distance_mm : '--';
        const stopReason = mcuData ? (StopReasonText[mcuData.stop_reason] || mcuData.stop_reason) : 'NONE';

        this.modeBadge.textContent = uiState;
        this.modeBadge.className = `hud-badge mode-badge mode-${uiState.toLowerCase().replace('_', '')}`;
        this.distanceBadge.textContent = String(dist);

        if (uiState === UIState.SAFE_STOP || uiState === UIState.EMERGENCY_STOP) {
            this.stopReasonHud.classList.remove('hidden');
            this.statusStopReason.textContent = stopReason;
        } else {
            this.stopReasonHud.classList.add('hidden');
        }

        switch (uiState) {
            case UIState.DISCONNECTED:
                this.disconnectedOverlay.classList.remove('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: OFFLINE';
                this.wsStatus.className = 'hud-badge status-badge disconnected';

                this.btnDriveMode.disabled = true;
                this.btnEmergencyStop.disabled = true;
                this.btnResetStop.classList.add('hidden');
                break;

            case UIState.MANUAL:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode', 'pending');
                this.btnDriveModeText.textContent = 'AUTO MODE';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'auto-mode');
                this.btnDriveMode.classList.add('pending');
                this.btnDriveModeText.textContent = 'PENDING...';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.MANUAL_PENDING:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden');
                this.btnDriveMode.classList.add('auto-mode', 'pending');
                this.btnDriveModeText.textContent = 'PENDING...';
                this.btnDriveMode.disabled = true;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.remove('hidden', 'pending');
                this.btnDriveMode.classList.add('auto-mode');
                this.btnDriveModeText.textContent = 'MANUAL MODE';
                this.btnDriveMode.disabled = false;

                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.AUTO_TOR:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.remove('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                if (mcuData && mcuData.tor_remaining_ms !== undefined) {
                    const sec = (mcuData.tor_remaining_ms / 1000).toFixed(1);
                    this.torCountdown.textContent = sec;
                }

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.add('hidden');
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.SAFE_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStopText.textContent = 'RESUME / RESET';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = false;
                break;

            case UIState.EMERGENCY_STOP:
                this.disconnectedOverlay.classList.add('hidden');
                this.torOverlay.classList.add('hidden');
                this.wsStatusText.textContent = 'WS: ONLINE';
                this.wsStatus.className = 'hud-badge status-badge connected';

                this.btnDriveMode.classList.add('hidden');
                this.btnResetStop.classList.remove('hidden');
                this.btnResetStopText.textContent = 'RESET STOP';
                this.btnResetStop.disabled = false;
                this.btnEmergencyStop.disabled = true;
                break;
        }
    }

    renderGauges(throttle, steering) {
        const tPct = Math.round(throttle * 100);
        const sPct = Math.round(steering * 100);

        this.throttleValue.textContent = `${tPct > 0 ? '+' : ''}${tPct}%`;
        this.steeringValue.textContent = `${sPct > 0 ? 'R' : sPct < 0 ? 'L' : ''}${Math.abs(sPct)}%`;

        if (throttle >= 0) {
            this.throttleBarFill.style.bottom = '50%';
            this.throttleBarFill.style.top = 'auto';
            this.throttleBarFill.style.height = `${throttle * 50}%`;
        } else {
            this.throttleBarFill.style.top = '50%';
            this.throttleBarFill.style.bottom = 'auto';
            this.throttleBarFill.style.height = `${Math.abs(throttle) * 50}%`;
        }

        if (steering >= 0) {
            this.steeringBarFill.style.left = '50%';
            this.steeringBarFill.style.right = 'auto';
            this.steeringBarFill.style.width = `${steering * 50}%`;
        } else {
            this.steeringBarFill.style.right = '50%';
            this.steeringBarFill.style.left = 'auto';
            this.steeringBarFill.style.width = `${Math.abs(steering) * 50}%`;
        }

        const markerX = steering * 30;
        this.steeringGuideMarker.style.transform = `translate(calc(-50% + ${markerX}px), -50%)`;
    }

    updateGamepadStatus(active) {
        if (active) {
            this.gamepadStatus.classList.remove('hidden');
            this.gamepadStatus.classList.add('active');
        } else {
            this.gamepadStatus.classList.add('hidden');
            this.gamepadStatus.classList.remove('active');
        }
    }

    updateFPS(fps) {
        this.fpsCounter.textContent = `${fps} FPS`;
    }

    showError(msg) {
        this.alertMessage.textContent = msg;
        this.alertBanner.classList.remove('hidden');
        if (this.alertTimeout) clearTimeout(this.alertTimeout);
        this.alertTimeout = setTimeout(() => {
            this.alertBanner.classList.add('hidden');
        }, 3000);
    }
}

// ==========================================
// 4. CommManager クラス (WebSocket通信 & 定期ループ)
// ==========================================

class CommManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.ws = null;
        this.lastHeartbeatTime = 0;
        this.connected = false;

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = location.host || 'localhost:8765';
        this.wsUrl = `${wsProto}//${wsHost}`;

        this.connect();
        this.startTransmitLoop();
    }

    connect() {
        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (e) {
            this.onConnectionLost();
            setTimeout(() => this.connect(), 2000);
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.lastHeartbeatTime = Date.now();
            if (this.callbacks.onConnect) this.callbacks.onConnect();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.lastHeartbeatTime = Date.now();
                if (!this.connected) {
                    this.connected = true;
                    if (this.callbacks.onConnect) this.callbacks.onConnect();
                }
                if (this.callbacks.onHeartbeat) this.callbacks.onHeartbeat(data);
            } catch (e) {
                console.error('[CommManager] Invalid Heartbeat JSON:', e);
            }
        };

        this.ws.onclose = () => {
            this.onConnectionLost();
            setTimeout(() => this.connect(), 1500);
        };

        this.ws.onerror = () => {
            this.onConnectionLost();
        };
    }

    onConnectionLost() {
        if (this.connected) {
            this.connected = false;
            if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
        }
    }

    startTransmitLoop() {
        setInterval(() => {
            if (this.connected && Date.now() - this.lastHeartbeatTime > 1500) {
                this.onConnectionLost();
            }

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const payload = this.callbacks.getTransmitPayload();
                if (payload) {
                    this.ws.send(JSON.stringify(payload));
                }
            }
        }, 100);
    }
}

// ==========================================
// 5. StateMachine クラス (UI状態遷移 & 安全ルール管理)
// ==========================================

class StateMachine {
    constructor(app) {
        this.app = app;
        this.currentState = UIState.DISCONNECTED;
        this.pendingTimer = null;

        this.mcuData = {
            mode: 'MANUAL',
            front_distance_mm: 1200,
            tor_active: false,
            tor_remaining_ms: 0,
            stop_reason: 'NONE',
            request_reject_reason: 'NONE',
            heartbeat_seq: 0
        };

        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;
    }

    getClientMode() {
        switch (this.currentState) {
            case UIState.MANUAL:
            case UIState.AUTO_PENDING:
                return ClientMode.MANUAL;
            case UIState.AUTO:
            case UIState.MANUAL_PENDING:
            case UIState.AUTO_TOR:
                return ClientMode.AUTO;
            case UIState.SAFE_STOP:
                return ClientMode.SAFE_STOP;
            case UIState.EMERGENCY_STOP:
                return ClientMode.EMERGENCY_STOP;
            default:
                return ClientMode.MANUAL;
        }
    }

    getTransmitPayload() {
        const isManualDriving = (this.currentState === UIState.MANUAL);

        const payload = {
            client_mode: this.getClientMode(),
            throttle: isManualDriving ? this.app.input.getThrottle() : 0.0,
            steering: isManualDriving ? this.app.input.getSteering() : 0.0,
            mode_request: this.pendingModeRequest,
            emergency_stop_request: this.pendingEmergencyStop,
            reset_stop_request: this.pendingResetStop
        };

        this.pendingModeRequest = ModeRequest.NONE;
        this.pendingEmergencyStop = false;
        this.pendingResetStop = false;

        return payload;
    }

    handleHeartbeat(data) {
        this.mcuData = data;

        if (data.request_reject_reason && data.request_reject_reason !== 'NONE') {
            const reasonMsg = RejectReasonText[data.request_reject_reason] || data.request_reject_reason;
            this.app.ui.showError(`REJECTED: ${reasonMsg}`);
        }

        if (this.currentState === UIState.DISCONNECTED) {
            this.transitionToMCUState();
            return;
        }

        if (this.currentState === UIState.AUTO_PENDING) {
            if (data.mode === 'AUTO') {
                this.clearPendingTimer();
                this.transitionTo(data.tor_active ? UIState.AUTO_TOR : UIState.AUTO);
                return;
            }
            if (data.request_reject_reason !== 'NONE' || data.mode !== 'MANUAL') {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return;
        }

        if (this.currentState === UIState.MANUAL_PENDING) {
            if (data.mode === 'MANUAL') {
                this.clearPendingTimer();
                this.transitionTo(UIState.MANUAL);
                return;
            }
            if (data.mode !== 'AUTO') {
                this.clearPendingTimer();
                this.transitionToMCUState();
                return;
            }
            return;
        }

        this.transitionToMCUState();
    }

    transitionToMCUState() {
        const mode = this.mcuData.mode;

        if (mode === 'EMERGENCY_STOP') {
            this.transitionTo(UIState.EMERGENCY_STOP);
        } else if (mode === 'SAFE_STOP') {
            this.transitionTo(UIState.SAFE_STOP);
        } else if (mode === 'AUTO') {
            if (this.mcuData.tor_active) {
                this.transitionTo(UIState.AUTO_TOR);
            } else {
                this.transitionTo(UIState.AUTO);
            }
        } else if (mode === 'MANUAL') {
            this.transitionTo(UIState.MANUAL);
        }
    }

    transitionTo(newState) {
        this.currentState = newState;

        if (newState === UIState.MANUAL) {
            this.app.input.setEnabled(true);
        } else {
            this.app.input.setEnabled(false);
        }

        this.app.ui.renderState(this.currentState, this.mcuData);
    }

    clearPendingTimer() {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    requestDriveModeToggle() {
        if (this.currentState === UIState.MANUAL) {
            this.pendingModeRequest = ModeRequest.AUTO;
            this.transitionTo(UIState.AUTO_PENDING);

            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.AUTO_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT');
                    this.transitionTo(UIState.MANUAL);
                }
            }, 1000);

        } else if (this.currentState === UIState.AUTO) {
            this.pendingModeRequest = ModeRequest.MANUAL;
            this.transitionTo(UIState.MANUAL_PENDING);

            this.pendingTimer = setTimeout(() => {
                if (this.currentState === UIState.MANUAL_PENDING) {
                    this.app.ui.showError('MODE SWITCH TIMEOUT (RESENDING)');
                    this.pendingModeRequest = ModeRequest.MANUAL;
                }
            }, 1000);
        }
    }

    requestEmergencyStop() {
        this.pendingEmergencyStop = true;
        this.clearPendingTimer();
        this.transitionTo(UIState.EMERGENCY_STOP);
    }

    requestResetStop() {
        this.pendingResetStop = true;
    }

    requestTorTakeover() {
        this.pendingModeRequest = ModeRequest.MANUAL;
    }

    handleDisconnect() {
        this.clearPendingTimer();
        this.transitionTo(UIState.DISCONNECTED);
    }

    handleConnect() {
        this.transitionToMCUState();
    }
}

// ==========================================
// 6. Mini4WDApp クラス (メインオーケストレーター)
// ==========================================

class Mini4WDApp {
    constructor() {
        this.input = new InputController(() => this.stateMachine.requestEmergencyStop());
        this.camera = new CameraManager();

        this.ui = new UIManager({
            onDriveModeClick: () => this.stateMachine.requestDriveModeToggle(),
            onEmergencyStopClick: () => this.stateMachine.requestEmergencyStop(),
            onResetStopClick: () => this.stateMachine.requestResetStop(),
            onTorTakeoverClick: () => this.stateMachine.requestTorTakeover(),
            onCameraSettingsSave: (url) => this.camera.applyCameraUrl(url)
        });

        this.stateMachine = new StateMachine(this);

        this.comm = new CommManager({
            onConnect: () => this.stateMachine.handleConnect(),
            onDisconnect: () => this.stateMachine.handleDisconnect(),
            onHeartbeat: (data) => this.stateMachine.handleHeartbeat(data),
            getTransmitPayload: () => this.stateMachine.getTransmitPayload()
        });

        this.frameCount = 0;
        this.lastFpsTimestamp = performance.now();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    loop(timestamp) {
        this.frameCount++;
        if (timestamp - this.lastFpsTimestamp >= 1000) {
            const fps = this.frameCount;
            this.ui.updateFPS(fps);
            this.frameCount = 0;
            this.lastFpsTimestamp = timestamp;
        }

        this.input.pollGamepad();
        this.ui.updateGamepadStatus(this.input.gamepadConnected);

        const currentThrottle = this.input.getThrottle();
        const currentSteering = this.input.getSteering();

        this.ui.renderGauges(currentThrottle, currentSteering);

        requestAnimationFrame(this.loop);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new Mini4WDApp();
});


